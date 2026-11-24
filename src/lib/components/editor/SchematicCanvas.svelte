<script lang="ts">
	import { tick } from 'svelte';
	import {
		BookOpen,
		Cable,
		Check,
		CornerDownRight,
		Eraser,
		FileCode2,
		Link2,
		Minus,
		Plus,
		Redo2,
		RotateCw,
		Scan,
		SlidersHorizontal,
		Sparkles,
		Target,
		Trash2,
		Undo2,
		Unlink,
		Waypoints,
		X
	} from 'lucide-svelte';
	import { CircuitSymbol, GRID_SIZE, PALETTE_ITEMS } from '$lib/components/symbols';
	import { Button, Input, Separator, Tooltip } from '$lib/components/ui';
	import {
		Complex,
		formatUnknownTermExpr,
		getDefaultUnknownSymbol,
		getPinPositions,
		getUnknownTerms,
		isDependentSourceKind,
		isVoltageControlledSource,
		type CircuitComponent,
		type CircuitWire,
		type ComponentKind,
		type GridPoint
	} from '$lib/engine';
	import { AC_ENABLED } from '$lib/env';
	import { circuit, type EditorTool } from '$lib/stores/circuit.svelte';
	import { settings } from '$lib/stores/settings.svelte';
	import { cn } from '$lib/utils';
	import {
		TOUCH_WIRE_DRAG_THRESHOLD_PX,
		buildBridgeArcPath,
		buildWirePathWithBridges,
		computeJunctionPoints,
		computeDanglingWireEndpoints,
		computeJumpOverWirePoints,
		computePinchTransform,
		computeTouchPinHitRadiusWorld,
		computeWireCrossings,
		countBridgedCrossingsForWire,
		findNearestAnchor,
		formatComplexOverlay,
		formatComponentDisplayValue,
		formatControlVarDisplay,
		getDragThresholdPx,
		hasExceededDragThreshold,
		isPointInComponentBodyHitbox,
		isTouchLikePointer,
		type WireBendMode,
		type WireCrossing
	} from './helpers';
	import {
		buildSchematicObstacles,
		chooseBranchPillPosition,
		chooseNodePillPosition,
		type LayoutRect
	} from './overlayLayout';

	interface Props {
		onOpenPresets?: () => void;
		onOpenImport?: () => void;
		onOpenAiImport?: () => void;
		onComponentInspect?: (id: string) => void;
		onOpenPalette?: () => void;
		onMobileInspect?: (id?: string) => void;
		onAutoWire?: () => void;
		autoWireFeedback?: string | null;
		class?: string;
	}

	let {
		onOpenPresets,
		onOpenImport,
		onOpenAiImport,
		onComponentInspect,
		onOpenPalette,
		onMobileInspect,
		onAutoWire,
		autoWireFeedback = null,
		class: className
	}: Props = $props();

	let localAutoWireFeedback = $state<string | null>(null);
	let localAutoWireTimer: ReturnType<typeof setTimeout> | undefined;
	let localCrossingFeedback = $state<string | null>(null);
	let localCrossingTimer: ReturnType<typeof setTimeout> | undefined;
	const effectiveAutoWireFeedback = $derived(
		localCrossingFeedback ?? autoWireFeedback ?? localAutoWireFeedback
	);

	function showCrossingFeedback(message: string, durationMs = 2500): void {
		localCrossingFeedback = message;
		if (localCrossingTimer !== undefined) {
			clearTimeout(localCrossingTimer);
		}
		localCrossingTimer = setTimeout(() => {
			localCrossingFeedback = null;
		}, durationMs);
	}

	function handleCrossingToggle(x: number, y: number): void {
		const res = circuit.toggleWireCrossing(x, y);
		if (res === 'connected') {
			showCrossingFeedback('Crossing connected (junction added)');
		} else if (res === 'disconnected') {
			showCrossingFeedback('Crossing disconnected (bridge over)');
		}
	}

	function triggerAutoWire(): void {
		if (onAutoWire) {
			onAutoWire();
			return;
		}
		const res = circuit.autoWireCircuit();
		if (res.addedWires > 0) {
			localAutoWireFeedback = `Auto-wired (+${res.addedWires} ${res.addedWires === 1 ? 'wire' : 'wires'})`;
		} else if (res.reason === 'already_connected') {
			localAutoWireFeedback = 'All pins connected';
		} else if (res.reason === 'too_few_components') {
			localAutoWireFeedback = 'Place at least 2 components';
		} else {
			localAutoWireFeedback = 'No valid connections found';
		}
		if (localAutoWireTimer !== undefined) {
			clearTimeout(localAutoWireTimer);
		}
		localAutoWireTimer = setTimeout(() => {
			localAutoWireFeedback = null;
		}, 2500);
	}

	let containerEl = $state<HTMLDivElement | undefined>(undefined);
	let svgEl = $state<SVGSVGElement | undefined>(undefined);
	let viewportW = $state(0);
	let viewportH = $state(0);

	let zoom = $state(1);
	let settledZoom = $state(1);
	let pan = $state({ x: 80, y: 60 });
	let needsFit = $state(true);
	let lastDocumentLoadSeq = $state(circuit.documentLoadSeq);

	// Interaction states
	let hoverGrid = $state<GridPoint | null>(null);
	let hoverSnappedPin = $state<GridPoint | null>(null);
	let hoveredNodeId = $state<string | null>(null);
	let hoveredCrossingKey = $state<string | null>(null);
	// Pinned probe is stored as a component pin: node IDs are renumbered when the layout changes.
	let pinnedProbeAnchor = $state<{ componentId: string; pinIndex: number } | null>(null);
	const pinnedProbeNodeId = $derived(
		pinnedProbeAnchor
			? (circuit.graph.componentNodes[pinnedProbeAnchor.componentId]?.[pinnedProbeAnchor.pinIndex] ??
					null)
			: null
	);
	function pinProbeNode(nodeId: string | null): void {
		const pin = nodeId ? circuit.graph.nodes[nodeId]?.componentPins[0] : undefined;
		pinnedProbeAnchor = pin ? { componentId: pin.componentId, pinIndex: pin.pinIndex } : null;
	}
	let isTouchInteraction = $state(false);

	let wireStart = $state<GridPoint | null>(null);
	let wireBendMode = $state<WireBendMode>('hv');
	let wireStartedFromSelect = $state(false);

	// Zero-lag local preview states (defer solver/overlay work until pointerup)
	let dragPreview = $state<{ componentId: string; x: number; y: number } | null>(null);
	let placementPreview = $state<GridPoint | null>(null);

	// Non-reactive refs for 60fps rAF coalescing and zero-layout-thrash rect caching
	let cachedSvgRect: DOMRect | null = null;
	let viewportRafId: number | null = null;
	let pendingViewport: { pan: { x: number; y: number }; zoom?: number } | null = null;
	let lastPointerType = 'mouse';
	let wireDragOrigin: {
		pointerId: number;
		startClientX: number;
		startClientY: number;
		dragged: boolean;
		/** Set when a Select-mode touch press started on a dangling wire endpoint (tap = select wire) */
		tapWireId?: string;
	} | null = null;

	let spaceHeld = $state(false);
	const activePointers = new Map<
		number,
		{ clientX: number; clientY: number; pointerType: string }
	>();
	let pinchState = $state<{
		startZoom: number;
		startMidX: number;
		startMidY: number;
		startDist: number;
		startPanX: number;
		startPanY: number;
	} | null>(null);

	let dragState = $state<
		| {
				kind: 'pan';
				pointerId: number;
				pointerType: string;
				startClientX: number;
				startClientY: number;
				startPanX: number;
				startPanY: number;
				moved: boolean;
				tapWireId?: string;
		  }
		| {
				kind: 'component';
				pointerId: number;
				pointerType: string;
				componentId: string;
				startClientX: number;
				startClientY: number;
				offsetGx: number;
				offsetGy: number;
				origGx: number;
				origGy: number;
				moved: boolean;
		  }
		| {
				kind: 'place';
				pointerId: number;
				pointerType: string;
				tool: ComponentKind;
		  }
		| null
	>(null);

	const PREVIEW_WIRE_ID = '__wire-preview__';

	const PLACEMENT_KINDS = new Set<string>([
		'resistor',
		'capacitor',
		'inductor',
		'voltage_source',
		'current_source',
		'vcvs',
		'vccs',
		'ccvs',
		'cccs',
		'ground',
		'terminal',
		'voltmeter'
	]);

	function isPlacementTool(tool: EditorTool): tool is ComponentKind {
		return PLACEMENT_KINDS.has(tool);
	}

	const junctions = $derived(
		computeJunctionPoints(circuit.document.components, circuit.document.wires)
	);

	const wireCrossings = $derived(
		computeWireCrossings(circuit.document.components, circuit.document.wires)
	);

	const unconnectedCrossings = $derived(wireCrossings.filter((c) => !c.connected));

	const unconnectedCrossingSet = $derived(
		new Set(unconnectedCrossings.map((c) => `${c.x},${c.y}`))
	);

	const connectedCrossingSet = $derived(
		new Set(wireCrossings.filter((c) => c.connected).map((c) => `${c.x},${c.y}`))
	);

	function isHorizontalWireAtCrossing(
		wire: CircuitWire | null,
		cx: number,
		cy: number
	): boolean {
		if (!wire) return false;
		for (let i = 0; i + 1 < wire.points.length; i++) {
			const a = wire.points[i];
			const b = wire.points[i + 1];
			if (a.y === cy && b.y === cy && cx > Math.min(a.x, b.x) && cx < Math.max(a.x, b.x)) {
				return true;
			}
		}
		return false;
	}

	const danglingEndpoints = $derived(
		computeDanglingWireEndpoints(circuit.document.components, circuit.document.wires)
	);

	const wirePreviewPoints = $derived.by<GridPoint[]>(() => {
		if (!wireStart || !hoverGrid) return [];
		const target = hoverSnappedPin ?? hoverGrid;
		return computeJumpOverWirePoints(
			wireStart,
			target,
			wireBendMode,
			circuit.document.components,
			circuit.document.wires
		);
	});

	/** Insulated pass-over crossings the in-progress wire would create (rendered as bridge hops). */
	const wirePreviewCrossings = $derived.by<WireCrossing[]>(() => {
		if (wirePreviewPoints.length < 2) return [];
		return computeWireCrossings(circuit.document.components, [
			...circuit.document.wires,
			{ id: PREVIEW_WIRE_ID, points: wirePreviewPoints }
		]).filter((c) => !c.connected && c.wireIds.includes(PREVIEW_WIRE_ID));
	});

	const wirePreviewPath = $derived(
		buildWirePathWithBridges(
			wirePreviewPoints,
			new Set(wirePreviewCrossings.map((c) => `${c.x},${c.y}`)),
			GRID_SIZE
		)
	);

	/** Crossings where the preview runs vertically, so the existing horizontal wire hops over it. */
	const wirePreviewVerticalCrossings = $derived(
		wirePreviewCrossings.filter(
			(c) => !isHorizontalWireAtCrossing({ id: PREVIEW_WIRE_ID, points: wirePreviewPoints }, c.x, c.y)
		)
	);

	const nodeCount = $derived(Object.keys(circuit.graph.nodes).length);
	const hasErrors = $derived(
		circuit.solution.mna.diagnostics.some((d) => d.severity === 'error')
	);

	const isViewportGesturing = $derived(
		pinchState !== null || (dragState?.kind === 'pan' && dragState.moved)
	);
	const isWiringMode = $derived(circuit.activeTool === 'wire' || wireStart !== null);

	// Use settledZoom so pinch frames only update the root <g> transform without thrashing hitboxes
	const pinHitRadiusWorld = $derived(computeTouchPinHitRadiusWorld(settledZoom, 24));
	const wireHitStrokeWidth = $derived(Math.max(14, 28 / Math.max(0.2, settledZoom)));

	// Freeze settledZoom during active pinch and sync immediately when pinch settles
	$effect(() => {
		if (pinchState === null) {
			settledZoom = zoom;
		}
	});

	// Refresh cached SVG bounding rect when viewport dimensions change
	$effect(() => {
		void viewportW;
		void viewportH;
		if (svgEl) {
			cachedSvgRect = svgEl.getBoundingClientRect();
		}
	});

	// Clear placement preview if tool changes away from placement
	$effect(() => {
		if (!isPlacementTool(circuit.activeTool) && placementPreview !== null) {
			placementPreview = null;
		}
	});

	// Detect coarse touch pointers on mount so crossing hit targets are touch-sized immediately
	$effect(() => {
		if (typeof window !== 'undefined' && typeof window.matchMedia === 'function') {
			isTouchInteraction = window.matchMedia('(pointer: coarse)').matches;
		}
	});

	// Cancel any pending rAF callback or feedback timer on unmount
	$effect(() => {
		return () => {
			cancelPendingViewportUpdate();
			if (localAutoWireTimer !== undefined) {
				clearTimeout(localAutoWireTimer);
			}
			if (localCrossingTimer !== undefined) {
				clearTimeout(localCrossingTimer);
			}
		};
	});

	// Mark document for refit whenever a document is loaded (including AI imports / share URLs without an id)
	$effect(() => {
		const seq = circuit.documentLoadSeq;
		if (seq !== lastDocumentLoadSeq) {
			lastDocumentLoadSeq = seq;
			needsFit = true;
		}
	});

	// Fit schematic neatly only once the canvas has a non-zero visible viewport
	$effect(() => {
		const compCount = circuit.document.components.length;
		if (needsFit && viewportW > 0 && viewportH > 0 && compCount > 0) {
			fitToView();
			needsFit = false;
		}
	});

	function refreshSvgRect(): DOMRect | null {
		if (!svgEl) return null;
		cachedSvgRect = svgEl.getBoundingClientRect();
		return cachedSvgRect;
	}

	function getSvgRect(): DOMRect | null {
		return cachedSvgRect ?? refreshSvgRect();
	}

	function flushViewportUpdate(): void {
		if (!pendingViewport) return;
		const { pan: nextPan, zoom: nextZoom } = pendingViewport;
		pendingViewport = null;
		if (nextZoom !== undefined) {
			zoom = nextZoom;
		}
		pan = nextPan;
	}

	function cancelPendingViewportUpdate(): void {
		if (viewportRafId !== null && typeof cancelAnimationFrame !== 'undefined') {
			cancelAnimationFrame(viewportRafId);
			viewportRafId = null;
		}
		pendingViewport = null;
	}

	function scheduleViewportUpdate(nextPan: { x: number; y: number }, nextZoom?: number): void {
		pendingViewport = { pan: nextPan, zoom: nextZoom };
		if (viewportRafId !== null) return;
		if (typeof requestAnimationFrame === 'undefined') {
			flushViewportUpdate();
			return;
		}
		viewportRafId = requestAnimationFrame(() => {
			viewportRafId = null;
			flushViewportUpdate();
		});
	}

	function capturePointer(pointerId: number): void {
		try {
			svgEl?.setPointerCapture(pointerId);
		} catch {
			// Ignore if synthetic pointer or capture unsupported
		}
	}

	function releasePointer(pointerId: number): void {
		try {
			if (svgEl?.hasPointerCapture(pointerId)) {
				svgEl.releasePointerCapture(pointerId);
			}
		} catch {
			// Ignore
		}
	}

	function setHoverGrid(next: GridPoint | null): void {
		if (next === null) {
			if (hoverGrid !== null) hoverGrid = null;
			return;
		}
		if (!hoverGrid || hoverGrid.x !== next.x || hoverGrid.y !== next.y) {
			hoverGrid = next;
		}
	}

	function setHoverSnappedPin(next: GridPoint | null): void {
		if (next === null) {
			if (hoverSnappedPin !== null) hoverSnappedPin = null;
			return;
		}
		if (!hoverSnappedPin || hoverSnappedPin.x !== next.x || hoverSnappedPin.y !== next.y) {
			hoverSnappedPin = next;
		}
	}

	export function fitToView(): void {
		cancelPendingViewportUpdate();
		const comps = circuit.document.components;
		const wires = circuit.document.wires;
		if (comps.length === 0 && wires.length === 0) {
			zoom = 1;
			pan = { x: 80, y: 60 };
			return;
		}

		let minX = Infinity;
		let minY = Infinity;
		let maxX = -Infinity;
		let maxY = -Infinity;

		const theveninCompId =
			circuit.theveninTarget?.kind === 'component' ? circuit.theveninTarget.componentId : null;

		for (const c of comps) {
			const cx = c.x * GRID_SIZE;
			const cy = c.y * GRID_SIZE;
			const isVertical = c.rotation % 180 === 90;
			const isThevenin = theveninCompId === c.id;
			const valueText =
				c.kind === 'ground' || c.kind === 'terminal' ? '' : getComponentDisplayMeta(c).displayVal;

			if (c.kind === 'ground') {
				const rightExtent = Math.max(3 * GRID_SIZE, 24 + c.label.length * 7.5);
				minX = Math.min(minX, cx - 3 * GRID_SIZE);
				maxX = Math.max(maxX, cx + rightExtent);
				minY = Math.min(minY, cy - 2.5 * GRID_SIZE);
				maxY = Math.max(maxY, cy + 2.5 * GRID_SIZE);
			} else if (c.kind === 'terminal') {
				const halfExtent = Math.max(3 * GRID_SIZE, 16 + (c.label.length * 7.5) / 2);
				minX = Math.min(minX, cx - halfExtent);
				maxX = Math.max(maxX, cx + halfExtent);
				minY = Math.min(minY, cy - 2.5 * GRID_SIZE);
				maxY = Math.max(maxY, cy + 2.5 * GRID_SIZE);
			} else if (isVertical) {
				const rightExtent = Math.max(
					3 * GRID_SIZE,
					32 + Math.max(c.label.length, valueText.length) * 7.5
				);
				minX = Math.min(minX, cx - 3 * GRID_SIZE);
				maxX = Math.max(maxX, cx + rightExtent);
				minY = Math.min(minY, cy - (isThevenin ? 66 : 2.5 * GRID_SIZE));
				maxY = Math.max(maxY, cy + 2.5 * GRID_SIZE);
			} else {
				const halfExtent = Math.max(
					3 * GRID_SIZE,
					16 + (Math.max(c.label.length, valueText.length) * 7.5) / 2
				);
				minX = Math.min(minX, cx - halfExtent);
				maxX = Math.max(maxX, cx + halfExtent);
				minY = Math.min(minY, cy - (isThevenin ? 66 : 3 * GRID_SIZE));
				maxY = Math.max(maxY, cy + 2.5 * GRID_SIZE);
			}
		}
		for (const w of wires) {
			for (const pt of w.points) {
				minX = Math.min(minX, (pt.x - 1) * GRID_SIZE);
				maxX = Math.max(maxX, (pt.x + 1) * GRID_SIZE);
				minY = Math.min(minY, (pt.y - 1) * GRID_SIZE);
				maxY = Math.max(maxY, (pt.y + 1) * GRID_SIZE);
			}
		}

		if (settings.showLiveOverlays) {
			for (const br of overlayLayout.branches) {
				minX = Math.min(minX, br.badgeX - br.pillWidth / 2);
				maxX = Math.max(maxX, br.badgeX + br.pillWidth / 2);
				minY = Math.min(minY, br.badgeY - 12);
				maxY = Math.max(maxY, br.badgeY + 12);
			}
			for (const nd of overlayLayout.nodes) {
				minX = Math.min(minX, nd.xPx - nd.pillWidth / 2);
				maxX = Math.max(maxX, nd.xPx + nd.pillWidth / 2);
				minY = Math.min(minY, nd.yPx - 12);
				maxY = Math.max(maxY, nd.yPx + 12);
			}
		}

		const contentW = Math.max(120, maxX - minX);
		const contentH = Math.max(120, maxY - minY);
		const padX = viewportW < 520 ? 32 : settings.showLiveOverlays ? 120 : 90;
		const padY = viewportH < 680 ? 112 : settings.showLiveOverlays ? 96 : 80;
		const availW = Math.max(160, viewportW - padX);
		const availH = Math.max(160, viewportH - padY);

		const nextZoom = Math.min(1.6, Math.max(0.3, Math.min(availW / contentW, availH / contentH)));
		const centerX = (minX + maxX) / 2;
		const centerY = (minY + maxY) / 2;

		zoom = nextZoom;
		pan = {
			x: viewportW / 2 - centerX * nextZoom,
			y: viewportH / 2 - centerY * nextZoom
		};
	}

	function clampZoom(z: number): number {
		return Math.min(2.5, Math.max(0.3, z));
	}

	function adjustZoom(delta: number): void {
		cancelPendingViewportUpdate();
		const nextZoom = clampZoom(zoom + delta);
		const cx = viewportW / 2;
		const cy = viewportH / 2;
		const wx = (cx - pan.x) / zoom;
		const wy = (cy - pan.y) / zoom;
		zoom = nextZoom;
		pan = {
			x: cx - wx * nextZoom,
			y: cy - wy * nextZoom
		};
	}

	function resetZoom(): void {
		cancelPendingViewportUpdate();
		const cx = viewportW / 2;
		const cy = viewportH / 2;
		const wx = (cx - pan.x) / zoom;
		const wy = (cy - pan.y) / zoom;
		zoom = 1;
		pan = {
			x: cx - wx,
			y: cy - wy
		};
	}

	function clientToGrid(clientX: number, clientY: number): { gx: number; gy: number; sx: number; sy: number } {
		const rect = getSvgRect();
		if (!rect) return { gx: 0, gy: 0, sx: 0, sy: 0 };
		const sx = clientX - rect.left;
		const sy = clientY - rect.top;
		const wx = (sx - pan.x) / zoom;
		const wy = (sy - pan.y) / zoom;
		return { gx: wx / GRID_SIZE, gy: wy / GRID_SIZE, sx, sy };
	}

	function getPinSnapDist(pointerType: string): number {
		if (pointerType === 'touch' || pointerType === 'pen') {
			return Math.max(0.85, 24 / (GRID_SIZE * Math.max(0.2, zoom)));
		}
		return 0.6;
	}

	function getNodeProbeDist(pointerType: string): number {
		if (pointerType === 'touch' || pointerType === 'pen') {
			return Math.max(0.95, 24 / (GRID_SIZE * Math.max(0.2, zoom)));
		}
		return 0.65;
	}

	/** Nearest wiring snap anchor: component pins (preferred on ties) or any wire vertex. */
	function findNearestSnapAnchor(gx: number, gy: number, maxDist = 0.6): GridPoint | null {
		const hit = findNearestAnchor(
			gx,
			gy,
			circuit.document.components,
			circuit.document.wires,
			maxDist
		);
		return hit ? { x: hit.x, y: hit.y } : null;
	}

	function findNodeNearGrid(gx: number, gy: number, maxDist = 0.65): string | null {
		for (const [nodeId, node] of Object.entries(circuit.graph.nodes)) {
			if (node.gridPoints.some((gp) => Math.hypot(gp.x - gx, gp.y - gy) <= maxDist)) {
				return nodeId;
			}
		}
		return null;
	}

	function handleWheel(e: WheelEvent): void {
		e.preventDefault();
		const rect = refreshSvgRect();
		if (!rect) return;
		cancelPendingViewportUpdate();
		const sx = e.clientX - rect.left;
		const sy = e.clientY - rect.top;
		const wx = (sx - pan.x) / zoom;
		const wy = (sy - pan.y) / zoom;

		const factor = e.deltaY < 0 ? 1.1 : 1 / 1.1;
		const nextZoom = clampZoom(zoom * factor);
		zoom = nextZoom;
		pan = {
			x: sx - wx * nextZoom,
			y: sy - wy * nextZoom
		};
	}

	function startWireAt(pt: GridPoint, fromSelect: boolean): void {
		wireStart = { x: pt.x, y: pt.y };
		wireStartedFromSelect = fromSelect;
		wireBendMode = 'hv';
	}

	function finishWireAt(endPt: GridPoint): void {
		if (!wireStart) return;
		const pts = computeJumpOverWirePoints(
			wireStart,
			endPt,
			wireBendMode,
			circuit.document.components,
			circuit.document.wires
		);
		const added = circuit.addWire(pts);
		wireStart = null;
		wireDragOrigin = null;
		if (wireStartedFromSelect) {
			wireStartedFromSelect = false;
		}
		if (added) {
			const bridged = countBridgedCrossingsForWire(
				circuit.document.components,
				circuit.document.wires,
				added.id
			);
			if (bridged > 0) {
				const action = isTouchLikePointer(lastPointerType) ? 'Tap' : 'Click';
				showCrossingFeedback(
					`Bridged ${bridged} ${bridged === 1 ? 'crossing' : 'crossings'} · ${action} crossing to connect`,
					4000
				);
			}
		}
	}

	function isPrimaryPointerDown(e: PointerEvent): boolean {
		if (e.pointerType === 'mouse') {
			return e.button === 0;
		}
		return e.button === 0 || e.button === -1;
	}

	function beginPinchFromActivePointers(): void {
		if (activePointers.size < 2) return;
		const rect = refreshSvgRect();
		if (!rect) return;
		flushViewportUpdate();
		cancelPendingViewportUpdate();

		const pts = Array.from(activePointers.values());
		const p1 = pts[0];
		const p2 = pts[1];
		const x1 = p1.clientX - rect.left;
		const y1 = p1.clientY - rect.top;
		const x2 = p2.clientX - rect.left;
		const y2 = p2.clientY - rect.top;

		// Cancel any in-progress single-finger pan, component drag, wire drag, or placement drag cleanly
		dragState = null;
		dragPreview = null;
		placementPreview = null;
		wireDragOrigin = null;

		pinchState = {
			startZoom: zoom,
			startMidX: (x1 + x2) / 2,
			startMidY: (y1 + y2) / 2,
			startDist: Math.hypot(x2 - x1, y2 - y1),
			startPanX: pan.x,
			startPanY: pan.y
		};
	}

	/**
	 * Tracks active pointers on pointerdown. Returns true if a two-finger pinch
	 * gesture is active so callers skip single-pointer selection/drag/wiring.
	 */
	function trackPointerDown(e: PointerEvent): boolean {
		if (e.pointerType === 'mouse' && e.button !== 0 && e.button !== 1) {
			return false;
		}
		activePointers.set(e.pointerId, {
			clientX: e.clientX,
			clientY: e.clientY,
			pointerType: e.pointerType
		});

		if (activePointers.size >= 2) {
			if (!pinchState) {
				beginPinchFromActivePointers();
			}
			return true;
		}
		return false;
	}

	/**
	 * Inspector fields commit on blur, but the canvas changes the selection on pointerdown,
	 * before the field loses focus. Blur the field first so a half-typed value is saved to the
	 * component it was typed for, not to the one just clicked.
	 */
	function commitPendingFieldEdit(): void {
		const el = typeof document !== 'undefined' ? document.activeElement : null;
		if (
			el instanceof HTMLInputElement ||
			el instanceof HTMLTextAreaElement ||
			el instanceof HTMLSelectElement
		) {
			el.blur();
		}
	}

	function handleBackgroundPointerDown(e: PointerEvent): void {
		commitPendingFieldEdit();
		lastPointerType = e.pointerType;
		isTouchInteraction = isTouchLikePointer(e.pointerType);
		refreshSvgRect();

		if (e.pointerType === 'mouse' && e.button === 2) {
			if (wireStart) {
				wireStart = null;
				wireStartedFromSelect = false;
				wireDragOrigin = null;
			} else if (circuit.activeTool !== 'select') {
				circuit.setActiveTool('select');
			}
			return;
		}

		if (trackPointerDown(e)) {
			e.preventDefault();
			return;
		}

		if (e.pointerType === 'mouse' && (e.button === 1 || (e.button === 0 && spaceHeld))) {
			e.preventDefault();
			capturePointer(e.pointerId);
			dragState = {
				kind: 'pan',
				pointerId: e.pointerId,
				pointerType: e.pointerType,
				startClientX: e.clientX,
				startClientY: e.clientY,
				startPanX: pan.x,
				startPanY: pan.y,
				moved: false
			};
			return;
		}

		if (!isPrimaryPointerDown(e)) return;

		const { gx, gy } = clientToGrid(e.clientX, e.clientY);
		const snappedPin = findNearestSnapAnchor(gx, gy, getPinSnapDist(e.pointerType));
		const targetPt: GridPoint = snappedPin ?? {
			x: Math.round(gx),
			y: Math.round(gy)
		};

		if (circuit.activeTool === 'wire') {
			if (!wireStart) {
				startWireAt(targetPt, false);
				if (isTouchLikePointer(e.pointerType)) {
					wireDragOrigin = {
						pointerId: e.pointerId,
						startClientX: e.clientX,
						startClientY: e.clientY,
						dragged: false
					};
					capturePointer(e.pointerId);
					setHoverGrid(targetPt);
					setHoverSnappedPin(snappedPin);
				}
			} else {
				finishWireAt(targetPt);
			}
			return;
		}

		if (circuit.activeTool === 'probe') {
			const nid = findNodeNearGrid(gx, gy, getNodeProbeDist(e.pointerType));
			pinProbeNode(nid);
			return;
		}

		if (isPlacementTool(circuit.activeTool)) {
			const gxSnap = Math.round(gx);
			const gySnap = Math.round(gy);
			if (isTouchLikePointer(e.pointerType)) {
				placementPreview = { x: gxSnap, y: gySnap };
				dragState = {
					kind: 'place',
					pointerId: e.pointerId,
					pointerType: e.pointerType,
					tool: circuit.activeTool
				};
				capturePointer(e.pointerId);
				return;
			}
			circuit.addComponent(circuit.activeTool, gxSnap, gySnap, {
				rotation: circuit.placementRotation,
				sourceMode: circuit.activeSourceMode
			});
			return;
		}

		// Select tool: background drag pans; background tap clears selection
		if (wireStart) {
			finishWireAt(targetPt);
			return;
		}

		capturePointer(e.pointerId);
		dragState = {
			kind: 'pan',
			pointerId: e.pointerId,
			pointerType: e.pointerType,
			startClientX: e.clientX,
			startClientY: e.clientY,
			startPanX: pan.x,
			startPanY: pan.y,
			moved: false
		};
	}

	function handleComponentPointerDown(e: PointerEvent, comp: CircuitComponent): void {
		commitPendingFieldEdit();
		lastPointerType = e.pointerType;
		refreshSvgRect();

		if (e.pointerType === 'mouse' && (e.button === 1 || (e.button === 0 && spaceHeld))) {
			// Let middle-click / Space+drag pan cleanly
			return;
		}
		if (!isPrimaryPointerDown(e)) return;

		if (trackPointerDown(e)) {
			e.stopPropagation();
			e.preventDefault();
			return;
		}

		if (
			isPlacementTool(circuit.activeTool) ||
			circuit.activeTool === 'wire' ||
			circuit.activeTool === 'probe' ||
			wireStart
		) {
			return;
		}

		e.stopPropagation();
		circuit.selectComponent(comp.id);
		dragPreview = null;
		capturePointer(e.pointerId);

		const { gx, gy } = clientToGrid(e.clientX, e.clientY);
		dragState = {
			kind: 'component',
			pointerId: e.pointerId,
			pointerType: e.pointerType,
			componentId: comp.id,
			startClientX: e.clientX,
			startClientY: e.clientY,
			offsetGx: gx - comp.x,
			offsetGy: gy - comp.y,
			origGx: comp.x,
			origGy: comp.y,
			moved: false
		};
	}

	function handlePinPointerDown(
		e: PointerEvent,
		comp: CircuitComponent,
		pinX: number,
		pinY: number
	): void {
		commitPendingFieldEdit();
		lastPointerType = e.pointerType;
		refreshSvgRect();

		if (!isPrimaryPointerDown(e) || spaceHeld) return;

		// Stop accidental touch/pen wiring when in Select mode: bubble to component drag only if
		// inside the body hitbox; otherwise stop propagation and start canvas pan directly.
		if (isTouchLikePointer(e.pointerType) && circuit.activeTool === 'select' && !wireStart) {
			const { gx, gy } = clientToGrid(e.clientX, e.clientY);
			if (!isPointInComponentBodyHitbox(comp, gx, gy)) {
				e.stopPropagation();
				handleBackgroundPointerDown(e);
			}
			return;
		}

		if (trackPointerDown(e)) {
			e.stopPropagation();
			e.preventDefault();
			return;
		}

		if (isPlacementTool(circuit.activeTool)) return;

		// In Select mode (desktop mouse, when not actively routing a wire), allow clicks near the
		// component body to fall through to component selection/dragging cleanly.
		if (circuit.activeTool === 'select' && !wireStart) {
			const { gx, gy } = clientToGrid(e.clientX, e.clientY);
			const distToPin = Math.hypot(gx - pinX, gy - pinY);
			const isOnePinComp = comp.kind === 'ground' || comp.kind === 'terminal';
			if (isOnePinComp) {
				if (distToPin > 0.45) return;
			} else {
				const distToCenter = Math.hypot(gx - comp.x, gy - comp.y);
				if (distToCenter < distToPin && distToCenter <= 1.25) return;
			}
		}

		e.stopPropagation();
		const pt = { x: pinX, y: pinY };

		if (circuit.activeTool === 'probe') {
			pinProbeNode(findNodeNearGrid(pinX, pinY, getNodeProbeDist(e.pointerType)));
			return;
		}

		if (!wireStart) {
			startWireAt(pt, circuit.activeTool === 'select');
			if (isTouchLikePointer(e.pointerType)) {
				wireDragOrigin = {
					pointerId: e.pointerId,
					startClientX: e.clientX,
					startClientY: e.clientY,
					dragged: false
				};
				capturePointer(e.pointerId);
				setHoverGrid(pt);
				setHoverSnappedPin(pt);
			}
		} else {
			finishWireAt(pt);
		}
	}

	function handleWirePointerDown(e: PointerEvent, wire: CircuitWire): void {
		commitPendingFieldEdit();
		lastPointerType = e.pointerType;
		isTouchInteraction = isTouchLikePointer(e.pointerType);
		refreshSvgRect();

		if (!isPrimaryPointerDown(e) || spaceHeld) return;

		if (trackPointerDown(e)) {
			e.stopPropagation();
			e.preventDefault();
			return;
		}

		if (isPlacementTool(circuit.activeTool)) return;

		if (circuit.activeTool === 'wire' || wireStart) {
			e.stopPropagation();
			const { gx, gy } = clientToGrid(e.clientX, e.clientY);
			const snappedPin = findNearestSnapAnchor(gx, gy, getPinSnapDist(e.pointerType));
			const pt = snappedPin ?? {
				x: Math.round(gx),
				y: Math.round(gy)
			};
			if (!wireStart) {
				startWireAt(pt, false);
				if (isTouchLikePointer(e.pointerType)) {
					wireDragOrigin = {
						pointerId: e.pointerId,
						startClientX: e.clientX,
						startClientY: e.clientY,
						dragged: false
					};
					capturePointer(e.pointerId);
					setHoverGrid(pt);
					setHoverSnappedPin(snappedPin);
				}
			} else {
				finishWireAt(pt);
			}
			return;
		}

		if (circuit.activeTool === 'probe') {
			e.stopPropagation();
			const { gx, gy } = clientToGrid(e.clientX, e.clientY);
			pinProbeNode(findNodeNearGrid(gx, gy, getNodeProbeDist(e.pointerType)));
			return;
		}

		e.stopPropagation();
		if (isTouchLikePointer(e.pointerType)) {
			refreshSvgRect();
			capturePointer(e.pointerId);
			dragState = {
				kind: 'pan',
				pointerId: e.pointerId,
				pointerType: e.pointerType,
				startClientX: e.clientX,
				startClientY: e.clientY,
				startPanX: pan.x,
				startPanY: pan.y,
				moved: false,
				tapWireId: wire.id
			};
			return;
		}
		circuit.selectWire(wire.id);
	}

	/**
	 * Press on an open (dangling) wire endpoint: starts a new wire from it in Select / Wire mode
	 * (mouse click-click or touch press-drag-release), or completes the in-progress wire there.
	 */
	function handleWireEndpointPointerDown(e: PointerEvent, wireId: string, pt: GridPoint): void {
		commitPendingFieldEdit();
		lastPointerType = e.pointerType;
		isTouchInteraction = isTouchLikePointer(e.pointerType);
		refreshSvgRect();

		if (!isPrimaryPointerDown(e) || spaceHeld) return;

		if (trackPointerDown(e)) {
			e.stopPropagation();
			e.preventDefault();
			return;
		}

		// Placement / probe tools fall through to the background handler
		if (isPlacementTool(circuit.activeTool) || circuit.activeTool === 'probe') return;

		e.stopPropagation();
		const anchor = { x: pt.x, y: pt.y };

		if (wireStart) {
			finishWireAt(anchor);
			return;
		}

		const fromSelect = circuit.activeTool === 'select';
		startWireAt(anchor, fromSelect);
		if (isTouchLikePointer(e.pointerType)) {
			wireDragOrigin = {
				pointerId: e.pointerId,
				startClientX: e.clientX,
				startClientY: e.clientY,
				dragged: false,
				tapWireId: fromSelect ? wireId : undefined
			};
			capturePointer(e.pointerId);
			setHoverGrid(anchor);
			setHoverSnappedPin(anchor);
		}
	}

	function handleCrossingPointerDown(e: PointerEvent, crossing: WireCrossing): void {
		commitPendingFieldEdit();
		lastPointerType = e.pointerType;
		isTouchInteraction = isTouchLikePointer(e.pointerType);
		refreshSvgRect();

		if (!isPrimaryPointerDown(e) || spaceHeld) return;

		if (trackPointerDown(e)) {
			e.stopPropagation();
			e.preventDefault();
			return;
		}

		if (circuit.activeTool !== 'select' || wireStart) return;

		e.stopPropagation();
		handleCrossingToggle(crossing.x, crossing.y);
	}

	function handlePointerMove(e: PointerEvent): void {
		if (activePointers.has(e.pointerId)) {
			activePointers.set(e.pointerId, {
				clientX: e.clientX,
				clientY: e.clientY,
				pointerType: e.pointerType
			});
		}

		// 1. Two-finger pinch-zoom + two-finger pan (rAF coalesced, zero hover/rect thrash)
		if (pinchState && activePointers.size >= 2) {
			const rect = getSvgRect();
			if (!rect) return;
			const pts = Array.from(activePointers.values());
			const p1 = pts[0];
			const p2 = pts[1];
			const x1 = p1.clientX - rect.left;
			const y1 = p1.clientY - rect.top;
			const x2 = p2.clientX - rect.left;
			const y2 = p2.clientY - rect.top;

			const next = computePinchTransform({
				startZoom: pinchState.startZoom,
				startMidX: pinchState.startMidX,
				startMidY: pinchState.startMidY,
				startDist: pinchState.startDist,
				currMidX: (x1 + x2) / 2,
				currMidY: (y1 + y2) / 2,
				currDist: Math.hypot(x2 - x1, y2 - y1),
				startPanX: pinchState.startPanX,
				startPanY: pinchState.startPanY,
				minZoom: 0.3,
				maxZoom: 2.5
			});
			scheduleViewportUpdate({ x: next.panX, y: next.panY }, next.zoom);
			return;
		}

		// 2. Active single-pointer pan (rAF coalesced, short-circuit hover updates)
		if (dragState?.kind === 'pan' && dragState.pointerId === e.pointerId) {
			const dx = e.clientX - dragState.startClientX;
			const dy = e.clientY - dragState.startClientY;
			if (
				!dragState.moved &&
				hasExceededDragThreshold(
					dragState.startClientX,
					dragState.startClientY,
					e.clientX,
					e.clientY,
					getDragThresholdPx(dragState.pointerType)
				)
			) {
				dragState.moved = true;
			}
			if (dragState.moved) {
				scheduleViewportUpdate({
					x: dragState.startPanX + dx,
					y: dragState.startPanY + dy
				});
			}
			return;
		}

		// 3. Zero-lag component drag preview (defer solver + overlay recompute until pointerup)
		if (dragState?.kind === 'component' && dragState.pointerId === e.pointerId) {
			if (!dragState.moved) {
				if (
					!hasExceededDragThreshold(
						dragState.startClientX,
						dragState.startClientY,
						e.clientX,
						e.clientY,
						getDragThresholdPx(dragState.pointerType)
					)
				) {
					return;
				}
				dragState.moved = true;
			}
			const { gx, gy } = clientToGrid(e.clientX, e.clientY);
			const nextGx = Math.round(gx - dragState.offsetGx);
			const nextGy = Math.round(gy - dragState.offsetGy);
			if (
				!dragPreview ||
				dragPreview.componentId !== dragState.componentId ||
				dragPreview.x !== nextGx ||
				dragPreview.y !== nextGy
			) {
				dragPreview = { componentId: dragState.componentId, x: nextGx, y: nextGy };
			}
			return;
		}

		// 4. Touch drag-to-place live ghost positioning
		if (dragState?.kind === 'place' && dragState.pointerId === e.pointerId) {
			const { gx, gy } = clientToGrid(e.clientX, e.clientY);
			const nextGx = Math.round(gx);
			const nextGy = Math.round(gy);
			if (!placementPreview || placementPreview.x !== nextGx || placementPreview.y !== nextGy) {
				placementPreview = { x: nextGx, y: nextGy };
			}
			return;
		}

		// 5. Touch press-drag-release orthogonal wiring preview
		if (wireDragOrigin && wireDragOrigin.pointerId === e.pointerId && wireStart) {
			if (
				!wireDragOrigin.dragged &&
				hasExceededDragThreshold(
					wireDragOrigin.startClientX,
					wireDragOrigin.startClientY,
					e.clientX,
					e.clientY,
					TOUCH_WIRE_DRAG_THRESHOLD_PX
				)
			) {
				wireDragOrigin.dragged = true;
			}
			const { gx, gy } = clientToGrid(e.clientX, e.clientY);
			setHoverGrid({ x: Math.round(gx), y: Math.round(gy) });
			setHoverSnappedPin(findNearestSnapAnchor(gx, gy, getPinSnapDist(e.pointerType)));
			return;
		}

		// 6. Idle hover tracking (deduplicated writes; skipped during viewport gestures)
		if (isViewportGesturing) return;

		const { gx, gy } = clientToGrid(e.clientX, e.clientY);
		setHoverGrid({ x: Math.round(gx), y: Math.round(gy) });

		if (isWiringMode || e.pointerType === 'mouse') {
			setHoverSnappedPin(findNearestSnapAnchor(gx, gy, getPinSnapDist(e.pointerType)));
		} else {
			setHoverSnappedPin(null);
		}

		if (circuit.activeTool === 'probe') {
			const nextNode = findNodeNearGrid(gx, gy, getNodeProbeDist(e.pointerType));
			if (hoveredNodeId !== nextNode) {
				hoveredNodeId = nextNode;
			}
		} else if (hoveredNodeId !== null) {
			hoveredNodeId = null;
		}
	}

	function handlePointerUp(e: PointerEvent): void {
		releasePointer(e.pointerId);
		activePointers.delete(e.pointerId);

		if (pinchState) {
			flushViewportUpdate();
			cancelPendingViewportUpdate();
			if (activePointers.size < 2) {
				pinchState = null;
			}
			dragState = null;
			dragPreview = null;
			placementPreview = null;
			if (isTouchLikePointer(e.pointerType)) {
				setHoverGrid(null);
				setHoverSnappedPin(null);
			}
			return;
		}

		if (wireDragOrigin && wireDragOrigin.pointerId === e.pointerId) {
			const origin = wireDragOrigin;
			wireDragOrigin = null;
			if (origin.dragged && wireStart) {
				const { gx, gy } = clientToGrid(e.clientX, e.clientY);
				const endPt = findNearestSnapAnchor(gx, gy, getPinSnapDist(e.pointerType)) ?? {
					x: Math.round(gx),
					y: Math.round(gy)
				};
				finishWireAt(endPt);
			} else if (!origin.dragged && origin.tapWireId && wireStartedFromSelect) {
				// Select-mode tap (no drag) on a dangling wire endpoint selects the wire instead
				wireStart = null;
				wireStartedFromSelect = false;
				circuit.selectWire(origin.tapWireId);
			}
			if (isTouchLikePointer(e.pointerType)) {
				setHoverGrid(null);
				setHoverSnappedPin(null);
			}
			return;
		}

		if (dragState && dragState.pointerId === e.pointerId) {
			const ds = dragState;
			dragState = null;

			if (ds.kind === 'pan') {
				flushViewportUpdate();
				cancelPendingViewportUpdate();
				if (!ds.moved) {
					if (ds.tapWireId) {
						circuit.selectWire(ds.tapWireId);
					} else {
						circuit.clearSelection();
					}
				}
			} else if (ds.kind === 'component') {
				const preview = dragPreview;
				dragPreview = null;
				if (
					preview &&
					preview.componentId === ds.componentId &&
					(preview.x !== ds.origGx || preview.y !== ds.origGy)
				) {
					circuit.moveComponent(ds.componentId, preview.x, preview.y, { recordUndo: true });
				} else if (!ds.moved && ds.pointerType === 'mouse') {
					onComponentInspect?.(ds.componentId);
				}
			} else if (ds.kind === 'place') {
				const pt = placementPreview;
				placementPreview = null;
				if (pt) {
					circuit.addComponent(ds.tool, pt.x, pt.y, {
						rotation: circuit.placementRotation,
						sourceMode: circuit.activeSourceMode
					});
					circuit.setActiveTool('select');
				}
			}
		}

		if (isTouchLikePointer(e.pointerType)) {
			setHoverGrid(null);
			setHoverSnappedPin(null);
		}
	}

	function handlePointerCancel(e: PointerEvent): void {
		releasePointer(e.pointerId);
		activePointers.delete(e.pointerId);
		flushViewportUpdate();
		cancelPendingViewportUpdate();

		if (activePointers.size < 2) {
			pinchState = null;
		}
		if (wireDragOrigin && wireDragOrigin.pointerId === e.pointerId) {
			wireDragOrigin = null;
		}
		if (dragState && dragState.pointerId === e.pointerId) {
			dragState = null;
			dragPreview = null;
			placementPreview = null;
		}
		if (isTouchLikePointer(e.pointerType)) {
			setHoverGrid(null);
			setHoverSnappedPin(null);
		}
	}

	function isTypingTarget(target: EventTarget | null): boolean {
		if (!(target instanceof HTMLElement)) return false;
		const tag = target.tagName;
		return (
			tag === 'INPUT' ||
			tag === 'TEXTAREA' ||
			tag === 'SELECT' ||
			target.isContentEditable
		);
	}

	function handleKeyDown(e: KeyboardEvent): void {
		if (isTypingTarget(e.target)) return;
		if (typeof document !== 'undefined' && document.querySelector('dialog[open]')) return;

		const key = e.key.toLowerCase();

		if ((e.ctrlKey || e.metaKey) && key === 'z') {
			e.preventDefault();
			if (e.shiftKey) {
				circuit.redo();
			} else {
				circuit.undo();
			}
			return;
		}
		if ((e.ctrlKey || e.metaKey) && key === 'y') {
			e.preventDefault();
			circuit.redo();
			return;
		}

		if (e.ctrlKey || e.metaKey || e.altKey) return;

		if (e.key === 'Escape') {
			if (wireStart) {
				wireStart = null;
				wireStartedFromSelect = false;
				wireDragOrigin = null;
			} else if (circuit.activeTool !== 'select') {
				circuit.setActiveTool('select');
			} else {
				circuit.clearSelection();
				pinProbeNode(null);
			}
			return;
		}

		if ((e.code === 'Space' || e.key === 'Tab') && wireStart) {
			e.preventDefault();
			wireBendMode = wireBendMode === 'hv' ? 'vh' : 'hv';
			return;
		}

		if (e.code === 'Space') {
			spaceHeld = true;
			return;
		}

		if (e.key === 'Delete' || e.key === 'Backspace') {
			if (circuit.selectedComponentId || circuit.selectedWireId) {
				e.preventDefault();
				circuit.deleteSelected();
			}
			return;
		}

		if (key === 'r') {
			if (e.shiftKey) {
				if (isPlacementTool(circuit.activeTool)) {
					circuit.rotatePlacement();
				} else if (circuit.selectedComponentId) {
					circuit.rotateComponent(circuit.selectedComponentId);
				} else {
					circuit.rotatePlacement();
				}
				return;
			}
			if (isPlacementTool(circuit.activeTool)) {
				circuit.rotatePlacement();
			} else if (circuit.selectedComponentId) {
				circuit.rotateComponent(circuit.selectedComponentId);
			} else {
				circuit.setActiveTool('resistor');
			}
			return;
		}

		if (e.key === ']' || e.key === '[') {
			if (isPlacementTool(circuit.activeTool)) {
				circuit.rotatePlacement();
			} else if (circuit.selectedComponentId) {
				circuit.rotateComponent(circuit.selectedComponentId);
			}
			return;
		}

		// Tool shortcuts matching PALETTE_ITEMS
		const shortcutMap: Record<string, () => void> = {
			v: () => circuit.setActiveTool('voltage_source', 'dc'),
			...(AC_ENABLED ? { a: () => circuit.setActiveTool('voltage_source', 'ac') } : {}),
			i: () => circuit.setActiveTool('current_source', 'dc'),
			c: () => circuit.setActiveTool('capacitor'),
			l: () => circuit.setActiveTool('inductor'),
			w: () => circuit.setActiveTool('wire'),
			g: () => circuit.setActiveTool('ground'),
			t: () => circuit.setActiveTool('terminal'),
			m: () => circuit.setActiveTool('voltmeter'),
			p: () => circuit.setActiveTool('probe')
		};

		if (key in shortcutMap) {
			wireStart = null;
			wireDragOrigin = null;
			shortcutMap[key]();
		}
	}

	function handleKeyUp(e: KeyboardEvent): void {
		if (e.code === 'Space') {
			spaceHeld = false;
		}
	}

	function getSourceModeForComp(comp: CircuitComponent): 'dc' | 'ac' {
		if (!AC_ENABLED) return 'dc';
		if (circuit.document.mode === 'ac') return 'ac';
		if (/[∠@<j]/i.test(comp.value) || comp.phaseDeg !== undefined) return 'ac';
		return 'dc';
	}

	function getComponentDisplayMeta(comp: CircuitComponent): {
		isUnknownComp: boolean;
		displayVal: string;
		isVoltmeterReading?: boolean;
		isVoltmeterOpen?: boolean;
		isDependentUnset?: boolean;
	} {
		if (comp.kind === 'voltmeter') {
			const branch = circuit.solution.mna.valid && !circuit.solution.mna.multiFrequencyHz ? circuit.solution.mna.branches[comp.id] : undefined;
			if (branch) {
				const formattedV = formatComplexOverlay(branch.voltage, 'V', circuit.document.mode, {
					precision: settings.precision,
					angleDisplay: settings.angleDisplay,
					showDcFractions: settings.showDcFractions,
					unitSystem: settings.unitSystem
				});
				return {
					isUnknownComp: false,
					displayVal: formattedV,
					isVoltmeterReading: true,
					isVoltmeterOpen: false
				};
			}
			return {
				isUnknownComp: false,
				displayVal: 'Open',
				isVoltmeterReading: true,
				isVoltmeterOpen: true
			};
		}

		const unknownTerm =
			getUnknownTerms(circuit.document.unknownProblem).find(
				(t) => t.componentId === comp.id
			) ?? null;
		if (!unknownTerm) {
			const displayVal = formatComponentDisplayValue(
				comp,
				circuit.document.mode,
				settings.unitSystem,
				circuit.document.components
			);
			return {
				isUnknownComp: false,
				displayVal,
				isDependentUnset: isDependentSourceKind(comp.kind) && displayVal === 'Set control'
			};
		}
		const unknownSym =
			circuit.document.unknownProblem?.symbol?.trim() || getDefaultUnknownSymbol(comp.kind);
		const unknownTermExpr = formatUnknownTermExpr(unknownTerm.multiplier, unknownSym);
		const unknownSolvedTermValueString =
			circuit.solution.unknownSolution?.valid &&
			circuit.solution.unknownSolution.solutions.length > 0
				? (circuit.solution.unknownSolution.solutions[0].termValues?.find(
						(tv) => tv.componentId === comp.id
					)?.valueString ?? circuit.solution.unknownSolution.solutions[0].valueString)
				: null;
		const unknownSolvedVal = unknownSolvedTermValueString
			? formatComponentDisplayValue(
					{
						...comp,
						value: unknownSolvedTermValueString,
						phaseDeg: undefined
					},
					circuit.document.mode,
					settings.unitSystem
				)
			: null;
		return {
			isUnknownComp: true,
			displayVal: unknownSolvedVal
				? `${unknownTermExpr}? (${unknownSolvedVal})`
				: `${unknownTermExpr} = ?`
		};
	}

	function getComponentLabelLayout(comp: CircuitComponent) {
		const isVertical = comp.rotation === 90 || comp.rotation === 270;
		if (comp.kind === 'ground') {
			return {
				labelX: 16,
				labelY: 11,
				valueX: 16,
				valueY: 23,
				anchor: 'start' as const,
				showValue: false
			};
		}
		if (comp.kind === 'terminal') {
			return {
				labelX: 0,
				labelY: -14,
				valueX: 0,
				valueY: 18,
				anchor: 'middle' as const,
				showValue: false
			};
		}
		if (isVertical) {
			return {
				labelX: 21,
				labelY: -3,
				valueX: 21,
				valueY: 10,
				anchor: 'start' as const,
				showValue: true
			};
		}
		return {
			labelX: 0,
			labelY: -36,
			valueX: 0,
			valueY: -22,
			anchor: 'middle' as const,
			showValue: true
		};
	}

	interface SelRect {
		x: number;
		y: number;
		width: number;
		height: number;
	}

	function unionRects(rects: SelRect[], pad = 0): SelRect {
		const x1 = Math.min(...rects.map((r) => r.x)) - pad;
		const y1 = Math.min(...rects.map((r) => r.y)) - pad;
		const x2 = Math.max(...rects.map((r) => r.x + r.width)) + pad;
		const y2 = Math.max(...rects.map((r) => r.y + r.height)) + pad;
		return { x: x1, y: y1, width: x2 - x1, height: y2 - y1 };
	}

	// Approximate glyph advance of the 11px mono designator text drawn by the canvas.
	const DESIGNATOR_CHAR_W = 6.6;

	function getSelectionRect(comp: CircuitComponent): SelRect {
		const cx = comp.x * GRID_SIZE;
		const cy = comp.y * GRID_SIZE;
		const labelW = comp.label.length * DESIGNATOR_CHAR_W + 4;

		if (comp.kind === 'ground') {
			let glyph: SelRect;
			if (comp.rotation === 90) glyph = { x: cx - 22, y: cy - 14, width: 28, height: 28 };
			else if (comp.rotation === 180) glyph = { x: cx - 14, y: cy - 22, width: 28, height: 28 };
			else if (comp.rotation === 270) glyph = { x: cx - 6, y: cy - 14, width: 28, height: 28 };
			else glyph = { x: cx - 14, y: cy - 6, width: 28, height: 28 };
			// Upright designator: start-anchored at (+16, baseline +11), see getComponentLabelLayout
			const label: SelRect = { x: cx + 14, y: cy + 1, width: labelW + 2, height: 14 };
			return unionRects([glyph, label], 2);
		}

		if (comp.kind === 'terminal') {
			const glyph: SelRect = { x: cx - 12, y: cy - 12, width: 24, height: 24 };
			// Upright designator: middle-anchored at (0, baseline -14)
			const label: SelRect = { x: cx - labelW / 2, y: cy - 25, width: labelW, height: 14 };
			// The symbol's own terminal-name text sits at (10.5, -7) and rotates with the symbol
			const name = comp.terminalName || comp.label;
			const nameW = name.length * 5.4 + 4;
			const rad = (comp.rotation * Math.PI) / 180;
			const [px, py] = [10.5, -10.5]; // glyph-box center of that text in the symbol frame
			const ncx = px * Math.cos(rad) - py * Math.sin(rad);
			const ncy = px * Math.sin(rad) + py * Math.cos(rad);
			const rotated = comp.rotation === 90 || comp.rotation === 270;
			const nw = rotated ? 11 : nameW;
			const nh = rotated ? nameW : 11;
			const nameRect: SelRect = { x: cx + ncx - nw / 2, y: cy + ncy - nh / 2, width: nw, height: nh };
			return unionRects([glyph, label, nameRect], 2);
		}

		// Two-terminal parts: ±18 across clears the source circles (r=15 + stroke) and matches the
		// click hitbox; the long axis spans both pins.
		const isVertical = comp.rotation === 90 || comp.rotation === 270;
		return {
			x: cx - (isVertical ? 18 : 42),
			y: cy - (isVertical ? 42 : 18),
			width: isVertical ? 36 : 84,
			height: isVertical ? 84 : 36
		};
	}

	const selectedDependentControlHighlight = $derived.by(() => {
		const sel = circuit.selectedComponent;
		if (!sel || !isDependentSourceKind(sel.kind) || !sel.controlRef) return null;
		const ref = sel.controlRef;
		const isV = isVoltageControlledSource(sel.kind);
		const rawVar = ref.controlVarName?.trim() || (isV ? 'v_x' : 'i_x');
		const varLabel = formatControlVarDisplay(rawVar);
		const accent = isV ? 'var(--voltage)' : 'var(--branch-current)';

		const targetCompId = isV ? ref.controlComponentId : ref.controlBranchComponentId;
		if (targetCompId) {
			const targetComp = circuit.document.components.find((c) => c.id === targetCompId);
			if (targetComp) {
				return {
					mode: 'component' as const,
					componentId: targetComp.id,
					varLabel,
					accent
				};
			}
		}

		if (isV && (ref.controlNodePos !== undefined || ref.controlNodeNeg !== undefined)) {
			const nodes: Array<{ nodeId: string; sign: '+' | '−'; pt: GridPoint }> = [];
			if (ref.controlNodePos) {
				const gNode = circuit.graph.nodes[ref.controlNodePos];
				if (gNode && gNode.gridPoints.length > 0) {
					nodes.push({ nodeId: ref.controlNodePos, sign: '+', pt: gNode.gridPoints[0] });
				}
			}
			if (ref.controlNodeNeg) {
				const gNode = circuit.graph.nodes[ref.controlNodeNeg];
				if (gNode && gNode.gridPoints.length > 0) {
					nodes.push({ nodeId: ref.controlNodeNeg, sign: '−', pt: gNode.gridPoints[0] });
				}
			}
			if (nodes.length > 0) {
				return {
					mode: 'nodes' as const,
					nodes,
					varLabel,
					accent
				};
			}
		}

		return null;
	});

	interface NodeOverlayItem {
		nodeId: string;
		xPx: number;
		yPx: number;
		anchorX: number;
		anchorY: number;
		pillWidth: number;
		text: string;
		isReference: boolean;
	}

	interface BranchOverlayItem {
		componentId: string;
		badgeX: number;
		badgeY: number;
		pillWidth: number;
		arrowX: number;
		arrowY: number;
		arrowAngleDeg: number;
		text: string;
	}

	const overlayLayout = $derived.by<{ nodes: NodeOverlayItem[]; branches: BranchOverlayItem[] }>(() => {
		if (!settings.showLiveOverlays || !circuit.solution.mna.valid || circuit.solution.mna.multiFrequencyHz) {
			return { nodes: [], branches: [] };
		}

		const theveninCompId =
			circuit.theveninTarget?.kind === 'component' ? circuit.theveninTarget.componentId : null;
		const obstacles = buildSchematicObstacles(
			circuit.document.components,
			circuit.document.wires,
			(c) => getComponentDisplayMeta(c).displayVal,
			theveninCompId
		);
		const placedPills: LayoutRect[] = [];
		const branches: BranchOverlayItem[] = [];

		for (const comp of circuit.document.components) {
			if (comp.kind === 'ground' || comp.kind === 'terminal' || comp.kind === 'voltmeter') continue;
			const branch = circuit.solution.mna.branches[comp.id];
			if (!branch) continue;

			let displayCurrent = branch.current;
			let reversed = false;
			if (circuit.document.mode === 'dc' && branch.current.re < -1e-12) {
				displayCurrent = Complex.from(-branch.current.re, 0);
				reversed = true;
			}

			const formattedI = formatComplexOverlay(displayCurrent, 'A', circuit.document.mode, {
				precision: settings.precision,
				angleDisplay: settings.angleDisplay,
				showDcFractions: settings.showDcFractions,
				unitSystem: settings.unitSystem
			});
			const pillWidth = Math.max(40, formattedI.length * 6.0 + 12);
			const pillHeight = 16;

			const arrowAngleDeg = (comp.rotation + (reversed ? 180 : 0)) % 360;
			const leadSign = reversed ? -1 : 1;
			const leadRad = (comp.rotation * Math.PI) / 180;
			const arrowX = comp.x * GRID_SIZE + Math.cos(leadRad) * 28 * leadSign;
			const arrowY = comp.y * GRID_SIZE + Math.sin(leadRad) * 28 * leadSign;

			const chosen = chooseBranchPillPosition(comp, pillWidth, pillHeight, obstacles, placedPills);
			placedPills.push(chosen.rect);

			branches.push({
				componentId: comp.id,
				badgeX: chosen.x,
				badgeY: chosen.y,
				pillWidth,
				arrowX,
				arrowY,
				arrowAngleDeg,
				text: formattedI
			});
		}

		const compCenters = new Set(circuit.document.components.map((c) => `${c.x},${c.y}`));
		const nodes: NodeOverlayItem[] = [];

		const sortedNodes = Object.values(circuit.solution.mna.nodeVoltages).sort((a, b) => {
			if (a.isReference !== b.isReference) return a.isReference ? 1 : -1;
			return a.nodeId.localeCompare(b.nodeId, undefined, { numeric: true });
		});

		for (const node of sortedNodes) {
			if (node.gridPoints.length === 0) continue;

			let pool = node.gridPoints;
			if (node.isReference) {
				const gndComp = circuit.document.components.find((c) => c.kind === 'ground');
				if (gndComp) {
					pool = [{ x: gndComp.x, y: gndComp.y }];
				}
			}

			const formattedV = node.isReference
				? '0 V'
				: formatComplexOverlay(node.voltage, 'V', circuit.document.mode, {
						precision: settings.precision,
						angleDisplay: settings.angleDisplay,
						showDcFractions: settings.showDcFractions,
						unitSystem: settings.unitSystem
					});
			const text = node.isReference ? 'GND · 0 V' : `${node.nodeId}: ${formattedV}`;
			const pillWidth = Math.max(42, text.length * 6.2 + 12);
			const pillHeight = 17;

			const chosen = chooseNodePillPosition(
				pool,
				node.isReference,
				pillWidth,
				pillHeight,
				compCenters,
				obstacles,
				placedPills
			);
			placedPills.push(chosen.rect);

			nodes.push({
				nodeId: node.nodeId,
				xPx: chosen.x,
				yPx: chosen.y,
				anchorX: chosen.anchorX,
				anchorY: chosen.anchorY,
				pillWidth,
				text,
				isReference: node.isReference
			});
		}

		return { nodes, branches };
	});

	const nodeOverlays = $derived(overlayLayout.nodes);
	const branchOverlays = $derived(overlayLayout.branches);

	const activeToolHint = $derived.by(() => {
		if (wireStart) {
			return 'Click endpoint to complete wire · Space/Tab: Flip bend · Esc: Cancel';
		}
		if (circuit.activeTool === 'wire') {
			return 'Click pin or grid point to start orthogonal wire · Esc: Select';
		}
		if (circuit.activeTool === 'probe') {
			return 'Click any node or wire to inspect voltage · Esc: Select';
		}
		if (isPlacementTool(circuit.activeTool)) {
			const name =
				PALETTE_ITEMS.find((p) => p.kind === circuit.activeTool)?.name ?? circuit.activeTool;
			return `Click grid to place ${name} · R: Rotate (${circuit.placementRotation}°) · Esc: Cancel`;
		}
		return 'Drag components · Click any pin to wire · R: Rotate · Del: Delete';
	});

	const activeToolLabel = $derived.by(() => {
		if (circuit.activeTool === 'wire') return 'Wire';
		if (circuit.activeTool === 'probe') return 'Probe';
		if (circuit.activeTool === 'voltage_source') {
			return circuit.activeSourceMode === 'ac' ? 'AC Source' : 'DC Source';
		}
		if (circuit.activeTool === 'current_source') {
			return circuit.activeSourceMode === 'ac' ? 'AC Current' : 'DC Current';
		}
		return PALETTE_ITEMS.find((p) => p.kind === circuit.activeTool)?.name ?? circuit.activeTool;
	});

	const probedNodeData = $derived.by(() => {
		const nid = hoveredNodeId ?? pinnedProbeNodeId;
		if (!nid || !circuit.solution.mna.valid || circuit.solution.mna.multiFrequencyHz) return null;
		const res = circuit.solution.mna.nodeVoltages[nid];
		if (!res) return null;
		return {
			nodeId: nid,
			formatted: res.isReference
				? '0 V'
				: formatComplexOverlay(res.voltage, 'V', circuit.document.mode, {
						precision: settings.precision,
						angleDisplay: settings.angleDisplay,
						showDcFractions: settings.showDcFractions,
						unitSystem: settings.unitSystem
					})
		};
	});
	// Node rename (probe bar). The target is held as a pin anchor, so it survives hover changes
	// and the node-ID renumbering that follows a rename.
	let renameTarget = $state<{ componentId: string; pinIndex: number } | null>(null);
	let renameValue = $state('');
	let renameError = $state<string | null>(null);
	const renameNodeId = $derived(
		renameTarget
			? (circuit.graph.componentNodes[renameTarget.componentId]?.[renameTarget.pinIndex] ?? null)
			: null
	);
	const probedNodeRenamable = $derived(
		probedNodeData !== null && circuit.graph.nodes[probedNodeData.nodeId]?.isReference === false
	);

	function startNodeRename(nodeId: string): void {
		const pin = circuit.graph.nodes[nodeId]?.componentPins[0];
		if (!pin || circuit.graph.nodes[nodeId].isReference) return;
		hoveredNodeId = null;
		pinProbeNode(nodeId);
		renameTarget = { componentId: pin.componentId, pinIndex: pin.pinIndex };
		renameValue = nodeId;
		renameError = null;
		void tick().then(() => {
			const el = document.getElementById('node-rename-input') as HTMLInputElement | null;
			el?.focus();
			el?.select();
		});
	}

	function cancelNodeRename(): void {
		renameTarget = null;
		renameError = null;
	}

	function commitNodeRename(): void {
		if (!renameNodeId) {
			cancelNodeRename();
			return;
		}
		hoveredNodeId = null;
		const error = circuit.renameNode(renameNodeId, renameValue);
		if (error) {
			renameError = error;
			return;
		}
		cancelNodeRename();
	}

	$effect(() => {
		if (circuit.activeTool !== 'probe' && renameTarget) cancelNodeRename();
	});

	function handleRenameKeyDown(e: KeyboardEvent): void {
		if (e.key === 'Enter') {
			e.preventDefault();
			commitNodeRename();
		} else if (e.key === 'Escape') {
			e.preventDefault();
			cancelNodeRename();
		}
	}
