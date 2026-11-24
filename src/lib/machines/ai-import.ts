import {
	solveThreePhase
} from './three-phase';
import {
	solveLinearMagneticCircuit,
	solveNonlinearOrParallelMagnetic,
	solveVariableReluctanceActuator
} from './magnetic';
import {
	solveTransformerEfficiencyLoad,
	solveTransformerEmfAndCoreLoss,
	solveTransformerOcScTests,
	solveTransformerOnLoad
} from './transformer';
import {
	solveDcEmfAndTorque,
	solveDcGenerator,
	solveDcMotor
} from './dc-machines';
import {
	solveInductionMotorBasic,
	solveInductionMotorEquivCircuit,
	solveInductionMotorPowerFlow
} from './induction-motor';
import type {
	BHPoint,
	MachineInputMap,
	MachineQuestionTypeId,
	MachineSolveResult,
	TransformerEfficiencyPoint
} from './types';

// ============================================================================
// Semantic Topic Slugs (1-to-1 with all 14 MachineQuestionTypeId values)
// ============================================================================

export type MachineAiTopicSlug =
	| 'three_phase'
	| 'magnetic_linear'
	| 'magnetic_nonlinear'
	| 'magnetic_relay'
	| 'transformer_emf_core'
	| 'transformer_oc_sc'
	| 'transformer_on_load'
	| 'transformer_efficiency'
	| 'dc_emf_torque'
	| 'dc_generator'
	| 'dc_motor'
	| 'induction_basic'
	| 'induction_power_flow'
	| 'induction_equiv_circuit';

export const MACHINE_AI_TOPIC_SLUG_MAP: Record<MachineAiTopicSlug, MachineQuestionTypeId> = {
	three_phase: 'QT-3PH-1',
	magnetic_linear: 'QT-MAG-1',
	magnetic_nonlinear: 'QT-MAG-2',
	magnetic_relay: 'QT-MAG-3',
	transformer_emf_core: 'QT-XFMR-1',
	transformer_oc_sc: 'QT-XFMR-2',
	transformer_on_load: 'QT-XFMR-3',
	transformer_efficiency: 'QT-XFMR-4',
	dc_emf_torque: 'QT-DC-1',
	dc_generator: 'QT-DC-2',
	dc_motor: 'QT-DC-3',
	induction_basic: 'QT-IM-1',
	induction_power_flow: 'QT-IM-2',
	induction_equiv_circuit: 'QT-IM-3'
};

export const MACHINE_QUESTION_TYPE_TO_SLUG: Record<MachineQuestionTypeId, MachineAiTopicSlug> = {
	'QT-3PH-1': 'three_phase',
	'QT-MAG-1': 'magnetic_linear',
	'QT-MAG-2': 'magnetic_nonlinear',
	'QT-MAG-3': 'magnetic_relay',
	'QT-XFMR-1': 'transformer_emf_core',
	'QT-XFMR-2': 'transformer_oc_sc',
	'QT-XFMR-3': 'transformer_on_load',
	'QT-XFMR-4': 'transformer_efficiency',
	'QT-DC-1': 'dc_emf_torque',
	'QT-DC-2': 'dc_generator',
	'QT-DC-3': 'dc_motor',
	'QT-IM-1': 'induction_basic',
	'QT-IM-2': 'induction_power_flow',
	'QT-IM-3': 'induction_equiv_circuit'
};

export const ALL_MACHINE_AI_TOPIC_SLUGS = Object.keys(
	MACHINE_AI_TOPIC_SLUG_MAP
) as MachineAiTopicSlug[];

// ============================================================================
// AI Prompt for Electrical Machines Problem Extraction
// ============================================================================

