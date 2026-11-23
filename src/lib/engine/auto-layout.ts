/**
 * Deterministic Orthogonal Auto-Layout & Visual-Grid Schematic Cloner for Circuit Lab.
 *
 * Converts a compact node-based netlist (AI import or programmatic AINetlistDocument)
 * into a clean, non-overlapping, Manhattan-routed `CircuitDocument` whose
 * `buildElectricalGraph()` topology is 100% faithful to the input netlist.
 *
 * When elements include coarse integer schematic grid positions (`fromPos`/`toPos`),
 * `layoutVisualGridToDocument` clones the source image's exact geometry, orientation,
 * and polarity, and verifies 100% electrical isomorphism via `buildElectricalGraph()`
 * before accepting (falling back cleanly to the deterministic ladder layout if any
 * coordinate conflict is detected).
 */

import { buildElectricalGraph, getPinPositions } from './graph';
import type {
	AcMagnitudeMode,
	AnalysisMode,
	CircuitComponent,
	CircuitDocument,
	CircuitWire,
	ComponentKind,
	DependentControlRef,
	GridPoint,
	PassiveValueMode,
	Rotation,
	UnitSystemId,
	UnknownProblemSpec
} from './types';

export interface LayoutNetlistElement {
	id?: string;
	kind: ComponentKind;
	label?: string;
	from?: string;
	to?: string;
	nodes?: string[];
	value: string;
	phaseDeg?: number;
	frequencyHz?: number;
	sourceMode?: AnalysisMode;
	unit?: string;
	valueMode?: PassiveValueMode;
	terminalName?: string;
	/** Coarse integer schematic grid position [col, row] of the `from` (pin 0 / + / tail) terminal in the source image (col: left->right 0,1,2...; row: top->bottom 0,1,2...) */
	fromPos?: [number, number];
	/** Coarse integer schematic grid position [col, row] of the `to` (pin 1 / - / head) terminal in the source image */
	toPos?: [number, number];
	/** Optional explicit unknown flag (or value === "?" / "unknown") */
	unknown?: boolean;
	unknownSymbol?: string;
	unknownMultiplier?: number;
	controlRef?: DependentControlRef;
}

export interface LayoutNetlistDocument {
	schemaVersion?: 1;
	id?: string;
	name?: string;
	mode?: AnalysisMode;
	frequencyHz?: number;
	acMagnitudeMode?: AcMagnitudeMode;
	unitSystem?: UnitSystemId;
	groundNode?: string;
	elements: LayoutNetlistElement[];
	unknownProblem?: UnknownProblemSpec;
}

export type LayoutMode = 'visual-grid' | 'auto-layout';

export interface LayoutNetlistResult {
	document: CircuitDocument;
	layoutMode: LayoutMode;
	warnings: string[];
	/** Maps normalized netlist node IDs (and raw aliases) to the final graph node IDs ("0", "A", "B", ...) */
	nodeIdMap: Record<string, string>;
}

const GROUND_ALIASES = new Set(['0', 'gnd', 'ground', 'ref', 'reference']);

const KIND_PREFIX: Record<ComponentKind, string> = {
	resistor: 'R',
	capacitor: 'C',
	inductor: 'L',
	voltage_source: 'V',
	current_source: 'I',
	vcvs: 'E',
	vccs: 'G',
	ccvs: 'H',
	cccs: 'F',
	ground: 'GND',
	terminal: 'T',
	voltmeter: 'VM'
};

interface NormalizedElement {
	id: string;
	kind: ComponentKind;
	label: string;
	from: string;
	to: string;
	rawFrom: string;
	rawTo: string;
	value: string;
	phaseDeg?: number;
	unit?: string;
	valueMode?: PassiveValueMode;
	terminalName?: string;
	fromPos?: [number, number];
	toPos?: [number, number];
	unknown?: boolean;
	unknownSymbol?: string;
	unknownMultiplier?: number;
	controlRef?: DependentControlRef;
}

interface NormalizedNetlistContext {
	netlist: LayoutNetlistDocument;
	mode: AnalysisMode;
	frequencyHz: number;
	acMagnitudeMode?: AcMagnitudeMode;
	twoTerminalElements: NormalizedElement[];
	explicitGroundElements: NormalizedElement[];
	terminalElements: NormalizedElement[];
	usedIds: Set<string>;
	prefixCounters: Map<string, number>;
	nextUniqueId: (kind: ComponentKind, preferred?: string) => string;
	rawToNormNode: Map<string, string>;
}

interface HorizontalPlacement {
	el: NormalizedElement;
	colLeft: number;
	colRight: number;
	row: number;
	y: number;
	cx: number;
	rotation: Rotation;
}

function isValidGridPos(pos: unknown): pos is [number, number] {
	return (
		Array.isArray(pos) &&
		pos.length === 2 &&
		typeof pos[0] === 'number' &&
		typeof pos[1] === 'number' &&
		Number.isFinite(pos[0]) &&
		Number.isFinite(pos[1])
	);
}

function isGroundAlias(name: string, explicitGroundNames: Set<string>): boolean {
	const trimmed = name.trim();
	if (explicitGroundNames.has(trimmed)) return true;
	return GROUND_ALIASES.has(trimmed.toLowerCase());
}

function resolveElementEndpoints(el: LayoutNetlistElement): { from: string; to: string } {
	if (el.kind === 'ground' || el.kind === 'terminal') {
		const single = el.from ?? el.nodes?.[0] ?? el.to ?? '0';
		return { from: single.trim(), to: single.trim() };
	}
	const from = (el.from ?? el.nodes?.[0] ?? '').trim();
	const to = (el.to ?? el.nodes?.[1] ?? '').trim();
	return { from, to };
}

function inferMode(netlist: LayoutNetlistDocument): AnalysisMode {
	if (netlist.mode === 'dc' || netlist.mode === 'ac') {
		return netlist.mode;
	}
	for (const el of netlist.elements) {
		if (el.sourceMode === 'ac' || el.phaseDeg !== undefined || el.valueMode === 'impedance') {
			return 'ac';
		}
		if (typeof el.value === 'string' && /[∠@<j]/i.test(el.value)) return 'ac';
	}
	return 'dc';
}

function inferFrequencyHz(netlist: LayoutNetlistDocument): number {
	if (
		typeof netlist.frequencyHz === 'number' &&
		Number.isFinite(netlist.frequencyHz) &&
		netlist.frequencyHz > 0
	) {
		return netlist.frequencyHz;
	}
	for (const el of netlist.elements) {
		if (
			typeof el.frequencyHz === 'number' &&
			Number.isFinite(el.frequencyHz) &&
			el.frequencyHz > 0
		) {
			return el.frequencyHz;
		}
	}
	return 60;
}

function makeWire(id: string, pts: Array<[number, number]>): CircuitWire {
	return {
		id,
		points: pts.map(([x, y]): GridPoint => ({ x, y }))
	};
}

function simplifyPolyline(pts: Array<[number, number]>): Array<[number, number]> {
	const deduped: Array<[number, number]> = [];
	for (const pt of pts) {
		const prev = deduped[deduped.length - 1];
		if (!prev || prev[0] !== pt[0] || prev[1] !== pt[1]) {
			deduped.push(pt);
		}
	}
	if (deduped.length <= 2) return deduped;
	const out: Array<[number, number]> = [deduped[0]];
	for (let i = 1; i < deduped.length - 1; i++) {
		const a = out[out.length - 1];
		const b = deduped[i];
		const c = deduped[i + 1];
		const sameX = a[0] === b[0] && b[0] === c[0];
		const sameY = a[1] === b[1] && b[1] === c[1];
		if (!sameX && !sameY) {
			out.push(b);
		}
	}
	out.push(deduped[deduped.length - 1]);
	return out;
}

function toComponent(
	el: NormalizedElement,
	x: number,
	y: number,
	rotation: Rotation
): CircuitComponent {
	const comp: CircuitComponent = {
		id: el.id,
		kind: el.kind,
		label: el.label,
		x,
		y,
		rotation,
		value: el.value
	};
	if (el.phaseDeg !== undefined) comp.phaseDeg = el.phaseDeg;
	if (el.unit !== undefined) comp.unit = el.unit;
	if (el.valueMode !== undefined) comp.valueMode = el.valueMode;
	if (el.terminalName !== undefined) comp.terminalName = el.terminalName;
	if (el.controlRef !== undefined) comp.controlRef = el.controlRef;
	return comp;
}

