/**
 * 100%-accurate Complex Modified Nodal Analysis (MNA) engine for DC & AC steady-state circuits.
 *
 * Canonical Passive Sign Convention:
 * - Element voltage: V_e = V_pin0 - V_pin1
 * - Branch current: I_e flows from pin 0 to pin 1 through the element
 * - Voltage source: V_pin0 - V_pin1 = V_s
 * - Current source: forces I_s from pin 0 to pin 1 (leaves pin 0, enters pin 1)
 * - Complex power absorbed: S = V_e * conj(I_e) (RMS) or 0.5 * V_e * conj(I_e) (Peak AC)
 *
 * Extension hooks for v2 dependent sources (VCVS, VCCS, CCVS, CCCS) plug directly
 * into `MnaStampContext` without breaking any public types or function signatures.
 */

import { Complex } from './complex';
import {
	buildElectricalGraph,
	getPassiveImpedance,
	parseDependentGain,
	parseSourceValue,
	resolveDependentControlNodes,
	validateCircuitTopology
} from './graph';
import { solveComplexLinearSystem } from './linalg';
import {
	isDependentSourceKind,
	isDependentVoltageSource,
	type AcMagnitudeMode,
	type BranchResult,
	type CircuitComponent,
	type CircuitDocument,
	type MnaSolution,
	type NodeResult,
	type PowerSummary,
	type ValidationDiagnostic
} from './types';

export interface SolveMnaOptions {
	frequencyHz?: number;
	acMagnitudeMode?: AcMagnitudeMode;
}

export interface MnaStampContext {
	A: Complex[][];
	b: Complex[];
	nodeIndex: Map<string, number>;
	numNodes: number;
}

/**
 * Stamps a linear admittance Y = 1/Z connected between nodeA (pin 0) and nodeB (pin 1).
 */
export function stampAdmittance(
	ctx: MnaStampContext,
	nodeA: string,
	nodeB: string,
	y: Complex
): void {
	const a = ctx.nodeIndex.get(nodeA);
	const b = ctx.nodeIndex.get(nodeB);
	if (a !== undefined) {
		ctx.A[a][a] = ctx.A[a][a].add(y);
		if (b !== undefined) {
			ctx.A[a][b] = ctx.A[a][b].sub(y);
		}
	}
	if (b !== undefined) {
		ctx.A[b][b] = ctx.A[b][b].add(y);
		if (a !== undefined) {
			ctx.A[b][a] = ctx.A[b][a].sub(y);
		}
	}
}

/**
 * Stamps a real resistance R (in Ohms) between nodeA and nodeB.
 */
export function stampResistor(
	ctx: MnaStampContext,
	nodeA: string,
	nodeB: string,
	resistance: number
): void {
	stampAdmittance(ctx, nodeA, nodeB, Complex.from(1 / resistance, 0));
}

/**
 * Stamps an independent voltage source enforcing V(nodeA) - V(nodeB) = voltage,
 * using auxiliary current unknown at row/column `ctx.numNodes + auxIdx`
 * where positive current flows from nodeA (pin 0) to nodeB (pin 1).
 */
export function stampVoltageSource(
	ctx: MnaStampContext,
	auxIdx: number,
	nodeA: string,
	nodeB: string,
	voltage: Complex
): void {
	const row = ctx.numNodes + auxIdx;
	const a = ctx.nodeIndex.get(nodeA);
	const b = ctx.nodeIndex.get(nodeB);
	const one = Complex.one();

	if (a !== undefined) {
		ctx.A[a][row] = ctx.A[a][row].add(one);
		ctx.A[row][a] = ctx.A[row][a].add(one);
	}
	if (b !== undefined) {
		ctx.A[b][row] = ctx.A[b][row].sub(one);
		ctx.A[row][b] = ctx.A[row][b].sub(one);
	}
	ctx.b[row] = ctx.b[row].add(voltage);
}

/**
 * Stamps an independent current source forcing `current` from nodeA (pin 0) to nodeB (pin 1).
 * KCL leaves nodeA by +I_s (so RHS[a] -= I_s) and enters nodeB by +I_s (so RHS[b] += I_s).
 */
