import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { render } from 'svelte/server';
import { PRESETS } from '$lib/data/presets';
import { FinalAnswersCard } from '$lib/components/results';
import { Complex, type CircuitComponent, type CircuitDocument, type CircuitWire } from '$lib/engine';
import { buildElectricalGraph } from '$lib/engine/graph';
import { circuit } from '$lib/stores/circuit.svelte';
import { settings } from '$lib/stores/settings.svelte';
import {
	AC_FREQUENCY_PRESETS,
	ComponentPalette,
	EngineeringInput,
	ImpedanceInput,
	MOUSE_DRAG_THRESHOLD_PX,
	PhasorInput,
	PropertyInspector,
	SchematicCanvas,
	TOUCH_DRAG_THRESHOLD_PX,
	TOUCH_WIRE_DRAG_THRESHOLD_PX,
	buildBridgeArcPath,
	buildWirePathWithBridges,
	computeDanglingWireEndpoints,
	computeJumpOverWirePoints,
	computeJunctionPoints,
	computeManhattanPoints,
	computePinchTransform,
	computeTouchPinHitRadiusWorld,
	computeWireCrossings,
	countBridgedCrossingsForWire,
	findNearestAnchor,
	formatComplexOverlay,
	formatComponentDisplayValue,
	getDragThresholdPx,
	hasExceededDragThreshold,
	isPointInComponentBodyHitbox,
	isTouchLikePointer
} from './index';
import {
	buildSchematicObstacles,
	chooseBranchPillPosition,
	rectsOverlap,
	type LayoutRect
} from './overlayLayout';

beforeEach(() => {
	circuit.resetToDefault();
	settings.reset();
});

afterEach(() => {
	circuit.resetToDefault();
	settings.reset();
});

