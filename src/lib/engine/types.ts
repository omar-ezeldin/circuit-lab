/**
 * Core domain types for Circuit Lab's electrical engine, netlist, MNA solver,
 * and step-by-step mathematical derivation pipeline.
 */

import type { Complex } from './complex';

export type SchematicStandard = 'ieee' | 'iec';
export type AnalysisMode = 'dc' | 'ac';
export type AcMagnitudeMode = 'rms' | 'peak';
export type UnitSystemId = 'auto' | 'ohm-v-a' | 'kohm-v-ma' | 'mohm-v-ua';
export type PassiveValueMode = 'physical' | 'impedance';

export type DependentSourceKind = 'vcvs' | 'vccs' | 'ccvs' | 'cccs';

export type ComponentKind =
	| 'resistor'
	| 'capacitor'
	| 'inductor'
	| 'voltage_source'
	| 'current_source'
	| DependentSourceKind
	| 'ground'
	| 'terminal'
	| 'voltmeter';

export type AnyComponentKind = ComponentKind;

export function isDependentSourceKind(kind: ComponentKind): kind is DependentSourceKind {
	return kind === 'vcvs' || kind === 'vccs' || kind === 'ccvs' || kind === 'cccs';
}

export function isDependentVoltageSource(kind: ComponentKind): kind is 'vcvs' | 'ccvs' {
	return kind === 'vcvs' || kind === 'ccvs';
}

export function isDependentCurrentSource(kind: ComponentKind): kind is 'vccs' | 'cccs' {
	return kind === 'vccs' || kind === 'cccs';
}

export function isVoltageControlledSource(kind: ComponentKind): kind is 'vcvs' | 'vccs' {
	return kind === 'vcvs' || kind === 'vccs';
}

export function isCurrentControlledSource(kind: ComponentKind): kind is 'ccvs' | 'cccs' {
	return kind === 'ccvs' || kind === 'cccs';
}

export type Rotation = 0 | 90 | 180 | 270;

export interface GridPoint {
	x: number;
	y: number;
}

/**
 * Control reference for linear dependent sources (`vcvs`, `vccs`, `ccvs`, `cccs`).
 */
export interface DependentControlRef {
	/** For VCVS/VCCS: optional controlling component ID (V_ctrl = V_pin0 - V_pin1, flipped if controlPolarity === -1) */
	controlComponentId?: string;
	/** For VCVS/VCCS: controlling positive/negative nodes (used when controlComponentId is not set) */
	controlNodePos?: string;
	controlNodeNeg?: string;
	/**
	 * Pin anchors for controlNodePos/Neg. Node IDs are renumbered when the layout changes, so the
	 * store re-resolves the node names from these pins before solving (engine ignores them).
	 */
	controlNodePosPin?: PinAnchor;
	controlNodeNegPin?: PinAnchor;
	/** For CCVS/CCCS: ID of branch component whose current (pin 0 -> pin 1) controls the source */
	controlBranchComponentId?: string;
	/** Optional sign multiplier for the controlling variable (+1 default, -1 flipped) */
	controlPolarity?: 1 | -1;
	/** Optional textbook display variable name (e.g. "v_x", "i_x", "v_o") */
	controlVarName?: string;
	/** Scalar or complex gain (A_v, g_m, r_m, beta) — synced with component.value */
	gain?: number | string;
}

export interface CircuitComponent {
	id: string;
	kind: ComponentKind;
	label: string;
	x: number;
	y: number;
	rotation: Rotation;
	/** Engineering value string, e.g. "10k", "4.7u", "10∠30°" */
	value: string;
	/** Optional pre-parsed numeric magnitude (used if value string is omitted or synced) */
	numericValue?: number;
	/** Optional AC phase in degrees (for sources) */
	phaseDeg?: number;
	/** Optional per-source frequency in Hz (for multi-frequency AC superposition) */
	frequencyHz?: number;
	/** Optional unit label (e.g. "Ω", "F", "H", "V", "A") */
	unit?: string;
	/** Passive value interpretation: physical H/F (default) or direct AC impedance in Ω */
	valueMode?: PassiveValueMode;
	/** Optional port name for 'terminal' components (e.g. "A", "B") */
	terminalName?: string;
	/** Reserved for v2 dependent sources (VCVS, VCCS, CCVS, CCCS) */
	controlRef?: DependentControlRef;
}

export interface CircuitWire {
	id: string;
	points: GridPoint[];
}

export type ConstraintKind = 'node_voltage' | 'branch_voltage' | 'branch_current' | 'branch_power';

