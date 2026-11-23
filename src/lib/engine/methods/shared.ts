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

export interface CourseSolveDisplay {
	/** Lines for the "solve" step (substitutions and/or the one-line solve). */
	latex: string[];
	/** Number of equations still solved simultaneously (0, 1 or ≥2). */
	remaining: number;
}

/**
 * Presents the solution of `A x = b` the way it is done by hand in the course:
 * rows with a single unknown are solved directly and substituted into the rest
 * (e.g. a mesh current fixed by a current source); one remaining equation is
 * solved in one line (collect terms, divide); when two or more equations remain,
 * they are solved by substitution (write one unknown in terms of the others,
 * substitute into the rest, repeat, then back-substitute). Never a matrix.
 * Display only — the caller still solves the full system.
 */
export function courseSolveDisplay(
	A: Complex[][],
	b: Complex[],
	names: string[],
	unit: string,
	mode: AnalysisMode
): CourseSolveDisplay {
	const n = names.length;
	const EPS = 1e-12;
	const known = new Map<number, Complex>();
	const usedRows = new Set<number>();
	const latex: string[] = [];
	const val = (c: Complex) => formatLatexValue(c, mode);
	const term = (c: Complex) => formatLatexTerm(c, mode);

	const reducedRow = (r: number) => {
		let rhs = b[r];
		const unknowns: number[] = [];
		for (let j = 0; j < n; j++) {
			const a = A[r][j];
			if (a.isZero(EPS)) continue;
			const kv = known.get(j);
			if (kv) rhs = rhs.sub(a.mul(kv));
			else unknowns.push(j);
		}
		return { rhs, unknowns };
	};

	// Peel off rows with a single unknown, substituting known values each pass.
	// Only rows with one unknown *before* substitution are peeled here, so a row
	// that becomes single-unknown only after substitution is left as the final
	// "one equation" step and is shown with its substituted terms.
	let progress = true;
	while (progress) {
		progress = false;
		for (let r = 0; r < A.length; r++) {
			if (usedRows.has(r)) continue;
			// The last unknown is left for the one-line solve step below.
			if (n - known.size <= 1) break;
			const nonzero = A[r].filter((a) => !a.isZero(EPS)).length;
			if (nonzero !== 1) continue;
			const { rhs, unknowns } = reducedRow(r);
			usedRows.add(r);
			if (unknowns.length !== 1) continue;
			const j = unknowns[0];
			const a = A[r][j];
			const x = rhs.div(a);
			known.set(j, x);
			latex.push(
				a.equals(Complex.one(), EPS)
					? `${names[j]} = ${val(x)}\\text{ ${unit}}`
					: `${term(a)}\\,${names[j]} = ${val(rhs)} \\;\\Rightarrow\\; ${names[j]} = ${val(x)}\\text{ ${unit}}`
			);
			progress = true;
		}
	}

	const rows = A.map((_, r) => r).filter((r) => !usedRows.has(r));
	const unknownCols = names.map((_, j) => j).filter((j) => !known.has(j));

	if (unknownCols.length === 0) return { latex, remaining: 0 };

	if (unknownCols.length === 1 && rows.length >= 1) {
		const j = unknownCols[0];
		const r = rows.find((rr) => !A[rr][j].isZero(EPS)) ?? rows[0];
		const { rhs } = reducedRow(r);
		const a = A[r][j];
		const x = rhs.div(a);
		if (known.size > 0) latex.push(`\\text{Substituting the known values leaves one equation:}`);
		latex.push(
			`${term(a)}\\,${names[j]} = ${val(rhs)} \\;\\Rightarrow\\; ${names[j]} = ${val(rhs).includes('\\frac') || val(a).includes('\\frac') ? `${term(rhs)} \\div ${term(a)}` : `\\frac{${val(rhs)}}{${val(a)}}`} = ${val(x)}\\text{ ${unit}}`
		);
		return { latex, remaining: 1 };
	}

	// Substitution: two or more simultaneous equations remain.
	const W = new Map<number, Complex[]>();
	const R = new Map<number, Complex>();
	for (const r of rows) {
		W.set(r, A[r].map((a, j) => (known.has(j) ? Complex.zero() : a)));
		R.set(r, reducedRow(r).rhs);
	}
	const active = new Set(unknownCols);
	let activeRows = [...rows];
	const big = unknownCols.length > 4;
	const isOne = (c: Complex) => c.equals(Complex.one(), EPS);

	/** Sum of terms `c*label` (a part without a label is a constant). */
	const sumLatex = (parts: { c: Complex; label?: string; num?: boolean }[]): string => {
		const body = (m: Complex, p: { label?: string; num?: boolean }) => {
			if (!p.label) return val(m);
			const lab = p.label;
			return isOne(m) ? lab : `${term(m)}${p.num ? '\\cdot ' : '\\,'}${lab}`;
		};
		let out = '';
		for (const p of parts) {
			if (p.c.isZero(EPS)) continue;
			const neg = p.c.isReal(EPS) && p.c.re < 0;
			const m = neg ? p.c.neg() : p.c;
			const piece = p.label ? body(m, p) : neg ? val(m) : term(m);
			out += out === '' ? (neg ? `-${piece}` : piece) : neg ? ` - ${piece}` : ` + ${piece}`;
		}
		return out === '' ? '0' : out;
	};
	const eqnLatex = (coefs: Complex[], rhs: Complex) =>
		`${sumLatex([...active].filter((j) => !coefs[j].isZero(EPS)).map((j) => ({ c: coefs[j], label: names[j] })))} = ${val(rhs)}`;
	/** `x = (rhs - others)/a`, written with numbers; others are labelled by name or by value. */
	const explicitLatex = (
		name: string,
		a: Complex,
		rhs: Complex,
		others: { c: Complex; label: string; num?: boolean }[]
	) => {
		const num = sumLatex([{ c: rhs }, ...others.map((o) => ({ ...o, c: o.c.neg() }))]);
		const aVal = val(a);
		// Divide through when a = ±1 or either side is already a fraction (no nested \\frac);
		// otherwise keep the hand-working form x = (rhs − terms) / a.
		if (isOne(a) || isOne(a.neg()) || num.includes('\\frac') || aVal.includes('\\frac')) {
			return `${name} = ${sumLatex([{ c: rhs.div(a) }, ...others.map((o) => ({ ...o, c: o.c.neg().div(a) }))])}`;
		}
		return `${name} = \\frac{${num}}{${aVal}}`;
	};

	const stack: { j: number; a: Complex; rhs: Complex; others: { j: number; c: Complex }[] }[] = [];
	let first = true;
	while (active.size > 1 && activeRows.length > 0) {
		const nz = (r: number) => [...active].filter((j) => !W.get(r)![j].isZero(EPS));
		let pickRow = -1;
		let best = Infinity;
		for (const r of activeRows) {
			const cnt = nz(r).length;
			if (cnt > 0 && cnt < best) {
				best = cnt;
				pickRow = r;
			}
		}
		if (pickRow < 0) break;
		const row = W.get(pickRow)!;
		const js = nz(pickRow);
		const p = js.reduce((m, j) => (row[j].abs() > row[m].abs() + 1e-12 ? j : m), js[0]);
		const a = row[p];
		const rhs = R.get(pickRow)!;
		const others = js.filter((j) => j !== p).map((j) => ({ j, c: row[j] }));
		const show = !big || first;
		first = false;
		if (show) {
			latex.push(
				`\\text{Equation with the fewest unknowns:}\\;${eqnLatex(row, rhs)}`,
				explicitLatex(
					names[p],
					a,
					rhs,
					others.map((o) => ({ c: o.c, label: names[o.j] }))
				)
			);
		}
		stack.push({ j: p, a, rhs, others });
		activeRows = activeRows.filter((r) => r !== pickRow);
		const changed: string[] = [];
		for (const r of activeRows) {
			const w = W.get(r)!;
			const f = w[p];
			if (f.isZero(EPS)) continue;
			const k = f.div(a);
			for (const o of others) w[o.j] = w[o.j].sub(k.mul(o.c));
			w[p] = Complex.zero();
			R.set(r, R.get(r)!.sub(k.mul(rhs)));
			changed.push(eqnLatex(w, R.get(r)!));
		}
		active.delete(p);
		if (show && changed.length > 0) {
			latex.push(`\\text{Substituting }${names[p]}\\text{ into the other equations gives:}`, ...changed);
		}
	}

	// Back-substitution values (also used silently for the calculator case).
	const last = [...active];
	const solvedVals = new Map<number, Complex>();
	if (last.length === 1 && activeRows.length > 0) {
		const j = last[0];
		const r = activeRows.find((rr) => !W.get(rr)![j].isZero(EPS)) ?? activeRows[0];
		const a = W.get(r)![j];
		if (!a.isZero(EPS)) {
			const rhs = R.get(r)!;
			solvedVals.set(j, rhs.div(a));
			if (!big) {
				latex.push(`\\text{The last equation has one unknown:}`);
				latex.push(
					`${term(a)}\\,${names[j]} = ${val(rhs)} \\;\\Rightarrow\\; ${names[j]} = ${val(rhs).includes('\\frac') || val(a).includes('\\frac') ? `${term(rhs)} \\div ${term(a)}` : `\\frac{${val(rhs)}}{${val(a)}}`} = ${val(solvedVals.get(j)!)}\\text{ ${unit}}`
				);
			}
			for (let k = stack.length - 1; k >= 0; k--) {
				const st = stack[k];
				const sum = st.others.reduce((acc, o) => acc.add(o.c.mul(solvedVals.get(o.j) ?? Complex.zero())), Complex.zero());
				const x = st.rhs.sub(sum).div(st.a);
				solvedVals.set(st.j, x);
				if (!big) {
					if (k === stack.length - 1) latex.push(`\\text{Back-substituting:}`);
					latex.push(
						`${explicitLatex(
							names[st.j],
							st.a,
							st.rhs,
							st.others.map((o) => ({ c: o.c, label: term(solvedVals.get(o.j) ?? Complex.zero()), num: true }))
						)} = ${val(x)}\\text{ ${unit}}`
					);
				}
			}
		}
	}
	if (big && solvedVals.size > 0) {
		latex.push(`\\text{(Solve the remaining equations with the calculator: MODE EQN)}`);
		for (const j of unknownCols) {
			const v = solvedVals.get(j);
			if (v) latex.push(`${names[j]} = ${val(v)}\\text{ ${unit}}`);
		}
	}
	return { latex, remaining: unknownCols.length };
}