export const AI_MACHINES_IMPORT_PROMPT = `You are an Electrical Engineering exam problem extractor for Circuit Lab (Electrical Machines Mode).
Read the attached photo or text of an Electrical Machines problem, pick the single best matching "type" slug from the 14 schemas below, convert all values into the exact required SI/base units, and output ONLY a valid JSON object (no commentary outside the JSON).

Output envelope:
{
  "type": "<one of the 14 topic slugs below>",
  "title": "<concise problem title>",
  "input": { ...exact keys for that topic... }
}

Strict unit conversion rules:
- Power: kW -> W (x1000), kVA -> VA (x1000), MVA -> VA (x1e6). Keep HP in pOutHp only when using pOutHp.
- Length & Area: cm -> m (x1e-2), mm -> m (x1e-3), cm^2 -> m^2 (x1e-4), mm^2 -> m^2 (x1e-6).
- Magnetic flux: mWb -> Wb (x1e-3).
- Slip & load fraction: percentage -> decimal (e.g. 4% slip -> 0.04, 75% full load -> 0.75).
- Efficiency: keep as percentage in efficiencyPercent (e.g. 96.5 for 96.5%).
- Fringing: keep as percentage in fringingPercent (e.g. 5 for 5%).
- Infinite permeability: set "idealCore": true and "muR": 0 (do not emit bare Infinity in JSON).
- Omit any optional keys not given in the problem.

The 14 topic schemas:

1. "three_phase" — Balanced Y/Delta Three-Phase Circuit
   Required: loadConnection ("Y"|"D"), voltageType ("line"|"phase"), voltageV (V), loadMode ("impedance"|"power")
   Optional: sourceConnection ("Y"|"D"), lineR (Ohm), lineX (Ohm)
   If loadMode="impedance": loadR (Ohm/ph), loadX (Ohm/ph, +inductive / -capacitive)
   If loadMode="power": powerScope ("total"|"per-phase"), powerW (W) OR apparentVA (VA), pf (0..1), pfType ("lag"|"lead"|"unity")

2. "magnetic_linear" — Linear Series Magnetic Circuit (Core + Air Gap)
   Required: coreLengthM (m), muR (number, or idealCore: true), gapLengthM (m), turns (N), excitationMode ("current"|"flux"|"flux-density")
   Optional: coreAreaM2 (m^2), idealCore (boolean), fringingPercent (%), gapAreaM2 (m^2), currentA (A), fluxWb (Wb), gapFluxDensityT (T), coilResistanceOhm (Ohm), frequencyHz (Hz)

3. "magnetic_nonlinear" — Nonlinear B-H Curve or Parallel 3-Limb Core
   Required: topology ("series-nonlinear"|"parallel-3limb"), turns (N)
   Optional: bhTable (array of {"H": number (A/m), "B": number (T)}), muR (constant fallback for linear 3-limb)
   If series-nonlinear: coreLengthM (m), coreAreaM2 (m^2), gapLengthM (m), fringingPercent (%), solveFor ("current"|"flux"), fluxWb (Wb) or fluxDensityT (T) or currentA (A)
   If parallel-3limb: leftLengthM, leftAreaM2, centerLengthM, centerAreaM2, centerGapLengthM, rightLengthM, rightAreaM2, rightGapLengthM (all m / m^2), rightFluxWb (Wb)

4. "magnetic_relay" — Variable-Reluctance Relay / Movable-Core Actuator
   Required: coreLengthM (m), coreAreaM2 (m^2), muR (number, or idealCore: true), turns (N), numGaps (1 or 2), initialGapM (m), finalGapM (m), constraint ("constant-current"|"constant-flux")
   Provide one initial excitation: initialFluxDensityT (T) OR initialFluxWb (Wb) OR initialCurrentA (A)
   Optional: idealCore (boolean)

5. "transformer_emf_core" — Transformer EMF Equation & Core Loss Separation / (V, f) Scaling
   Required: mode ("emf"|"loss-separation"|"vf-scaling")
   If mode="emf": frequencyHz (Hz), n1, n2, and maxFluxWb (Wb) OR (maxFluxDensityT (T) + coreAreaM2 (m^2)) OR primaryVoltageV (V)
   If mode="loss-separation": f1Hz (Hz), pc1W (W), f2Hz (Hz), pc2W (W), optional targetFreqHz (Hz)
   If mode="vf-scaling": v1V (V), f1Hz (Hz), ph1W (W), pe1W (W), v2V (V), f2Hz (Hz), optional steinmetzN (default 1.6)

6. "transformer_oc_sc" — Transformer Open-Circuit & Short-Circuit Tests
   Required: ratedVA (VA), v1Rated (V), v2Rated (V), frequencyHz (Hz), ocSide ("LV"|"HV"), vOc (V), iOc (A), pOc (W), scSide ("HV"|"LV"), vSc (V), iSc (A), pSc (W), referTo ("primary"|"secondary")
   Optional on-load evaluation: evalLoadFraction (0..2), evalPf (0..1), evalPfType ("lag"|"lead"|"unity")

7. "transformer_on_load" — Transformer On-Load Equivalent Circuit Performance
   Required: ratedVA (VA), v1Rated (V), v2Rated (V), pf (0..1), pfType ("lag"|"lead"|"unity")
   Parameters: paramRef ("primary"|"secondary"|"separate"); if primary/secondary: re, xe (Ohm), optional rc, xm (Ohm) or gc, bm (S) or pCoreW (W) + pfNoLoad; if separate: r1, x1, r2, x2 (Ohm)
   Load (provide one): loadFraction (decimal) OR loadVA (VA) OR loadWatts (W)
   Optional: frequencyHz (Hz)

8. "transformer_efficiency" — Transformer Efficiency vs Load & Two-Point Loss Separation
   Required: mode ("known-losses"|"two-point-separation"), ratedVA (VA)
   If mode="known-losses": pCoreW (W), pCuFlW (W), loadFraction (decimal), pf (0..1), optional maxEffPf (0..1)
   If mode="two-point-separation": point1 ({"loadFraction", "pf", "efficiencyPercent"}), point2 ({"loadFraction", "pf", "efficiencyPercent"}), optional targetLoadFraction, targetPf

9. "dc_emf_torque" — DC Machine EMF, Winding Constant & Torque
   Required: mode ("winding-design"|"operating-point"), speedRpm (RPM)
   If mode="winding-design": poles, conductors, winding ("lap"|"wave"), fluxPerPoleWb (Wb), optional armatureCurrentA (A), targetArmatureCurrentA (A)
   If mode="operating-point": machineMode ("motor"|"generator"), vtV (V), raOhm (Ohm), armatureCurrentA (A) or pInW (W), optional targetArmatureCurrentA (A)

10. "dc_generator" — DC Generator Steady-State Analysis
    Required: generatorType ("separately-excited"|"shunt"), solveFor ("emf-from-load"|"load-from-emf"), vtV (V), raOhm (Ohm)
    If shunt: rfOhm (Ohm), optional rrhOhm (Ohm)
    If solveFor="emf-from-load": iLoadA (A) OR pOutW (W)
    If solveFor="load-from-emf": eaV (V)
    Optional: vBrushV (V), vNoLoadV (V), pRotW (W), speed1Rpm (RPM), speed2Rpm (RPM)

11. "dc_motor" — DC Motor Speed Control & Starting
    Required: motorType ("separately-excited"|"shunt"), vt1V (V), n1Rpm (RPM), raOhm (Ohm), controlMode ("armature-resistance"|"terminal-voltage"|"field-flux"|"starting")
    Provide initial load: ia1A (A) OR pIn1W (W). Optional: rfOhm (Ohm), vBrushV (V), pRotW (W)
    Control params: rAddOhm (Ohm), torqueRatio (T2/T1), vt2V (V), loadConstraint ("constant-torque"|"constant-power"|"constant-current"), fluxRatio (Phi2/Phi1), maxStartCurrentA (A)

12. "induction_basic" — Induction Motor Speed, Slip, Rotor Frequency & Rated Torque
    Required: poles, frequencyHz (Hz), and slip (decimal, e.g. 0.04) OR rotorSpeedRpm (RPM)
    Optional: noLoadSlip (decimal), pOutW (W) OR pOutHp (HP)

13. "induction_power_flow" — Induction Motor Power Flow Stage Analysis
    Required: direction ("forward"|"backward"), connection ("Y"|"D"), poles, frequencyHz (Hz)
    Speed/slip: slip (decimal) OR rotorSpeedRpm (RPM) (or pRotorCuW in W)
    If forward: (vLineV (V) + iLineA (A) + pf (0..1)) OR pInW (W)
    If backward: pOutW (W) OR pOutHp (HP)
    Optional losses (W): pStatorCuW, pCoreW, pMechW, pRotorCuW

14. "induction_equiv_circuit" — Induction Motor Equivalent Circuit (Exact T / Approx Cantilever)
    Required: model ("exact-T"|"approx-cantilever"), connection ("Y"|"D"), vLineV (V), poles, frequencyHz (Hz), slip (decimal), r1 (Ohm), x1 (Ohm), r2Prime (Ohm), x2Prime (Ohm), xm (Ohm)
    Optional: rc (Ohm/ph), pCoreW (W), pMechW (W)

Return ONLY valid JSON.`;