function normalizeNetlistContext(netlist: LayoutNetlistDocument): NormalizedNetlistContext {
	const mode = inferMode(netlist);
	const frequencyHz = inferFrequencyHz(netlist);
	const acMagnitudeMode: AcMagnitudeMode | undefined =
		netlist.acMagnitudeMode ?? (mode === 'ac' ? 'rms' : undefined);

	// 1. Identify canonical ground node name(s)
	const explicitGroundNames = new Set<string>();
	if (netlist.groundNode && netlist.groundNode.trim() !== '') {
		explicitGroundNames.add(netlist.groundNode.trim());
	}
	for (const el of netlist.elements) {
		if (el.kind === 'ground') {
			const { from } = resolveElementEndpoints(el);
			if (from) explicitGroundNames.add(from);
		}
	}

	const rawNormalize = (name: string): string =>
		isGroundAlias(name, explicitGroundNames) ? '0' : name.trim();

	// If no explicit ground alias exists, pick reference node deterministically
	// (matching graph.ts: first voltage_source negative terminal, else highest-degree node)
	let fallbackRefNode: string | null = null;
	let hasAnyGround = false;
	for (const el of netlist.elements) {
		const { from, to } = resolveElementEndpoints(el);
		if (rawNormalize(from) === '0' || rawNormalize(to) === '0') {
			hasAnyGround = true;
			break;
		}
	}

	if (!hasAnyGround && netlist.elements.length > 0) {
		const firstVSource = netlist.elements.find((e) => e.kind === 'voltage_source');
		if (firstVSource) {
			const { to } = resolveElementEndpoints(firstVSource);
			if (to) fallbackRefNode = to;
		}
		if (!fallbackRefNode) {
			const degree = new Map<string, number>();
			const order: string[] = [];
			for (const el of netlist.elements) {
				const { from, to } = resolveElementEndpoints(el);
				for (const n of [from, to]) {
					if (!n) continue;
					if (!degree.has(n)) {
						degree.set(n, 0);
						order.push(n);
					}
					degree.set(n, degree.get(n)! + 1);
				}
			}
			order.sort((a, b) => (degree.get(b) ?? 0) - (degree.get(a) ?? 0));
			fallbackRefNode = order[0] ?? null;
		}
	}

	const rawToNormNode = new Map<string, string>();
	const normNode = (name: string): string => {
		const trimmed = name.trim();
		const normalized =
			fallbackRefNode && trimmed === fallbackRefNode ? '0' : rawNormalize(trimmed);
		if (trimmed) rawToNormNode.set(trimmed, normalized);
		return normalized;
	};

	// 2. Normalize elements and ensure unique deterministic IDs
	const usedIds = new Set<string>();
	const prefixCounters = new Map<string, number>();
	const nextUniqueId = (kind: ComponentKind, preferred?: string): string => {
		const clean = preferred?.trim();
		if (clean && !usedIds.has(clean)) {
			usedIds.add(clean);
			return clean;
		}
		const prefix = KIND_PREFIX[kind] ?? 'X';
		let idx = (prefixCounters.get(prefix) ?? 0) + 1;
		while (usedIds.has(`${prefix}${idx}`)) {
			idx++;
		}
		prefixCounters.set(prefix, idx);
		const generated = `${prefix}${idx}`;
		usedIds.add(generated);
		return generated;
	};

	const twoTerminalElements: NormalizedElement[] = [];
	const explicitGroundElements: NormalizedElement[] = [];
	const terminalElements: NormalizedElement[] = [];

	for (const el of netlist.elements) {
		const { from, to } = resolveElementEndpoints(el);
		const normFrom = normNode(from);
		const normTo = normNode(to);
		const id = nextUniqueId(el.kind, el.id);
		const label = el.label?.trim() || id;

		const normalized: NormalizedElement = {
			id,
			kind: el.kind,
			label,
			from: normFrom,
			to: normTo,
			rawFrom: from,
			rawTo: to,
			value: typeof el.value === 'string' ? el.value.trim() : String(el.value ?? '').trim(),
			phaseDeg: el.phaseDeg,
			unit: el.unit,
			valueMode: el.valueMode,
			terminalName: el.terminalName,
			fromPos: isValidGridPos(el.fromPos)
				? [Math.round(el.fromPos[0]), Math.round(el.fromPos[1])]
				: undefined,
			toPos: isValidGridPos(el.toPos)
				? [Math.round(el.toPos[0]), Math.round(el.toPos[1])]
				: undefined,
			unknown: el.unknown,
			unknownSymbol: el.unknownSymbol,
			unknownMultiplier: el.unknownMultiplier,
			controlRef: el.controlRef
		};

		if (el.kind === 'ground') {
			explicitGroundElements.push(normalized);
		} else if (el.kind === 'terminal') {
			terminalElements.push(normalized);
		} else {
			twoTerminalElements.push(normalized);
		}
	}

	return {
		netlist,
		mode,
		frequencyHz,
		acMagnitudeMode,
		twoTerminalElements,
		explicitGroundElements,
		terminalElements,
		usedIds,
		prefixCounters,
		nextUniqueId,
		rawToNormNode
	};
}

/**
 * Verifies that `doc` has zero overlapping component centers and is 100% electrically
 * isomorphic to the input netlist (bijection between expected netlist nodes and
 * `buildElectricalGraph(doc)` nodes, preserving reference node `"0"` and exact pin polarity).
 *
 * Returns the bijection map (expectedNode -> actualGraphNode) if isomorphic, or `null` otherwise.
 */
function verifyElectricalIsomorphism(
	doc: CircuitDocument,
	twoTerminalElements: NormalizedElement[],
	terminalElements: NormalizedElement[]
): Map<string, string> | null {
	// 1. Ensure no two components share the exact same center point
	const centers = new Set<string>();
	for (const comp of doc.components) {
		const key = `${comp.x},${comp.y}`;
		if (centers.has(key)) return null;
		centers.add(key);
	}

	// 2. Build actual electrical graph and verify exact node bijection
	const graph = buildElectricalGraph(doc);
	const expectedToActual = new Map<string, string>();
	const actualToExpected = new Map<string, string>();

	const bindNode = (expected: string, actual: string | undefined): boolean => {
		if (!actual) return false;
		if (expected === '0' && actual !== '0') return false;
		if (actual === '0' && expected !== '0') return false;
		const prevActual = expectedToActual.get(expected);
		if (prevActual !== undefined && prevActual !== actual) return false;
		const prevExpected = actualToExpected.get(actual);
		if (prevExpected !== undefined && prevExpected !== expected) return false;
		expectedToActual.set(expected, actual);
		actualToExpected.set(actual, expected);
		return true;
	};

	for (const el of twoTerminalElements) {
		const actualNodes = graph.componentNodes[el.id];
		if (!actualNodes || actualNodes.length !== 2) return null;
		if (!bindNode(el.from, actualNodes[0])) return null;
		if (!bindNode(el.to, actualNodes[1])) return null;
	}

	for (const el of terminalElements) {
		const actualNodes = graph.componentNodes[el.id];
		if (!actualNodes || actualNodes.length !== 1) return null;
		if (!bindNode(el.from, actualNodes[0])) return null;
	}

	return expectedToActual;
}

/**
 * Computes the netlist-node -> final-graph-node mapping for any laid-out document
 * (used to remap `node_voltage` constraint targets accurately).
 */
function buildNodeIdMap(
	doc: CircuitDocument,
	ctx: NormalizedNetlistContext
): Record<string, string> {
	const graph = buildElectricalGraph(doc);
	const normToActual = new Map<string, string>();
	normToActual.set('0', '0');

	for (const el of ctx.twoTerminalElements) {
		const actualNodes = graph.componentNodes[el.id];
		if (actualNodes && actualNodes.length === 2) {
			if (!normToActual.has(el.from)) normToActual.set(el.from, actualNodes[0]);
			if (!normToActual.has(el.to)) normToActual.set(el.to, actualNodes[1]);
		}
	}
	for (const el of ctx.terminalElements) {
		const actualNodes = graph.componentNodes[el.id];
		if (actualNodes && actualNodes.length >= 1) {
			if (!normToActual.has(el.from)) normToActual.set(el.from, actualNodes[0]);
		}
	}

	const result: Record<string, string> = {};
	for (const [norm, actual] of normToActual.entries()) {
		result[norm] = actual;
	}
	for (const [raw, norm] of ctx.rawToNormNode.entries()) {
		const actual = normToActual.get(norm);
		if (actual) result[raw] = actual;
	}
	return result;
}

// ============================================================================
// Visual-Grid Layout Cloner (Preserves Exact Image Orientation & Geometry)
// ============================================================================

interface Segment2D {
	x1: number;
	y1: number;
	x2: number;
	y2: number;
}

function pointKey(x: number, y: number): string {
	return `${x},${y}`;
}

function pointOnAxisSegment(px: number, py: number, seg: Segment2D): boolean {
	if (seg.x1 === seg.x2) {
		return px === seg.x1 && py >= Math.min(seg.y1, seg.y2) && py <= Math.max(seg.y1, seg.y2);
	}
	if (seg.y1 === seg.y2) {
		return py === seg.y1 && px >= Math.min(seg.x1, seg.x2) && px <= Math.max(seg.x1, seg.x2);
	}
	// General collinear fallback
	const minX = Math.min(seg.x1, seg.x2);
	const maxX = Math.max(seg.x1, seg.x2);
	const minY = Math.min(seg.y1, seg.y2);
	const maxY = Math.max(seg.y1, seg.y2);
	if (px < minX || px > maxX || py < minY || py > maxY) return false;
	return (px - seg.x1) * (seg.y2 - seg.y1) === (py - seg.y1) * (seg.x2 - seg.x1);
}

