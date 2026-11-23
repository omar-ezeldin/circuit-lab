/**
 * Method 6: Thévenin & Norton Equivalent Circuit Solver.
 *
 * Supports target selection via:
 *   - `{ kind: 'component', componentId }` (removes load component and looks into its pins)
 *   - `{ kind: 'terminals', nodeA, nodeB }`
 *   - Auto-detection of `'terminal'` components (`A`, `B`) or last passive load resistor
 *
 * Computes V_th (open-circuit voltage), Z_th (hidden 1 A test-source reference; shown as R_eq or V_oc/I_sc when the course method applies),
 * I_N (short-circuit current = V_th / Z_th), load current/voltage verification vs MNA (< 1e-8),
 * and Maximum Power Transfer theorem (Z_L,opt = Z_th*, P_max).
 */

import { Complex } from '../complex';
import { buildElectricalGraph, latexNodeId } from '../graph';
import { solveMNA } from '../mna';
import {
	isDependentSourceKind,
	type CircuitComponent,
	type CircuitDocument,
	type MaxPowerTransferInfo,
	type MethodResult,
	type MnaSolution,
	type SolutionStep,
	type TheveninNortonResult,
	type TheveninTarget
} from '../types';
import {
	buildDeactivatedDocument,
	buildPortTestWires,
	formatLatexTerm,
	formatLatexValue,
	getPassiveImpedance,
	latexSub,
	MNA_VERIFICATION_TOL,
	remapDependentControlNodes
} from './shared';
import {
	reduceSeriesParallel,
	reqLatex,
	type SpEdge,
	type SpReduction
} from './sp-reduce';

const PASSIVE_KINDS = new Set(['resistor', 'capacitor', 'inductor']);

/** Equal within 1e-6 relative (plus a tiny absolute floor for zeros). */
function closeTo(a: Complex, b: Complex): boolean {
	return a.sub(b).abs() <= 1e-6 * Math.max(a.abs(), b.abs()) + 1e-12;
}

/**
 * Series-parallel reduction of the killed network seen from A-B (independent sources only).
 * Killed voltage sources are wires, killed current sources are dropped (open).
 */
function reduceKilledNetwork(
	killedDoc: CircuitDocument,
	graph: ReturnType<typeof buildElectricalGraph>,
	mode: CircuitDocument['mode'],
	freq: number,
	ports: [string, string]
): SpReduction | undefined {
	const edges: SpEdge[] = [];
	const shorts: Array<[string, string]> = [];
	for (const comp of killedDoc.components) {
		const nodes = graph.componentNodes[comp.id];
		if (!nodes || nodes.length < 2) continue;
		if (PASSIVE_KINDS.has(comp.kind)) {
			const z = getPassiveImpedance(comp, mode, freq);
			edges.push({
				id: comp.id,
				label: comp.label,
				...(comp.kind === 'resistor' ? {} : { name: `Z_{${latexSub(comp.label)}}` }),
				nodeA: nodes[0],
				nodeB: nodes[1],
				z: z ?? Complex.from(Infinity, 0)
			});
		} else if (comp.kind === 'voltage_source') {
			shorts.push([nodes[0], nodes[1]]);
		}
	}
	return reduceSeriesParallel({ edges, shorts, ports });
}

function mapOriginalNodeToSubGraph(
	origGraph: ReturnType<typeof buildElectricalGraph>,
	subGraph: ReturnType<typeof buildElectricalGraph>,
	origNodeId: string
): string | null {
	const origNode = origGraph.nodes[origNodeId];
	if (!origNode) return null;
	for (const gp of origNode.gridPoints) {
		for (const [subId, subNode] of Object.entries(subGraph.nodes)) {
			if (subNode.gridPoints.some((p) => p.x === gp.x && p.y === gp.y)) {
				return subId;
			}
		}
	}
	return null;
}

