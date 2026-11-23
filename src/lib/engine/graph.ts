/**
 * Schematic geometry -> electrical node graph builder (Union-Find with T-junctions)
 * and circuit topology validator for DC and AC steady-state analysis.
 */

import { Complex } from './complex';
import {
	isCurrentControlledSource,
	isDependentCurrentSource,
	isDependentSourceKind,
	isDependentVoltageSource,
	isVoltageControlledSource,
	type AnalysisMode,
	type CircuitComponent,
	type CircuitDocument,
	type GridPoint,
	type NodePinAttachment,
	type Rotation,
	type ValidationDiagnostic
} from './types';
import { parseComplexValue, parseEngineeringNumber } from './units';

export interface PinPosition {
	name: string;
	index: number;
	x: number;
	y: number;
}

export interface ElectricalNode {
	nodeId: string;
	isReference: boolean;
	componentPins: NodePinAttachment[];
	gridPoints: GridPoint[];
}

export interface ElectricalGraph {
	doc: CircuitDocument;
	nodes: Record<string, ElectricalNode>;
	nonRefNodeIds: string[];
	/** Maps componentId -> [nodeIdPin0, nodeIdPin1] (or [nodeIdPin0] for 1-pin components) */
	componentNodes: Record<string, string[]>;
	componentPins: Record<string, PinPosition[]>;
	diagnostics: ValidationDiagnostic[];
}

class UnionFind {
	private parent: number[];
	private rank: number[];

	constructor(size: number) {
		this.parent = Array.from({ length: size }, (_, i) => i);
		this.rank = new Array(size).fill(0);
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

	connected(a: number, b: number): boolean {
		return this.find(a) === this.find(b);
	}
}

function rotateOffset(dx: number, dy: number, rotation: Rotation): GridPoint {
	switch (rotation) {
		case 0:
			return { x: dx, y: dy };
		case 90:
			return { x: -dy, y: dx };
		case 180:
			return { x: -dx, y: -dy };
		case 270:
			return { x: dy, y: -dx };
	}
}

/**
 * Returns exact grid pin positions for a component, matching the canonical UI symbol contract.
 * - 2-terminal components at rotation 0: pin 0 at (x - 2, y), pin 1 at (x + 2, y)
 * - 1-terminal components ('ground', 'terminal'): pin 0 at (x, y)
 */
export function getPinPositions(comp: CircuitComponent): PinPosition[] {
	if (comp.kind === 'ground' || comp.kind === 'terminal') {
		return [
			{
				name: comp.kind === 'ground' ? 'gnd' : comp.terminalName || 't',
				index: 0,
				x: comp.x,
				y: comp.y
			}
		];
	}

	const pin0Name =
		comp.kind === 'voltage_source' ||
		comp.kind === 'voltmeter' ||
		isDependentSourceKind(comp.kind)
			? '+'
			: comp.kind === 'current_source'
				? 'in'
				: 'a';
	const pin1Name =
		comp.kind === 'voltage_source' ||
		comp.kind === 'voltmeter' ||
		isDependentSourceKind(comp.kind)
			? '-'
			: comp.kind === 'current_source'
				? 'out'
				: 'b';

	const off0 = rotateOffset(-2, 0, comp.rotation);
	const off1 = rotateOffset(2, 0, comp.rotation);

	return [
		{ name: pin0Name, index: 0, x: comp.x + off0.x, y: comp.y + off0.y },
		{ name: pin1Name, index: 1, x: comp.x + off1.x, y: comp.y + off1.y }
	];
}

function ptKey(x: number, y: number): string {
	const rx = Math.round(x * 1e6) / 1e6;
	const ry = Math.round(y * 1e6) / 1e6;
	return `${rx === 0 ? 0 : rx},${ry === 0 ? 0 : ry}`;
}

function isPointOnSegment(p: GridPoint, a: GridPoint, b: GridPoint, eps = 1e-6): boolean {
	const minX = Math.min(a.x, b.x) - eps;
	const maxX = Math.max(a.x, b.x) + eps;
	const minY = Math.min(a.y, b.y) - eps;
	const maxY = Math.max(a.y, b.y) + eps;

	if (p.x < minX || p.x > maxX || p.y < minY || p.y > maxY) {
		return false;
	}

	const cross = (p.x - a.x) * (b.y - a.y) - (p.y - a.y) * (b.x - a.x);
	const segLen = Math.hypot(b.x - a.x, b.y - a.y);
	if (segLen <= eps) {
		return Math.hypot(p.x - a.x, p.y - a.y) <= eps;
	}
	return Math.abs(cross) <= eps * segLen;
}

/** Auto node name for the n-th (0-based) non-reference node: A..Z, AA, AB, ..., AZ, BA, ... */
/**
 * Old documents and share links (before letter names) refer to nodes as N1, N2, …, numbered in
 * the same order the letters use now, so N<k> is the k-th letter. Returns null for other IDs.
 */
export function legacyNodeIdToLetter(id: string): string | null {
	const m = /^N([1-9]\d*)$/.exec(id);
	return m ? nodeLetterName(Number(m[1]) - 1) : null;
}

/** Rewrites legacy N<k> node references in a document that has no custom node names. */
export function migrateLegacyNodeIds(doc: CircuitDocument): void {
	if (doc.nodeNames && doc.nodeNames.length > 0) return;
	const fix = (id: string | undefined) => (id === undefined ? id : (legacyNodeIdToLetter(id) ?? id));
	for (const c of doc.components) {
		const ref = c.controlRef;
		if (!ref) continue;
		if (ref.controlNodePos !== undefined) ref.controlNodePos = fix(ref.controlNodePos);
		if (ref.controlNodeNeg !== undefined) ref.controlNodeNeg = fix(ref.controlNodeNeg);
	}
	const con = doc.unknownProblem?.constraint;
	if (con && con.kind === 'node_voltage') con.targetId = fix(con.targetId)!;
}

export function nodeLetterName(index: number): string {
	let n = index + 1;
	let out = '';
	while (n > 0) {
		const rem = (n - 1) % 26;
		out = String.fromCharCode(65 + rem) + out;
		n = Math.floor((n - 1) / 26);
	}
	return out;
}

/** Node ID as a LaTeX subscript body: underscores are escaped so `Vo_1` / `A_` never break KaTeX. */
export function latexNodeId(nodeId: string): string {
	return nodeId.replace(/_/g, '\\_');
}

export const MAX_NODE_NAME_LENGTH = 6;

/**
 * Validates a custom node name. `takenNames` are the names already used by OTHER nodes.
 * Returns an error message, or null when the name is acceptable.
 */
export function validateNodeName(name: string, takenNames: Iterable<string> = []): string | null {
	const trimmed = name.trim();
	if (trimmed.length === 0) return 'Enter a name.';
	if (trimmed.length > MAX_NODE_NAME_LENGTH) {
		return `Use at most ${MAX_NODE_NAME_LENGTH} characters.`;
	}
	if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(trimmed)) {
		return 'Start with a letter; use letters, digits or _ only.';
	}
	if (trimmed.toUpperCase() === 'GND') return '"GND" is reserved for the reference node.';
	for (const taken of takenNames) {
		if (taken === trimmed) return `"${trimmed}" is already used by another node.`;
	}
	return null;
}