// ============================================================================
// Parser Result Types
// ============================================================================

export type MachineAiImportSuccess<K extends MachineQuestionTypeId = MachineQuestionTypeId> = {
	ok: true;
	questionTypeId: K;
	topicSlug: MachineAiTopicSlug;
	title?: string;
	input: MachineInputMap[K];
	previewResult: MachineSolveResult;
	warnings: string[];
};

export type MachineAiImportFailure = {
	ok: false;
	error: string;
};

export type MachineAiImportResult = MachineAiImportSuccess | MachineAiImportFailure;

// ============================================================================
// Field Normalization Schemas
// ============================================================================

interface TypeFieldSchema {
	numericFields: readonly string[];
	booleanFields?: readonly string[];
	enumFields?: Record<string, readonly string[]>;
	hasBhTable?: boolean;
	hasEfficiencyPoints?: boolean;
	allowsIdealCore?: boolean;
}

const THREE_PHASE_CONN = ['Y', 'D'] as const;
const PF_TYPES = ['lag', 'lead', 'unity'] as const;

const TYPE_SCHEMAS: Record<MachineQuestionTypeId, TypeFieldSchema> = {
	'QT-3PH-1': {
		numericFields: ['voltageV', 'loadR', 'loadX', 'powerW', 'apparentVA', 'pf', 'lineR', 'lineX'],
		enumFields: {
			loadConnection: THREE_PHASE_CONN,
			sourceConnection: THREE_PHASE_CONN,
			voltageType: ['line', 'phase'],
			loadMode: ['impedance', 'power'],
			powerScope: ['total', 'per-phase'],
			pfType: PF_TYPES
		}
	},
	'QT-MAG-1': {
		numericFields: [
			'coreLengthM',
			'coreAreaM2',
			'muR',
			'gapLengthM',
			'fringingPercent',
			'gapAreaM2',
			'turns',
			'currentA',
			'fluxWb',
			'gapFluxDensityT',
			'coilResistanceOhm',
			'frequencyHz'
		],
		booleanFields: ['idealCore'],
		enumFields: {
			excitationMode: ['current', 'flux', 'flux-density']
		},
		allowsIdealCore: true
	},
	'QT-MAG-2': {
		numericFields: [
			'muR',
			'turns',
			'coreLengthM',
			'coreAreaM2',
			'gapLengthM',
			'fringingPercent',
			'fluxWb',
			'fluxDensityT',
			'currentA',
			'leftLengthM',
			'leftAreaM2',
			'centerLengthM',
			'centerAreaM2',
			'centerGapLengthM',
			'rightLengthM',
			'rightAreaM2',
			'rightGapLengthM',
			'rightFluxWb'
		],
		enumFields: {
			topology: ['series-nonlinear', 'parallel-3limb'],
			solveFor: ['current', 'flux']
		},
		hasBhTable: true
	},
	'QT-MAG-3': {
		numericFields: [
			'coreLengthM',
			'coreAreaM2',
			'muR',
			'turns',
			'numGaps',
			'initialGapM',
			'finalGapM',
			'initialFluxDensityT',
			'initialFluxWb',
			'initialCurrentA'
		],
		booleanFields: ['idealCore'],
		enumFields: {
			constraint: ['constant-current', 'constant-flux']
		},
		allowsIdealCore: true
	},
	'QT-XFMR-1': {
		numericFields: [
			'frequencyHz',
			'n1',
			'n2',
			'maxFluxWb',
			'maxFluxDensityT',
			'coreAreaM2',
			'primaryVoltageV',
			'f1Hz',
			'pc1W',
			'f2Hz',
			'pc2W',
			'targetFreqHz',
			'v1V',
			'ph1W',
			'pe1W',
			'v2V',
			'steinmetzN'
		],
		enumFields: {
			mode: ['emf', 'loss-separation', 'vf-scaling']
		}
	},
	'QT-XFMR-2': {
		numericFields: [
			'ratedVA',
			'v1Rated',
			'v2Rated',
			'frequencyHz',
			'vOc',
			'iOc',
			'pOc',
			'vSc',
			'iSc',
			'pSc',
			'evalLoadFraction',
			'evalPf'
		],
		enumFields: {
			ocSide: ['LV', 'HV'],
			scSide: ['HV', 'LV'],
			referTo: ['primary', 'secondary'],
			evalPfType: PF_TYPES
		}
	},
	'QT-XFMR-3': {
		numericFields: [
			'ratedVA',
			'v1Rated',
			'v2Rated',
			'frequencyHz',
			're',
			'xe',
			'rc',
			'xm',
			'gc',
			'bm',
			'r1',
			'x1',
			'r2',
			'x2',
			'pCoreW',
			'pfNoLoad',
			'loadFraction',
			'loadVA',
			'loadWatts',
			'pf'
		],
		enumFields: {
			paramRef: ['primary', 'secondary', 'separate'],
			pfType: PF_TYPES
		}
	},
	'QT-XFMR-4': {
		numericFields: [
			'ratedVA',
			'pCoreW',
			'pCuFlW',
			'loadFraction',
			'pf',
			'maxEffPf',
			'targetLoadFraction',
			'targetPf'
		],
		enumFields: {
			mode: ['known-losses', 'two-point-separation']
		},
		hasEfficiencyPoints: true
	},
	'QT-DC-1': {
		numericFields: [
			'poles',
			'conductors',
			'fluxPerPoleWb',
			'vtV',
			'raOhm',
			'pInW',
			'speedRpm',
			'armatureCurrentA',
			'targetArmatureCurrentA'
		],
		enumFields: {
			mode: ['winding-design', 'operating-point'],
			winding: ['lap', 'wave'],
			machineMode: ['motor', 'generator']
		}
	},
	'QT-DC-2': {
		numericFields: [
			'vtV',
			'raOhm',
			'rfOhm',
			'rrhOhm',
			'vBrushV',
			'eaV',
			'iLoadA',
			'pOutW',
			'vNoLoadV',
			'pRotW',
			'speed1Rpm',
			'speed2Rpm'
		],
		enumFields: {
			generatorType: ['separately-excited', 'shunt'],
			solveFor: ['emf-from-load', 'load-from-emf']
		}
	},
	'QT-DC-3': {
		numericFields: [
			'vt1V',
			'n1Rpm',
			'raOhm',
			'rfOhm',
			'vBrushV',
			'ia1A',
			'pIn1W',
			'pRotW',
			'rAddOhm',
			'torqueRatio',
			'vt2V',
			'fluxRatio',
			'maxStartCurrentA'
		],
		enumFields: {
			motorType: ['separately-excited', 'shunt'],
			controlMode: ['armature-resistance', 'terminal-voltage', 'field-flux', 'starting'],
			loadConstraint: ['constant-torque', 'constant-power', 'constant-current']
		}
	},
	'QT-IM-1': {
		numericFields: ['poles', 'frequencyHz', 'slip', 'rotorSpeedRpm', 'noLoadSlip', 'pOutW', 'pOutHp']
	},
	'QT-IM-2': {
		numericFields: [
			'vLineV',
			'poles',
			'frequencyHz',
			'iLineA',
			'pf',
			'pInW',
			'pOutW',
			'pOutHp',
			'slip',
			'rotorSpeedRpm',
			'pRotorCuW',
			'pStatorCuW',
			'pCoreW',
			'pMechW'
		],
		enumFields: {
			direction: ['forward', 'backward'],
			connection: THREE_PHASE_CONN
		}
	},
	'QT-IM-3': {
		numericFields: [
			'vLineV',
			'poles',
			'frequencyHz',
			'slip',
			'r1',
			'x1',
			'r2Prime',
			'x2Prime',
			'xm',
			'rc',
			'pCoreW',
			'pMechW'
		],
		enumFields: {
			model: ['exact-T', 'approx-cantilever'],
			connection: THREE_PHASE_CONN
		}
	}
};

