/**
 * Shared utilities for Circuit Lab's pedagogical method solvers:
 * LaTeX value formatting, impedance/admittance evaluation, source deactivation,
 * and cross-verification against MNA ground truth.
 */

import { Complex, formatRational } from '../complex';
import {
	buildElectricalGraph,
	getPassiveImpedance as resolvePassiveImpedance,
	parseDependentGain
} from '../graph';
import {
	isDependentSourceKind,
	isVoltageControlledSource,
	type AnalysisMode,
	type CircuitComponent,
	type CircuitDocument,
	type CircuitWire,
	type GridPoint,
	type MnaSolution
} from '../types';

export const MNA_VERIFICATION_TOL = 1e-8;

/**
 * Formats a complex or real scalar for clean KaTeX display.
 * In DC mode, uses exact rational fractions (e.g. `\frac{10}{3}`) when applicable.
 */
export function formatLatexValue(c: Complex, mode: AnalysisMode, prec = 4): string {
	if (c.isZero(1e-12)) return '0';
	if (mode === 'dc' || c.isReal(1e-12)) {
		const rat = formatRational(c.re);
		if (rat) {
			if (rat.includes('/')) {
				const neg = rat.startsWith('-');
				const [num, den] = (neg ? rat.slice(1) : rat).split('/');
				return `${neg ? '-' : ''}\\frac{${num}}{${den}}`;
			}
			return rat;
		}
		return Complex.from(c.re, 0).toLatexRect(prec);
	}
	return c.toLatexRect(prec);
}

/**
 * Formats a complex number wrapped in parentheses if it has both real and imaginary parts
 * or is negative, for clean equation substitution.
 */
export function formatLatexTerm(c: Complex, mode: AnalysisMode, prec = 4): string {
	const s = formatLatexValue(c, mode, prec);
	if (s.startsWith('-') || (!c.isReal(1e-12) && Math.abs(c.re) > 1e-12)) {
		return `(${s})`;
	}
	return s;
}

/**
 * Computes the complex impedance Z of a passive component in DC or AC mode.
 * Returns `null` for ideal sources and DC open capacitors; `0` for DC shorted inductors.
 */
export function getPassiveImpedance(
	comp: CircuitComponent,
	mode: AnalysisMode,
	frequencyHz: number
): Complex | null {
	const res = resolvePassiveImpedance(comp, mode, frequencyHz);
	if (!res) return null;
	if (res.kind === 'impedance') return res.z;
	if (res.kind === 'short') return Complex.zero();
	return null;
}

/**
 * Computes the complex admittance Y of a passive component in DC or AC mode.
 * Returns `null` for ideal sources and DC shorted inductors; `0` for DC open capacitors.
 */
export function getPassiveAdmittance(
	comp: CircuitComponent,
	mode: AnalysisMode,
	frequencyHz: number
): Complex | null {
	const res = resolvePassiveImpedance(comp, mode, frequencyHz);
	if (!res) return null;
	if (res.kind === 'impedance') return Complex.one().div(res.z);
	if (res.kind === 'open') return Complex.zero();
	return null;
}

/**
 * Remaps explicit `controlNodePos` / `controlNodeNeg` references on dependent sources
 * from `origGraph` node IDs to `subDoc`'s electrical graph node IDs using shared grid points.
 */
export function remapDependentControlNodes(
	origGraph: ReturnType<typeof buildElectricalGraph>,
	subDoc: CircuitDocument
): CircuitDocument {
	const needsRemap = subDoc.components.some(
		(c) =>
			isDependentSourceKind(c.kind) &&
			c.controlRef &&
			!c.controlRef.controlComponentId &&
			(c.controlRef.controlNodePos !== undefined || c.controlRef.controlNodeNeg !== undefined)
	);
	if (!needsRemap) return subDoc;

	const subGraph = buildElectricalGraph(subDoc);
	const mapNode = (origNodeId: string): string => {
		if (origNodeId === '0') return '0';
		const origNode = origGraph.nodes[origNodeId];
		if (!origNode) return origNodeId;
		for (const gp of origNode.gridPoints) {
			for (const [subId, subNode] of Object.entries(subGraph.nodes)) {
				if (subNode.gridPoints.some((p) => p.x === gp.x && p.y === gp.y)) {
					return subId;
				}
			}
		}
		return origNodeId;
	};

	return {
		...subDoc,
		components: subDoc.components.map((c) => {
			if (
				!isDependentSourceKind(c.kind) ||
				!c.controlRef ||
				c.controlRef.controlComponentId
			) {
				return c;
			}
			return {
				...c,
				controlRef: {
					...c.controlRef,
					...(c.controlRef.controlNodePos !== undefined
						? { controlNodePos: mapNode(c.controlRef.controlNodePos) }
						: {}),
					...(c.controlRef.controlNodeNeg !== undefined
						? { controlNodeNeg: mapNode(c.controlRef.controlNodeNeg) }
						: {})
				}
			};
		})
	};
}

