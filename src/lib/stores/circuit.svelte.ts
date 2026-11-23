/**
 * Reactive Svelte 5 rune store managing the active CircuitDocument, selection,
 * active editor tool, placement rotation, undo/redo history, Thévenin target,
 * and derived electrical graph + full cross-verified solver results.
 */

import { PRESETS, getPresetById } from '$lib/data/presets';
import {
	areUnknownKindsCompatible,
	autoWireDocument,
	buildElectricalGraph,
	getPinPositions,
	getUnknownTerms,
	isDependentSourceKind,
	isVoltageControlledSource,
	parseEngineeringNumber,
	solveCircuit,
	type AnalysisMode,
	type AutoWireResult,
	type CircuitComponent,
	type CircuitDocument,
	type CircuitWire,
	type ComponentKind,
	type DependentControlRef,
	type ElectricalGraph,
	type FullSolveResult,
	type GridPoint,
	type MethodId,
	type PassiveValueMode,
	type PinAnchor,
	type Rotation,
	type TheveninTarget,
	type UnknownProblemSpec
} from '$lib/engine';
import { computeWireCrossings } from '$lib/components/editor/helpers';
import type { SourceMode } from '$lib/components/symbols';
import { AC_ENABLED } from '$lib/env';
import { settings } from './settings.svelte';

export type EditorTool = 'select' | 'wire' | 'probe' | ComponentKind;

export interface AddComponentOptions {
	rotation?: Rotation;
	value?: string;
	label?: string;
	sourceMode?: SourceMode;
	phaseDeg?: number;
	frequencyHz?: number;
	unit?: string;
	valueMode?: PassiveValueMode;
	terminalName?: string;
	controlRef?: DependentControlRef;
}

export interface HistorySnapshot {
	document: CircuitDocument;
	theveninTarget?: TheveninTarget;
}

const MAX_HISTORY = 50;

const DEFAULT_UNITS: Record<ComponentKind, string | undefined> = {
	resistor: 'Ω',
	capacitor: 'F',
	inductor: 'H',
	voltage_source: 'V',
	current_source: 'A',
	vcvs: 'V/V',
	vccs: 'S',
	ccvs: 'Ω',
	cccs: 'A/A',
	ground: undefined,
	terminal: undefined,
	voltmeter: undefined
};

