/**
 * Method 5: Iterative Graph-Rewriting Source Transformation Solver.
 *
 * Repeatedly applies genuine network reductions & source transformations:
 *   1. Parallel impedance combining: Z_eq = (sum 1/Z_i)^(-1)
 *   2. Parallel current-source combining: I_eq = sum I_i
 *   3. Series impedance combining across degree-2 internal nodes: Z_eq = Z_1 + Z_2
 *   4. Series voltage-source combining across degree-2 internal nodes
 *   5. Thévenin -> Norton: series (V_s, Z_s) -> parallel (I_N = V_s/Z_s, Z_s)
 *   6. Norton -> Thévenin: parallel (I_s, Z_p) -> series (V_th = I_s*Z_p, Z_p) when enabling reduction
 *
 * Records a reversible reconstruction stack so every eliminated node voltage and
 * original branch current is back-substituted cleanly and cross-verified against MNA (< 1e-8).
 */

import { Complex } from '../complex';
import { buildElectricalGraph, parseSourceValue, latexNodeId } from '../graph';
import { solveComplexLinearSystem } from '../linalg';
import type {
	AnalysisMode,
	CircuitDocument,
	MethodResult,
	MnaSolution,
	SolutionStep
} from '../types';
import {
	formatLatexTerm,
	formatLatexValue,
	getPassiveImpedance,
	hasDependentSources,
	latexSub,
	verifyAgainstMna
} from './shared';

interface RedEdge {
	id: string;
	label: string;
	kind: 'impedance' | 'v_source' | 'i_source';
	u: string; // pin 0
	v: string; // pin 1
	value: Complex; // Z for impedance, V_s for v_source, I_s for i_source
}

type UnwindRecord = (
	nodeV: Map<string, Complex>,
	edgeV: Map<string, Complex>,
	edgeI: Map<string, Complex>
) => void;

function solveReducedCore(
	edges: RedEdge[],
	allNodes: Set<string>
): { nodeV: Map<string, Complex>; edgeV: Map<string, Complex>; edgeI: Map<string, Complex> } | null {
	const refNode = allNodes.has('0') ? '0' : Array.from(allNodes)[0];
	const nonRef = Array.from(allNodes).filter((n) => n !== refNode);
	const nodeIdx = new Map<string, number>();
	nonRef.forEach((n, i) => nodeIdx.set(n, i));

	const vEdges = edges.filter((e) => e.kind === 'v_source');
	const N = nonRef.length;
	const M = vEdges.length;
	const dim = N + M;

	const nodeV = new Map<string, Complex>([[refNode, Complex.zero()]]);
	const edgeV = new Map<string, Complex>();
	const edgeI = new Map<string, Complex>();

	let x: Complex[] = [];
	if (dim > 0) {
		const A: Complex[][] = Array.from({ length: dim }, () =>
			Array.from({ length: dim }, () => Complex.zero())
		);
		const b: Complex[] = Array.from({ length: dim }, () => Complex.zero());

		for (const e of edges) {
			const ia = nodeIdx.get(e.u);
			const ib = nodeIdx.get(e.v);
			if (e.kind === 'impedance') {
				if (e.value.isZero(1e-15)) continue;
				const y = e.value.inv();
				if (ia !== undefined) {
					A[ia][ia] = A[ia][ia].add(y);
					if (ib !== undefined) A[ia][ib] = A[ia][ib].sub(y);
				}
				if (ib !== undefined) {
					A[ib][ib] = A[ib][ib].add(y);
					if (ia !== undefined) A[ib][ia] = A[ib][ia].sub(y);
				}
			} else if (e.kind === 'i_source') {
				if (ia !== undefined) b[ia] = b[ia].sub(e.value);
				if (ib !== undefined) b[ib] = b[ib].add(e.value);
			}
		}

		vEdges.forEach((ve, aux) => {
			const row = N + aux;
			const ia = nodeIdx.get(ve.u);
			const ib = nodeIdx.get(ve.v);
			if (ia !== undefined) {
				A[ia][row] = A[ia][row].add(Complex.one());
				A[row][ia] = A[row][ia].add(Complex.one());
			}
			if (ib !== undefined) {
				A[ib][row] = A[ib][row].sub(Complex.one());
				A[row][ib] = A[row][ib].sub(Complex.one());
			}
			b[row] = ve.value;
		});

		const solved = solveComplexLinearSystem(A, b);
		if (solved.singular) return null;
		x = solved.x;
		nonRef.forEach((n, i) => nodeV.set(n, x[i]));
	}

	vEdges.forEach((ve, aux) => {
		edgeI.set(ve.id, x[N + aux]);
	});

	for (const e of edges) {
		const vA = nodeV.get(e.u) ?? Complex.zero();
		const vB = nodeV.get(e.v) ?? Complex.zero();
		const ve = vA.sub(vB);
		edgeV.set(e.id, ve);
		if (e.kind === 'impedance') {
			edgeI.set(e.id, e.value.isZero(1e-15) ? Complex.zero() : ve.div(e.value));
		} else if (e.kind === 'i_source') {
			edgeI.set(e.id, e.value);
		}
	}

	return { nodeV, edgeV, edgeI };
}