export function stampCurrentSource(
	ctx: MnaStampContext,
	nodeA: string,
	nodeB: string,
	current: Complex
): void {
	const a = ctx.nodeIndex.get(nodeA);
	const b = ctx.nodeIndex.get(nodeB);
	if (a !== undefined) {
		ctx.b[a] = ctx.b[a].sub(current);
	}
	if (b !== undefined) {
		ctx.b[b] = ctx.b[b].add(current);
	}
}

/**
 * Stamps a Voltage-Controlled Current Source (VCCS) forcing
 * I(outA -> outB) = gm * (V(ctrlPos) - V(ctrlNeg)).
 */
export function stampVCCS(
	ctx: MnaStampContext,
	outA: string,
	outB: string,
	ctrlPos: string,
	ctrlNeg: string,
	gm: Complex
): void {
	const a = ctx.nodeIndex.get(outA);
	const b = ctx.nodeIndex.get(outB);
	const cp = ctx.nodeIndex.get(ctrlPos);
	const cn = ctx.nodeIndex.get(ctrlNeg);

	if (a !== undefined) {
		if (cp !== undefined) ctx.A[a][cp] = ctx.A[a][cp].add(gm);
		if (cn !== undefined) ctx.A[a][cn] = ctx.A[a][cn].sub(gm);
	}
	if (b !== undefined) {
		if (cp !== undefined) ctx.A[b][cp] = ctx.A[b][cp].sub(gm);
		if (cn !== undefined) ctx.A[b][cn] = ctx.A[b][cn].add(gm);
	}
}

/**
 * Stamps a Voltage-Controlled Voltage Source (VCVS) enforcing
 * V(outA) - V(outB) = av * (V(ctrlPos) - V(ctrlNeg)),
 * with auxiliary branch current unknown at `ctx.numNodes + auxIdx` flowing outA -> outB.
 */
export function stampVCVS(
	ctx: MnaStampContext,
	auxIdx: number,
	outA: string,
	outB: string,
	ctrlPos: string,
	ctrlNeg: string,
	av: Complex
): void {
	const row = ctx.numNodes + auxIdx;
	const a = ctx.nodeIndex.get(outA);
	const b = ctx.nodeIndex.get(outB);
	const cp = ctx.nodeIndex.get(ctrlPos);
	const cn = ctx.nodeIndex.get(ctrlNeg);
	const one = Complex.one();

	if (a !== undefined) {
		ctx.A[a][row] = ctx.A[a][row].add(one);
		ctx.A[row][a] = ctx.A[row][a].add(one);
	}
	if (b !== undefined) {
		ctx.A[b][row] = ctx.A[b][row].sub(one);
		ctx.A[row][b] = ctx.A[row][b].sub(one);
	}
	if (cp !== undefined) {
		ctx.A[row][cp] = ctx.A[row][cp].sub(av);
	}
	if (cn !== undefined) {
		ctx.A[row][cn] = ctx.A[row][cn].add(av);
	}
}

/**
 * Stamps a Current-Controlled Current Source (CCCS) forcing
 * I(outA -> outB) = beta * I_ctrl, where I_ctrl is the auxiliary unknown at `ctx.numNodes + ctrlAuxIdx`.
 */
export function stampCCCS(
	ctx: MnaStampContext,
	outA: string,
	outB: string,
	ctrlAuxIdx: number,
	beta: Complex
): void {
	const a = ctx.nodeIndex.get(outA);
	const b = ctx.nodeIndex.get(outB);
	const ctrlCol = ctx.numNodes + ctrlAuxIdx;

	if (a !== undefined) {
		ctx.A[a][ctrlCol] = ctx.A[a][ctrlCol].add(beta);
	}
	if (b !== undefined) {
		ctx.A[b][ctrlCol] = ctx.A[b][ctrlCol].sub(beta);
	}
}

/**
 * Stamps a Current-Controlled Voltage Source (CCVS) enforcing
 * V(outA) - V(outB) = rm * I_ctrl, where I_ctrl is the auxiliary unknown at `ctx.numNodes + ctrlAuxIdx`.
 */
