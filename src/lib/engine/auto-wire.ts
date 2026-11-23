/**
 * Pure Algorithmic (Non-AI) Auto-Wire Engine for Circuit Lab.
 *
 * Phase A — Schematic Rail & Geometric Connection Inference:
 *   Uses Union-Find over component pins (respecting all existing wires and touching pins),
 *   enforces zero self-shorts and avoids voltage-source/DC-inductor loops, and closes
 *   dangling pins, disconnected islands, and open return-path cut-edges (bridges) using
 *   rail-aligned, exit-direction-aware geometric affinity scoring.
 *
 * Phase B — Obstacle-Avoiding Orthogonal Manhattan A* Grid Router:
 *   Routes planned connections on the integer schematic grid using a direction-aware
 *   (x, y, H|V) A* router that strictly avoids component body interiors, foreign pins,
 *   foreign wire vertices, collinear foreign wire overlaps, and turns on foreign wires,
 *   followed by a `buildElectricalGraph` post-route verification gate.
 */

import { buildElectricalGraph, getPinPositions } from './graph';
import {
	isDependentVoltageSource,
	type CircuitDocument,
	type CircuitWire,
	type ComponentKind,
	type GridPoint
} from './types';

export interface AutoWireResult {
	wires: CircuitWire[];
	addedWires: CircuitWire[];
	connectionsAdded: number;
	skippedReason?: 'too_few_components' | 'already_connected' | 'no_valid_connections';
}

interface PinInfo {
	id: number;
	compId: string;
	compKind: ComponentKind;
	isTwoTerminal: boolean;
	pinIndex: number;
	x: number;
	y: number;
	exitDx: number;
	exitDy: number;
	initialNodeId: string;
}

interface TwoTerminalPair {
	compId: string;
	kind: ComponentKind;
	pin0: number;
	pin1: number;
}

class UnionFind {
	private parent: number[];
	private rank: number[];

	constructor(size: number) {
		this.parent = Array.from({ length: size }, (_, i) => i);
		this.rank = new Array<number>(size).fill(0);
	}

	find(x: number): number {
		let root = x;
		while (this.parent[root] !== root) {
			root = this.parent[root];
		}
		let curr = x;
		while (curr !== root) {
			const next = this.parent[curr];
			this.parent[curr] = root;
			curr = next;
		}
		return root;
	}

	union(a: number, b: number): boolean {
		const ra = this.find(a);
		const rb = this.find(b);
		if (ra === rb) return false;
		if (this.rank[ra] < this.rank[rb]) {
			this.parent[ra] = rb;
		} else if (this.rank[ra] > this.rank[rb]) {
			this.parent[rb] = ra;
		} else {
			this.parent[rb] = ra;
			this.rank[ra]++;
		}
		return true;
	}
}

interface HeapItem {
	state: number;
	f: number;
	h: number;
}

class MinHeap {
	private data: HeapItem[] = [];

	get size(): number {
		return this.data.length;
	}

	push(item: HeapItem): void {
		this.data.push(item);
		this.bubbleUp(this.data.length - 1);
	}

	pop(): HeapItem | undefined {
		if (this.data.length === 0) return undefined;
		const top = this.data[0];
		const last = this.data.pop()!;
		if (this.data.length > 0) {
			this.data[0] = last;
			this.sinkDown(0);
		}
		return top;
	}

	private less(a: HeapItem, b: HeapItem): boolean {
		if (a.f !== b.f) return a.f < b.f;
		if (a.h !== b.h) return a.h < b.h;
		return a.state < b.state;
	}

	private bubbleUp(idx: number): void {
		let i = idx;
		while (i > 0) {
			const parent = (i - 1) >> 1;
			if (!this.less(this.data[i], this.data[parent])) break;
			const tmp = this.data[i];
			this.data[i] = this.data[parent];
			this.data[parent] = tmp;
			i = parent;
		}
	}

	private sinkDown(idx: number): void {
		const n = this.data.length;
		let i = idx;
		while (true) {
			const left = i * 2 + 1;
			const right = left + 1;
			let smallest = i;
			if (left < n && this.less(this.data[left], this.data[smallest])) {
				smallest = left;
			}
			if (right < n && this.less(this.data[right], this.data[smallest])) {
				smallest = right;
			}
			if (smallest === i) break;
			const tmp = this.data[i];
			this.data[i] = this.data[smallest];
			this.data[smallest] = tmp;
			i = smallest;
		}
	}
}

function cellKey(x: number, y: number): string {
	return `${x},${y}`;
}

function edgeKey(x1: number, y1: number, x2: number, y2: number): string {
	if (x1 < x2 || (x1 === x2 && y1 <= y2)) {
		return `${x1},${y1}|${x2},${y2}`;
	}
	return `${x2},${y2}|${x1},${y1}`;
}

function cloneWire(w: CircuitWire): CircuitWire {
	return {
		id: w.id,
		points: w.points.map((p) => ({ x: p.x, y: p.y }))
	};
}

function simplifyPolyline(points: GridPoint[]): GridPoint[] {
	const deduped: GridPoint[] = [];
	for (const pt of points) {
		const prev = deduped[deduped.length - 1];
		if (!prev || prev.x !== pt.x || prev.y !== pt.y) {
			deduped.push({ x: pt.x, y: pt.y });
		}
	}
	if (deduped.length <= 2) return deduped;
	const out: GridPoint[] = [deduped[0]];
	for (let i = 1; i < deduped.length - 1; i++) {
		const a = out[out.length - 1];
		const b = deduped[i];
		const c = deduped[i + 1];
		const sameX = a.x === b.x && b.x === c.x;
		const sameY = a.y === b.y && b.y === c.y;
		if (!sameX && !sameY) {
			out.push(b);
		}
	}
	out.push(deduped[deduped.length - 1]);
	return out;
}

function isTwoTerminalKind(kind: ComponentKind): boolean {
	return kind !== 'ground' && kind !== 'terminal';
}

function manhattanDist(a: GridPoint, b: GridPoint): number {
	return Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
}

/**
 * Finds all bridge (cut-edge) indices in an undirected multigraph using Tarjan's algorithm.
 * Parallel edges between the same two vertices are properly handled (neither is a bridge).
 */
