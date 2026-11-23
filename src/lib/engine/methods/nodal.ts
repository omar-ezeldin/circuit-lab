/**
 * Method 2: Nodal Analysis (with Known-Node Identification, Supernodes & Dependent Sources).
 *
 * Independently identifies:
 *   1. Reference node "0"
 *   2. Nodes whose voltage is directly fixed by independent voltage-constraint branches connected to "0"
 *   3. Supernodes formed by floating voltage sources (independent or dependent) and DC inductors
 *   4. Dependent source controlling variable substitutions in terms of node voltages
 *
 * Assembles and solves the reduced nodal linear system A * V = b,
 * recovers voltage-source currents from the branch currents, and cross-verifies against MNA.
 */

import { Complex } from '../complex';
import {
	buildElectricalGraph,
	parseDependentGain,
	parseSourceValue,
	resolveDependentControlNodes,
	latexNodeId
} from '../graph';
import { solveComplexLinearSystem } from '../linalg';
import {
	isDependentSourceKind,
	isDependentVoltageSource,
	type CircuitComponent,
	type CircuitDocument,
	type MethodResult,
	type MnaSolution,
	type SolutionStep
} from '../types';
import {
	courseSolveDisplay,
	formatDependentSourceExpr,
	formatLatexTerm,
	formatLatexValue,
	getPassiveAdmittance,
	latexSub,
	verifyAgainstMna
} from './shared';

interface ConstraintBranch {
	comp: CircuitComponent;
	nodeA: string;
	nodeB: string;
	/** Constant voltage for independent voltage sources / DC inductors; null for VCVS / CCVS */
	voltage: Complex | null;
}

interface NodalLinearExpr {
	/** Unknown node index -> coefficient */
	terms: Map<number, Complex>;
	/** Constant value (from known node voltages or independent current sources) */
	constant: Complex;
}

function addTerm(map: Map<number, Complex>, idx: number, coeff: Complex): void {
	const prev = map.get(idx);
	map.set(idx, prev ? prev.add(coeff) : coeff);
}

function scaleExpr(expr: NodalLinearExpr, factor: Complex): NodalLinearExpr {
	const terms = new Map<number, Complex>();
	for (const [idx, c] of expr.terms.entries()) {
		terms.set(idx, c.mul(factor));
	}
	return { terms, constant: expr.constant.mul(factor) };
}

function addExprInto(target: NodalLinearExpr, source: NodalLinearExpr, sign: 1 | -1): void {
	const s = Complex.from(sign, 0);
	for (const [idx, c] of source.terms.entries()) {
		addTerm(target.terms, idx, c.mul(s));
	}
	target.constant = target.constant.add(source.constant.mul(s));
}