/**
 * Builds the canonical electrical node graph from a CircuitDocument.
 * Merges touching pins, wire endpoints, and T-junctions via Union-Find.
 * All ground pins collapse to node `"0"`; if no ground exists, picks an automatic
 * reference node `"0"` and emits an `'info'` `AUTO_GROUND` diagnostic.
 */
export function buildElectricalGraph(doc: CircuitDocument): ElectricalGraph {
	const diagnostics: ValidationDiagnostic[] = [];
	const pointList: GridPoint[] = [];
	const pointIndex = new Map<string, number>();

	const ensurePoint = (pt: GridPoint): number => {
		const key = ptKey(pt.x, pt.y);
		const existing = pointIndex.get(key);
		if (existing !== undefined) return existing;
		const id = pointList.length;
		pointList.push({ x: pt.x, y: pt.y });
		pointIndex.set(key, id);
		return id;
	};

	const componentPins: Record<string, PinPosition[]> = {};
	for (const comp of doc.components) {
		const pins = getPinPositions(comp);
		componentPins[comp.id] = pins;
		for (const pin of pins) {
			ensurePoint({ x: pin.x, y: pin.y });
		}
	}

	for (const wire of doc.wires) {
		for (const pt of wire.points) {
			ensurePoint(pt);
		}
	}

	const uf = new UnionFind(pointList.length);

	// Connect wire vertices along each polyline
	for (const wire of doc.wires) {
		for (let i = 0; i + 1 < wire.points.length; i++) {
			const idA = ensurePoint(wire.points[i]);
			const idB = ensurePoint(wire.points[i + 1]);
			uf.union(idA, idB);
		}
	}

	// Connect T-junctions: any pin or wire vertex lying on any wire segment
	for (let pId = 0; pId < pointList.length; pId++) {
		const pt = pointList[pId];
		for (const wire of doc.wires) {
			for (let i = 0; i + 1 < wire.points.length; i++) {
				const a = wire.points[i];
				const b = wire.points[i + 1];
				if (isPointOnSegment(pt, a, b)) {
					const segStartId = ensurePoint(a);
					uf.union(pId, segStartId);
				}
			}
		}
	}

	// Group points and pin attachments by Union-Find root
	interface RootBucket {
		rootId: number;
		pins: NodePinAttachment[];
		points: GridPoint[];
		hasGround: boolean;
		hasElectricalPin: boolean;
		minY: number;
		minX: number;
	}

	const buckets = new Map<number, RootBucket>();
	const getBucket = (ptId: number): RootBucket => {
		const root = uf.find(ptId);
		let bucket = buckets.get(root);
		if (!bucket) {
			bucket = {
				rootId: root,
				pins: [],
				points: [],
				hasGround: false,
				hasElectricalPin: false,
				minY: Infinity,
				minX: Infinity
			};
			buckets.set(root, bucket);
		}
		return bucket;
	};

	for (let ptId = 0; ptId < pointList.length; ptId++) {
		const pt = pointList[ptId];
		const bucket = getBucket(ptId);
		bucket.points.push(pt);
		if (pt.y < bucket.minY || (pt.y === bucket.minY && pt.x < bucket.minX)) {
			bucket.minY = pt.y;
			bucket.minX = pt.x;
		}
	}

	const compPinRoots = new Map<string, number[]>();
	for (const comp of doc.components) {
		const pins = componentPins[comp.id];
		const roots: number[] = [];
		for (const pin of pins) {
			const ptId = ensurePoint({ x: pin.x, y: pin.y });
			const root = uf.find(ptId);
			roots.push(root);
			const bucket = getBucket(ptId);
			bucket.pins.push({
				componentId: comp.id,
				pinIndex: pin.index,
				pinName: pin.name
			});
			if (comp.kind === 'ground') {
				bucket.hasGround = true;
			}
			if (comp.kind !== 'voltmeter') {
				bucket.hasElectricalPin = true;
			}
		}
		compPinRoots.set(comp.id, roots);
	}

	// Filter to buckets that contain at least one electrical (non-voltmeter) component pin
	const activeBuckets = Array.from(buckets.values()).filter(
		(b) => b.pins.length > 0 && b.hasElectricalPin
	);
	const groundBuckets = activeBuckets.filter((b) => b.hasGround);

	const rootToNodeId = new Map<number, string>();

	if (groundBuckets.length > 0) {
		for (const gb of groundBuckets) {
			rootToNodeId.set(gb.rootId, '0');
		}
	} else if (activeBuckets.length > 0) {
		// Pick auto-reference: prefer negative pin (index 1) of first voltage_source, else highest degree
		let autoRoot: number | null = null;
		const firstVSource = doc.components.find((c) => c.kind === 'voltage_source');
		if (firstVSource) {
			const roots = compPinRoots.get(firstVSource.id);
			if (roots && roots.length >= 2) {
				autoRoot = roots[1];
			}
		}

		if (autoRoot === null) {
			const sortedByDegree = [...activeBuckets].sort((a, b) => {
				if (b.pins.length !== a.pins.length) return b.pins.length - a.pins.length;
				if (a.minY !== b.minY) return a.minY - b.minY;
				return a.minX - b.minX;
			});
			autoRoot = sortedByDegree[0].rootId;
		}

		rootToNodeId.set(autoRoot, '0');
		diagnostics.push({
			severity: 'info',
			code: 'AUTO_GROUND',
			message: 'No ground symbol found; automatically selected reference node "0".',
			nodeIds: ['0']
		});
	}

	// Assign deterministic labels A, B, ..., Z, AA, AB, ... to non-reference buckets, in position
	// order. Custom names from doc.nodeNames (anchored by pin) win; auto letters skip names in use.
	const nonRefBuckets = activeBuckets
		.filter((b) => rootToNodeId.get(b.rootId) !== '0')
		.sort((a, b) => {
			if (a.minY !== b.minY) return a.minY - b.minY;
			if (a.minX !== b.minX) return a.minX - b.minX;
			return a.rootId - b.rootId;
		});

	const customNameByRoot = new Map<number, string>();
	const usedNames = new Set<string>(['0']);
	const nonRefRoots = new Set(nonRefBuckets.map((b) => b.rootId));
	for (const entry of doc.nodeNames ?? []) {
		const root = compPinRoots.get(entry.pin?.componentId)?.[entry.pin?.pinIndex];
		if (root === undefined || !nonRefRoots.has(root) || customNameByRoot.has(root)) continue;
		if (typeof entry.name !== 'string' || validateNodeName(entry.name, usedNames) !== null) continue;
		const name = entry.name.trim();
		customNameByRoot.set(root, name);
		usedNames.add(name);
	}

	const nonRefNodeIds: string[] = [];
	let letterIdx = 0;
	for (const b of nonRefBuckets) {
		let id = customNameByRoot.get(b.rootId);
		if (id === undefined) {
			do {
				id = nodeLetterName(letterIdx++);
			} while (usedNames.has(id));
			usedNames.add(id);
		}
		rootToNodeId.set(b.rootId, id);
		nonRefNodeIds.push(id);
	}

	// Build final nodes dictionary (merging multiple ground buckets into single "0" node)
	const nodes: Record<string, ElectricalNode> = {};
	for (const bucket of activeBuckets) {
		const nodeId = rootToNodeId.get(bucket.rootId)!;
		if (!nodes[nodeId]) {
			nodes[nodeId] = {
				nodeId,
				isReference: nodeId === '0',
				componentPins: [],
				gridPoints: []
			};
		}
		nodes[nodeId].componentPins.push(...bucket.pins);
		nodes[nodeId].gridPoints.push(...bucket.points);
	}

	const componentNodes: Record<string, string[]> = {};
	for (const comp of doc.components) {
		const roots = compPinRoots.get(comp.id) ?? [];
		componentNodes[comp.id] = roots.map((r) => rootToNodeId.get(r) ?? '');
	}

	return {
		doc,
		nodes,
		nonRefNodeIds,
		componentNodes,
		componentPins,
		diagnostics
	};
}