const LABEL_PREFIXES: Record<ComponentKind, string> = {
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

function cloneDocument(doc: CircuitDocument): CircuitDocument {
	return {
		schemaVersion: 1,
		id: doc.id,
		name: doc.name,
		mode: doc.mode,
		frequencyHz: doc.frequencyHz,
		acMagnitudeMode: doc.acMagnitudeMode,
		unitSystem: doc.unitSystem,
		components: doc.components.map((c) => ({
			...c,
			controlRef: c.controlRef ? { ...c.controlRef } : undefined
		})),
		wires: doc.wires.map((w) => ({
			id: w.id,
			points: w.points.map((p) => ({ x: p.x, y: p.y }))
		})),
		unknownProblem: doc.unknownProblem
			? {
					...doc.unknownProblem,
					...(doc.unknownProblem.terms
						? { terms: doc.unknownProblem.terms.map((t) => ({ ...t })) }
						: {}),
					constraint: { ...doc.unknownProblem.constraint }
				}
			: undefined
	};
}

/**
 * Node IDs (N1, N2, ...) are renumbered by position whenever the layout changes, so anything
 * that points at a node is stored with a pin anchor and re-resolved against the current graph.
 */
function anchorForNode(
	graph: ElectricalGraph,
	nodeId: string,
	excludeComponentId?: string
): PinAnchor | undefined {
	const pin = graph.nodes[nodeId]?.componentPins.find((p) => p.componentId !== excludeComponentId);
	return pin ? { componentId: pin.componentId, pinIndex: pin.pinIndex } : undefined;
}

function nodeForAnchor(graph: ElectricalGraph, anchor?: PinAnchor): string | undefined {
	if (!anchor) return undefined;
	return graph.componentNodes[anchor.componentId]?.[anchor.pinIndex];
}

function resolveDocumentAnchors(doc: CircuitDocument, graph: ElectricalGraph): CircuitDocument {
	let out = doc;

	// Dependent sources controlled by a node pair
	let componentsChanged = false;
	const components = doc.components.map((comp) => {
		const ref = comp.controlRef;
		if (!ref || (!ref.controlNodePosPin && !ref.controlNodeNegPin)) return comp;
		const pos = nodeForAnchor(graph, ref.controlNodePosPin) ?? ref.controlNodePos;
		const neg = nodeForAnchor(graph, ref.controlNodeNegPin) ?? ref.controlNodeNeg;
		if (pos === ref.controlNodePos && neg === ref.controlNodeNeg) return comp;
		componentsChanged = true;
		return { ...comp, controlRef: { ...ref, controlNodePos: pos, controlNodeNeg: neg } };
	});
	if (componentsChanged) out = { ...out, components };

	// Unknown-value constraint on a node voltage
	const up = out.unknownProblem;
	const c = up?.constraint;
	if (up && c && c.kind === 'node_voltage' && c.targetPin) {
		const nodeId = nodeForAnchor(graph, c.targetPin);
		if (nodeId && nodeId !== c.targetId) {
			out = { ...out, unknownProblem: { ...up, constraint: { ...c, targetId: nodeId } } };
		}
	}
	return out;
}

/** Attach (or refresh) pin anchors for a dependent source's controlling node pair. */
function anchorControlNodes(ref: DependentControlRef, graph: ElectricalGraph): DependentControlRef {
	const next: DependentControlRef = { ...ref };
	delete next.controlNodePosPin;
	delete next.controlNodeNegPin;
	if (next.controlNodePos) {
		const pin = anchorForNode(graph, next.controlNodePos);
		if (pin) next.controlNodePosPin = pin;
	}
	if (next.controlNodeNeg) {
		const pin = anchorForNode(graph, next.controlNodeNeg);
		if (pin) next.controlNodeNegPin = pin;
	}
	return next;
}

function resolveTheveninAnchors(
	target: TheveninTarget | undefined,
	graph: ElectricalGraph
): TheveninTarget | undefined {
	if (!target || target.kind !== 'terminals') return target;
	const nodeA = nodeForAnchor(graph, target.pinA) ?? target.nodeA;
	const nodeB = nodeForAnchor(graph, target.pinB) ?? target.nodeB;
	if (nodeA === target.nodeA && nodeB === target.nodeB) return target;
	return { ...target, nodeA, nodeB };
}

/** Re-anchor a pin that belongs to a component about to be deleted onto another pin of its node. */
function reanchorAwayFrom(
	graph: ElectricalGraph,
	anchor: PinAnchor | undefined,
	deletedId: string
): PinAnchor | undefined {
	if (!anchor || anchor.componentId !== deletedId) return anchor;
	const nodeId = nodeForAnchor(graph, anchor);
	return nodeId ? anchorForNode(graph, nodeId, deletedId) : undefined;
}

function cloneTheveninTarget(target?: TheveninTarget): TheveninTarget | undefined {
	if (!target) return undefined;
	return { ...target };
}

function normalizeWirePoints(points: GridPoint[]): GridPoint[] {
	const rounded = points.map((p) => ({ x: Math.round(p.x), y: Math.round(p.y) }));
	const deduped: GridPoint[] = [];
	for (const pt of rounded) {
		const prev = deduped[deduped.length - 1];
		if (!prev || prev.x !== pt.x || prev.y !== pt.y) {
			deduped.push(pt);
		}
	}
	// Remove redundant collinear intermediate points
	if (deduped.length <= 2) return deduped;
	const simplified: GridPoint[] = [deduped[0]];
	for (let i = 1; i < deduped.length - 1; i++) {
		const a = simplified[simplified.length - 1];
		const b = deduped[i];
		const c = deduped[i + 1];
		const sameX = a.x === b.x && b.x === c.x;
		const sameY = a.y === b.y && b.y === c.y;
		if (!sameX && !sameY) {
			simplified.push(b);
		}
	}
	simplified.push(deduped[deduped.length - 1]);
	return simplified;
}

function wiresEqual(a: GridPoint[], b: GridPoint[]): boolean {
	if (a.length !== b.length) return false;
	const forward = a.every((pt, idx) => pt.x === b[idx].x && pt.y === b[idx].y);
	if (forward) return true;
	return a.every((pt, idx) => {
		const rev = b[b.length - 1 - idx];
		return pt.x === rev.x && pt.y === rev.y;
	});
}

function nextUniqueLabel(kind: ComponentKind, components: CircuitComponent[]): { label: string; terminalName?: string } {
	const used = new Set<string>();
	for (const c of components) {
		used.add(c.id);
		used.add(c.label);
	}

	if (kind === 'terminal') {
		const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
		for (let i = 0; i < letters.length; i++) {
			const letter = letters[i];
			const candidate = `T${letter}`;
			if (!used.has(candidate)) {
				return { label: candidate, terminalName: letter };
			}
		}
		let idx = 1;
		while (used.has(`T${idx}`)) idx++;
		return { label: `T${idx}`, terminalName: `${idx}` };
	}

	const prefix = LABEL_PREFIXES[kind];
	let idx = 1;
	while (used.has(`${prefix}${idx}`)) {
		idx++;
	}
	return { label: `${prefix}${idx}` };
}

function nextUniqueWireId(wires: CircuitWire[]): string {
	const used = new Set(wires.map((w) => w.id));
	let idx = 1;
	while (used.has(`w${idx}`)) {
		idx++;
	}
	return `w${idx}`;
}

function getDefaultValue(kind: ComponentKind, sourceMode: SourceMode): string {
	switch (kind) {
		case 'resistor':
			return '1k';
		case 'capacitor':
			return '10u';
		case 'inductor':
			return '10m';
		case 'voltage_source':
			return sourceMode === 'ac' ? '10∠0°' : '10';
		case 'current_source':
			return sourceMode === 'ac' ? '10m∠0°' : '10m';
		case 'vcvs':
			return '2';
		case 'vccs':
			return '1m';
		case 'ccvs':
			return '1k';
		case 'cccs':
			return '2';
		case 'ground':
		case 'terminal':
		case 'voltmeter':
			return '0';
	}
}

const initialPreset = PRESETS[0];

class CircuitStore {
	private _document = $state<CircuitDocument>(cloneDocument(initialPreset.document));
	private _selectedComponentId = $state<string | null>(null);
	private _selectedWireId = $state<string | null>(null);
	private _activeTool = $state<EditorTool>('select');
	private _activeSourceMode = $state<SourceMode>(AC_ENABLED ? initialPreset.document.mode : 'dc');
	private _placementRotation = $state<Rotation>(0);
	private _theveninTarget = $state<TheveninTarget | undefined>(
		initialPreset.theveninLoadId
			? { kind: 'component', componentId: initialPreset.theveninLoadId }
			: undefined
	);
	private _activeMethod = $state<MethodId>(initialPreset.featuredMethod ?? 'nodal');
	private _emptyBannerDismissed = $state(false);
	private _documentLoadSeq = $state(0);

	private _undoStack = $state<HistorySnapshot[]>([]);
	private _redoStack = $state<HistorySnapshot[]>([]);

	private _graph = $derived<ElectricalGraph>(buildElectricalGraph(this._document));
	/** Document / Thévenin target with node references re-resolved from their pin anchors. */
	private _resolvedDocument = $derived<CircuitDocument>(
		resolveDocumentAnchors(this._document, this._graph)
	);
	private _resolvedTheveninTarget = $derived<TheveninTarget | undefined>(
		resolveTheveninAnchors(this._theveninTarget, this._graph)
	);
	private _solution = $derived<FullSolveResult>(
		solveCircuit(this._resolvedDocument, {
			frequencyHz: this._document.frequencyHz,
			acMagnitudeMode: settings.acMagnitudeMode,
			theveninTarget: this._resolvedTheveninTarget
		})
	);
	private _selectedComponent = $derived<CircuitComponent | null>(
		this._selectedComponentId
			? (this._document.components.find((c) => c.id === this._selectedComponentId) ?? null)
			: null
	);
	private _selectedWire = $derived<CircuitWire | null>(
		this._selectedWireId
			? (this._document.wires.find((w) => w.id === this._selectedWireId) ?? null)
			: null
	);

	get document(): CircuitDocument {
		return this._resolvedDocument;
	}

	get documentLoadSeq(): number {
		return this._documentLoadSeq;
	}

	get selectedComponentId(): string | null {
		return this._selectedComponentId;
	}
	set selectedComponentId(id: string | null) {
		this._selectedComponentId = id;
		if (id !== null) {
			this._selectedWireId = null;
		}
	}

	get selectedWireId(): string | null {
		return this._selectedWireId;
	}
	set selectedWireId(id: string | null) {
		this._selectedWireId = id;
		if (id !== null) {
			this._selectedComponentId = null;
		}
	}

	get selectedComponent(): CircuitComponent | null {
		return this._selectedComponent;
	}

	get selectedWire(): CircuitWire | null {
		return this._selectedWire;
	}

	get activeTool(): EditorTool {
		return this._activeTool;
	}
	set activeTool(tool: EditorTool) {
		this._activeTool = tool;
	}

	get activeSourceMode(): SourceMode {
		return this._activeSourceMode;
	}
	set activeSourceMode(mode: SourceMode) {
		if (mode === 'ac' && !AC_ENABLED) {
			this._activeSourceMode = 'dc';
			return;
		}
		this._activeSourceMode = mode;
	}

	get placementRotation(): Rotation {
		return this._placementRotation;
	}
	set placementRotation(rot: Rotation) {
		this._placementRotation = (((rot % 360) + 360) % 360) as Rotation;
	}

	get theveninTarget(): TheveninTarget | undefined {
		return this._resolvedTheveninTarget;
	}

	get activeMethod(): MethodId {
		return this._activeMethod;
	}
	set activeMethod(method: MethodId) {
		this._activeMethod = method;
	}

	get emptyBannerDismissed(): boolean {
		return this._emptyBannerDismissed;
	}

	dismissEmptyBanner(): void {
		this._emptyBannerDismissed = true;
	}

	resetEmptyBanner(): void {
		this._emptyBannerDismissed = false;
	}

	get canUndo(): boolean {
		return this._undoStack.length > 0;
	}

	get canRedo(): boolean {
		return this._redoStack.length > 0;
	}

	get graph(): ElectricalGraph {
		return this._graph;
	}

	get solution(): FullSolveResult {
		return this._solution;
	}

	/** Captures an undo snapshot of the current document and Thévenin target. */
	recordSnapshot(): void {
		const snapshot: HistorySnapshot = {
			document: cloneDocument(this._document),
			theveninTarget: cloneTheveninTarget(this._theveninTarget)
		};
		const next = [...this._undoStack, snapshot];
		if (next.length > MAX_HISTORY) {
			next.shift();
		}
		this._undoStack = next;
		this._redoStack = [];
	}

	private reconcileSelection(): void {
		if (
			this._selectedComponentId &&
			!this._document.components.some((c) => c.id === this._selectedComponentId)
		) {
			this._selectedComponentId = null;
		}
		if (
			this._selectedWireId &&
			!this._document.wires.some((w) => w.id === this._selectedWireId)
		) {
			this._selectedWireId = null;
		}
	}

	undo(): boolean {
		if (this._undoStack.length === 0) return false;
		const previous = this._undoStack[this._undoStack.length - 1];
		this._undoStack = this._undoStack.slice(0, -1);

		const currentSnapshot: HistorySnapshot = {
			document: cloneDocument(this._document),
			theveninTarget: cloneTheveninTarget(this._theveninTarget)
		};
		this._redoStack = [...this._redoStack, currentSnapshot];

		this._document = cloneDocument(previous.document);
		this._theveninTarget = cloneTheveninTarget(previous.theveninTarget);
		this.reconcileSelection();
		return true;
	}

	redo(): boolean {
		if (this._redoStack.length === 0) return false;
		const next = this._redoStack[this._redoStack.length - 1];
		this._redoStack = this._redoStack.slice(0, -1);

		const currentSnapshot: HistorySnapshot = {
			document: cloneDocument(this._document),
			theveninTarget: cloneTheveninTarget(this._theveninTarget)
		};
		this._undoStack = [...this._undoStack, currentSnapshot];

		this._document = cloneDocument(next.document);
		this._theveninTarget = cloneTheveninTarget(next.theveninTarget);
		this.reconcileSelection();
		return true;
	}

	setActiveTool(tool: EditorTool, sourceMode?: SourceMode): void {
		if (!AC_ENABLED && sourceMode === 'ac') return;
		this._activeTool = tool;
		if (sourceMode) {
			this._activeSourceMode = AC_ENABLED ? sourceMode : 'dc';
		}
	}

	selectComponent(id: string | null): void {
		this._selectedComponentId = id;
		this._selectedWireId = null;
	}

	selectWire(id: string | null): void {
		this._selectedWireId = id;
		this._selectedComponentId = null;
	}

	clearSelection(): void {
		this._selectedComponentId = null;
		this._selectedWireId = null;
	}

	addComponent(
		kind: ComponentKind,
		x: number,
		y: number,
		opts?: AddComponentOptions
	): CircuitComponent {
		this.recordSnapshot();

		const requestedSourceMode = opts?.sourceMode ?? this._activeSourceMode;
		const sourceMode: SourceMode = AC_ENABLED ? requestedSourceMode : 'dc';
		const generated = nextUniqueLabel(kind, this._document.components);
		const label = opts?.label?.trim() || generated.label;

		// Ensure id is unique even if a custom label collides
		let id = label;
		if (this._document.components.some((c) => c.id === id)) {
			const fallback = nextUniqueLabel(kind, this._document.components);
			id = fallback.label;
		}

		const value = opts?.value ?? getDefaultValue(kind, sourceMode);
		const valueMode = opts?.valueMode;
		const parsedNumeric = valueMode === 'impedance' ? null : parseEngineeringNumber(value);
		const resolvedUnit =
			opts?.unit ?? (valueMode === 'impedance' ? 'Ω' : DEFAULT_UNITS[kind]);

		const resolvedControlRef: DependentControlRef | undefined = isDependentSourceKind(kind)
			? {
					controlPolarity: 1,
					controlVarName: isVoltageControlledSource(kind) ? 'v_x' : 'i_x',
					...(opts?.controlRef ?? {})
				}
			: opts?.controlRef;

		const component: CircuitComponent = {
			id,
			kind,
			label,
			x: Math.round(x),
			y: Math.round(y),
			rotation: opts?.rotation ?? this._placementRotation,
			value,
			numericValue: parsedNumeric ?? undefined,
			phaseDeg: AC_ENABLED ? opts?.phaseDeg : undefined,
			frequencyHz: AC_ENABLED ? opts?.frequencyHz : undefined,
			unit: resolvedUnit,
			...(valueMode !== undefined ? { valueMode } : {}),
			terminalName:
				kind === 'terminal' ? (opts?.terminalName ?? generated.terminalName ?? 'A') : undefined,
			...(resolvedControlRef !== undefined ? { controlRef: resolvedControlRef } : {})
		};

		this._document = {
			...this._document,
			components: [...this._document.components, component]
		};
		this._selectedComponentId = component.id;
		this._selectedWireId = null;
		return component;
	}

	moveComponent(
		id: string,
		x: number,
		y: number,
		options?: { recordUndo?: boolean }
	): void {
		const target = this._document.components.find((c) => c.id === id);
		if (!target) return;

		const nx = Math.round(x);
		const ny = Math.round(y);
		if (target.x === nx && target.y === ny) return;

		if (options?.recordUndo !== false) {
			this.recordSnapshot();
		}

		this._document = {
			...this._document,
			components: this._document.components.map((c) =>
				c.id === id ? { ...c, x: nx, y: ny } : c
			)
		};
	}

	rotatePlacement(): Rotation {
		this._placementRotation = ((this._placementRotation + 90) % 360) as Rotation;
		return this._placementRotation;
	}

	rotateComponent(id?: string | null): void {
		if (!id) {
			this.rotatePlacement();
			return;
		}
		const target = this._document.components.find((c) => c.id === id);
		if (!target) {
			this.rotatePlacement();
			return;
		}

		this.recordSnapshot();
		const nextRot = ((target.rotation + 90) % 360) as Rotation;
		this._document = {
			...this._document,
			components: this._document.components.map((c) =>
				c.id === id ? { ...c, rotation: nextRot } : c
			)
		};
	}

	flipComponentPolarity(id: string): void {
		const target = this._document.components.find((c) => c.id === id);
		if (!target) return;

		this.recordSnapshot();
		const nextRot = ((target.rotation + 180) % 360) as Rotation;
		this._document = {
			...this._document,
			components: this._document.components.map((c) =>
				c.id === id ? { ...c, rotation: nextRot } : c
			)
		};
	}

	/**
	 * True if another component already uses this label (or one that renders the same in the
	 * steps: LaTeX subscripts keep only [A-Za-z0-9_], so "R-1" and "R1" both show as R_1).
	 */
	isLabelTaken(label: string, exceptId?: string): boolean {
		const key = label.replace(/[^a-zA-Z0-9_]/g, '');
		return this._document.components.some(
			(c) =>
				c.id !== exceptId &&
				(c.label.replace(/[^a-zA-Z0-9_]/g, '') === key || c.id === label)
		);
	}

	/** Returns false (and changes nothing) if the patch would duplicate another label. */
	updateComponent(
		id: string,
		patch: Partial<Omit<CircuitComponent, 'id' | 'kind'>>
	): boolean {
		const target = this._document.components.find((c) => c.id === id);
		if (!target) return false;
		if (patch.label !== undefined && patch.label !== target.label && this.isLabelTaken(patch.label, id)) {
			return false;
		}

		this.recordSnapshot();

		const nextValue = patch.value !== undefined ? patch.value : target.value;
		const nextValueMode = patch.valueMode !== undefined ? patch.valueMode : target.valueMode;
		const nextNumeric =
			nextValueMode === 'impedance'
				? undefined
				: patch.value !== undefined
					? (parseEngineeringNumber(nextValue) ?? undefined)
					: patch.numericValue !== undefined
						? patch.numericValue
						: target.numericValue;

		this._document = {
			...this._document,
			components: this._document.components.map((c) => {
				if (c.id !== id) return c;
				const nextControlRef =
					patch.controlRef !== undefined
						? patch.controlRef
						: isDependentSourceKind(c.kind) && patch.value !== undefined && c.controlRef
							? { ...c.controlRef, gain: nextValue }
							: c.controlRef;
				return {
					...c,
					...patch,
					value: nextValue,
					numericValue: nextNumeric,
					...(nextControlRef !== undefined ? { controlRef: nextControlRef } : {})
				};
			})
		};
		return true;
	}

	updateComponentControlRef(id: string, patch: Partial<DependentControlRef>): void {
		const target = this._document.components.find((c) => c.id === id);
		if (!target || !isDependentSourceKind(target.kind)) return;

		this.recordSnapshot();

		// Start from the resolved ref: stored node names may be stale after a renumbering
		const currentRef =
			this._resolvedDocument.components.find((c) => c.id === id)?.controlRef ?? target.controlRef;
		const merged: DependentControlRef = {
			...(currentRef ?? {}),
			...patch
		};

		if (
			'controlComponentId' in patch &&
			typeof patch.controlComponentId === 'string' &&
			patch.controlComponentId.trim() !== ''
		) {
			delete merged.controlNodePos;
			delete merged.controlNodeNeg;
		} else if (
			('controlNodePos' in patch && patch.controlNodePos !== undefined && patch.controlNodePos !== '') ||
			('controlNodeNeg' in patch && patch.controlNodeNeg !== undefined && patch.controlNodeNeg !== '')
		) {
			delete merged.controlComponentId;
		}

		// Strip explicitly cleared empty strings so serialization stays canonical
		if (merged.controlComponentId === '') delete merged.controlComponentId;
		if (merged.controlNodePos === '') delete merged.controlNodePos;
		if (merged.controlNodeNeg === '') delete merged.controlNodeNeg;
		if (merged.controlBranchComponentId === '') delete merged.controlBranchComponentId;
		if (merged.controlVarName === '') delete merged.controlVarName;

		this._document = {
			...this._document,
			components: this._document.components.map((c) =>
				c.id === id ? { ...c, controlRef: anchorControlNodes(merged, this._graph) } : c
			)
		};
	}

	deleteComponent(id: string): void {
		if (!this._document.components.some((c) => c.id === id)) return;
		this.recordSnapshot();

		const up = this._document.unknownProblem;
		let nextUnknownProblem: UnknownProblemSpec | undefined = up;
		if (up !== undefined) {
			if (up.constraint.kind !== 'node_voltage' && up.constraint.targetId === id) {
				nextUnknownProblem = undefined;
			} else {
				const terms = getUnknownTerms(up);
				if (terms.some((t) => t.componentId === id)) {
					const remaining = terms.filter((t) => t.componentId !== id);
					if (remaining.length === 0) {
						nextUnknownProblem = undefined;
					} else {
						nextUnknownProblem = {
							...up,
							componentId: up.componentId === id ? remaining[0].componentId : up.componentId,
							terms: remaining,
							constraint: { ...up.constraint }
						};
					}
				}
			}
		}

		if (nextUnknownProblem?.constraint.kind === 'node_voltage') {
			const targetPin = reanchorAwayFrom(this._graph, nextUnknownProblem.constraint.targetPin, id);
			nextUnknownProblem = {
				...nextUnknownProblem,
				constraint: { ...nextUnknownProblem.constraint, targetPin }
			};
		}
		const tt = this._theveninTarget;
		if (tt?.kind === 'terminals') {
			this._theveninTarget = {
				...tt,
				pinA: reanchorAwayFrom(this._graph, tt.pinA, id),
				pinB: reanchorAwayFrom(this._graph, tt.pinB, id)
			};
		}

		const graph = this._graph;
		this._document = {
			...this._document,
			components: this._document.components
				.filter((c) => c.id !== id)
				.map((c) => {
					const ref = c.controlRef;
					if (!ref || (ref.controlNodePosPin?.componentId !== id && ref.controlNodeNegPin?.componentId !== id)) {
						return c;
					}
					return {
						...c,
						controlRef: {
							...ref,
							controlNodePosPin: reanchorAwayFrom(graph, ref.controlNodePosPin, id),
							controlNodeNegPin: reanchorAwayFrom(graph, ref.controlNodeNegPin, id)
						}
					};
				}),
			unknownProblem: nextUnknownProblem
		};

		if (this._selectedComponentId === id) {
			this._selectedComponentId = null;
		}
		if (
			this._theveninTarget?.kind === 'component' &&
			this._theveninTarget.componentId === id
		) {
			this._theveninTarget = undefined;
		}
	}

	deleteSelected(): void {
		if (this._selectedComponentId) {
			this.deleteComponent(this._selectedComponentId);
		} else if (this._selectedWireId) {
			this.deleteWire(this._selectedWireId);
		}
	}

	addWire(points: GridPoint[]): CircuitWire | null {
		const normalized = normalizeWirePoints(points);
		if (normalized.length < 2) return null;

		const hasNonZeroLength = normalized.some((pt, idx) => {
			if (idx === 0) return false;
			const prev = normalized[idx - 1];
			return pt.x !== prev.x || pt.y !== prev.y;
		});
		if (!hasNonZeroLength) return null;

		if (this._document.wires.some((w) => wiresEqual(w.points, normalized))) {
			return null;
		}

		this.recordSnapshot();
		const wire: CircuitWire = {
			id: nextUniqueWireId(this._document.wires),
			points: normalized
		};

		this._document = {
			...this._document,
			wires: [...this._document.wires, wire]
		};
		return wire;
	}

	deleteWire(id: string): void {
		if (!this._document.wires.some((w) => w.id === id)) return;
		this.recordSnapshot();

		this._document = {
			...this._document,
			wires: this._document.wires.filter((w) => w.id !== id)
		};
		if (this._selectedWireId === id) {
			this._selectedWireId = null;
		}
	}

	/**
	 * Toggles an orthogonal wire crossing at grid `(x, y)` between:
	 * - `'connected'`: splits a passing wire at `(x, y)` so `buildElectricalGraph` merges both nets
	 *   into one node and a solid solder junction dot renders.
	 * - `'disconnected'`: removes `(x, y)` as a shared vertex by merging opposite cardinal branches
	 *   into continuous straight-through horizontal and vertical wires so `buildElectricalGraph`
	 *   separates the nets and the canvas renders an IEEE bridge hop.
	 *
	 * Undoable in a single snapshot. Returns `null` if `(x, y)` is a component pin or not a crossing.
	 */
	toggleWireCrossing(x: number, y: number): 'connected' | 'disconnected' | null {
		const cx = Math.round(x);
		const cy = Math.round(y);

		for (const comp of this._document.components) {
			for (const pin of getPinPositions(comp)) {
				if (pin.x === cx && pin.y === cy) {
					return null;
				}
			}
		}

		const crossing = computeWireCrossings(this._document.components, this._document.wires).find(
			(c) => c.x === cx && c.y === cy
		);
		if (!crossing) return null;

		if (!crossing.connected) {
			// Case A — Unconnected pass-over -> split a passing wire at (cx, cy) to create a junction
			let targetWireIdx = -1;
			let targetSegIdx = -1;

			// Prefer splitting a horizontal crossing wire
			for (let wi = 0; wi < this._document.wires.length && targetWireIdx === -1; wi++) {
				const pts = this._document.wires[wi].points;
				for (let si = 0; si + 1 < pts.length; si++) {
					const a = pts[si];
					const b = pts[si + 1];
					if (a.y === cy && b.y === cy && cx > Math.min(a.x, b.x) && cx < Math.max(a.x, b.x)) {
						targetWireIdx = wi;
						targetSegIdx = si;
						break;
					}
				}
			}

			// Fallback: split a vertical crossing wire
			if (targetWireIdx === -1) {
				for (let wi = 0; wi < this._document.wires.length && targetWireIdx === -1; wi++) {
					const pts = this._document.wires[wi].points;
					for (let si = 0; si + 1 < pts.length; si++) {
						const a = pts[si];
						const b = pts[si + 1];
						if (a.x === cx && b.x === cx && cy > Math.min(a.y, b.y) && cy < Math.max(a.y, b.y)) {
							targetWireIdx = wi;
							targetSegIdx = si;
							break;
						}
					}
				}
			}

			if (targetWireIdx === -1) return null;

			this.recordSnapshot();
			const targetWire = this._document.wires[targetWireIdx];
			const splitPt: GridPoint = { x: cx, y: cy };
			const points1 = normalizeWirePoints([...targetWire.points.slice(0, targetSegIdx + 1), splitPt]);
			const points2 = normalizeWirePoints([splitPt, ...targetWire.points.slice(targetSegIdx + 1)]);
			const secondWireId = nextUniqueWireId(this._document.wires);

			const nextWires: CircuitWire[] = [];
			for (let wi = 0; wi < this._document.wires.length; wi++) {
				if (wi === targetWireIdx) {
					if (points1.length >= 2) {
						nextWires.push({ id: targetWire.id, points: points1 });
					}
					if (points2.length >= 2) {
						nextWires.push({ id: secondWireId, points: points2 });
					}
				} else {
					nextWires.push(this._document.wires[wi]);
				}
			}

			this._document = {
				...this._document,
				wires: nextWires
			};
			this.reconcileSelection();
			return 'connected';
		}

		// Case B — Connected 4-way crossing -> disconnect into continuous insulated crossing wires
		type CardinalDir = 'left' | 'right' | 'up' | 'down';
		interface SubWire {
			points: GridPoint[];
			originIds: string[];
			preferredId?: string;
		}

		const untouchedWires: CircuitWire[] = [];
		const buckets: Record<CardinalDir, SubWire[]> = {
			left: [],
			right: [],
			up: [],
			down: []
		};
		const leftoverSubWires: SubWire[] = [];

		for (const wire of this._document.wires) {
			const matchIndices: number[] = [];
			for (let i = 0; i < wire.points.length; i++) {
				if (wire.points[i].x === cx && wire.points[i].y === cy) {
					matchIndices.push(i);
				}
			}

			if (matchIndices.length === 0) {
				untouchedWires.push(wire);
				continue;
			}

			// Split at every interior vertex coinciding with (cx, cy)
			const interiorSplits = matchIndices.filter((i) => i > 0 && i < wire.points.length - 1);
			const slices: GridPoint[][] = [];
			let startIdx = 0;
			for (const splitIdx of interiorSplits) {
				slices.push(wire.points.slice(startIdx, splitIdx + 1));
				startIdx = splitIdx;
			}
			slices.push(wire.points.slice(startIdx));

			let usedPreferredId = false;
			for (const rawSlice of slices) {
				const norm = normalizeWirePoints(rawSlice);
				if (norm.length < 2) continue;

				const startsAtCrossing = norm[0].x === cx && norm[0].y === cy;
				const endsAtCrossing =
					norm[norm.length - 1].x === cx && norm[norm.length - 1].y === cy;

				const preferredId = !usedPreferredId ? wire.id : undefined;
				if (preferredId) usedPreferredId = true;

				if (!startsAtCrossing && !endsAtCrossing) {
					leftoverSubWires.push({ points: norm, originIds: [wire.id], preferredId });
					continue;
				}

				if (startsAtCrossing && endsAtCrossing) {
					leftoverSubWires.push({ points: norm, originIds: [wire.id], preferredId });
					continue;
				}

				// Orient sub-polyline so (cx, cy) is always its final point
				const oriented = endsAtCrossing ? norm : [...norm].reverse();
				const prev = oriented[oriented.length - 2];

				let dir: CardinalDir | null = null;
				if (prev.y === cy && prev.x < cx) dir = 'left';
				else if (prev.y === cy && prev.x > cx) dir = 'right';
				else if (prev.x === cx && prev.y < cy) dir = 'up';
				else if (prev.x === cx && prev.y > cy) dir = 'down';

				if (dir) {
					buckets[dir].push({ points: oriented, originIds: [wire.id], preferredId });
				} else {
					leftoverSubWires.push({ points: oriented, originIds: [wire.id], preferredId });
				}
			}
		}

		const mergedSubWires: SubWire[] = [];
		const mergePair = (a: SubWire, b: SubWire): SubWire => {
			// Both a.points and b.points terminate at (cx, cy)
			const combined = normalizeWirePoints([
				...a.points,
				...b.points.slice(0, -1).reverse()
			]);
			return {
				points: combined,
				originIds: [...a.originIds, ...b.originIds],
				preferredId: a.preferredId ?? b.preferredId
			};
		};

		while (buckets.left.length > 0 && buckets.right.length > 0) {
			mergedSubWires.push(mergePair(buckets.left.shift()!, buckets.right.shift()!));
		}
		while (buckets.up.length > 0 && buckets.down.length > 0) {
			mergedSubWires.push(mergePair(buckets.up.shift()!, buckets.down.shift()!));
		}

		// Filter out redundant 2-point stubs completely overlapped by an untouched straight wire
		const isPointCoveredByUntouched = (a: GridPoint, b: GridPoint): boolean => {
			for (const w of untouchedWires) {
				for (let i = 0; i + 1 < w.points.length; i++) {
					const p1 = w.points[i];
					const p2 = w.points[i + 1];
					if (a.y === b.y && p1.y === a.y && p2.y === a.y) {
						const minSeg = Math.min(p1.x, p2.x);
						const maxSeg = Math.max(p1.x, p2.x);
						if (Math.min(a.x, b.x) >= minSeg && Math.max(a.x, b.x) <= maxSeg) {
							return true;
						}
					} else if (a.x === b.x && p1.x === a.x && p2.x === a.x) {
						const minSeg = Math.min(p1.y, p2.y);
						const maxSeg = Math.max(p1.y, p2.y);
						if (Math.min(a.y, b.y) >= minSeg && Math.max(a.y, b.y) <= maxSeg) {
							return true;
						}
					}
				}
			}
			return false;
		};

		const remainingSubs = [
			...buckets.left,
			...buckets.right,
			...buckets.up,
			...buckets.down
		].filter((sub) => !(sub.points.length === 2 && isPointCoveredByUntouched(sub.points[0], sub.points[1])));

		this.recordSnapshot();

		const nextWires: CircuitWire[] = [...untouchedWires];
		const usedIds = new Set<string>(nextWires.map((w) => w.id));
		let nextWireIdx = 1;
		const allocateWireId = (preferred?: string): string => {
			if (preferred && !usedIds.has(preferred)) {
				usedIds.add(preferred);
				return preferred;
			}
			while (usedIds.has(`w${nextWireIdx}`)) {
				nextWireIdx++;
			}
			const fresh = `w${nextWireIdx}`;
			usedIds.add(fresh);
			return fresh;
		};

		let selectedReplacement: string | null = null;
		for (const sub of [...mergedSubWires, ...remainingSubs, ...leftoverSubWires]) {
			if (sub.points.length < 2) continue;
			const id = allocateWireId(sub.preferredId);
			if (
				this._selectedWireId &&
				!selectedReplacement &&
				sub.originIds.includes(this._selectedWireId)
			) {
				selectedReplacement = id;
			}
			nextWires.push({ id, points: sub.points });
		}

		this._document = {
			...this._document,
			wires: nextWires
		};
		if (selectedReplacement) {
			this._selectedWireId = selectedReplacement;
		}
		this.reconcileSelection();
		return 'disconnected';
	}

	/**
	 * Runs the deterministic algorithmic auto-wirer to connect open pins / islands
	 * in a single undoable step without modifying existing wires.
	 */
	autoWireCircuit(): { addedWires: number; reason?: AutoWireResult['skippedReason'] } {
		const result = autoWireDocument(this._document);
		if (result.addedWires.length === 0) {
			return { addedWires: 0, reason: result.skippedReason };
		}
		this.recordSnapshot();
		this._document = {
			...this._document,
			wires: [...this._document.wires, ...result.addedWires]
		};
		this._selectedWireId = null;
		return { addedWires: result.addedWires.length };
	}

	setMode(mode: AnalysisMode): void {
		if (mode === 'ac' && !AC_ENABLED) return;
		if (this._document.mode === mode) return;
		this.recordSnapshot();
		this._document = {
			...this._document,
			mode
		};
		this._activeSourceMode = mode;
	}

	setFrequency(hz: number): void {
		if (!Number.isFinite(hz) || hz <= 0) return;
		if (this._document.frequencyHz === hz) return;
		this.recordSnapshot();
		this._document = {
			...this._document,
			frequencyHz: hz
		};
	}

	setDocumentName(name: string): void {
		const trimmed = name.trim();
		if (!trimmed || trimmed === this._document.name) return;
		this.recordSnapshot();
		this._document = {
			...this._document,
			name: trimmed
		};
	}

	loadDocument(doc: CircuitDocument, theveninTarget?: string | TheveninTarget): void {
		this.recordSnapshot();
		const cloned = cloneDocument(doc);
		this._document = cloned;
		this._documentLoadSeq += 1;
		this._selectedComponentId = null;
		this._selectedWireId = null;
		this._activeTool = 'select';
		this._activeSourceMode = cloned.mode;

		if (cloned.components.length > 0) {
			this._emptyBannerDismissed = false;
		}

		if (typeof theveninTarget === 'string') {
			if (
				theveninTarget &&
				cloned.components.some(
					(c) =>
						c.id === theveninTarget &&
						c.kind !== 'ground' &&
						c.kind !== 'terminal' &&
						c.kind !== 'voltmeter'
				)
			) {
				this._theveninTarget = { kind: 'component', componentId: theveninTarget };
			} else {
				this._theveninTarget = undefined;
			}
		} else if (theveninTarget) {
			if (
				theveninTarget.kind === 'component' &&
				cloned.components.some(
					(c) =>
						c.id === theveninTarget.componentId &&
						c.kind !== 'ground' &&
						c.kind !== 'terminal' &&
						c.kind !== 'voltmeter'
				)
			) {
				this._theveninTarget = {
					kind: 'component',
					componentId: theveninTarget.componentId
				};
			} else if (
				theveninTarget.kind === 'terminals' &&
				theveninTarget.nodeA.trim() !== '' &&
				theveninTarget.nodeB.trim() !== '' &&
				theveninTarget.nodeA.trim() !== theveninTarget.nodeB.trim()
			) {
				this._theveninTarget = {
					kind: 'terminals',
					nodeA: theveninTarget.nodeA.trim(),
					nodeB: theveninTarget.nodeB.trim()
				};
			} else {
				this._theveninTarget = undefined;
			}
		} else {
			this._theveninTarget = undefined;
		}

		// Anchor node references from the loaded file/link to pins of the loaded layout
		if (this._document.components.some((c) => c.controlRef?.controlNodePos || c.controlRef?.controlNodeNeg)) {
			const graph = this._graph;
			this._document = {
				...this._document,
				components: this._document.components.map((c) =>
					c.controlRef && (c.controlRef.controlNodePos || c.controlRef.controlNodeNeg)
						? { ...c, controlRef: anchorControlNodes(c.controlRef, graph) }
						: c
				)
			};
		}
		const up = this._document.unknownProblem;
		if (up?.constraint.kind === 'node_voltage' && !up.constraint.targetPin) {
			this._document = {
				...this._document,
				unknownProblem: { ...up, constraint: this.anchorConstraint(up.constraint) }
			};
		}
		const tt = this._theveninTarget;
		if (tt?.kind === 'terminals') {
			this._theveninTarget = {
				...tt,
				pinA: tt.pinA ?? anchorForNode(this._graph, tt.nodeA),
				pinB: tt.pinB ?? anchorForNode(this._graph, tt.nodeB)
			};
		}
	}

	loadPreset(presetId: string): boolean {
		const preset = getPresetById(presetId);
		if (!preset) return false;
		if (!AC_ENABLED && preset.document.mode === 'ac') return false;
		this.loadDocument(preset.document, preset.theveninLoadId);
		this._activeMethod = preset.featuredMethod;
		return true;
	}

	clearCircuit(): void {
		if (this._document.components.length === 0 && this._document.wires.length === 0) {
			this._emptyBannerDismissed = true;
			return;
		}
		this.recordSnapshot();
		this._document = {
			schemaVersion: 1,
			name: 'Untitled Circuit',
			mode: this._document.mode,
			frequencyHz: this._document.frequencyHz,
			acMagnitudeMode: this._document.acMagnitudeMode,
			components: [],
			wires: []
		};
		this._selectedComponentId = null;
		this._selectedWireId = null;
		this._theveninTarget = undefined;
		this._emptyBannerDismissed = true;
	}

	setTheveninComponent(id: string): void {
		const target = this._document.components.find((c) => c.id === id);
		if (
			!target ||
			target.kind === 'ground' ||
			target.kind === 'terminal' ||
			target.kind === 'voltmeter'
		) {
			return;
		}
		if (this._theveninTarget?.kind === 'component' && this._theveninTarget.componentId === id) return;
		this.recordSnapshot();
		this._theveninTarget = { kind: 'component', componentId: id };
	}

	setTheveninTerminals(nodeA: string, nodeB: string): void {
		if (!nodeA || !nodeB || nodeA === nodeB) return;
		this.recordSnapshot();
		this._theveninTarget = {
			kind: 'terminals',
			nodeA,
			nodeB,
			pinA: anchorForNode(this._graph, nodeA),
			pinB: anchorForNode(this._graph, nodeB)
		};
	}

	clearTheveninTarget(): void {
		if (!this._theveninTarget) return;
		this.recordSnapshot();
		this._theveninTarget = undefined;
	}

	setUnknownProblem(problem: UnknownProblemSpec | undefined): void {
		this.recordSnapshot();
		this._document = {
			...this._document,
			unknownProblem: problem
				? {
						...problem,
						...(problem.terms ? { terms: problem.terms.map((t) => ({ ...t })) } : {}),
						constraint: this.anchorConstraint(problem.constraint)
					}
				: undefined
		};
	}

	/** Attach a pin anchor to a node_voltage constraint (targetId is a current node ID). */
	private anchorConstraint(
		constraint: UnknownProblemSpec['constraint']
	): UnknownProblemSpec['constraint'] {
		if (constraint.kind !== 'node_voltage') {
			const { targetPin: _drop, ...rest } = constraint;
			return { ...rest };
		}
		const targetPin = anchorForNode(this._graph, constraint.targetId);
		return targetPin ? { ...constraint, targetPin } : { ...constraint };
	}

	clearUnknownProblem(): void {
		if (!this._document.unknownProblem) return;
		this.recordSnapshot();
		this._document = {
			...this._document,
			unknownProblem: undefined
		};
	}

	/**
	 * Links a compatible component to the active `unknownProblem` with the given scalar multiplier
	 * (or updates its multiplier if already linked).
	 */
	linkComponentToUnknown(componentId: string, multiplier = 1): void {
		const up = this._document.unknownProblem;
		if (!up) return;
		if (!Number.isFinite(multiplier) || Math.abs(multiplier) <= 1e-15) return;

		const targetComp = this._document.components.find((c) => c.id === componentId);
		if (!targetComp) return;

		const currentTerms = getUnknownTerms(up);
		const primaryComp = this._document.components.find(
			(c) => c.id === (currentTerms[0]?.componentId ?? up.componentId)
		);
		if (!primaryComp) return;
		if (!areUnknownKindsCompatible(primaryComp.kind, targetComp.kind)) return;

		const isPassive =
			targetComp.kind === 'resistor' ||
			targetComp.kind === 'capacitor' ||
			targetComp.kind === 'inductor';
		if (isPassive && multiplier <= 0) return;

		this.recordSnapshot();
		const exists = currentTerms.some((t) => t.componentId === componentId);
		const nextTerms = exists
			? currentTerms.map((t) =>
					t.componentId === componentId ? { componentId, multiplier } : { ...t }
				)
			: [...currentTerms.map((t) => ({ ...t })), { componentId, multiplier }];

		this._document = {
			...this._document,
			unknownProblem: {
				...up,
				terms: nextTerms,
				constraint: { ...up.constraint }
			}
		};
	}

	/**
	 * Unlinks a component from the active `unknownProblem`.
	 * Promotes the next remaining term to primary `componentId`, or clears `unknownProblem` if none remain.
	 */
	unlinkComponentFromUnknown(componentId: string): void {
		const up = this._document.unknownProblem;
		if (!up) return;

		const currentTerms = getUnknownTerms(up);
		if (!currentTerms.some((t) => t.componentId === componentId)) return;

		this.recordSnapshot();
		const remaining = currentTerms
			.filter((t) => t.componentId !== componentId)
			.map((t) => ({ ...t }));

		if (remaining.length === 0) {
			this._document = {
				...this._document,
				unknownProblem: undefined
			};
			return;
		}

		const nextPrimaryId =
			up.componentId === componentId ? remaining[0].componentId : up.componentId;
		this._document = {
			...this._document,
			unknownProblem: {
				...up,
				componentId: nextPrimaryId,
				terms: remaining,
				constraint: { ...up.constraint }
			}
		};
	}

	/**
	 * Updates the scalar multiplier for an already-linked unknown term.
	 */
	setUnknownTermMultiplier(componentId: string, multiplier: number): void {
		const up = this._document.unknownProblem;
		if (!up) return;
		if (!Number.isFinite(multiplier) || Math.abs(multiplier) <= 1e-15) return;

		const targetComp = this._document.components.find((c) => c.id === componentId);
		if (!targetComp) return;
		const isPassive =
			targetComp.kind === 'resistor' ||
			targetComp.kind === 'capacitor' ||
			targetComp.kind === 'inductor';
		if (isPassive && multiplier <= 0) return;

		const currentTerms = getUnknownTerms(up);
		const existing = currentTerms.find((t) => t.componentId === componentId);
		if (!existing) return;
		if (Math.abs(existing.multiplier - multiplier) < 1e-15) return;

		this.recordSnapshot();
		const nextTerms = currentTerms.map((t) =>
			t.componentId === componentId ? { componentId, multiplier } : { ...t }
		);
		this._document = {
			...this._document,
			unknownProblem: {
				...up,
				terms: nextTerms,
				constraint: { ...up.constraint }
			}
		};
	}

	/**
	 * Writes the solved unknown value(s) directly into all linked component(s) and clears
	 * `unknownProblem` in a single undoable step.
	 */
	applySolvedUnknown(solutionIndex = 0): boolean {
		const unknownRes = this._solution.unknownSolution;
		if (!unknownRes || !unknownRes.valid) return false;
		const candidate = unknownRes.solutions[solutionIndex];
		if (!candidate) return false;

		const updates = new Map<string, string>();
		if (candidate.termValues && candidate.termValues.length > 0) {
			for (const tv of candidate.termValues) {
				updates.set(tv.componentId, tv.valueString);
			}
		} else {
			updates.set(unknownRes.componentId, candidate.valueString);
		}

		const hasAnyTarget = this._document.components.some((c) => updates.has(c.id));
		if (!hasAnyTarget) return false;

		this.recordSnapshot();
		this._document = {
			...this._document,
			unknownProblem: undefined,
			components: this._document.components.map((c) => {
				const nextValue = updates.get(c.id);
				if (nextValue === undefined) return c;
				const nextNumeric = parseEngineeringNumber(nextValue) ?? undefined;
				return {
					...c,
					value: nextValue,
					numericValue: nextNumeric,
					phaseDeg: undefined
				};
			})
		};
		return true;
	}

	/** Resets the store cleanly back to initial PRESETS[0] with empty undo/redo stacks (for tests). */
	resetToDefault(): void {
		this._document = cloneDocument(initialPreset.document);
		this._documentLoadSeq += 1;
		this._selectedComponentId = null;
		this._selectedWireId = null;
		this._activeTool = 'select';
		this._activeSourceMode = initialPreset.document.mode;
		this._placementRotation = 0;
		this._theveninTarget = initialPreset.theveninLoadId
			? { kind: 'component', componentId: initialPreset.theveninLoadId }
			: undefined;
		this._activeMethod = initialPreset.featuredMethod ?? 'nodal';
		this._emptyBannerDismissed = false;
		this._undoStack = [];
		this._redoStack = [];
	}
}

export const circuit = new CircuitStore();