function findMultigraphBridges(
	vertexIds: number[],
	edges: Array<{ id: number; u: number; v: number }>
): number[] {
	const adj = new Map<number, Array<{ to: number; edgeId: number }>>();
	for (const v of vertexIds) {
		adj.set(v, []);
	}
	for (const e of edges) {
		if (e.u === e.v) continue;
		adj.get(e.u)?.push({ to: e.v, edgeId: e.id });
		adj.get(e.v)?.push({ to: e.u, edgeId: e.id });
	}

	const disc = new Map<number, number>();
	const low = new Map<number, number>();
	const bridges: number[] = [];
	let timer = 0;

	const dfs = (u: number, parentEdgeId: number): void => {
		timer++;
		disc.set(u, timer);
		low.set(u, timer);

		for (const { to, edgeId } of adj.get(u) ?? []) {
			if (edgeId === parentEdgeId) continue;
			if (!disc.has(to)) {
				dfs(to, edgeId);
				const lowTo = low.get(to)!;
				if (lowTo < low.get(u)!) {
					low.set(u, lowTo);
				}
				if (lowTo > disc.get(u)!) {
					bridges.push(edgeId);
				}
			} else {
				const discTo = disc.get(to)!;
				if (discTo < low.get(u)!) {
					low.set(u, discTo);
				}
			}
		}
	};

	for (const v of vertexIds) {
		if (!disc.has(v)) {
			dfs(v, -1);
		}
	}

	return bridges;
}

/**
 * Collects all vertices reachable from `start` without traversing `excludedEdgeId`.
 */
function collectSideWithoutEdge(
	start: number,
	excludedEdgeId: number,
	edges: Array<{ id: number; u: number; v: number }>
): Set<number> {
	const adj = new Map<number, number[]>();
	for (const e of edges) {
		if (e.id === excludedEdgeId || e.u === e.v) continue;
		let listU = adj.get(e.u);
		if (!listU) {
			listU = [];
			adj.set(e.u, listU);
		}
		listU.push(e.v);
		let listV = adj.get(e.v);
		if (!listV) {
			listV = [];
			adj.set(e.v, listV);
		}
		listV.push(e.u);
	}

	const visited = new Set<number>([start]);
	const queue: number[] = [start];
	while (queue.length > 0) {
		const curr = queue.shift()!;
		for (const next of adj.get(curr) ?? []) {
			if (!visited.has(next)) {
				visited.add(next);
				queue.push(next);
			}
		}
	}
	return visited;
}

interface GridOccupancy {
	hWireOwner: Map<string, Set<number>>;
	vWireOwner: Map<string, Set<number>>;
	vertexOwner: Map<string, Set<number>>;
	hEdgeOwner: Map<string, Set<number>>;
	vEdgeOwner: Map<string, Set<number>>;
}

function addSetMap(map: Map<string, Set<number>>, key: string, netId: number): void {
	let set = map.get(key);
	if (!set) {
		set = new Set<number>();
		map.set(key, set);
	}
	set.add(netId);
}

function hasForeignOwner(map: Map<string, Set<number>>, key: string, myNet: number): boolean {
	const set = map.get(key);
	if (!set) return false;
	for (const owner of set) {
		if (owner !== myNet) return true;
	}
	return false;
}

function hasSameOwner(map: Map<string, Set<number>>, key: string, myNet: number): boolean {
	const set = map.get(key);
	return set ? set.has(myNet) : false;
}

function registerWireInOccupancy(
	occ: GridOccupancy,
	points: GridPoint[],
	netId: number,
	collectCells?: Set<string>
): void {
	for (const pt of points) {
		const ck = cellKey(pt.x, pt.y);
		addSetMap(occ.vertexOwner, ck, netId);
		collectCells?.add(ck);
	}
	for (let i = 0; i + 1 < points.length; i++) {
		const a = points[i];
		const b = points[i + 1];
		if (a.y === b.y && a.x !== b.x) {
			const step = b.x > a.x ? 1 : -1;
			for (let x = a.x; x !== b.x; x += step) {
				const nx = x + step;
				addSetMap(occ.hEdgeOwner, edgeKey(x, a.y, nx, a.y), netId);
				addSetMap(occ.hWireOwner, cellKey(x, a.y), netId);
				addSetMap(occ.hWireOwner, cellKey(nx, a.y), netId);
				collectCells?.add(cellKey(x, a.y));
				collectCells?.add(cellKey(nx, a.y));
			}
		} else if (a.x === b.x && a.y !== b.y) {
			const step = b.y > a.y ? 1 : -1;
			for (let y = a.y; y !== b.y; y += step) {
				const ny = y + step;
				addSetMap(occ.vEdgeOwner, edgeKey(a.x, y, a.x, ny), netId);
				addSetMap(occ.vWireOwner, cellKey(a.x, y), netId);
				addSetMap(occ.vWireOwner, cellKey(a.x, ny), netId);
				collectCells?.add(cellKey(a.x, y));
				collectCells?.add(cellKey(a.x, ny));
			}
		}
	}
}

/**
 * Pure deterministic algorithmic auto-wirer.
 * Respects all existing wires in `doc.wires` and appends only new, verified orthogonal wires.
 */
