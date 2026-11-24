/**
 * Method 4: Superposition Theorem Solver.
 *
 * Deactivates all independent sources except one at a time (voltage sources -> 0 V short,
 * current sources -> open circuit), solves each sub-circuit independently, and combines:
 *   - Same-frequency DC / single-frequency AC: complex sum verified against MNA (< 1e-8).
 *   - Multi-frequency AC: per-frequency phasors + time-domain sinusoid sum & RMS effective value.
 */

import { Complex } from '../complex';
import { buildElectricalGraph, parseSourceValue, latexNodeId } from '../graph';
import { solveMNA } from '../mna';
import {
	isDependentSourceKind,
	type CircuitComponent,
	type CircuitDocument,
	type MethodResult,
	type MnaSolution,
	type SolutionStep
} from '../types';
import {
	buildDeactivatedDocument,
	formatLatexTerm,
	formatLatexValue,
	getPassiveImpedance,
	getRedundantSourceInapplicableReason,
	latexSub,
	remapDependentControlNodes,
	verifyAgainstMna
} from './shared';
import { solveNodal } from './nodal';
import {
	latexName,
	reduceSeriesParallel,
	reqLatex,
	walkToTarget,
	type SpEdge,
	type SpReduction
} from './sp-reduce';

function mapSubNodesToOriginal(
	origGraph: ReturnType<typeof buildElectricalGraph>,
	subGraph: ReturnType<typeof buildElectricalGraph>,
	subSol: MnaSolution
): Record<string, Complex> {
	// Sub-circuit voltage at the node matching an original node (by shared pin, else grid point)
	const lookup = (origNode: (typeof origGraph.nodes)[string]): Complex | undefined => {
		for (const pin of origNode.componentPins) {
			const subCompNodes = subGraph.componentNodes[pin.componentId];
			if (subCompNodes && subCompNodes[pin.pinIndex]) {
				const v = subSol.nodeVoltages[subCompNodes[pin.pinIndex]]?.voltage;
				if (v) return v;
			}
		}
		if (origNode.gridPoints.length > 0) {
			const gp = origNode.gridPoints[0];
			for (const [subNid, subNode] of Object.entries(subGraph.nodes)) {
				if (subNode.gridPoints.some((p) => p.x === gp.x && p.y === gp.y)) {
					return subSol.nodeVoltages[subNid]?.voltage;
				}
			}
		}
		return undefined;
	};

	// Without a ground symbol each sub-circuit auto-picks its own reference node, which can differ
	// from the original one. Re-reference every sub-solution to the original reference "0".
	const origRef = origGraph.nodes['0'];
	const refOffset = (origRef && lookup(origRef)) ?? Complex.zero();

	const mapped: Record<string, Complex> = {};
	for (const [origNodeId, origNode] of Object.entries(origGraph.nodes)) {
		if (origNodeId === '0') {
			mapped[origNodeId] = Complex.zero();
			continue;
		}
		const v = lookup(origNode);
		mapped[origNodeId] = v ? v.sub(refOffset) : Complex.zero();
	}
	return mapped;
}

const PRIME_TITLE = ['′', '″', '‴'];
/** Part labels: first, second, third (prime marks), then (4), (5)... */
function primeTitle(k: number): string {
	return PRIME_TITLE[k] ?? `(${k + 1})`;
}
/** LaTeX prime marks for part k (they go right after the letter), then ^{(4)}... */
function primeTex(k: number): string {
	return ["'", "''", "'''"][k] ?? `^{(${k + 1})}`;
}

const PASSIVE_KINDS = new Set(['resistor', 'capacitor', 'inductor']);

/** Equal within 1e-6 relative (plus a tiny absolute floor for zeros). */
function closeTo(a: Complex, b: Complex): boolean {
	return a.sub(b).abs() <= 1e-6 * Math.max(a.abs(), b.abs()) + 1e-12;
}

function eqSymbol(m: 'dc' | 'ac'): string {
	return m === 'ac' ? 'Z_{eq}' : 'R_{eq}';
}

interface PartWork {
	lines: string[];
	/** Target current / voltage of this part (pin 0 -> pin 1), when a target is set. */
	i?: Complex;
	v?: Complex;
}

interface PartInput {
	k: number;
	activeSrc: CircuitComponent;
	sources: CircuitComponent[];
	subDoc: CircuitDocument;
	subGraph: ReturnType<typeof buildElectricalGraph>;
	subSol: MnaSolution;
	subMode: 'dc' | 'ac';
	hasDependent: boolean;
	target?: CircuitComponent;
}