/**
 * Parses a source's complex phasor or scalar DC value cleanly.
 */
export function parseSourceValue(comp: CircuitComponent, mode: AnalysisMode): Complex | null {
	const raw = comp.value?.trim() ?? '';
	if (raw === '' && comp.numericValue !== undefined) {
		if (!Number.isFinite(comp.numericValue)) return null;
		if (mode === 'ac' && comp.phaseDeg !== undefined && Number.isFinite(comp.phaseDeg)) {
			return Complex.fromPolar(comp.numericValue, comp.phaseDeg);
		}
		return Complex.from(comp.numericValue, 0);
	}

	const parsed = parseComplexValue(raw);
	if (!parsed || !parsed.isFinite()) return null;

	if (mode === 'dc') {
		if (!parsed.isReal(1e-12)) {
			return null;
		}
		return Complex.from(parsed.re, 0);
	}

	// AC mode: apply comp.phaseDeg if raw value didn't already carry angle/imaginary part
	const hasExplicitAngleOrJ = /[∠@<j]/i.test(raw);
	if (!hasExplicitAngleOrJ && comp.phaseDeg !== undefined && Number.isFinite(comp.phaseDeg)) {
		return Complex.fromPolar(parsed.re, comp.phaseDeg);
	}

	return parsed;
}