export function autoWireDocument(doc: CircuitDocument): AutoWireResult {
	const baseWires = doc.wires.map(cloneWire);

	if (doc.components.filter((c) => c.kind !== 'voltmeter').length < 2) {
		return {
			wires: baseWires,
			addedWires: [],
			connectionsAdded: 0,
			skippedReason: 'too_few_components'
		};
	}

	// =========================================================================
	// Step 1: Initial Electrical Graph & Geometry Analysis
	// =========================================================================
	const initialGraph = buildElectricalGraph(doc);
	const pins: PinInfo[] = [];
	const compPinIds = new Map<string, number[]>();
	const twoTerminalPairs: TwoTerminalPair[] = [];
	const interiorObstacles = new Set<string>();
	const bodyMarginCells = new Set<string>();
	const pinCellToPinIds = new Map<string, number[]>();
	const voltmeterObstaclePins: Array<{ x: number; y: number; initialNodeId: string }> = [];
	const voltmeterObstaclePinCells = new Set<string>();

	for (const comp of doc.components) {
		const rawPins = initialGraph.componentPins[comp.id] ?? getPinPositions(comp);
		const compNodes = initialGraph.componentNodes[comp.id] ?? [];

		// Voltmeters are excluded from Phase A automatic connection inference,
		// but their bodies and pins remain obstacles so circuit wires route cleanly around them.
		if (comp.kind === 'voltmeter') {
			if (rawPins.length === 2) {
				const p0 = rawPins[0];
				const p1 = rawPins[1];
				voltmeterObstaclePins.push(
					{ x: p0.x, y: p0.y, initialNodeId: compNodes[0] ?? '' },
					{ x: p1.x, y: p1.y, initialNodeId: compNodes[1] ?? '' }
				);
				voltmeterObstaclePinCells.add(cellKey(p0.x, p0.y));
				voltmeterObstaclePinCells.add(cellKey(p1.x, p1.y));
				if (p0.y === p1.y && p0.x !== p1.x) {
					const minX = Math.min(p0.x, p1.x);
					const maxX = Math.max(p0.x, p1.x);
					for (let x = minX + 1; x < maxX; x++) {
						interiorObstacles.add(cellKey(x, p0.y));
						bodyMarginCells.add(cellKey(x, p0.y - 1));
						bodyMarginCells.add(cellKey(x, p0.y + 1));
					}
				} else if (p0.x === p1.x && p0.y !== p1.y) {
					const minY = Math.min(p0.y, p1.y);
					const maxY = Math.max(p0.y, p1.y);
					for (let y = minY + 1; y < maxY; y++) {
						interiorObstacles.add(cellKey(p0.x, y));
						bodyMarginCells.add(cellKey(p0.x - 1, y));
						bodyMarginCells.add(cellKey(p0.x + 1, y));
					}
				}
			}
			continue;
		}

		const twoTerm = isTwoTerminalKind(comp.kind);
		const ids: number[] = [];

		for (const rp of rawPins) {
			const id = pins.length;
			const dx = rp.x - comp.x;
			const dy = rp.y - comp.y;
			const pinInfo: PinInfo = {
				id,
				compId: comp.id,
				compKind: comp.kind,
				isTwoTerminal: twoTerm,
				pinIndex: rp.index,
				x: rp.x,
				y: rp.y,
				exitDx: twoTerm ? Math.sign(dx) : 0,
				exitDy: twoTerm ? Math.sign(dy) : 0,
				initialNodeId: compNodes[rp.index] ?? `__isolated_${id}`
			};
			pins.push(pinInfo);
			ids.push(id);

			const ck = cellKey(rp.x, rp.y);
			let list = pinCellToPinIds.get(ck);
			if (!list) {
				list = [];
				pinCellToPinIds.set(ck, list);
			}
			list.push(id);
		}

		compPinIds.set(comp.id, ids);

		if (twoTerm && rawPins.length === 2) {
			twoTerminalPairs.push({
				compId: comp.id,
				kind: comp.kind,
				pin0: ids[0],
				pin1: ids[1]
			});

			const p0 = rawPins[0];
			const p1 = rawPins[1];
			if (p0.y === p1.y && p0.x !== p1.x) {
				const minX = Math.min(p0.x, p1.x);
				const maxX = Math.max(p0.x, p1.x);
				for (let x = minX + 1; x < maxX; x++) {
					interiorObstacles.add(cellKey(x, p0.y));
					bodyMarginCells.add(cellKey(x, p0.y - 1));
					bodyMarginCells.add(cellKey(x, p0.y + 1));
				}
			} else if (p0.x === p1.x && p0.y !== p1.y) {
				const minY = Math.min(p0.y, p1.y);
				const maxY = Math.max(p0.y, p1.y);
				for (let y = minY + 1; y < maxY; y++) {
					interiorObstacles.add(cellKey(p0.x, y));
					bodyMarginCells.add(cellKey(p0.x - 1, y));
					bodyMarginCells.add(cellKey(p0.x + 1, y));
				}
			}
		}
	}

	if (pins.length < 2) {
		return {
			wires: baseWires,
			addedWires: [],
			connectionsAdded: 0,
			skippedReason: 'too_few_components'
		};
	}

	// Build Union-Find initialized from existing electrical nodes
	const uf = new UnionFind(pins.length);
	const initialNodeFirstPin = new Map<string, number>();
	for (const p of pins) {
		const first = initialNodeFirstPin.get(p.initialNodeId);
		if (first !== undefined) {
			uf.union(first, p.id);
		} else {
			initialNodeFirstPin.set(p.initialNodeId, p.id);
		}
	}

	// Track which 2-terminal components were already self-shorted in the input doc
	const initiallySelfShorted = new Set<string>();
	for (const pair of twoTerminalPairs) {
		if (uf.find(pair.pin0) === uf.find(pair.pin1)) {
			initiallySelfShorted.add(pair.compId);
		}
	}

	// Precompute vertical bounds for top/bottom rail awareness
	const twoTermPins = pins.filter((p) => p.isTwoTerminal);
	const boundPins = twoTermPins.length > 0 ? twoTermPins : pins;
	let minPinY = Infinity;
	let maxPinY = -Infinity;
	for (const p of boundPins) {
		if (p.y < minPinY) minPinY = p.y;
		if (p.y > maxPinY) maxPinY = p.y;
	}

	// Helpers over current Union-Find state
	const getNetStats = () => {
		const totalCount = new Map<number, number>();
		const twoTermCount = new Map<number, number>();
		for (const p of pins) {
			const r = uf.find(p.id);
			totalCount.set(r, (totalCount.get(r) ?? 0) + 1);
			if (p.isTwoTerminal) {
				twoTermCount.set(r, (twoTermCount.get(r) ?? 0) + 1);
			}
		}
		return { totalCount, twoTermCount };
	};

	const isPinDangling = (
		p: PinInfo,
		stats: { totalCount: Map<number, number>; twoTermCount: Map<number, number> }
	): boolean => {
		const r = uf.find(p.id);
		if (p.isTwoTerminal) {
			return (stats.twoTermCount.get(r) ?? 0) < 2;
		}
		return (stats.totalCount.get(r) ?? 0) < 2;
	};

	/**
	 * Strict Safety Predicate:
	 * - Pins must be in different nets.
	 * - Merging their nets must NEVER self-short any 2-terminal component.
	 */
	const canSafelyConnect = (aId: number, bId: number): boolean => {
		const rootA = uf.find(aId);
		const rootB = uf.find(bId);
		if (rootA === rootB) return false;
		for (const pair of twoTerminalPairs) {
			const r0 = uf.find(pair.pin0);
			const r1 = uf.find(pair.pin1);
			if ((r0 === rootA && r1 === rootB) || (r0 === rootB && r1 === rootA)) {
				return false;
			}
		}
		return true;
	};

	/**
	 * Checks whether merging rootA and rootB would close a zero-impedance loop
	 * of ideal voltage sources (or DC inductors when mode === 'dc').
	 */
	const wouldCreateZeroImpedanceLoop = (rootA: number, rootB: number): boolean => {
		const adj = new Map<number, number[]>();
		for (const pair of twoTerminalPairs) {
			const isZeroImpedance =
				pair.kind === 'voltage_source' ||
				isDependentVoltageSource(pair.kind) ||
				(doc.mode === 'dc' && pair.kind === 'inductor');
			if (!isZeroImpedance) continue;
			const r0 = uf.find(pair.pin0);
			const r1 = uf.find(pair.pin1);
			if (r0 === r1) continue;
			let l0 = adj.get(r0);
			if (!l0) {
				l0 = [];
				adj.set(r0, l0);
			}
			l0.push(r1);
			let l1 = adj.get(r1);
			if (!l1) {
				l1 = [];
				adj.set(r1, l1);
			}
			l1.push(r0);
		}

		const visited = new Set<number>([rootA]);
		const queue: number[] = [rootA];
		while (queue.length > 0) {
			const curr = queue.shift()!;
			if (curr === rootB) return true;
			for (const next of adj.get(curr) ?? []) {
				if (!visited.has(next)) {
					visited.add(next);
					queue.push(next);
				}
			}
		}
		return false;
	};

	/**
	 * Returns true if pins A and B lie on the same horizontal or vertical line
	 * with zero component bodies and zero other pins strictly between them.
	 */
	const isUnobstructedStraightLine = (a: PinInfo, b: PinInfo): boolean => {
		if (a.y === b.y && a.x !== b.x) {
			const minX = Math.min(a.x, b.x);
			const maxX = Math.max(a.x, b.x);
			for (let x = minX + 1; x < maxX; x++) {
				const ck = cellKey(x, a.y);
				if (interiorObstacles.has(ck)) return false;
				if (pinCellToPinIds.has(ck) || voltmeterObstaclePinCells.has(ck)) return false;
			}
			return true;
		}
		if (a.x === b.x && a.y !== b.y) {
			const minY = Math.min(a.y, b.y);
			const maxY = Math.max(a.y, b.y);
			for (let y = minY + 1; y < maxY; y++) {
				const ck = cellKey(a.x, y);
				if (interiorObstacles.has(ck)) return false;
				if (pinCellToPinIds.has(ck) || voltmeterObstaclePinCells.has(ck)) return false;
			}
			return true;
		}
		return false;
	};

	/**
	 * Computes schematic-aware geometric affinity cost between two connectable pins.
	 * Lower is better.
	 */
	const computePairScore = (
		a: PinInfo,
		b: PinInfo,
		bothDanglingBonus: boolean
	): number => {
		const dx = b.x - a.x;
		const dy = b.y - a.y;
		const absDx = Math.abs(dx);
		const absDy = Math.abs(dy);
		const dist = absDx + absDy;
		let cost = dist;

		const rootA = uf.find(a.id);
		const rootB = uf.find(b.id);

		// Avoid parallel ideal voltage sources / zero-impedance loops unless no other option exists
		if (wouldCreateZeroImpedanceLoop(rootA, rootB)) {
			cost += 500;
		}

		// Detect anti-parallel side-by-side pins (e.g., top of one vertical part aligned with bottom of another)
		const isAntiParallelHoriz =
			a.y === b.y &&
			a.isTwoTerminal &&
			b.isTwoTerminal &&
			a.exitDy !== 0 &&
			b.exitDy !== 0 &&
			a.exitDy === -b.exitDy;
		const isAntiParallelVert =
			a.x === b.x &&
			a.isTwoTerminal &&
			b.isTwoTerminal &&
			a.exitDx !== 0 &&
			b.exitDx !== 0 &&
			a.exitDx === -b.exitDx;

		const straightClear = isUnobstructedStraightLine(a, b);
		if (straightClear && !isAntiParallelHoriz && !isAntiParallelVert) {
			cost *= 0.55;
			// Parallel bus co-membership bonus (top-to-top, bottom-to-bottom, left-to-left, right-to-right)
			if (
				(a.y === b.y && a.exitDy !== 0 && a.exitDy === b.exitDy) ||
				(a.x === b.x && a.exitDx !== 0 && a.exitDx === b.exitDx)
			) {
				cost *= 0.85;
			}
		} else if (isAntiParallelHoriz || isAntiParallelVert) {
			cost += 4.0;
		}

		// Exit-direction facing alignment
		const dotA = a.exitDx * dx + a.exitDy * dy;
		const dotB = b.exitDx * -dx + b.exitDy * -dy;

		if (a.isTwoTerminal && b.isTwoTerminal) {
			if (dotA > 0 && dotB > 0) {
				// Clean corner L-bend or directly facing pins across a gap
				cost = cost * 0.72 - 1.2;
			} else if ((dotA > 0 && dotB === 0) || (dotB > 0 && dotA === 0)) {
				cost *= 0.88;
			} else {
				const isCleanSideEntryL =
					absDx >= 2 && absDy >= 2 && ((dotA > 0 && dotB < 0) || (dotB > 0 && dotA < 0));
				if (isCleanSideEntryL) {
					const targetPin = dotA > 0 ? b : a;
					const onExtremeBoundary = targetPin.y === minPinY || targetPin.y === maxPinY;
					cost = onExtremeBoundary ? cost * 0.85 : cost + 1.0;
				} else {
					if (dotA < 0) cost += 4.0;
					if (dotB < 0) cost += 4.0;
				}
			}
		} else if (a.isTwoTerminal !== b.isTwoTerminal) {
			const twoTerm = a.isTwoTerminal ? a : b;
			const oneTerm = a.isTwoTerminal ? b : a;
			const dot = twoTerm.exitDx * (oneTerm.x - twoTerm.x) + twoTerm.exitDy * (oneTerm.y - twoTerm.y);
			if (dot > 0) {
				cost *= 0.75;
			} else if (dot < 0) {
				cost += 4.0;
			}
		}

		// Ground affinity toward bottom-most rail & voltage source negative terminal
		if (a.compKind === 'ground' || b.compKind === 'ground') {
			const other = a.compKind === 'ground' ? b : a;
			if (other.isTwoTerminal) {
				if (other.y === maxPinY) {
					cost -= 2.5;
				}
				if (other.compKind === 'voltage_source' && other.pinIndex === 1) {
					cost -= 1.0;
				}
			}
		}

		if (bothDanglingBonus) {
			cost -= 2.0;
		}

		return cost;
	};

	const computeComponentIslands = (): {
		compIsland: Map<string, number>;
		islandCount: number;
	} => {
		const compCount = doc.components.length;
		const compUf = new UnionFind(compCount);
		const compIndex = new Map<string, number>();
		doc.components.forEach((c, idx) => compIndex.set(c.id, idx));

		const netFirstComp = new Map<number, number>();
		for (const p of pins) {
			const netRoot = uf.find(p.id);
			const ci = compIndex.get(p.compId)!;
			const first = netFirstComp.get(netRoot);
			if (first !== undefined) {
				compUf.union(first, ci);
			} else {
				netFirstComp.set(netRoot, ci);
			}
		}

		const roots = new Set<number>();
		const compIsland = new Map<string, number>();
		doc.components.forEach((c, idx) => {
			const r = compUf.find(idx);
			roots.add(r);
			compIsland.set(c.id, r);
		});

		return { compIsland, islandCount: roots.size };
	};

	const findCurrentBridges = () => {
		const activeRoots = new Set<number>();
		const edges: Array<{ id: number; u: number; v: number }> = [];
		twoTerminalPairs.forEach((pair, idx) => {
			const u = uf.find(pair.pin0);
			const v = uf.find(pair.pin1);
			activeRoots.add(u);
			activeRoots.add(v);
			if (u !== v) {
				edges.push({ id: idx, u, v });
			}
		});
		const bridgeIds = findMultigraphBridges(Array.from(activeRoots), edges);
		return { bridgeIds, edges };
	};

	// Check if already completely connected before modifying Union-Find
	const initialStats = getNetStats();
	const hasInitialDangling = pins.some((p) => isPinDangling(p, initialStats));
	const initialIslands = computeComponentIslands().islandCount;
	const initialBridges = findCurrentBridges().bridgeIds;

	if (!hasInitialDangling && initialIslands <= 1 && initialBridges.length === 0) {
		return {
			wires: baseWires,
			addedWires: [],
			connectionsAdded: 0,
			skippedReason: 'already_connected'
		};
	}

	// =========================================================================
	// Step 2: Phase A — Deterministic Greedy Closure (Passes 1–4)
	// =========================================================================
	interface CandidatePair {
		a: PinInfo;
		b: PinInfo;
		score: number;
		dist: number;
	}

	const isBetterCandidate = (next: CandidatePair, best: CandidatePair | null): boolean => {
		if (!best) return true;
		if (Math.abs(next.score - best.score) > 1e-9) return next.score < best.score;
		if (next.dist !== best.dist) return next.dist < best.dist;
		const nextMin = Math.min(next.a.id, next.b.id);
		const bestMin = Math.min(best.a.id, best.b.id);
		if (nextMin !== bestMin) return nextMin < bestMin;
		return Math.max(next.a.id, next.b.id) < Math.max(best.a.id, best.b.id);
	};

	let plannedMerges = 0;

	// Pass 1: Close all dangling pins (2-terminal pins with <2 active pins in net, 1-terminal with <2 total pins)
	const maxPass1Iters = pins.length * 2;
	for (let iter = 0; iter < maxPass1Iters; iter++) {
		const stats = getNetStats();
		const danglingSet = new Set<number>();
		for (const p of pins) {
			if (isPinDangling(p, stats)) {
				danglingSet.add(p.id);
			}
		}
		if (danglingSet.size === 0) break;

		let best: CandidatePair | null = null;
		for (let i = 0; i < pins.length; i++) {
			const pA = pins[i];
			const aDang = danglingSet.has(pA.id);
			for (let j = i + 1; j < pins.length; j++) {
				const pB = pins[j];
				const bDang = danglingSet.has(pB.id);
				if (!aDang && !bDang) continue;
				if (!canSafelyConnect(pA.id, pB.id)) continue;
				const score = computePairScore(pA, pB, aDang && bDang);
				const cand: CandidatePair = {
					a: pA,
					b: pB,
					score,
					dist: manhattanDist(pA, pB)
				};
				if (isBetterCandidate(cand, best)) {
					best = cand;
				}
			}
		}

		if (!best) break;
		if (uf.union(best.a.id, best.b.id)) {
			plannedMerges++;
		}
	}

	// Pass 2: Bridge disconnected component islands
	for (let iter = 0; iter < doc.components.length; iter++) {
		const { compIsland, islandCount } = computeComponentIslands();
		if (islandCount <= 1) break;

		let best: CandidatePair | null = null;
		for (let i = 0; i < pins.length; i++) {
			const pA = pins[i];
			const islA = compIsland.get(pA.compId)!;
			for (let j = i + 1; j < pins.length; j++) {
				const pB = pins[j];
				if (islA === compIsland.get(pB.compId)!) continue;
				if (!canSafelyConnect(pA.id, pB.id)) continue;
				const score = computePairScore(pA, pB, false);
				const cand: CandidatePair = {
					a: pA,
					b: pB,
					score,
					dist: manhattanDist(pA, pB)
				};
				if (isBetterCandidate(cand, best)) {
					best = cand;
				}
			}
		}

		if (!best) break;
		if (uf.union(best.a.id, best.b.id)) {
			plannedMerges++;
		}
	}

	// Pass 3: Close cut-edge bridges (ensures complete return paths on multi-section ladders/supernodes)
	for (let iter = 0; iter < doc.components.length; iter++) {
		const { bridgeIds, edges } = findCurrentBridges();
		if (bridgeIds.length === 0) break;

		let best: CandidatePair | null = null;
		for (const bridgeEdgeId of bridgeIds) {
			const bridgeEdge = edges.find((e) => e.id === bridgeEdgeId);
			if (!bridgeEdge) continue;
			const sideU = collectSideWithoutEdge(bridgeEdge.u, bridgeEdgeId, edges);

			for (let i = 0; i < pins.length; i++) {
				const pA = pins[i];
				if (!pA.isTwoTerminal) continue;
				const rA = uf.find(pA.id);
				const aInU = sideU.has(rA);
				for (let j = i + 1; j < pins.length; j++) {
					const pB = pins[j];
					if (!pB.isTwoTerminal) continue;
					const rB = uf.find(pB.id);
					if (aInU === sideU.has(rB)) continue;
					if (!canSafelyConnect(pA.id, pB.id)) continue;
					if (wouldCreateZeroImpedanceLoop(rA, rB)) continue;

					const score = computePairScore(pA, pB, false);
					const cand: CandidatePair = {
						a: pA,
						b: pB,
						score,
						dist: manhattanDist(pA, pB)
					};
					if (isBetterCandidate(cand, best)) {
						best = cand;
					}
				}
			}
		}

		if (!best) break;
		if (uf.union(best.a.id, best.b.id)) {
			plannedMerges++;
		}
	}

	// Pass 4: Ground & 1-terminal tidy-up (ensure no ground or terminal remains isolated)
	for (let iter = 0; iter < pins.length; iter++) {
		const stats = getNetStats();
		const danglingOneTerm = pins.filter((p) => !p.isTwoTerminal && isPinDangling(p, stats));
		if (danglingOneTerm.length === 0) break;

		let best: CandidatePair | null = null;
		for (const pA of danglingOneTerm) {
			for (const pB of pins) {
				if (pA.id === pB.id) continue;
				if (!canSafelyConnect(pA.id, pB.id)) continue;
				const score = computePairScore(pA, pB, false);
				const cand: CandidatePair = {
					a: pA,
					b: pB,
					score,
					dist: manhattanDist(pA, pB)
				};
				if (isBetterCandidate(cand, best)) {
					best = cand;
				}
			}
		}

		if (!best) break;
		if (uf.union(best.a.id, best.b.id)) {
			plannedMerges++;
		}
	}

	if (plannedMerges === 0) {
		return {
			wires: baseWires,
			addedWires: [],
			connectionsAdded: 0,
			skippedReason: 'no_valid_connections'
		};
	}

	// =========================================================================
	// Step 3: Build Grid Occupancy & Per-Net Initial Cluster Maps
	// =========================================================================
	const finalRootByPin = new Map<number, number>();
	const initialNodeToFinalRoot = new Map<string, number>();
	const finalGroups = new Map<number, Map<string, PinInfo[]>>();

	for (const p of pins) {
		const fr = uf.find(p.id);
		finalRootByPin.set(p.id, fr);
		initialNodeToFinalRoot.set(p.initialNodeId, fr);

		let clusters = finalGroups.get(fr);
		if (!clusters) {
			clusters = new Map<string, PinInfo[]>();
			finalGroups.set(fr, clusters);
		}
		let clusterPins = clusters.get(p.initialNodeId);
		if (!clusterPins) {
			clusterPins = [];
			clusters.set(p.initialNodeId, clusterPins);
		}
		clusterPins.push(p);
	}

	// Bounding box for A* routing
	let minX = Infinity;
	let maxX = -Infinity;
	let minY = Infinity;
	let maxY = -Infinity;
	for (const p of pins) {
		if (p.x < minX) minX = p.x;
		if (p.x > maxX) maxX = p.x;
		if (p.y < minY) minY = p.y;
		if (p.y > maxY) maxY = p.y;
	}
	for (const vp of voltmeterObstaclePins) {
		if (vp.x < minX) minX = vp.x;
		if (vp.x > maxX) maxX = vp.x;
		if (vp.y < minY) minY = vp.y;
		if (vp.y > maxY) maxY = vp.y;
	}
	for (const w of baseWires) {
		for (const pt of w.points) {
			if (pt.x < minX) minX = pt.x;
			if (pt.x > maxX) maxX = pt.x;
			if (pt.y < minY) minY = pt.y;
			if (pt.y > maxY) maxY = pt.y;
		}
	}

	// Initialize occupancy from all existing wires (never delete or overwrite user wires)
	const occ: GridOccupancy = {
		hWireOwner: new Map(),
		vWireOwner: new Map(),
		vertexOwner: new Map(),
		hEdgeOwner: new Map(),
		vEdgeOwner: new Map()
	};

	// Map each initialNodeId -> grid cells occupied by existing pins/wires of that initial cluster
	const initialClusterCells = new Map<string, Set<string>>();
	for (const p of pins) {
		let set = initialClusterCells.get(p.initialNodeId);
		if (!set) {
			set = new Set<string>();
			initialClusterCells.set(p.initialNodeId, set);
		}
		set.add(cellKey(p.x, p.y));
	}

	// Map each grid point from initialGraph.nodes to its initialNodeId
	const pointToInitialNode = new Map<string, string>();
	for (const [nodeId, node] of Object.entries(initialGraph.nodes)) {
		for (const gp of node.gridPoints) {
			pointToInitialNode.set(cellKey(gp.x, gp.y), nodeId);
		}
	}

	baseWires.forEach((wire, wireIdx) => {
		let matchedInitialNode: string | undefined;
		for (const pt of wire.points) {
			const nid = pointToInitialNode.get(cellKey(pt.x, pt.y));
			if (nid !== undefined) {
				matchedInitialNode = nid;
				break;
			}
		}
		const netTag =
			matchedInitialNode !== undefined
				? (initialNodeToFinalRoot.get(matchedInitialNode) ?? -(wireIdx + 1))
				: -(wireIdx + 1);
		const cellCollector =
			matchedInitialNode !== undefined ? initialClusterCells.get(matchedInitialNode) : undefined;
		registerWireInOccupancy(occ, wire.points, netTag, cellCollector);
	});

	// Map pin cells to their finalRoot(s) for fast foreign-pin checks during A*
	const pinCellFinalRoots = new Map<string, Set<number>>();
	const pinInfoByCell = new Map<string, PinInfo[]>();
	for (const p of pins) {
		const ck = cellKey(p.x, p.y);
		addSetMap(pinCellFinalRoots, ck, finalRootByPin.get(p.id)!);
		let list = pinInfoByCell.get(ck);
		if (!list) {
			list = [];
			pinInfoByCell.set(ck, list);
		}
		list.push(p);
	}
	// Keep placed voltmeter pins as foreign-pin obstacles so auto-wired nets never touch them
	voltmeterObstaclePins.forEach((vp, idx) => {
		const ck = cellKey(vp.x, vp.y);
		if (pinCellFinalRoots.has(ck)) return;
		const owner =
			vp.initialNodeId && initialNodeToFinalRoot.has(vp.initialNodeId)
				? initialNodeToFinalRoot.get(vp.initialNodeId)!
				: -(100000 + idx + 1);
		addSetMap(pinCellFinalRoots, ck, owner);
	});

	// =========================================================================
	// Step 4: Phase B — Obstacle-Avoiding Orthogonal Manhattan A* Grid Router
	// =========================================================================
	const DIR_H = 0;
	const DIR_V = 1;
	const STEP_COST = 1.0;
	const SAME_NET_COST = 0.25;
	const TURN_COST = 1.5;
	const CROSS_COST = 14.0;
	const BODY_MARGIN_COST = 1.2;
	const EXIT_ALIGN_PENALTY = 0.35;

	const runAStar = (
		startPin: PinInfo,
		goalPoints: GridPoint[],
		myNet: number,
		padding: number
	): GridPoint[] | null => {
		if (goalPoints.length === 0) return null;

		const goalSet = new Set<string>();
		for (const g of goalPoints) {
			goalSet.add(cellKey(g.x, g.y));
		}

		const boxMinX = minX - padding;
		const boxMaxX = maxX + padding;
		const boxMinY = minY - padding;
		const boxMaxY = maxY + padding;
		const width = boxMaxX - boxMinX + 1;
		const height = boxMaxY - boxMinY + 1;
		const totalStates = width * height * 2;

		const toState = (x: number, y: number, dir: number): number =>
			((y - boxMinY) * width + (x - boxMinX)) * 2 + dir;

		const heuristic = (x: number, y: number): number => {
			let best = Infinity;
			for (let i = 0; i < goalPoints.length; i++) {
				const d = Math.abs(x - goalPoints[i].x) + Math.abs(y - goalPoints[i].y);
				if (d < best) best = d;
			}
			// Admissible lower bound since SAME_NET_COST = 0.25
			return best * SAME_NET_COST;
		};

		const gScore = new Float64Array(totalStates);
		gScore.fill(Infinity);
		const cameFrom = new Int32Array(totalStates);
		cameFrom.fill(-1);
		const closed = new Uint8Array(totalStates);

		const heap = new MinHeap();
		const startH = heuristic(startPin.x, startPin.y);

		// Prefer leaving a 2-terminal pin along its lead axis
		const hInitCost =
			startPin.isTwoTerminal && startPin.exitDy !== 0 && startPin.exitDx === 0
				? EXIT_ALIGN_PENALTY
				: 0;
		const vInitCost =
			startPin.isTwoTerminal && startPin.exitDx !== 0 && startPin.exitDy === 0
				? EXIT_ALIGN_PENALTY
				: 0;

		const sH = toState(startPin.x, startPin.y, DIR_H);
		const sV = toState(startPin.x, startPin.y, DIR_V);
		gScore[sH] = hInitCost;
		gScore[sV] = vInitCost;
		heap.push({ state: sH, f: hInitCost + startH, h: startH });
		heap.push({ state: sV, f: vInitCost + startH, h: startH });

		const deltas: Array<[number, number, number]> = [
			[1, 0, DIR_H],
			[-1, 0, DIR_H],
			[0, 1, DIR_V],
			[0, -1, DIR_V]
		];

		let goalState = -1;

		while (heap.size > 0) {
			const top = heap.pop()!;
			const currState = top.state;
			if (closed[currState]) continue;
			closed[currState] = 1;

			const dir = currState & 1;
			const cellIdx = currState >> 1;
			const cx = (cellIdx % width) + boxMinX;
			const cy = Math.floor(cellIdx / width) + boxMinY;
			const currKey = cellKey(cx, cy);

			if (goalSet.has(currKey) && !(cx === startPin.x && cy === startPin.y)) {
				goalState = currState;
				break;
			}

			const currG = gScore[currState];
			const isAtStart = cx === startPin.x && cy === startPin.y;
			const currHasForeignWire =
				hasForeignOwner(occ.hWireOwner, currKey, myNet) ||
				hasForeignOwner(occ.vWireOwner, currKey, myNet);

			for (let dIdx = 0; dIdx < 4; dIdx++) {
				const [dx, dy, nextDir] = deltas[dIdx];
				const nx = cx + dx;
				const ny = cy + dy;

				if (nx < boxMinX || nx > boxMaxX || ny < boxMinY || ny > boxMaxY) continue;

				const isTurn = !isAtStart && nextDir !== dir;
				// Never turn on a cell occupied by a foreign wire (would create a T-junction vertex!)
				if (isTurn && currHasForeignWire) continue;

				const nextKey = cellKey(nx, ny);
				// Never enter a component body interior
				if (interiorObstacles.has(nextKey)) continue;
				// Never enter a foreign component pin
				if (hasForeignOwner(pinCellFinalRoots, nextKey, myNet)) continue;
				// Never pass through a foreign wire vertex (endpoint or bend corner)
				if (hasForeignOwner(occ.vertexOwner, nextKey, myNet)) continue;

				const ek = edgeKey(cx, cy, nx, ny);
				if (nextDir === DIR_H) {
					// Never run collinearly along a foreign horizontal wire
					if (hasForeignOwner(occ.hEdgeOwner, ek, myNet)) continue;
					if (hasForeignOwner(occ.hWireOwner, nextKey, myNet)) continue;
				} else {
					// Never run collinearly along a foreign vertical wire
					if (hasForeignOwner(occ.vEdgeOwner, ek, myNet)) continue;
					if (hasForeignOwner(occ.vWireOwner, nextKey, myNet)) continue;
				}

				const isSameNetEdge =
					nextDir === DIR_H
						? hasSameOwner(occ.hEdgeOwner, ek, myNet)
						: hasSameOwner(occ.vEdgeOwner, ek, myNet);

				let moveCost = isSameNetEdge ? SAME_NET_COST : STEP_COST;
				if (isTurn) {
					moveCost += TURN_COST;
				}

				// Soft penalty for perpendicular straight-through crossing of a foreign wire
				if (nextDir === DIR_H && hasForeignOwner(occ.vWireOwner, nextKey, myNet)) {
					// Cannot terminate on a foreign wire cell either
					if (goalSet.has(nextKey)) continue;
					moveCost += CROSS_COST;
				} else if (nextDir === DIR_V && hasForeignOwner(occ.hWireOwner, nextKey, myNet)) {
					if (goalSet.has(nextKey)) continue;
					moveCost += CROSS_COST;
				}

				// Soft margin clearance around component bodies
				if (!isSameNetEdge && bodyMarginCells.has(nextKey) && !goalSet.has(nextKey)) {
					moveCost += BODY_MARGIN_COST;
				}

				// Subtle preference to enter a goal 2-terminal pin along its lead axis
				if (goalSet.has(nextKey)) {
					const goalPinsAtCell = pinInfoByCell.get(nextKey);
					if (goalPinsAtCell && goalPinsAtCell.length === 1 && goalPinsAtCell[0].isTwoTerminal) {
						const gp = goalPinsAtCell[0];
						const aligned =
							(nextDir === DIR_H && gp.exitDx !== 0) || (nextDir === DIR_V && gp.exitDy !== 0);
						if (!aligned) {
							moveCost += EXIT_ALIGN_PENALTY;
						}
					}
				}

				const nextState = toState(nx, ny, nextDir);
				if (closed[nextState]) continue;

				const tentativeG = currG + moveCost;
				if (tentativeG < gScore[nextState]) {
					gScore[nextState] = tentativeG;
					cameFrom[nextState] = currState;
					const h = heuristic(nx, ny);
					heap.push({ state: nextState, f: tentativeG + h, h });
				}
			}
		}

		if (goalState === -1) return null;

		const rawPath: GridPoint[] = [];
		let curr = goalState;
		while (curr !== -1) {
			const cellIdx = curr >> 1;
			const x = (cellIdx % width) + boxMinX;
			const y = Math.floor(cellIdx / width) + boxMinY;
			rawPath.push({ x, y });
			curr = cameFrom[curr];
		}
		rawPath.reverse();
		return simplifyPolyline(rawPath);
	};

	// Plan net routing order: shorter / straight-rail nets first
	interface NetRoutingPlan {
		finalRoot: number;
		clusters: Array<{ initialNodeId: string; pins: PinInfo[]; cells: Set<string> }>;
		minPairDist: number;
	}

	const netPlans: NetRoutingPlan[] = [];
	for (const [finalRoot, clusterMap] of finalGroups.entries()) {
		if (clusterMap.size < 2) continue;
		const clusters = Array.from(clusterMap.entries()).map(([initialNodeId, cPins]) => ({
			initialNodeId,
			pins: cPins,
			cells: new Set<string>(initialClusterCells.get(initialNodeId) ?? [])
		}));

		let minPairDist = Infinity;
		for (let i = 0; i < clusters.length; i++) {
			for (let j = i + 1; j < clusters.length; j++) {
				for (const pA of clusters[i].pins) {
					for (const pB of clusters[j].pins) {
						const d = manhattanDist(pA, pB);
						if (d < minPairDist) minPairDist = d;
					}
				}
			}
		}

		netPlans.push({ finalRoot, clusters, minPairDist });
	}

	netPlans.sort((a, b) => {
		if (a.minPairDist !== b.minPairDist) return a.minPairDist - b.minPairDist;
		return a.finalRoot - b.finalRoot;
	});

	// Unique wire ID allocator avoiding collisions with existing wires
	const usedWireIds = new Set(baseWires.map((w) => w.id));
	let nextWireNum = 1;
	const allocateWireId = (): string => {
		while (usedWireIds.has(`w${nextWireNum}`)) {
			nextWireNum++;
		}
		const id = `w${nextWireNum}`;
		usedWireIds.add(id);
		return id;
	};

	const parseCellKey = (ck: string): GridPoint => {
		const comma = ck.indexOf(',');
		return {
			x: Number(ck.slice(0, comma)),
			y: Number(ck.slice(comma + 1))
		};
	};

	const addedWires: CircuitWire[] = [];
	const accumulatedWires: CircuitWire[] = [...baseWires];

	/**
	 * Post-route safety verification via `buildElectricalGraph`:
	 * ensures zero newly introduced self-shorts and zero unintended merges
	 * between distinct planned nets.
	 */
	const verifyCandidateWire = (candidate: CircuitWire): boolean => {
		const testDoc: CircuitDocument = {
			...doc,
			wires: [...accumulatedWires, candidate]
		};
		const testGraph = buildElectricalGraph(testDoc);

		// 1. Zero newly introduced component self-shorts
		for (const pair of twoTerminalPairs) {
			if (initiallySelfShorted.has(pair.compId)) continue;
			const nodes = testGraph.componentNodes[pair.compId];
			if (nodes && nodes.length === 2 && nodes[0] === nodes[1]) {
				return false;
			}
		}

		// 2. No unintended merge between pins of different planned finalRoots
		const actualNodeToFinalRoot = new Map<string, number>();
		for (const p of pins) {
			const actualNode = testGraph.componentNodes[p.compId]?.[p.pinIndex];
			if (!actualNode) continue;
			const expectedRoot = finalRootByPin.get(p.id)!;
			const seenRoot = actualNodeToFinalRoot.get(actualNode);
			if (seenRoot !== undefined && seenRoot !== expectedRoot) {
				return false;
			}
			actualNodeToFinalRoot.set(actualNode, expectedRoot);
		}

		return true;
	};

	// Route each multi-cluster net via Prim's MST + dynamic target T-tapping
	for (const plan of netPlans) {
		const { finalRoot, clusters } = plan;

		// Seed connected group with cluster 0 (or pick cluster with lowest-dist edge first)
		let seedIdx = 0;
		let bestSeedDist = Infinity;
		for (let i = 0; i < clusters.length; i++) {
			for (let j = i + 1; j < clusters.length; j++) {
				for (const pA of clusters[i].pins) {
					for (const pB of clusters[j].pins) {
						let w = manhattanDist(pA, pB);
						if (isUnobstructedStraightLine(pA, pB)) w *= 0.55;
						if (w < bestSeedDist) {
							bestSeedDist = w;
							seedIdx = i;
						}
					}
				}
			}
		}

		const connectedClusterIndices = new Set<number>([seedIdx]);
		const routedNetCells = new Set<string>(clusters[seedIdx].cells);

		while (connectedClusterIndices.size < clusters.length) {
			// Pick the unconnected cluster & start pin closest to the already-routed net cells
			let bestClusterIdx = -1;
			let bestStartPin: PinInfo | null = null;
			let bestWeight = Infinity;

			const safeGoalPoints: GridPoint[] = [];
			for (const ck of routedNetCells) {
				if (
					!hasForeignOwner(occ.hWireOwner, ck, finalRoot) &&
					!hasForeignOwner(occ.vWireOwner, ck, finalRoot) &&
					!hasForeignOwner(occ.vertexOwner, ck, finalRoot) &&
					!hasForeignOwner(pinCellFinalRoots, ck, finalRoot)
				) {
					safeGoalPoints.push(parseCellKey(ck));
				}
			}

			if (safeGoalPoints.length === 0) break;

			for (let cIdx = 0; cIdx < clusters.length; cIdx++) {
				if (connectedClusterIndices.has(cIdx)) continue;
				for (const p of clusters[cIdx].pins) {
					for (const gp of safeGoalPoints) {
						let w = manhattanDist(p, gp);
						if ((p.x === gp.x || p.y === gp.y) && w > 0) {
							// Favor clean straight collinear taps along the rail
							const targetPins = pinInfoByCell.get(cellKey(gp.x, gp.y));
							const clear =
								targetPins && targetPins.length > 0
									? isUnobstructedStraightLine(p, targetPins[0])
									: true;
							if (clear) {
								w *= 0.55;
							}
						}
						if (w < bestWeight) {
							bestWeight = w;
							bestClusterIdx = cIdx;
							bestStartPin = p;
						}
					}
				}
			}

			if (bestClusterIdx === -1 || !bestStartPin) break;

			// Attempt A* routing (with expanded padding fallback if tight)
			let path = runAStar(bestStartPin, safeGoalPoints, finalRoot, 6);
			if (!path) {
				path = runAStar(bestStartPin, safeGoalPoints, finalRoot, 12);
			}

			// Mark cluster as processed so we never infinite-loop if unroutable
			connectedClusterIndices.add(bestClusterIdx);

			if (!path || path.length < 2) {
				continue;
			}

			const candidateWire: CircuitWire = {
				id: allocateWireId(),
				points: path
			};

			if (!verifyCandidateWire(candidateWire)) {
				continue;
			}

			addedWires.push(candidateWire);
			accumulatedWires.push(candidateWire);

			// Update occupancy & merge this cluster's cells into routedNetCells
			registerWireInOccupancy(occ, candidateWire.points, finalRoot, routedNetCells);
			for (const ck of clusters[bestClusterIdx].cells) {
				routedNetCells.add(ck);
			}
		}
	}

	if (addedWires.length === 0) {
		return {
			wires: baseWires,
			addedWires: [],
			connectionsAdded: 0,
			skippedReason: 'no_valid_connections'
		};
	}

	return {
		wires: accumulatedWires,
		addedWires,
		connectionsAdded: addedWires.length
	};
}