// ============================================================================
// JSON Extraction & Coercion Helpers
// ============================================================================

function extractOutermostJsonObject(text: string): string | null {
	const start = text.indexOf('{');
	if (start === -1) return null;

	let depth = 0;
	let inString = false;
	let escaped = false;

	for (let i = start; i < text.length; i++) {
		const ch = text[i];
		if (inString) {
			if (escaped) {
				escaped = false;
			} else if (ch === '\\') {
				escaped = true;
			} else if (ch === '"') {
				inString = false;
			}
			continue;
		}
		if (ch === '"') {
			inString = true;
		} else if (ch === '{') {
			depth++;
		} else if (ch === '}') {
			depth--;
			if (depth === 0) {
				return text.slice(start, i + 1);
			}
		}
	}
	return null;
}

function parseJsonFromRawText(rawText: string): { ok: true; value: unknown } | { ok: false; error: string } {
	const trimmed = rawText.trim();
	if (!trimmed) {
		return { ok: false, error: 'Paste JSON output from an AI assistant first.' };
	}

	// Prefer fenced ```json ... ``` blocks when present
	const fenceRegex = /```(?:json)?\s*([\s\S]*?)```/gi;
	let match: RegExpExecArray | null;
	const candidates: string[] = [];

	while ((match = fenceRegex.exec(trimmed)) !== null) {
		const inner = match[1].trim();
		if (inner) candidates.push(inner);
	}
	candidates.push(trimmed);

	for (const candidate of candidates) {
		try {
			return { ok: true, value: JSON.parse(candidate) };
		} catch {
			const extracted = extractOutermostJsonObject(candidate);
			if (extracted) {
				try {
					return { ok: true, value: JSON.parse(extracted) };
				} catch {
					// Keep trying next candidate
				}
			}
		}
	}

	return {
		ok: false,
		error: 'Could not find a valid JSON object. Check for missing commas, quotes, or brackets.'
	};
}