export function stampCCVS(
	ctx: MnaStampContext,
	auxIdx: number,
	outA: string,
	outB: string,
	ctrlAuxIdx: number,
	rm: Complex
): void {
	const row = ctx.numNodes + auxIdx;
	const ctrlCol = ctx.numNodes + ctrlAuxIdx;
	const a = ctx.nodeIndex.get(outA);
	const b = ctx.nodeIndex.get(outB);
	const one = Complex.one();

	if (a !== undefined) {
		ctx.A[a][row] = ctx.A[a][row].add(one);
		ctx.A[row][a] = ctx.A[row][a].add(one);
	}
	if (b !== undefined) {
		ctx.A[b][row] = ctx.A[b][row].sub(one);
		ctx.A[row][b] = ctx.A[row][b].sub(one);
	}
	ctx.A[row][ctrlCol] = ctx.A[row][ctrlCol].sub(rm);
}

interface CurrentLinearExpr {
	terms: Map<number, Complex>;
	constant: Complex;
}

function addLinearTerm(map: Map<number, Complex>, col: number, coeff: Complex): void {
	const prev = map.get(col);
	map.set(col, prev ? prev.add(coeff) : coeff);
}

function scaleLinearExpr(expr: CurrentLinearExpr, factor: Complex): CurrentLinearExpr {
	const terms = new Map<number, Complex>();
	for (const [col, coeff] of expr.terms.entries()) {
		terms.set(col, coeff.mul(factor));
	}
	return { terms, constant: expr.constant.mul(factor) };
}

function evalLinearExpr(expr: CurrentLinearExpr, x: Complex[]): Complex {
	let sum = expr.constant;
	for (const [col, coeff] of expr.terms.entries()) {
		sum = sum.add(coeff.mul(x[col]));
	}
	return sum;
}

function emptyPowerSummary(balanced = false): PowerSummary {
	return {
		totalRealPower: 0,
		totalReactivePower: 0,
		totalAbsorbedReal: 0,
		totalSuppliedReal: 0,
		balanced
	};
}

function makeInvalidSolution(
	doc: CircuitDocument,
	frequencyHz: number,
	acMagnitudeMode: AcMagnitudeMode,
	diagnostics: ValidationDiagnostic[]
): MnaSolution {
	return {
		valid: false,
		mode: doc.mode,
		frequencyHz,
		acMagnitudeMode,
		diagnostics,
		nodeVoltages: {},
		branches: {},
		powerBalance: emptyPowerSummary(false)
	};
}

/**
 * Returns the distinct frequencies of the *active* (non-zero) independent sources when an AC
 * circuit mixes frequencies, else undefined. Zeroed sources (e.g. deactivated by superposition)
 * do not count, so per-source superposition sub-circuits are single-frequency.
 */
export function detectMultiFrequency(
	doc: CircuitDocument,
	frequencyHz: number
): number[] | undefined {
	if (doc.mode !== 'ac') return undefined;
	const freqs = new Set<number>();
	for (const comp of doc.components) {
		if (comp.kind !== 'voltage_source' && comp.kind !== 'current_source') continue;
		const val = parseSourceValue(comp, 'ac');
		if (!val || val.abs() < 1e-15) continue;
		freqs.add(comp.frequencyHz ?? frequencyHz);
	}
	return freqs.size > 1 ? [...freqs].sort((a, b) => a - b) : undefined;
}

/**
 * Solves a DC or AC steady-state linear circuit using Modified Nodal Analysis (MNA).
 */