export interface SourceTransformOptions {
	/**
	 * Component whose current/voltage the question asks for (e.g. "find Io through R3").
	 * It is never combined or transformed away, so the reduction stops at a circuit
	 * where its value can be read off directly — the way the course solves it.
	 */
	targetComponentId?: string;
}

export function solveSourceTransform(
	doc: CircuitDocument,
	mna: MnaSolution,
	options: SourceTransformOptions = {}
): MethodResult {
	const title = 'Source Transformation';
	if (!mna.valid) {
		return {
			methodId: 'source_transform',
			title,
			applicable: false,
			inapplicableReason: 'Circuit has topology or value errors; fix validation errors first.',
			steps: []
		};
	}

	if (hasDependentSources(doc)) {
		return {
			methodId: 'source_transform',
			title,
			applicable: false,
			inapplicableReason:
				'Circuit contains dependent source(s). Keep dependent sources and their controlling variables intact — use Nodal Analysis, Mesh Analysis, Superposition, or Thévenin/Norton (Test-Source Method) instead.',
			steps: [
				{
					title: 'Dependent Sources Present',
					description:
						'Iterative source transformation is skipped when dependent sources are present so controlling branch currents and node voltages are never eliminated.'
				}
			]
		};
	}

	const graph = buildElectricalGraph(doc);
	const mode: AnalysisMode = mna.mode;
	const freq = mna.frequencyHz;

	const twoTerminal = doc.components.filter(
		(c) => c.kind !== 'ground' && c.kind !== 'terminal'
	);

	let edges: RedEdge[] = [];
	const openCapacitors: string[] = [];

	for (const comp of twoTerminal) {
		const [u, v] = graph.componentNodes[comp.id];
		if (mode === 'dc' && comp.kind === 'capacitor') {
			openCapacitors.push(comp.id);
			continue;
		}
		if (comp.kind === 'voltage_source') {
			edges.push({
				id: comp.id,
				label: comp.label,
				kind: 'v_source',
				u,
				v,
				value: parseSourceValue(comp, mode)!
			});
		} else if (mode === 'dc' && comp.kind === 'inductor') {
			edges.push({
				id: comp.id,
				label: comp.label,
				kind: 'v_source',
				u,
				v,
				value: Complex.zero()
			});
		} else if (comp.kind === 'current_source') {
			edges.push({
				id: comp.id,
				label: comp.label,
				kind: 'i_source',
				u,
				v,
				value: parseSourceValue(comp, mode)!
			});
		} else {
			const z = getPassiveImpedance(comp, mode, freq)!;
			edges.push({
				id: comp.id,
				label: comp.label,
				kind: 'impedance',
				u,
				v,
				value: z
			});
		}
	}

	const activeNodes = new Set<string>();
	for (const e of edges) {
		activeNodes.add(e.u);
		activeNodes.add(e.v);
	}

	const targetId =
		options.targetComponentId && edges.some((e) => e.id === options.targetComponentId && e.kind === 'impedance')
			? options.targetComponentId
			: undefined;
	const isTarget = (e: RedEdge) => targetId !== undefined && e.id === targetId;

	const steps: SolutionStep[] = [];
	const unwindStack: UnwindRecord[] = [];
	let synthCounter = 1;
	let transformCount = 0;

	const pairKey = (a: string, b: string) => (a < b ? `${a}\0${b}` : `${b}\0${a}`);

	const incidentEdgesOf = (node: string) =>
		edges.filter((e) => e.u === node || e.v === node);

	// Rules 5 (Thévenin→Norton) and 6 (Norton→Thévenin) are inverses. Never let one directly
	// undo the other, or the reduction ping-pongs until MAX_ITERS.
	const nodesFromNortonToThevenin = new Set<string>();
	const sourcesFromTheveninToNorton = new Set<string>();
	let converged = false;

	const MAX_ITERS = 100;
	for (let iter = 0; iter < MAX_ITERS; iter++) {
		let changed = false;

		// Rule 1: Combine parallel impedances between identical (u, v)
		const impByPair = new Map<string, RedEdge[]>();
		for (const e of edges) {
			if (e.kind !== 'impedance' || e.value.isZero(1e-15) || isTarget(e)) continue;
			const pk = pairKey(e.u, e.v);
			const list = impByPair.get(pk) ?? [];
			list.push(e);
			impByPair.set(pk, list);
		}
		for (const group of impByPair.values()) {
			if (group.length < 2) continue;
			let ySum = Complex.zero();
			for (const e of group) ySum = ySum.add(e.value.inv());
			if (ySum.isZero(1e-15)) continue; // exact lossless LC resonance

			const zEq = ySum.inv();
			const u = group[0].u;
			const v = group[0].v;
			const newId = `__st_zp_${synthCounter++}`;
			const newLabel = `Z_{eq${synthCounter - 1}}`;
			const groupIds = new Set(group.map((e) => e.id));
			edges = edges.filter((e) => !groupIds.has(e.id));
			edges.push({ id: newId, label: newLabel, kind: 'impedance', u, v, value: zEq });

			unwindStack.push((nodeV, edgeV, edgeI) => {
				const vUv = (nodeV.get(u) ?? Complex.zero()).sub(nodeV.get(v) ?? Complex.zero());
				for (const g of group) {
					const vG = g.u === u ? vUv : vUv.neg();
					edgeV.set(g.id, vG);
					edgeI.set(g.id, vG.div(g.value));
				}
			});

			steps.push({
				title: `Step ${steps.length + 1}: Combine Parallel Impedances`,
				description: `Combined ${group.map((g) => g.label).join(' || ')} between nodes ${u} and ${v}.`,
				latex: [
					`${newLabel} = \\left(${group.map((g) => `\\frac{1}{${formatLatexTerm(g.value, mode)}}`).join(' + ')}\\right)^{-1} = ${formatLatexValue(zEq, mode)}\\;\\Omega`
				],
				snapshotNote: `Reduced ${group.length} parallel impedances to ${newLabel}.`
			});

			changed = true;
			break;
		}
		if (changed) continue;

		// Rule 2: Combine parallel current sources between identical (u, v)
		const csByPair = new Map<string, RedEdge[]>();
		for (const e of edges) {
			if (e.kind !== 'i_source') continue;
			const pk = pairKey(e.u, e.v);
			const list = csByPair.get(pk) ?? [];
			list.push(e);
			csByPair.set(pk, list);
		}
		for (const group of csByPair.values()) {
			if (group.length < 2) continue;
			const u = group[0].u;
			const v = group[0].v;
			let iSum = Complex.zero();
			for (const g of group) {
				iSum = g.u === u ? iSum.add(g.value) : iSum.sub(g.value);
			}
			const newId = `__st_ip_${synthCounter++}`;
			const newLabel = `I_{eq${synthCounter - 1}}`;
			const groupIds = new Set(group.map((e) => e.id));
			edges = edges.filter((e) => !groupIds.has(e.id));
			edges.push({ id: newId, label: newLabel, kind: 'i_source', u, v, value: iSum });

			unwindStack.push((nodeV, edgeV, edgeI) => {
				const vUv = (nodeV.get(u) ?? Complex.zero()).sub(nodeV.get(v) ?? Complex.zero());
				for (const g of group) {
					edgeV.set(g.id, g.u === u ? vUv : vUv.neg());
					edgeI.set(g.id, g.value);
				}
			});

			steps.push({
				title: `Step ${steps.length + 1}: Combine Parallel Current Sources`,
				description: `Combined parallel current sources (${group.map((g) => g.label).join(', ')}) between ${u} and ${v}.`,
				latex: [
					`${newLabel} = ${formatLatexValue(iSum, mode)}\\text{ A} \\quad (${latexNodeId(u)} \\to ${latexNodeId(v)})`
				]
			});
			changed = true;
			break;
		}
		if (changed) continue;

		// Rule 3: Combine series impedances at internal degree-2 non-reference node w
		const candidateNodes = Array.from(activeNodes).filter((n) => n !== '0');
		for (const w of candidateNodes) {
			const inc = incidentEdgesOf(w);
			if (inc.length !== 2) continue;
			const [e1, e2] = inc;
			if (e1.id === e2.id) continue;
			if (isTarget(e1) || isTarget(e2)) continue;
			if (e1.kind === 'impedance' && e2.kind === 'impedance') {
				const u = e1.u === w ? e1.v : e1.u;
				const v = e2.u === w ? e2.v : e2.u;
				if (u === v) continue; // parallel loop already or keep 2-node loop
				const zEq = e1.value.add(e2.value);
				const newId = `__st_zs_${synthCounter++}`;
				const newLabel = `Z_{s${synthCounter - 1}}`;

				edges = edges.filter((e) => e.id !== e1.id && e.id !== e2.id);
				edges.push({ id: newId, label: newLabel, kind: 'impedance', u, v, value: zEq });
				activeNodes.delete(w);

				unwindStack.push((nodeV, edgeV, edgeI) => {
					const iSeries = edgeI.get(newId)!; // flows u -> v
					const vU = nodeV.get(u) ?? Complex.zero();
					const vDrop1 = iSeries.mul(e1.value);
					const vW = vU.sub(vDrop1);
					nodeV.set(w, vW);
					edgeV.set(e1.id, e1.u === u ? vDrop1 : vDrop1.neg());
					edgeI.set(e1.id, e1.u === u ? iSeries : iSeries.neg());
					const vDrop2 = iSeries.mul(e2.value);
					edgeV.set(e2.id, e2.v === v ? vDrop2 : vDrop2.neg());
					edgeI.set(e2.id, e2.v === v ? iSeries : iSeries.neg());
				});

				steps.push({
					title: `Step ${steps.length + 1}: Combine Series Impedances`,
					description: `Combined ${e1.label} and ${e2.label} in series across node ${w}.`,
					latex: [
						`${newLabel} = ${formatLatexValue(e1.value, mode)} + ${formatLatexValue(e2.value, mode)} = ${formatLatexValue(zEq, mode)}\\;\\Omega`
					]
				});
				changed = true;
				break;
			}
		}
		if (changed) continue;

		// Rule 4: Combine series voltage sources at degree-2 internal node w
		for (const w of candidateNodes) {
			const inc = incidentEdgesOf(w);
			if (inc.length !== 2) continue;
			const [e1, e2] = inc;
			if (e1.kind === 'v_source' && e2.kind === 'v_source') {
				const u = e1.u === w ? e1.v : e1.u;
				const v = e2.u === w ? e2.v : e2.u;
				if (u === v) continue;
				// V(u) - V(w) = (+1 or -1) * e1.value; V(w) - V(v) = (+1 or -1) * e2.value
				const s1 = e1.u === u ? e1.value : e1.value.neg();
				const s2 = e2.u === w ? e2.value : e2.value.neg();
				const vEq = s1.add(s2);
				const newId = `__st_vs_${synthCounter++}`;
				const newLabel = `V_{eq${synthCounter - 1}}`;

				edges = edges.filter((e) => e.id !== e1.id && e.id !== e2.id);
				edges.push({ id: newId, label: newLabel, kind: 'v_source', u, v, value: vEq });
				activeNodes.delete(w);

				unwindStack.push((nodeV, edgeV, edgeI) => {
					const iSeries = edgeI.get(newId)!; // u -> v
					const vU = nodeV.get(u) ?? Complex.zero();
					const vW = vU.sub(s1);
					nodeV.set(w, vW);
					edgeV.set(e1.id, e1.value);
					edgeI.set(e1.id, e1.u === u ? iSeries : iSeries.neg());
					edgeV.set(e2.id, e2.value);
					edgeI.set(e2.id, e2.v === v ? iSeries : iSeries.neg());
				});

				steps.push({
					title: `Step ${steps.length + 1}: Combine Series Voltage Sources`,
					description: `Combined series voltage sources ${e1.label} and ${e2.label} at node ${w}.`,
					latex: [`${newLabel} = ${formatLatexValue(vEq, mode)}\\text{ V}`]
				});
				changed = true;
				break;
			}
		}
		if (changed) continue;

		// Rule 5: Thévenin -> Norton (series V_s + Z_s at degree-2 node w -> parallel I_N || Z_s)
		// Apply only if outer nodes (u, v) still have other edges (so reducing w simplifies the graph)
		for (const w of candidateNodes) {
			const inc = incidentEdgesOf(w);
			if (inc.length !== 2) continue;
			if (nodesFromNortonToThevenin.has(w)) continue;
			const vEdge = inc.find((e) => e.kind === 'v_source');
			const zEdge = inc.find((e) => e.kind === 'impedance');
			if (!vEdge || !zEdge || zEdge.value.isZero(1e-15) || isTarget(zEdge)) continue;

			const u = vEdge.u === w ? vEdge.v : vEdge.u; // outer node on V side
			const v = zEdge.u === w ? zEdge.v : zEdge.u; // outer node on Z side
			if (u === v) continue;
			// Only transform if there are other branches outside this single pair
			if (edges.length <= 2) continue;

			// Open-circuit potential at v relative to u: V(v) - V(u)
			// Note: vEdge gives V(vEdge.u) - V(vEdge.v) = vEdge.value
			// If vEdge.u === w and vEdge.v === u, then V(w) - V(u) = +vEdge.value => I_N pushes u -> v!
			const vRiseUtoW = vEdge.u === w ? vEdge.value : vEdge.value.neg();
			const iN = vRiseUtoW.div(zEdge.value); // current directed u -> v

			const newIId = `__st_in_${synthCounter++}`;
			const newZId = `__st_zn_${synthCounter++}`;
			const newILabel = `I_{N${transformCount + 1}}`;
			const newZLabel = `${zEdge.label}`;

			edges = edges.filter((e) => e.id !== vEdge.id && e.id !== zEdge.id);
			edges.push({ id: newIId, label: newILabel, kind: 'i_source', u, v, value: iN });
			sourcesFromTheveninToNorton.add(newIId);
			edges.push({
				id: newZId,
				label: newZLabel,
				kind: 'impedance',
				u,
				v,
				value: zEdge.value
			});
			activeNodes.delete(w);

			unwindStack.push((nodeV, edgeV, edgeI) => {
				const vU = nodeV.get(u) ?? Complex.zero();
				const vV = nodeV.get(v) ?? Complex.zero();
				const vW = vU.add(vRiseUtoW);
				nodeV.set(w, vW);

				// Voltage and current on zEdge (between w and v)
				const vZ = zEdge.u === w ? vW.sub(vV) : vV.sub(vW);
				const iZ = vZ.div(zEdge.value);
				edgeV.set(zEdge.id, vZ);
				edgeI.set(zEdge.id, iZ);

				// Current leaving w into zEdge must equal current entering w from vEdge
				const iLeavingWtoZ = zEdge.u === w ? iZ : iZ.neg();
				const iV = vEdge.u === w ? iLeavingWtoZ.neg() : iLeavingWtoZ;
				edgeV.set(vEdge.id, vEdge.value);
				edgeI.set(vEdge.id, iV);
			});

			transformCount++;
			steps.push({
				title: `Step ${steps.length + 1}: Source Transform (Thévenin → Norton)`,
				description: `Transformed series ${vEdge.label} (${formatLatexValue(vRiseUtoW, mode)} V) and ${zEdge.label} into Norton current source ${newILabel} in parallel with ${newZLabel} between ${u} and ${v}.`,
				latex: [
					`${newILabel} = \\frac{V_s}{Z_s} = \\frac{${formatLatexValue(vRiseUtoW, mode)}}{${formatLatexValue(zEdge.value, mode)}} = ${formatLatexValue(iN, mode)}\\text{ A}\\;(${latexNodeId(u)} \\to ${latexNodeId(v)})`
				],
				snapshotNote: `Eliminated node ${w} via V→I transformation.`
			});
			changed = true;
			break;
		}
		if (changed) continue;

		// Rule 6: Norton -> Thévenin (parallel I_s || Z_p between (u, v))
		// Apply ONLY when one of the endpoints (non-ground) has total degree === 3 (I_s, Z_p, plus 1 series branch),
		// guaranteeing that the next iteration combines impedances in series!
		const csCandidates = edges.filter((e) => e.kind === 'i_source');
		for (const cs of csCandidates) {
			if (sourcesFromTheveninToNorton.has(cs.id)) continue;
			const zPartner = edges.find(
				(e) =>
					e.kind === 'impedance' &&
					!e.value.isZero(1e-15) &&
					!isTarget(e) &&
					((e.u === cs.u && e.v === cs.v) || (e.u === cs.v && e.v === cs.u))
			);
			if (!zPartner) continue;

			const degU = incidentEdgesOf(cs.u).length;
			const degV = incidentEdgesOf(cs.v).length;

			// Pick pivot endpoint (non-ground preferred, with degree === 3 so it reduces immediately)
			let expandAt: string | null = null;
			let fixedAt: string | null = null;
			if (cs.v !== '0' && degV === 3) {
				expandAt = cs.v;
				fixedAt = cs.u;
			} else if (cs.u !== '0' && degU === 3) {
				expandAt = cs.u;
				fixedAt = cs.v;
			}
			if (!expandAt || !fixedAt) continue;

			// Create new internal node w: V_th between fixedAt and w, Z_p between w and expandAt
			const wNew = `N_st${synthCounter}`;
			const iFixedToExpand = cs.u === fixedAt ? cs.value : cs.value.neg();
			const vTh = iFixedToExpand.mul(zPartner.value); // V(w) - V(fixedAt) = vTh

			const newVId = `__st_vth_${synthCounter}`;
			const newZId = `__st_zth_${synthCounter}`;
			const newVLabel = `V_{th${transformCount + 1}}`;
			synthCounter++;

			edges = edges.filter((e) => e.id !== cs.id && e.id !== zPartner.id);
			// V_th has pin0 (+) at wNew and pin1 (-) at fixedAt => V(wNew) - V(fixedAt) = vTh
			edges.push({
				id: newVId,
				label: newVLabel,
				kind: 'v_source',
				u: wNew,
				v: fixedAt,
				value: vTh
			});
			edges.push({
				id: newZId,
				label: zPartner.label,
				kind: 'impedance',
				u: wNew,
				v: expandAt,
				value: zPartner.value
			});
			activeNodes.add(wNew);
			nodesFromNortonToThevenin.add(wNew);

			unwindStack.push((nodeV, edgeV, edgeI) => {
				const vFixed = nodeV.get(fixedAt!) ?? Complex.zero();
				const vExp = nodeV.get(expandAt!) ?? Complex.zero();
				const vDiff = cs.u === fixedAt ? vFixed.sub(vExp) : vExp.sub(vFixed);
				edgeV.set(cs.id, vDiff);
				edgeI.set(cs.id, cs.value);

				const vZ = zPartner.u === fixedAt ? vFixed.sub(vExp) : vExp.sub(vFixed);
				edgeV.set(zPartner.id, vZ);
				edgeI.set(zPartner.id, vZ.div(zPartner.value));
			});

			transformCount++;
			steps.push({
				title: `Step ${steps.length + 1}: Source Transform (Norton → Thévenin)`,
				description: `Transformed parallel ${cs.label} || ${zPartner.label} between ${fixedAt} and ${expandAt} into series ${newVLabel} and ${zPartner.label}.`,
				latex: [
					`${newVLabel} = I_s \\cdot Z_p = ${formatLatexTerm(iFixedToExpand, mode)} \\cdot ${formatLatexTerm(zPartner.value, mode)} = ${formatLatexValue(vTh, mode)}\\text{ V}`
				],
				snapshotNote: `Created series branch ready for combination at ${expandAt}.`
			});
			changed = true;
			break;
		}

		if (!changed) {
			converged = true;
			break;
		}
	}

	if (!converged) {
		return {
			methodId: 'source_transform',
			title,
			applicable: false,
			inapplicableReason:
				'Source transformations did not settle on a reduced circuit for this topology; use nodal or mesh analysis instead.',
			steps: []
		};
	}

	// Solve the final simplified circuit independently
	const reduced = solveReducedCore(edges, activeNodes);
	if (!reduced) {
		return {
			methodId: 'source_transform',
			title,
			applicable: false,
			inapplicableReason: 'The simplified circuit could not be solved.',
			steps
		};
	}

	// Unwind reconstruction stack in reverse to recover all original node voltages & branch values
	for (let i = unwindStack.length - 1; i >= 0; i--) {
		unwindStack[i](reduced.nodeV, reduced.edgeV, reduced.edgeI);
	}

	const nodeVoltages: Record<string, Complex> = {};
	for (const nid of Object.keys(graph.nodes)) {
		nodeVoltages[nid] = reduced.nodeV.get(nid) ?? Complex.zero();
	}

	const branchVoltages: Record<string, Complex> = {};
	const branchCurrents: Record<string, Complex> = {};
	for (const comp of twoTerminal) {
		if (openCapacitors.includes(comp.id)) {
			const [nA, nB] = graph.componentNodes[comp.id];
			branchVoltages[comp.id] = nodeVoltages[nA].sub(nodeVoltages[nB]);
			branchCurrents[comp.id] = Complex.zero();
		} else {
			branchVoltages[comp.id] = reduced.edgeV.get(comp.id) ?? Complex.zero();
			branchCurrents[comp.id] = reduced.edgeI.get(comp.id) ?? Complex.zero();
		}
	}

	const irreducibleNote =
		edges.length > 3
			? `Simplified to a ${activeNodes.size}-node, ${edges.length}-branch circuit, solved it, then worked back to every branch that was removed.`
			: 'Simplified the circuit with source transformations and series/parallel combinations, then worked back to every branch.';

	const finalLatex = graph.nonRefNodeIds.map(
		(nid) => `V_{${latexNodeId(nid)}} = ${formatLatexValue(nodeVoltages[nid], mode)}\\text{ V}`
	);

	// Course-style finish: the asked branch is still in the circuit, so read its value off
	// the reduced circuit with one rule (current divider / Ohm's law) instead of a core solve.
	const targetEdge = targetId ? edges.find((e) => e.id === targetId) : undefined;
	if (targetEdge) {
		const tLabel = latexSub(targetEdge.label);
		const iT = reduced.edgeI.get(targetEdge.id) ?? Complex.zero();
		const vT = reduced.edgeV.get(targetEdge.id) ?? Complex.zero();
		const between = (e: RedEdge) => pairKey(e.u, e.v) === pairKey(targetEdge.u, targetEdge.v);
		const twoNode = edges.every(between);
		// Walk the circuit from the target's v end back to its u end (direction of I_target).
		// Returns the loop if the reduced circuit is one series loop of V sources and impedances.
		const singleLoop = (): { e: RedEdge; from: string; to: string }[] | null => {
			if (edges.some((e) => e.kind === 'i_source')) return null;
			const deg = new Map<string, number>();
			for (const e of edges) for (const n of [e.u, e.v]) deg.set(n, (deg.get(n) ?? 0) + 1);
			if ([...deg.values()].some((d) => d !== 2)) return null;
			const path: { e: RedEdge; from: string; to: string }[] = [{ e: targetEdge, from: targetEdge.u, to: targetEdge.v }];
			let at = targetEdge.v;
			let prev = targetEdge;
			while (at !== targetEdge.u) {
				const next = edges.find((e) => e !== prev && (e.u === at || e.v === at));
				if (!next) return null;
				const to = next.u === at ? next.v : next.u;
				path.push({ e: next, from: at, to });
				prev = next;
				at = to;
				if (path.length > edges.length) return null;
			}
			return path.length === edges.length ? path : null;
		};
		const finishLatex: string[] = [];
		let finishDesc: string;
		if (twoNode) {
			const zs = edges.filter((e) => e.kind === 'impedance');
			const ySum = zs.reduce((acc, e) => acc.add(e.value.inv()), Complex.zero());
			const iTot = vT.mul(ySum);
			finishDesc = `Everything left sits in parallel with ${targetEdge.label}: one node pair. The total source current splits by admittance (current divider).`;
			finishLatex.push(
				`V_{${tLabel}} = \\frac{I_{\\text{total}}}{\\sum Y},\\quad \\sum Y = ${zs.map((e) => `\\frac{1}{${formatLatexTerm(e.value, mode)}}`).join(' + ')} = ${formatLatexValue(ySum, mode)}\\text{ S}`,
				`V_{${tLabel}} = ${formatLatexTerm(iTot, mode)} \\div ${formatLatexTerm(ySum, mode)} = ${formatLatexValue(vT, mode)}\\text{ V}`,
				`I_{${tLabel}} = \\frac{V_{${tLabel}}}{${formatLatexTerm(targetEdge.value, mode)}} = ${formatLatexValue(iT, mode)}\\text{ A}`
			);
		} else if (singleLoop()) {
			const loop = singleLoop()!;
			const zSum = loop.filter((x) => x.e.kind === 'impedance').reduce((acc, x) => acc.add(x.e.value), Complex.zero());
			const rises = loop
				.filter((x) => x.e.kind === 'v_source')
				.map((x) => (x.e.u === x.to ? x.e.value : x.e.value.neg()));
			const emf = rises.reduce((acc, r) => acc.add(r), Complex.zero());
			finishDesc = `Only one loop is left, and ${targetEdge.label} is in it. KVL around the loop: sum of source voltages = I × sum of impedances.`;
			if (emf.div(zSum).equals(iT, 1e-9)) {
				const num = rises.map((r, k) => (k === 0 ? formatLatexValue(r, mode) : `${r.re < 0 && r.isReal() ? '-' : '+'} ${formatLatexValue(r.isReal() && r.re < 0 ? r.neg() : r, mode)}`)).join(' ');
				finishLatex.push(
					`I_{${tLabel}} = \\frac{\\sum V}{\\sum Z} = \\frac{${num}}{${loop.filter((x) => x.e.kind === 'impedance').map((x) => formatLatexTerm(x.e.value, mode)).join(' + ')}} = ${formatLatexValue(iT, mode)}\\text{ A}`,
					`V_{${tLabel}} = I_{${tLabel}} \\cdot ${formatLatexTerm(targetEdge.value, mode)} = ${formatLatexValue(vT, mode)}\\text{ V}`
				);
			} else {
				finishLatex.push(`I_{${tLabel}} = ${formatLatexValue(iT, mode)}\\text{ A}`, `V_{${tLabel}} = ${formatLatexValue(vT, mode)}\\text{ V}`);
			}
		} else {
			finishDesc = `No further source transformation simplifies the circuit around ${targetEdge.label}; the remaining ${edges.length}-branch circuit is solved directly.`;
			finishLatex.push(
				`I_{${tLabel}} = ${formatLatexValue(iT, mode)}\\text{ A}`,
				`V_{${tLabel}} = ${formatLatexValue(vT, mode)}\\text{ V}`
			);
		}
		steps.push({
			title: `Step ${steps.length + 1}: Read Off ${targetEdge.label}`,
			description: finishDesc,
			latex: finishLatex,
			highlightIds: [targetEdge.id]
		});
	}

	steps.push({
		title: `Step ${steps.length + 1}: All Node Voltages and Branch Currents`,
		description: irreducibleNote,
		latex: [
			...finalLatex,
			...twoTerminal.slice(0, 4).map(
				(c) => `I_{${latexSub(c.label)}} = ${formatLatexValue(branchCurrents[c.id], mode)}\\text{ A}`
			)
		],
		snapshotNote: `Applied ${transformCount} source transformation(s) and ${unwindStack.length} total reduction step(s).`
	});

	const verification = verifyAgainstMna(mna, {
		nodeVoltages,
		branchVoltages,
		branchCurrents
	});

	return {
		methodId: 'source_transform',
		title,
		applicable: true,
		steps: mergeRepeatedSteps(steps),
		summaryLatex: `\\begin{aligned} ${finalLatex
			.slice(0, 6)
			.map((s) => s.replace(' = ', ' &= '))
			.join(' \\\\ ')} \\end{aligned}`,
		...verification
	};
}