describe('editor geometry & formatting helpers', () => {
	it('computes orthogonal Manhattan L-bends in H-then-V and V-then-H modes', () => {
		expect(computeManhattanPoints({ x: 2, y: 4 }, { x: 8, y: 10 }, 'hv')).toEqual([
			{ x: 2, y: 4 },
			{ x: 8, y: 4 },
			{ x: 8, y: 10 }
		]);
		expect(computeManhattanPoints({ x: 2, y: 4 }, { x: 8, y: 10 }, 'vh')).toEqual([
			{ x: 2, y: 4 },
			{ x: 2, y: 10 },
			{ x: 8, y: 10 }
		]);
		expect(computeManhattanPoints({ x: 2, y: 4 }, { x: 8, y: 4 }, 'hv')).toEqual([
			{ x: 2, y: 4 },
			{ x: 8, y: 4 }
		]);
	});

	it('detects automatic junction dots wherever 3+ segments or pins meet', () => {
		const doc = PRESETS[0].document;
		const junctions = computeJunctionPoints(doc.components, doc.wires);
		const keys = new Set(junctions.map((j) => `${j.x},${j.y}`));

		// In dc-divider preset: (12,4) T-junction, (12,10) R2+bottom wire, (4,10) V1+G1+bottom wire
		expect(keys.has('12,4')).toBe(true);
		expect(keys.has('12,10')).toBe(true);
		expect(keys.has('4,10')).toBe(true);

		// Corners and 2-connection pins must NOT produce junction dots
		expect(keys.has('4,4')).toBe(false);
		expect(keys.has('4,6')).toBe(false);
		expect(keys.has('18,4')).toBe(false);
	});

	it('detects unconnected pass-overs and 4-way connected crossings while ignoring T-junctions and pin intersections', () => {
		const components = [
			// Ground pin sits directly at (10, 4) where two wires cross -> must NOT be reported as crossing
			{ id: 'G1', kind: 'ground' as const, label: 'GND', x: 10, y: 4, rotation: 0 as const, value: '0' }
		];
		const wires = [
			// Unconnected crossing at (4, 4)
			{ id: 'w1', points: [{ x: 2, y: 4 }, { x: 6, y: 4 }] },
			{ id: 'w2', points: [{ x: 4, y: 2 }, { x: 4, y: 6 }] },
			// Connected 4-way crossing at (14, 4) (split horizontal + straight vertical)
			{ id: 'w3', points: [{ x: 12, y: 4 }, { x: 14, y: 4 }] },
			{ id: 'w4', points: [{ x: 14, y: 4 }, { x: 16, y: 4 }] },
			{ id: 'w5', points: [{ x: 14, y: 2 }, { x: 14, y: 6 }] },
			// 3-way T-junction at (20, 4) -> must NOT be reported as a crossing
			{ id: 'w6', points: [{ x: 18, y: 4 }, { x: 22, y: 4 }] },
			{ id: 'w7', points: [{ x: 20, y: 4 }, { x: 20, y: 6 }] },
			// Wires crossing on top of component pin (10, 4) -> must be excluded
			{ id: 'w8', points: [{ x: 8, y: 4 }, { x: 12, y: 4 }] },
			{ id: 'w9', points: [{ x: 10, y: 2 }, { x: 10, y: 6 }] }
		];

		const crossings = computeWireCrossings(components, wires);
		expect(crossings).toHaveLength(2);

		const unconnected = crossings.find((c) => c.x === 4 && c.y === 4);
		expect(unconnected).toBeDefined();
		expect(unconnected?.connected).toBe(false);
		expect(unconnected?.wireIds.sort()).toEqual(['w1', 'w2']);

		const connected = crossings.find((c) => c.x === 14 && c.y === 4);
		expect(connected).toBeDefined();
		expect(connected?.connected).toBe(true);
		expect(connected?.wireIds.sort()).toEqual(['w3', 'w4', 'w5']);

		// Unconnected crossing must NOT produce a junction dot; connected 4-way crossing MUST
		const junctionKeys = new Set(
			computeJunctionPoints(components, wires).map((pt) => `${pt.x},${pt.y}`)
		);
		expect(junctionKeys.has('4,4')).toBe(false);
		expect(junctionKeys.has('14,4')).toBe(true);
		expect(junctionKeys.has('20,4')).toBe(true);
	});

	it('builds SVG wire paths with upward semicircular IEEE bridge hops on horizontal segments only', () => {
		const crossings = new Set(['4,4', '5,4']);

		// Left-to-right horizontal segment hops over adjacent crossings (4,4) and (5,4) cleanly with sweep=1
		const ltr = buildWirePathWithBridges(
			[
				{ x: 2, y: 4 },
				{ x: 7, y: 4 }
			],
			crossings,
			20
		);
		expect(ltr).toBe(
			'M 40 80 L 73.5 80 A 6.5 6.5 0 0 1 86.5 80 L 93.5 80 A 6.5 6.5 0 0 1 106.5 80 L 140 80'
		);

		// Right-to-left horizontal segment hops upward with sweep=0 in reverse travel order
		const rtl = buildWirePathWithBridges(
			[
				{ x: 7, y: 4 },
				{ x: 2, y: 4 }
			],
			crossings,
			20
		);
		expect(rtl).toBe(
			'M 140 80 L 106.5 80 A 6.5 6.5 0 0 0 93.5 80 L 86.5 80 A 6.5 6.5 0 0 0 73.5 80 L 40 80'
		);

		// Vertical segment passing through the same crossing stays completely straight
		const vert = buildWirePathWithBridges(
			[
				{ x: 4, y: 2 },
				{ x: 4, y: 6 }
			],
			crossings,
			20
		);
		expect(vert).toBe('M 80 40 L 80 120');
		expect(vert).not.toContain('A ');

		// Standalone bridge halo/overpass arc helper
		expect(buildBridgeArcPath(4, 4, 20)).toBe('M 73.5 80 A 6.5 6.5 0 0 1 86.5 80');
	});

	it('findNearestAnchor snaps to wire endpoints and interior bends, prefers component pins on ties, and returns null outside maxDist', () => {
		const components: CircuitComponent[] = [
			// Horizontal resistor at (6, 4) -> pins at (4, 4) and (8, 4)
			{ id: 'R1', kind: 'resistor', label: 'R1', x: 6, y: 4, rotation: 0, value: '1k' }
		];
		const wires: CircuitWire[] = [
			// Wire touching pin (8, 4), bending at (12, 4), ending at (12, 8)
			{
				id: 'w1',
				points: [
					{ x: 8, y: 4 },
					{ x: 12, y: 4 },
					{ x: 12, y: 8 }
				]
			}
		];

		// Snaps to wire endpoint (12, 8)
		expect(findNearestAnchor(12.2, 7.8, components, wires, 0.6)).toEqual({
			x: 12,
			y: 8,
			kind: 'wire'
		});

		// Snaps to wire interior bend (12, 4)
		expect(findNearestAnchor(11.7, 4.1, components, wires, 0.6)).toEqual({
			x: 12,
			y: 4,
			kind: 'wire'
		});

		// Coincident pin and wire vertex at (8, 4): component pin wins tie
		expect(findNearestAnchor(8, 4, components, wires, 0.6)).toEqual({
			x: 8,
			y: 4,
			kind: 'pin'
		});

		// Equidistant between pin (8, 4) and wire bend (12, 4) at (10, 4) with large maxDist: pin wins tie
		expect(findNearestAnchor(10, 4, components, wires, 2.5)).toEqual({
			x: 8,
			y: 4,
			kind: 'pin'
		});

		// Outside maxDist returns null
		expect(findNearestAnchor(12.8, 8.8, components, wires, 0.6)).toBeNull();
		expect(findNearestAnchor(0, 0, components, wires, 0.6)).toBeNull();
	});

	it('computeDanglingWireEndpoints identifies open ends and excludes ends touching pins or other wires', () => {
		const components: CircuitComponent[] = [
			// Resistor at (4, 4) -> pins at (2, 4) and (6, 4)
			{ id: 'R1', kind: 'resistor', label: 'R1', x: 4, y: 4, rotation: 0, value: '1k' }
		];
		const wires: CircuitWire[] = [
			// w1: starts on R1 pin (6, 4), ends dangling at (10, 4)
			{ id: 'w1', points: [{ x: 6, y: 4 }, { x: 10, y: 4 }] },
			// w2: completely open on both ends (14, 2) and (14, 6)
			{ id: 'w2', points: [{ x: 14, y: 2 }, { x: 14, y: 6 }] },
			// w3: starts on w2 interior segment at (14, 4) [T-junction], ends dangling at (18, 4)
			{ id: 'w3', points: [{ x: 14, y: 4 }, { x: 18, y: 4 }] },
			// w4: starts at w1's dangling end? No, connects (14, 2) to (20, 2) -> (14, 2) is no longer dangling
			{ id: 'w4', points: [{ x: 14, y: 2 }, { x: 20, y: 2 }] }
		];

		const dangling = computeDanglingWireEndpoints(components, wires);
		const keys = new Set(dangling.map((d) => `${d.wireId}:${d.x},${d.y}`));

		expect(keys).toEqual(new Set(['w1:10,4', 'w2:14,6', 'w3:18,4', 'w4:20,2']));
		// Pin-connected end (6,4), T-junction end (14,4), and shared vertex (14,2) are excluded
		expect(dangling.some((d) => d.x === 6 && d.y === 4)).toBe(false);
		expect(dangling.some((d) => d.x === 14 && d.y === 4)).toBe(false);
		expect(dangling.some((d) => d.x === 14 && d.y === 2)).toBe(false);
	});

	it('computeJumpOverWirePoints avoids L-bend shorts, collinear overlaps, uses Z-detours, preserves explicit endpoints, and keeps nets electrically separate', () => {
		// 1. Avoids placing an L-bend corner on a foreign wire segment (chooses the other bend)
		const vertObstacle: CircuitWire[] = [
			{ id: 'w-obs', points: [{ x: 8, y: 2 }, { x: 8, y: 6 }] }
		];
		// Preferred 'hv' corner (8, 4) lies on w-obs -> must switch to 'vh' corner (4, 8)
		const bendAvoided = computeJumpOverWirePoints(
			{ x: 4, y: 4 },
			{ x: 8, y: 8 },
			'hv',
			[],
			vertObstacle
		);
		expect(bendAvoided).toEqual([
			{ x: 4, y: 4 },
			{ x: 4, y: 8 },
			{ x: 8, y: 8 }
		]);

		// 2. Avoids collinear overlap with a foreign wire segment
		const horizObstacle: CircuitWire[] = [
			{ id: 'w-h', points: [{ x: 4, y: 4 }, { x: 10, y: 4 }] }
		];
		// Starting at (2, 4) to (8, 8): preferred 'hv' runs collinearly along y=4 over [4, 8]; 'vh' is clean
		const overlapAvoided = computeJumpOverWirePoints(
			{ x: 2, y: 4 },
			{ x: 8, y: 8 },
			'hv',
			[],
			horizObstacle
		);
		expect(overlapAvoided).toEqual([
			{ x: 2, y: 4 },
			{ x: 2, y: 8 },
			{ x: 8, y: 8 }
		]);

		// 3. Uses a Z-path detour when both L-bends would short/overlap
		const bothCornersBlocked: CircuitWire[] = [
			// Blocks HV corner (10, 4)
			{ id: 'w-block-hv', points: [{ x: 10, y: 2 }, { x: 10, y: 6 }] },
			// Blocks VH corner (4, 10)
			{ id: 'w-block-vh', points: [{ x: 2, y: 10 }, { x: 6, y: 10 }] }
		];
		const zPath = computeJumpOverWirePoints(
			{ x: 4, y: 4 },
			{ x: 10, y: 10 },
			'hv',
			[],
			bothCornersBlocked
		);
		// Must produce a 4-vertex Z-path preserving start/end and avoiding both (10,4) and (4,10)
		expect(zPath).toHaveLength(4);
		expect(zPath[0]).toEqual({ x: 4, y: 4 });
		expect(zPath[zPath.length - 1]).toEqual({ x: 10, y: 10 });
		expect(zPath.some((p) => p.x === 10 && p.y === 4)).toBe(false);
		expect(zPath.some((p) => p.x === 4 && p.y === 10)).toBe(false);

		// 4. Preserves intentional start/end endpoints (e.g. starting on an open wire end, ending on a pin)
		const pinComp: CircuitComponent = {
			id: 'T1',
			kind: 'terminal',
			label: 'A',
			x: 12,
			y: 8,
			rotation: 0,
			value: ''
		};
		const existingWire: CircuitWire = {
			id: 'w-existing',
			points: [{ x: 2, y: 4 }, { x: 6, y: 4 }]
		};
		const intentional = computeJumpOverWirePoints(
			{ x: 6, y: 4 },
			{ x: 12, y: 8 },
			'hv',
			[pinComp],
			[existingWire]
		);
		expect(intentional[0]).toEqual({ x: 6, y: 4 });
		expect(intentional[intentional.length - 1]).toEqual({ x: 12, y: 8 });

		// 5. Electrical graph verification:
		//    - Routing across an existing wire using computeJumpOverWirePoints stays electrically separate
		//    - Starting on an open wire endpoint connects to the same electrical node
		const tExistingA: CircuitComponent = {
			id: 'TA',
			kind: 'terminal',
			label: 'A',
			x: 2,
			y: 6,
			rotation: 0,
			value: ''
		};
		const tExistingB: CircuitComponent = {
			id: 'TB',
			kind: 'terminal',
			label: 'B',
			x: 10,
			y: 6,
			rotation: 0,
			value: ''
		};
		const tCrossStart: CircuitComponent = {
			id: 'TC',
			kind: 'terminal',
			label: 'C',
			x: 6,
			y: 2,
			rotation: 0,
			value: ''
		};
		const tCrossEnd: CircuitComponent = {
			id: 'TD',
			kind: 'terminal',
			label: 'D',
			x: 8,
			y: 10,
			rotation: 0,
			value: ''
		};
		const baseWire: CircuitWire = {
			id: 'w-base',
			points: [{ x: 2, y: 6 }, { x: 10, y: 6 }]
		};
		const crossRoute = computeJumpOverWirePoints(
			{ x: 6, y: 2 },
			{ x: 8, y: 10 },
			'vh',
			[tExistingA, tExistingB, tCrossStart, tCrossEnd],
			[baseWire]
		);
		const separateDoc: CircuitDocument = {
			schemaVersion: 1,
			name: 'Jump-Over Isolation',
			mode: 'dc',
			frequencyHz: 60,
			components: [tExistingA, tExistingB, tCrossStart, tCrossEnd],
			wires: [baseWire, { id: 'w-cross', points: crossRoute }]
		};
		const separateGraph = buildElectricalGraph(separateDoc);
		expect(separateGraph.componentNodes.TA[0]).toBe(separateGraph.componentNodes.TB[0]);
		expect(separateGraph.componentNodes.TC[0]).toBe(separateGraph.componentNodes.TD[0]);
		expect(separateGraph.componentNodes.TC[0]).not.toBe(separateGraph.componentNodes.TA[0]);

		// Now start a wire explicitly on an open wire endpoint (10, 6) -> connects to the same electrical node
		const tOpenTarget: CircuitComponent = {
			id: 'TE',
			kind: 'terminal',
			label: 'E',
			x: 14,
			y: 10,
			rotation: 0,
			value: ''
		};
		const openWire: CircuitWire = {
			id: 'w-open',
			points: [{ x: 2, y: 6 }, { x: 10, y: 6 }]
		};
		const continueRoute = computeJumpOverWirePoints(
			{ x: 10, y: 6 },
			{ x: 14, y: 10 },
			'hv',
			[tExistingA, tOpenTarget],
			[openWire]
		);
		const connectedDoc: CircuitDocument = {
			schemaVersion: 1,
			name: 'Open Endpoint Continuation',
			mode: 'dc',
			frequencyHz: 60,
			components: [tExistingA, tOpenTarget],
			wires: [openWire, { id: 'w-cont', points: continueRoute }]
		};
		const connectedGraph = buildElectricalGraph(connectedDoc);
		expect(connectedGraph.componentNodes.TA[0]).toBe(connectedGraph.componentNodes.TE[0]);
	});

	it('countBridgedCrossingsForWire counts insulated bridge crossings created by a wire', () => {
		const wires: CircuitWire[] = [
			{ id: 'v1', points: [{ x: 4, y: 2 }, { x: 4, y: 8 }] },
			{ id: 'v2', points: [{ x: 8, y: 2 }, { x: 8, y: 8 }] },
			// Horizontal wire crossing both v1 and v2 strictly interior -> 2 bridged crossings
			{ id: 'h-bridge', points: [{ x: 2, y: 5 }, { x: 10, y: 5 }] },
			// Horizontal wire not crossing anything -> 0 bridged crossings
			{ id: 'h-clear', points: [{ x: 2, y: 10 }, { x: 10, y: 10 }] }
		];

		expect(countBridgedCrossingsForWire([], wires, 'h-bridge')).toBe(2);
		expect(countBridgedCrossingsForWire([], wires, 'v1')).toBe(1);
		expect(countBridgedCrossingsForWire([], wires, 'v2')).toBe(1);
		expect(countBridgedCrossingsForWire([], wires, 'h-clear')).toBe(0);

		// Connected 4-way crossing (explicit vertex at intersection) is NOT counted as a bridge
		const connectedWires: CircuitWire[] = [
			{ id: 'c1', points: [{ x: 2, y: 4 }, { x: 4, y: 4 }, { x: 6, y: 4 }] },
			{ id: 'c2', points: [{ x: 4, y: 2 }, { x: 4, y: 6 }] }
		];
		expect(countBridgedCrossingsForWire([], connectedWires, 'c1')).toBe(0);
	});

	it('formats component values and live V/I overlays cleanly', () => {
		const r1 = PRESETS[0].document.components.find((c) => c.id === 'R1')!;
		expect(formatComponentDisplayValue(r1, 'dc')).toBe('2 kΩ');

		expect(
			formatComplexOverlay(Complex.from(10 / 3, 0), 'V', 'dc', {
				precision: 3,
				angleDisplay: 'polar',
				showDcFractions: true
			})
		).toBe('10/3 V');

		expect(
			formatComplexOverlay(Complex.from(0.004, 0), 'A', 'dc', {
				precision: 3,
				angleDisplay: 'polar',
				showDcFractions: true
			})
		).toBe('4 mA');

		// Auto SI scaled exact fractions (4/3 mA and 2/3 mA)
		expect(
			formatComplexOverlay(Complex.from(0.004 / 3, 0), 'A', 'dc', {
				precision: 3,
				angleDisplay: 'polar',
				showDcFractions: true,
				unitSystem: 'auto'
			})
		).toBe('4/3 mA');
		expect(
			formatComplexOverlay(Complex.from(0.004 / 3, 0), 'A', 'dc', {
				precision: 3,
				angleDisplay: 'polar',
				showDcFractions: false,
				unitSystem: 'auto'
			})
		).toBe('1.33 mA');

		expect(
			formatComplexOverlay(Complex.from(0.002 / 3, 0), 'A', 'dc', {
				precision: 3,
				angleDisplay: 'polar',
				showDcFractions: true,
				unitSystem: 'auto'
			})
		).toBe('2/3 mA');
		expect(
			formatComplexOverlay(Complex.from(0.002 / 3, 0), 'A', 'dc', {
				precision: 3,
				angleDisplay: 'polar',
				showDcFractions: false,
				unitSystem: 'auto'
			})
		).toBe('667 µA');

		expect(
			formatComplexOverlay(Complex.fromPolar(120, -30), 'V', 'ac', {
				precision: 3,
				angleDisplay: 'polar',
				showDcFractions: true
			})
		).toBe('120∠-30° V');

		// Defined unit systems on component labels & overlays
		expect(formatComponentDisplayValue(r1, 'dc', 'ohm-v-a')).toBe('2000 Ω');
		expect(formatComponentDisplayValue(r1, 'dc', 'kohm-v-ma')).toBe('2 kΩ');
		expect(formatComponentDisplayValue(r1, 'dc', 'mohm-v-ua')).toBe('0.002 MΩ');

		expect(
			formatComplexOverlay(Complex.from(2 / 3000, 0), 'A', 'dc', {
				precision: 3,
				angleDisplay: 'polar',
				showDcFractions: true,
				unitSystem: 'kohm-v-ma'
			})
		).toBe('2/3 mA');

		expect(
			formatComplexOverlay(Complex.from(0.004, 0), 'A', 'dc', {
				precision: 3,
				angleDisplay: 'polar',
				showDcFractions: true,
				unitSystem: 'ohm-v-a'
			})
		).toBe('0.004 A');

		expect(
			formatComplexOverlay(Complex.fromPolar(0.015, 45), 'A', 'ac', {
				precision: 3,
				angleDisplay: 'polar',
				showDcFractions: true,
				unitSystem: 'kohm-v-ma'
			})
		).toBe('15∠45° mA');
	});

	it('computes pinch-to-zoom centered on midpoint without drift', () => {
		const startZoom = 1;
		const startPanX = 50;
		const startPanY = 40;
		const startMidX = 200;
		const startMidY = 160;
		const worldBeforeX = (startMidX - startPanX) / startZoom;
		const worldBeforeY = (startMidY - startPanY) / startZoom;

		const res = computePinchTransform({
			startZoom,
			startMidX,
			startMidY,
			startDist: 100,
			currMidX: startMidX,
			currMidY: startMidY,
			currDist: 180,
			startPanX,
			startPanY,
			minZoom: 0.3,
			maxZoom: 2.5
		});

		expect(res.zoom).toBeCloseTo(1.8, 6);
		// World point under the midpoint remains unchanged
		expect((startMidX - res.panX) / res.zoom).toBeCloseTo(worldBeforeX, 6);
		expect((startMidY - res.panY) / res.zoom).toBeCloseTo(worldBeforeY, 6);
	});

	it('clamps pinch zoom to minZoom and maxZoom cleanly', () => {
		const zoomedOut = computePinchTransform({
			startZoom: 0.8,
			startMidX: 150,
			startMidY: 120,
			startDist: 200,
			currMidX: 150,
			currMidY: 120,
			currDist: 20,
			startPanX: 30,
			startPanY: 20,
			minZoom: 0.3,
			maxZoom: 2.5
		});
		expect(zoomedOut.zoom).toBeCloseTo(0.3, 6);
		expect(Number.isFinite(zoomedOut.panX)).toBe(true);
		expect(Number.isFinite(zoomedOut.panY)).toBe(true);

		const zoomedIn = computePinchTransform({
			startZoom: 1.5,
			startMidX: 150,
			startMidY: 120,
			startDist: 80,
			currMidX: 150,
			currMidY: 120,
			currDist: 400,
			startPanX: 30,
			startPanY: 20,
			minZoom: 0.3,
			maxZoom: 2.5
		});
		expect(zoomedIn.zoom).toBeCloseTo(2.5, 6);
	});

	it('supports simultaneous two-finger midpoint pan with and without scale change', () => {
		const purePan = computePinchTransform({
			startZoom: 1.2,
			startMidX: 100,
			startMidY: 100,
			startDist: 120,
			currMidX: 145,
			currMidY: 70,
			currDist: 120,
			startPanX: 20,
			startPanY: 30,
			minZoom: 0.3,
			maxZoom: 2.5
		});
		expect(purePan.zoom).toBeCloseTo(1.2, 6);
		expect(purePan.panX).toBeCloseTo(65, 6);
		expect(purePan.panY).toBeCloseTo(0, 6);

		const panAndZoom = computePinchTransform({
			startZoom: 1,
			startMidX: 100,
			startMidY: 80,
			startDist: 100,
			currMidX: 130,
			currMidY: 110,
			currDist: 200,
			startPanX: 0,
			startPanY: 0,
			minZoom: 0.3,
			maxZoom: 2.5
		});
		expect(panAndZoom.zoom).toBeCloseTo(2, 6);
		// World (100, 80) maps to new midpoint (130, 110) at zoom 2 => pan = (130 - 200, 110 - 160)
		expect(panAndZoom.panX).toBeCloseTo(-70, 6);
		expect(panAndZoom.panY).toBeCloseTo(-50, 6);
	});

	it('guards against degenerate zero or tiny startDist without NaN or jumps', () => {
		const zeroDist = computePinchTransform({
			startZoom: 1,
			startMidX: 120,
			startMidY: 90,
			startDist: 0,
			currMidX: 135,
			currMidY: 100,
			currDist: 40,
			startPanX: 10,
			startPanY: 20,
			minZoom: 0.3,
			maxZoom: 2.5
		});
		expect(Number.isNaN(zeroDist.zoom)).toBe(false);
		expect(Number.isNaN(zeroDist.panX)).toBe(false);
		expect(Number.isNaN(zeroDist.panY)).toBe(false);
		expect(zeroDist.zoom).toBe(1);
		expect(zeroDist.panX).toBeCloseTo(25, 6);
		expect(zeroDist.panY).toBeCloseTo(30, 6);

		const tinyDist = computePinchTransform({
			startZoom: 1.25,
			startMidX: 100,
			startMidY: 100,
			startDist: 1e-6,
			currMidX: 100,
			currMidY: 100,
			currDist: 50,
			startPanX: 40,
			startPanY: -10,
			minZoom: 0.3,
			maxZoom: 2.5
		});
		expect(tinyDist.zoom).toBeCloseTo(1.25, 6);
		expect(tinyDist.panX).toBeCloseTo(40, 6);
		expect(tinyDist.panY).toBeCloseTo(-10, 6);
	});

	it('computes touch pin hit radius guaranteeing >= 24px screen radius across zoom levels', () => {
		expect(computeTouchPinHitRadiusWorld(0.4)).toBeCloseTo(60, 6);
		expect(computeTouchPinHitRadiusWorld(0.4) * 0.4).toBeGreaterThanOrEqual(24);

		expect(computeTouchPinHitRadiusWorld(1.0)).toBeCloseTo(24, 6);
		expect(computeTouchPinHitRadiusWorld(1.0) * 1.0).toBeGreaterThanOrEqual(24);

		expect(computeTouchPinHitRadiusWorld(2.0)).toBeCloseTo(12, 6);
		expect(computeTouchPinHitRadiusWorld(2.0) * 2.0).toBeGreaterThanOrEqual(24);

		// At high zoom, floor stays at 10 world units
		expect(computeTouchPinHitRadiusWorld(2.5)).toBe(10);
		expect(computeTouchPinHitRadiusWorld(2.5) * 2.5).toBeGreaterThanOrEqual(24);

		// Clamps degenerate low zoom at 0.2
		expect(computeTouchPinHitRadiusWorld(0.05)).toBeCloseTo(120, 6);
	});

	it('exposes standard lab AC frequency presets in ascending order', () => {
		expect(AC_FREQUENCY_PRESETS.map((p) => p.label)).toEqual([
			'50 Hz',
			'60 Hz',
			'1 kHz',
			'10 kHz'
		]);
		expect(AC_FREQUENCY_PRESETS.map((p) => p.hz)).toEqual([50, 60, 1000, 10000]);
	});

	it('classifies touch-like pointers and evaluates drag/wire movement thresholds accurately', () => {
		expect(isTouchLikePointer('touch')).toBe(true);
		expect(isTouchLikePointer('pen')).toBe(true);
		expect(isTouchLikePointer('mouse')).toBe(false);

		expect(getDragThresholdPx('touch')).toBe(TOUCH_DRAG_THRESHOLD_PX);
		expect(getDragThresholdPx('pen')).toBe(TOUCH_DRAG_THRESHOLD_PX);
		expect(getDragThresholdPx('mouse')).toBe(MOUSE_DRAG_THRESHOLD_PX);

		// Sub-threshold jitter must not trigger drag
		expect(hasExceededDragThreshold(100, 100, 104, 104, TOUCH_DRAG_THRESHOLD_PX)).toBe(false);
		expect(hasExceededDragThreshold(100, 100, 107, 100, TOUCH_DRAG_THRESHOLD_PX)).toBe(true);

		// Wire press-drag-release threshold separates tap-tap from press-drag-release
		expect(hasExceededDragThreshold(50, 50, 59, 59, TOUCH_WIRE_DRAG_THRESHOLD_PX)).toBe(false);
		expect(hasExceededDragThreshold(50, 50, 65, 50, TOUCH_WIRE_DRAG_THRESHOLD_PX)).toBe(true);
	});

	it('distinguishes component body hitboxes from open pan space beside pins', () => {
		const horizResistor = { kind: 'resistor' as const, x: 10, y: 6, rotation: 0 as const };
		// Inside 34x18px (1.7x0.9 grid) half-extents
		expect(isPointInComponentBodyHitbox(horizResistor, 10, 6)).toBe(true);
		expect(isPointInComponentBodyHitbox(horizResistor, 11.7, 6.9)).toBe(true);
		// Pin itself (x=12) and ~10px beside pin (x=12.5) are outside body hitbox
		expect(isPointInComponentBodyHitbox(horizResistor, 12.0, 6)).toBe(false);
		expect(isPointInComponentBodyHitbox(horizResistor, 12.5, 6)).toBe(false);
		expect(isPointInComponentBodyHitbox(horizResistor, 10, 7.1)).toBe(false);

		const vertResistor = { kind: 'resistor' as const, x: 10, y: 6, rotation: 90 as const };
		expect(isPointInComponentBodyHitbox(vertResistor, 10.9, 7.7)).toBe(true);
		expect(isPointInComponentBodyHitbox(vertResistor, 11.1, 6)).toBe(false);
		expect(isPointInComponentBodyHitbox(vertResistor, 10, 8.0)).toBe(false);

		const gnd = { kind: 'ground' as const, x: 4, y: 10, rotation: 0 as const };
		expect(isPointInComponentBodyHitbox(gnd, 4.9, 10.9)).toBe(true);
		expect(isPointInComponentBodyHitbox(gnd, 5.1, 10)).toBe(false);
		expect(isPointInComponentBodyHitbox(gnd, 4, 11.1)).toBe(false);

		const term = { kind: 'terminal' as const, x: 18, y: 4, rotation: 90 as const };
		expect(isPointInComponentBodyHitbox(term, 18.8, 4.8)).toBe(true);
		expect(isPointInComponentBodyHitbox(term, 18, 5.2)).toBe(false);
	});

	it('places branch current pills clear of horizontal wires passing over vertical top pins', () => {
		const verticalBranch = {
			id: 'R2',
			kind: 'resistor' as const,
			label: 'R2',
			x: 12,
			y: 8,
			rotation: 90 as const,
			value: '6k'
		};
		const wires = [
			// Horizontal wire passing directly over the vertical branch top pin (12, 6)
			{ id: 'w-top', points: [{ x: 4, y: 6 }, { x: 18, y: 6 }] },
			// Horizontal bottom rail passing over the bottom pin (12, 10)
			{ id: 'w-bot', points: [{ x: 4, y: 10 }, { x: 18, y: 10 }] }
		];

		const obstacles = buildSchematicObstacles(
			[verticalBranch],
			wires,
			(c) => formatComponentDisplayValue(c, 'dc')
		);
		const chosen = chooseBranchPillPosition(verticalBranch, 48, 16, obstacles, []);

		// Must not overlap any wire segment (including y=6 top pin wire) or component/label solid
		for (const wireRect of obstacles.wires) {
			expect(rectsOverlap(chosen.rect, wireRect, 2)).toBe(false);
		}
		for (const solidRect of obstacles.solid) {
			expect(rectsOverlap(chosen.rect, solidRect, 2)).toBe(false);
		}

		// Even when preferred bottom-right is occupied by another pill, it still avoids the y=6 wire
		const blockedRight = chooseBranchPillPosition(verticalBranch, 48, 16, obstacles, [
			chosen.rect
		]);
		for (const wireRect of obstacles.wires) {
			expect(rectsOverlap(blockedRight.rect, wireRect, 2)).toBe(false);
		}
		for (const solidRect of obstacles.solid) {
			expect(rectsOverlap(blockedRight.rect, solidRect, 2)).toBe(false);
		}
	});

	it('places all branch current pills cleanly without overlapping wires or component solids across presets', () => {
		for (const preset of PRESETS) {
			const doc = preset.document;
			const obstacles = buildSchematicObstacles(
				doc.components,
				doc.wires,
				(c) => formatComponentDisplayValue(c, doc.mode),
				preset.theveninLoadId ?? null
			);
			const placed: LayoutRect[] = [];
			for (const comp of doc.components) {
				if (comp.kind === 'ground' || comp.kind === 'terminal') continue;
				const chosen = chooseBranchPillPosition(comp, 48, 16, obstacles, placed);
				placed.push(chosen.rect);
				for (const wireRect of obstacles.wires) {
					expect(
						rectsOverlap(chosen.rect, wireRect, 2),
						`${preset.id} ${comp.id} pill overlaps wire`
					).toBe(false);
				}
				for (const solidRect of obstacles.solid) {
					expect(
						rectsOverlap(chosen.rect, solidRect, 2),
						`${preset.id} ${comp.id} pill overlaps solid`
					).toBe(false);
				}
			}
		}
	});

	it('formats direct AC impedance inductors and capacitors cleanly across AC, DC, and unit systems', () => {
		const cImp = {
			id: 'C1',
			kind: 'capacitor' as const,
			label: 'C1',
			x: 8,
			y: 4,
			rotation: 0 as const,
			value: '-j1',
			valueMode: 'impedance' as const,
			unit: 'Ω'
		};
		const lImp = {
			id: 'L1',
			kind: 'inductor' as const,
			label: 'L1',
			x: 24,
			y: 4,
			rotation: 0 as const,
			value: 'j2k',
			valueMode: 'impedance' as const,
			unit: 'Ω'
		};
		const lossyL = {
			id: 'L2',
			kind: 'inductor' as const,
			label: 'L2',
			x: 24,
			y: 8,
			rotation: 0 as const,
			value: '2+j1',
			valueMode: 'impedance' as const,
			unit: 'Ω'
		};

		expect(formatComponentDisplayValue(cImp, 'ac', 'auto')).toBe('-j1 Ω');
		expect(formatComponentDisplayValue(cImp, 'ac', 'ohm-v-a')).toBe('-j1 Ω');
		expect(formatComponentDisplayValue(cImp, 'dc', 'auto')).toBe('Open (DC)');
		expect(formatComponentDisplayValue(lImp, 'ac', 'auto')).toBe('j2 kΩ');
		expect(formatComponentDisplayValue(lImp, 'ac', 'ohm-v-a')).toBe('j2000 Ω');
		expect(formatComponentDisplayValue(lImp, 'dc', 'auto')).toBe('Short (DC)');
		expect(formatComponentDisplayValue(lossyL, 'ac', 'auto')).toBe('2 + j1 Ω');
	});
});

