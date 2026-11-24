export type MachineCategory =
	| 'three-phase'
	| 'magnetic'
	| 'transformer'
	| 'dc-machines'
	| 'induction-motor';

export type MachineQuestionTypeId =
	| 'QT-3PH-1'
	| 'QT-MAG-1'
	| 'QT-MAG-2'
	| 'QT-MAG-3'
	| 'QT-XFMR-1'
	| 'QT-XFMR-2'
	| 'QT-XFMR-3'
	| 'QT-XFMR-4'
	| 'QT-DC-1'
	| 'QT-DC-2'
	| 'QT-DC-3'
	| 'QT-IM-1'
	| 'QT-IM-2'
	| 'QT-IM-3';

export interface MachineStep {
	title: string;
	formulaLatex: string;
	substitutionLatex?: string;
	resultLatex?: string;
	note?: string;
}

export interface MachineAnswerItem {
	key: string;
	label: string;
	symbolLatex?: string;
	value: number | string;
	unit: string;
	formatted: string;
	highlight?: boolean;
}

export interface MachineSolveResult {
	valid: boolean;
	questionType: MachineQuestionTypeId;
	title: string;
	answers: MachineAnswerItem[];
	values: Record<string, number>;
	steps: MachineStep[];
	warnings?: string[];
	error?: string;
}

// ============================================================================
// QT-3PH-1: Balanced Three-Phase Circuits
// ============================================================================

export type ThreePhaseConnection = 'Y' | 'D';
export type PowerFactorType = 'lag' | 'lead' | 'unity';

export interface ThreePhaseInput {
	loadConnection: ThreePhaseConnection;
	sourceConnection?: ThreePhaseConnection;
	voltageType: 'line' | 'phase';
	voltageV: number;
	loadMode: 'impedance' | 'power';
	/** Per-phase load resistance (Ohms) when loadMode === 'impedance' */
	loadR?: number;
	/** Per-phase load reactance (Ohms, +inductive / -capacitive) when loadMode === 'impedance' */
	loadX?: number;
	/** Whether powerW or apparentVA is total 3-phase or per-phase */
	powerScope?: 'total' | 'per-phase';
	/** Active power (W) when loadMode === 'power' */
	powerW?: number;
	/** Apparent power (VA) when loadMode === 'power' (alternative to powerW) */
	apparentVA?: number;
	/** Power factor (0 < pf <= 1) when loadMode === 'power' */
	pf?: number;
	pfType?: PowerFactorType;
	/** Optional line resistance per phase (Ohms) */
	lineR?: number;
	/** Optional line reactance per phase (Ohms) */
	lineX?: number;
}

// ============================================================================
// QT-MAG-1: Linear Series Magnetic Circuit
// ============================================================================

export interface LinearMagneticInput {
	coreLengthM: number;
	/** Core cross-sectional area in m^2 (optional; omit when only B, H, M are sought) */
	coreAreaM2?: number;
	/** Relative permeability (use Infinity or idealCore: true for infinite permeability) */
	muR: number;
	idealCore?: boolean;
	/** Air-gap length in m (0 if no air gap) */
	gapLengthM: number;
	/** Fringing factor in percent (e.g. 5 for 5% increase in gap area) */
	fringingPercent?: number;
	/** Explicit air-gap area in m^2 (overrides fringingPercent if provided) */
	gapAreaM2?: number;
	turns: number;
	excitationMode: 'current' | 'flux' | 'flux-density';
	currentA?: number;
	fluxWb?: number;
	gapFluxDensityT?: number;
	/** Optional coil resistance (Ohms) and frequency (Hz) for quality factor Q */
	coilResistanceOhm?: number;
	frequencyHz?: number;
}

// ============================================================================
// QT-MAG-2: Nonlinear B-H & Multi-Limb Parallel Magnetic Circuits
// ============================================================================

export interface BHPoint {
	H: number;
	B: number;
}

export interface NonlinearMagneticInput {
	topology: 'series-nonlinear' | 'parallel-3limb';
	bhTable?: BHPoint[];
	/** Constant mu_r fallback for linear 3-limb parallel cores */
	muR?: number;
	turns: number;
	// Series-nonlinear fields
	coreLengthM?: number;
	coreAreaM2?: number;
	gapLengthM?: number;
	fringingPercent?: number;
	solveFor?: 'current' | 'flux';
	fluxWb?: number;
	fluxDensityT?: number;
	currentA?: number;
	// Parallel 3-limb fields (left = excited outer limb, center = middle limb, right = target outer limb)
	leftLengthM?: number;
	leftAreaM2?: number;
	centerLengthM?: number;
	centerAreaM2?: number;
	centerGapLengthM?: number;
	rightLengthM?: number;
	rightAreaM2?: number;
	rightGapLengthM?: number;
	rightFluxWb?: number;
}

// ============================================================================
// QT-MAG-3: Variable-Reluctance Relay / Movable-Core Actuator
// ============================================================================