/**
 * Parses a dependent source's scalar (DC) or complex/phasor (AC) gain
 * (A_v, g_m, r_m, or beta) from `comp.value` or `comp.controlRef?.gain`.
 * Note: Returns the nominal gain before multiplying by `controlPolarity`.
 */
export function parseDependentGain(comp: CircuitComponent, mode: AnalysisMode): Complex | null {
	const rawFromValue = comp.value?.trim() ?? '';
	const rawGain = comp.controlRef?.gain;
	let raw = rawFromValue;

	if (raw === '' && rawGain !== undefined) {
		if (typeof rawGain === 'number') {
			if (!Number.isFinite(rawGain)) return null;
			if (mode === 'ac' && comp.phaseDeg !== undefined && Number.isFinite(comp.phaseDeg)) {
				return Complex.fromPolar(rawGain, comp.phaseDeg);
			}
			return Complex.from(rawGain, 0);
		}
		raw = rawGain.trim();
	}

	if (raw === '' && comp.numericValue !== undefined) {
		if (!Number.isFinite(comp.numericValue)) return null;
		if (mode === 'ac' && comp.phaseDeg !== undefined && Number.isFinite(comp.phaseDeg)) {
			return Complex.fromPolar(comp.numericValue, comp.phaseDeg);
		}
		return Complex.from(comp.numericValue, 0);
	}

	if (!raw) return null;

	const parsed = parseComplexValue(raw);
	if (!parsed || !parsed.isFinite()) return null;

	if (mode === 'dc') {
		if (!parsed.isReal(1e-12)) return null;
		return Complex.from(parsed.re, 0);
	}

	const hasExplicitAngleOrJ = /[∠@<j]/i.test(raw);
	if (!hasExplicitAngleOrJ && comp.phaseDeg !== undefined && Number.isFinite(comp.phaseDeg)) {
		return Complex.fromPolar(parsed.re, comp.phaseDeg);
	}

	return parsed;
}