/**
 * Creates a modified CircuitDocument with all independent sources deactivated
 * except `keepSourceId` (if provided).
 * - Other independent voltage sources become 0 V short circuits.
 * - Other independent current sources are removed (open circuits), or set to 0 A if referenced by a dependent source.
 * - Dependent sources (VCVS, VCCS, CCVS, CCCS) ALWAYS remain active per textbook rules.
 */
export function buildDeactivatedDocument(
	doc: CircuitDocument,
	keepSourceId: string | null,
	overrideMode?: AnalysisMode,
	overrideFrequencyHz?: number
): CircuitDocument {
	const referencedIds = new Set<string>();
	for (const c of doc.components) {
		if (!isDependentSourceKind(c.kind) || !c.controlRef) continue;
		if (c.controlRef.controlComponentId) referencedIds.add(c.controlRef.controlComponentId);
		if (c.controlRef.controlBranchComponentId) {
			referencedIds.add(c.controlRef.controlBranchComponentId);
		}
	}

	const components: CircuitComponent[] = [];
	for (const comp of doc.components) {
		const cloned: CircuitComponent = {
			...comp,
			...(comp.controlRef ? { controlRef: { ...comp.controlRef } } : {})
		};
		if (comp.id === keepSourceId) {
			components.push(cloned);
			continue;
		}
		if (comp.kind === 'voltage_source') {
			components.push({
				...cloned,
				value: '0',
				numericValue: 0,
				phaseDeg: 0
			});
			continue;
		}
		if (comp.kind === 'current_source') {
			if (referencedIds.has(comp.id)) {
				components.push({
					...cloned,
					value: '0',
					numericValue: 0,
					phaseDeg: 0
				});
			}
			continue;
		}
		components.push(cloned);
	}

	return {
		...doc,
		mode: overrideMode ?? doc.mode,
		frequencyHz: overrideFrequencyHz ?? doc.frequencyHz,
		components
	};
}

/**
 * Returns true if the circuit contains at least one linear dependent source.
 */
export function hasDependentSources(doc: CircuitDocument): boolean {
	return doc.components.some((c) => isDependentSourceKind(c.kind));
}

/**
 * Formats a dependent source's controlling variable for LaTeX display (e.g. `v_x`, `V_{R1}`, `I_{R2}`).
 */
export function formatDependentControlVar(comp: CircuitComponent, doc: CircuitDocument): string {
	const ref = comp.controlRef;
	if (ref?.controlVarName && ref.controlVarName.trim()) {
		return ref.controlVarName.trim();
	}
	if (isVoltageControlledSource(comp.kind)) {
		if (ref?.controlComponentId) {
			const target = doc.components.find((c) => c.id === ref.controlComponentId);
			return `V_{${latexSub(target?.label ?? ref.controlComponentId)}}`;
		}
		const pos = ref?.controlNodePos ?? '?';
		const neg = ref?.controlNodeNeg ?? '0';
		return neg === '0' ? `V_{${pos}}` : `(V_{${pos}} - V_{${neg}})`;
	}
	const branchId = ref?.controlBranchComponentId ?? '?';
	const target = doc.components.find((c) => c.id === branchId);
	return `I_{${latexSub(target?.label ?? branchId)}}`;
}