describe('editor Svelte components SSR rendering', () => {
	it('renders EngineeringInput with formatted SI readout and validation error states', () => {
		const validOut = render(EngineeringInput, {
			props: { value: '10k', unit: 'Ω' }
		});
		expect(validOut.body).toContain('= 10 kΩ');
		expect(validOut.body).not.toContain('aria-invalid="true"');

		const invalidOut = render(EngineeringInput, {
			props: { value: 'bad-val', unit: 'Ω', positiveOnly: true }
		});
		expect(invalidOut.body).toContain('aria-invalid="true"');
		expect(invalidOut.body).toContain('Invalid engineering value');

		const acOut = render(EngineeringInput, {
			props: { value: '120∠30°', unit: 'V', allowComplex: true }
		});
		expect(acOut.body).toContain('120∠30° V');
	});

	it('renders ComponentPalette with unified CircuitSymbol icons and shortcuts', () => {
		const out = render(ComponentPalette);
		expect(out.body).toContain('Component Palette');
		expect(out.body).toContain('Select / Move');
		expect(out.body).toContain('DC Voltage Source');
		expect(out.body).toContain('Orthogonal Wire');
		expect(out.body).toContain('data-symbol-kind="resistor"');
		expect(out.body).toContain('Rotate');
	});

	it('renders PropertyInspector for empty selection, component selection, and wire selection', () => {
		const emptyOut = render(PropertyInspector);
		expect(emptyOut.body).toContain('No Element Selected');
		expect(emptyOut.body).toContain('Simulation Parameters');

		circuit.selectComponent('R3');
		const compOut = render(PropertyInspector);
		expect(compOut.body).toContain('R3');
		expect(compOut.body).toContain('Clear Thévenin / Norton Target');

		circuit.selectWire('w1');
		const wireOut = render(PropertyInspector);
		expect(wireOut.body).toContain('Selected Wire');
		expect(wireOut.body).toContain('w1');
	});

	it('renders SchematicCanvas with live overlays, IEEE/IEC symbols, and empty state when cleared', () => {
		const populatedOut = render(SchematicCanvas);
		expect(populatedOut.body).toContain('data-component-id="R1"');
		expect(populatedOut.body).toContain('data-symbol-standard="ieee"');
		expect(populatedOut.body).toContain('Load (Thévenin)');
		expect(populatedOut.body).toContain('N1:');

		settings.schematicStandard = 'iec';
		const iecOut = render(SchematicCanvas);
		expect(iecOut.body).toContain('data-symbol-standard="iec"');

		// Clearing canvas immediately suppresses the onboarding overlay so drafting is unblocked
		circuit.clearCircuit();
		expect(circuit.emptyBannerDismissed).toBe(true);
		const clearedOut = render(SchematicCanvas);
		expect(clearedOut.body).not.toContain('Place a component or load a preset to begin');

		// When empty and not dismissed in select mode, onboarding prompt renders with dismiss control
		circuit.resetEmptyBanner();
		const emptyOut = render(SchematicCanvas);
		expect(emptyOut.body).toContain('Place a component or load a preset to begin');
		expect(emptyOut.body).toContain('aria-label="Dismiss empty canvas prompt"');

		// Arming any placement/wire tool immediately hides the empty banner so it never blocks drafting
		circuit.setActiveTool('resistor');
		const armedEmptyOut = render(SchematicCanvas);
		expect(armedEmptyOut.body).not.toContain('Place a component or load a preset to begin');
	});

	it('renders mobile quick element action bar and active placement mode pill cleanly', () => {
		circuit.selectComponent('R1');
		const selectedOut = render(SchematicCanvas);
		expect(selectedOut.body).toContain('Selected element actions');
		expect(selectedOut.body).toContain('Rotate component 90 degrees');
		expect(selectedOut.body).toContain('Open component palette');

		circuit.setActiveTool('resistor');
		const placingOut = render(SchematicCanvas);
		expect(placingOut.body).toContain('Active tool controls');
		expect(placingOut.body).toContain('Rotate 90°');
		expect(placingOut.body).toContain('Done');

		// 1-tap mobile Wire tool toggle reflects active state cleanly
		expect(placingOut.body).toContain('aria-label="Wire tool"');
		expect(placingOut.body).toContain('aria-pressed="false"');

		circuit.setActiveTool('wire');
		const wiringOut = render(SchematicCanvas);
		expect(wiringOut.body).toContain('aria-label="Wire tool"');
		expect(wiringOut.body).toContain('aria-pressed="true"');
		expect(wiringOut.body).toContain('Orthogonal Wire');
		// Expanded 24px touch pin hit circle is active in wire and probe modes
		expect(wiringOut.body).toContain('r="24" fill="transparent"');

		circuit.setActiveTool('probe');
		const probeOut = render(SchematicCanvas);
		expect(probeOut.body).toContain('r="24" fill="transparent"');

		// Tight 8px pin hit circle in select mode so open space beside pins pans cleanly
		circuit.setActiveTool('select');
		const selectOut = render(SchematicCanvas);
		expect(selectOut.body).toContain('r="8" fill="transparent"');
		expect(selectOut.body).not.toContain('r="24" fill="transparent"');
	});

	it('renders desktop Auto-Wire feedback in place of secondary telemetry without losing solver status', () => {
		const idleOut = render(SchematicCanvas);
		expect(idleOut.body).toContain('Grid 20px');
		expect(idleOut.body).toContain('Nodes');
		expect(idleOut.body).toContain('All methods verified');

		const feedbackOut = render(SchematicCanvas, {
			props: { autoWireFeedback: 'Auto-wired (+5 wires)' }
		});
		expect(feedbackOut.body).toContain('All methods verified');
		expect(feedbackOut.body).toContain('Auto-wired (+5 wires)');
		expect(feedbackOut.body).not.toContain('Grid 20px');
	});

	it('renders bridge hops, interactive crossing hit targets, and inspector/mobile crossing toggles', () => {
		circuit.clearCircuit();
		const wH = circuit.addWire([
			{ x: 2, y: 4 },
			{ x: 8, y: 4 }
		])!;
		circuit.addWire([
			{ x: 5, y: 2 },
			{ x: 5, y: 6 }
		]);
		circuit.selectWire(wH.id);

		const bridgeCanvas = render(SchematicCanvas);
		expect(bridgeCanvas.body).toContain('A 6.5 6.5 0 0 1');
		expect(bridgeCanvas.body).toContain('data-wire-crossing="5,4"');
		expect(bridgeCanvas.body).toContain('data-crossing-connected="false"');
		expect(bridgeCanvas.body).toContain('Connect wire crossing into junction');

		const bridgeInspector = render(PropertyInspector);
		expect(bridgeInspector.body).toContain('Wire Crossings');
		expect(bridgeInspector.body).toContain('Unconnected (Bridge)');
		expect(bridgeInspector.body).toContain('Connect (Junction)');

		expect(circuit.toggleWireCrossing(5, 4)).toBe('connected');

		const connectedCanvas = render(SchematicCanvas);
		expect(connectedCanvas.body).toContain('data-wire-crossing="5,4"');
		expect(connectedCanvas.body).toContain('data-crossing-connected="true"');
		expect(connectedCanvas.body).toContain('r="3.8"');
		expect(connectedCanvas.body).toContain('Disconnect wire crossing into bridge');
		expect(connectedCanvas.body).not.toContain('A 6.5 6.5');

		const connectedInspector = render(PropertyInspector);
		expect(connectedInspector.body).toContain('Connected (Junction)');
		expect(connectedInspector.body).toContain('Disconnect (Bridge)');
	});

	it('renders PhasorInput in Polar and a+jb modes without ∠ or ° inside input values', () => {
		const polarOut = render(PhasorInput, {
			props: {
				value: '120∠30°',
				unit: 'V',
				label: 'AC Phasor',
				idPrefix: 'test-phasor',
				onCommit: () => {}
			}
		});
		expect(polarOut.body).toContain('id="test-phasor-mag"');
		expect(polarOut.body).toContain('value="120"');
		expect(polarOut.body).toContain('id="test-phasor-phase"');
		expect(polarOut.body).toContain('value="30"');
		expect(polarOut.body).toContain('inputmode="decimal"');
		expect(polarOut.body).toContain('= 120∠30° V (104 + j60 V)');
		// Magnitude/Phase inputs must never embed Unicode ∠ or ° inside their value attributes
		expect(polarOut.body).not.toContain('value="120∠30°"');

		// Rectangular incoming value auto-initializes to a + jb mode
		const rectOut = render(PhasorInput, {
			props: {
				value: '30+j40',
				unit: 'V',
				label: 'AC Phasor',
				idPrefix: 'rect-phasor',
				onCommit: () => {}
			}
		});
		expect(rectOut.body).toContain('id="rect-phasor-re"');
		expect(rectOut.body).toContain('value="30"');
		expect(rectOut.body).toContain('id="rect-phasor-im"');
		expect(rectOut.body).toContain('value="40"');
		expect(rectOut.body).toContain('+ j');
		expect(rectOut.body).toContain('= 30 + j40 V (50∠53.1° V)');

		// Micro values use plain ASCII 'u' inside editable input fields
		const microOut = render(PhasorInput, {
			props: {
				value: '4.7u∠-45°',
				unit: 'A',
				idPrefix: 'micro-phasor',
				onCommit: () => {}
			}
		});
		expect(microOut.body).toContain('value="4.7u"');
		expect(microOut.body).toContain('value="-45"');
	});

	it('renders PropertyInspector with PhasorInput for AC sources/constraints and Pure jX / R+jX for reactive impedances', () => {
		const acPreset = PRESETS.find((p) => p.document.mode === 'ac');
		expect(acPreset).toBeDefined();
		circuit.loadDocument(acPreset!.document);

		// AC voltage source uses PhasorInput without separate AC Phase (°) input
		const acSource = circuit.document.components.find((c) => c.kind === 'voltage_source')!;
		circuit.selectComponent(acSource.id);
		const acSourceOut = render(PropertyInspector);
		expect(acSourceOut.body).toContain('id="comp-phasor-mag"');
		expect(acSourceOut.body).toContain('id="comp-phasor-phase"');
		expect(acSourceOut.body).toContain('Polar');
		expect(acSourceOut.body).toContain('a + jb');
		expect(acSourceOut.body).not.toContain('id="comp-phase"');

		// AC unknown target constraint uses PhasorInput for voltage/current targets
		circuit.setUnknownProblem({
			componentId: acSource.id,
			symbol: 'Vs',
			terms: [{ componentId: acSource.id, multiplier: 1 }],
			constraint: {
				kind: 'node_voltage',
				targetId: circuit.graph.nonRefNodeIds[0] ?? 'N1',
				value: '50<-30'
			}
		});
		const acUnknownOut = render(PropertyInspector);
		expect(acUnknownOut.body).toContain('id="unknown-target-phasor-mag"');
		expect(acUnknownOut.body).toContain('id="unknown-target-phasor-phase"');
		expect(acUnknownOut.body).toContain('value="50"');
		expect(acUnknownOut.body).toContain('value="-30"');
		circuit.clearUnknownProblem();

		// Direct-impedance inductor renders Pure jX with +j prefix pill and plain magnitude input
		const ind = circuit.addComponent('inductor', 10, 10);
		circuit.updateComponent(ind.id, { valueMode: 'impedance', unit: 'Ω', value: 'j50' });
		circuit.selectComponent(ind.id);
		const pureIndOut = render(PropertyInspector);
		expect(pureIndOut.body).toContain('Pure jX');
		expect(pureIndOut.body).toContain('R + jX');
		expect(pureIndOut.body).toContain('+j');
		expect(pureIndOut.body).toContain('id="comp-impedance-pure"');
		expect(pureIndOut.body).toContain('value="50"');
		expect(pureIndOut.body).toContain('= j50 Ω');
		expect(pureIndOut.body).not.toContain('value="j50"');

		// Direct-impedance capacitor renders Pure jX with −j prefix pill and plain magnitude input
		const cap = circuit.addComponent('capacitor', 14, 10);
		circuit.updateComponent(cap.id, { valueMode: 'impedance', unit: 'Ω', value: '-j20' });
		circuit.selectComponent(cap.id);
		const pureCapOut = render(PropertyInspector);
		expect(pureCapOut.body).toContain('−j');
		expect(pureCapOut.body).toContain('id="comp-impedance-pure"');
		expect(pureCapOut.body).toContain('value="20"');
		expect(pureCapOut.body).toContain('= -j20 Ω');

		// Lossy inductor impedance auto-selects R + jX split inputs
		circuit.updateComponent(ind.id, { valueMode: 'impedance', unit: 'Ω', value: '2+j1' });
		circuit.selectComponent(ind.id);
		const lossyIndOut = render(PropertyInspector);
		expect(lossyIndOut.body).toContain('id="comp-impedance-r"');
		expect(lossyIndOut.body).toContain('value="2"');
		expect(lossyIndOut.body).toContain('id="comp-impedance-x"');
		expect(lossyIndOut.body).toContain('value="1"');
		expect(lossyIndOut.body).toContain('= 2 + j1 Ω');

		// Standalone ImpedanceInput smoke check for DC mode caption
		const dcCapOut = render(ImpedanceInput, {
			props: { kind: 'capacitor', value: '-j1', isAcMode: false, onCommit: () => {} }
		});
		expect(dcCapOut.body).toContain('DC steady state: open circuit (I = 0 A)');
	});

	it('renders ideal Voltmeter VM1 in SchematicCanvas, PropertyInspector, and FinalAnswersCard with live differential voltage and Flip Polarity', () => {
		circuit.loadPreset('dc-divider');
		const vm = circuit.addComponent('voltmeter', 8, 0, { rotation: 0 });
		expect(vm.label).toBe('VM1');

		// Initially unconnected -> shows Open in canvas and inspector, and hides Value/Unknown/Thévenin controls
		circuit.selectComponent(vm.id);
		const openInspector = render(PropertyInspector);
		expect(openInspector.body).toContain('VM1');
		expect(openInspector.body).toContain('Voltmeter');
		expect(openInspector.body).toContain('Open');
		expect(openInspector.body).toContain('Flip Polarity');
		expect(openInspector.body).not.toContain('id="comp-value"');
		expect(openInspector.body).not.toContain('id="comp-unknown-toggle"');
		expect(openInspector.body).not.toContain('Analyze Thévenin / Norton Across Element');

		// Wire VM1 across R1: +:(6,0)->(4,4)[N1=12V], -:(10,0)->(12,4)[N2=8V] => reads +4 V
		circuit.addWire([
			{ x: 6, y: 0 },
			{ x: 4, y: 0 },
			{ x: 4, y: 4 }
		]);
		circuit.addWire([
			{ x: 10, y: 0 },
			{ x: 12, y: 0 },
			{ x: 12, y: 4 }
		]);

		expect(circuit.solution.mna.valid).toBe(true);
		expect(circuit.solution.mna.branches[vm.id]?.voltage.re).toBeCloseTo(4, 9);

		const canvasOut = render(SchematicCanvas);
		expect(canvasOut.body).toContain('data-symbol-kind="voltmeter"');
		expect(canvasOut.body).toContain('VM1');
		expect(canvasOut.body).toContain('4 V');

		const inspectorOut = render(PropertyInspector);
		expect(inspectorOut.body).toContain('Measured Voltage');
		expect(inspectorOut.body).toContain('4 V');
		expect(inspectorOut.body).toContain('Flip Polarity');

		const resultsOut = render(FinalAnswersCard, {
			props: {
				solution: circuit.solution,
				document: circuit.document,
				selectedComponentId: vm.id
			}
		});
		expect(resultsOut.body).toContain('Voltmeter Readings');
		expect(resultsOut.body).toContain('VM1');
		expect(resultsOut.body).toContain('4 V');

		// Flip Polarity (±) rotates 180° in 1 undoable step, inverting reading to -4 V
		circuit.flipComponentPolarity(vm.id);
		expect(circuit.selectedComponent?.rotation).toBe(180);
		expect(circuit.solution.mna.branches[vm.id]?.voltage.re).toBeCloseTo(-4, 9);

		// setTheveninComponent ignores voltmeters
		circuit.clearTheveninTarget();
		circuit.setTheveninComponent(vm.id);
		expect(circuit.theveninTarget).toBeUndefined();
	});

	it('formats dependent source display values as textbook formulas and shows Set control when unconfigured', () => {
		const r1: CircuitComponent = {
			id: 'R1',
			kind: 'resistor',
			label: 'R1',
			x: 8,
			y: 4,
			rotation: 0,
			value: '4k'
		};

		const vcvsVar: CircuitComponent = {
			id: 'E1',
			kind: 'vcvs',
			label: 'E1',
			x: 16,
			y: 8,
			rotation: 90,
			value: '2',
			unit: 'V/V',
			controlRef: { controlComponentId: 'R1', controlPolarity: 1, controlVarName: 'v_x' }
		};
		expect(formatComponentDisplayValue(vcvsVar, 'dc', 'auto', [r1, vcvsVar])).toBe('2·vₓ');

		const vcvsNegComp: CircuitComponent = {
			...vcvsVar,
			controlRef: { controlComponentId: 'R1', controlPolarity: -1 }
		};
		expect(formatComponentDisplayValue(vcvsNegComp, 'dc', 'auto', [r1, vcvsNegComp])).toBe(
			'−2·v(R1)'
		);

		const vccsNodes: CircuitComponent = {
			id: 'G1',
			kind: 'vccs',
			label: 'G1',
			x: 16,
			y: 8,
			rotation: 90,
			value: '1m',
			unit: 'S',
			controlRef: { controlNodePos: 'N1', controlNodeNeg: '0', controlPolarity: 1 }
		};
		expect(formatComponentDisplayValue(vccsNodes, 'dc', 'auto', [r1, vccsNodes])).toBe(
			'1m·v(N1,0)'
		);

		const ccvsBranch: CircuitComponent = {
			id: 'H1',
			kind: 'ccvs',
			label: 'H1',
			x: 16,
			y: 8,
			rotation: 90,
			value: '1k',
			unit: 'Ω',
			controlRef: { controlBranchComponentId: 'R1', controlPolarity: 1 }
		};
		expect(formatComponentDisplayValue(ccvsBranch, 'dc', 'auto', [r1, ccvsBranch])).toBe(
			'1k·i(R1)'
		);

		const cccsVar: CircuitComponent = {
			id: 'F1',
			kind: 'cccs',
			label: 'F1',
			x: 16,
			y: 8,
			rotation: 90,
			value: '2',
			unit: 'A/A',
			controlRef: { controlBranchComponentId: 'R1', controlPolarity: 1, controlVarName: 'i_x' }
		};
		expect(formatComponentDisplayValue(cccsVar, 'dc', 'auto', [r1, cccsVar])).toBe('2·iₓ');

		const unsetVcvs: CircuitComponent = {
			id: 'E2',
			kind: 'vcvs',
			label: 'E2',
			x: 16,
			y: 8,
			rotation: 90,
			value: '2',
			unit: 'V/V',
			controlRef: { controlPolarity: 1, controlVarName: 'v_x' }
		};
		expect(formatComponentDisplayValue(unsetVcvs, 'dc', 'auto', [r1, unsetVcvs])).toBe(
			'Set control'
		);
	});

	it('renders dependent sources across ComponentPalette, SchematicCanvas, PropertyInspector, and FinalAnswersCard and supports undoable updateComponentControlRef', () => {
		const paletteRail = render(ComponentPalette, { props: { variant: 'rail' } });
		expect(paletteRail.body).toContain('Dependent Sources');
		expect(paletteRail.body).toContain('VCVS (V → V)');
		expect(paletteRail.body).toContain('CCCS (I → I)');
		expect(paletteRail.body).toContain('Voltage-Controlled Voltage Source');

		const paletteSheet = render(ComponentPalette, { props: { variant: 'sheet' } });
		expect(paletteSheet.body).toContain('Dependent Sources');
		expect(paletteSheet.body).toContain('min-h-11');

		circuit.loadPreset('dc-dependent-vcvs');
		expect(circuit.solution.mna.valid).toBe(true);

		circuit.selectComponent('E1');

		const canvasOut = render(SchematicCanvas);
		expect(canvasOut.body).toContain('data-symbol-kind="vcvs"');
		expect(canvasOut.body).toContain('2·vₓ');
		expect(canvasOut.body).toContain('data-control-highlight="R1"');

		const inspectorOut = render(PropertyInspector);
		expect(inspectorOut.body).toContain('Voltage-Controlled Voltage Source (VCVS)');
		expect(inspectorOut.body).toContain('Control Reference');
		expect(inspectorOut.body).toContain('Across Component');
		expect(inspectorOut.body).toContain('Between Nodes');
		expect(inspectorOut.body).toContain('Control Polarity');
		expect(inspectorOut.body).toContain('Live Readout');
		expect(inspectorOut.body).toContain('Flip Polarity');
		expect(inspectorOut.body).not.toContain('id="comp-unknown-toggle"');

		const resultsOut = render(FinalAnswersCard, {
			props: {
				solution: circuit.solution,
				document: circuit.document,
				selectedComponentId: 'E1'
			}
		});
		expect(resultsOut.body).toContain('E1');
		expect(resultsOut.body).toContain('12 V');

		// Switch E1 from component control to node control and verify mutual exclusivity + undo
		circuit.updateComponentControlRef('E1', { controlNodePos: 'N1', controlNodeNeg: 'N2' });
		expect(circuit.selectedComponent?.controlRef?.controlComponentId).toBeUndefined();
		expect(circuit.selectedComponent?.controlRef?.controlNodePos).toBe('N1');
		expect(circuit.selectedComponent?.controlRef?.controlNodeNeg).toBe('N2');

		const nodeHighlightCanvas = render(SchematicCanvas);
		expect(nodeHighlightCanvas.body).toContain('data-control-nodes-highlight="true"');
		const nodeOverlayIdx = nodeHighlightCanvas.body.indexOf('N2: 10 V');
		const controlHighlightIdx = nodeHighlightCanvas.body.indexOf(
			'data-control-nodes-highlight="true"'
		);
		expect(nodeOverlayIdx).toBeGreaterThan(-1);
		expect(controlHighlightIdx).toBeGreaterThan(nodeOverlayIdx);

		expect(circuit.undo()).toBe(true);
		expect(circuit.selectedComponent?.controlRef?.controlComponentId).toBe('R1');
		expect(circuit.selectedComponent?.controlRef?.controlNodePos).toBeUndefined();

		// Adding a fresh dependent source initializes default controlRef
		const addedCccs = circuit.addComponent('cccs', 14, 14);
		expect(addedCccs.controlRef).toEqual({ controlPolarity: 1, controlVarName: 'i_x' });
	});
});
