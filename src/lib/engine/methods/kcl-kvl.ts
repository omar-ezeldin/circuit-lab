/**
 * Method 1: Kirchhoff's Current Law (KCL) & Kirchhoff's Voltage Law (KVL) Solver.
 *
 * Independently solves the 2B fundamental-tableau linear system:
 *   - (N - 1) KCL equations at non-reference nodes
 *   - (B - N + 1) KVL equations around fundamental cycles of a spanning tree
 *   - B branch constitutive laws (Ohm's law / source constraints / DC L-short, C-open)
 *
 * Verifies KCL and KVL residuals = 0 and cross-verifies every branch voltage
 * and current against MNA ground truth (< 1e-8).
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
	formatDependentSourceExpr,
	formatLatexTerm,
	formatLatexValue,
	getPassiveImpedance,
	latexSub,
	verifyAgainstMna
} from './shared';

interface BranchEdge {
	index: number;
	comp: CircuitComponent;
	nodeA: string;
	nodeB: string;
}

interface TreeAdj {
	edgeIdx: number;
	neighbor: string;
	dir: 1 | -1; // +1 if traversing node -> neighbor goes pin0 -> pin1
}

export function solveKclKvl(doc: CircuitDocument, mna: MnaSolution): MethodResult {
	const title = "Kirchhoff's Laws (KCL & KVL)";
	if (!mna.valid) {
		return {
			methodId: 'kcl_kvl',
			title,
			applicable: false,
			inapplicableReason: 'Circuit has topology or value errors; fix validation errors first.',
			steps: []
		};
	}

	const graph = buildElectricalGraph(doc);
	const mode = mna.mode;
	const freq = mna.frequencyHz;
	const allNodeIds = Object.keys(graph.nodes);
	const nonRefNodes = graph.nonRefNodeIds;

	const branches: BranchEdge[] = doc.components
		.filter((c) => c.kind !== 'ground' && c.kind !== 'terminal')
		.map((comp, index) => {
			const [nodeA, nodeB] = graph.componentNodes[comp.id];
			return { index, comp, nodeA, nodeB };
		});

	const B = branches.length;
	const N = allNodeIds.length;
	if (B === 0) {
		return {
			methodId: 'kcl_kvl',
			title,
			applicable: false,
			inapplicableReason: 'No branches available for KCL/KVL analysis.',
			steps: []
		};
	}

	// Build a spanning tree over all nodes using active branches (prefer non-open branches first)
	const nodeParent = new Map<string, string>();
	for (const nid of allNodeIds) nodeParent.set(nid, nid);
	const findRoot = (x: string): string => {
		while (nodeParent.get(x) !== x) x = nodeParent.get(x)!;
		return x;
	};

	const treeEdges: BranchEdge[] = [];
	const chordEdges: BranchEdge[] = [];
	const sortedForTree = [...branches].sort((a, b) => {
		const aOpen = mode === 'dc' && a.comp.kind === 'capacitor' ? 1 : 0;
		const bOpen = mode === 'dc' && b.comp.kind === 'capacitor' ? 1 : 0;
		return aOpen - bOpen;
	});

	for (const edge of sortedForTree) {
		const rA = findRoot(edge.nodeA);
		const rB = findRoot(edge.nodeB);
		if (rA !== rB) {
			nodeParent.set(rA, rB);
			treeEdges.push(edge);
		} else {
			chordEdges.push(edge);
		}
	}

	// Adjacency list of the spanning tree for finding fundamental cycles
	const treeAdj = new Map<string, TreeAdj[]>();
	for (const nid of allNodeIds) treeAdj.set(nid, []);
	for (const edge of treeEdges) {
		treeAdj.get(edge.nodeA)!.push({ edgeIdx: edge.index, neighbor: edge.nodeB, dir: 1 });
		treeAdj.get(edge.nodeB)!.push({ edgeIdx: edge.index, neighbor: edge.nodeA, dir: -1 });
	}

	const findTreePath = (
		start: string,
		target: string
	): Array<{ edgeIdx: number; dir: 1 | -1 }> => {
		if (start === target) return [];
		const visited = new Set<string>([start]);
		const parent = new Map<string, { prev: string; edgeIdx: number; dir: 1 | -1 }>();
		const queue = [start];

		while (queue.length > 0) {
			const curr = queue.shift()!;
			if (curr === target) break;
			for (const adj of treeAdj.get(curr) ?? []) {
				if (!visited.has(adj.neighbor)) {
					visited.add(adj.neighbor);
					parent.set(adj.neighbor, { prev: curr, edgeIdx: adj.edgeIdx, dir: adj.dir });
					queue.push(adj.neighbor);
				}
			}
		}

		const path: Array<{ edgeIdx: number; dir: 1 | -1 }> = [];
		let cur = target;
		while (cur !== start) {
			const step = parent.get(cur);
			if (!step) break;
			path.push({ edgeIdx: step.edgeIdx, dir: step.dir });
			cur = step.prev;
		}
		path.reverse();
		return path;
	};

	// Fundamental cycles: each chord (nodeA -> nodeB) + tree path (nodeB -> nodeA)
	const fundamentalLoops: Array<{
		chord: BranchEdge;
		terms: Array<{ edgeIdx: number; dir: 1 | -1 }>;
	}> = [];

	for (const chord of chordEdges) {
		const pathBack = findTreePath(chord.nodeB, chord.nodeA);
		fundamentalLoops.push({
			chord,
			terms: [{ edgeIdx: chord.index, dir: 1 }, ...pathBack]
		});
	}

	// Independently assemble the 2B x 2B system:
	// Unknowns: [I_0 .. I_{B-1}, V_0 .. V_{B-1}]
	const dim = 2 * B;
	const A: Complex[][] = Array.from({ length: dim }, () =>
		Array.from({ length: dim }, () => Complex.zero())
	);
	const rhs: Complex[] = Array.from({ length: dim }, () => Complex.zero());
	let row = 0;

	// (1) N - 1 KCL equations at non-reference nodes
	for (const nid of nonRefNodes) {
		for (const br of branches) {
			if (br.nodeA === br.nodeB) continue;
			if (br.nodeA === nid) {
				A[row][br.index] = A[row][br.index].add(Complex.one());
			} else if (br.nodeB === nid) {
				A[row][br.index] = A[row][br.index].sub(Complex.one());
			}
		}
		row++;
	}

	// (2) B - N + 1 KVL fundamental-cycle equations
	for (const loop of fundamentalLoops) {
		for (const term of loop.terms) {
			const sign = Complex.from(term.dir, 0);
			A[row][B + term.edgeIdx] = A[row][B + term.edgeIdx].add(sign);
		}
		row++;
	}

	const branchIndexByCompId = new Map<string, number>();
	for (const br of branches) branchIndexByCompId.set(br.comp.id, br.index);

	// (3) B branch constitutive equations
	const dependentLatex: string[] = [];
	for (const br of branches) {
		const { comp, index } = br;
		if (comp.kind === 'voltage_source') {
			const vs = parseSourceValue(comp, mode)!;
			A[row][B + index] = Complex.one();
			rhs[row] = vs;
		} else if (comp.kind === 'current_source') {
			const is = parseSourceValue(comp, mode)!;
			A[row][index] = Complex.one();
			rhs[row] = is;
		} else if (isDependentSourceKind(comp.kind)) {
			const pol = comp.controlRef?.controlPolarity ?? 1;
			const gain = parseDependentGain(comp, mode)!.scale(pol);
			const sub = latexSub(comp.label);
			const exprTex = formatDependentSourceExpr(comp, doc, mode);
			const lhsSym = isDependentVoltageSource(comp.kind) ? `V_{${sub}}` : `I_{${sub}}`;
			dependentLatex.push(`${lhsSym} = ${exprTex}`);

			if (comp.kind === 'vcvs' || comp.kind === 'vccs') {
				const outCol = comp.kind === 'vcvs' ? B + index : index;
				A[row][outCol] = A[row][outCol].add(Complex.one());
				if (comp.controlRef?.controlComponentId) {
					const ctrlIdx = branchIndexByCompId.get(comp.controlRef.controlComponentId)!;
					A[row][B + ctrlIdx] = A[row][B + ctrlIdx].sub(gain);
				} else {
					const ctrl = resolveDependentControlNodes(comp, graph)!;
					const path = findTreePath(ctrl.ctrlPos, ctrl.ctrlNeg);
					for (const term of path) {
						A[row][B + term.edgeIdx] = A[row][B + term.edgeIdx].sub(gain.scale(term.dir));
					}
				}
				rhs[row] = Complex.zero();
			} else {
				// CCVS or CCCS
				const outCol = comp.kind === 'ccvs' ? B + index : index;
				const ctrlIdx = branchIndexByCompId.get(comp.controlRef!.controlBranchComponentId!)!;
				A[row][outCol] = A[row][outCol].add(Complex.one());
				A[row][ctrlIdx] = A[row][ctrlIdx].sub(gain);
				rhs[row] = Complex.zero();
			}
		} else if (mode === 'dc' && comp.kind === 'capacitor') {
			// Open circuit: I_C = 0
			A[row][index] = Complex.one();
			rhs[row] = Complex.zero();
		} else if (mode === 'dc' && comp.kind === 'inductor') {
			// Short circuit: V_L = 0
			A[row][B + index] = Complex.one();
			rhs[row] = Complex.zero();
		} else {
			// V_b - Z_b * I_b = 0
			const z = getPassiveImpedance(comp, mode, freq)!;
			A[row][B + index] = Complex.one();
			A[row][index] = z.neg();
			rhs[row] = Complex.zero();
		}
		row++;
	}

	const solved = solveComplexLinearSystem(A, rhs);
	if (solved.singular || row !== dim) {
		return {
			methodId: 'kcl_kvl',
			title,
			applicable: false,
			inapplicableReason:
				'Fundamental KCL/KVL tableau matrix was singular (disconnected or dependent topology).',
			steps: []
		};
	}

	const branchCurrents: Record<string, Complex> = {};
	const branchVoltages: Record<string, Complex> = {};
	for (const br of branches) {
		branchCurrents[br.comp.id] = solved.x[br.index];
		branchVoltages[br.comp.id] = solved.x[B + br.index];
	}

	const formatJoinedLines = (items: string[], perLine = 2): string[] => {
		const lines: string[] = [];
		for (let i = 0; i < items.length; i += perLine) {
			lines.push(items.slice(i, i + perLine).join(' '));
		}
		return lines;
	};

	// Build Pedagogical KCL Steps (all nodes including reference "0" check)
	const kclLatex: string[] = [];
	const nodesForDisplay = [...nonRefNodes, '0'].filter((id) => graph.nodes[id]);
	for (const nid of nodesForDisplay) {
		const terms: Array<{ sign: 1 | -1; br: BranchEdge }> = [];
		for (const br of branches) {
			if (br.nodeA === br.nodeB) continue;
			if (br.nodeA === nid) terms.push({ sign: 1, br });
			else if (br.nodeB === nid) terms.push({ sign: -1, br });
		}
		if (terms.length === 0) continue;

		const sym = terms
			.map((t, idx) => {
				const s = latexSub(t.br.comp.label);
				if (idx === 0) return t.sign === 1 ? `I_{${s}}` : `-I_{${s}}`;
				return t.sign === 1 ? ` + I_{${s}}` : ` - I_{${s}}`;
			})
			.join('');

		let residual = Complex.zero();
		const numTermArr = terms.map((t, idx) => {
			const val = branchCurrents[t.br.comp.id];
			residual = t.sign === 1 ? residual.add(val) : residual.sub(val);
			const valTex = formatLatexTerm(val, mode);
			if (idx === 0) return t.sign === 1 ? valTex : `-${valTex}`;
			return t.sign === 1 ? `+ ${valTex}` : `- ${valTex}`;
		});

		const resStr = residual.isZero(1e-9) ? '0' : formatLatexValue(residual, mode);
		const symLine = `&\\text{Node } ${latexNodeId(nid)}:\\;${sym} = 0`;
		const numLines = formatJoinedLines(numTermArr, mode === 'ac' ? 2 : 3);
		const rhsBlock = numLines
			.map((line, i) => (i === 0 ? `&\\implies ${line}` : `&\\quad ${line}`))
			.join(' \\\\ ');
		kclLatex.push(
			`\\begin{aligned} ${symLine} \\\\ ${rhsBlock} = ${resStr} \\end{aligned}`
		);
	}

	// Build Pedagogical KVL Steps
	const kvlLatex: string[] = [];
	fundamentalLoops.forEach((loop, idx) => {
		const sym = loop.terms
			.map((t, i) => {
				const s = latexSub(branches[t.edgeIdx].comp.label);
				if (i === 0) return t.dir === 1 ? `V_{${s}}` : `-V_{${s}}`;
				return t.dir === 1 ? ` + V_{${s}}` : ` - V_{${s}}`;
			})
			.join('');

		let residual = Complex.zero();
		const numTermArr = loop.terms.map((t, i) => {
			const br = branches[t.edgeIdx];
			const val = branchVoltages[br.comp.id];
			residual = t.dir === 1 ? residual.add(val) : residual.sub(val);
			const valTex = formatLatexTerm(val, mode);
			if (i === 0) return t.dir === 1 ? valTex : `-${valTex}`;
			return t.dir === 1 ? `+ ${valTex}` : `- ${valTex}`;
		});

		const resStr = residual.isZero(1e-9) ? '0' : formatLatexValue(residual, mode);
		const symLine = `&\\text{Loop } ${idx + 1}:\\; ${sym} = 0`;
		const numLines = formatJoinedLines(numTermArr, mode === 'ac' ? 2 : 3);
		const rhsBlock = numLines
			.map((line, i) => (i === 0 ? `&\\implies ${line}` : `&\\quad ${line}`))
			.join(' \\\\ ');
		kvlLatex.push(
			`\\begin{aligned} ${symLine} \\\\ ${rhsBlock} = ${resStr} \\end{aligned}`
		);
	});

	const constitutiveLatex = branches.map((br) => {
		const sub = latexSub(br.comp.label);
		const vStr = formatLatexValue(branchVoltages[br.comp.id], mode);
		const iStr = formatLatexValue(branchCurrents[br.comp.id], mode);
		return mode === 'ac'
			? `\\begin{aligned} V_{${sub}} &= ${vStr}\\text{ V} \\\\ I_{${sub}} &= ${iStr}\\text{ A} \\end{aligned}`
			: `V_{${sub}} = ${vStr}\\text{ V},\\; I_{${sub}} = ${iStr}\\text{ A}`;
	});

	const steps: SolutionStep[] = [
		{
			title: '1. Spanning Tree & Topology Count',
			description: `Identified ${N} electrical nodes and ${B} branches. A spanning tree uses ${treeEdges.length} tree branches and leaves ${chordEdges.length} fundamental loop(s).`,
			latex: [
				`\\begin{gathered} N_{\\text{nodes}} = ${N},\\quad B = ${B} \\\\ \\text{KCL eqs} = ${nonRefNodes.length},\\quad \\text{KVL loops} = ${fundamentalLoops.length} \\end{gathered}`
			]
		},
		{
			title: "2. Kirchhoff's Current Law (KCL) Equations",
			description:
				'Sum of branch currents leaving each node equals zero (passive sign convention: positive current flows pin 0 → pin 1).',
			latex: kclLatex
		},
		{
			title: "3. Kirchhoff's Voltage Law (KVL) Equations",
			description:
				'Signed sum of branch voltages around each fundamental cycle equals zero.',
			latex:
				kvlLatex.length > 0
					? kvlLatex
					: ['\\text{Tree-only circuit: no closed loops present.}']
		},
		...(dependentLatex.length > 0
			? [
					{
						title: '4. Dependent Source Controlling Equations',
						description:
							'Include linear controlling laws for each dependent source alongside passive Ohm’s-law relations.',
						latex: dependentLatex
					}
				]
			: []),
		{
			title: `${dependentLatex.length > 0 ? '5' : '4'}. Solved Branch Voltages & Currents`,
			description: `Solved the ${dim}×${dim} KCL + KVL + element-law system and verified zero residuals at every node and loop.`,
			latex: constitutiveLatex
		}
	];

	const verification = verifyAgainstMna(mna, { branchVoltages, branchCurrents });

	const summaryLines = branches.slice(0, 4).map((br) => {
		const sub = latexSub(br.comp.label);
		const vStr = formatLatexValue(branchVoltages[br.comp.id], mode);
		const iStr = formatLatexValue(branchCurrents[br.comp.id], mode);
		return mode === 'ac'
			? `V_{${sub}} &= ${vStr}\\text{ V} \\\\ I_{${sub}} &= ${iStr}\\text{ A}`
			: `V_{${sub}} &= ${vStr}\\text{ V},\\; I_{${sub}} = ${iStr}\\text{ A}`;
	});

	return {
		methodId: 'kcl_kvl',
		title,
		applicable: true,
		steps,
		summaryLatex: `\\begin{aligned} ${summaryLines.join(' \\\\ ')} \\end{aligned}`,
		...verification
	};
}