export function resolveMachineQuestionType(rawType: unknown): MachineQuestionTypeId | null {
	if (typeof rawType !== 'string') return null;
	const trimmed = rawType.trim();
	if (!trimmed) return null;

	// Direct or normalized semantic slug match (case-insensitive, hyphen/space tolerant)
	const slugKey = trimmed.toLowerCase().replace(/[\s-]+/g, '_');
	if (slugKey in MACHINE_AI_TOPIC_SLUG_MAP) {
		return MACHINE_AI_TOPIC_SLUG_MAP[slugKey as MachineAiTopicSlug];
	}

	// Internal ID fallback (case-insensitive, underscore/space tolerant)
	const idKey = trimmed.toUpperCase().replace(/[\s_]+/g, '-');
	if (idKey in MACHINE_QUESTION_TYPE_TO_SLUG) {
		return idKey as MachineQuestionTypeId;
	}

	return null;
}

function coerceNumber(value: unknown, allowInfinity = false): number | undefined | 'invalid' {
	if (value === undefined || value === null) return undefined;
	if (typeof value === 'number') {
		if (Number.isFinite(value)) return value;
		if (allowInfinity && value === Infinity) return Infinity;
		return 'invalid';
	}
	if (typeof value === 'string') {
		const trimmed = value.trim();
		if (trimmed === '') return undefined;
		if (allowInfinity && /^(?:\+?inf(?:inity)?|∞)$/i.test(trimmed)) {
			return Infinity;
		}
		const n = Number(trimmed);
		if (Number.isFinite(n)) return n;
		return 'invalid';
	}
	return 'invalid';
}

