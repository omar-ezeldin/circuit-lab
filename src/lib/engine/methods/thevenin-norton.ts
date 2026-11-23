/**
 * Method 6: Thévenin & Norton Equivalent Circuit Solver.
 *
 * Supports target selection via:
 *   - `{ kind: 'component', componentId }` (removes load component and looks into its pins)
 *   - `{ kind: 'terminals', nodeA, nodeB }`
 *   - Auto-detection of `'terminal'` components (`A`, `B`) or last passive load resistor
 *
 * Computes V_th (open-circuit voltage), Z_th (1 A test-source with deactivated sources),
 * I_N (short-circuit current = V_th / Z_th), load current/voltage verification vs MNA (< 1e-8),
 * and Maximum Power Transfer theorem (Z_L,opt = Z_th*, P_max).
 */

import { Complex } from '../complex';
import { buildElectricalGraph } from '../graph';
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
	formatLatexValue,
	getPassiveImpedance,
	latexSub,
	MNA_VERIFICATION_TOL,
	remapDependentControlNodes
} from './shared';

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
			`I_{${sub}} = \\frac{V_{th}}{Z_{th} + Z_{${sub}}} = ${formatLatexValue(iLoad, mode)}\\text{ A}`,
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
		maxPowerLatex.push(
			`${mode === 'dc' ? 'R' : 'Z'}_{L,\\text{opt}} = ${formatLatexValue(optimalLoadImpedance, mode)}\\;\\Omega`,
			`P_{\\max} = ${formatLatexValue(Complex.from(maxRealPowerW, 0), mode)}\\text{ W}`
		);
	}

	const steps: SolutionStep[] = [
		{
			title: '1. Port Selection & Load Removal',
			description: loadComp
				? `Removed load component ${loadComp.label} to expose open terminals A (${origNodeA}) and B (${origNodeB}).`
				: `Selected open port terminals A (${origNodeA}) and B (${origNodeB}).`,
			highlightIds: loadComp ? [loadComp.id] : undefined
		},
		{
			title: '2. Open-Circuit Voltage (V_th)',
			description: 'Solved open-circuit network for V_th = V_A - V_B.',
			latex: [`V_{th} = V_{${origNodeA}} - V_{${origNodeB}} = ${formatLatexValue(vth, mode)}\\text{ V}`]
		},
		{
			title:
				dependentSources.length > 0
					? '3. Equivalent Impedance (Z_th — Test-Source Method) & Norton Current (I_N)'
					: '3. Equivalent Impedance (Z_th) & Norton Current (I_N)',
			description:
				dependentSources.length > 0
					? `Deactivated ONLY independent sources while keeping dependent source(s) (${dependentSources.map((d) => d.label).join(', ')}) active. Applied a ${usedVoltageTestSource ? '1 V test voltage source across A–B' : '1 A test current source from B to A'} to compute Z_th = V_test / I_test.`
					: `Deactivated all independent sources and applied a ${usedVoltageTestSource ? '1 V test voltage source across A–B' : '1 A test source from B to A'} to find Z_th = V_test / I_test.`,
			latex: [
				zth !== null
					? `Z_{th} = \\frac{V_{\\text{test}}}{I_{\\text{test}}} = ${formatLatexValue(zth, mode)}\\;\\Omega`
					: `Z_{th} = \\infty\\;\\Omega\\;(\\text{open port})`,
				isc !== null
					? `I_N = \\frac{V_{th}}{Z_{th}} = ${formatLatexValue(isc, mode)}\\text{ A}`
					: `I_N = \\infty\\text{ A}\\;(\\text{ideal zero-impedance source})`
			]
		}
	];

	if (verifyLatex.length > 0) {
		steps.push({
			title: '4. Reconnect Load & Verify',
			description: `Reconnected ${loadComp!.label} to the Thévenin equivalent and checked the result against the full circuit solution.`,
			latex: verifyLatex
		});
	}

	if (maxPowerLatex.length > 0) {
		steps.push({
			title: `${verifyLatex.length > 0 ? '5' : '4'}. Maximum Power Transfer`,
			description: 'Maximum real power is delivered when the load equals the complex conjugate Z_th*.',
			latex: maxPowerLatex
		});
	}

	const summaryParts = [
		`V_{th} &= ${formatLatexValue(vth, mode)}\\text{ V}`,
		zth !== null ? `Z_{th} &= ${formatLatexValue(zth, mode)}\\;\\Omega` : 'Z_{th} &= \\infty',
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