</script>

<svelte:window
	onkeydown={handleKeyDown}
	onkeyup={handleKeyUp}
	onblur={() => {
		// The Space keyup never arrives if the window loses focus while Space is held
		spaceHeld = false;
	}}
	onpointerup={(e) => {
		if (activePointers.has(e.pointerId)) {
			handlePointerUp(e);
		}
	}}
	onpointercancel={(e) => {
		if (activePointers.has(e.pointerId)) {
			handlePointerCancel(e);
		}
	}}
/>

<svelte:document
	onvisibilitychange={() => {
		if (document.hidden) spaceHeld = false;
	}}
/>

<div
	bind:this={containerEl}
	class={cn(
		'flex min-h-0 flex-1 flex-col overflow-hidden bg-background select-none',
		className
	)}
>
	<!-- Mobile & Tablet Flush Top Telemetry & Quick-Actions Strip (< lg) -->
	<div class="flex min-h-11 shrink-0 items-center justify-between gap-2 border-b border-border bg-surface-rail px-2.5 text-[11px] lg:hidden">
		<div class="flex min-w-0 items-center gap-1.5 font-engineering">
			{#if localCrossingFeedback}
				<span role="status" aria-live="polite" class="truncate text-foreground">
					{localCrossingFeedback}
				</span>
			{:else}
				{#if circuit.document.components.length === 0}
					<span class="h-1.5 w-1.5 shrink-0 rounded-full bg-muted-foreground/50 sm:hidden" aria-hidden="true"></span>
				{:else if hasErrors}
					<span class="h-1.5 w-1.5 shrink-0 rounded-full bg-destructive sm:hidden" aria-hidden="true"></span>
				{:else if circuit.solution.mna.valid}
					<span class="h-1.5 w-1.5 shrink-0 rounded-full bg-branch-current sm:hidden" aria-hidden="true"></span>
				{:else}
					<span class="h-1.5 w-1.5 shrink-0 rounded-full bg-warning sm:hidden" aria-hidden="true"></span>
				{/if}
				<span class="whitespace-nowrap text-voltage">
					{nodeCount} {nodeCount === 1 ? 'Node' : 'Nodes'}
				</span>
				<span class="hidden text-muted-foreground/60 sm:inline" aria-hidden="true">·</span>
				<span class="hidden whitespace-nowrap text-muted-foreground sm:inline">
					Snap: <span class="text-foreground">{settings.snapToGrid ? 'ON' : 'OFF'}</span>
				</span>
				<span class="hidden text-muted-foreground/60 sm:inline" aria-hidden="true">·</span>
				<span class="hidden whitespace-nowrap text-muted-foreground sm:inline">
					{Math.round(zoom * 100)}%
				</span>
			{/if}
		</div>

		<div class="flex shrink-0 items-center gap-1">
			<button
				type="button"
				aria-label="Auto-wire unconnected pins"
				disabled={circuit.document.components.length < 2}
				onclick={triggerAutoWire}
				class="inline-flex min-h-11 shrink-0 cursor-pointer items-center gap-1 rounded-[4px] border border-transparent px-2 text-xs font-medium text-foreground transition-colors duration-150 hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-40"
			>
				<Cable class="size-3.5 shrink-0 text-primary" aria-hidden="true" />
				<span>Auto-Wire</span>
			</button>
			<button
				type="button"
				aria-label="Clear canvas"
				disabled={circuit.document.components.length === 0 && circuit.document.wires.length === 0}
				onclick={() => circuit.clearCircuit()}
				class="inline-flex min-h-11 shrink-0 cursor-pointer items-center gap-1 rounded-[4px] border border-transparent px-2 text-xs font-medium text-destructive transition-colors duration-150 hover:bg-destructive/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-40"
			>
				<Eraser class="size-3.5 shrink-0" aria-hidden="true" />
				<span>Clear</span>
			</button>
		</div>
	</div>

	<!-- Flush Top Contextual Strip (only when wiring, placing, wire-tool, or probing) -->
	{#if wireStart !== null}
		<div
			role="region"
			aria-label="Active wire controls"
			class="flex shrink-0 items-center justify-between gap-2 border-b border-border bg-card px-3 py-1"
		>
			<div class="flex min-w-0 items-center gap-1.5 text-xs">
				<span class="h-1.5 w-1.5 shrink-0 rounded-full bg-primary" aria-hidden="true"></span>
				<span class="truncate font-medium text-foreground">
					Wiring<span class="hidden font-normal text-muted-foreground sm:inline">{' · Tap pin or grid'}</span>
				</span>
			</div>
			<div class="flex shrink-0 items-center gap-1">
				<Button
					variant="secondary"
					size="sm"
					class="min-h-11 shrink-0 gap-1 px-2.5 text-xs lg:min-h-0 lg:h-6 lg:px-2"
					aria-label="Flip wire bend direction"
					onclick={() => {
						wireBendMode = wireBendMode === 'hv' ? 'vh' : 'hv';
					}}
				>
					<CornerDownRight class="size-3.5" aria-hidden="true" />
					<span>Flip Bend</span>
					<span class="font-engineering text-[10px] text-muted-foreground uppercase">
						{wireBendMode}
					</span>
				</Button>
				<Button
					variant="ghost"
					size="sm"
					class="min-h-11 shrink-0 gap-1 px-2.5 text-xs text-destructive hover:bg-destructive/10 hover:text-destructive lg:min-h-0 lg:h-6 lg:px-2"
					aria-label="Cancel wiring"
					onclick={() => {
						wireStart = null;
						wireStartedFromSelect = false;
						wireDragOrigin = null;
					}}
				>
					<X class="size-3.5" aria-hidden="true" />
					<span>Cancel</span>
				</Button>
			</div>
		</div>
	{:else if isPlacementTool(circuit.activeTool)}
		<div
			role="region"
			aria-label="Active tool controls"
			class="flex shrink-0 items-center justify-between gap-2 border-b border-border bg-card px-3 py-1"
		>
			<div class="flex min-w-0 items-center gap-2 text-xs">
				<CircuitSymbol
					kind={circuit.activeTool}
					variant="icon"
					sourceMode={circuit.activeSourceMode}
					size={18}
					terminalLabel={circuit.activeTool === 'terminal' ? 'A' : undefined}
					class="shrink-0 text-primary"
				/>
				<span class="truncate font-medium text-foreground">
					Place {activeToolLabel}
					<span class="font-engineering text-[11px] font-normal text-muted-foreground">
						{' · '}{circuit.placementRotation}°
					</span>
				</span>
			</div>
			<div class="flex shrink-0 items-center gap-1">
				<Button
					variant="secondary"
					size="sm"
					class="min-h-11 shrink-0 gap-1 px-2.5 text-xs lg:min-h-0 lg:h-6 lg:px-2"
					aria-label="Rotate placement 90 degrees"
					onclick={() => circuit.rotatePlacement()}
				>
					<RotateCw class="size-3.5" aria-hidden="true" />
					<span>Rotate 90°</span>
				</Button>
				<Button
					variant="ghost"
					size="sm"
					class="min-h-11 shrink-0 gap-1 px-2.5 text-xs lg:min-h-0 lg:h-6 lg:px-2"
					aria-label="Exit active tool"
					onclick={() => circuit.setActiveTool('select')}
				>
					<X class="size-3.5" aria-hidden="true" />
					<span>Done</span>
				</Button>
			</div>
		</div>
	{:else if circuit.activeTool === 'wire'}
		<div
			role="region"
			aria-label="Active tool controls"
			class="flex shrink-0 items-center justify-between gap-2 border-b border-border bg-card px-3 py-1"
		>
			<div class="flex min-w-0 items-center gap-1.5 text-xs">
				<span class="h-1.5 w-1.5 shrink-0 rounded-full bg-primary" aria-hidden="true"></span>
				<span class="truncate font-medium text-foreground">
					Orthogonal Wire<span class="hidden font-normal text-muted-foreground sm:inline">{' · Drag or tap pins'}</span>
				</span>
			</div>
			<Button
				variant="ghost"
				size="sm"
				class="min-h-11 shrink-0 gap-1 px-2.5 text-xs lg:min-h-0 lg:h-6 lg:px-2"
				aria-label="Exit active tool"
				onclick={() => {
					wireStart = null;
					wireStartedFromSelect = false;
					wireDragOrigin = null;
					circuit.setActiveTool('select');
				}}
			>
				<X class="size-3.5" aria-hidden="true" />
				<span>Done</span>
			</Button>
		</div>
	{:else if circuit.activeTool === 'probe'}
		<div
			role="region"
			aria-label="Active tool controls"
			class="flex shrink-0 items-center justify-between gap-2 border-b border-border bg-card px-3 py-1"
		>
			<div class="flex min-w-0 items-center gap-1.5 text-xs">
				<span class="h-1.5 w-1.5 shrink-0 rounded-full bg-voltage" aria-hidden="true"></span>
				{#if renameTarget && renameNodeId}
					<span class="shrink-0 text-muted-foreground">Node</span>
					<Input
						id="node-rename-input"
						bind:value={renameValue}
						tabular
						error={renameError !== null}
						maxlength={6}
						autocomplete="off"
						autocapitalize="off"
						spellcheck={false}
						placeholder="e.g. Vo"
						aria-label="Node name"
						aria-describedby={renameError ? 'node-rename-error' : undefined}
						class="w-20 shrink-0 lg:h-6"
						oninput={() => (renameError = null)}
						onkeydown={handleRenameKeyDown}
					/>
					{#if renameError}
						<span id="node-rename-error" role="alert" class="truncate text-destructive">
							{renameError}
						</span>
					{/if}
				{:else if probedNodeData}
					<span class="truncate text-muted-foreground">
						Node <span class="font-engineering font-semibold text-foreground">{probedNodeData.nodeId}:</span>{' '}
						<span class="font-engineering font-semibold text-voltage">
							{probedNodeData.formatted}
						</span>
					</span>
				{:else}
					<span class="truncate font-medium text-foreground">
						Node Voltage Probe<span class="hidden font-normal text-muted-foreground sm:inline">{' · Tap any node or wire'}</span>
					</span>
				{/if}
			</div>
			<div class="flex shrink-0 items-center gap-0.5">
				{#if renameTarget && renameNodeId}
					<Button
						variant="ghost"
						size="sm"
						class="min-h-11 shrink-0 gap-1 px-2.5 text-xs lg:min-h-0 lg:h-6 lg:px-2"
						aria-label="Save node name"
						onclick={commitNodeRename}
					>
						<Check class="size-3.5" aria-hidden="true" />
						<span class="hidden sm:inline">Save</span>
					</Button>
					<Button
						variant="ghost"
						size="sm"
						class="min-h-11 shrink-0 gap-1 px-2.5 text-xs lg:min-h-0 lg:h-6 lg:px-2"
						aria-label="Cancel renaming"
						onclick={cancelNodeRename}
					>
						<X class="size-3.5" aria-hidden="true" />
						<span class="hidden sm:inline">Cancel</span>
					</Button>
				{:else}
					{#if probedNodeData && probedNodeRenamable}
						<Button
							variant="ghost"
							size="sm"
							class="min-h-11 shrink-0 px-2.5 text-xs lg:min-h-0 lg:h-6 lg:px-2"
							aria-label="Rename node {probedNodeData.nodeId}"
							onclick={() => probedNodeData && startNodeRename(probedNodeData.nodeId)}
						>
							Rename
						</Button>
					{/if}
					<Button
						variant="ghost"
						size="sm"
						class="min-h-11 shrink-0 gap-1 px-2.5 text-xs lg:min-h-0 lg:h-6 lg:px-2"
						aria-label="Exit active tool"
						onclick={() => circuit.setActiveTool('select')}
					>
						<X class="size-3.5" aria-hidden="true" />
						<span>Done</span>
					</Button>
				{/if}
			</div>
		</div>
	{/if}

	<!-- Unobstructed Interactive SVG Stage -->
	<div
		bind:clientWidth={viewportW}
		bind:clientHeight={viewportH}
		class="relative min-h-0 flex-1 overflow-hidden"
	>
	<!-- Interactive SVG Canvas -->
	<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
	<svg
		bind:this={svgEl}
		role="application"
		aria-label="Interactive circuit schematic editor"
		onwheel={handleWheel}
		onpointerdown={handleBackgroundPointerDown}
		onpointermove={handlePointerMove}
		onpointerup={handlePointerUp}
		onpointercancel={handlePointerCancel}
		onpointerleave={(e) => {
			if (e.pointerType === 'mouse') {
				hoverGrid = null;
				hoverSnappedPin = null;
				if (dragState && dragState.pointerId === e.pointerId) {
					handlePointerUp(e);
				}
			}
		}}
		oncontextmenu={(e) => e.preventDefault()}
		class={cn(
			'h-full w-full touch-none outline-none',
			spaceHeld || dragState?.kind === 'pan'
				? 'cursor-grab active:cursor-grabbing'
				: circuit.activeTool === 'wire' || wireStart
					? 'cursor-crosshair'
					: isPlacementTool(circuit.activeTool)
						? 'cursor-copy'
						: 'cursor-default'
		)}
	>
		<defs>
			<pattern
				id="circuit-dot-grid"
				width={GRID_SIZE * 5}
				height={GRID_SIZE * 5}
				patternUnits="userSpaceOnUse"
			>
				<!-- Minor 20px dots inside 100px cell -->
				{#each [0, 1, 2, 3, 4] as ix}
					{#each [0, 1, 2, 3, 4] as iy}
						<circle
							cx={ix * GRID_SIZE}
							cy={iy * GRID_SIZE}
							r="0.95"
							fill="var(--canvas-dot)"
						/>
					{/each}
				{/each}
				<!-- Major 100px grid hairlines -->
				<path
					d="M {GRID_SIZE * 5} 0 L 0 0 0 {GRID_SIZE * 5}"
					fill="none"
					stroke="var(--canvas-major)"
					stroke-width="1"
				/>
			</pattern>
		</defs>

		<g
			transform="translate({pan.x}, {pan.y}) scale({zoom})"
			data-gesturing={isViewportGesturing ? 'true' : undefined}
		>
			<!-- World Grid Plane -->
			{#if settings.showGrid}
				<rect
					x="-10000"
					y="-10000"
					width="20000"
					height="20000"
					fill="url(#circuit-dot-grid)"
					pointer-events="none"
				/>
			{/if}

			<!-- Wires (with IEEE bridge-hop arcs over unconnected orthogonal crossings) -->
			{#each circuit.document.wires as wire (wire.id)}
				{@const isSelected = circuit.selectedWireId === wire.id}
				{@const wirePath = buildWirePathWithBridges(
					wire.points,
					unconnectedCrossingSet,
					GRID_SIZE
				)}
				<g
					role="button"
					tabindex="-1"
					aria-label="Wire {wire.id}"
					class="cursor-pointer outline-none"
					onpointerdown={(e) => handleWirePointerDown(e, wire)}
				>
					{#if isSelected}
						<path
							d={wirePath}
							fill="none"
							stroke="var(--warning)"
							stroke-width="6"
							stroke-opacity="0.3"
							stroke-linecap="round"
							stroke-linejoin="round"
						/>
					{/if}
					<path
						d={wirePath}
						fill="none"
						stroke={isSelected ? 'var(--warning)' : 'currentColor'}
						stroke-width={isSelected ? '2.5' : '2'}
						stroke-linecap="round"
						stroke-linejoin="round"
						class="text-foreground transition-colors duration-100"
					/>
					<!-- Wide transparent hit area (scales for >=28px screen touch target) -->
					<path
						d={wirePath}
						fill="none"
						stroke="transparent"
						stroke-width={wireHitStrokeWidth}
						stroke-linecap="round"
						stroke-linejoin="round"
					/>
				</g>
			{/each}

			<!-- Crisp IEEE Bridge-Hop Background Halos & Overpass Arcs -->
			{#if unconnectedCrossings.length > 0}
				<g pointer-events="none" class="text-foreground">
					{#each unconnectedCrossings as crossing (`bridge-${crossing.x},${crossing.y}`)}
						{@const arcD = buildBridgeArcPath(crossing.x, crossing.y, GRID_SIZE)}
						{@const isHorizSelected = isHorizontalWireAtCrossing(
							circuit.selectedWire,
							crossing.x,
							crossing.y
						)}
						{#if isHorizSelected}
							<path
								d={arcD}
								fill="none"
								stroke="var(--warning)"
								stroke-width="6"
								stroke-opacity="0.3"
								stroke-linecap="round"
							/>
						{/if}
						<path
							d={arcD}
							fill="none"
							stroke="var(--background)"
							stroke-width="5.5"
							stroke-linecap="butt"
						/>
						<path
							d={arcD}
							fill="none"
							stroke={isHorizSelected ? 'var(--warning)' : 'currentColor'}
							stroke-width={isHorizSelected ? '2.5' : '2'}
							stroke-linecap="round"
						/>
					{/each}
				</g>
			{/if}

			<!-- Interactive Dangling (Open) Wire Endpoints (click/drag to continue wiring) -->
			{#if danglingEndpoints.length > 0}
				<g class="dangling-wire-endpoints text-foreground">
					{#each danglingEndpoints as ep (`ep-${ep.x},${ep.y}`)}
						{@const isSnapped = hoverSnappedPin?.x === ep.x && hoverSnappedPin?.y === ep.y}
						{@const isWireSelected = circuit.selectedWireId === ep.wireId}
						{@const isInteractive =
							!isPlacementTool(circuit.activeTool) && circuit.activeTool !== 'probe'}
						<g
							role="button"
							tabindex="-1"
							aria-label="Open wire endpoint at ({ep.x}, {ep.y}) — click or drag to continue wiring"
							data-wire-endpoint={`${ep.x},${ep.y}`}
							class={cn(
								'outline-none',
								isInteractive ? 'cursor-crosshair' : 'pointer-events-none'
							)}
							onpointerdown={(e) => handleWireEndpointPointerDown(e, ep.wireId, ep)}
						>
							<title>Open wire endpoint — click or drag to continue wiring</title>
							<circle
								cx={ep.x * GRID_SIZE}
								cy={ep.y * GRID_SIZE}
								r={isTouchInteraction ? 18 : 12}
								fill="transparent"
							/>
							<circle
								cx={ep.x * GRID_SIZE}
								cy={ep.y * GRID_SIZE}
								r={isSnapped || isWiringMode ? 4.5 : 3.75}
								fill={isSnapped ? 'var(--primary)' : 'var(--background)'}
								stroke={isSnapped || isWiringMode
									? 'var(--primary)'
									: isWireSelected
										? 'var(--warning)'
										: 'currentColor'}
								stroke-width={isSnapped ? 2 : 1.5}
								pointer-events="none"
							/>
						</g>
					{/each}
				</g>
			{/if}

			<!-- Live Orthogonal Wire Preview -->
			{#if wireStart && wirePreviewPoints.length >= 1}
				<g pointer-events="none">
					{#if wirePreviewPoints.length >= 2}
						<path
							d={wirePreviewPath}
							fill="none"
							stroke="var(--primary)"
							stroke-width="2"
							stroke-dasharray="5 3"
							stroke-linecap="round"
							stroke-linejoin="round"
						/>
					{/if}
					{#each wirePreviewVerticalCrossings as crossing (`preview-bridge-${crossing.x},${crossing.y}`)}
						{@const arcD = buildBridgeArcPath(crossing.x, crossing.y, GRID_SIZE)}
						<path
							d={arcD}
							fill="none"
							stroke="var(--background)"
							stroke-width="5.5"
							stroke-linecap="butt"
						/>
						<path
							d={arcD}
							fill="none"
							stroke="var(--primary)"
							stroke-width="2"
							stroke-linecap="round"
						/>
					{/each}
					<circle
						cx={wireStart.x * GRID_SIZE}
						cy={wireStart.y * GRID_SIZE}
						r="4"
						fill="var(--primary)"
					/>
					{#if hoverSnappedPin || hoverGrid}
						{@const endPt = hoverSnappedPin ?? hoverGrid!}
						{#if hoverSnappedPin}
							<circle
								cx={endPt.x * GRID_SIZE}
								cy={endPt.y * GRID_SIZE}
								r="8.5"
								fill="var(--primary)"
								fill-opacity="0.14"
								stroke="var(--primary)"
								stroke-width="1.5"
							/>
						{/if}
						<circle
							cx={endPt.x * GRID_SIZE}
							cy={endPt.y * GRID_SIZE}
							r={hoverSnappedPin ? 5 : 3.5}
							fill={hoverSnappedPin ? 'var(--card)' : 'var(--primary)'}
							stroke="var(--primary)"
							stroke-width="2"
						/>
					{/if}
				</g>
			{/if}

			<!-- Automatic Junction Dots (3+ segments/pins meeting; 3.8px on connected 4-way crossings) -->
			<g pointer-events="none" class="text-foreground">
				{#each junctions as jpt (`${jpt.x},${jpt.y}`)}
					<circle
						cx={jpt.x * GRID_SIZE}
						cy={jpt.y * GRID_SIZE}
						r={connectedCrossingSet.has(`${jpt.x},${jpt.y}`) ? 3.8 : 3.5}
						fill="currentColor"
					/>
				{/each}
			</g>

			<!-- Interactive Orthogonal Wire Crossing Toggle Hit Targets (Select Mode) -->
			{#if circuit.activeTool === 'select' && !wireStart && wireCrossings.length > 0}
				<g>
					{#each wireCrossings as crossing (`crossing-${crossing.x},${crossing.y}`)}
						{@const key = `${crossing.x},${crossing.y}`}
						{@const isHovered = hoveredCrossingKey === key}
						<g
							role="button"
							tabindex="-1"
							class="cursor-pointer outline-none"
							data-wire-crossing={key}
							data-crossing-connected={crossing.connected ? 'true' : 'false'}
							aria-label={crossing.connected
								? `Connected junction at (${crossing.x}, ${crossing.y}) — click to disconnect (bridge over)`
								: `Unconnected crossing at (${crossing.x}, ${crossing.y}) — click to connect (add junction)`}
							transform="translate({crossing.x * GRID_SIZE}, {crossing.y * GRID_SIZE})"
							onpointerdown={(e) => handleCrossingPointerDown(e, crossing)}
							onpointerenter={() => {
								hoveredCrossingKey = key;
							}}
							onpointerleave={() => {
								if (hoveredCrossingKey === key) hoveredCrossingKey = null;
							}}
						>
							<title>
								{crossing.connected
									? 'Connected junction — click to disconnect (bridge over)'
									: 'Unconnected crossing — click to connect (add junction)'}
							</title>
							{#if isHovered}
								<circle
									cx="0"
									cy="0"
									r="10"
									fill="var(--primary)"
									fill-opacity="0.08"
									stroke="var(--primary)"
									stroke-width="1.5"
									stroke-dasharray="3 2"
									pointer-events="none"
								/>
							{/if}
							<circle
								cx="0"
								cy="0"
								r={isTouchInteraction ? 18 : 12}
								fill="transparent"
							/>
						</g>
					{/each}
				</g>
			{/if}

			<!-- Components -->
			{#each circuit.document.components as comp (comp.id)}
				{@const isDraggingThis = dragPreview?.componentId === comp.id}
				{@const renderX = isDraggingThis ? dragPreview!.x : comp.x}
				{@const renderY = isDraggingThis ? dragPreview!.y : comp.y}
				{@const renderComp = isDraggingThis ? { ...comp, x: renderX, y: renderY } : comp}
				{@const isSelected = circuit.selectedComponentId === comp.id}
				{@const isThevenin =
					circuit.theveninTarget?.kind === 'component' &&
					circuit.theveninTarget.componentId === comp.id}
				{@const displayMeta = getComponentDisplayMeta(comp)}
				{@const isUnknownComp = displayMeta.isUnknownComp}
				{@const pins = getPinPositions(renderComp)}
				{@const labelLayout = getComponentLabelLayout(renderComp)}
				{@const displayVal = displayMeta.displayVal}
				{@const isVertical = comp.rotation === 90 || comp.rotation === 270}
				{@const isOnePinComp = comp.kind === 'ground' || comp.kind === 'terminal'}
				{@const hitHalfW = isOnePinComp ? 18 : isVertical ? 18 : 34}
				{@const hitHalfH = isOnePinComp ? 18 : isVertical ? 34 : 18}
				<g
					role="button"
					tabindex="-1"
					aria-label="{comp.label} ({comp.kind})"
					data-component-id={comp.id}
					class={cn(
						'outline-none',
						circuit.activeTool === 'select' && !wireStart
							? 'cursor-move'
							: 'cursor-pointer'
					)}
					onpointerdown={(e) => handleComponentPointerDown(e, comp)}
					ondblclick={(e) => {
						if (lastPointerType !== 'mouse') return;
						e.stopPropagation();
						circuit.rotateComponent(comp.id);
					}}
				>
					<!-- Selection Highlight Ring -->
					{#if isSelected}
						{@const selRect = getSelectionRect(renderComp)}
						<rect
							x={selRect.x}
							y={selRect.y}
							width={selRect.width}
							height={selRect.height}
							rx="4"
							fill="var(--warning)"
							fill-opacity="0.08"
							stroke="var(--warning)"
							stroke-width="1.5"
							stroke-dasharray="4 3"
							pointer-events="none"
						/>
					{:else if selectedDependentControlHighlight?.mode === 'component' && selectedDependentControlHighlight.componentId === comp.id}
						{@const ctrlRect = getSelectionRect(renderComp)}
						<g pointer-events="none" data-control-highlight={comp.id}>
							<rect
								x={ctrlRect.x - 2}
								y={ctrlRect.y - 2}
								width={ctrlRect.width + 4}
								height={ctrlRect.height + 4}
								rx="4"
								fill={selectedDependentControlHighlight.accent}
								fill-opacity="0.06"
								stroke={selectedDependentControlHighlight.accent}
								stroke-width="1.5"
								stroke-dasharray="3 2.5"
							/>
							<rect
								x={ctrlRect.x + ctrlRect.width - 20}
								y={ctrlRect.y - 16}
								width="24"
								height="13"
								rx="3"
								fill="var(--card)"
								stroke={selectedDependentControlHighlight.accent}
								stroke-width="1"
							/>
							<text
								x={ctrlRect.x + ctrlRect.width - 8}
								y={ctrlRect.y - 6.5}
								text-anchor="middle"
								fill={selectedDependentControlHighlight.accent}
								font-family="var(--font-mono)"
								font-size="9"
								font-weight="600"
							>
								{selectedDependentControlHighlight.varLabel}
							</text>
						</g>
					{/if}

					<!-- Invisible generous click hitbox -->
					<rect
						x={renderX * GRID_SIZE - hitHalfW}
						y={renderY * GRID_SIZE - hitHalfH}
						width={hitHalfW * 2}
						height={hitHalfH * 2}
						fill="transparent"
					/>

					<!-- Unified CircuitSymbol -->
					<g
						transform="translate({renderX * GRID_SIZE}, {renderY * GRID_SIZE}) rotate({comp.rotation})"
						class={cn(
							'transition-colors duration-100',
							isSelected ? 'text-warning' : 'text-foreground'
						)}
					>
						<CircuitSymbol
							kind={comp.kind}
							variant="schematic"
							asGroup={true}
							rotation={comp.rotation}
							sourceMode={getSourceModeForComp(comp)}
							terminalLabel={comp.terminalName || comp.label}
						/>
					</g>

					<!-- Upright Counter-Rotated Designator & Value -->
					<g
						transform="translate({renderX * GRID_SIZE}, {renderY * GRID_SIZE})"
						pointer-events="none"
					>
						<text
							x={labelLayout.labelX}
							y={labelLayout.labelY}
							text-anchor={labelLayout.anchor}
							fill="var(--foreground)"
							font-family="var(--font-mono)"
							font-size="11"
							font-weight="600"
						>
							{comp.label}
						</text>
						{#if labelLayout.showValue && displayVal}
							<text
								x={labelLayout.valueX}
								y={labelLayout.valueY}
								text-anchor={labelLayout.anchor}
								fill={displayMeta.isVoltmeterReading
									? displayMeta.isVoltmeterOpen
										? 'var(--muted-foreground)'
										: 'var(--voltage)'
									: isUnknownComp || displayMeta.isDependentUnset
										? 'var(--warning)'
										: 'var(--muted-foreground)'}
								font-family="var(--font-mono)"
								font-size={displayMeta.isVoltmeterReading ? '10.5' : '10'}
								font-weight={isUnknownComp ||
								displayMeta.isDependentUnset ||
								(displayMeta.isVoltmeterReading && !displayMeta.isVoltmeterOpen)
									? '600'
									: undefined}
								style="font-variant-numeric: tabular-nums;"
							>
								{displayVal}
							</text>
						{/if}
					</g>

					<!-- Thévenin Load Target Badge -->
					{#if isThevenin}
						<g
							transform="translate({renderX * GRID_SIZE}, {renderY * GRID_SIZE - (isVertical ? 52 : 54)})"
							pointer-events="none"
						>
							<rect
								x="-48"
								y="-9"
								width="96"
								height="17"
								rx="3"
								fill="var(--card)"
								stroke="var(--warning)"
								stroke-width="1"
							/>
							<text
								x="0"
								y="3"
								text-anchor="middle"
								fill="var(--warning)"
								font-family="var(--font-sans)"
								font-size="9.5"
								font-weight="600"
							>
								Load (Thévenin)
							</text>
						</g>
					{/if}

					<!-- Interactive Pin Circles -->
					{#each pins as pin (pin.index)}
						{@const isSnappedPin = hoverSnappedPin?.x === pin.x && hoverSnappedPin?.y === pin.y}
						<g
							role="button"
							tabindex="-1"
							aria-label="{comp.label} pin {pin.name}"
							class="group/pin cursor-crosshair outline-none"
							onpointerdown={(e) => handlePinPointerDown(e, comp, pin.x, pin.y)}
						>
							<circle
								cx={pin.x * GRID_SIZE}
								cy={pin.y * GRID_SIZE}
								r={isWiringMode || circuit.activeTool === 'probe' ? pinHitRadiusWorld : 8}
								fill="transparent"
							/>
							<circle
								cx={pin.x * GRID_SIZE}
								cy={pin.y * GRID_SIZE}
								r={isWiringMode ? 4.2 : 3}
								fill={isSnappedPin ? 'var(--primary)' : 'var(--card)'}
								stroke={isSnappedPin || isWiringMode
									? 'var(--primary)'
									: 'var(--muted-foreground)'}
								stroke-width={isWiringMode ? 1.75 : 1.5}
								class={cn(
									'transition-opacity duration-100',
									isWiringMode || isSnappedPin
										? 'opacity-100'
										: 'opacity-70 group-hover/pin:opacity-100'
								)}
							/>
						</g>
					{/each}
				</g>
			{/each}

			<!-- Ghost Placement Preview (mouse hover or touch drag-to-place) -->
			{#if isPlacementTool(circuit.activeTool) && (placementPreview || hoverGrid)}
				{@const ghostPt = placementPreview ?? hoverGrid!}
				<g
					transform="translate({ghostPt.x * GRID_SIZE}, {ghostPt.y * GRID_SIZE})"
					pointer-events="none"
				>
					{#if placementPreview}
						<circle
							cx="0"
							cy="0"
							r="18"
							fill="var(--primary)"
							fill-opacity="0.08"
							stroke="var(--primary)"
							stroke-width="1.25"
							stroke-dasharray="3 2"
						/>
						<line x1="-24" y1="0" x2="-10" y2="0" stroke="var(--primary)" stroke-width="1" stroke-opacity="0.65" />
						<line x1="10" y1="0" x2="24" y2="0" stroke="var(--primary)" stroke-width="1" stroke-opacity="0.65" />
						<line x1="0" y1="-24" x2="0" y2="-10" stroke="var(--primary)" stroke-width="1" stroke-opacity="0.65" />
						<line x1="0" y1="10" x2="0" y2="24" stroke="var(--primary)" stroke-width="1" stroke-opacity="0.65" />
					{/if}
					<g
						transform="rotate({circuit.placementRotation})"
						class="text-primary opacity-65"
					>
						<CircuitSymbol
							kind={circuit.activeTool}
							variant="schematic"
							asGroup={true}
							rotation={circuit.placementRotation}
							sourceMode={circuit.activeSourceMode}
							terminalLabel={circuit.activeTool === 'terminal' ? 'T' : undefined}
						/>
						{#if circuit.activeTool !== 'ground' && circuit.activeTool !== 'terminal'}
							<circle cx="-40" cy="0" r="3" fill="var(--primary)" />
							<circle cx="40" cy="0" r="3" fill="var(--primary)" />
						{:else}
							<circle cx="0" cy="0" r="3" fill="var(--primary)" />
						{/if}
					</g>
				</g>
			{/if}

			<!-- Live Branch Current Overlays (Emerald) -->
			{#each branchOverlays as br (br.componentId)}
				{#if dragPreview?.componentId !== br.componentId}
					<g pointer-events="none">
						<!-- Directional current arrowhead along lead -->
						<g transform="translate({br.arrowX}, {br.arrowY}) rotate({br.arrowAngleDeg})">
							<path
								d="M -4 -3.5 L 4 0 L -4 3.5 Z"
								fill="var(--current)"
							/>
						</g>
						<!-- Compact Emerald pill -->
						<g transform="translate({br.badgeX}, {br.badgeY})">
							<rect
								x={-br.pillWidth / 2}
								y="-8"
								width={br.pillWidth}
								height="16"
								rx="3"
								fill="var(--card)"
								fill-opacity="0.95"
								stroke="var(--current)"
								stroke-opacity="0.45"
								stroke-width="1"
							/>
							<text
								x="0"
								y="3"
								text-anchor="middle"
								fill="var(--current)"
								font-family="var(--font-mono)"
								font-size="9.5"
								font-weight="600"
								style="font-variant-numeric: tabular-nums;"
							>
								{br.text}
							</text>
						</g>
					</g>
				{/if}
			{/each}

			<!-- Live Node Voltage Overlays (Cobalt) -->
			{#each nodeOverlays as node (node.nodeId)}
				{@const distFromAnchor = Math.hypot(node.xPx - node.anchorX, node.yPx - node.anchorY)}
				<g pointer-events="none">
					{#if !node.isReference && distFromAnchor > 26}
						<line
							x1={node.anchorX}
							y1={node.anchorY}
							x2={node.xPx}
							y2={node.yPx}
							stroke="var(--voltage)"
							stroke-opacity="0.4"
							stroke-width="1"
							stroke-dasharray="2 2"
						/>
					{/if}
					<g transform="translate({node.xPx}, {node.yPx})">
						<rect
							x={-node.pillWidth / 2}
							y="-8.5"
							width={node.pillWidth}
							height="17"
							rx="3"
							fill="var(--card)"
							fill-opacity="0.96"
							stroke={node.isReference ? 'var(--border)' : 'var(--voltage)'}
							stroke-opacity={node.isReference ? '1' : '0.55'}
							stroke-width="1"
						/>
						<text
							x="0"
							y="3"
							text-anchor="middle"
							fill={node.isReference ? 'var(--muted-foreground)' : 'var(--voltage)'}
							font-family="var(--font-mono)"
							font-size="9.5"
							font-weight="600"
							style="font-variant-numeric: tabular-nums;"
						>
							{node.text}
						</text>
					</g>
				</g>
			{/each}

			<!-- Dependent Source Controlling Node Highlights (painted above node/branch overlay pills) -->
			{#if selectedDependentControlHighlight?.mode === 'nodes'}
				<g pointer-events="none" data-control-nodes-highlight="true">
					{#each selectedDependentControlHighlight.nodes as nodeHl (`${nodeHl.nodeId}-${nodeHl.sign}`)}
						<g transform="translate({nodeHl.pt.x * GRID_SIZE}, {nodeHl.pt.y * GRID_SIZE})">
							<circle
								cx="0"
								cy="0"
								r="10"
								fill={selectedDependentControlHighlight.accent}
								fill-opacity="0.08"
								stroke={selectedDependentControlHighlight.accent}
								stroke-width="1.5"
								stroke-dasharray="3 2"
							/>
							<rect
								x="8"
								y="6"
								width="14"
								height="13"
								rx="3"
								fill="var(--card)"
								stroke={selectedDependentControlHighlight.accent}
								stroke-width="1"
							/>
							<text
								x="15"
								y="15.5"
								text-anchor="middle"
								fill={selectedDependentControlHighlight.accent}
								font-family="var(--font-mono)"
								font-size="10"
								font-weight="700"
							>
								{nodeHl.sign}
							</text>
						</g>
					{/each}
				</g>
			{/if}
		</g>
	</svg>

		<!-- Onboarding Empty State -->
		{#if circuit.document.components.length === 0 && !circuit.emptyBannerDismissed && circuit.activeTool === 'select'}
			<div class="pointer-events-none absolute inset-0 flex items-center justify-center p-4">
				<div class="pointer-events-auto relative w-full max-w-md rounded-[4px] border border-border bg-card/95 p-5">
					<button
						type="button"
						aria-label="Dismiss empty canvas prompt"
						title="Dismiss"
						onclick={() => circuit.dismissEmptyBanner()}
						class="absolute top-1.5 right-1.5 inline-flex min-h-11 min-w-11 cursor-pointer items-center justify-center rounded-[4px] text-muted-foreground transition-colors duration-150 hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring lg:top-2.5 lg:right-2.5 lg:h-7 lg:w-7 lg:min-h-0 lg:min-w-0"
					>
						<X class="size-4 lg:size-3.5" aria-hidden="true" />
					</button>

					<h1 class="pr-10 text-sm font-semibold tracking-tight text-foreground lg:pr-8">
						Place a component or load a preset to begin
					</h1>
					<p class="mt-1.5 text-xs leading-relaxed text-muted-foreground">
						Select a source, passive element, or wire tool from the palette to capture your
						schematic, or open a verified reference circuit to inspect live node voltages and
						branch currents.
					</p>

					<div class="mt-4 flex flex-wrap items-center gap-2">
						<Button
							variant="default"
							size="sm"
							class="min-h-11 lg:min-h-0"
							onclick={() => onOpenPresets?.()}
						>
							<BookOpen />
							<span>Browse Presets</span>
						</Button>
						<Button
							variant="outline"
							size="sm"
							class="min-h-11 lg:min-h-0"
							onclick={() => onOpenImport?.()}
						>
							<FileCode2 />
							<span>Import JSON</span>
						</Button>
						<Button
							variant="ghost"
							size="sm"
							class="min-h-11 lg:min-h-0"
							onclick={() => onOpenAiImport?.()}
						>
							<Sparkles />
							<span>AI Import</span>
						</Button>
					</div>
				</div>
			</div>
		{/if}
	</div>

	<!-- Selected Element Contextual Strip (< lg) -->
	{#if (circuit.selectedComponent || circuit.selectedWire) && !wireStart && !isPlacementTool(circuit.activeTool)}
		<div
			role="toolbar"
			aria-label="Selected element actions"
			class="flex shrink-0 items-center justify-between gap-1.5 border-t border-border bg-card px-2.5 py-1 lg:hidden"
		>
			{#if circuit.selectedComponent}
				{@const selectedComp = circuit.selectedComponent}
				{@const isTwoTerminal =
					selectedComp.kind !== 'ground' &&
					selectedComp.kind !== 'terminal' &&
					selectedComp.kind !== 'voltmeter'}
				{@const isTheveninActive =
					circuit.theveninTarget?.kind === 'component' &&
					circuit.theveninTarget.componentId === selectedComp.id}
				<div class="flex min-w-0 items-center gap-1.5">
					<span class="h-1.5 w-1.5 shrink-0 rounded-full bg-warning" aria-hidden="true"></span>
					<span class="font-engineering truncate text-xs font-semibold text-foreground">
						{selectedComp.label}
					</span>
				</div>
				<div class="flex shrink-0 items-center gap-0.5">
					<Button
						variant="ghost"
						size="sm"
						class="min-h-11 shrink-0 gap-1 px-2 text-xs"
						aria-label="Rotate component 90 degrees"
						onclick={() => circuit.rotateComponent(selectedComp.id)}
					>
						<RotateCw class="size-3.5" aria-hidden="true" />
						<span>Rotate</span>
					</Button>
					<Button
						variant="ghost"
						size="sm"
						class="min-h-11 shrink-0 gap-1 px-2 text-xs"
						aria-label="Inspect component properties"
						onclick={() => onMobileInspect?.(selectedComp.id)}
					>
						<SlidersHorizontal class="size-3.5" aria-hidden="true" />
						<span>Edit</span>
					</Button>
					{#if selectedComp.kind === 'resistor' || selectedComp.kind === 'capacitor' || selectedComp.kind === 'inductor'}
						<Button
							variant={isTheveninActive ? 'secondary' : 'ghost'}
							size="sm"
							class={cn(
								'min-h-11 shrink-0 gap-1 px-2 text-xs',
								isTheveninActive && 'border border-warning/50 bg-warning/15 text-warning'
							)}
							aria-label={isTheveninActive
								? 'Clear Thévenin load target'
								: 'Set as Thévenin load target'}
							aria-pressed={isTheveninActive}
							onclick={() => {
								if (isTheveninActive) {
									circuit.clearTheveninTarget();
								} else {
									circuit.setTheveninComponent(selectedComp.id);
								}
							}}
						>
							<Target class="size-3.5" aria-hidden="true" />
							<span>Thév</span>
						</Button>
					{/if}
					<Button
						variant="ghost"
						size="icon"
						class="min-h-11 min-w-11 shrink-0 text-destructive hover:bg-destructive/10 hover:text-destructive"
						aria-label="Delete component"
						onclick={() => circuit.deleteComponent(selectedComp.id)}
					>
						<Trash2 class="size-4" aria-hidden="true" />
					</Button>
				</div>
			{:else if circuit.selectedWire}
				{@const selectedWire = circuit.selectedWire}
				{@const primaryCrossing =
					wireCrossings.find((c) => c.wireIds.includes(selectedWire.id)) ?? null}
				<div class="flex min-w-0 items-center gap-1.5">
					<span class="h-1.5 w-1.5 shrink-0 rounded-full bg-warning" aria-hidden="true"></span>
					<span class="font-engineering truncate text-xs font-semibold text-foreground">
						{selectedWire.id}
					</span>
				</div>
				<div class="flex shrink-0 items-center gap-0.5">
					{#if primaryCrossing}
						<Button
							variant="ghost"
							size="sm"
							class="min-h-11 shrink-0 gap-1 px-2 text-xs"
							aria-label={primaryCrossing.connected
								? 'Disconnect wire crossing into bridge'
								: 'Connect wire crossing into junction'}
							onclick={() => handleCrossingToggle(primaryCrossing.x, primaryCrossing.y)}
						>
							{#if primaryCrossing.connected}
								<Unlink class="size-3.5" aria-hidden="true" />
								<span>Bridge</span>
							{:else}
								<Link2 class="size-3.5" aria-hidden="true" />
								<span>Connect</span>
							{/if}
						</Button>
					{/if}
					<Button
						variant="ghost"
						size="sm"
						class="min-h-11 shrink-0 gap-1 px-2.5 text-xs"
						aria-label="Inspect wire properties"
						onclick={() => onMobileInspect?.()}
					>
						<SlidersHorizontal class="size-3.5" aria-hidden="true" />
						<span>Inspect</span>
					</Button>
					<Button
						variant="ghost"
						size="sm"
						class="min-h-11 shrink-0 gap-1 px-2.5 text-xs text-destructive hover:bg-destructive/10 hover:text-destructive"
						aria-label="Delete wire"
						onclick={() => circuit.deleteWire(selectedWire.id)}
					>
						<Trash2 class="size-3.5" aria-hidden="true" />
						<span>Delete</span>
					</Button>
				</div>
			{/if}
		</div>
	{/if}

	<!-- Mobile & Tablet Bottom Docked Canvas Tool Strip (< lg) -->
	<div class="flex shrink-0 items-center justify-between gap-1 border-t border-border bg-surface-rail px-1.5 py-1 sm:gap-2 sm:px-2 lg:hidden">
		<div class="flex shrink-0 items-center">
			<Button
				variant="ghost"
				size="icon"
				class="h-11 w-11"
				aria-label="Zoom out"
				onclick={() => adjustZoom(-0.15)}
			>
				<Minus class="size-4" aria-hidden="true" />
			</Button>
			<Button
				variant="ghost"
				size="icon"
				class="h-11 w-11"
				aria-label="Fit to view"
				onclick={fitToView}
			>
				<Scan class="size-4" aria-hidden="true" />
			</Button>
			<Button
				variant="ghost"
				size="icon"
				class="h-11 w-11"
				aria-label="Zoom in"
				onclick={() => adjustZoom(0.15)}
			>
				<Plus class="size-4" aria-hidden="true" />
			</Button>
			<Button
				variant="ghost"
				size="icon"
				class="h-11 w-11"
				aria-label="Undo"
				disabled={!circuit.canUndo}
				onclick={() => circuit.undo()}
			>
				<Undo2 class="size-4" aria-hidden="true" />
			</Button>
			<Button
				variant="ghost"
				size="icon"
				class="h-11 w-11"
				aria-label="Redo"
				disabled={!circuit.canRedo}
				onclick={() => circuit.redo()}
			>
				<Redo2 class="size-4" aria-hidden="true" />
			</Button>
		</div>

		<div class="flex shrink-0 items-center gap-1 sm:gap-1.5">
			<button
				type="button"
				aria-label="Wire tool"
				aria-pressed={circuit.activeTool === 'wire'}
				onclick={() => {
					if (circuit.activeTool === 'wire') {
						wireStart = null;
						wireStartedFromSelect = false;
						wireDragOrigin = null;
						circuit.setActiveTool('select');
					} else {
						circuit.setActiveTool('wire');
					}
				}}
				class={cn(
					'inline-flex min-h-11 min-w-11 shrink-0 cursor-pointer items-center justify-center gap-1.5 rounded-[4px] border text-xs font-medium transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:px-2.5',
					circuit.activeTool === 'wire'
						? 'border-primary/50 bg-primary/12 text-primary'
						: 'border-border bg-card text-foreground hover:bg-accent'
				)}
			>
				<Waypoints class="size-4 shrink-0" aria-hidden="true" />
				<span class="hidden sm:inline">Wire</span>
			</button>

			<button
				type="button"
				onclick={() => onOpenPalette?.()}
				aria-label="Open component palette"
				class="inline-flex min-h-11 shrink-0 cursor-pointer items-center justify-center gap-1 rounded-[4px] bg-foreground px-2.5 text-xs font-medium text-background transition-colors duration-150 hover:bg-foreground/90 active:translate-y-px focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background sm:gap-1.5 sm:px-3.5"
			>
				<Plus class="size-4 shrink-0" aria-hidden="true" />
				<span>Parts</span>
			</button>
		</div>
	</div>

	<!-- Desktop Docked Bottom Status & Tool Bar (lg+) -->
	<div class="hidden h-8 shrink-0 items-center justify-between gap-2 border-t border-border bg-surface-rail px-2.5 text-[11px] lg:flex xl:gap-3 xl:px-3">
		<!-- Left: Solver Status, Telemetry & Contextual Hint -->
		<div class="flex min-w-0 flex-1 items-center gap-2 overflow-hidden xl:gap-2.5">
			<div
				class={cn(
					'flex shrink-0 items-center gap-1.5 whitespace-nowrap',
					effectiveAutoWireFeedback && 'hidden xl:flex'
				)}
			>
				{#if circuit.document.components.length === 0}
					<span class="h-1.5 w-1.5 shrink-0 rounded-full bg-muted-foreground/50" aria-hidden="true"></span>
					<span class="text-muted-foreground">Empty</span>
				{:else if hasErrors}
					<span class="h-1.5 w-1.5 shrink-0 rounded-full bg-destructive" aria-hidden="true"></span>
					<span class="font-medium text-destructive">
						<span class="xl:hidden">Error</span><span class="hidden xl:inline">Topology / Value Error</span>
					</span>
				{:else if circuit.solution.mna.valid}
					<span class="h-1.5 w-1.5 shrink-0 rounded-full bg-branch-current" aria-hidden="true"></span>
					<span class="text-foreground">
						<span class="xl:hidden">{circuit.solution.allVerified ? 'Verified' : 'MNA'}</span><span class="hidden xl:inline">Solved{circuit.solution.allVerified ? ' · All methods verified' : ' · MNA ready'}</span>
					</span>
				{:else}
					<span class="h-1.5 w-1.5 shrink-0 rounded-full bg-warning" aria-hidden="true"></span>
					<span class="text-muted-foreground">
						<span class="xl:hidden">Idle</span><span class="hidden xl:inline">Solver idle</span>
					</span>
				{/if}
			</div>

			<Separator
				orientation="vertical"
				class={cn('h-3.5 shrink-0', effectiveAutoWireFeedback && 'hidden xl:block')}
			/>

			{#if effectiveAutoWireFeedback}
				<span
					role="status"
					aria-live="polite"
					class="min-w-0 truncate font-engineering text-foreground"
				>
					{effectiveAutoWireFeedback}
				</span>
			{:else}
				<div class="flex min-w-0 items-center gap-2 overflow-hidden font-engineering whitespace-nowrap xl:gap-2.5">
					<span class="hidden shrink-0 text-muted-foreground xl:inline">Grid 20px</span>
					<span class="hidden shrink-0 text-muted-foreground xl:inline">
						Snap <span class="text-foreground">{settings.snapToGrid ? 'ON' : 'OFF'}</span>
					</span>
					<span class="shrink-0 text-voltage">
						{nodeCount} {nodeCount === 1 ? 'Node' : 'Nodes'}
					</span>
					{#if hoverGrid}
						<span class="truncate text-muted-foreground">
							({hoverGrid.x}, {hoverGrid.y})
						</span>
					{/if}
				</div>

				<Separator orientation="vertical" class="hidden h-3.5 shrink-0 2xl:block" />
				<span class="hidden truncate text-muted-foreground/80 2xl:inline">
					{activeToolHint}
				</span>
			{/if}
		</div>

		<!-- Right: Flat Hairline Viewport & History Controls -->
		<div class="flex shrink-0 items-center gap-0.5">
			<Tooltip content="Zoom out" side="top">
				<Button
					variant="ghost"
					size="icon"
					class="h-6 w-6"
					aria-label="Zoom out"
					onclick={() => adjustZoom(-0.15)}
				>
					<Minus class="size-3.5" />
				</Button>
			</Tooltip>
			<button
				type="button"
				onclick={resetZoom}
				title="Reset zoom to 100%"
				class="min-w-10 cursor-pointer rounded-[3px] px-1 py-0.5 text-center font-engineering text-[11px] text-foreground transition-colors duration-150 hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
			>
				{Math.round(zoom * 100)}%
			</button>
			<Tooltip content="Zoom in" side="top">
				<Button
					variant="ghost"
					size="icon"
					class="h-6 w-6"
					aria-label="Zoom in"
					onclick={() => adjustZoom(0.15)}
				>
					<Plus class="size-3.5" />
				</Button>
			</Tooltip>
			<Tooltip content="Fit schematic to view" side="top">
				<Button
					variant="ghost"
					size="icon"
					class="h-6 w-6"
					aria-label="Fit to view"
					onclick={fitToView}
				>
					<Scan class="size-3.5" />
				</Button>
			</Tooltip>

			<Separator orientation="vertical" class="mx-1 h-3.5" />

			<Tooltip content="Auto-wire unconnected pins (algorithmic, no AI)" side="top">
				<Button
					variant="ghost"
					size="sm"
					class="h-6 gap-1 px-1.5 text-[11px] font-medium text-foreground/85 hover:bg-accent hover:text-foreground xl:px-2"
					aria-label="Auto-wire unconnected pins"
					disabled={circuit.document.components.length < 2}
					onclick={triggerAutoWire}
				>
					<Cable class="size-3.5" aria-hidden="true" />
					<span class="hidden xl:inline">Auto-Wire</span>
				</Button>
			</Tooltip>

			<Tooltip content="Undo (Ctrl+Z)" side="top">
				<Button
					variant="ghost"
					size="icon"
					class="h-6 w-6"
					aria-label="Undo"
					disabled={!circuit.canUndo}
					onclick={() => circuit.undo()}
				>
					<Undo2 class="size-3.5" />
				</Button>
			</Tooltip>
			<Tooltip content="Redo (Ctrl+Shift+Z)" side="top">
				<Button
					variant="ghost"
					size="icon"
					class="h-6 w-6"
					aria-label="Redo"
					disabled={!circuit.canRedo}
					onclick={() => circuit.redo()}
				>
					<Redo2 class="size-3.5" />
				</Button>
			</Tooltip>
			<Tooltip content="Clear canvas" side="top">
				<Button
					variant="ghost"
					size="icon"
					class="h-6 w-6 text-destructive hover:text-destructive"
					aria-label="Clear canvas"
					disabled={circuit.document.components.length === 0 && circuit.document.wires.length === 0}
					onclick={() => circuit.clearCircuit()}
				>
					<Eraser class="size-3.5" />
				</Button>
			</Tooltip>
		</div>
	</div>
</div>