/**
 * Resolves the controlling positive and negative electrical node IDs for a VCVS or VCCS.
 * Prefers `controlComponentId` (V_ctrl = V_pin0 - V_pin1) if set; otherwise uses
 * explicit `controlNodePos` and `controlNodeNeg`.
 */
export function resolveDependentControlNodes(
	comp: CircuitComponent,
	graph: ElectricalGraph
): { ctrlPos: string; ctrlNeg: string } | null {
	const ref = comp.controlRef;
	if (!ref) return null;

	if (ref.controlComponentId) {
		const target = graph.doc.components.find((c) => c.id === ref.controlComponentId);
		if (!target || target.kind === 'ground' || target.kind === 'terminal') {
			return null;
		}
		const cNodes = graph.componentNodes[target.id];
		if (!cNodes || cNodes.length < 2 || !cNodes[0] || !cNodes[1]) {
			return null;
		}
		if (!graph.nodes[cNodes[0]] || !graph.nodes[cNodes[1]]) {
			return null;
		}
		return { ctrlPos: cNodes[0], ctrlNeg: cNodes[1] };
	}

	if (ref.controlNodePos !== undefined && ref.controlNodeNeg !== undefined) {
		const pos = ref.controlNodePos.trim();
		const neg = ref.controlNodeNeg.trim();
		if (pos && neg && graph.nodes[pos] && graph.nodes[neg]) {
			return { ctrlPos: pos, ctrlNeg: neg };
		}
	}

	return null;
}

/**
 * Parses a passive component's positive scalar value (R, L, or C).
 */
export function parsePassiveValue(comp: CircuitComponent): number | null {
	const raw = comp.value?.trim() ?? '';
	const val =
		raw !== ''
			? parseEngineeringNumber(raw)
			: comp.numericValue !== undefined
				? comp.numericValue
				: null;
	if (val === null || !Number.isFinite(val) || val <= 0) {
		return null;
	}
	return val;
}

export type PassiveImpedanceResult =
	| { kind: 'impedance'; z: Complex }
	| { kind: 'open' }
	| { kind: 'short' };

/**
 * Returns `true` iff an inductor or capacitor specifies its AC value directly as an impedance in Ω
 * (either via `valueMode === 'impedance'`, `unit === 'Ω'`, or complex/phasor notation in `value`).
 */
export function isImpedanceSpecified(
	comp: Pick<CircuitComponent, 'kind' | 'value' | 'unit' | 'valueMode'>
): boolean {
	if (comp.kind !== 'inductor' && comp.kind !== 'capacitor') {
		return false;
	}
	return (
		comp.valueMode === 'impedance' ||
		comp.unit === 'Ω' ||
		/[j∠@<]/i.test(comp.value ?? '')
	);
}

/**
 * Parses a direct AC impedance (in Ω) for an impedance-specified inductor or capacitor.
 * Supports pure reactive impedances (`j1`, `-j1`, `j50`, `-j20`), lossy complex impedances
 * (`2+j1`, `1-j2`), polar impedances (`100∠90°`, `100∠-90°`), and plain positive reactance
 * magnitudes when `valueMode === 'impedance'` (interpreted as `+jX` for inductors and `-j|X|` for capacitors).
 * Rejects zero impedance, non-finite values, or negative real resistance (`re < 0`).
 */
export function parseDirectImpedance(
	comp: Pick<CircuitComponent, 'kind' | 'value' | 'unit' | 'valueMode'>
): Complex | null {
	if (comp.kind !== 'inductor' && comp.kind !== 'capacitor') {
		return null;
	}
	if (!isImpedanceSpecified(comp)) {
		return null;
	}
	const raw = comp.value?.trim() ?? '';
	if (!raw) return null;

	const parsed = parseComplexValue(raw);
	if (!parsed || !parsed.isFinite()) return null;

	let z = parsed;
	if (Math.abs(parsed.im) < 1e-12 && comp.valueMode === 'impedance') {
		if (comp.kind === 'inductor') {
			if (parsed.re <= 1e-12) return null;
			z = Complex.j(parsed.re);
		} else {
			if (Math.abs(parsed.re) <= 1e-12) return null;
			z = Complex.j(-Math.abs(parsed.re));
		}
	}

	const cleanRe = Math.abs(z.re) < 1e-12 ? 0 : z.re;
	const cleanIm = Math.abs(z.im) < 1e-12 ? 0 : z.im;
	z = Complex.from(cleanRe, cleanIm);

	if (!z.isFinite() || z.abs() < 1e-12 || z.re < -1e-12) {
		return null;
	}

	return z;
}