export function resolveTheveninTarget(
	doc: CircuitDocument,
	target?: TheveninTarget
): TheveninTarget | null {
	if (target) return target;

	const graph = buildElectricalGraph(doc);
	const terminals = doc.components.filter((c) => c.kind === 'terminal');
	if (terminals.length >= 2) {
		const termA =
			terminals.find((t) => t.terminalName?.toUpperCase() === 'A') ?? terminals[0];
		const termB =
			terminals.find((t) => t.terminalName?.toUpperCase() === 'B' && t.id !== termA.id) ??
			terminals[1];
		const nodeA = graph.componentNodes[termA.id]?.[0];
		const nodeB = graph.componentNodes[termB.id]?.[0];
		if (nodeA && nodeB && nodeA !== nodeB) {
			return { kind: 'terminals', nodeA, nodeB };
		}
	}

	// Avoid auto-selecting a passive component that is sensed as a controlling variable by a dependent source
	const sensedIds = new Set<string>();
	for (const c of doc.components) {
		if (!isDependentSourceKind(c.kind) || !c.controlRef) continue;
		if (c.controlRef.controlComponentId) sensedIds.add(c.controlRef.controlComponentId);
		if (c.controlRef.controlBranchComponentId) sensedIds.add(c.controlRef.controlBranchComponentId);
	}

	const resistors = doc.components.filter((c) => c.kind === 'resistor');
	const nonSensedResistors = resistors.filter((r) => !sensedIds.has(r.id));
	if (nonSensedResistors.length > 0) {
		return {
			kind: 'component',
			componentId: nonSensedResistors[nonSensedResistors.length - 1].id
		};
	}
	if (resistors.length > 0) {
		return { kind: 'component', componentId: resistors[resistors.length - 1].id };
	}

	const passives = doc.components.filter(
		(c) => c.kind === 'capacitor' || c.kind === 'inductor'
	);
	const nonSensedPassives = passives.filter((p) => !sensedIds.has(p.id));
	if (nonSensedPassives.length > 0) {
		return {
			kind: 'component',
			componentId: nonSensedPassives[nonSensedPassives.length - 1].id
		};
	}
	if (passives.length > 0) {
		return { kind: 'component', componentId: passives[passives.length - 1].id };
	}

	return null;
}