export interface CircuitConstraint {
	kind: ConstraintKind;
	/** For node_voltage: nodeId (e.g. "B"); for branch_*: componentId */
	targetId: string;
	/** Target value string (e.g. "6", "2m", "12m", "10∠30°") */
	value: string;
	/** Optional display label (e.g. "V_o", "I_x", "P_R2") */
	label?: string;
	/**
	 * For node_voltage: a component pin on the target node. Node IDs (A, B, ...) are renumbered
	 * whenever the layout changes, so the store re-resolves `targetId` from this pin before solving.
	 */
	targetPin?: PinAnchor;
}

/** A stable reference to an electrical node: one component pin that sits on it. */
export interface PinAnchor {
	componentId: string;
	pinIndex: number;
}

export interface UnknownTerm {
	/** Target component ID whose value is `multiplier * X` */
	componentId: string;
	/** Non-zero finite scalar multiplier (e.g., 1 for `V`, 2 for `2V`, -0.5 for `-0.5V`) */
	multiplier: number;
}

export interface UnknownTermSolvedValue {
	componentId: string;
	componentLabel: string;
	multiplier: number;
	value: Complex;
	valueString: string;
	unit: string;
}

export interface UnknownProblemSpec {
	/** ID of the primary component whose value is unknown (voltage_source, current_source, resistor, capacitor, inductor) */
	componentId: string;
	/** Optional symbol name shown on schematic/results (e.g. "V", "Vs", "Rx") */
	symbol?: string;
	/** Optional list of all linked components and their scalar multipliers (primary componentId is always included) */
	terms?: UnknownTerm[];
	/** Known measurement constraint that uniquely determines the unknown */
	constraint: CircuitConstraint;
}

export interface UnknownSolutionCandidate {
	/** Complex value for sources, real scalar in base SI (Ω, F, H) for passives */
	value: Complex;
	/** Formatted canonical value string ready to substitute into CircuitComponent.value */
	valueString: string;
	/** Exact scaled values (`multiplier * X`) for every linked component */
	termValues?: UnknownTermSolvedValue[];
	/** Absolute discrepancy |y(solved) - y_target| verified via full MNA re-solve */
	discrepancy: number;
	verified: boolean;
}

export interface UnknownSolveResult {
	valid: boolean;
	componentId: string;
	componentLabel: string;
	componentKind: ComponentKind;
	symbol: string;
	/** Metadata for all linked unknown elements */
	terms?: Array<{
		componentId: string;
		componentLabel: string;
		kind: ComponentKind;
		multiplier: number;
	}>;
	constraint: CircuitConstraint;
	methodName: string;
	/** 1 solution for linear targets, up to 2 valid solutions for quadratic power targets */
	solutions: UnknownSolutionCandidate[];
	error?: string;
	steps: SolutionStep[];
}

export interface CircuitDocument {
	schemaVersion: 1;
	id?: string;
	name?: string;
	mode: AnalysisMode;
	frequencyHz: number;
	acMagnitudeMode?: AcMagnitudeMode;
	unitSystem?: UnitSystemId;
	components: CircuitComponent[];
	wires: CircuitWire[];
	unknownProblem?: UnknownProblemSpec;
	/** Custom node names, each anchored by a pin on the node (node IDs are renumbered by layout). */
	nodeNames?: Array<{ pin: PinAnchor; name: string }>;
}

export interface NetlistElement {
	id?: string;
	kind: ComponentKind;
	label: string;
	/** Node names in pin order: [pin0, pin1] for 2-terminal, [pin0] for 1-terminal */
	nodes: string[];
	value: string;
	phaseDeg?: number;
	unit?: string;
	valueMode?: PassiveValueMode;
	terminalName?: string;
	/** Coarse integer schematic grid position [col, row] of the `from` (pin 0 / + / tail) terminal in the source image */
	fromPos?: [number, number];
	/** Coarse integer schematic grid position [col, row] of the `to` (pin 1 / - / head) terminal in the source image */
	toPos?: [number, number];
	/** Optional explicit unknown flag (or value === "?" / "unknown") */
	unknown?: boolean;
	unknownSymbol?: string;
	/** Optional scalar multiplier for scaled identical unknowns (e.g. 2 for `2V`) */
	unknownMultiplier?: number;
	/** Reserved for v2 dependent sources */
	controlRef?: DependentControlRef;
}

export interface AINetlistDocument {
	schemaVersion?: 1;
	name?: string;
	mode?: AnalysisMode;
	frequencyHz?: number;
	acMagnitudeMode?: AcMagnitudeMode;
	unitSystem?: UnitSystemId;
	groundNode?: string;
	elements: NetlistElement[];
	unknownProblem?: UnknownProblemSpec;
}