/**
 * Unified passive element impedance resolver for DC and AC steady-state analysis.
 * - Resistor: `{ kind: 'impedance', z: R }`
 * - Capacitor: `{ kind: 'open' }` in DC; direct `Z` when impedance-specified in AC; `-j / (2πfC)` otherwise
 * - Inductor: `{ kind: 'short' }` in DC; direct `Z` when impedance-specified in AC; `+j (2πfL)` otherwise
 */
export function getPassiveImpedance(
	comp: CircuitComponent,
	mode: AnalysisMode,
	frequencyHz: number
): PassiveImpedanceResult | null {
	switch (comp.kind) {
		case 'resistor': {
			const r = parsePassiveValue(comp);
			return r !== null ? { kind: 'impedance', z: Complex.from(r, 0) } : null;
		}
		case 'capacitor': {
			if (mode === 'dc') {
				return { kind: 'open' };
			}
			if (isImpedanceSpecified(comp)) {
				const z = parseDirectImpedance(comp);
				return z ? { kind: 'impedance', z } : null;
			}
			const c = parsePassiveValue(comp);
			if (c === null || !Number.isFinite(frequencyHz) || frequencyHz <= 0) {
				return null;
			}
			return { kind: 'impedance', z: Complex.j(-1 / (2 * Math.PI * frequencyHz * c)) };
		}
		case 'inductor': {
			if (mode === 'dc') {
				return { kind: 'short' };
			}
			if (isImpedanceSpecified(comp)) {
				const z = parseDirectImpedance(comp);
				return z ? { kind: 'impedance', z } : null;
			}
			const l = parsePassiveValue(comp);
			if (l === null || !Number.isFinite(frequencyHz) || frequencyHz <= 0) {
				return null;
			}
			return { kind: 'impedance', z: Complex.j(2 * Math.PI * frequencyHz * l) };
		}
		default:
			return null;
	}
}

/**
 * Validates electrical topology, component values, voltage-source loops,
 * current-source cutsets, and disconnected floating subcircuits.
 */