function segmentsCollinearOverlap(a: Segment2D, b: Segment2D): boolean {
	if (a.x1 === a.x2 && b.x1 === b.x2 && a.x1 === b.x1) {
		const aMin = Math.min(a.y1, a.y2);
		const aMax = Math.max(a.y1, a.y2);
		const bMin = Math.min(b.y1, b.y2);
		const bMax = Math.max(b.y1, b.y2);
		return Math.max(aMin, bMin) <= Math.min(aMax, bMax);
	}
	if (a.y1 === a.y2 && b.y1 === b.y2 && a.y1 === b.y1) {
		const aMin = Math.min(a.x1, a.x2);
		const aMax = Math.max(a.x1, a.x2);
		const bMin = Math.min(b.x1, b.x2);
		const bMax = Math.max(b.x1, b.x2);
		return Math.max(aMin, bMin) <= Math.min(aMax, bMax);
	}
	return false;
}

interface PositionedElement {
	el: NormalizedElement;
	c1: number;
	r1: number;
	c2: number;
	r2: number;
}

/**
 * Attempts to clone the exact schematic visual geometry from `fromPos`/`toPos` coordinates.
 * Returns a `CircuitDocument` if visual-grid geometry is available and 100% electrically
 * isomorphic to the input netlist; returns `null` if visual coordinates are absent or conflicting.
 */
export function layoutVisualGridToDocument(
	netlist: LayoutNetlistDocument
): CircuitDocument | null {
	const ctx = normalizeNetlistContext(netlist);
	const result = tryVisualGridLayout(ctx);
	return result ? result.document : null;
}