/** Series-parallel reduction of the sub-circuit as seen by the active source (no dependent sources). */
function reduceSubCircuit(a: PartInput): SpReduction | undefined {
	const srcNodes = a.subGraph.componentNodes[a.activeSrc.id];
	if (!srcNodes || srcNodes.length < 2) return undefined;
	const edges: SpEdge[] = [];
	const shorts: Array<[string, string]> = [];
	for (const comp of a.subDoc.components) {
		const nodes = a.subGraph.componentNodes[comp.id];
		if (!nodes || nodes.length < 2) continue;
		if (PASSIVE_KINDS.has(comp.kind)) {
			const z = getPassiveImpedance(comp, a.subMode, a.subDoc.frequencyHz);
			edges.push({
				id: comp.id,
				label: comp.label,
				...(comp.kind === 'resistor' ? {} : { name: `Z_{${latexSub(comp.label)}}` }),
				nodeA: nodes[0],
				nodeB: nodes[1],
				z: z ?? Complex.from(Infinity, 0)
			});
		} else if (comp.kind === 'voltage_source' && comp.id !== a.activeSrc.id) {
			shorts.push([nodes[0], nodes[1]]);
		}
	}
	return reduceSeriesParallel({ edges, shorts, ports: [srcNodes[0], srcNodes[1]] });
}

/** Node equations of the sub-circuit (spliced from the nodal method), or null if unavailable. */
function nodalFallbackLines(subDoc: CircuitDocument, subSol: MnaSolution): string[] | null {
	try {
		const res = solveNodal(subDoc, subSol);
		if (!res.applicable) return null;
		const out: string[] = [];
		for (const step of res.steps) {
			if (!step.latex || step.latex.length === 0) continue;
			const heading = step.title.replace(/^\d+\.\s*/, '').replace(/&/g, 'and');
			out.push(`\\text{${heading}}`, ...step.latex);
		}
		return out.length > 0 ? out : null;
	} catch {
		return null;
	}
}

/**
 * The worked solution of one part (one source on, the rest off), in the course's style.
 * Every number shown agrees with the sub-circuit MNA solve; if the series-parallel chain does not
 * reproduce it (or the sub-circuit is not series-parallel) the chain is dropped.
 */