function coerceBoolean(value: unknown): boolean | undefined | 'invalid' {
	if (value === undefined || value === null) return undefined;
	if (typeof value === 'boolean') return value;
	if (typeof value === 'string') {
		const lower = value.trim().toLowerCase();
		if (lower === 'true' || lower === '1' || lower === 'yes') return true;
		if (lower === 'false' || lower === '0' || lower === 'no') return false;
	}
	return 'invalid';
}

function coerceEnum(value: unknown, allowed: readonly string[]): string | undefined | 'invalid' {
	if (value === undefined || value === null) return undefined;
	if (typeof value !== 'string') return 'invalid';
	const trimmed = value.trim();
	if (!trimmed) return undefined;
	const exact = allowed.find((a) => a === trimmed);
	if (exact) return exact;
	const caseInsensitive = allowed.find((a) => a.toLowerCase() === trimmed.toLowerCase());
	if (caseInsensitive) return caseInsensitive;
	return 'invalid';
}

function coerceBhTable(raw: unknown): { ok: true; table: BHPoint[] } | { ok: false; error: string } {
	if (!Array.isArray(raw)) {
		return { ok: false, error: '"bhTable" must be an array of { "H": number, "B": number } points.' };
	}
	const points: BHPoint[] = [];
	for (let i = 0; i < raw.length; i++) {
		const item = raw[i];
		let rawH: unknown;
		let rawB: unknown;
		if (Array.isArray(item) && item.length >= 2) {
			rawH = item[0];
			rawB = item[1];
		} else if (item && typeof item === 'object') {
			const rec = item as Record<string, unknown>;
			rawH = rec.H ?? rec.h;
			rawB = rec.B ?? rec.b;
		} else {
			return { ok: false, error: `Invalid B–H table entry at index ${i}.` };
		}
		const H = coerceNumber(rawH);
		const B = coerceNumber(rawB);
		if (H === undefined || H === 'invalid' || B === undefined || B === 'invalid') {
			return { ok: false, error: `B–H table entry ${i + 1} must have numeric H and B values.` };
		}
		points.push({ H, B });
	}
	return { ok: true, table: points };
}

