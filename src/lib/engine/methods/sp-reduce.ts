/**
 * Series–parallel reduction of a two-terminal network, written the way the course does it by hand.
 *
 * Pure helper (no solver state): give it the two-terminal edges, the wires / killed voltage
 * sources (shorts) and the two port nodes. It contracts the shorts, drops dangling edges, then
 * merges parallel and series edges until one edge joins the ports. The result is a tree that can be
 * printed as R_eq (names, numbers, value) and walked down to one element with current dividers.
 *
 * Reusable later for the Thévenin resistance R_th.
 */

import { Complex } from '../complex';
import type { AnalysisMode } from '../types';
import { formatLatexTerm, formatLatexValue, latexSub } from './shared';

export interface SpEdge {
	id: string;
	label: string;
	/** Optional LaTeX name used in R_eq (default: the label, e.g. `R1` -> `R_{1}`). */
	name?: string;
	nodeA: string;
	nodeB: string;
	/** Impedance. |Z| ~ 0 counts as a wire, a non-finite Z counts as an open circuit. */
	z: Complex;
}

export interface SpInput {
	edges: SpEdge[];
	/** Node pairs joined by a wire (wires, killed voltage sources). */
	shorts?: Array<[string, string]>;
	/** The two port nodes: [p, q]. */
	ports: [string, string];
}

export type SpTree =
	| { kind: 'leaf'; edge: SpEdge; from: string; to: string; z: Complex }
	| { kind: 'series' | 'parallel'; children: SpTree[]; from: string; to: string; z: Complex };

export interface SpReduction {
	ok: boolean;
	reason?: string;
	root?: SpTree;
	/** Port nodes after contracting the shorts (p = where the walk enters). */
	portP: string;
	portQ: string;
	/** Edges that carry no current because one end goes nowhere. */
	dangling: SpEdge[];
	/** Edges whose two ends are the same node after contracting the shorts. */
	shorted: SpEdge[];
	/** Edges with Z ~ 0 (treated as wires). */
	zeroImpedance: SpEdge[];
	/** Edges with non-finite Z (treated as open). */
	open: SpEdge[];
}

const Z_EPS = 1e-12;

/** `R1` -> `R_{1}`, `RL` -> `R_{L}`, `Rload` -> `R_{load}`; other labels stay readable. */
export function latexName(label: string): string {
	const clean = latexSub(label);
	if (clean === '') return '\\text{?}';
	const m = /^([A-Za-z])([A-Za-z0-9]+)$/.exec(clean);
	if (m) return `${m[1]}_{${m[2]}}`;
	if (/^[A-Za-z]$/.test(clean)) return clean;
	return `\\mathrm{${clean}}`;
}

function other(node: SpTree, n: string): string {
	return node.from === n ? node.to : node.from;
}

/** The children of a series node, oriented so the chain starts at `start`. */
function chainFrom(node: SpTree, start: string): SpTree[] {
	if (node.kind !== 'series') return [node];
	return node.from === start ? node.children : [...node.children].reverse();
}

function badZ(z: Complex): boolean {
	return !z.isFinite() || z.abs() < Z_EPS;
}