export function solveNodal(doc: CircuitDocument, mna: MnaSolution): MethodResult {
	const title = 'Nodal Analysis';
	if (!mna.valid) {
		return {
			methodId: 'nodal',
			title,
			applicable: false,
			inapplicableReason: 'Circuit has topology or value errors; fix validation errors first.',
			steps: []
		};
	}

	const graph = buildElectricalGraph(doc);
	const mode = mna.mode;
	const freq = mna.frequencyHz;
	const nonRefNodes = graph.nonRefNodeIds;

	const twoTerminal = doc.components.filter(
		(c) => c.kind !== 'ground' && c.kind !== 'terminal'
	);

	// Identify voltage-constraint branches (independent voltage sources, dependent voltage sources, DC shorted inductors)
	const indepConstraintBranches: ConstraintBranch[] = [];
	const allConstraintBranches: ConstraintBranch[] = [];
	const nonConstraintBranches: CircuitComponent[] = [];
	const compById = new Map<string, CircuitComponent>();

	for (const comp of twoTerminal) {
		compById.set(comp.id, comp);
		const [nodeA, nodeB] = graph.componentNodes[comp.id];
		if (comp.kind === 'voltage_source' || (mode === 'dc' && comp.kind === 'inductor')) {
			const voltage =
				comp.kind === 'voltage_source' ? parseSourceValue(comp, mode)! : Complex.zero();
			const cb: ConstraintBranch = { comp, nodeA, nodeB, voltage };
			indepConstraintBranches.push(cb);
			allConstraintBranches.push(cb);
		} else if (isDependentVoltageSource(comp.kind)) {
			allConstraintBranches.push({ comp, nodeA, nodeB, voltage: null });
		} else {
			nonConstraintBranches.push(comp);
		}
	}

	// 1. Propagate known constant node voltages from reference node "0" along independent constraint branches
	const knownVoltages = new Map<string, Complex>([['0', Complex.zero()]]);
	const indepAdj = new Map<string, Array<{ branch: ConstraintBranch; other: string }>>();
	for (const nid of ['0', ...nonRefNodes]) indepAdj.set(nid, []);
	for (const cb of indepConstraintBranches) {
		indepAdj.get(cb.nodeA)?.push({ branch: cb, other: cb.nodeB });
		indepAdj.get(cb.nodeB)?.push({ branch: cb, other: cb.nodeA });
	}

	const bfsQueue = ['0'];
	while (bfsQueue.length > 0) {
		const curr = bfsQueue.shift()!;
		const currV = knownVoltages.get(curr)!;
		for (const { branch, other } of indepAdj.get(curr) ?? []) {
			if (!knownVoltages.has(other) && branch.voltage !== null) {
				// V(nodeA) - V(nodeB) = branch.voltage
				const nextV =
					branch.nodeA === curr
						? currV.sub(branch.voltage)
						: currV.add(branch.voltage);
				knownVoltages.set(other, nextV);
				bfsQueue.push(other);
			}
		}
	}

	// 2. Remaining unknown nodes -> group into supernodes via ALL active constraint branches
	//    (including dependent voltage sources connected to known/ground nodes)
	const unknownNodes = nonRefNodes.filter((id) => !knownVoltages.has(id));
	const unknownIdx = new Map<string, number>();
	unknownNodes.forEach((id, i) => unknownIdx.set(id, i));

	const KNOWN_SENTINEL = '__KNOWN__';
	const ufParent = new Map<string, string>([[KNOWN_SENTINEL, KNOWN_SENTINEL]]);
	for (const nid of unknownNodes) ufParent.set(nid, nid);
	const findSn = (x: string): string => {
		let r = x;
		while (ufParent.get(r) !== r) r = ufParent.get(r)!;
		let cur = x;
		while (cur !== r) {
			const nxt = ufParent.get(cur)!;
			ufParent.set(cur, r);
			cur = nxt;
		}
		return r;
	};
	const unionSn = (a: string, b: string) => {
		const ra = findSn(a);
		const rb = findSn(b);
		if (ra === rb) return;
		if (ra === KNOWN_SENTINEL) ufParent.set(rb, KNOWN_SENTINEL);
		else if (rb === KNOWN_SENTINEL) ufParent.set(ra, KNOWN_SENTINEL);
		else ufParent.set(ra, rb);
	};

	const activeConstraints: ConstraintBranch[] = [];
	for (const cb of allConstraintBranches) {
		const aUnknown = unknownIdx.has(cb.nodeA);
		const bUnknown = unknownIdx.has(cb.nodeB);
		if (!aUnknown && !bUnknown) continue; // both ends already fixed to constants
		activeConstraints.push(cb);
		unionSn(aUnknown ? cb.nodeA : KNOWN_SENTINEL, bUnknown ? cb.nodeB : KNOWN_SENTINEL);
	}

	const supernodeMap = new Map<string, string[]>();
	for (const nid of unknownNodes) {
		const root = findSn(nid);
		const list = supernodeMap.get(root) ?? [];
		list.push(nid);
		supernodeMap.set(root, list);
	}

	// Helper: node voltage expression V(nid) in terms of unknown node vector
	const nodeVoltageExpr = (nid: string): NodalLinearExpr => {
		const terms = new Map<number, Complex>();
		if (knownVoltages.has(nid)) {
			return { terms, constant: knownVoltages.get(nid)! };
		}
		const idx = unknownIdx.get(nid);
		if (idx !== undefined) {
			terms.set(idx, Complex.one());
		}
		return { terms, constant: Complex.zero() };
	};

	const nodeDiffExpr = (nA: string, nB: string): NodalLinearExpr => {
		const res: NodalLinearExpr = { terms: new Map(), constant: Complex.zero() };
		addExprInto(res, nodeVoltageExpr(nA), 1);
		addExprInto(res, nodeVoltageExpr(nB), -1);
		return res;
	};

	// Adjacency of all constraint branches (forest) for fundamental-cutset current resolution
	const constraintAdjAll = new Map<string, Array<{ cb: ConstraintBranch; other: string }>>();
	for (const nid of ['0', ...nonRefNodes]) constraintAdjAll.set(nid, []);
	for (const cb of allConstraintBranches) {
		constraintAdjAll.get(cb.nodeA)?.push({ cb, other: cb.nodeB });
		constraintAdjAll.get(cb.nodeB)?.push({ cb, other: cb.nodeA });
	}

	// Resolve any branch's current I(pin0 -> pin1) as a linear expression in unknown node voltages
	const resolveBranchCurrentExpr = (
		compId: string,
		visited: Set<string>
	): NodalLinearExpr | null => {
		if (visited.has(compId)) return null;
		const comp = compById.get(compId);
		if (!comp) return null;
		visited.add(compId);
		const [nA, nB] = graph.componentNodes[comp.id];

		let result: NodalLinearExpr | null = null;
		if (comp.kind === 'current_source') {
			result = { terms: new Map(), constant: parseSourceValue(comp, mode)! };
		} else if (comp.kind === 'resistor' || comp.kind === 'capacitor' || comp.kind === 'inductor') {
			if (mode === 'dc' && comp.kind === 'inductor') {
				result = resolveConstraintBranchCurrentViaCutset(comp.id, visited);
			} else {
				const y = getPassiveAdmittance(comp, mode, freq);
				result = y && !y.isZero(1e-15) ? scaleExpr(nodeDiffExpr(nA, nB), y) : { terms: new Map(), constant: Complex.zero() };
			}
		} else if (comp.kind === 'vccs') {
			const ctrl = resolveDependentControlNodes(comp, graph)!;
			const pol = comp.controlRef?.controlPolarity ?? 1;
			const gm = parseDependentGain(comp, mode)!.scale(pol);
			result = scaleExpr(nodeDiffExpr(ctrl.ctrlPos, ctrl.ctrlNeg), gm);
		} else if (comp.kind === 'cccs') {
			const sub = resolveBranchCurrentExpr(comp.controlRef!.controlBranchComponentId!, visited);
			if (sub) {
				const pol = comp.controlRef?.controlPolarity ?? 1;
				const beta = parseDependentGain(comp, mode)!.scale(pol);
				result = scaleExpr(sub, beta);
			}
		} else if (comp.kind === 'voltage_source' || isDependentVoltageSource(comp.kind)) {
			result = resolveConstraintBranchCurrentViaCutset(comp.id, visited);
		}

		visited.delete(compId);
		return result;
	};

	const resolveConstraintBranchCurrentViaCutset = (
		compId: string,
		visited: Set<string>
	): NodalLinearExpr | null => {
		const cb = allConstraintBranches.find((c) => c.comp.id === compId);
		if (!cb) return null;

		// BFS from nodeA without crossing `cb` to find the side S of the constraint forest
		const collectSide = (start: string): Set<string> => {
			const side = new Set<string>([start]);
			const q = [start];
			while (q.length > 0) {
				const u = q.shift()!;
				for (const edge of constraintAdjAll.get(u) ?? []) {
					if (edge.cb.comp.id === compId) continue;
					if (!side.has(edge.other)) {
						side.add(edge.other);
						q.push(edge.other);
					}
				}
			}
			return side;
		};

		const sideA = collectSide(cb.nodeA);
		const useSideA = !sideA.has('0');
		const side = useSideA ? sideA : collectSide(cb.nodeB);

		// KCL on cutset `side`: I_cb_leaving_side + sum(nonConstraint leaving side) = 0
		const sumNonConstraintLeaving: NodalLinearExpr = {
			terms: new Map(),
			constant: Complex.zero()
		};
		for (const nc of nonConstraintBranches) {
			const [a, b] = graph.componentNodes[nc.id];
			const inA = side.has(a);
			const inB = side.has(b);
			if (inA === inB) continue;
			const expr = resolveBranchCurrentExpr(nc.id, visited);
			if (!expr) return null;
			addExprInto(sumNonConstraintLeaving, expr, inA ? 1 : -1);
		}

		// If useSideA, cb leaves `side` in direction nodeA -> nodeB (+1), so I_cb = -sumNonConstraintLeaving
		// Else cb enters `side` in direction nodeA -> nodeB (-1), so I_cb = +sumNonConstraintLeaving
		return scaleExpr(sumNonConstraintLeaving, Complex.from(useSideA ? -1 : 1, 0));
	};

	// 3. Assemble reduced U x U nodal matrix A * V_unknown = b
	const U = unknownNodes.length;
	const A: Complex[][] = Array.from({ length: U }, () =>
		Array.from({ length: U }, () => Complex.zero())
	);
	const b: Complex[] = Array.from({ length: U }, () => Complex.zero());
	const kclLatex: string[] = [];
	const dependentLatex: string[] = [];
	const hasDependentSrc = twoTerminal.some((c) => isDependentSourceKind(c.kind));

	// Record pedagogical dependent source equations
	for (const comp of twoTerminal) {
		if (!isDependentSourceKind(comp.kind)) continue;
		const sub = latexSub(comp.label);
		const exprTex = formatDependentSourceExpr(comp, doc, mode);
		const lhs = isDependentVoltageSource(comp.kind) ? `V_{${sub}}` : `I_{${sub}}`;
		dependentLatex.push(`${lhs} = ${exprTex}`);
	}

	const stampExprIntoRow = (targetRow: number, expr: NodalLinearExpr, sign: 1 | -1) => {
		const s = Complex.from(sign, 0);
		for (const [col, coeff] of expr.terms.entries()) {
			A[targetRow][col] = A[targetRow][col].add(coeff.mul(s));
		}
		// Moving constant to RHS negates sign
		b[targetRow] = b[targetRow].sub(expr.constant.mul(s));
	};

	const stampConstraintEquation = (targetRow: number, cb: ConstraintBranch): boolean => {
		// V(nodeA) - V(nodeB) = V_cb
		const lhsDiff = nodeDiffExpr(cb.nodeA, cb.nodeB);
		stampExprIntoRow(targetRow, lhsDiff, 1);

		if (cb.voltage !== null) {
			b[targetRow] = b[targetRow].add(cb.voltage);
			kclLatex.push(
				`\\text{Supernode (${latexSub(cb.comp.label)}):}\\; V_{${latexNodeId(cb.nodeA)}} - V_{${latexNodeId(cb.nodeB)}} = ${formatLatexValue(cb.voltage, mode)}`
			);
			return true;
		}

		// Dependent voltage source (VCVS or CCVS)
		const pol = cb.comp.controlRef?.controlPolarity ?? 1;
		const gain = parseDependentGain(cb.comp, mode)!.scale(pol);
		let depExpr: NodalLinearExpr | null = null;
		if (cb.comp.kind === 'vcvs') {
			const ctrl = resolveDependentControlNodes(cb.comp, graph)!;
			depExpr = scaleExpr(nodeDiffExpr(ctrl.ctrlPos, ctrl.ctrlNeg), gain);
		} else {
			const ctrlI = resolveBranchCurrentExpr(
				cb.comp.controlRef!.controlBranchComponentId!,
				new Set()
			);
			if (!ctrlI) return false;
			depExpr = scaleExpr(ctrlI, gain);
		}
		// V(nodeA) - V(nodeB) - depExpr = 0
		stampExprIntoRow(targetRow, depExpr, -1);
		const exprTex = formatDependentSourceExpr(cb.comp, doc, mode);
		const vA = cb.nodeA === '0' ? '0' : `V_{${latexNodeId(cb.nodeA)}}`;
		const vB = cb.nodeB === '0' ? '' : ` - V_{${latexNodeId(cb.nodeB)}}`;
		kclLatex.push(`\\text{Dependent source (${latexSub(cb.comp.label)}):}\\; ${vA}${vB} = ${exprTex}`);
		return true;
	};

	let row = 0;
	for (const [root, group] of supernodeMap.entries()) {
		const groupSet = new Set(group);
		const touchesKnown = root === KNOWN_SENTINEL;

		if (!touchesKnown) {
			const eqTerms: string[] = [];

			for (const comp of nonConstraintBranches) {
				const [nA, nB] = graph.componentNodes[comp.id];
				const inA = groupSet.has(nA);
				const inB = groupSet.has(nB);
				if (inA === inB) continue;

				if (comp.kind === 'current_source') {
					const is = parseSourceValue(comp, mode)!;
					if (inA) {
						b[row] = b[row].sub(is);
						eqTerms.push(`+ ${formatLatexTerm(is, mode)}`);
					} else {
						b[row] = b[row].add(is);
						eqTerms.push(`- ${formatLatexTerm(is, mode)}`);
					}
					continue;
				}

				if (comp.kind === 'vccs' || comp.kind === 'cccs') {
					const expr = resolveBranchCurrentExpr(comp.id, new Set());
					if (!expr) {
						return {
							methodId: 'nodal',
							title,
							applicable: false,
							inapplicableReason: `Could not eliminate controlling branch current for ${comp.label} in reduced nodal form.`,
							steps: []
						};
					}
					stampExprIntoRow(row, expr, inA ? 1 : -1);
					const exprTex = formatDependentSourceExpr(comp, doc, mode);
					eqTerms.push(inA ? `+ ${exprTex}` : `- (${exprTex})`);
					continue;
				}

				const y = getPassiveAdmittance(comp, mode, freq);
				if (!y || y.isZero(1e-15)) continue;

				const inside = inA ? nA : nB;
				const outside = inA ? nB : nA;
				const idxIn = unknownIdx.get(inside)!;
				A[row][idxIn] = A[row][idxIn].add(y);

				const yTex = formatLatexTerm(y, mode);
				if (outside === '0') {
					eqTerms.push(`${yTex} V_{${latexNodeId(inside)}}`);
				} else if (knownVoltages.has(outside)) {
					const vKnown = knownVoltages.get(outside)!;
					const contrib = y.mul(vKnown);
					b[row] = b[row].add(contrib);
					eqTerms.push(`${yTex}(V_{${latexNodeId(inside)}} - ${formatLatexTerm(vKnown, mode)})`);
				} else {
					const idxOut = unknownIdx.get(outside)!;
					A[row][idxOut] = A[row][idxOut].sub(y);
					eqTerms.push(`${yTex}(V_{${latexNodeId(inside)}} - V_{${latexNodeId(outside)}})`);
				}
			}

			const labelPrefix =
				group.length > 1
					? `\\text{Supernode } \\{${group.map(latexNodeId).join(', ')}\\}:\\; `
					: `\\text{Node } ${latexNodeId(group[0])}:\\; `;
			if (eqTerms.length > 2) {
				const cleanTerms = eqTerms.map((t, i) =>
					i === 0 ? t.replace(/^\+\s*/, '') : t.startsWith('- ') || t.startsWith('+ ') ? t : `+ ${t}`
				);
				const lines: string[] = [];
				for (let i = 0; i < cleanTerms.length; i += 2) {
					lines.push(cleanTerms.slice(i, i + 2).join(' '));
				}
				kclLatex.push(
					`\\begin{aligned} ${labelPrefix}&${lines.join(' \\\\ &')} = 0 \\end{aligned}`
				);
			} else {
				const joined = eqTerms.join(' + ').replace(/\+ -/g, '- ').replace(/^\+\s*/, '') || '0';
				kclLatex.push(`${labelPrefix}${joined} = 0`);
			}
			row++;
		}

		// Constraint equations for all active constraint branches belonging to this group
		const groupConstraints = activeConstraints.filter((cb) => {
			const rA = unknownIdx.has(cb.nodeA) ? findSn(cb.nodeA) : KNOWN_SENTINEL;
			const rB = unknownIdx.has(cb.nodeB) ? findSn(cb.nodeB) : KNOWN_SENTINEL;
			return rA === root && rB === root;
		});
		for (const cb of groupConstraints) {
			if (!stampConstraintEquation(row, cb)) {
				return {
					methodId: 'nodal',
					title,
					applicable: false,
					inapplicableReason: `Could not eliminate controlling branch current for ${cb.comp.label} in reduced nodal form.`,
					steps: []
				};
			}
			row++;
		}
	}

	// Solve reduced system independently
	const nodeVoltages: Record<string, Complex> = {};
	for (const [nid, v] of knownVoltages.entries()) {
		nodeVoltages[nid] = v;
	}

	let solveDisplay: ReturnType<typeof courseSolveDisplay> | undefined;
	if (U > 0) {
		if (row !== U) {
			return {
				methodId: 'nodal',
				title,
				applicable: false,
				inapplicableReason: `Nodal equation count mismatch (${row} equations for ${U} unknown nodes).`,
				steps: []
			};
		}
		const solved = solveComplexLinearSystem(A, b);
		if (solved.singular) {
			return {
				methodId: 'nodal',
				title,
				applicable: false,
				inapplicableReason: 'Reduced nodal matrix is singular.',
				steps: []
			};
		}
		unknownNodes.forEach((nid, i) => {
			nodeVoltages[nid] = solved.x[i];
		});
		solveDisplay = courseSolveDisplay(
			A,
			b,
			unknownNodes.map((nid) => `V_{${latexNodeId(nid)}}`),
			'V',
			mode
		);
	}

	// Recover non-constraint branch voltages and currents
	const branchVoltages: Record<string, Complex> = {};
	const branchCurrents: Record<string, Complex> = {};
	const netNonConstraintLeaving = new Map<string, Complex>();
	for (const nid of ['0', ...nonRefNodes]) netNonConstraintLeaving.set(nid, Complex.zero());

	const evalExprAtSolution = (expr: NodalLinearExpr): Complex => {
		let sum = expr.constant;
		for (const [idx, coeff] of expr.terms.entries()) {
			const nid = unknownNodes[idx];
			sum = sum.add(coeff.mul(nodeVoltages[nid]));
		}
		return sum;
	};

	for (const comp of nonConstraintBranches) {
		const [nA, nB] = graph.componentNodes[comp.id];
		const vBranch = nodeVoltages[nA].sub(nodeVoltages[nB]);
		branchVoltages[comp.id] = vBranch;

		let iBranch = Complex.zero();
		if (comp.kind === 'current_source') {
			iBranch = parseSourceValue(comp, mode)!;
		} else if (comp.kind === 'vccs' || comp.kind === 'cccs') {
			const expr = resolveBranchCurrentExpr(comp.id, new Set());
			if (expr) iBranch = evalExprAtSolution(expr);
		} else {
			const y = getPassiveAdmittance(comp, mode, freq);
			if (y) iBranch = vBranch.mul(y);
		}
		branchCurrents[comp.id] = iBranch;

		if (nA !== nB) {
			netNonConstraintLeaving.set(nA, netNonConstraintLeaving.get(nA)!.add(iBranch));
			netNonConstraintLeaving.set(nB, netNonConstraintLeaving.get(nB)!.sub(iBranch));
		}
	}

	// Recover voltage-constraint branch currents via topological leaf-peeling
	const remainingAdj = new Map<string, Set<ConstraintBranch>>();
	for (const nid of ['0', ...nonRefNodes]) remainingAdj.set(nid, new Set());
	for (const cb of allConstraintBranches) {
		branchVoltages[cb.comp.id] = nodeVoltages[cb.nodeA].sub(nodeVoltages[cb.nodeB]);
		remainingAdj.get(cb.nodeA)!.add(cb);
		remainingAdj.get(cb.nodeB)!.add(cb);
	}

	const peeledLeaving = new Map<string, Complex>();
	for (const nid of ['0', ...nonRefNodes]) peeledLeaving.set(nid, Complex.zero());

	const peelQueue: string[] = [];
	for (const nid of nonRefNodes) {
		if ((remainingAdj.get(nid)?.size ?? 0) === 1) {
			peelQueue.push(nid);
		}
	}

	while (peelQueue.length > 0) {
		const u = peelQueue.shift()!;
		const incident = remainingAdj.get(u)!;
		if (incident.size !== 1) continue;
		const cb = incident.values().next().value!;
		const other = cb.nodeA === u ? cb.nodeB : cb.nodeA;

		const iLeavingU = netNonConstraintLeaving.get(u)!.add(peeledLeaving.get(u)!).neg();
		const iBranch = cb.nodeA === u ? iLeavingU : iLeavingU.neg();
		branchCurrents[cb.comp.id] = iBranch;

		const iLeavingOther = cb.nodeA === other ? iBranch : iBranch.neg();
		peeledLeaving.set(other, peeledLeaving.get(other)!.add(iLeavingOther));

		incident.delete(cb);
		remainingAdj.get(other)!.delete(cb);
		if (other !== '0' && remainingAdj.get(other)!.size === 1) {
			peelQueue.push(other);
		}
	}

	// Build Pedagogical Steps
	const knownLatex = nonRefNodes
		.filter((nid) => knownVoltages.has(nid))
		.map((nid) => `V_{${latexNodeId(nid)}} = ${formatLatexValue(knownVoltages.get(nid)!, mode)}\\text{ V}`);

	const supernodeGroups = Array.from(supernodeMap.entries())
		.filter(([root, g]) => root !== KNOWN_SENTINEL && g.length > 1)
		.map(([, g]) => g);
	const solvedLatex = nonRefNodes.map(
		(nid) => `V_{${latexNodeId(nid)}} = ${formatLatexValue(nodeVoltages[nid], mode)}\\text{ V}`
	);

	const steps: SolutionStep[] = [];
	let stepNum = 1;

	steps.push({
		title: `${stepNum++}. Reference Node & Known Node Voltages`,
		description:
			knownLatex.length > 0
				? `Reference node is "0" (0 V). Ground-referenced independent voltage sources directly fix ${knownLatex.length} node voltage(s).`
				: 'Reference node is "0" (0 V). No independent voltage sources are directly tied to ground, so all non-reference nodes are unknowns.',
		latex: knownLatex.length > 0 ? knownLatex : ['V_0 = 0\\text{ V}']
	});

	if (dependentLatex.length > 0) {
		steps.push({
			title: `${stepNum++}. Dependent Source Controlling Variables`,
			description:
				'Express each dependent source controlling variable in terms of node voltages before substituting into nodal KCL and supernode constraints.',
			latex: dependentLatex
		});
	}

	if (supernodeGroups.length > 0) {
		steps.push({
			title: `${stepNum++}. Supernode Identification`,
			description: `Floating voltage sources join non-reference nodes into ${supernodeGroups.length} supernode(s).`,
			latex: supernodeGroups.map((g) => `\\text{Supernode: } \\{${g.map(latexNodeId).join(', ')}\\}`)
		});
	}

	steps.push({
		title: `${stepNum++}. Nodal KCL Equations`,
		description: hasDependentSrc
			? 'Apply KCL at each ordinary node and supernode, plus the voltage-source and dependent-source equations.'
			: 'Apply KCL at each ordinary node and supernode, plus the voltage-source equations.',
		latex: kclLatex.length > 0 ? kclLatex : ['\\text{All node voltages are directly fixed by sources.}']
	});

	if (solveDisplay && solveDisplay.latex.length > 0) {
		steps.push({
			title: `${stepNum++}. ${solveDisplay.remaining >= 2 ? 'Solve the Simultaneous Equations' : 'Solve the Equation'}`,
			description:
				solveDisplay.remaining >= 2
					? `${solveDisplay.remaining} equations in ${solveDisplay.remaining} unknown node voltages, solved by substitution.`
					: 'Collect the terms of each unknown node voltage and divide.',
			latex: solveDisplay.latex
		});
	}

	steps.push({
		title: `${stepNum++}. Solved Node Voltages`,
		description:
			'Solved node voltages and found the branch currents using Ohm’s law and KCL.',
		latex: solvedLatex
	});

	const verification = verifyAgainstMna(mna, {
		nodeVoltages,
		branchVoltages,
		branchCurrents
	});

	return {
		methodId: 'nodal',
		title,
		applicable: true,
		steps,
		summaryLatex: `\\begin{aligned} ${solvedLatex
			.slice(0, 6)
			.map((s) => s.replace(' = ', ' &= '))
			.join(' \\\\ ')} \\end{aligned}`,
		...verification
	};
}