function workPart(a: PartInput): PartWork {
	const { subMode, subSol, activeSrc, target } = a;
	const val = (c: Complex) => formatLatexValue(c, subMode);
	const term = (c: Complex) => formatLatexTerm(c, subMode);
	const lines: string[] = [];

	const off = a.sources
		.filter((s) => s.id !== activeSrc.id)
		.map(
			(s) =>
				`\\text{${latexSub(s.label)} off} \\to \\text{${s.kind === 'voltage_source' ? 'short' : 'open'}}`
		);
	if (off.length > 0) lines.push(off.join(',\\; '));

	const br = target ? subSol.branches[target.id] : undefined;
	const tn = target ? latexName(target.label) : '';
	const iName = `I${primeTex(a.k)}_{${tn}}`;
	const vName = `V${primeTex(a.k)}_{${tn}}`;

	// Try the series-parallel chain.
	const chain: string[] = [];
	let chainI: Complex | undefined;
	let chainV: Complex | undefined;
	let red: SpReduction | undefined;
	try {
		red = a.hasDependent ? undefined : reduceSubCircuit(a);
	} catch {
		red = undefined;
	}
	let ok = false;
	try {
		if (red?.ok && red.root) {
			const root = red.root;
			const srcBranch = subSol.branches[activeSrc.id];
			const srcVal = parseSourceValue(activeSrc, subMode);
			let iSrc: Complex | undefined;
			let entry = red.portP;
			const srcLine: string[] = [];
			if (srcVal && activeSrc.kind === 'voltage_source') {
				iSrc = srcVal.div(root.z);
				srcLine.push(
					`I_s = \\frac{${latexName(activeSrc.label)}}{${eqSymbol(subMode)}} = \\frac{${val(srcVal)}}{${term(root.z)}} = ${val(iSrc)}\\text{ A}`
				);
			} else if (srcVal && activeSrc.kind === 'current_source') {
				// A current source pushes its current out of pin 1, into the network, and takes it back at pin 0.
				iSrc = srcVal;
				entry = red.portQ;
				srcLine.push(`I_s = ${latexName(activeSrc.label)} = ${val(srcVal)}\\text{ A}`);
			}
			const sourceAgrees =
				iSrc !== undefined &&
				srcBranch !== undefined &&
				Math.abs(iSrc.abs() - srcBranch.current.abs()) <=
					1e-6 * Math.max(iSrc.abs(), srcBranch.current.abs()) + 1e-12;

			if (iSrc && sourceAgrees) {
				const idle = [...red.dangling, ...red.shorted].map((e) => latexSub(e.label));
				const notes =
					idle.length > 0
						? [`\\text{${idle.join(', ')} ${idle.length === 1 ? 'carries' : 'carry'} no current}`]
						: [];
				const head = [...notes, reqLatex(root, subMode, eqSymbol(subMode)), ...srcLine];

				if (!target || !br) {
					lines.push(...head);
					return { lines };
				}

				chain.push(...head);
				const zT = PASSIVE_KINDS.has(target.kind)
					? getPassiveImpedance(target, subMode, a.subDoc.frequencyHz)
					: null;
				const zName = target.kind === 'resistor' ? tn : `Z_{${latexSub(target.label)}}`;
				let iT: Complex | undefined;
				if (zT && !zT.isZero(1e-12)) {
					const walk = walkToTarget({
						root,
						entry,
						current: iSrc,
						currentName: 'I_s',
						targetId: target.id,
						finalName: iName,
						mode: subMode
					});
					if (walk && closeTo(walk.current, br.current)) {
						chain.push(...walk.lines);
						if (walk.reversed) {
							chain.push(
								`${iName} = -${walk.name} = ${val(walk.current)}\\text{ A}`,
								`\\text{(${latexSub(target.label)} carries it against its arrow, so it is negative)}`
							);
						} else if (walk.name !== iName) {
							chain.push(`${iName} = ${walk.name} = ${val(walk.current)}\\text{ A}`);
						}
						iT = walk.current;
					} else if (
						!walk &&
						[...red.dangling, ...red.shorted].some((e) => e.id === target.id) &&
						closeTo(Complex.zero(), br.current)
					) {
						chain.push(`${iName} = 0\\text{ A}`);
						iT = Complex.zero();
					}
					if (iT) {
						const vT = iT.mul(zT);
						if (closeTo(vT, br.voltage)) {
							chain.push(
								`${vName} = ${iName} ${zName} = ${term(iT)} \\cdot ${term(zT)} = ${val(vT)}\\text{ V}`
							);
							chainI = iT;
							chainV = vT;
							ok = true;
						}
					}
				}
			}
		}

	} catch {
		// Never throw: drop the chain and fall back for this part.
		ok = false;
		chain.length = 0;
	}
	if (ok) {
		lines.push(...chain);
		return { lines, i: chainI, v: chainV };
	}
	if (!target || !br) return { lines };

	// Fallback for this part: node equations of the sub-circuit, then the target from the solution.
	lines.push("\\text{This part isn't a series–parallel circuit, so solve it by nodal analysis:}");
	const nodal = nodalFallbackLines(a.subDoc, subSol);
	if (nodal) {
		lines.push(...nodal);
	} else {
		for (const [nid, nr] of Object.entries(subSol.nodeVoltages)) {
			if (nr.isReference) continue;
			lines.push(`V_{${latexNodeId(nid)}} = ${val(nr.voltage)}\\text{ V}`);
		}
	}
	lines.push(`${iName} = ${val(br.current)}\\text{ A}`, `${vName} = ${val(br.voltage)}\\text{ V}`);
	return { lines, i: br.current, v: br.voltage };
}

export interface SuperpositionOptions {
	/** Passive two-terminal element every part works toward (its current and voltage). */
	targetComponentId?: string;
}