function coerceEfficiencyPoint(
	raw: unknown,
	fieldName: string
): { ok: true; point: TransformerEfficiencyPoint } | { ok: false; error: string } {
	if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
		return {
			ok: false,
			error: `"${fieldName}" must be an object with loadFraction, pf, and efficiencyPercent.`
		};
	}
	const rec = raw as Record<string, unknown>;
	const loadFraction = coerceNumber(rec.loadFraction);
	const pf = coerceNumber(rec.pf);
	const efficiencyPercent = coerceNumber(rec.efficiencyPercent);
	if (
		loadFraction === undefined ||
		loadFraction === 'invalid' ||
		pf === undefined ||
		pf === 'invalid' ||
		efficiencyPercent === undefined ||
		efficiencyPercent === 'invalid'
	) {
		return {
			ok: false,
			error: `"${fieldName}" requires numeric loadFraction, pf, and efficiencyPercent.`
		};
	}
	return {
		ok: true,
		point: { loadFraction, pf, efficiencyPercent }
	};
}

function dispatchSolve<K extends MachineQuestionTypeId>(
	typeId: K,
	input: MachineInputMap[K]
): MachineSolveResult {
	switch (typeId) {
		case 'QT-3PH-1':
			return solveThreePhase(input as MachineInputMap['QT-3PH-1']);
		case 'QT-MAG-1':
			return solveLinearMagneticCircuit(input as MachineInputMap['QT-MAG-1']);
		case 'QT-MAG-2':
			return solveNonlinearOrParallelMagnetic(input as MachineInputMap['QT-MAG-2']);
		case 'QT-MAG-3':
			return solveVariableReluctanceActuator(input as MachineInputMap['QT-MAG-3']);
		case 'QT-XFMR-1':
			return solveTransformerEmfAndCoreLoss(input as MachineInputMap['QT-XFMR-1']);
		case 'QT-XFMR-2':
			return solveTransformerOcScTests(input as MachineInputMap['QT-XFMR-2']);
		case 'QT-XFMR-3':
			return solveTransformerOnLoad(input as MachineInputMap['QT-XFMR-3']);
		case 'QT-XFMR-4':
			return solveTransformerEfficiencyLoad(input as MachineInputMap['QT-XFMR-4']);
		case 'QT-DC-1':
			return solveDcEmfAndTorque(input as MachineInputMap['QT-DC-1']);
		case 'QT-DC-2':
			return solveDcGenerator(input as MachineInputMap['QT-DC-2']);
		case 'QT-DC-3':
			return solveDcMotor(input as MachineInputMap['QT-DC-3']);
		case 'QT-IM-1':
			return solveInductionMotorBasic(input as MachineInputMap['QT-IM-1']);
		case 'QT-IM-2':
			return solveInductionMotorPowerFlow(input as MachineInputMap['QT-IM-2']);
		case 'QT-IM-3':
			return solveInductionMotorEquivCircuit(input as MachineInputMap['QT-IM-3']);
	}
}

// ============================================================================
// Main Parser Entry Point
// ============================================================================