export function solveTheveninNorton(
	doc: CircuitDocument,
	mna: MnaSolution,
	target?: TheveninTarget
): { methodResult: MethodResult; theveninNorton?: TheveninNortonResult } {
	const title = 'Thévenin & Norton Equivalent';
	if (!mna.valid) {
		return {
			methodResult: {
				methodId: 'thevenin_norton',
				title,
				applicable: false,
				inapplicableReason: 'Circuit has topology or value errors; fix validation errors first.',
				steps: []
			}
		};
	}

	const resolvedTarget = resolveTheveninTarget(doc, target);
	if (!resolvedTarget) {
		return {
			methodResult: {
				methodId: 'thevenin_norton',
				title,
				applicable: false,
				inapplicableReason: 'No load component or terminal pair (A, B) found for Thévenin port.',
				steps: []
			}
		};
	}

	const origGraph = buildElectricalGraph(doc);
	const mode = mna.mode;
	const freq = mna.frequencyHz;
	// Course notation: R in DC, Z in AC.
	const Z = mode === 'dc' ? 'R' : 'Z';

	let loadComp: CircuitComponent | undefined;
	let origNodeA: string;
	let origNodeB: string;

	if (resolvedTarget.kind === 'component') {
		loadComp = doc.components.find((c) => c.id === resolvedTarget.componentId);
		if (!loadComp || !origGraph.componentNodes[loadComp.id]) {
			return {
				methodResult: {
					methodId: 'thevenin_norton',
					title,
					applicable: false,
					inapplicableReason: `Target component "${resolvedTarget.componentId}" not found.`,
					steps: []
				}
			};
		}
		if (
			loadComp.kind === 'voltage_source' ||
			loadComp.kind === 'current_source' ||
			isDependentSourceKind(loadComp.kind)
		) {
			return {
				methodResult: {
					methodId: 'thevenin_norton',
					title,
					applicable: false,
					inapplicableReason: `${loadComp.label} is a source, not a load. Pick the load element (or place port terminals A and B) to find the Thévenin equivalent seen by it.`,
					steps: []
				}
			};
		}
		[origNodeA, origNodeB] = origGraph.componentNodes[loadComp.id];
	} else {
		origNodeA = resolvedTarget.nodeA;
		origNodeB = resolvedTarget.nodeB;
		if (!origGraph.nodes[origNodeA] || !origGraph.nodes[origNodeB]) {
			return {
				methodResult: {
					methodId: 'thevenin_norton',
					title,
					applicable: false,
					inapplicableReason: `Terminal nodes "${origNodeA}" / "${origNodeB}" not found.`,
					steps: []
				}
			};
		}
	}

	// Build open-circuit network (without loadComp if targeting a component)
	const rawOpenDoc: CircuitDocument = loadComp
		? { ...doc, components: doc.components.filter((c) => c.id !== loadComp!.id) }
		: doc;
	const openDoc = remapDependentControlNodes(origGraph, rawOpenDoc);
	const openGraph = buildElectricalGraph(openDoc);
	const openSol = solveMNA(openDoc, {
		frequencyHz: freq,
		acMagnitudeMode: mna.acMagnitudeMode
	});

	if (!openSol.valid) {
		return {
			methodResult: {
				methodId: 'thevenin_norton',
				title,
				applicable: false,
				inapplicableReason: `Removing ${loadComp?.label ?? 'load'} splits or invalidates the remaining circuit (${openSol.diagnostics.find((d) => d.severity === 'error')?.message ?? 'unsolvable'}).`,
				steps: []
			}
		};
	}

	const openNodeA = mapOriginalNodeToSubGraph(origGraph, openGraph, origNodeA);
	const openNodeB = mapOriginalNodeToSubGraph(origGraph, openGraph, origNodeB);
	if (!openNodeA || !openNodeB) {
		return {
			methodResult: {
				methodId: 'thevenin_norton',
				title,
				applicable: false,
				inapplicableReason: 'Open-circuit terminals became disconnected when load was removed.',
				steps: []
			}
		};
	}

	// 1. Open-circuit voltage V_th = V_A - V_B
	const vAOpen = openSol.nodeVoltages[openNodeA]?.voltage ?? Complex.zero();
	const vBOpen = openSol.nodeVoltages[openNodeB]?.voltage ?? Complex.zero();
	const vth = vAOpen.sub(vBOpen);

	// 2. Equivalent impedance Z_th via Test-Source Method on deactivated network
	//    (ONLY independent sources are deactivated; ALL dependent sources remain active!)
	const dependentSources = openDoc.components.filter((c) => isDependentSourceKind(c.kind));
	const deactivatedDoc = remapDependentControlNodes(
		openGraph,
		buildDeactivatedDocument(openDoc, null)
	);
	// Find grid coordinates for openNodeA and openNodeB in openGraph
	const ptA = openGraph.nodes[openNodeA].gridPoints[0];
	const ptB = openGraph.nodes[openNodeB].gridPoints[0];

	// Synthetic 1 A test current source far from the schematic; buildPortTestWires routes its
	// wires so they cannot pass through (and merge with) any other pin on the way.
	const testComp: CircuitComponent = {
		id: '__thevenin_itest__',
		kind: 'current_source',
		label: 'I_test',
		x: 1000003,
		y: 1000019,
		rotation: 0, // pin0 at (1000001, 1000019) -> B, pin1 at (1000005, 1000019) -> A
		value: '1'
	};
	const testDoc: CircuitDocument = remapDependentControlNodes(openGraph, {
		...deactivatedDoc,
		components: [...deactivatedDoc.components, testComp],
		wires: [
			...deactivatedDoc.wires,
			...buildPortTestWires(
				'__thevenin_',
				{ x: 1000001, y: 1000019 },
				ptB,
				{ x: 1000005, y: 1000019 },
				ptA
			)
		]
	});

	const testGraph = buildElectricalGraph(testDoc);
	const testSol = solveMNA(testDoc, {
		frequencyHz: freq,
		acMagnitudeMode: mna.acMagnitudeMode
	});

	let zth: Complex | null = null;
	let usedVoltageTestSource = false;
	if (testSol.valid) {
		const [tNodeB, tNodeA] = testGraph.componentNodes[testComp.id];
		const vTestA = testSol.nodeVoltages[tNodeA]?.voltage ?? Complex.zero();
		const vTestB = testSol.nodeVoltages[tNodeB]?.voltage ?? Complex.zero();
		zth = vTestA.sub(vTestB); // I_test = 1 A into A, out of B => Z_th = V_A - V_B
	} else {
		// Fallback: apply a 1 V test voltage source from A (+) to B (-) and compute Z_th = 1 V / I_into_A
		const vTestComp: CircuitComponent = {
			id: '__thevenin_vtest__',
			kind: 'voltage_source',
			label: 'V_test',
			x: 1000003,
			y: 1000019,
			rotation: 0, // pin0 (+) -> A, pin1 (-) -> B
			value: '1'
		};
		const vTestDoc: CircuitDocument = remapDependentControlNodes(openGraph, {
			...deactivatedDoc,
			components: [...deactivatedDoc.components, vTestComp],
			wires: [
				...deactivatedDoc.wires,
				{ id: '__thevenin_wA__', points: [{ x: 1000001, y: 1000019 }, ptA] },
				{ id: '__thevenin_wB__', points: [{ x: 1000005, y: 1000019 }, ptB] }
			]
		});
		const vTestSol = solveMNA(vTestDoc, {
			frequencyHz: freq,
			acMagnitudeMode: mna.acMagnitudeMode
		});
		if (vTestSol.valid && vTestSol.branches[vTestComp.id]) {
			// Passive sign convention: I_vtest flows + -> - (A -> B inside source), so current into network at A is -I_vtest
			const iIntoA = vTestSol.branches[vTestComp.id].current.neg();
			if (!iIntoA.isZero(1e-12)) {
				zth = Complex.one().div(iIntoA);
				usedVoltageTestSource = true;
			}
		}
	}

	// Course methods (display only; the test-source zth above stays the reference value).
	//   case 1: independent sources only -> kill them, R_th = R_eq by series/parallel
	//   case 2: independent + dependent  -> R_th = V_oc / I_sc (short A-B)
	//   case 3: dependent sources only   -> test source (the value computed above)
	const hasIndependent = openDoc.components.some(
		(c) => c.kind === 'voltage_source' || c.kind === 'current_source'
	);
	let reqReduction: SpReduction | undefined;
	let iscShort: Complex | null = null;
	if (zth !== null && dependentSources.length === 0) {
		try {
			const red = reduceKilledNetwork(deactivatedDoc, openGraph, mode, freq, [
				openNodeA,
				openNodeB
			]);
			if (red?.ok && red.root && closeTo(red.root.z, zth)) reqReduction = red;
		} catch {
			reqReduction = undefined;
		}
	} else if (zth !== null && hasIndependent && dependentSources.length > 0) {
		try {
			// 0 V source across A-B (pin0 + at A, pin1 - at B): its branch current runs A -> B
			// through the short, which is exactly I_sc.
			const shortComp: CircuitComponent = {
				id: '__thevenin_isc__',
				kind: 'voltage_source',
				label: 'V_short',
				x: 1000003,
				y: 1000019,
				rotation: 0,
				value: '0'
			};
			const shortDoc: CircuitDocument = remapDependentControlNodes(openGraph, {
				...openDoc,
				components: [...openDoc.components, shortComp],
				wires: [
					...openDoc.wires,
					...buildPortTestWires(
						'__thevenin_sc_',
						{ x: 1000001, y: 1000019 },
						ptA,
						{ x: 1000005, y: 1000019 },
						ptB
					)
				]
			});
			const shortSol = solveMNA(shortDoc, {
				frequencyHz: freq,
				acMagnitudeMode: mna.acMagnitudeMode
			});
			const br = shortSol.valid ? shortSol.branches[shortComp.id] : undefined;
			if (br) {
				const i = br.current;
				if (
					i.abs() > 1e-12 &&
					vth.abs() > 1e-12 &&
					closeTo(vth.div(i), zth)
				) {
					iscShort = i;
				}
			}
		} catch {
			iscShort = null;
		}
	}

	// 3. Norton Short-Circuit Current I_N
	let isc: Complex | null = null;
	if (zth !== null) {
		if (!zth.isZero(1e-12)) {
			isc = vth.div(zth);
		} else if (vth.isZero(1e-12)) {
			isc = Complex.zero();
		}
		// If zth == 0 and vth != 0, short-circuit current is infinite (isc stays null)
	} else {
		// Open-circuit impedance Z_th = infinity => short-circuit current I_N = 0 (or test via 0V short)
		isc = Complex.zero();
	}

	// 4. Load Verification against full MNA
	let maxDiscrepancy = 0;
	let verifiedAgainstMna = true;
	const verifyLatex: string[] = [];

	if (loadComp) {
		const mnaBr = mna.branches[loadComp.id];
		let iLoad: Complex;
		let vLoad: Complex;

		if (zth === null) {
			// Infinite Z_th (open port) -> I_L = 0
			iLoad = Complex.zero();
			vLoad = vth;
		} else if (mode === 'dc' && loadComp.kind === 'capacitor') {
			iLoad = Complex.zero();
			vLoad = vth;
		} else {
			const zLoad = getPassiveImpedance(loadComp, mode, freq);
			if (zLoad !== null) {
				const denom = zth.add(zLoad);
				if (!denom.isZero(1e-12)) {
					iLoad = vth.div(denom);
					vLoad = iLoad.mul(zLoad);
				} else {
					iLoad = Complex.zero();
					vLoad = Complex.zero();
				}
			} else {
				iLoad = mnaBr.current;
				vLoad = mnaBr.voltage;
			}
		}

		maxDiscrepancy = Math.max(
			iLoad.sub(mnaBr.current).abs(),
			vLoad.sub(mnaBr.voltage).abs()
		);
		verifiedAgainstMna = Number.isFinite(maxDiscrepancy) && maxDiscrepancy < MNA_VERIFICATION_TOL;

		const sub = latexSub(loadComp.label);
		verifyLatex.push(
			`I_{${sub}} = \\frac{V_{th}}{${Z}_{th} + ${Z}_{L}} = ${formatLatexValue(iLoad, mode)}\\text{ A}`,
			`V_{${sub}} = ${formatLatexValue(vLoad, mode)}\\text{ V}`
		);
	} else {
		// Terminal port check: compare V_th directly against MNA V_A - V_B
		const vMnaPort = (mna.nodeVoltages[origNodeA]?.voltage ?? Complex.zero()).sub(
			mna.nodeVoltages[origNodeB]?.voltage ?? Complex.zero()
		);
		maxDiscrepancy = vth.sub(vMnaPort).abs();
		verifiedAgainstMna = Number.isFinite(maxDiscrepancy) && maxDiscrepancy < MNA_VERIFICATION_TOL;
	}

	// 5. Maximum Power Transfer
	let maxPowerTransfer: MaxPowerTransferInfo | undefined;
	const maxPowerLatex: string[] = [];
	if (zth !== null && zth.re > 1e-12) {
		const optimalLoadImpedance = mode === 'dc' ? Complex.from(zth.re, 0) : zth.conj();
		const powerScale = mode === 'ac' && mna.acMagnitudeMode === 'peak' ? 0.5 : 1;
		const vMag = vth.abs();
		const maxRealPowerW = (powerScale * vMag * vMag) / (4 * zth.re);
		maxPowerTransfer = { optimalLoadImpedance, maxRealPowerW };
		const pmax = formatLatexValue(Complex.from(maxRealPowerW, 0), mode);
		if (mode === 'dc') {
			maxPowerLatex.push(
				`R_{L} = R_{th} = ${formatLatexValue(optimalLoadImpedance, mode)}\\;\\Omega`,
				`P_{\\max} = \\frac{V_{th}^2}{4R_{th}} = \\frac{${formatLatexTerm(vth, mode)}^2}{4 \\cdot ${formatLatexTerm(zth, mode)}} = ${pmax}\\text{ W}`
			);
		} else {
			maxPowerLatex.push(
				`Z_{L} = Z_{th}^{*} = ${formatLatexValue(optimalLoadImpedance, mode)}\\;\\Omega`,
				`P_{\\max} = ${pmax}\\text{ W}`
			);
		}
	}

	// Step 3: Thevenin resistance / impedance, shown the course way when it applies.
	const thName = `${Z}_{th}`;
	const zthTitle = mode === 'dc' ? 'Thevenin Resistance (R_th)' : 'Thevenin Impedance (Z_th)';
	const testWord = usedVoltageTestSource ? '1 V test voltage source' : '1 A test current source';
	const testLine =
		zth !== null
			? `${thName} = \\frac{V_{test}}{I_{test}} = ${formatLatexValue(zth, mode)}\\;\\Omega`
			: `${thName} = \\infty\\;\\Omega\\;(\\text{open port})`;

	let zthDescription: string;
	let zthLatex: string[];
	if (reqReduction?.root) {
		const killed: string[] = [];
		for (const c of openDoc.components) {
			if (c.kind === 'voltage_source') killed.push(`\\text{${latexSub(c.label)} off} \\to \\text{short}`);
			else if (c.kind === 'current_source')
				killed.push(`\\text{${latexSub(c.label)} off} \\to \\text{open}`);
		}
		zthDescription = `Turn off the independent sources (voltage sources become shorts, current sources become open circuits), then combine the ${mode === 'dc' ? 'resistors' : 'impedances'} seen from the terminals in series and parallel.`;
		zthLatex = [];
		if (killed.length > 0) zthLatex.push(killed.join(',\\; '));
		if (reqReduction.dangling.length > 0) {
			const names = reqReduction.dangling.map((e) => latexSub(e.label)).join(', ');
			zthLatex.push(
				`\\text{${names} ${reqReduction.dangling.length > 1 ? 'carry' : 'carries'} no current}`
			);
		}
		zthLatex.push(reqLatex(reqReduction.root, mode, thName));
	} else if (iscShort !== null && zth !== null) {
		zthDescription = `This circuit has both independent and dependent sources, so short the terminals and find the short-circuit current I_sc. Then ${Z}_th = V_oc / I_sc, with V_oc = V_th from step 2.`;
		zthLatex = [
			`I_{sc} = ${formatLatexValue(iscShort, mode)}\\text{ A}`,
			`${thName} = \\frac{V_{oc}}{I_{sc}} = \\frac{${formatLatexValue(vth, mode)}}{${formatLatexValue(iscShort, mode)}} = ${formatLatexValue(zth, mode)}\\;\\Omega`
		];
	} else {
		if (dependentSources.length > 0 && !hasIndependent) {
			zthDescription = `The only sources are dependent, so there is nothing to turn off. Apply a ${testWord} at the terminals and find ${Z}_th = V_test / I_test.`;
		} else if (dependentSources.length > 0) {
			zthDescription = `Turn off the independent sources and keep the dependent source(s) (${dependentSources.map((d) => d.label).join(', ')}). Apply a ${testWord} at the terminals and find ${Z}_th = V_test / I_test.`;
		} else {
			zthDescription = `This network isn't series–parallel, so apply a ${testWord} at the terminals:`;
		}
		zthLatex = [testLine];
	}

	const iscFromShort = iscShort !== null && reqReduction === undefined;
	const nortonLine =
		isc !== null && zth !== null && !zth.isZero(1e-12)
			? `I_N = \\frac{V_{th}}{${thName}} = \\frac{${formatLatexValue(vth, mode)}}{${formatLatexValue(zth, mode)}} = ${formatLatexValue(isc, mode)}\\text{ A}`
			: isc !== null
				? `I_N = ${formatLatexValue(isc, mode)}\\text{ A}`
				: `I_N = \\infty\\text{ A}\\;(\\text{ideal zero-impedance source})`;

	const steps: SolutionStep[] = [
		{
			title: '1. Remove the Load',
			description: loadComp
				? `Remove the load ${loadComp.label}. Its ends are the open terminals, nodes ${origNodeA} and ${origNodeB}.`
				: `The open terminals are nodes ${origNodeA} and ${origNodeB}.`,
			highlightIds: loadComp ? [loadComp.id] : undefined
		},
		{
			title: '2. Open-Circuit Voltage (V_th)',
			description: 'Remove the load and find the voltage across the terminals.',
			latex: [
				`V_{th} = V_{${latexNodeId(origNodeA)}} - V_{${latexNodeId(origNodeB)}} = ${formatLatexValue(vth, mode)}\\text{ V}`
			]
		},
		{
			title: `3. ${zthTitle}`,
			description: zthDescription,
			latex: zthLatex
		},
		{
			title: '4. Norton Current (I_N)',
			description: iscFromShort
				? `The Norton current is the short-circuit current, I_N = I_sc = V_th / ${Z}_th.`
				: `The Norton current is I_N = V_th / ${Z}_th.`,
			latex: [nortonLine]
		}
	];

	if (verifyLatex.length > 0) {
		steps.push({
			title: '5. Reconnect the Load',
			description: `Reconnected ${loadComp!.label} to the Thévenin equivalent and checked the result against the full circuit solution.`,
			latex: verifyLatex
		});
	}

	if (maxPowerLatex.length > 0) {
		steps.push({
			title: `${steps.length + 1}. Maximum Power Transfer`,
			description:
				mode === 'dc'
					? 'Maximum power is delivered when the load equals the Thévenin resistance.'
					: 'Maximum real power is delivered when the load equals the complex conjugate Z_th*.',
			latex: maxPowerLatex
		});
	}

	const summaryParts = [
		`V_{th} &= ${formatLatexValue(vth, mode)}\\text{ V}`,
		zth !== null ? `${thName} &= ${formatLatexValue(zth, mode)}\\;\\Omega` : `${thName} &= \\infty`,
		isc !== null ? `I_N &= ${formatLatexValue(isc, mode)}\\text{ A}` : 'I_N &= \\infty'
	];

	return {
		methodResult: {
			methodId: 'thevenin_norton',
			title,
			applicable: true,
			steps,
			summaryLatex: `\\begin{aligned} ${summaryParts.join(' \\\\ ')} \\end{aligned}`,
			verifiedAgainstMna,
			maxDiscrepancy
		},
		theveninNorton: {
			terminalA: origNodeA,
			terminalB: origNodeB,
			loadComponentId: loadComp?.id,
			vth,
			isc,
			zth,
			maxPowerTransfer,
			verifiedAgainstMna,
			maxDiscrepancy,
			steps
		}
	};
}