export function reduceSeriesParallel(input: SpInput): SpReduction {
	const result: SpReduction = {
		ok: false,
		portP: input.ports[0],
		portQ: input.ports[1],
		dangling: [],
		shorted: [],
		zeroImpedance: [],
		open: []
	};

	// Union-find over node ids (shorts and zero-impedance edges contract two nodes into one).
	const parent = new Map<string, string>();
	const find = (x: string): string => {
		let r = parent.get(x) ?? x;
		while ((parent.get(r) ?? r) !== r) r = parent.get(r)!;
		parent.set(x, r);
		return r;
	};
	const union = (a: string, b: string) => {
		const ra = find(a);
		const rb = find(b);
		if (ra !== rb) parent.set(ra, rb);
	};

	for (const [a, b] of input.shorts ?? []) union(a, b);
	for (const e of input.edges) {
		if (e.z.isFinite() && e.z.abs() < Z_EPS) {
			result.zeroImpedance.push(e);
			union(e.nodeA, e.nodeB);
		}
	}

	const p = find(input.ports[0]);
	const q = find(input.ports[1]);
	result.portP = p;
	result.portQ = q;
	if (p === q) {
		result.reason = 'The two ports are joined by a wire.';
		return result;
	}

	let work: SpTree[] = [];
	for (const e of input.edges) {
		if (e.z.isFinite() && e.z.abs() < Z_EPS) continue;
		if (!e.z.isFinite()) {
			result.open.push(e);
			continue;
		}
		const a = find(e.nodeA);
		const b = find(e.nodeB);
		if (a === b) {
			result.shorted.push(e);
			continue;
		}
		work.push({ kind: 'leaf', edge: e, from: a, to: b, z: e.z });
	}

	const degree = (): Map<string, SpTree[]> => {
		const m = new Map<string, SpTree[]>();
		for (const t of work) {
			for (const n of [t.from, t.to]) {
				const list = m.get(n) ?? [];
				list.push(t);
				m.set(n, list);
			}
		}
		return m;
	};

	// Drop dangling edges (an end that is not a port and joins nothing else): no current flows.
	for (let changed = true; changed; ) {
		changed = false;
		const deg = degree();
		for (const [n, list] of deg) {
			if (n === p || n === q || list.length !== 1) continue;
			const t = list[0];
			work = work.filter((w) => w !== t);
			if (t.kind === 'leaf') result.dangling.push(t.edge);
			changed = true;
			break;
		}
	}

	const sumZ = (kids: SpTree[]): Complex => kids.reduce((acc, k) => acc.add(k.z), Complex.zero());
	const parZ = (kids: SpTree[]): Complex => {
		const y = kids.reduce((acc, k) => acc.add(k.z.inv()), Complex.zero());
		return y.isZero(1e-15) ? Complex.from(Infinity, 0) : y.inv();
	};

	for (let guard = 0; guard < 10_000; guard++) {
		// Parallel: several edges on the same node pair.
		const byPair = new Map<string, SpTree[]>();
		for (const t of work) {
			const key = t.from < t.to ? `${t.from}\0${t.to}` : `${t.to}\0${t.from}`;
			const list = byPair.get(key) ?? [];
			list.push(t);
			byPair.set(key, list);
		}
		const group = [...byPair.values()].find((g) => g.length > 1);
		if (group) {
			const kids: SpTree[] = group.flatMap((g) => (g.kind === 'parallel' ? g.children : [g]));
			const z = parZ(kids);
			if (badZ(z) || kids.some((k) => badZ(k.z))) {
				result.reason = 'A parallel combination has zero or infinite impedance.';
				return result;
			}
			const merged: SpTree = {
				kind: 'parallel',
				children: kids,
				from: group[0].from,
				to: group[0].to,
				z
			};
			work = [...work.filter((w) => !group.includes(w)), merged];
			continue;
		}

		// Series: a non-port node with exactly two edges.
		const deg = degree();
		let did = false;
		for (const [n, list] of deg) {
			if (n === p || n === q || list.length !== 2) continue;
			const [e1, e2] = list;
			const a = other(e1, n);
			const b = other(e2, n);
			if (a === b) continue; // would be a loop; cannot happen after the parallel merge
			const kids = [...chainFrom(e1, a), ...chainFrom(e2, n)];
			const z = sumZ(kids);
			if (badZ(z)) {
				result.reason = 'A series combination has zero or infinite impedance.';
				return result;
			}
			const merged: SpTree = { kind: 'series', children: kids, from: a, to: b, z };
			work = [...work.filter((w) => w !== e1 && w !== e2), merged];
			did = true;
			break;
		}
		if (did) continue;
		break;
	}

	if (work.length === 1 && new Set([work[0].from, work[0].to]).size === 2) {
		const t = work[0];
		if ((t.from === p && t.to === q) || (t.from === q && t.to === p)) {
			if (badZ(t.z)) {
				result.reason = 'The equivalent impedance is zero or infinite.';
				return result;
			}
			result.ok = true;
			result.root = t;
			return result;
		}
	}
	result.reason =
		work.length === 0
			? 'No path joins the two ports.'
			: 'The network is not a series–parallel combination (for example a bridge).';
	return result;
}

// ---------------------------------------------------------------------------------------------
// LaTeX
// ---------------------------------------------------------------------------------------------

function nameExpr(node: SpTree, ctx: 'top' | 'series' | 'parallel'): string {
	if (node.kind === 'leaf') return node.edge.name ?? latexName(node.edge.label);
	if (node.kind === 'series') {
		const s = node.children.map((c) => nameExpr(c, 'series')).join(' + ');
		return ctx === 'parallel' ? `(${s})` : s;
	}
	const s = node.children.map((c) => nameExpr(c, 'parallel')).join(' \\parallel ');
	return ctx === 'series' ? `(${s})` : s;
}

function numExpr(node: SpTree, ctx: 'top' | 'sum' | 'product', mode: AnalysisMode): string {
	if (node.kind === 'leaf') return formatLatexTerm(node.z, mode);
	if (node.kind === 'series') {
		const s = node.children.map((c) => numExpr(c, 'sum', mode)).join(' + ');
		return ctx === 'product' ? `(${s})` : s;
	}
	if (node.children.length === 2) {
		const [a, b] = node.children;
		const prod = `${numExpr(a, 'product', mode)} \\cdot ${numExpr(b, 'product', mode)}`;
		const sum = `${numExpr(a, 'sum', mode)} + ${numExpr(b, 'sum', mode)}`;
		return `\\frac{${prod}}{${sum}}`;
	}
	const inv = node.children.map((c) => `\\frac{1}{${numExpr(c, 'top', mode)}}`).join(' + ');
	return `\\left(${inv}\\right)^{-1}`;
}