export function solveSuperposition(
	doc: CircuitDocument,
	mna: MnaSolution,
	options: SuperpositionOptions = {}
): MethodResult {
	const title = 'Superposition Theorem';
	if (!mna.valid) {
		return {
			methodId: 'superposition',
			title,
			applicable: false,
			inapplicableReason: 'Circuit has topology or value errors; fix validation errors first.',
			steps: []
		};
	}

	const redundantReason = getRedundantSourceInapplicableReason(mna);
	if (redundantReason) {
		return {
			methodId: 'superposition',
			title,
			applicable: false,
			inapplicableReason: redundantReason,
			steps: []
		};
	}

	const origGraph = buildElectricalGraph(doc);
	const sources: CircuitComponent[] = doc.components.filter(
		(c) => c.kind === 'voltage_source' || c.kind === 'current_source'
	);

	if (sources.length === 0) {
		return {
			methodId: 'superposition',
			title,
			applicable: true,
			steps: [
				{
					title: 'No Independent Sources',
					description:
						'The circuit contains zero independent sources, so all node voltages and branch currents are 0.',
					latex: ['V_n = 0\\text{ V},\\quad I_b = 0\\text{ A}']
				}
			],
			summaryLatex: 'V_n = 0\\text{ V}',
			verifiedAgainstMna: true,
			maxDiscrepancy: 0
		};
	}

	const sourceFreq = (s: CircuitComponent): number =>
		mna.mode === 'dc' ? 0 : s.frequencyHz ?? mna.frequencyHz;

	const distinctFreqs = new Set(sources.map(sourceFreq));
	const isMultiFreq = mna.mode === 'ac' && distinctFreqs.size > 1;

	const twoTerminal = doc.components.filter(
		(c) => c.kind !== 'ground' && c.kind !== 'terminal'
	);

	const totalNodeV: Record<string, Complex> = {};
	for (const nid of Object.keys(origGraph.nodes)) totalNodeV[nid] = Complex.zero();
	const totalBranchV: Record<string, Complex> = {};
	const totalBranchI: Record<string, Complex> = {};
	for (const comp of twoTerminal) {
		totalBranchV[comp.id] = Complex.zero();
		totalBranchI[comp.id] = Complex.zero();
	}

	const target =
		!isMultiFreq && options.targetComponentId
			? twoTerminal.find(
					(c) =>
						c.id === options.targetComponentId &&
						c.kind !== 'voltmeter' &&
						// An independent source is switched off in some parts, so it can't be the
						// element we work toward; the Ans. step still reports it.
						c.kind !== 'voltage_source' &&
						c.kind !== 'current_source' &&
						mna.branches[c.id] !== undefined
				)
			: undefined;
	const partI: Complex[] = [];
	const partV: Complex[] = [];

	const dependentSources = doc.components.filter((c) => isDependentSourceKind(c.kind));
	const depLabels = dependentSources.map((d) => d.label).join(', ');
	const depRuleNote =
		dependentSources.length > 0
			? ` Dependent source(s) (${depLabels}) are NEVER deactivated and remain active in every sub-circuit.`
			: '';

	const steps: SolutionStep[] = [
		{
			title: '1. Identify Independent Sources',
			description: `Found ${sources.length} independent source(s). Solve one independent source at a time while zeroing other independent voltage sources (short circuit) and opening other independent current sources.${depRuleNote}`,
			latex: sources.map((s) => {
				const subMode = sourceFreq(s) === 0 ? 'dc' : mna.mode;
				const val = parseSourceValue(s, subMode)!;
				const sym = s.kind === 'voltage_source' ? 'V' : 'I';
				const unit = s.kind === 'voltage_source' ? 'V' : 'A';
				const fNote = isMultiFreq ? `\\;(f = ${sourceFreq(s)}\\text{ Hz})` : '';
				return `${sym}_{${latexSub(s.label)}} = ${formatLatexValue(val, subMode)}\\text{ ${unit}}${fNote}`;
			})
		}
	];

	// Per-frequency phasors for multi-frequency AC time-domain synthesis
	const perFreqNodePhasors = new Map<number, Record<string, Complex>>();
	let multiFreqMaxSubDiscrepancy = 0;

	for (let k = 0; k < sources.length; k++) {
		const activeSrc = sources[k];
		const fK = sourceFreq(activeSrc);
		const subMode = mna.mode === 'ac' && fK === 0 ? 'dc' : mna.mode;
		const rawSubDoc = buildDeactivatedDocument(
			doc,
			activeSrc.id,
			subMode,
			subMode === 'dc' ? doc.frequencyHz : fK
		);
		const subDoc = remapDependentControlNodes(origGraph, rawSubDoc);
		const subGraph = buildElectricalGraph(subDoc);
		const subSol = solveMNA(subDoc, {
			frequencyHz: subDoc.frequencyHz,
			acMagnitudeMode: mna.acMagnitudeMode
		});

		if (!subSol.valid) {
			return {
				methodId: 'superposition',
				title,
				applicable: false,
				inapplicableReason: `Sub-circuit with only ${activeSrc.label} active could not be solved (${subSol.diagnostics.find((d) => d.severity === 'error')?.message ?? 'singular'}).`,
				steps
			};
		}

		const subNodesMapped = mapSubNodesToOriginal(origGraph, subGraph, subSol);

		if (isMultiFreq) {
			if (!perFreqNodePhasors.has(fK)) {
				const initMap: Record<string, Complex> = {};
				for (const nid of Object.keys(origGraph.nodes)) initMap[nid] = Complex.zero();
				perFreqNodePhasors.set(fK, initMap);
			}
			const freqBucket = perFreqNodePhasors.get(fK)!;
			for (const nid of origGraph.nonRefNodeIds) {
				freqBucket[nid] = freqBucket[nid].add(subNodesMapped[nid]);
			}
			// Verify sub-circuit against its own MNA solve
			if (!subSol.powerBalance.balanced) {
				multiFreqMaxSubDiscrepancy = Math.max(
					multiFreqMaxSubDiscrepancy,
					Math.abs(subSol.powerBalance.totalRealPower)
				);
			}
		} else {
			for (const nid of origGraph.nonRefNodeIds) {
				totalNodeV[nid] = totalNodeV[nid].add(subNodesMapped[nid]);
			}
			for (const comp of twoTerminal) {
				const [nA, nB] = origGraph.componentNodes[comp.id];
				const brSub = subSol.branches[comp.id];
				const vSub = brSub
					? brSub.voltage
					: subNodesMapped[nA].sub(subNodesMapped[nB]);
				const iSub = brSub ? brSub.current : Complex.zero();
				totalBranchV[comp.id] = totalBranchV[comp.id].add(vSub);
				totalBranchI[comp.id] = totalBranchI[comp.id].add(iSub);
			}
		}

		const contribLatex = origGraph.nonRefNodeIds.map(
			(nid) =>
				`V_{${latexNodeId(nid)}}^{(${k + 1})} = ${formatLatexValue(subNodesMapped[nid], subMode)}\\text{ V}`
		);
		const branchContribLatex = twoTerminal.slice(0, 4).map((c) => {
			const br = subSol.branches[c.id];
			const iVal = br ? br.current : Complex.zero();
			return `I_{${latexSub(c.label)}}^{(${k + 1})} = ${formatLatexValue(iVal, subMode)}\\text{ A}`;
		});

		if (isMultiFreq) {
			steps.push({
				title: `${k + 2}. Contribution of ${activeSrc.label} Alone`,
				description: `Keep ${activeSrc.label} active at f = ${fK} Hz${dependentSources.length > 0 ? ` (with dependent source(s) ${depLabels} active)` : ''}; deactivate all other independent sources.`,
				latex: [...contribLatex, ...branchContribLatex],
				highlightIds: [activeSrc.id]
			});
			continue;
		}

		const work = workPart({
			k,
			activeSrc,
			sources,
			subDoc,
			subGraph,
			subSol,
			subMode,
			hasDependent: dependentSources.length > 0,
			target
		});
		if (target && work.i && work.v) {
			partI.push(work.i);
			partV.push(work.v);
		}
		const intro =
			sources.length > 1
				? `Keep ${activeSrc.label} on and turn the other sources off${target ? `, then find ${target.label}` : ''}.`
				: `Keep ${activeSrc.label} on${target ? ` and find ${target.label}` : ''}.`;
		steps.push({
			title: `${k + 2}. Part ${primeTitle(k)}: ${activeSrc.label} Alone`,
			description:
				dependentSources.length > 0
					? `${intro} The dependent source(s) ${depLabels} stay on.`
					: intro,
			latex:
				target && work.i ? work.lines : [...work.lines, ...contribLatex, ...branchContribLatex],
			highlightIds: [activeSrc.id]
		});
	}

	if (isMultiFreq) {
		const peakScale = mna.acMagnitudeMode === 'rms' ? Math.SQRT2 : 1;
		const rmsScale = mna.acMagnitudeMode === 'rms' ? 1 : 1 / Math.SQRT2;
		const timeDomainLatex: string[] = [];

		for (const nid of origGraph.nonRefNodeIds) {
			const terms: string[] = [];
			let rmsSqSum = 0;

			for (const [fK, nodeMap] of perFreqNodePhasors.entries()) {
				const phasor = nodeMap[nid];
				if (phasor.isZero(1e-12)) continue;

				if (fK === 0) {
					terms.push(formatLatexValue(phasor, 'dc'));
					rmsSqSum += phasor.re * phasor.re;
				} else {
					const amp = phasor.abs() * peakScale;
					const deg = phasor.argDeg();
					const omega = 2 * Math.PI * fK;
					const ampStr = formatLatexValue(Complex.from(amp, 0), 'ac');
					const wStr = formatLatexValue(Complex.from(omega, 0), 'ac');
					const degStr = formatLatexValue(Complex.from(deg, 0), 'ac');
					const phasePart =
						Math.abs(deg) < 1e-9
							? ''
							: deg >= 0
								? ` + ${degStr}^\\circ`
								: ` - ${formatLatexValue(Complex.from(-deg, 0), 'ac')}^\\circ`;
					terms.push(`${ampStr}\\cos(${wStr}t${phasePart})`);
					const rmsMag = phasor.abs() * rmsScale;
					rmsSqSum += rmsMag * rmsMag;
				}
			}

			const rmsTotal = Math.sqrt(rmsSqSum);
			const rhsExpr = terms.join(' + ') || '0';
			timeDomainLatex.push(
				`v_{${latexNodeId(nid)}}(t) = ${rhsExpr}\\text{ V},\\quad V_{${latexNodeId(nid)},\\text{rms}} = ${formatLatexValue(Complex.from(rmsTotal, 0), 'ac')}\\text{ V}`
			);
		}

		steps.push({
			title: `${sources.length + 2}. Multi-Frequency Time-Domain Combination`,
			description:
				'Phasors at different frequencies cannot be added directly; combine each frequency component in the time domain and compute true RMS.',
			latex: timeDomainLatex
		});

		return {
			methodId: 'superposition',
			title,
			applicable: true,
			steps,
			summaryLatex: timeDomainLatex.slice(0, 3).join(' \\\\ '),
			verifiedAgainstMna: multiFreqMaxSubDiscrepancy < 1e-8,
			maxDiscrepancy: multiFreqMaxSubDiscrepancy
		};
	}

	// Same-frequency combination & MNA cross-verification
	const sumLatex = [
		...origGraph.nonRefNodeIds.map(
			(nid) => `V_{${latexNodeId(nid)}} = \\sum_k V_{${latexNodeId(nid)}}^{(k)} = ${formatLatexValue(totalNodeV[nid], mna.mode)}\\text{ V}`
		),
		...twoTerminal.slice(0, 4).map(
			(c) =>
				`I_{${latexSub(c.label)}} = \\sum_k I_{${latexSub(c.label)}}^{(k)} = ${formatLatexValue(totalBranchI[c.id], mna.mode)}\\text{ A}`
		)
	];

	const targetSum =
		target && partI.length === sources.length && partV.length === sources.length
			? (() => {
					const tn = latexName(target.label);
					const term = (c: Complex) => formatLatexTerm(c, mna.mode);
					const sumLine = (sym: 'I' | 'V', parts: Complex[], total: Complex, unit: string) =>
						`${sym}_{${tn}} = ${parts.map((_, k) => `${sym}${primeTex(k)}_{${tn}}`).join(' + ')} = ${
							parts.length > 1 ? `${parts.map(term).join(' + ')} = ` : ''
						}${formatLatexValue(total, mna.mode)}\\text{ ${unit}}`;
					return [
						sumLine('I', partI, totalBranchI[target.id], 'A'),
						sumLine('V', partV, totalBranchV[target.id], 'V')
					];
				})()
			: undefined;

	steps.push({
		title: `${sources.length + 2}. Superposition Sum`,
		description: targetSum
			? `Add the parts to get the current and voltage of ${target!.label}.`
			: 'Sum individual source responses to obtain total node voltages and branch currents.',
		latex: targetSum ?? sumLatex
	});

	const verification = verifyAgainstMna(mna, {
		nodeVoltages: totalNodeV,
		branchVoltages: totalBranchV,
		branchCurrents: totalBranchI
	});

	return {
		methodId: 'superposition',
		title,
		applicable: true,
		steps,
		summaryLatex: (targetSum ?? sumLatex).slice(0, 4).join(' \\\\ '),
		...verification
	};
}