/**
 * Formats a dependent source's gain * control expression in LaTeX (e.g. `2 V_{R1}`, `-0.5 I_{R2}`).
 */
export function formatDependentSourceExpr(
	comp: CircuitComponent,
	doc: CircuitDocument,
	mode: AnalysisMode
): string {
	const pol = comp.controlRef?.controlPolarity ?? 1;
	const gain = parseDependentGain(comp, mode);
	const effGain = gain ? gain.scale(pol) : Complex.one();
	const varTex = formatDependentControlVar(comp, doc);
	const gainTex = formatLatexTerm(effGain, mode);
	if (effGain.isReal(1e-12) && Math.abs(effGain.re - 1) < 1e-12) {
		return varTex;
	}
	if (effGain.isReal(1e-12) && Math.abs(effGain.re + 1) < 1e-12) {
		return `-${varTex}`;
	}
	return `${gainTex}\\,${varTex}`;
}

/**
 * Cross-verifies independently solved node voltages and branch voltages/currents
 * against the MNA ground-truth solution.
 */
export function verifyAgainstMna(
	mna: MnaSolution,
	solved: {
		nodeVoltages?: Record<string, Complex>;
		branchVoltages?: Record<string, Complex>;
		branchCurrents?: Record<string, Complex>;
	}
): { verifiedAgainstMna: boolean; maxDiscrepancy: number } {
	if (!mna.valid) {
		return { verifiedAgainstMna: false, maxDiscrepancy: Infinity };
	}

	let maxDiscrepancy = 0;

	if (solved.nodeVoltages) {
		for (const [nodeId, nodeRes] of Object.entries(mna.nodeVoltages)) {
			const candidate = solved.nodeVoltages[nodeId];
			if (candidate) {
				const diff = candidate.sub(nodeRes.voltage).abs();
				if (diff > maxDiscrepancy) maxDiscrepancy = diff;
			}
		}
	}

	if (solved.branchVoltages) {
		for (const [compId, br] of Object.entries(mna.branches)) {
			const candidate = solved.branchVoltages[compId];
			if (candidate) {
				const diff = candidate.sub(br.voltage).abs();
				if (diff > maxDiscrepancy) maxDiscrepancy = diff;
			}
		}
	}

	if (solved.branchCurrents) {
		for (const [compId, br] of Object.entries(mna.branches)) {
			const candidate = solved.branchCurrents[compId];
			if (candidate) {
				const diff = candidate.sub(br.current).abs();
				if (diff > maxDiscrepancy) maxDiscrepancy = diff;
			}
		}
	}

	return {
		verifiedAgainstMna: Number.isFinite(maxDiscrepancy) && maxDiscrepancy < MNA_VERIFICATION_TOL,
		maxDiscrepancy
	};
}

/**
 * Sanitizes component labels for clean LaTeX subscripts.
 */
export function latexSub(label: string): string {
	return label.replace(/[^a-zA-Z0-9_]/g, '');
}

/**
 * Wires that connect a synthetic port test source (placed far away, pins at `pinB`/`pinA`) to the
 * port nodes at grid points `ptB`/`ptA` without touching anything else.
 *
 * A straight wire from the far source to a port point can pass exactly through another pin
 * (any pin on the line gets merged as a T-junction), silently shorting an unrelated node into
 * the port. These routes run along non-integer rows/columns, where no pin or wire vertex can
 * lie, and reach each port point by a sub-unit diagonal step that contains no other grid point.
 */
export function buildPortTestWires(
	idPrefix: string,
	pinB: GridPoint,
	ptB: GridPoint,
	pinA: GridPoint,
	ptA: GridPoint
): CircuitWire[] {
	const route = (pin: GridPoint, pt: GridPoint, dy: number): GridPoint[] => [
		pin,
		{ x: pin.x + 0.5, y: pin.y + dy },
		{ x: pin.x + 0.5, y: pt.y + dy },
		{ x: pt.x + 0.5, y: pt.y + dy },
		pt
	];
	return [
		{ id: `${idPrefix}wB__`, points: route(pinB, ptB, 0.61) },
		{ id: `${idPrefix}wA__`, points: route(pinA, ptA, 0.37) }
	];
}