function tryVisualGridLayout(
	ctx: NormalizedNetlistContext
): { document: CircuitDocument; hadVisualCoords: boolean } | null {
	const { twoTerminalElements, explicitGroundElements, terminalElements } = ctx;
	if (twoTerminalElements.length === 0) return null;

	// Count how many 2-terminal elements provide valid visual coordinates
	let withBothPos = 0;
	const nodeKnownPos = new Map<string, [number, number]>();
	for (const el of twoTerminalElements) {
		if (el.fromPos) {
			if (!nodeKnownPos.has(el.from)) nodeKnownPos.set(el.from, el.fromPos);
		}
		if (el.toPos) {
			if (!nodeKnownPos.has(el.to)) nodeKnownPos.set(el.to, el.toPos);
		}
		if (el.fromPos && el.toPos) withBothPos++;
	}

	if (withBothPos === 0) {
		return null;
	}

	// Require nearly all (>= 80%) 2-terminal elements to supply coordinates;
	// infer missing single endpoints only if another element already positioned that node.
	if (withBothPos < Math.ceil(twoTerminalElements.length * 0.8)) {
		return null;
	}

	const rawPositioned: Array<{
		el: NormalizedElement;
		fromPos: [number, number];
		toPos: [number, number];
	}> = [];

	for (const el of twoTerminalElements) {
		const fp = el.fromPos ?? nodeKnownPos.get(el.from);
		const tp = el.toPos ?? nodeKnownPos.get(el.to);
		if (!fp || !tp) {
			return null;
		}
		// Different nodes sharing identical vertex coordinates is an immediate conflict
		if (el.from !== el.to && fp[0] === tp[0] && fp[1] === tp[1]) {
			return null;
		}
		rawPositioned.push({ el, fromPos: fp, toPos: tp });
	}

	// Collect all distinct coarse columns & rows and dense-rank them to preserve
	// exact relative alignment while preventing giant sparse coordinate blowups.
	const colSet = new Set<number>();
	const rowSet = new Set<number>();
	for (const item of rawPositioned) {
		colSet.add(item.fromPos[0]);
		colSet.add(item.toPos[0]);
		rowSet.add(item.fromPos[1]);
		rowSet.add(item.toPos[1]);
	}
	for (const el of [...explicitGroundElements, ...terminalElements]) {
		if (el.fromPos) {
			colSet.add(el.fromPos[0]);
			rowSet.add(el.fromPos[1]);
		}
	}

	const sortedCols = Array.from(colSet).sort((a, b) => a - b);
	const sortedRows = Array.from(rowSet).sort((a, b) => a - b);
	const colIndex = new Map<number, number>();
	const rowIndex = new Map<number, number>();
	sortedCols.forEach((c, i) => colIndex.set(c, i));
	sortedRows.forEach((r, i) => rowIndex.set(r, i));

	const maxCol = Math.max(0, sortedCols.length - 1);
	const maxRow = Math.max(0, sortedRows.length - 1);

	const positioned: PositionedElement[] = rawPositioned.map((item) => ({
		el: item.el,
		c1: colIndex.get(item.fromPos[0])!,
		r1: rowIndex.get(item.fromPos[1])!,
		c2: colIndex.get(item.toPos[0])!,
		r2: rowIndex.get(item.toPos[1])!
	}));

	// Check for coarse vertex node collisions (two distinct electrical nodes claiming same [c, r])
	const vertexNodeOwner = new Map<string, string>();
	const usedVertices = new Set<string>();
	for (const p of positioned) {
		const k1 = `${p.c1},${p.r1}`;
		const k2 = `${p.c2},${p.r2}`;
		usedVertices.add(k1);
		usedVertices.add(k2);
		const owner1 = vertexNodeOwner.get(k1);
		if (owner1 !== undefined && owner1 !== p.el.from) return null;
		vertexNodeOwner.set(k1, p.el.from);
		const owner2 = vertexNodeOwner.get(k2);
		if (owner2 !== undefined && owner2 !== p.el.to) return null;
		vertexNodeOwner.set(k2, p.el.to);
	}

	// Group elements by canonical unordered endpoint pair to detect parallel multi-branches
	const segmentGroups = new Map<string, PositionedElement[]>();
	for (const p of positioned) {
		const forward = p.c1 < p.c2 || (p.c1 === p.c2 && p.r1 <= p.r2);
		const aC = forward ? p.c1 : p.c2;
		const aR = forward ? p.r1 : p.r2;
		const bC = forward ? p.c2 : p.c1;
		const bR = forward ? p.r2 : p.r1;
		const key = `${aC},${aR}|${bC},${bR}`;
		const grp = segmentGroups.get(key);
		if (grp) grp.push(p);
		else segmentGroups.set(key, [p]);
	}

	// Compute adaptive even-integer column X and row Y coordinates so midpoints are ALWAYS integers
	// and parallel multi-branches have generous clearance without ever overlapping adjacent columns/rows.
	const CELL_STEP = 6;
	const ORIGIN = 4;
	const colSpreadLeft = new Array<number>(sortedCols.length).fill(0);
	const colSpreadRight = new Array<number>(sortedCols.length).fill(0);
	const rowSpreadUp = new Array<number>(sortedRows.length).fill(0);
	const rowSpreadDown = new Array<number>(sortedRows.length).fill(0);
	const colGapMin = new Array<number>(Math.max(0, sortedCols.length - 1)).fill(CELL_STEP);
	const rowGapMin = new Array<number>(Math.max(0, sortedRows.length - 1)).fill(CELL_STEP);

	for (const group of segmentGroups.values()) {
		if (group.length <= 1) continue;
		const sample = group[0];
		const halfSpread = (group.length - 1) * 2; // (k-1)/2 * 4
		if (sample.c1 === sample.c2 && sample.r1 !== sample.r2) {
			// Parallel vertical branches on column c1
			colSpreadLeft[sample.c1] = Math.max(colSpreadLeft[sample.c1], halfSpread);
			colSpreadRight[sample.c1] = Math.max(colSpreadRight[sample.c1], halfSpread);
			const rTop = Math.min(sample.r1, sample.r2);
			const rBot = Math.max(sample.r1, sample.r2);
			if (rBot - rTop === 1) {
				rowGapMin[rTop] = Math.max(rowGapMin[rTop], 8);
			}
		} else if (sample.r1 === sample.r2 && sample.c1 !== sample.c2) {
			// Parallel horizontal branches on row r1
			rowSpreadUp[sample.r1] = Math.max(rowSpreadUp[sample.r1], halfSpread);
			rowSpreadDown[sample.r1] = Math.max(rowSpreadDown[sample.r1], halfSpread);
			const cLeft = Math.min(sample.c1, sample.c2);
			const cRight = Math.max(sample.c1, sample.c2);
			if (cRight - cLeft === 1) {
				colGapMin[cLeft] = Math.max(colGapMin[cLeft], 8);
			}
		}
	}

	const toEvenAtLeast = (n: number): number => (n % 2 === 0 ? n : n + 1);

	const colX: number[] = [ORIGIN];
	for (let c = 0; c + 1 < sortedCols.length; c++) {
		const needed = Math.max(colGapMin[c], colSpreadRight[c] + colSpreadLeft[c + 1] + 4);
		colX.push(colX[c] + toEvenAtLeast(needed));
	}

	const rowY: number[] = [ORIGIN];
	for (let r = 0; r + 1 < sortedRows.length; r++) {
		const needed = Math.max(rowGapMin[r], rowSpreadDown[r] + rowSpreadUp[r + 1] + 4);
		rowY.push(rowY[r] + toEvenAtLeast(needed));
	}

	// Track occupied spanning tracks & component bodies to avoid any overlap
	const components: CircuitComponent[] = [];
	const wires: CircuitWire[] = [];
	let wireCounter = 0;

	const nodeAnchors = new Map<string, Map<string, GridPoint>>();
	const nodeWireSegments = new Map<string, Segment2D[]>();
	const nodeVertices = new Map<string, Map<string, GridPoint>>();

	const registerNodeAnchor = (nodeId: string, x: number, y: number) => {
		let map = nodeAnchors.get(nodeId);
		if (!map) {
			map = new Map();
			nodeAnchors.set(nodeId, map);
		}
		map.set(pointKey(x, y), { x, y });
	};

	const registerNodeVertex = (nodeId: string, x: number, y: number) => {
		let map = nodeVertices.get(nodeId);
		if (!map) {
			map = new Map();
			nodeVertices.set(nodeId, map);
		}
		map.set(pointKey(x, y), { x, y });
	};

	const addNodeWire = (nodeId: string, rawPts: Array<[number, number]>) => {
		const pts = simplifyPolyline(rawPts);
		if (pts.length < 2) return;
		if (pts.length === 2 && pts[0][0] === pts[1][0] && pts[0][1] === pts[1][1]) return;
		wireCounter++;
		wires.push(makeWire(`w${wireCounter}`, pts));

		let segs = nodeWireSegments.get(nodeId);
		if (!segs) {
			segs = [];
			nodeWireSegments.set(nodeId, segs);
		}
		for (let i = 0; i < pts.length; i++) {
			registerNodeVertex(nodeId, pts[i][0], pts[i][1]);
			if (i + 1 < pts.length) {
				segs.push({
					x1: pts[i][0],
					y1: pts[i][1],
					x2: pts[i + 1][0],
					y2: pts[i + 1][1]
				});
			}
		}
	};

	// Pre-index horizontal & vertical occupied coarse segments for spanning obstruction checks
	const horizSegsOnRow = new Map<number, Array<{ cLeft: number; cRight: number }>>();
	const vertSegsOnCol = new Map<number, Array<{ rTop: number; rBot: number }>>();
	for (const p of positioned) {
		if (p.r1 === p.r2 && p.c1 !== p.c2) {
			const arr = horizSegsOnRow.get(p.r1) ?? [];
			arr.push({ cLeft: Math.min(p.c1, p.c2), cRight: Math.max(p.c1, p.c2) });
			horizSegsOnRow.set(p.r1, arr);
		} else if (p.c1 === p.c2 && p.r1 !== p.r2) {
			const arr = vertSegsOnCol.get(p.c1) ?? [];
			arr.push({ rTop: Math.min(p.r1, p.r2), rBot: Math.max(p.r1, p.r2) });
			vertSegsOnCol.set(p.c1, arr);
		}
	}

	const isHorizontalSpanObstructed = (cLeft: number, cRight: number, row: number): boolean => {
		if (cRight - cLeft < 2) return false;
		for (let c = cLeft + 1; c < cRight; c++) {
			if (usedVertices.has(`${c},${row}`)) return true;
		}
		const segs = horizSegsOnRow.get(row) ?? [];
		for (const s of segs) {
			if (s.cLeft === cLeft && s.cRight === cRight) continue;
			if (Math.max(s.cLeft, cLeft) < Math.min(s.cRight, cRight)) return true;
		}
		return false;
	};

	const isVerticalSpanObstructed = (rTop: number, rBot: number, col: number): boolean => {
		if (rBot - rTop < 2) return false;
		for (let r = rTop + 1; r < rBot; r++) {
			if (usedVertices.has(`${col},${r}`)) return true;
		}
		const segs = vertSegsOnCol.get(col) ?? [];
		for (const s of segs) {
			if (s.rTop === rTop && s.rBot === rBot) continue;
			if (Math.max(s.rTop, rTop) < Math.min(s.rBot, rBot)) return true;
		}
		return false;
	};

	const usedHorizTracks: Array<{ y: number; xMin: number; xMax: number }> = [];
	const usedVertTracks: Array<{ x: number; yMin: number; yMax: number }> = [];
	const usedComponentCenters = new Set<string>();

	const hasVerticalNeighborAt = (col: number, row: number, dir: -1 | 1): boolean => {
		const segs = vertSegsOnCol.get(col) ?? [];
		return segs.some((s) => (dir === -1 ? s.rBot === row : s.rTop === row));
	};

	const hasHorizontalNeighborAt = (col: number, row: number, dir: -1 | 1): boolean => {
		const segs = horizSegsOnRow.get(row) ?? [];
		return segs.some((s) => (dir === -1 ? s.cRight === col : s.cLeft === col));
	};

	const pickFreeHorizSpanY = (xMin: number, xMax: number, baseRow: number): number => {
		const yBase = rowY[baseRow];
		const preferDown = baseRow === maxRow && baseRow > 0;
		const offsets = preferDown
			? [4, 8, 12, 16, -4, -8, -12, -16]
			: [-4, -8, -12, -16, 4, 8, 12, 16];
		for (const dy of offsets) {
			const y = yBase + dy;
			const collidesRow = rowY.some((ry) => ry === y);
			if (collidesRow) continue;
			const collidesTrack = usedHorizTracks.some(
				(t) => t.y === y && Math.max(t.xMin, xMin) <= Math.min(t.xMax, xMax)
			);
			if (!collidesTrack) {
				usedHorizTracks.push({ y, xMin, xMax });
				return y;
			}
		}
		const fallbackY = rowY[0] - 4 * (usedHorizTracks.length + 1);
		usedHorizTracks.push({ y: fallbackY, xMin, xMax });
		return fallbackY;
	};

	const pickFreeVertSpanX = (yMin: number, yMax: number, baseCol: number): number => {
		const xBase = colX[baseCol];
		const preferRight = baseCol === maxCol && baseCol > 0;
		const offsets = preferRight
			? [4, 8, 12, 16, -4, -8, -12, -16]
			: [-4, -8, -12, -16, 4, 8, 12, 16];
		for (const dx of offsets) {
			const x = xBase + dx;
			const collidesCol = colX.some((cx) => cx === x);
			if (collidesCol) continue;
			const collidesTrack = usedVertTracks.some(
				(t) => t.x === x && Math.max(t.yMin, yMin) <= Math.min(t.yMax, yMax)
			);
			if (!collidesTrack) {
				usedVertTracks.push({ x, yMin, yMax });
				return x;
			}
		}
		const fallbackX = colX[0] - 4 * (usedVertTracks.length + 1);
		usedVertTracks.push({ x: fallbackX, yMin, yMax });
		return fallbackX;
	};

	const placeComponent = (el: NormalizedElement, x: number, y: number, rotation: Rotation) => {
		const comp = toComponent(el, x, y, rotation);
		components.push(comp);
		usedComponentCenters.add(pointKey(x, y));
		const pins = getPinPositions(comp);
		if (pins.length === 2) {
			registerNodeVertex(el.from, pins[0].x, pins[0].y);
			registerNodeVertex(el.to, pins[1].x, pins[1].y);
		}
		return comp;
	};

	// Place all 2-terminal element groups
	for (const group of segmentGroups.values()) {
		const sample = group[0];
		const isHorizontal = sample.r1 === sample.r2 && sample.c1 !== sample.c2;
		const isVertical = sample.c1 === sample.c2 && sample.r1 !== sample.r2;
		const isSamePoint = sample.c1 === sample.c2 && sample.r1 === sample.r2;

		if (isSamePoint) {
			// Self-shorted element at a single grid vertex
			const xBase = colX[sample.c1];
			const yBase = rowY[sample.r1];
			group.forEach((item, idx) => {
				const cx = xBase + 4;
				const cy = yBase + idx * 4;
				placeComponent(item.el, cx, cy, 0);
				registerNodeAnchor(item.el.from, xBase, yBase);
				addNodeWire(item.el.from, [
					[xBase, yBase],
					[xBase, cy],
					[cx - 2, cy]
				]);
				addNodeWire(item.el.to, [
					[cx + 2, cy],
					[cx + 2, cy + 2],
					[xBase, cy + 2],
					[xBase, yBase]
				]);
			});
			continue;
		}

		if (isHorizontal) {
			const cLeft = Math.min(sample.c1, sample.c2);
			const cRight = Math.max(sample.c1, sample.c2);
			const row = sample.r1;
			const xLeft = colX[cLeft];
			const xRight = colX[cRight];
			const yBase = rowY[row];
			const cx = Math.round((xLeft + xRight) / 2);
			const obstructed = isHorizontalSpanObstructed(cLeft, cRight, row);

			group.forEach((item, idx) => {
				const rot: Rotation = item.c1 < item.c2 ? 0 : 180;
				const leftNode = item.c1 < item.c2 ? item.el.from : item.el.to;
				const rightNode = item.c1 < item.c2 ? item.el.to : item.el.from;
				registerNodeAnchor(leftNode, xLeft, yBase);
				registerNodeAnchor(rightNode, xRight, yBase);

				if (obstructed) {
					const yTrack = pickFreeHorizSpanY(xLeft, xRight, row);
					placeComponent(item.el, cx, yTrack, rot);
					const dir: -1 | 1 = yTrack < yBase ? -1 : 1;
					const stubXLeft = hasVerticalNeighborAt(cLeft, row, dir) ? xLeft + 1 : xLeft;
					const stubXRight = hasVerticalNeighborAt(cRight, row, dir) ? xRight - 1 : xRight;
					addNodeWire(leftNode, [
						[xLeft, yBase],
						[stubXLeft, yBase],
						[stubXLeft, yTrack],
						[cx - 2, yTrack]
					]);
					addNodeWire(rightNode, [
						[cx + 2, yTrack],
						[stubXRight, yTrack],
						[stubXRight, yBase],
						[xRight, yBase]
					]);
				} else if (group.length === 1) {
					placeComponent(item.el, cx, yBase, rot);
					addNodeWire(leftNode, [
						[xLeft, yBase],
						[cx - 2, yBase]
					]);
					addNodeWire(rightNode, [
						[cx + 2, yBase],
						[xRight, yBase]
					]);
				} else {
					const dy = (idx - (group.length - 1) / 2) * 4;
					const yTrack = yBase + dy;
					placeComponent(item.el, cx, yTrack, rot);
					const stubXLeft = xLeft + 1;
					const stubXRight = xRight - 1;
					addNodeWire(leftNode, [
						[xLeft, yBase],
						[stubXLeft, yBase],
						[stubXLeft, yTrack],
						[cx - 2, yTrack]
					]);
					addNodeWire(rightNode, [
						[cx + 2, yTrack],
						[stubXRight, yTrack],
						[stubXRight, yBase],
						[xRight, yBase]
					]);
				}
			});
			continue;
		}

		if (isVertical) {
			const rTop = Math.min(sample.r1, sample.r2);
			const rBot = Math.max(sample.r1, sample.r2);
			const col = sample.c1;
			const xBase = colX[col];
			const yTop = rowY[rTop];
			const yBot = rowY[rBot];
			const cy = Math.round((yTop + yBot) / 2);
			const obstructed = isVerticalSpanObstructed(rTop, rBot, col);

			group.forEach((item, idx) => {
				const rot: Rotation = item.r1 < item.r2 ? 90 : 270;
				const topNode = item.r1 < item.r2 ? item.el.from : item.el.to;
				const botNode = item.r1 < item.r2 ? item.el.to : item.el.from;
				registerNodeAnchor(topNode, xBase, yTop);
				registerNodeAnchor(botNode, xBase, yBot);

				if (obstructed) {
					const xTrack = pickFreeVertSpanX(yTop, yBot, col);
					placeComponent(item.el, xTrack, cy, rot);
					const dir: -1 | 1 = xTrack < xBase ? -1 : 1;
					const stubYTop = hasHorizontalNeighborAt(col, rTop, dir) ? yTop + 1 : yTop;
					const stubYBot = hasHorizontalNeighborAt(col, rBot, dir) ? yBot - 1 : yBot;
					addNodeWire(topNode, [
						[xBase, yTop],
						[xBase, stubYTop],
						[xTrack, stubYTop],
						[xTrack, cy - 2]
					]);
					addNodeWire(botNode, [
						[xTrack, cy + 2],
						[xTrack, stubYBot],
						[xBase, stubYBot],
						[xBase, yBot]
					]);
				} else if (group.length === 1) {
					placeComponent(item.el, xBase, cy, rot);
					addNodeWire(topNode, [
						[xBase, yTop],
						[xBase, cy - 2]
					]);
					addNodeWire(botNode, [
						[xBase, cy + 2],
						[xBase, yBot]
					]);
				} else {
					const dx = (idx - (group.length - 1) / 2) * 4;
					const xTrack = xBase + dx;
					placeComponent(item.el, xTrack, cy, rot);
					const stubYTop = yTop + 1;
					const stubYBot = yBot - 1;
					addNodeWire(topNode, [
						[xBase, yTop],
						[xBase, stubYTop],
						[xTrack, stubYTop],
						[xTrack, cy - 2]
					]);
					addNodeWire(botNode, [
						[xTrack, cy + 2],
						[xTrack, stubYBot],
						[xBase, stubYBot],
						[xBase, yBot]
					]);
				}
			});
			continue;
		}

		// Diagonal edge (c1 !== c2 && r1 !== r2): pick dominant axis and route L-shaped Manhattan leads
		const dc = Math.abs(sample.c2 - sample.c1);
		const dr = Math.abs(sample.r2 - sample.r1);
		const useHorizontal = dc >= dr;

		group.forEach((item, idx) => {
			const x1 = colX[item.c1];
			const y1 = rowY[item.r1];
			const x2 = colX[item.c2];
			const y2 = rowY[item.r2];
			registerNodeAnchor(item.el.from, x1, y1);
			registerNodeAnchor(item.el.to, x2, y2);

			const spread = (idx - (group.length - 1) / 2) * 4;
			let cx = Math.round((x1 + x2) / 2) + (useHorizontal ? 0 : spread);
			let cy = Math.round((y1 + y2) / 2) + (useHorizontal ? spread : 0);

			// Nudge if center collides with an existing component
			let guard = 0;
			while (usedComponentCenters.has(pointKey(cx, cy)) && guard < 12) {
				guard++;
				const step = (guard % 2 === 1 ? 1 : -1) * Math.ceil(guard / 2) * 2;
				if (useHorizontal) cy += step;
				else cx += step;
			}

			const rot: Rotation = useHorizontal
				? item.c1 < item.c2
					? 0
					: 180
				: item.r1 < item.r2
					? 90
					: 270;
			const comp = placeComponent(item.el, cx, cy, rot);
			const pins = getPinPositions(comp);
			const p0 = pins[0];
			const p1 = pins[1];

			// Route L-shaped leads cleanly from each pin to its anchor
			if (useHorizontal) {
				addNodeWire(item.el.from, [
					[p0.x, p0.y],
					[p0.x, y1],
					[x1, y1]
				]);
				addNodeWire(item.el.to, [
					[p1.x, p1.y],
					[p1.x, y2],
					[x2, y2]
				]);
			} else {
				addNodeWire(item.el.from, [
					[p0.x, p0.y],
					[x1, p0.y],
					[x1, y1]
				]);
				addNodeWire(item.el.to, [
					[p1.x, p1.y],
					[x2, p1.y],
					[x2, y2]
				]);
			}
		});
	}

	// Register explicit terminal & ground element anchors before routing node buses
	const placedTerminals: Array<{ el: NormalizedElement; x: number; y: number }> = [];
	for (const term of terminalElements) {
		let tx: number;
		let ty: number;
		if (term.fromPos) {
			tx = colX[colIndex.get(term.fromPos[0])!];
			ty = rowY[rowIndex.get(term.fromPos[1])!];
		} else {
			const anchors = nodeAnchors.get(term.from);
			const first = anchors ? Array.from(anchors.values())[0] : undefined;
			tx = first?.x ?? colX[0];
			ty = first?.y ?? rowY[0];
		}
		if (usedComponentCenters.has(pointKey(tx, ty))) {
			ty += 2;
		}
		registerNodeAnchor(term.from, tx, ty);
		registerNodeVertex(term.from, tx, ty);
		usedComponentCenters.add(pointKey(tx, ty));
		placedTerminals.push({ el: term, x: tx, y: ty });
	}

	const placedGrounds: Array<{ el: NormalizedElement; x: number; y: number }> = [];
	for (const gnd of explicitGroundElements) {
		if (gnd.fromPos) {
			const gx = colX[colIndex.get(gnd.fromPos[0])!];
			const gy = rowY[rowIndex.get(gnd.fromPos[1])!];
			registerNodeAnchor('0', gx, gy);
			registerNodeVertex('0', gx, gy);
			placedGrounds.push({ el: gnd, x: gx, y: gy });
		}
	}

	// Obstacle-aware Orthogonal Manhattan Spanning-Tree Bus Router for multi-anchor nodes
	const componentBodyPoints = components.map((c) => ({ x: c.x, y: c.y }));
	const allExistingXs = [
		...colX,
		...components.map((c) => c.x),
		...wires.flatMap((w) => w.points.map((p) => p.x))
	];
	const allExistingYs = [
		...rowY,
		...components.map((c) => c.y),
		...wires.flatMap((w) => w.points.map((p) => p.y))
	];
	const boundMinX = Math.min(...allExistingXs);
	const boundMaxX = Math.max(...allExistingXs);
	const boundMinY = Math.min(...allExistingYs);
	const boundMaxY = Math.max(...allExistingYs);

	const isPathSafeForNode = (
		nodeId: string,
		rawPts: Array<[number, number]>,
		foreignPoints: GridPoint[],
		foreignSegments: Segment2D[]
	): boolean => {
		const pts = simplifyPolyline(rawPts);
		if (pts.length < 2) return true;

		const segs: Segment2D[] = [];
		for (let i = 0; i + 1 < pts.length; i++) {
			segs.push({
				x1: pts[i][0],
				y1: pts[i][1],
				x2: pts[i + 1][0],
				y2: pts[i + 1][1]
			});
		}

		// 1. No interior vertex of our path may lie on any foreign wire segment
		for (let i = 1; i < pts.length - 1; i++) {
			const [px, py] = pts[i];
			for (const fSeg of foreignSegments) {
				if (pointOnAxisSegment(px, py, fSeg)) return false;
			}
		}

		// 2. No foreign point (pin, anchor, wire vertex) may lie on any segment of our path
		for (const seg of segs) {
			for (const fp of foreignPoints) {
				if (pointOnAxisSegment(fp.x, fp.y, seg)) return false;
			}
			// 3. No segment may collinearly overlap a foreign wire segment
			for (const fSeg of foreignSegments) {
				if (segmentsCollinearOverlap(seg, fSeg)) return false;
			}
			// 4. Avoid cutting visually through any component center
			for (const body of componentBodyPoints) {
				if (pointOnAxisSegment(body.x, body.y, seg)) return false;
			}
		}

		// Unused parameter lint guard
		return nodeId.length >= 0;
	};

	const findBestBusPath = (
		nodeId: string,
		a: GridPoint,
		b: GridPoint,
		foreignPoints: GridPoint[],
		foreignSegments: Segment2D[]
	): { pts: Array<[number, number]>; cost: number } | null => {
		const manhattan = Math.abs(a.x - b.x) + Math.abs(a.y - b.y);

		// 1. Direct colinear straight segment (highest preference)
		if (a.x === b.x || a.y === b.y) {
			const straight: Array<[number, number]> = [
				[a.x, a.y],
				[b.x, b.y]
			];
			if (isPathSafeForNode(nodeId, straight, foreignPoints, foreignSegments)) {
				return { pts: straight, cost: manhattan };
			}
		}

		// 2. Single-elbow L-paths
		const lCandidates: Array<Array<[number, number]>> = [
			[
				[a.x, a.y],
				[b.x, a.y],
				[b.x, b.y]
			],
			[
				[a.x, a.y],
				[a.x, b.y],
				[b.x, b.y]
			]
		];
		for (const cand of lCandidates) {
			if (isPathSafeForNode(nodeId, cand, foreignPoints, foreignSegments)) {
				return { pts: cand, cost: manhattan + 1 };
			}
		}

		// 3. 2-elbow U/Z detours around local obstacles
		const detourOffsets = [2, -2, 4, -4, 6, -6, 8, -8];
		for (const d of detourOffsets) {
			const detours: Array<Array<[number, number]>> = [
				[
					[a.x, a.y],
					[a.x, a.y + d],
					[b.x, a.y + d],
					[b.x, b.y]
				],
				[
					[a.x, a.y],
					[a.x, b.y + d],
					[b.x, b.y + d],
					[b.x, b.y]
				],
				[
					[a.x, a.y],
					[a.x + d, a.y],
					[a.x + d, b.y],
					[b.x, b.y]
				],
				[
					[a.x, a.y],
					[b.x + d, a.y],
					[b.x + d, b.y],
					[b.x, b.y]
				]
			];
			for (const cand of detours) {
				if (isPathSafeForNode(nodeId, cand, foreignPoints, foreignSegments)) {
					return { pts: cand, cost: manhattan + Math.abs(d) * 2 + 4 };
				}
			}
		}

		// 4. Perimeter detour outside the schematic bounding box
		const perimeterCandidates: Array<Array<[number, number]>> = [
			[
				[a.x, a.y],
				[a.x, boundMaxY + 4],
				[b.x, boundMaxY + 4],
				[b.x, b.y]
			],
			[
				[a.x, a.y],
				[a.x, boundMinY - 4],
				[b.x, boundMinY - 4],
				[b.x, b.y]
			],
			[
				[a.x, a.y],
				[boundMinX - 4, a.y],
				[boundMinX - 4, b.y],
				[b.x, b.y]
			],
			[
				[a.x, a.y],
				[boundMaxX + 4, a.y],
				[boundMaxX + 4, b.y],
				[b.x, b.y]
			]
		];
		for (const cand of perimeterCandidates) {
			if (isPathSafeForNode(nodeId, cand, foreignPoints, foreignSegments)) {
				return { pts: cand, cost: manhattan + 100 };
			}
		}

		return null;
	};

	// Route each multi-anchor electrical node using Prim's MST over safe Manhattan paths
	const nodeOrder = Array.from(nodeAnchors.keys()).sort((a, b) => {
		// Route ground ("0") last or first? Route non-ground first, ground rail last (or vice versa)
		if (a === '0') return 1;
		if (b === '0') return -1;
		return a.localeCompare(b);
	});

	for (const nodeId of nodeOrder) {
		const anchors = Array.from(nodeAnchors.get(nodeId)!.values());
		if (anchors.length < 2) continue;

		// Gather all foreign points & segments belonging to OTHER nodes
		const foreignPoints: GridPoint[] = [];
		const foreignSegments: Segment2D[] = [];
		for (const [otherId, verts] of nodeVertices.entries()) {
			if (otherId === nodeId) continue;
			for (const pt of verts.values()) foreignPoints.push(pt);
		}
		for (const [otherId, ancs] of nodeAnchors.entries()) {
			if (otherId === nodeId) continue;
			for (const pt of ancs.values()) foreignPoints.push(pt);
		}
		for (const [otherId, segs] of nodeWireSegments.entries()) {
			if (otherId === nodeId) continue;
			for (const s of segs) foreignSegments.push(s);
		}

		// Prim's MST connecting all anchors of `nodeId`
		const inTree = new Set<number>([0]);
		while (inTree.size < anchors.length) {
			let bestNext = -1;
			let bestPath: Array<[number, number]> | null = null;
			let bestCost = Infinity;

			for (const u of inTree) {
				for (let v = 0; v < anchors.length; v++) {
					if (inTree.has(v)) continue;
					const found = findBestBusPath(
						nodeId,
						anchors[u],
						anchors[v],
						foreignPoints,
						foreignSegments
					);
					if (found && found.cost < bestCost) {
						bestCost = found.cost;
						bestPath = found.pts;
						bestNext = v;
					}
				}
			}

			if (bestNext === -1 || !bestPath) {
				// Cannot route safely without shorting -> let safety gate fall back cleanly
				return null;
			}

			addNodeWire(nodeId, bestPath);
			inTree.add(bestNext);
		}
	}

	// Emit terminal components
	for (const pt of placedTerminals) {
		components.push(toComponent(pt.el, pt.x, pt.y, 0));
	}

	// Emit ground component(s)
	if (placedGrounds.length > 0) {
		for (const pg of placedGrounds) {
			let gx = pg.x;
			let gy = pg.y;
			if (usedComponentCenters.has(pointKey(gx, gy))) {
				addNodeWire('0', [
					[gx, gy],
					[gx, gy + 2]
				]);
				gy += 2;
			}
			usedComponentCenters.add(pointKey(gx, gy));
			components.push(toComponent(pg.el, gx, gy, 0));
		}
	} else {
		// Pick bottom-most, left-most anchor of node "0"
		const gndAnchors = Array.from(nodeAnchors.get('0')?.values() ?? []);
		let gx = colX[0];
		let gy = rowY[rowY.length - 1];
		if (gndAnchors.length > 0) {
			gndAnchors.sort((a, b) => {
				if (b.y !== a.y) return b.y - a.y;
				return a.x - b.x;
			});
			gx = gndAnchors[0].x;
			gy = gndAnchors[0].y;
		}
		if (usedComponentCenters.has(pointKey(gx, gy))) {
			addNodeWire('0', [
				[gx, gy],
				[gx, gy + 2]
			]);
			gy += 2;
		}
		usedComponentCenters.add(pointKey(gx, gy));
		if (explicitGroundElements.length > 0) {
			components.push(toComponent(explicitGroundElements[0], gx, gy, 0));
		} else {
			const gndId = ctx.nextUniqueId('ground');
			components.push({
				id: gndId,
				kind: 'ground',
				label: 'GND',
				x: gx,
				y: gy,
				rotation: 0,
				value: '0'
			});
		}
	}

	// Shift entire layout if any spanning track went below coordinate 4 so canvas stays tidy
	let minX = Infinity;
	let minY = Infinity;
	for (const c of components) {
		minX = Math.min(minX, c.x - 2);
		minY = Math.min(minY, c.y - 2);
	}
	for (const w of wires) {
		for (const p of w.points) {
			minX = Math.min(minX, p.x);
			minY = Math.min(minY, p.y);
		}
	}
	const shiftX = minX < 4 ? 4 - minX : 0;
	const shiftY = minY < 4 ? 4 - minY : 0;
	if (shiftX > 0 || shiftY > 0) {
		for (const c of components) {
			c.x += shiftX;
			c.y += shiftY;
		}
		for (const w of wires) {
			for (const p of w.points) {
				p.x += shiftX;
				p.y += shiftY;
			}
		}
	}

	const visualDoc: CircuitDocument = {
		schemaVersion: 1,
		mode: ctx.mode,
		frequencyHz: ctx.frequencyHz,
		components,
		wires
	};
	if (ctx.netlist.id) visualDoc.id = ctx.netlist.id;
	if (ctx.netlist.name) visualDoc.name = ctx.netlist.name;
	if (ctx.acMagnitudeMode) visualDoc.acMagnitudeMode = ctx.acMagnitudeMode;
	if (ctx.netlist.unitSystem) visualDoc.unitSystem = ctx.netlist.unitSystem;
	if (ctx.netlist.unknownProblem) {
		visualDoc.unknownProblem = {
			...ctx.netlist.unknownProblem,
			...(ctx.netlist.unknownProblem.terms
				? { terms: ctx.netlist.unknownProblem.terms.map((t) => ({ ...t })) }
				: {}),
			constraint: { ...ctx.netlist.unknownProblem.constraint }
		};
	}

	// CRITICAL SAFETY GATE: Verify 100% electrical isomorphism via buildElectricalGraph!
	const isomorphism = verifyElectricalIsomorphism(
		visualDoc,
		twoTerminalElements,
		terminalElements
	);
	if (!isomorphism) {
		return null;
	}

	return { document: visualDoc, hadVisualCoords: true };
}