export function parseMachineAiImport(rawText: string): MachineAiImportResult {
	const jsonResult = parseJsonFromRawText(rawText);
	if (!jsonResult.ok) {
		return { ok: false, error: jsonResult.error };
	}

	const root = jsonResult.value;
	if (!root || typeof root !== 'object' || Array.isArray(root)) {
		return { ok: false, error: 'Root JSON value must be an object with "type" and "input".' };
	}

	const record = root as Record<string, unknown>;
	const rawType = record.type ?? record.questionType ?? record.topic;
	const questionTypeId = resolveMachineQuestionType(rawType);
	if (!questionTypeId) {
		return {
			ok: false,
			error:
				typeof rawType === 'string' && rawType.trim()
					? `Unknown machine topic "${rawType.trim()}". Use one of: ${ALL_MACHINE_AI_TOPIC_SLUGS.join(', ')}.`
					: 'Missing "type" field. Specify one of the 14 machine topic slugs (e.g. "transformer_oc_sc").'
		};
	}

	const rawInput = record.input;
	if (!rawInput || typeof rawInput !== 'object' || Array.isArray(rawInput)) {
		return {
			ok: false,
			error: 'Missing "input" object containing the numerical parameters for this topic.'
		};
	}

	const schema = TYPE_SCHEMAS[questionTypeId];
	const inputRecord = rawInput as Record<string, unknown>;
	const normalized: Record<string, unknown> = {};
	const warnings: string[] = [];

	const numericSet = new Set(schema.numericFields);
	const booleanSet = new Set(schema.booleanFields ?? []);
	const enumMap = schema.enumFields ?? {};

	for (const [key, value] of Object.entries(inputRecord)) {
		if (value === undefined || value === null || value === '') continue;

		if (numericSet.has(key)) {
			const allowInf = Boolean(schema.allowsIdealCore && key === 'muR');
			const coerced = coerceNumber(value, allowInf);
			if (coerced === 'invalid') {
				return {
					ok: false,
					error: `Field "${key}" must be a valid number (got ${JSON.stringify(value)}).`
				};
			}
			if (coerced !== undefined) {
				normalized[key] = coerced;
				if (allowInf && coerced === Infinity) {
					normalized.idealCore = true;
				}
			}
			continue;
		}

		if (booleanSet.has(key)) {
			const coerced = coerceBoolean(value);
			if (coerced === 'invalid') {
				return {
					ok: false,
					error: `Field "${key}" must be a boolean (true or false).`
				};
			}
			if (coerced !== undefined) {
				normalized[key] = coerced;
			}
			continue;
		}

		if (key in enumMap) {
			const allowed = enumMap[key];
			const coerced = coerceEnum(value, allowed);
			if (coerced === 'invalid') {
				return {
					ok: false,
					error: `Field "${key}" must be one of: ${allowed.join(', ')}.`
				};
			}
			if (coerced !== undefined) {
				normalized[key] = coerced;
			}
			continue;
		}

		if (schema.hasBhTable && key === 'bhTable') {
			const bhRes = coerceBhTable(value);
			if (!bhRes.ok) {
				return { ok: false, error: bhRes.error };
			}
			normalized.bhTable = bhRes.table;
			continue;
		}

		if (schema.hasEfficiencyPoints && (key === 'point1' || key === 'point2')) {
			const ptRes = coerceEfficiencyPoint(value, key);
			if (!ptRes.ok) {
				return { ok: false, error: ptRes.error };
			}
			normalized[key] = ptRes.point;
			continue;
		}

		warnings.push(`Ignored unrecognized field "${key}".`);
	}

	// Normalize idealCore + muR coupling so JSON-safe { idealCore: true } works smoothly
	if (schema.allowsIdealCore && normalized.idealCore === true) {
		normalized.muR = Infinity;
	}

	const typedInput = normalized as unknown as MachineInputMap[typeof questionTypeId];
	const previewResult = dispatchSolve(questionTypeId, typedInput);

	if (!previewResult.valid) {
		return {
			ok: false,
			error: previewResult.error ?? 'Invalid parameters for this machine topic.'
		};
	}

	if (previewResult.warnings?.length) {
		warnings.push(...previewResult.warnings);
	}

	const title =
		typeof record.title === 'string' && record.title.trim() ? record.title.trim() : undefined;

	return {
		ok: true,
		questionTypeId,
		topicSlug: MACHINE_QUESTION_TYPE_TO_SLUG[questionTypeId],
		title,
		input: typedInput,
		previewResult,
		warnings
	};
}