/** `R_{eq} = R_1 + (R_2 \parallel R_3) = 1000 + \frac{...}{...} = 1500\;\Omega` */
export function reqLatex(root: SpTree, mode: AnalysisMode, symbol = 'R_{eq}'): string {
	const names = nameExpr(root, 'top');
	const val = `${formatLatexValue(root.z, mode)}\\;\\Omega`;
	if (root.kind === 'leaf') return `${symbol} = ${names} = ${val}`;
	return `${symbol} = ${names} = ${numExpr(root, 'top', mode)} = ${val}`;
}

export interface SpWalkArgs {
	root: SpTree;
	/** Port node where the source current enters the network (the reduction's portP, or portQ). */
	entry: string;
	/** Current entering the network at `entry`. */
	current: Complex;
	/** LaTeX name of that current, e.g. `I_s`. */
	currentName: string;
	/** Id of the target leaf edge. */
	targetId: string;
	/** LaTeX name of the answer, e.g. `I'_{R_3}`. */
	finalName: string;
	mode: AnalysisMode;
}

export interface SpWalk {
	/** Divider lines from the root down to the target (empty when the target is in series with the source). */
	lines: string[];
	/** Current through the target in the direction nodeA -> nodeB of its edge (= pin 0 -> pin 1). */
	current: Complex;
	/** Name of the current at the target in the walk direction (finalName only when it was just computed). */
	name: string;
	/** True when the walk direction is opposite to nodeA -> nodeB, so the answer is the negative. */
	reversed: boolean;
	/** Current at the target in the walk direction. */
	along: Complex;
}

/**
 * Walks from the root to the target leaf: series elements share one current, a parallel block
 * splits it with a current divider. Returns null when the target is not in the tree.
 */
export function walkToTarget(args: SpWalkArgs): SpWalk | null {
	const { targetId, mode } = args;
	const has = (n: SpTree): boolean =>
		n.kind === 'leaf' ? n.edge.id === targetId : n.children.some(has);
	if (!has(args.root)) return null;

	const lines: string[] = [];
	const val = (c: Complex) => formatLatexValue(c, mode);
	const term = (c: Complex) => formatLatexTerm(c, mode);

	let node: SpTree = args.root;
	let entry = args.entry;
	let cur = args.current;
	let curName = args.currentName;

	for (let guard = 0; guard < 1000; guard++) {
		if (node.kind === 'leaf') {
			const reversed = node.from !== entry;
			return {
				lines,
				current: reversed ? cur.neg() : cur,
				name: curName,
				reversed,
				along: cur
			};
		}
		if (node.kind === 'series') {
			let at = entry;
			let next: SpTree | undefined;
			// Children run from node.from to node.to; walk them from the end the current enters.
			const kids = node.from === entry ? node.children : [...node.children].reverse();
			for (const c of kids) {
				if (has(c)) {
					next = c;
					entry = at;
					break;
				}
				at = other(c, at);
			}
			if (!next) return null;
			node = next;
			continue;
		}
		// Parallel block: current divider.
		const child = node.children.find(has)!;
		const rest = node.children.filter((c) => c !== child);
		const yRest = rest.reduce((acc, c) => acc.add(c.z.inv()), Complex.zero());
		if (yRest.isZero(1e-15)) return null;
		const zRest = yRest.inv();
		if (!zRest.isFinite() || child.z.add(zRest).isZero(1e-12)) return null;
		const restName =
			rest.length === 1
				? nameExpr(rest[0], 'series')
				: `(${rest.map((c) => nameExpr(c, 'parallel')).join(' \\parallel ')})`;
		const restNameTop =
			rest.length === 1
				? nameExpr(rest[0], 'top')
				: rest.map((c) => nameExpr(c, 'parallel')).join(' \\parallel ');
		const childName = nameExpr(child, 'series');
		const childCur = cur.mul(zRest).div(child.z.add(zRest));
		const leafReversed = child.kind === 'leaf' && child.from !== entry;
		const outName =
			child.kind === 'leaf'
				? leafReversed
					? `I_{${nameExpr(child, 'top')}}`
					: args.finalName
				: `I_{${nameExpr(child, 'top')}}`;
		lines.push(
			`${outName} = ${curName} \\cdot \\frac{${restNameTop}}{${childName} + ${restName}} = ${term(cur)} \\cdot \\frac{${term(zRest)}}{${term(child.z)} + ${term(zRest)}} = ${val(childCur)}\\text{ A}`
		);
		cur = childCur;
		curName = outName;
		node = child;
	}
	return null;
}