// ============================================================================
// Guaranteed-Isomorphic Ladder Auto-Layout (Fallback & Legacy Netlists)
// ============================================================================

function layoutLadderFromContext(ctx: NormalizedNetlistContext): CircuitDocument {
	const {
		netlist,
		mode,
		frequencyHz,
		acMagnitudeMode,
		twoTerminalElements,
		explicitGroundElements,
		terminalElements,
		nextUniqueId
	} = ctx;

	// 3. Collect all non-reference nodes and order them left-to-right via source-seeded BFS
	const encounterOrder: string[] = [];
	const nonRefSet = new Set<string>();
	const registerNode = (n: string) => {
		if (!n || n === '0' || nonRefSet.has(n)) return;
		nonRefSet.add(n);
		encounterOrder.push(n);
	};

	for (const el of twoTerminalElements) {
		registerNode(el.from);
		registerNode(el.to);
	}
	for (const el of terminalElements) {
		registerNode(el.from);
	}

	const adj = new Map<string, string[]>();
	for (const n of encounterOrder) adj.set(n, []);
	for (const el of twoTerminalElements) {
		if (el.from !== '0' && el.to !== '0' && el.from !== el.to) {
			adj.get(el.from)!.push(el.to);
			adj.get(el.to)!.push(el.from);
		}
	}

	// Seed BFS with source-connected non-ref nodes first (sources on the left)
	const seedNodes: string[] = [];
	const seedSet = new Set<string>();
	const addSeed = (n: string) => {
		if (n !== '0' && nonRefSet.has(n) && !seedSet.has(n)) {
			seedSet.add(n);
			seedNodes.push(n);
		}
	};

	for (const el of twoTerminalElements) {
		if (el.kind === 'voltage_source' && el.from !== '0') addSeed(el.from);
		if (el.kind === 'current_source' && el.to !== '0' && el.from === '0') addSeed(el.to);
	}
	for (const el of twoTerminalElements) {
		if (el.kind === 'voltage_source' || el.kind === 'current_source') {
			if (el.from !== '0') addSeed(el.from);
			if (el.to !== '0') addSeed(el.to);
		}
	}

	const orderedNodes: string[] = [];
	const visited = new Set<string>();
	const bfsFrom = (start: string) => {
		if (visited.has(start)) return;
		const queue = [start];
		visited.add(start);
		while (queue.length > 0) {
			const curr = queue.shift()!;
			orderedNodes.push(curr);
			for (const nxt of adj.get(curr) ?? []) {
				if (!visited.has(nxt)) {
					visited.add(nxt);
					queue.push(nxt);
				}
			}
		}
	};

	for (const s of seedNodes) bfsFrom(s);
	for (const n of encounterOrder) bfsFrom(n);

	const nodeToCol = new Map<string, number>();
	orderedNodes.forEach((n, idx) => nodeToCol.set(n, idx));

	// 4. Partition 2-terminal elements into shunts, horizontal branches, and self-shorts
	const shuntsByNode = new Map<number, NormalizedElement[]>();
	for (let i = 0; i < orderedNodes.length; i++) shuntsByNode.set(i, []);

	const horizontalEdges: Array<{ el: NormalizedElement; colLeft: number; colRight: number }> = [];
	const selfShortNonRef: Array<{ el: NormalizedElement; col: number }> = [];
	const selfShortGround: NormalizedElement[] = [];

	for (const el of twoTerminalElements) {
		if (el.from === el.to) {
			if (el.from === '0') {
				selfShortGround.push(el);
			} else {
				selfShortNonRef.push({ el, col: nodeToCol.get(el.from)! });
			}
			continue;
		}
		if (el.from === '0' || el.to === '0') {
			const nonRef = el.from === '0' ? el.to : el.from;
			const col = nodeToCol.get(nonRef)!;
			shuntsByNode.get(col)!.push(el);
			continue;
		}
		const cA = nodeToCol.get(el.from)!;
		const cB = nodeToCol.get(el.to)!;
		horizontalEdges.push({
			el,
			colLeft: Math.min(cA, cB),
			colRight: Math.max(cA, cB)
		});
	}

	// 5. Assign non-overlapping column X coordinates
	const colMainX: number[] = [];
	const colRightEdgeX: number[] = [];
	let cursorX = 4;
	for (let i = 0; i < orderedNodes.length; i++) {
		const shuntCount = shuntsByNode.get(i)!.length;
		const spanWidth = Math.max(0, shuntCount - 1) * 4;
		colMainX.push(cursorX);
		colRightEdgeX.push(cursorX + spanWidth);
		cursorX += spanWidth + 8;
	}

	// 6. Assign horizontal tracks (spanning arches on top, adjacent edges below)
	const spanningEdges = horizontalEdges
		.filter((e) => e.colRight - e.colLeft >= 2)
		.sort((a, b) => {
			const spanDiff = b.colRight - b.colLeft - (a.colRight - a.colLeft);
			if (spanDiff !== 0) return spanDiff;
			return a.colLeft - b.colLeft;
		});

	const adjacentEdges = horizontalEdges
		.filter((e) => e.colRight - e.colLeft === 1)
		.sort((a, b) => a.colLeft - b.colLeft);

	const spanningRows: Array<Array<{ el: NormalizedElement; colLeft: number; colRight: number }>> =
		[];
	for (const edge of spanningEdges) {
		let placed = false;
		for (const row of spanningRows) {
			const overlaps = row.some(
				(other) => !(edge.colRight < other.colLeft || edge.colLeft > other.colRight)
			);
			if (!overlaps) {
				row.push(edge);
				placed = true;
				break;
			}
		}
		if (!placed) {
			spanningRows.push([edge]);
		}
	}

	const adjRowsByPair = new Map<number, number>();
	const adjacentPlaced: Array<{
		el: NormalizedElement;
		colLeft: number;
		colRight: number;
		localRow: number;
	}> = [];
	let maxAdjRowCount = 0;
	for (const edge of adjacentEdges) {
		const localRow = adjRowsByPair.get(edge.colLeft) ?? 0;
		adjRowsByPair.set(edge.colLeft, localRow + 1);
		maxAdjRowCount = Math.max(maxAdjRowCount, localRow + 1);
		adjacentPlaced.push({ ...edge, localRow });
	}

	const TOP_Y = 4;
	const TRACK_STEP = 4;
	const spanningRowCount = spanningRows.length;
	const adjStartY = TOP_Y + spanningRowCount * TRACK_STEP;

	const horizontalPlacements: HorizontalPlacement[] = [];

	const computeHorizontalRotation = (el: NormalizedElement): Rotation => {
		const cFrom = nodeToCol.get(el.from)!;
		const cTo = nodeToCol.get(el.to)!;
		return cFrom < cTo ? 0 : 180;
	};

	spanningRows.forEach((row, rowIdx) => {
		const y = TOP_Y + rowIdx * TRACK_STEP;
		for (const edge of row) {
			const cx = colMainX[edge.colRight] - 4;
			horizontalPlacements.push({
				el: edge.el,
				colLeft: edge.colLeft,
				colRight: edge.colRight,
				row: rowIdx,
				y,
				cx,
				rotation: computeHorizontalRotation(edge.el)
			});
		}
	});

	for (const edge of adjacentPlaced) {
		const y = adjStartY + edge.localRow * TRACK_STEP;
		const cx = colMainX[edge.colRight] - 4;
		horizontalPlacements.push({
			el: edge.el,
			colLeft: edge.colLeft,
			colRight: edge.colRight,
			row: spanningRowCount + edge.localRow,
			y,
			cx,
			rotation: computeHorizontalRotation(edge.el)
		});
	}

	// Self-shorted non-ref components sit in a dedicated band below horizontal tracks
	const selfShortRowsByCol = new Map<number, number>();
	let maxSelfShortRows = 0;
	for (const item of selfShortNonRef) {
		const r = (selfShortRowsByCol.get(item.col) ?? 0) + 1;
		selfShortRowsByCol.set(item.col, r);
		maxSelfShortRows = Math.max(maxSelfShortRows, r);
	}

	const horizTotalRows = spanningRowCount + maxAdjRowCount;
	const selfShortStartY =
		horizTotalRows > 0 ? TOP_Y + horizTotalRows * TRACK_STEP : TOP_Y + 4;
	const shuntTopY =
		selfShortStartY + (maxSelfShortRows > 0 ? maxSelfShortRows * TRACK_STEP : 0);
	const shuntCenterY = shuntTopY + 2;
	const groundY = shuntTopY + 4;

	// 7. Build CircuitComponents and CircuitWires
	const components: CircuitComponent[] = [];
	const wires: CircuitWire[] = [];
	let wireCounter = 0;
	const addWire = (pts: Array<[number, number]>) => {
		if (pts.length === 2 && pts[0][0] === pts[1][0] && pts[0][1] === pts[1][1]) {
			return;
		}
		wireCounter++;
		wires.push(makeWire(`w${wireCounter}`, pts));
	};

	const nodeSpineYs = new Map<number, number[]>();
	for (let i = 0; i < orderedNodes.length; i++) nodeSpineYs.set(i, []);

	for (const hp of horizontalPlacements) {
		components.push(toComponent(hp.el, hp.cx, hp.y, hp.rotation));
		const xLeftBus = colMainX[hp.colLeft];
		const xRightBus = colMainX[hp.colRight];
		addWire([
			[xLeftBus, hp.y],
			[hp.cx - 2, hp.y]
		]);
		addWire([
			[hp.cx + 2, hp.y],
			[xRightBus, hp.y]
		]);
		nodeSpineYs.get(hp.colLeft)!.push(hp.y);
		nodeSpineYs.get(hp.colRight)!.push(hp.y);
	}

	const selfShortIdxByCol = new Map<number, number>();
	for (const item of selfShortNonRef) {
		const idx = selfShortIdxByCol.get(item.col) ?? 0;
		selfShortIdxByCol.set(item.col, idx + 1);
		const y = selfShortStartY + idx * TRACK_STEP;
		const xBus = colMainX[item.col];
		const cx = xBus + 4;
		components.push(toComponent(item.el, cx, y, 0));
		addWire([
			[xBus, y],
			[cx - 2, y]
		]);
		addWire([
			[cx + 2, y],
			[cx + 2, y + 2],
			[xBus, y + 2],
			[xBus, y]
		]);
		nodeSpineYs.get(item.col)!.push(y);
	}

	const groundPinXs: number[] = [];
	for (let col = 0; col < orderedNodes.length; col++) {
		const shunts = shuntsByNode.get(col)!;
		if (shunts.length === 0) continue;

		const baseX = colMainX[col];
		nodeSpineYs.get(col)!.push(shuntTopY);

		shunts.forEach((el, idx) => {
			const sx = baseX + idx * 4;
			const rot: Rotation = el.from !== '0' ? 90 : 270;
			components.push(toComponent(el, sx, shuntCenterY, rot));
			groundPinXs.push(sx);
		});

		if (shunts.length > 1) {
			addWire([
				[baseX, shuntTopY],
				[baseX + (shunts.length - 1) * 4, shuntTopY]
			]);
		}
	}

	for (const term of terminalElements) {
		if (term.from === '0') {
			const tx = groundPinXs[0] ?? 4;
			components.push(toComponent(term, tx, groundY, 0));
			groundPinXs.push(tx);
		} else {
			const col = nodeToCol.get(term.from)!;
			const ys = nodeSpineYs.get(col)!;
			const ty = ys.length > 0 ? ys[0] : shuntTopY;
			ys.push(ty);
			components.push(toComponent(term, colMainX[col], ty, 0));
		}
	}

	for (let col = 0; col < orderedNodes.length; col++) {
		const ys = nodeSpineYs.get(col)!;
		if (ys.length < 2) continue;
		const minY = Math.min(...ys);
		const maxY = Math.max(...ys);
		if (maxY > minY) {
			addWire([
				[colMainX[col], minY],
				[colMainX[col], maxY]
			]);
		}
	}

	if (selfShortGround.length > 0) {
		let gx = (groundPinXs.length > 0 ? Math.max(...groundPinXs) : 4) + 6;
		for (const el of selfShortGround) {
			components.push(toComponent(el, gx, groundY, 0));
			groundPinXs.push(gx - 2, gx + 2);
			gx += 8;
		}
	}

	const minGndX = groundPinXs.length > 0 ? Math.min(...groundPinXs) : 4;
	const maxGndX = groundPinXs.length > 0 ? Math.max(...groundPinXs) : 4;
	if (maxGndX > minGndX) {
		addWire([
			[minGndX, groundY],
			[maxGndX, groundY]
		]);
	}

	if (explicitGroundElements.length > 0) {
		const gnd = explicitGroundElements[0];
		components.push(toComponent(gnd, minGndX, groundY, 0));
	} else {
		const gndId = nextUniqueId('ground');
		components.push({
			id: gndId,
			kind: 'ground',
			label: 'GND',
			x: minGndX,
			y: groundY,
			rotation: 0,
			value: '0'
		});
	}

	const doc: CircuitDocument = {
		schemaVersion: 1,
		mode,
		frequencyHz,
		components,
		wires
	};
	if (netlist.id) doc.id = netlist.id;
	if (netlist.name) doc.name = netlist.name;
	if (acMagnitudeMode) doc.acMagnitudeMode = acMagnitudeMode;
	if (netlist.unitSystem) doc.unitSystem = netlist.unitSystem;
	if (netlist.unknownProblem) {
		doc.unknownProblem = {
			...netlist.unknownProblem,
			...(netlist.unknownProblem.terms
				? { terms: netlist.unknownProblem.terms.map((t) => ({ ...t })) }
				: {}),
			constraint: { ...netlist.unknownProblem.constraint }
		};
	}

	return doc;
}