export function solveMNA(doc: CircuitDocument, options?: SolveMnaOptions): MnaSolution {
	const mode = doc.mode;
	const frequencyHz = options?.frequencyHz ?? doc.frequencyHz;
	const acMagnitudeMode: AcMagnitudeMode =
		options?.acMagnitudeMode ?? doc.acMagnitudeMode ?? 'rms';

	const graph = buildElectricalGraph(doc);
	const diagnostics = validateCircuitTopology(graph, mode, frequencyHz);

	if (diagnostics.some((d) => d.severity === 'error')) {
		return makeInvalidSolution(doc, frequencyHz, acMagnitudeMode, diagnostics);
	}

	const multiFrequencyHz = detectMultiFrequency(doc, frequencyHz);
	if (multiFrequencyHz) {
		diagnostics.push({
			severity: 'warning',
			code: 'MULTI_FREQUENCY',
			message: `Sources run at different frequencies (${multiFrequencyHz
				.map((f) => `${Number(f.toPrecision(4))} Hz`)
				.join(', ')}). One phasor per node cannot describe this circuit, so node/branch values are hidden. Use the Superposition tab: it solves each frequency separately and adds the responses in the time domain.`,
			componentIds: doc.components
				.filter((c) => c.kind === 'voltage_source' || c.kind === 'current_source')
				.map((c) => c.id)
		});
	}

	const nodeOrder = graph.nonRefNodeIds;
	const numNodes = nodeOrder.length;
	const nodeIndex = new Map<string, number>();
	nodeOrder.forEach((id, i) => nodeIndex.set(id, i));

	const twoTerminalComps = doc.components.filter(
		(c) => c.kind !== 'ground' && c.kind !== 'terminal'
	);
	const activeComps = twoTerminalComps.filter((c) => c.kind !== 'voltmeter');
	const voltmeters = twoTerminalComps.filter((c) => c.kind === 'voltmeter');

	// Components requiring auxiliary branch current unknowns in MNA
	const voltageBranches: CircuitComponent[] = activeComps.filter(
		(c) =>
			c.kind === 'voltage_source' ||
			isDependentVoltageSource(c.kind) ||
			(mode === 'dc' && c.kind === 'inductor')
	);
	const voltageBranchAuxMap = new Map<string, number>();
	voltageBranches.forEach((c, idx) => voltageBranchAuxMap.set(c.id, idx));

	const compById = new Map<string, CircuitComponent>();
	for (const c of activeComps) compById.set(c.id, c);

	const dim = numNodes + voltageBranches.length;
	const A: Complex[][] = Array.from({ length: dim }, () =>
		Array.from({ length: dim }, () => Complex.zero())
	);
	const b: Complex[] = Array.from({ length: dim }, () => Complex.zero());
	const ctx: MnaStampContext = { A, b, nodeIndex, numNodes };

	const componentImpedance = new Map<string, Complex | null>();
	const currentSourceValues = new Map<string, Complex>();
	const dependentCurrentExprs = new Map<string, CurrentLinearExpr>();

	const resolveBranchCurrentExpr = (
		compId: string,
		visited: Set<string>
	): CurrentLinearExpr | null => {
		if (visited.has(compId)) return null;
		const target = compById.get(compId);
		if (!target) return null;

		visited.add(compId);
		const [nA, nB] = graph.componentNodes[target.id];
		const terms = new Map<number, Complex>();
		let constant = Complex.zero();

		switch (target.kind) {
			case 'resistor':
			case 'capacitor':
			case 'inductor': {
				const passive = getPassiveImpedance(target, mode, frequencyHz)!;
				if (passive.kind === 'short') {
					const auxIdx = voltageBranchAuxMap.get(target.id)!;
					addLinearTerm(terms, numNodes + auxIdx, Complex.one());
				} else if (passive.kind === 'impedance') {
					const y = Complex.one().div(passive.z);
					const ia = nodeIndex.get(nA);
					const ib = nodeIndex.get(nB);
					if (ia !== undefined) addLinearTerm(terms, ia, y);
					if (ib !== undefined) addLinearTerm(terms, ib, y.neg());
				}
				break;
			}
			case 'voltage_source':
			case 'vcvs':
			case 'ccvs': {
				const auxIdx = voltageBranchAuxMap.get(target.id)!;
				addLinearTerm(terms, numNodes + auxIdx, Complex.one());
				break;
			}
			case 'current_source': {
				constant = parseSourceValue(target, mode)!;
				break;
			}
			case 'vccs': {
				const ctrl = resolveDependentControlNodes(target, graph)!;
				const pol = target.controlRef?.controlPolarity ?? 1;
				const gm = parseDependentGain(target, mode)!.scale(pol);
				const cp = nodeIndex.get(ctrl.ctrlPos);
				const cn = nodeIndex.get(ctrl.ctrlNeg);
				if (cp !== undefined) addLinearTerm(terms, cp, gm);
				if (cn !== undefined) addLinearTerm(terms, cn, gm.neg());
				break;
			}
			case 'cccs': {
				const subExpr = resolveBranchCurrentExpr(
					target.controlRef!.controlBranchComponentId!,
					visited
				);
				if (!subExpr) {
					visited.delete(compId);
					return null;
				}
				const pol = target.controlRef?.controlPolarity ?? 1;
				const beta = parseDependentGain(target, mode)!.scale(pol);
				visited.delete(compId);
				return scaleLinearExpr(subExpr, beta);
			}
		}

		visited.delete(compId);
		return { terms, constant };
	};

	for (const comp of activeComps) {
		const [nodeA, nodeB] = graph.componentNodes[comp.id];

		switch (comp.kind) {
			case 'resistor':
			case 'capacitor':
			case 'inductor': {
				const passive = getPassiveImpedance(comp, mode, frequencyHz)!;
				if (passive.kind === 'open') {
					// Open circuit in DC steady state (Y = 0, I = 0)
					componentImpedance.set(comp.id, null);
				} else if (passive.kind === 'short') {
					// Short circuit (0 V branch) in DC steady state
					const auxIdx = voltageBranchAuxMap.get(comp.id)!;
					stampVoltageSource(ctx, auxIdx, nodeA, nodeB, Complex.zero());
					componentImpedance.set(comp.id, Complex.zero());
				} else {
					const y = Complex.one().div(passive.z);
					stampAdmittance(ctx, nodeA, nodeB, y);
					componentImpedance.set(comp.id, passive.z);
				}
				break;
			}
			case 'voltage_source': {
				const vs = parseSourceValue(comp, mode)!;
				const auxIdx = voltageBranchAuxMap.get(comp.id)!;
				stampVoltageSource(ctx, auxIdx, nodeA, nodeB, vs);
				componentImpedance.set(comp.id, null);
				break;
			}
			case 'current_source': {
				const is = parseSourceValue(comp, mode)!;
				stampCurrentSource(ctx, nodeA, nodeB, is);
				currentSourceValues.set(comp.id, is);
				componentImpedance.set(comp.id, null);
				break;
			}
			case 'vccs': {
				const ctrl = resolveDependentControlNodes(comp, graph)!;
				const pol = comp.controlRef?.controlPolarity ?? 1;
				const gm = parseDependentGain(comp, mode)!.scale(pol);
				stampVCCS(ctx, nodeA, nodeB, ctrl.ctrlPos, ctrl.ctrlNeg, gm);
				const exprTerms = new Map<number, Complex>();
				const cp = nodeIndex.get(ctrl.ctrlPos);
				const cn = nodeIndex.get(ctrl.ctrlNeg);
				if (cp !== undefined) addLinearTerm(exprTerms, cp, gm);
				if (cn !== undefined) addLinearTerm(exprTerms, cn, gm.neg());
				dependentCurrentExprs.set(comp.id, { terms: exprTerms, constant: Complex.zero() });
				componentImpedance.set(comp.id, null);
				break;
			}
			case 'vcvs': {
				const ctrl = resolveDependentControlNodes(comp, graph)!;
				const pol = comp.controlRef?.controlPolarity ?? 1;
				const av = parseDependentGain(comp, mode)!.scale(pol);
				const auxIdx = voltageBranchAuxMap.get(comp.id)!;
				stampVCVS(ctx, auxIdx, nodeA, nodeB, ctrl.ctrlPos, ctrl.ctrlNeg, av);
				componentImpedance.set(comp.id, null);
				break;
			}
			case 'cccs': {
				const ctrlBranchId = comp.controlRef!.controlBranchComponentId!;
				const pol = comp.controlRef?.controlPolarity ?? 1;
				const beta = parseDependentGain(comp, mode)!.scale(pol);
				const ctrlExpr = resolveBranchCurrentExpr(ctrlBranchId, new Set([comp.id]));
				if (!ctrlExpr) {
					diagnostics.push({
						severity: 'error',
						code: 'CIRCULAR_DEPENDENT_CONTROL',
						message: `Dependent source ${comp.label} has a circular current-control dependency involving ${ctrlBranchId}.`,
						componentIds: [comp.id, ctrlBranchId]
					});
					return makeInvalidSolution(doc, frequencyHz, acMagnitudeMode, diagnostics);
				}
				const scaled = scaleLinearExpr(ctrlExpr, beta);
				dependentCurrentExprs.set(comp.id, scaled);
				const ia = nodeIndex.get(nodeA);
				const ib = nodeIndex.get(nodeB);
				for (const [col, coeff] of scaled.terms.entries()) {
					if (ia !== undefined) A[ia][col] = A[ia][col].add(coeff);
					if (ib !== undefined) A[ib][col] = A[ib][col].sub(coeff);
				}
				if (!scaled.constant.isZero(1e-18)) {
					if (ia !== undefined) b[ia] = b[ia].sub(scaled.constant);
					if (ib !== undefined) b[ib] = b[ib].add(scaled.constant);
				}
				componentImpedance.set(comp.id, null);
				break;
			}
			case 'ccvs': {
				const ctrlBranchId = comp.controlRef!.controlBranchComponentId!;
				const pol = comp.controlRef?.controlPolarity ?? 1;
				const rm = parseDependentGain(comp, mode)!.scale(pol);
				const auxIdx = voltageBranchAuxMap.get(comp.id)!;
				const ctrlExpr = resolveBranchCurrentExpr(ctrlBranchId, new Set());
				if (!ctrlExpr) {
					diagnostics.push({
						severity: 'error',
						code: 'CIRCULAR_DEPENDENT_CONTROL',
						message: `Dependent source ${comp.label} has a circular current-control dependency involving ${ctrlBranchId}.`,
						componentIds: [comp.id, ctrlBranchId]
					});
					return makeInvalidSolution(doc, frequencyHz, acMagnitudeMode, diagnostics);
				}
				const row = numNodes + auxIdx;
				const ia = nodeIndex.get(nodeA);
				const ib = nodeIndex.get(nodeB);
				const one = Complex.one();
				if (ia !== undefined) {
					A[ia][row] = A[ia][row].add(one);
					A[row][ia] = A[row][ia].add(one);
				}
				if (ib !== undefined) {
					A[ib][row] = A[ib][row].sub(one);
					A[row][ib] = A[row][ib].sub(one);
				}
				for (const [col, coeff] of ctrlExpr.terms.entries()) {
					A[row][col] = A[row][col].sub(rm.mul(coeff));
				}
				if (!ctrlExpr.constant.isZero(1e-18)) {
					b[row] = b[row].add(rm.mul(ctrlExpr.constant));
				}
				componentImpedance.set(comp.id, null);
				break;
			}
		}
	}

	let x: Complex[] = [];
	let pivotMin = 1;

	if (dim > 0) {
		const solved = solveComplexLinearSystem(A, b);
		pivotMin = solved.pivotMin;
		if (solved.singular) {
			diagnostics.push({
				severity: 'error',
				code: 'SINGULAR_MATRIX',
				message:
					'MNA matrix is singular (e.g., lossless parallel LC tank at exact resonance or degenerate topology).'
			});
			return makeInvalidSolution(doc, frequencyHz, acMagnitudeMode, diagnostics);
		}
		x = solved.x;
	}

	// Build node voltage map
	const nodeVoltages: Record<string, NodeResult> = {};
	if (graph.nodes['0']) {
		nodeVoltages['0'] = {
			nodeId: '0',
			voltage: Complex.zero(),
			isReference: true,
			componentPins: graph.nodes['0'].componentPins,
			gridPoints: graph.nodes['0'].gridPoints
		};
	}

	nodeOrder.forEach((nodeId, idx) => {
		const graphNode = graph.nodes[nodeId];
		nodeVoltages[nodeId] = {
			nodeId,
			voltage: x[idx],
			isReference: false,
			componentPins: graphNode.componentPins,
			gridPoints: graphNode.gridPoints
		};
	});

	// Build branch results & power balance
	const powerScale = mode === 'ac' && acMagnitudeMode === 'peak' ? 0.5 : 1;
	const branches: Record<string, BranchResult> = {};
	let totalRealPower = 0;
	let totalReactivePower = 0;
	let totalAbsorbedReal = 0;
	let totalSuppliedReal = 0;

	for (const comp of activeComps) {
		const [nodeA, nodeB] = graph.componentNodes[comp.id];
		const vA = nodeVoltages[nodeA]?.voltage ?? Complex.zero();
		const vB = nodeVoltages[nodeB]?.voltage ?? Complex.zero();
		const voltage = vA.sub(vB);
		const impedance = componentImpedance.get(comp.id) ?? null;

		let current: Complex;
		if (comp.kind === 'resistor' || comp.kind === 'capacitor' || comp.kind === 'inductor') {
			const passive = getPassiveImpedance(comp, mode, frequencyHz)!;
			if (passive.kind === 'open') {
				current = Complex.zero();
			} else if (passive.kind === 'short') {
				const auxIdx = voltageBranchAuxMap.get(comp.id)!;
				current = x[numNodes + auxIdx];
			} else {
				current = voltage.div(passive.z);
			}
		} else if (comp.kind === 'voltage_source' || isDependentVoltageSource(comp.kind)) {
			const auxIdx = voltageBranchAuxMap.get(comp.id)!;
			current = x[numNodes + auxIdx];
		} else if (comp.kind === 'vccs' || comp.kind === 'cccs') {
			const expr = dependentCurrentExprs.get(comp.id)!;
			current = evalLinearExpr(expr, x);
		} else {
			current = currentSourceValues.get(comp.id)!;
		}

		const complexPower = voltage.mul(current.conj()).scale(powerScale);
		const realPower = complexPower.re;
		const reactivePower = complexPower.im;
		const apparentPower = complexPower.abs();

		// Sources report the power factor they deliver (S_supplied = -S_absorbed), which is the
		// textbook "source power factor": a source feeding an R + jX load is lagging, not leading.
		// Passives report the power factor of the power they absorb.
		const isSource =
			comp.kind === 'voltage_source' ||
			comp.kind === 'current_source' ||
			isDependentSourceKind(comp.kind);
		const pfReal = isSource ? -realPower : realPower;
		const pfReactive = isSource ? -reactivePower : reactivePower;

		let powerFactor: number | null = null;
		let powerFactorType: BranchResult['powerFactorType'] = undefined;
		if (apparentPower > 1e-12) {
			powerFactor = Math.max(-1, Math.min(1, pfReal / apparentPower));
			if (Math.abs(pfReactive) <= 1e-12 * apparentPower) {
				powerFactorType = 'unity';
			} else if (pfReactive > 0) {
				powerFactorType = 'lagging';
			} else {
				powerFactorType = 'leading';
			}
		}

		totalRealPower += realPower;
		totalReactivePower += reactivePower;
		if (realPower > 0) totalAbsorbedReal += realPower;
		else if (realPower < 0) totalSuppliedReal += -realPower;

		branches[comp.id] = {
			componentId: comp.id,
			label: comp.label,
			kind: comp.kind,
			nodeA,
			nodeB,
			voltage,
			current,
			impedance,
			complexPower,
			realPower,
			reactivePower,
			apparentPower,
			powerFactor,
			powerFactorType
		};
	}

	// Post-solve ideal voltmeter readouts (open circuit: Y = 0, I = 0, S = 0)
	for (const vm of voltmeters) {
		const [nodeA, nodeB] = graph.componentNodes[vm.id] ?? [];
		if (!nodeA || !nodeB || !nodeVoltages[nodeA] || !nodeVoltages[nodeB]) {
			continue;
		}
		const voltage = nodeVoltages[nodeA].voltage.sub(nodeVoltages[nodeB].voltage);
		branches[vm.id] = {
			componentId: vm.id,
			label: vm.label,
			kind: 'voltmeter',
			isMeasurementOnly: true,
			nodeA,
			nodeB,
			voltage,
			current: Complex.zero(),
			impedance: null,
			complexPower: Complex.zero(),
			realPower: 0,
			reactivePower: 0,
			apparentPower: 0,
			powerFactor: null,
			powerFactorType: undefined
		};
	}

	const scaleRef = Math.max(1, totalAbsorbedReal, totalSuppliedReal);
	const tol = Math.max(1e-7, 1e-11 * scaleRef);
	const balanced = Math.abs(totalRealPower) < tol && Math.abs(totalReactivePower) < tol;

	const unknownLabels = [
		...nodeOrder.map((nid) => `V_{${nid}}`),
		...voltageBranches.map((c) => `I_{${c.label}}`)
	];

	return {
		valid: true,
		mode,
		frequencyHz,
		acMagnitudeMode,
		...(multiFrequencyHz ? { multiFrequencyHz } : {}),
		diagnostics,
		nodeVoltages,
		branches,
		powerBalance: {
			totalRealPower,
			totalReactivePower,
			totalAbsorbedReal,
			totalSuppliedReal,
			balanced
		},
		system: {
			A,
			b,
			x,
			unknownLabels,
			nodeOrder,
			voltageBranchOrder: voltageBranches.map((c) => c.id)
		},
		pivotMin
	};
}