export type DiagnosticSeverity = 'error' | 'warning' | 'info';

export interface ValidationDiagnostic {
	severity: DiagnosticSeverity;
	code: string;
	message: string;
	componentIds?: string[];
	nodeIds?: string[];
}

export interface NodePinAttachment {
	componentId: string;
	pinIndex: number;
	pinName: string;
}

export interface NodeResult {
	nodeId: string;
	voltage: Complex;
	isReference: boolean;
	componentPins: NodePinAttachment[];
	gridPoints: GridPoint[];
}

export interface BranchResult {
	componentId: string;
	label: string;
	kind: ComponentKind;
	nodeA: string;
	nodeB: string;
	/** Passive sign convention: V_e = V_pin0 - V_pin1 */
	voltage: Complex;
	/** Passive sign convention: I_e flows from pin 0 to pin 1 */
	current: Complex;
	/** Complex impedance Z (null for ideal sources or DC open capacitors; 0 for DC shorted inductors) */
	impedance: Complex | null;
	/** Complex power absorbed by element: S = P + jQ */
	complexPower: Complex;
	/** Real power absorbed in Watts (negative means supplied) */
	realPower: number;
	/** Reactive power absorbed in VAR */
	reactivePower: number;
	/** Apparent power |S| in VA */
	apparentPower: number;
	/** Power factor P / |S| (absorbed P for passives, delivered P for sources), or null if |S| == 0.
	 *  `powerFactorType` uses the same view: a source feeding an inductive load is 'lagging'. */
	powerFactor: number | null;
	powerFactorType?: 'leading' | 'lagging' | 'unity';
	/** True for ideal non-intrusive measurement instruments (e.g. ideal voltmeter, Y = 0, I = 0) */
	isMeasurementOnly?: boolean;
}

export interface PowerSummary {
	totalRealPower: number;
	totalReactivePower: number;
	totalAbsorbedReal: number;
	totalSuppliedReal: number;
	balanced: boolean;
}

export interface MnaSystemSnapshot {
	A: Complex[][];
	b: Complex[];
	x: Complex[];
	unknownLabels: string[];
	nodeOrder: string[];
	voltageBranchOrder: string[];
}

export interface MnaSolution {
	valid: boolean;
	mode: AnalysisMode;
	frequencyHz: number;
	acMagnitudeMode: AcMagnitudeMode;
	/**
	 * Set when active AC sources run at different frequencies. The single-phasor node/branch
	 * values are then NOT a valid answer (they mix frequencies); only Superposition is.
	 */
	multiFrequencyHz?: number[];
	diagnostics: ValidationDiagnostic[];
	nodeVoltages: Record<string, NodeResult>;
	branches: Record<string, BranchResult>;
	powerBalance: PowerSummary;
	system?: MnaSystemSnapshot;
	pivotMin?: number;
}

export interface SolutionStep {
	title: string;
	description: string;
	latex?: string[];
	matrixLatex?: string;
	highlightIds?: string[];
	snapshotNote?: string;
}

export type MethodId =
	| 'kcl_kvl'
	| 'nodal'
	| 'mesh'
	| 'superposition'
	| 'source_transform'
	| 'thevenin_norton';

export interface MethodResult {
	methodId: MethodId;
	title: string;
	applicable: boolean;
	inapplicableReason?: string;
	steps: SolutionStep[];
	summaryLatex?: string;
	/** True when independently solved voltages/currents match MNA within < 1e-8 */
	verifiedAgainstMna?: boolean;
	/** Maximum absolute discrepancy against MNA ground truth */
	maxDiscrepancy?: number;
}

export type TheveninTarget =
	| { kind: 'component'; componentId: string }
	| { kind: 'terminals'; nodeA: string; nodeB: string; pinA?: PinAnchor; pinB?: PinAnchor };

export interface MaxPowerTransferInfo {
	optimalLoadImpedance: Complex;
	maxRealPowerW: number;
}

export interface TheveninNortonResult {
	terminalA: string;
	terminalB: string;
	loadComponentId?: string;
	vth: Complex;
	isc: Complex | null;
	zth: Complex | null;
	maxPowerTransfer?: MaxPowerTransferInfo;
	verifiedAgainstMna?: boolean;
	maxDiscrepancy?: number;
	steps: SolutionStep[];
}

export interface FullSolveResult {
	mna: MnaSolution;
	methods: Partial<Record<MethodId, MethodResult>>;
	theveninNorton?: TheveninNortonResult;
	unknownSolution?: UnknownSolveResult;
	allVerified: boolean;
	maxDiscrepancy: number;
}