/**
 * Guaranteed-isomorphic deterministic ladder layout for node-based netlists.
 */
export function layoutLadderNetlistToDocument(netlist: LayoutNetlistDocument): CircuitDocument {
	const ctx = normalizeNetlistContext(netlist);
	return layoutLadderFromContext(ctx);
}

function remapUnknownProblemNodes(
	doc: CircuitDocument,
	nodeIdMap: Record<string, string>
): void {
	if (!doc.unknownProblem) return;
	if (doc.unknownProblem.constraint.kind === 'node_voltage') {
		const rawTarget = doc.unknownProblem.constraint.targetId;
		const mapped = nodeIdMap[rawTarget];
		if (mapped) {
			doc.unknownProblem = {
				...doc.unknownProblem,
				constraint: {
					...doc.unknownProblem.constraint,
					targetId: mapped
				}
			};
		}
	}
}

/**
 * Computes a deterministic, non-overlapping orthogonal schematic layout for a node-based netlist,
 * preferring visual-grid cloning whenever valid `fromPos`/`toPos` coordinates are supplied and
 * verified 100% electrically isomorphic, and returning layout mode + diagnostics metadata.
 */
export function layoutNetlistWithMeta(netlist: LayoutNetlistDocument): LayoutNetlistResult {
	const ctx = normalizeNetlistContext(netlist);
	const warnings: string[] = [];

	const anyVisualCoords = ctx.twoTerminalElements.some((el) => el.fromPos || el.toPos);

	if (anyVisualCoords) {
		const visualAttempt = tryVisualGridLayout(ctx);
		if (visualAttempt) {
			const nodeIdMap = buildNodeIdMap(visualAttempt.document, ctx);
			remapUnknownProblemNodes(visualAttempt.document, nodeIdMap);
			return {
				document: visualAttempt.document,
				layoutMode: 'visual-grid',
				warnings,
				nodeIdMap
			};
		}
		warnings.push(
			'Visual grid coordinates had a topology conflict or were incomplete; automatically fell back to standard auto-layout to preserve exact electrical connectivity.'
		);
	}

	const ladderDoc = layoutLadderFromContext(ctx);
	const nodeIdMap = buildNodeIdMap(ladderDoc, ctx);
	remapUnknownProblemNodes(ladderDoc, nodeIdMap);
	return {
		document: ladderDoc,
		layoutMode: 'auto-layout',
		warnings,
		nodeIdMap
	};
}

/**
 * Computes a deterministic, non-overlapping orthogonal schematic layout for a node-based netlist.
 */
export function layoutNetlistToDocument(netlist: LayoutNetlistDocument): CircuitDocument {
	return layoutNetlistWithMeta(netlist).document;
}