export interface VariableReluctanceInput {
	coreLengthM: number;
	coreAreaM2: number;
	muR: number;
	idealCore?: boolean;
	turns: number;
	/** Number of identical air gaps in series (1 for single-gap, 2 for U-core/E-core relay) */
	numGaps: number;
	/** Initial air-gap length per gap (m) */
	initialGapM: number;
	/** Final air-gap length per gap (m), e.g. 0 when closed */
	finalGapM: number;
	/** Movement constraint: slow = constant current, fast = constant flux/linkage */
	constraint: 'constant-current' | 'constant-flux';
	initialFluxDensityT?: number;
	initialFluxWb?: number;
	initialCurrentA?: number;
}

// ============================================================================
// QT-XFMR-1: Transformer EMF & Core Loss Separation / (V, f) Scaling
// ============================================================================

export interface TransformerEmfCoreLossInput {
	mode: 'emf' | 'loss-separation' | 'vf-scaling';
	// EMF mode
	frequencyHz?: number;
	n1?: number;
	n2?: number;
	maxFluxWb?: number;
	maxFluxDensityT?: number;
	coreAreaM2?: number;
	primaryVoltageV?: number;
	// Loss separation mode (constant B_m)
	f1Hz?: number;
	pc1W?: number;
	f2Hz?: number;
	pc2W?: number;
	targetFreqHz?: number;
	// (V, f) scaling mode
	v1V?: number;
	ph1W?: number;
	pe1W?: number;
	v2V?: number;
	steinmetzN?: number;
}

// ============================================================================
// QT-XFMR-2: Transformer OC & SC Tests
// ============================================================================

export interface TransformerOcScInput {
	ratedVA: number;
	v1Rated: number;
	v2Rated: number;
	frequencyHz: number;
	ocSide: 'LV' | 'HV';
	vOc: number;
	iOc: number;
	pOc: number;
	scSide: 'HV' | 'LV';
	vSc: number;
	iSc: number;
	pSc: number;
	referTo: 'primary' | 'secondary';
	/** Optional on-load evaluation after extracting parameters */
	evalLoadFraction?: number;
	evalPf?: number;
	evalPfType?: PowerFactorType;
}

// ============================================================================
// QT-XFMR-3: Transformer On-Load Equivalent Circuit Performance
// ============================================================================

export interface TransformerOnLoadInput {
	ratedVA: number;
	v1Rated: number;
	v2Rated: number;
	frequencyHz?: number;
	/** Parameter specification: referred to primary, referred to secondary, or separate windings */
	paramRef?: 'primary' | 'secondary' | 'separate';
	re?: number;
	xe?: number;
	rc?: number;
	xm?: number;
	/** Alternative conductance/susceptance inputs in Siemens (mho) */
	gc?: number;
	bm?: number;
	/** Separate winding parameters when paramRef === 'separate' */
	r1?: number;
	x1?: number;
	r2?: number;
	x2?: number;
	/** Optional direct no-load loss & PF instead of rc/xm */
	pCoreW?: number;
	pfNoLoad?: number;
	/** Load specification */
	loadFraction?: number;
	loadVA?: number;
	loadWatts?: number;
	pf: number;
	pfType: PowerFactorType;
}

// ============================================================================
// QT-XFMR-4: Transformer Efficiency vs Load & Loss Separation
// ============================================================================

export interface TransformerEfficiencyPoint {
	loadFraction: number;
	pf: number;
	efficiencyPercent: number;
}

export interface TransformerEfficiencyInput {
	mode: 'known-losses' | 'two-point-separation';
	ratedVA: number;
	// Known-losses mode
	pCoreW?: number;
	pCuFlW?: number;
	loadFraction?: number;
	pf?: number;
	maxEffPf?: number;
	// Two-point separation mode
	point1?: TransformerEfficiencyPoint;
	point2?: TransformerEfficiencyPoint;
	targetLoadFraction?: number;
	targetPf?: number;
}

// ============================================================================
// QT-DC-1: DC Machine EMF, Winding Constant & Torque
// ============================================================================

export interface DcEmfTorqueInput {
	mode: 'winding-design' | 'operating-point';
	// Winding design mode
	poles?: number;
	conductors?: number;
	winding?: 'lap' | 'wave';
	fluxPerPoleWb?: number;
	// Operating point mode
	machineMode?: 'motor' | 'generator';
	vtV?: number;
	raOhm?: number;
	pInW?: number;
	// Shared
	speedRpm: number;
	armatureCurrentA?: number;
	/** Optional second armature current to scale torque at constant flux */
	targetArmatureCurrentA?: number;
}

// ============================================================================
// QT-DC-2: DC Generator Steady-State Analysis
// ============================================================================

export interface DcGeneratorInput {
	generatorType: 'separately-excited' | 'shunt';
	solveFor: 'emf-from-load' | 'load-from-emf';
	vtV: number;
	raOhm: number;
	rfOhm?: number;
	rrhOhm?: number;
	vBrushV?: number;
	/** Required when solveFor === 'load-from-emf' */
	eaV?: number;
	/** Required when solveFor === 'emf-from-load' (either iLoadA or pOutW) */
	iLoadA?: number;
	pOutW?: number;
	/** Optional no-load terminal voltage for VR calculation */
	vNoLoadV?: number;
	/** Optional rotational losses for efficiency */
	pRotW?: number;
	/** Optional speed scaling */
	speed1Rpm?: number;
	speed2Rpm?: number;
}