export function validateCircuitTopology(
	graph: ElectricalGraph,
	mode: AnalysisMode,
	frequencyHz: number
): ValidationDiagnostic[] {
	const diagnostics: ValidationDiagnostic[] = [...graph.diagnostics];
	const { doc, nodes, componentNodes } = graph;

	const activeComponents = doc.components.filter(
		(c) => c.kind !== 'ground' && c.kind !== 'terminal' && c.kind !== 'voltmeter'
	);
	const voltmeters = doc.components.filter((c) => c.kind === 'voltmeter');

	for (const vm of voltmeters) {
		const [nA, nB] = componentNodes[vm.id] ?? [];
		if (!nA || !nB || !nodes[nA] || !nodes[nB]) {
			diagnostics.push({
				severity: 'warning',
				code: 'VOLTMETER_UNCONNECTED',
				message: `Voltmeter ${vm.label} has an unconnected probe — wire its + and − terminals to circuit nodes to read voltage.`,
				componentIds: [vm.id]
			});
		}
	}

	if (activeComponents.length === 0) {
		diagnostics.push({
			severity: 'error',
			code: 'EMPTY_CIRCUIT',
			message: 'Circuit contains no active components to solve.'
		});
		return diagnostics;
	}

	if (mode === 'ac' && (!Number.isFinite(frequencyHz) || frequencyHz <= 0)) {
		diagnostics.push({
			severity: 'error',
			code: 'INVALID_FREQUENCY',
			message: `AC frequency must be a positive finite number (received ${frequencyHz}).`
		});
	}

	let hasCapacitor = false;
	let hasInductor = false;

	// Validate individual component values and self-shorted warnings
	for (const comp of activeComponents) {
		const cNodes = componentNodes[comp.id] ?? [];
		if (comp.kind === 'resistor' || comp.kind === 'capacitor' || comp.kind === 'inductor') {
			if (comp.kind === 'capacitor') hasCapacitor = true;
			if (comp.kind === 'inductor') hasInductor = true;

			if ((comp.kind === 'inductor' || comp.kind === 'capacitor') && isImpedanceSpecified(comp)) {
				const z = parseDirectImpedance(comp);
				if (z === null) {
					diagnostics.push({
						severity: 'error',
						code: 'INVALID_VALUE',
						message: `${comp.label} (${comp.kind}) must have a valid non-zero impedance with non-negative resistance (got "${comp.value}").`,
						componentIds: [comp.id]
					});
				}
			} else {
				const val = parsePassiveValue(comp);
				if (val === null) {
					diagnostics.push({
						severity: 'error',
						code: 'INVALID_VALUE',
						message: `${comp.label} (${comp.kind}) must have a positive finite value (got "${comp.value}").`,
						componentIds: [comp.id]
					});
				}
			}

			if (cNodes.length === 2 && cNodes[0] === cNodes[1]) {
				if (mode === 'dc' && comp.kind === 'inductor') {
					diagnostics.push({
						severity: 'error',
						code: 'VOLTAGE_SOURCE_LOOP',
						message: `Inductor ${comp.label} is shorted across node ${cNodes[0]} in DC steady state, forming a 0 V loop.`,
						componentIds: [comp.id],
						nodeIds: [cNodes[0]]
					});
				} else {
					diagnostics.push({
						severity: 'warning',
						code: 'SHORTED_COMPONENT',
						message: `${comp.label} has both terminals connected to node ${cNodes[0]} (zero voltage).`,
						componentIds: [comp.id],
						nodeIds: [cNodes[0]]
					});
				}
			}
		} else if (comp.kind === 'voltage_source' || comp.kind === 'current_source') {
			const val = parseSourceValue(comp, mode);
			if (val === null) {
				diagnostics.push({
					severity: 'error',
					code: 'INVALID_VALUE',
					message: `${comp.label} (${comp.kind}) has an invalid ${mode.toUpperCase()} value ("${comp.value}").`,
					componentIds: [comp.id]
				});
			}
			if (comp.kind === 'current_source' && cNodes.length === 2 && cNodes[0] === cNodes[1]) {
				diagnostics.push({
					severity: 'warning',
					code: 'SHORTED_COMPONENT',
					message: `Current source ${comp.label} is shorted across node ${cNodes[0]}.`,
					componentIds: [comp.id],
					nodeIds: [cNodes[0]]
				});
			}
		} else if (isDependentSourceKind(comp.kind)) {
			const gain = parseDependentGain(comp, mode);
			if (gain === null) {
				diagnostics.push({
					severity: 'error',
					code: 'INVALID_VALUE',
					message: `${comp.label} (${comp.kind.toUpperCase()}) has an invalid ${mode.toUpperCase()} gain ("${comp.value}").`,
					componentIds: [comp.id]
				});
			}

			const ref = comp.controlRef;
			if (isVoltageControlledSource(comp.kind)) {
				const resolved = resolveDependentControlNodes(comp, graph);
				if (!resolved) {
					const detail = ref?.controlComponentId
						? `controlling component "${ref.controlComponentId}" was not found or is unconnected`
						: ref?.controlNodePos || ref?.controlNodeNeg
							? `controlling nodes ("${ref.controlNodePos ?? ''}", "${ref.controlNodeNeg ?? ''}") are not valid circuit nodes`
							: 'missing controlling component or controlling node pair';
					diagnostics.push({
						severity: 'error',
						code: 'INVALID_DEPENDENT_CONTROL',
						message: `${comp.label} (${comp.kind.toUpperCase()}): ${detail}. Select a valid controlling element or node pair.`,
						componentIds: [comp.id]
					});
				}
			} else if (isCurrentControlledSource(comp.kind)) {
				const branchId = ref?.controlBranchComponentId;
				const target = branchId ? doc.components.find((c) => c.id === branchId) : undefined;
				const validTarget =
					target !== undefined &&
					target.kind !== 'ground' &&
					target.kind !== 'terminal' &&
					target.kind !== 'voltmeter';
				if (!validTarget) {
					diagnostics.push({
						severity: 'error',
						code: 'INVALID_DEPENDENT_CONTROL',
						message: branchId
							? `${comp.label} (${comp.kind.toUpperCase()}): controlling branch "${branchId}" was not found or cannot carry current.`
							: `${comp.label} (${comp.kind.toUpperCase()}): missing controlling branch component.`,
						componentIds: [comp.id]
					});
				}
			}

			if (isDependentCurrentSource(comp.kind) && cNodes.length === 2 && cNodes[0] === cNodes[1]) {
				diagnostics.push({
					severity: 'warning',
					code: 'SHORTED_COMPONENT',
					message: `Dependent current source ${comp.label} is shorted across node ${cNodes[0]}.`,
					componentIds: [comp.id],
					nodeIds: [cNodes[0]]
				});
			}
		}
	}

	if (mode === 'dc') {
		if (hasCapacitor) {
			diagnostics.push({
				severity: 'info',
				code: 'DC_CAPACITOR_OPEN',
				message:
					'DC steady-state model: ideal capacitors are treated as open circuits (I = 0 A).'
			});
		}
		if (hasInductor) {
			diagnostics.push({
				severity: 'info',
				code: 'DC_INDUCTOR_SHORT',
				message:
					'DC steady-state model: ideal inductors are treated as short circuits (0 V branch, V = 0 V).'
			});
		}
	}

	// Node indexing for topology checks
	const allNodeIds = Object.keys(nodes);
	const nodeIdx = new Map<string, number>();
	allNodeIds.forEach((id, i) => nodeIdx.set(id, i));

	// 1. Check for voltage-source / DC-inductor loops (zero-impedance cycles)
	const ufZero = new UnionFind(allNodeIds.length);
	const zeroBranches = activeComponents.filter(
		(c) =>
			c.kind === 'voltage_source' ||
			isDependentVoltageSource(c.kind) ||
			(mode === 'dc' && c.kind === 'inductor')
	);

	for (const zb of zeroBranches) {
		const [nA, nB] = componentNodes[zb.id] ?? [];
		if (!nA || !nB) continue;
		const iA = nodeIdx.get(nA)!;
		const iB = nodeIdx.get(nB)!;
		if (nA === nB) {
			// Inductor self-short already reported above; voltage source self-short reported here
			if (zb.kind === 'voltage_source' || isDependentVoltageSource(zb.kind)) {
				diagnostics.push({
					severity: 'error',
					code: 'VOLTAGE_SOURCE_LOOP',
					message: `Voltage source ${zb.label} is shorted across node ${nA}.`,
					componentIds: [zb.id],
					nodeIds: [nA]
				});
			}
		} else if (ufZero.connected(iA, iB)) {
			diagnostics.push({
				severity: 'error',
				code: 'VOLTAGE_SOURCE_LOOP',
				message: `Ideal voltage-source / DC-inductor loop detected involving ${zb.label} between ${nA} and ${nB}.`,
				componentIds: [zb.id],
				nodeIds: [nA, nB]
			});
		} else {
			ufZero.union(iA, iB);
		}
	}

	// 2. Check conducting connectivity without current sources (and without DC open capacitors)
	const refIdx = nodeIdx.get('0');
	if (refIdx === undefined) {
		return diagnostics;
	}

	const ufNoCS = new UnionFind(allNodeIds.length);
	for (const comp of activeComponents) {
		if (comp.kind === 'current_source' || isDependentCurrentSource(comp.kind)) continue;
		if (mode === 'dc' && comp.kind === 'capacitor') continue;
		const [nA, nB] = componentNodes[comp.id] ?? [];
		if (!nA || !nB) continue;
		ufNoCS.union(nodeIdx.get(nA)!, nodeIdx.get(nB)!);
	}

	const refRoot = ufNoCS.find(refIdx);
	const isolatedClusters = new Map<number, string[]>();
	for (const id of allNodeIds) {
		const idx = nodeIdx.get(id)!;
		const root = ufNoCS.find(idx);
		if (root !== refRoot) {
			const list = isolatedClusters.get(root) ?? [];
			list.push(id);
			isolatedClusters.set(root, list);
		}
	}

	for (const clusterNodes of isolatedClusters.values()) {
		const clusterSet = new Set(clusterNodes);
		const touchingCurrentSources = activeComponents.filter(
			(c) =>
				(c.kind === 'current_source' || isDependentCurrentSource(c.kind)) &&
				(componentNodes[c.id] ?? []).some((nid) => clusterSet.has(nid))
		);

		if (touchingCurrentSources.length > 0) {
			const csLabels = touchingCurrentSources.map((c) => c.label).join(', ');
			diagnostics.push({
				severity: 'error',
				code: 'CURRENT_SOURCE_CUTSET',
				message: `Current-source cutset / open current source at node(s) ${clusterNodes.join(', ')} (${csLabels}); KCL cannot uniquely determine node voltages.`,
				componentIds: touchingCurrentSources.map((c) => c.id),
				nodeIds: clusterNodes
			});
		} else {
			const touchingComps = activeComponents
				.filter((c) => (componentNodes[c.id] ?? []).some((nid) => clusterSet.has(nid)))
				.map((c) => c.id);
			const onlyDcCap =
				mode === 'dc' &&
				activeComponents.some(
					(c) =>
						c.kind === 'capacitor' &&
						(componentNodes[c.id] ?? []).some((nid) => clusterSet.has(nid))
				) &&
				touchingComps.every((id) => {
					const comp = activeComponents.find((c) => c.id === id);
					return comp?.kind === 'capacitor';
				});

			diagnostics.push({
				severity: 'error',
				code: 'FLOATING_SUBCIRCUIT',
				message: onlyDcCap
					? `Node(s) ${clusterNodes.join(', ')} have no DC conducting path to reference node "0" (isolated by open capacitor(s) in DC mode).`
					: `Floating subcircuit detected at node(s) ${clusterNodes.join(', ')} with no path to reference node "0".`,
				componentIds: touchingComps,
				nodeIds: clusterNodes
			});
		}
	}

	return diagnostics;
}