/**
 * Merges consecutive steps of the same kind (e.g. three "Combine Series Impedances" in a
 * row) into one step with all their equations, and renumbers. A hand solution writes
 * "R1 + R2 = 3 kΩ, R3 + R4 = 5 kΩ" on one line, not as separate steps.
 */
export function mergeRepeatedSteps(steps: SolutionStep[]): SolutionStep[] {
	const kindOf = (t: string) => t.replace(/^Step \d+:\s*/, '');
	const merged: SolutionStep[] = [];
	for (const step of steps) {
		const prev = merged.at(-1);
		if (prev && kindOf(prev.title) === kindOf(step.title) && !step.matrixLatex && !prev.matrixLatex) {
			prev.description = `${prev.description} ${step.description}`;
			prev.latex = [...(prev.latex ?? []), ...(step.latex ?? [])];
			if (step.highlightIds) prev.highlightIds = [...(prev.highlightIds ?? []), ...step.highlightIds];
			if (step.snapshotNote) prev.snapshotNote = [prev.snapshotNote, step.snapshotNote].filter(Boolean).join(' ');
		} else {
			merged.push({ ...step, latex: step.latex ? [...step.latex] : undefined });
		}
	}
	return merged.map((st, i) => ({ ...st, title: `Step ${i + 1}: ${kindOf(st.title)}` }));
}