// ============================================================================
// QT-DC-3: DC Motor Speed Control & Operating-Point Re-evaluation
// ============================================================================

export interface DcMotorInput {
	motorType: 'separately-excited' | 'shunt';
	vt1V: number;
	n1Rpm: number;
	raOhm: number;
	rfOhm?: number;
	vBrushV?: number;
	ia1A?: number;
	pIn1W?: number;
	pRotW?: number;
	controlMode: 'armature-resistance' | 'terminal-voltage' | 'field-flux' | 'starting';
	/** Added armature series resistance (Ohms) */
	rAddOhm?: number;
	/** Torque ratio T_d2 / T_d1 (default 1 = constant torque) */
	torqueRatio?: number;
	/** New terminal voltage (V) for terminal-voltage control */
	vt2V?: number;
	/** Load constraint under voltage or flux control */
	loadConstraint?: 'constant-torque' | 'constant-power' | 'constant-current';
	/** Flux ratio Phi_2 / Phi_1 for field-flux control */
	fluxRatio?: number;
	/** Maximum allowed starting current (A) for starting mode */
	maxStartCurrentA?: number;
}

// ============================================================================
// QT-IM-1: Induction Motor Speed, Slip, Rotor Frequency & Rated Torque
// ============================================================================

export interface InductionMotorBasicInput {
	poles: number;
	frequencyHz: number;
	/** Slip as decimal (e.g. 0.04 for 4%) */
	slip?: number;
	/** Alternative to slip: rotor speed in RPM */
	rotorSpeedRpm?: number;
	/** Optional no-load slip (decimal) */
	noLoadSlip?: number;
	/** Optional output power in Watts or HP */
	pOutW?: number;
	pOutHp?: number;
}

// ============================================================================
// QT-IM-2: Induction Motor Power Flow Stage Analysis
// ============================================================================

export interface InductionMotorPowerFlowInput {
	direction: 'forward' | 'backward';
	connection: ThreePhaseConnection;
	vLineV?: number;
	poles: number;
	frequencyHz: number;
	/** Forward inputs */
	iLineA?: number;
	pf?: number;
	pInW?: number;
	/** Backward inputs */
	pOutW?: number;
	pOutHp?: number;
	/** Speed / slip / rotor copper loss */
	slip?: number;
	rotorSpeedRpm?: number;
	pRotorCuW?: number;
	/** Losses (W) */
	pStatorCuW?: number;
	pCoreW?: number;
	pMechW?: number;
}

// ============================================================================
// QT-IM-3: Induction Motor Equivalent Circuit
// ============================================================================

export interface InductionMotorEquivCircuitInput {
	model: 'exact-T' | 'approx-cantilever';
	connection: ThreePhaseConnection;
	vLineV: number;
	poles: number;
	frequencyHz: number;
	slip: number;
	r1: number;
	x1: number;
	r2Prime: number;
	x2Prime: number;
	xm: number;
	/** Optional core-loss shunt resistance (Ohms/phase) */
	rc?: number;
	/** Optional lumped core loss (W) when rc is omitted */
	pCoreW?: number;
	/** Rotational/mechanical losses (W) */
	pMechW?: number;
}

// ============================================================================
// Dispatcher Map & Catalog Metadata Types
// ============================================================================

export interface MachineInputMap {
	'QT-3PH-1': ThreePhaseInput;
	'QT-MAG-1': LinearMagneticInput;
	'QT-MAG-2': NonlinearMagneticInput;
	'QT-MAG-3': VariableReluctanceInput;
	'QT-XFMR-1': TransformerEmfCoreLossInput;
	'QT-XFMR-2': TransformerOcScInput;
	'QT-XFMR-3': TransformerOnLoadInput;
	'QT-XFMR-4': TransformerEfficiencyInput;
	'QT-DC-1': DcEmfTorqueInput;
	'QT-DC-2': DcGeneratorInput;
	'QT-DC-3': DcMotorInput;
	'QT-IM-1': InductionMotorBasicInput;
	'QT-IM-2': InductionMotorPowerFlowInput;
	'QT-IM-3': InductionMotorEquivCircuitInput;
}

export interface MachineCategoryMeta {
	id: MachineCategory;
	title: string;
	shortTitle: string;
	chapterLabel: string;
	description: string;
	questionTypes: MachineQuestionTypeId[];
}

export interface MachinePreset<T = unknown> {
	id: string;
	label: string;
	source: string;
	description: string;
	input: T;
}

export interface MachineQuestionTypeMeta<
	K extends MachineQuestionTypeId = MachineQuestionTypeId
> {
	id: K;
	category: MachineCategory;
	title: string;
	shortLabel: string;
	description: string;
	keyFormulasLatex: string[];
	presets: MachinePreset<MachineInputMap[K]>[];
}
