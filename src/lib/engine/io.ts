/**
 * JSON Export / Import, AI Netlist Prompt & Parser for Circuit Lab.
 */

import {
	layoutNetlistWithMeta,
	type LayoutMode,
	type LayoutNetlistElement
} from './auto-layout';
import {
	buildElectricalGraph,
	isImpedanceSpecified,
	parseDependentGain,
	parseDirectImpedance,
	parsePassiveValue,
	parseSourceValue
} from './graph';
import {
	isDependentSourceKind,
	type AcMagnitudeMode,
	type AnalysisMode,
	type CircuitComponent,
	type CircuitConstraint,
	type CircuitDocument,
	type CircuitWire,
	type ComponentKind,
	type ConstraintKind,
	type DependentControlRef,
	type PassiveValueMode,
	type Rotation,
	type UnitSystemId,
	type UnknownProblemSpec,
	type UnknownTerm
} from './types';
import { parseComplexValue, parseEngineeringNumber } from './units';
import { parseAlgebraicUnknownValue } from './unknown-solver';

export const AI_CIRCUIT_IMPORT_PROMPT = `Convert the attached circuit diagram (and any problem statement) into a single valid JSON object for Circuit Lab.
Output ONLY raw JSON (no markdown commentary, no explanation outside the JSON).

Schema:
{
  "schemaVersion": 1,
  "name": "Short descriptive circuit name",
  "mode": "dc" | "ac",
  "frequencyHz": 60,
  "acMagnitudeMode": "rms",
  "unitSystem": "auto" | "ohm-v-a" | "kohm-v-ma" | "mohm-v-ua",
  "elements": [
    {
      "id": "R1",
      "kind": "resistor" | "capacitor" | "inductor" | "voltage_source" | "current_source" | "vcvs" | "vccs" | "ccvs" | "cccs",
      "label": "R1",
      "from": "N1",
      "to": "N2",
      "fromPos": [0, 0],
      "toPos": [1, 0],
      "value": "10k",
      "unit": "Ω",
      "valueMode": "physical" | "impedance",
      "phaseDeg": 0,
      "controlRef": {
        "controlComponentId": "R1",
        "controlNodePos": "N1",
        "controlNodeNeg": "N2",
        "controlBranchComponentId": "R1",
        "controlPolarity": 1,
        "controlVarName": "v_x",
        "gain": "2"
      },
      "unknown": false,
      "unknownSymbol": "V",
      "unknownMultiplier": 1
    }
  ],
  "unknownProblem": {
    "componentId": "V1",
    "symbol": "V",
    "terms": [
      { "componentId": "V1", "multiplier": 1 },
      { "componentId": "V2", "multiplier": 2 }
    ],
    "constraint": {
      "kind": "branch_current" | "branch_voltage" | "node_voltage" | "branch_power",
      "targetId": "R2",
      "value": "2m",
      "label": "I_o"
    }
  }
}

Rules:
1. Allowed "kind" values ONLY: "resistor", "capacitor", "inductor", "voltage_source", "current_source", "vcvs", "vccs", "ccvs", "cccs".
   - For dependent sources ("vcvs", "vccs", "ccvs", "cccs"), put the scalar/complex gain in "value" (e.g. "2", "4k", "2m") AND include "controlRef":
     - VCVS/VCCS: set "controlComponentId" to the controlling element's id/label (e.g. "R1") OR set "controlNodePos" and "controlNodeNeg".
     - CCVS/CCCS: set "controlBranchComponentId" to the controlling branch's id/label (e.g. "R1").
     - Optional "controlPolarity": 1 (default) or -1 (flipped sign), and optional "controlVarName" (e.g. "v_x", "i_x").
2. Node naming:
   - Use "0" for the ground / reference node (or bottom return rail if no ground symbol is drawn).
   - Name all other distinct electrical nodes "N1", "N2", "N3", ...
3. Exact Visual Layout Cloning ("fromPos" and "toPos" — REQUIRED on every element):
   - Overlay an integer schematic grid over the image: col = 0, 1, 2, ... from LEFT to RIGHT; row = 0, 1, 2, ... from TOP to BOTTOM.
   - Set "fromPos": [col, row] to the grid vertex of the "from" terminal and "toPos": [col, row] to the grid vertex of the "to" terminal as drawn in the image.
   - Horizontal element: same row (e.g. left-to-right [0,0]->[1,0], or right-to-left [1,0]->[0,0]).
   - Vertical element: same col (e.g. top-to-bottom [0,0]->[0,1], or bottom-to-top [2,1]->[2,0] for an upward source).
   - Every element sharing the same drawn corner/junction must share the exact same [col, row] and node name. Never rotate or rearrange the schematic.
4. Polarity ("from" -> "to"):
   - For "voltage_source": "from" (and "fromPos") is the positive (+) terminal; "to" (and "toPos") is the negative (-) terminal.
   - For "current_source": "from" (and "fromPos") is the arrow tail (current leaves "from"); "to" (and "toPos") is the arrow head (current enters "to").
   - For passives ("resistor", "capacitor", "inductor"): "from" -> "to" defines the branch reference direction (voltage V = V_from - V_to, current flows from -> to). Match any drawn arrow or +/- label on a resistor!
5. Unit System ("unitSystem"):
   - Choose according to the problem's units:
     - "ohm-v-a" when resistors are in Ω and currents in A
     - "kohm-v-ma" when resistors are in kΩ and currents in mA
     - "mohm-v-ua" when resistors are in MΩ and currents in µA
     - "auto" for mixed scales
6. Values:
   - Use plain numbers or SI suffixes (f, p, n, u, m, k, M, G, T): e.g. "10k", "4.7u", "100m", "12".
   - All known physical passive values (R, C, L) must be strictly positive.
   - For AC circuits, set "mode": "ac", include positive "frequencyHz" (e.g. 60 or 1000 — use 60 if no frequency is stated), and write phasor sources as "120∠30°" (or numeric magnitude in "value" with "phaseDeg": 30).
   - For AC circuits where inductors or capacitors are given directly as impedances in Ohms (e.g. j1 Ω, -j1 Ω, j50 Ω, -j20 Ω, 2+j1 Ω), set "valueMode": "impedance", "unit": "Ω", and "value": "j1" / "-j1" / "j50" / "-j20" / "2+j1" (and set "mode": "ac", "frequencyHz": 60 if no frequency is stated).
7. Unknown-Value Problems (omit "unknownProblem" if all values are known):
   - Single unknown (e.g. "Find V_s given I_o = 2 mA" or "Find R_x given V_o = 6 V"):
     - On that element, set "unknown": true and "value": "?" (or placeholder "1").
     - Include top-level "unknownProblem" with "componentId", optional "symbol" (e.g. "V_s", "R_x"), and "constraint": { "kind": "branch_current" | "branch_voltage" | "node_voltage" | "branch_power", "targetId": "<elementId or nodeId>", "value": "<SI value>", "label": "<e.g. I_o or V_o>" }.
   - Multiple / scaled identical unknowns (e.g. two sources labeled V and 2V, or resistors R and 2R):
     - Mark EVERY linked element with "unknown": true, "unknownSymbol": "V", and "unknownMultiplier": <scalar> (e.g. V1 with "value": "V", "unknownMultiplier": 1 and V2 with "value": "2V", "unknownMultiplier": 2).
     - Include "terms": [{ "componentId": "V1", "multiplier": 1 }, { "componentId": "V2", "multiplier": 2 }] inside "unknownProblem".

Example 1 (DC) — Unknown Source with kΩ/V/mA & Exact Visual Grid:
{
  "schemaVersion": 1,
  "name": "Find Vs Given Io = 2 mA",
  "mode": "dc",
  "unitSystem": "kohm-v-ma",
  "elements": [
    { "id": "V1", "kind": "voltage_source", "label": "Vs", "from": "N1", "to": "0", "fromPos": [0, 0], "toPos": [0, 1], "value": "?", "unknown": true, "unknownSymbol": "Vs" },
    { "id": "R1", "kind": "resistor", "label": "R1", "from": "N1", "to": "N2", "fromPos": [0, 0], "toPos": [1, 0], "value": "2k" },
    { "id": "R2", "kind": "resistor", "label": "R2", "from": "N2", "to": "0", "fromPos": [1, 0], "toPos": [1, 1], "value": "4k" },
    { "id": "R3", "kind": "resistor", "label": "R3", "from": "N2", "to": "N3", "fromPos": [1, 0], "toPos": [2, 0], "value": "2k" },
    { "id": "I1", "kind": "current_source", "label": "I1", "from": "0", "to": "N3", "fromPos": [2, 1], "toPos": [2, 0], "value": "1m" }
  ],
  "unknownProblem": {
    "componentId": "V1",
    "symbol": "Vs",
    "constraint": {
      "kind": "branch_current",
      "targetId": "R2",
      "value": "2m",
      "label": "I_o"
    }
  }
}

Example 2 (AC) — RLC Phasor Circuit with Ω/V/A & Exact Visual Grid:
{
  "schemaVersion": 1,
  "name": "AC RLC Phasor Circuit",
  "mode": "ac",
  "frequencyHz": 1000,
  "acMagnitudeMode": "rms",
  "unitSystem": "ohm-v-a",
  "elements": [
    { "id": "V1", "kind": "voltage_source", "label": "V1", "from": "N1", "to": "0", "fromPos": [0, 0], "toPos": [0, 1], "value": "120∠30°" },
    { "id": "R1", "kind": "resistor", "label": "R1", "from": "N1", "to": "N2", "fromPos": [0, 0], "toPos": [1, 0], "value": "100" },
    { "id": "L1", "kind": "inductor", "label": "L1", "from": "N2", "to": "N3", "fromPos": [1, 0], "toPos": [2, 0], "value": "20m" },
    { "id": "C1", "kind": "capacitor", "label": "C1", "from": "N3", "to": "0", "fromPos": [2, 0], "toPos": [2, 1], "value": "2.2u" }
  ]
}`;

export type CircuitImportResult =
	| {
			ok: true;
			document: CircuitDocument;
			sourceFormat: 'circuit-document' | 'ai-netlist';
			layoutMode?: LayoutMode;
			warnings: string[];
	  }
	| {
			ok: false;
			errors: string[];
	  };

const ALLOWED_KINDS = new Set<ComponentKind>([
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

const ALLOWED_UNIT_SYSTEMS = new Set<UnitSystemId>([
	'auto',
	'ohm-v-a',
	'kohm-v-ma',
	'mohm-v-ua'
]);

const VALID_CONSTRAINT_KINDS = new Set<ConstraintKind>([
	'node_voltage',
	'branch_voltage',
	'branch_current',
	'branch_power'
]);

const PASSIVE_KINDS = new Set<ComponentKind>(['resistor', 'capacitor', 'inductor']);
const SOURCE_KINDS = new Set<ComponentKind>(['voltage_source', 'current_source']);
const VALID_ROTATIONS = new Set<number>([0, 90, 180, 270]);

function parseControlRefObject(raw: unknown): DependentControlRef | undefined {
	if (!isPlainObject(raw)) return undefined;
	const out: DependentControlRef = {};
	if (typeof raw.controlComponentId === 'string' && raw.controlComponentId.trim() !== '') {
		out.controlComponentId = raw.controlComponentId.trim();
	}
	if (typeof raw.controlNodePos === 'string' && raw.controlNodePos.trim() !== '') {
		out.controlNodePos = raw.controlNodePos.trim();
	}
	if (typeof raw.controlNodeNeg === 'string' && raw.controlNodeNeg.trim() !== '') {
		out.controlNodeNeg = raw.controlNodeNeg.trim();
	}
	if (
		typeof raw.controlBranchComponentId === 'string' &&
		raw.controlBranchComponentId.trim() !== ''
	) {
		out.controlBranchComponentId = raw.controlBranchComponentId.trim();
	}
	if (raw.controlPolarity === 1 || raw.controlPolarity === -1) {
		out.controlPolarity = raw.controlPolarity;
	}
	if (typeof raw.controlVarName === 'string' && raw.controlVarName.trim() !== '') {
		out.controlVarName = raw.controlVarName.trim();
	}
	if (typeof raw.gain === 'number' && Number.isFinite(raw.gain)) {
		out.gain = raw.gain;
	} else if (typeof raw.gain === 'string' && raw.gain.trim() !== '') {
		out.gain = raw.gain.trim();
	}
	return Object.keys(out).length > 0 ? out : undefined;
}

function isPlainObject(val: unknown): val is Record<string, unknown> {
	return typeof val === 'object' && val !== null && !Array.isArray(val);
}

function parseGridPos(raw: unknown): [number, number] | null {
	if (
		Array.isArray(raw) &&
		raw.length === 2 &&
		typeof raw[0] === 'number' &&
		typeof raw[1] === 'number' &&
		Number.isFinite(raw[0]) &&
		Number.isFinite(raw[1])
	) {
		return [Math.round(raw[0]), Math.round(raw[1])];
	}
	return null;
}

function parseConstraintObject(
	raw: unknown,
	warnings: string[],
	contextLabel: string
): CircuitConstraint | null {
	if (!isPlainObject(raw)) {
		warnings.push(`${contextLabel}: expected an object.`);
		return null;
	}
	const kind = typeof raw.kind === 'string' ? raw.kind.trim() : '';
	if (!VALID_CONSTRAINT_KINDS.has(kind as ConstraintKind)) {
		warnings.push(
			`${contextLabel}: unsupported constraint kind "${kind}" (expected node_voltage, branch_voltage, branch_current, or branch_power).`
		);
		return null;
	}
	const targetId = typeof raw.targetId === 'string' ? raw.targetId.trim() : '';
	if (!targetId) {
		warnings.push(`${contextLabel}: missing "targetId".`);
		return null;
	}
	let valueStr = '';
	if (typeof raw.value === 'number' && Number.isFinite(raw.value)) {
		valueStr = String(raw.value);
	} else if (typeof raw.value === 'string' && raw.value.trim() !== '') {
		valueStr = raw.value.trim();
	}
	if (!valueStr || !parseComplexValue(valueStr)) {
		warnings.push(`${contextLabel}: invalid constraint value "${String(raw.value ?? '')}".`);
		return null;
	}
	const label = typeof raw.label === 'string' && raw.label.trim() ? raw.label.trim() : undefined;
	return {
		kind: kind as ConstraintKind,
		targetId,
		value: valueStr,
		label
	};
}

/**
 * Normalizes a `CircuitDocument` into deterministic property order and formats it as pretty JSON.
 */
export function exportCircuitJson(doc: CircuitDocument): string {
	const normalizedComponents = doc.components.map((c) => {
		const out: Record<string, unknown> = {
			id: c.id,
			kind: c.kind,
			label: c.label,
			x: c.x,
			y: c.y,
			rotation: c.rotation,
			value: c.value
		};
		if (c.numericValue !== undefined) out.numericValue = c.numericValue;
		if (c.phaseDeg !== undefined) out.phaseDeg = c.phaseDeg;
		if (c.frequencyHz !== undefined) out.frequencyHz = c.frequencyHz;
		if (c.unit !== undefined) out.unit = c.unit;
		if (c.valueMode !== undefined) out.valueMode = c.valueMode;
		if (c.terminalName !== undefined) out.terminalName = c.terminalName;
		if (c.controlRef !== undefined) out.controlRef = c.controlRef;
		return out;
	});

	const normalizedWires = doc.wires.map((w) => ({
		id: w.id,
		points: w.points.map((p) => ({ x: p.x, y: p.y }))
	}));

	const out: Record<string, unknown> = {
		schemaVersion: 1
	};
	if (doc.id !== undefined) out.id = doc.id;
	if (doc.name !== undefined) out.name = doc.name;
	out.mode = doc.mode;
	out.frequencyHz = doc.frequencyHz;
	if (doc.acMagnitudeMode !== undefined) out.acMagnitudeMode = doc.acMagnitudeMode;
	if (doc.unitSystem !== undefined) out.unitSystem = doc.unitSystem;
	out.components = normalizedComponents;
	out.wires = normalizedWires;
	if (doc.unknownProblem !== undefined) {
		const validTerms = Array.isArray(doc.unknownProblem.terms)
			? doc.unknownProblem.terms
					.filter(
						(t) =>
							typeof t.componentId === 'string' &&
							t.componentId.trim() !== '' &&
							typeof t.multiplier === 'number' &&
							Number.isFinite(t.multiplier) &&
							Math.abs(t.multiplier) > 1e-15
					)
					.map((t) => ({
						componentId: t.componentId.trim(),
						multiplier: t.multiplier
					}))
			: [];
		out.unknownProblem = {
			componentId: doc.unknownProblem.componentId,
			...(doc.unknownProblem.symbol ? { symbol: doc.unknownProblem.symbol } : {}),
			...(validTerms.length > 0 ? { terms: validTerms } : {}),
			constraint: {
				kind: doc.unknownProblem.constraint.kind,
				targetId: doc.unknownProblem.constraint.targetId,
				value: doc.unknownProblem.constraint.value,
				...(doc.unknownProblem.constraint.label
					? { label: doc.unknownProblem.constraint.label }
					: {})
			}
		};
	}

	return JSON.stringify(out, null, 2);
}

function parseUnknownTermsArray(
	raw: unknown,
	warnings: string[],
	contextLabel: string
): UnknownTerm[] {
	if (!Array.isArray(raw)) return [];
	const seen = new Set<string>();
	const terms: UnknownTerm[] = [];
	raw.forEach((entry, idx) => {
		if (!isPlainObject(entry)) {
			warnings.push(`${contextLabel}[${idx}]: expected an object { componentId, multiplier }.`);
			return;
		}
		const componentId =
			typeof entry.componentId === 'string' ? entry.componentId.trim() : '';
		const multiplier =
			typeof entry.multiplier === 'number' ? entry.multiplier : Number(entry.multiplier);
		if (!componentId) {
			warnings.push(`${contextLabel}[${idx}]: missing "componentId".`);
			return;
		}
		if (!Number.isFinite(multiplier) || Math.abs(multiplier) <= 1e-15) {
			warnings.push(
				`${contextLabel}[${idx}] (${componentId}): "multiplier" must be a finite non-zero number.`
			);
			return;
		}
		if (seen.has(componentId)) return;
		seen.add(componentId);
		terms.push({ componentId, multiplier });
	});
	return terms;
}

/**
 * Extracts the first balanced JSON object `{ ... }` from raw text,
 * handling markdown code fences and surrounding AI prose.
 */
function extractJsonCandidates(rawText: string): string[] {
	const trimmed = rawText.trim();
	const candidates: string[] = [];

	// 1. Markdown fenced blocks (prefer ```json first, then any ``` block)
	const fenceRegex = /```(?:json)?\s*([\s\S]*?)```/gi;
	let match: RegExpExecArray | null;
	while ((match = fenceRegex.exec(trimmed)) !== null) {
		const inner = match[1].trim();
		if (inner) candidates.push(inner);
	}

	// 2. Direct trimmed text if it starts with '{'
	if (trimmed.startsWith('{')) {
		candidates.push(trimmed);
	}

	// 3. Scan for a balanced `{ ... }` object inside surrounding prose
	const scanBalanced = (src: string): string | null => {
		const start = src.indexOf('{');
		if (start === -1) return null;
		let depth = 0;
		let inString = false;
		let escape = false;
		for (let i = start; i < src.length; i++) {
			const ch = src[i];
			if (inString) {
				if (escape) {
					escape = false;
				} else if (ch === '\\') {
					escape = true;
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
					return src.slice(start, i + 1);
				}
			}
		}
		return null;
	};

	const balanced = scanBalanced(trimmed);
	if (balanced && !candidates.includes(balanced)) {
		candidates.push(balanced);
	}

	return candidates;
}

function validateHeader(
	obj: Record<string, unknown>,
	isNetlist: boolean,
	errors: string[],
	warnings: string[]
): {
	mode: AnalysisMode;
	frequencyHz: number;
	acMagnitudeMode?: AcMagnitudeMode;
	unitSystem?: UnitSystemId;
} {
	if (obj.schemaVersion !== undefined && obj.schemaVersion !== 1) {
		errors.push(`Unsupported schemaVersion "${String(obj.schemaVersion)}" (expected 1).`);
	}

	let mode: AnalysisMode = 'dc';
	if (obj.mode !== 'dc' && obj.mode !== 'ac') {
		errors.push(
			`Invalid or missing "mode" (${JSON.stringify(obj.mode)}); expected "dc" or "ac".`
		);
	} else {
		mode = obj.mode;
	}

	let frequencyHz = 60;
	if (obj.frequencyHz === undefined) {
		if (mode === 'ac') {
			errors.push('Missing "frequencyHz" for AC circuit (must be a positive finite number).');
		} else if (!isNetlist) {
			warnings.push('Missing "frequencyHz"; defaulted to 60 Hz.');
		}
	} else if (
		typeof obj.frequencyHz !== 'number' ||
		!Number.isFinite(obj.frequencyHz) ||
		obj.frequencyHz <= 0
	) {
		errors.push(
			`Invalid "frequencyHz" (${JSON.stringify(obj.frequencyHz)}); expected a positive finite number.`
		);
	} else {
		frequencyHz = obj.frequencyHz;
	}

	let acMagnitudeMode: AcMagnitudeMode | undefined;
	if (obj.acMagnitudeMode !== undefined) {
		if (obj.acMagnitudeMode !== 'rms' && obj.acMagnitudeMode !== 'peak') {
			errors.push(
				`Invalid "acMagnitudeMode" (${JSON.stringify(obj.acMagnitudeMode)}); expected "rms" or "peak".`
			);
		} else {
			acMagnitudeMode = obj.acMagnitudeMode;
		}
	}

	let unitSystem: UnitSystemId | undefined;
	if (obj.unitSystem !== undefined) {
		if (typeof obj.unitSystem === 'string') {
			const normalized = obj.unitSystem.trim().toLowerCase() as UnitSystemId;
			if (ALLOWED_UNIT_SYSTEMS.has(normalized)) {
				unitSystem = normalized;
			} else {
				warnings.push(
					`Unrecognized "unitSystem" (${JSON.stringify(obj.unitSystem)}); ignored.`
				);
			}
		} else {
			warnings.push(`Invalid "unitSystem" (${JSON.stringify(obj.unitSystem)}); ignored.`);
		}
	}

	return { mode, frequencyHz, acMagnitudeMode, unitSystem };
}

function parseCircuitDocumentFormat(obj: Record<string, unknown>): CircuitImportResult {
	const errors: string[] = [];
	const warnings: string[] = [];

	const { mode, frequencyHz, acMagnitudeMode, unitSystem } = validateHeader(
		obj,
		false,
		errors,
		warnings
	);

	if (!Array.isArray(obj.components)) {
		errors.push('Missing or invalid "components" array.');
	}
	if (!Array.isArray(obj.wires)) {
		errors.push('Missing or invalid "wires" array.');
	}
	if (errors.length > 0) {
		return { ok: false, errors };
	}

	const rawComponents = obj.components as unknown[];
	const rawWires = obj.wires as unknown[];
	const components: CircuitComponent[] = [];
	const seenCompIds = new Set<string>();

	rawComponents.forEach((raw, idx) => {
		const prefix = `Component[${idx}]`;
		if (!isPlainObject(raw)) {
			errors.push(`${prefix}: expected an object.`);
			return;
		}

		if (typeof raw.id !== 'string' || raw.id.trim() === '') {
			errors.push(`${prefix}: "id" must be a non-empty string.`);
		} else if (seenCompIds.has(raw.id)) {
			errors.push(`${prefix}: duplicate component id "${raw.id}".`);
		} else {
			seenCompIds.add(raw.id);
		}

		if (typeof raw.kind !== 'string' || !ALLOWED_KINDS.has(raw.kind as ComponentKind)) {
			errors.push(
				`${prefix} (${String(raw.id ?? '?')}): invalid kind "${String(raw.kind)}".`
			);
			return;
		}
		const kind = raw.kind as ComponentKind;

		if (typeof raw.label !== 'string' || raw.label.trim() === '') {
			errors.push(`${prefix} (${String(raw.id ?? '?')}): "label" must be a non-empty string.`);
		}

		if (typeof raw.x !== 'number' || !Number.isFinite(raw.x)) {
			errors.push(`${prefix} (${String(raw.id ?? '?')}): "x" must be a finite number.`);
		}
		if (typeof raw.y !== 'number' || !Number.isFinite(raw.y)) {
			errors.push(`${prefix} (${String(raw.id ?? '?')}): "y" must be a finite number.`);
		}
		if (typeof raw.rotation !== 'number' || !VALID_ROTATIONS.has(raw.rotation)) {
			errors.push(
				`${prefix} (${String(raw.id ?? '?')}): "rotation" must be 0, 90, 180, or 270.`
			);
		}

		let valueStr = '';
		if (kind === 'ground' || kind === 'terminal' || kind === 'voltmeter') {
			valueStr = typeof raw.value === 'string' ? raw.value : '0';
		} else {
			if (typeof raw.value !== 'string' || raw.value.trim() === '') {
				errors.push(
					`${prefix} (${String(raw.id ?? '?')}): "value" must be a non-empty string.`
				);
			} else {
				valueStr = raw.value.trim();
			}
		}

		if (
			raw.phaseDeg !== undefined &&
			(typeof raw.phaseDeg !== 'number' || !Number.isFinite(raw.phaseDeg))
		) {
			errors.push(
				`${prefix} (${String(raw.id ?? '?')}): "phaseDeg" must be a finite number.`
			);
		}

		const candidate: CircuitComponent = {
			id: typeof raw.id === 'string' ? raw.id.trim() : `C${idx}`,
			kind,
			label: typeof raw.label === 'string' ? raw.label.trim() : `C${idx}`,
			x: typeof raw.x === 'number' ? raw.x : 0,
			y: typeof raw.y === 'number' ? raw.y : 0,
			rotation: (VALID_ROTATIONS.has(Number(raw.rotation)) ? raw.rotation : 0) as Rotation,
			value: valueStr
		};
		if (typeof raw.numericValue === 'number' && Number.isFinite(raw.numericValue)) {
			candidate.numericValue = raw.numericValue;
		}
		if (typeof raw.phaseDeg === 'number' && Number.isFinite(raw.phaseDeg)) {
			candidate.phaseDeg = raw.phaseDeg;
		}
		// Per-source frequency (multi-frequency AC superposition); 0 Hz = DC term
		if (
			(candidate.kind === 'voltage_source' || candidate.kind === 'current_source') &&
			typeof raw.frequencyHz === 'number' &&
			Number.isFinite(raw.frequencyHz) &&
			raw.frequencyHz >= 0
		) {
			candidate.frequencyHz = raw.frequencyHz;
		}
		if (typeof raw.unit === 'string') candidate.unit = raw.unit;
		if (raw.valueMode !== undefined) {
			if (raw.valueMode === 'physical' || raw.valueMode === 'impedance') {
				candidate.valueMode = raw.valueMode;
			} else {
				errors.push(
					`${prefix} (${candidate.label}): invalid "valueMode" (${JSON.stringify(raw.valueMode)}); expected "physical" or "impedance".`
				);
			}
		}
		if (typeof raw.terminalName === 'string') candidate.terminalName = raw.terminalName;
		const parsedControlRef = parseControlRefObject(raw.controlRef);
		if (parsedControlRef) {
			candidate.controlRef = parsedControlRef;
		}

		if (PASSIVE_KINDS.has(kind) && valueStr !== '') {
			if ((kind === 'inductor' || kind === 'capacitor') && isImpedanceSpecified(candidate)) {
				if (parseDirectImpedance(candidate) === null) {
					errors.push(
						`${prefix} (${candidate.label}): impedance value "${valueStr}" must be a non-zero complex impedance with non-negative resistance.`
					);
				}
			} else if (parsePassiveValue(candidate) === null) {
				errors.push(
					`${prefix} (${candidate.label}): passive value "${valueStr}" must be a positive finite number.`
				);
			}
		} else if (SOURCE_KINDS.has(kind) && valueStr !== '') {
			if (parseSourceValue(candidate, mode) === null) {
				errors.push(
					`${prefix} (${candidate.label}): invalid ${mode.toUpperCase()} source value "${valueStr}".`
				);
			}
		} else if (isDependentSourceKind(kind) && valueStr !== '') {
			if (parseDependentGain(candidate, mode) === null) {
				errors.push(
					`${prefix} (${candidate.label}): invalid ${mode.toUpperCase()} dependent gain "${valueStr}".`
				);
			}
		}

		components.push(candidate);
	});

	const wires: CircuitWire[] = [];
	const seenWireIds = new Set<string>();
	rawWires.forEach((raw, idx) => {
		const prefix = `Wire[${idx}]`;
		if (!isPlainObject(raw)) {
			errors.push(`${prefix}: expected an object.`);
			return;
		}
		if (typeof raw.id !== 'string' || raw.id.trim() === '') {
			errors.push(`${prefix}: "id" must be a non-empty string.`);
		} else if (seenWireIds.has(raw.id)) {
			errors.push(`${prefix}: duplicate wire id "${raw.id}".`);
		} else {
			seenWireIds.add(raw.id);
		}
		if (!Array.isArray(raw.points) || raw.points.length < 2) {
			errors.push(
				`${prefix} (${String(raw.id ?? '?')}): "points" must have at least 2 points.`
			);
			return;
		}
		const pts: Array<{ x: number; y: number }> = [];
		raw.points.forEach((pt, pIdx) => {
			if (
				!isPlainObject(pt) ||
				typeof pt.x !== 'number' ||
				!Number.isFinite(pt.x) ||
				typeof pt.y !== 'number' ||
				!Number.isFinite(pt.y)
			) {
				errors.push(`${prefix}.points[${pIdx}]: must be { x, y } with finite numbers.`);
			} else {
				pts.push({ x: pt.x, y: pt.y });
			}
		});
		wires.push({
			id: typeof raw.id === 'string' ? raw.id.trim() : `w${idx}`,
			points: pts
		});
	});

	if (errors.length > 0) {
		return { ok: false, errors };
	}

	const document: CircuitDocument = {
		schemaVersion: 1,
		mode,
		frequencyHz,
		components,
		wires
	};
	if (typeof obj.id === 'string' && obj.id.trim() !== '') document.id = obj.id.trim();
	if (typeof obj.name === 'string' && obj.name.trim() !== '') document.name = obj.name.trim();
	if (acMagnitudeMode) document.acMagnitudeMode = acMagnitudeMode;
	if (unitSystem) document.unitSystem = unitSystem;
	if (isPlainObject(obj.unknownProblem)) {
		const up = obj.unknownProblem;
		const parsedConstraint = parseConstraintObject(
			up.constraint,
			warnings,
			'unknownProblem.constraint'
		);
		if (parsedConstraint && typeof up.componentId === 'string' && up.componentId.trim() !== '') {
			const primaryId = up.componentId.trim();
			let parsedTerms: UnknownTerm[] | undefined;
			if (up.terms !== undefined) {
				const rawTerms = parseUnknownTermsArray(up.terms, warnings, 'unknownProblem.terms');
				const validTerms = rawTerms.filter((t) => {
					if (!seenCompIds.has(t.componentId)) {
						warnings.push(
							`unknownProblem.terms: component "${t.componentId}" not found; ignored.`
						);
						return false;
					}
					return true;
				});
				if (validTerms.length > 0) {
					parsedTerms = validTerms;
				}
			}
			document.unknownProblem = {
				componentId: primaryId,
				symbol:
					typeof up.symbol === 'string' && up.symbol.trim()
						? up.symbol.trim()
						: undefined,
				...(parsedTerms ? { terms: parsedTerms } : {}),
				constraint: parsedConstraint
			};
		}
	}

	return {
		ok: true,
		document,
		sourceFormat: 'circuit-document',
		warnings
	};
}

function parseAiNetlistFormat(obj: Record<string, unknown>): CircuitImportResult {
	const errors: string[] = [];
	const warnings: string[] = [];

	const { mode, frequencyHz, acMagnitudeMode, unitSystem } = validateHeader(
		obj,
		true,
		errors,
		warnings
	);

	if (!Array.isArray(obj.elements) || obj.elements.length === 0) {
		errors.push('Missing or empty "elements" array in AI netlist.');
		return { ok: false, errors };
	}

	// Pre-inspect top-level unknownProblem so referenced/symbolic elements may carry "?", "V", "2V", etc.
	const rawTopUnknown = isPlainObject(obj.unknownProblem) ? obj.unknownProblem : undefined;
	const topLevelUnknownRef =
		rawTopUnknown &&
		typeof rawTopUnknown.componentId === 'string' &&
		rawTopUnknown.componentId.trim() !== ''
			? rawTopUnknown.componentId.trim()
			: undefined;
	const topLevelUnknownSymbol =
		rawTopUnknown &&
		typeof rawTopUnknown.symbol === 'string' &&
		rawTopUnknown.symbol.trim() !== ''
			? rawTopUnknown.symbol.trim()
			: undefined;
	const topLevelTerms =
		rawTopUnknown && rawTopUnknown.terms !== undefined
			? parseUnknownTermsArray(rawTopUnknown.terms, warnings, 'unknownProblem.terms')
			: [];
	const topLevelTermMultMap = new Map<string, number>();
	for (const t of topLevelTerms) {
		topLevelTermMultMap.set(t.componentId, t.multiplier);
	}

	const elements: LayoutNetlistElement[] = [];
	const seenIds = new Set<string>();
	const unknownHints: Array<{
		index: number;
		symbol?: string;
		multiplier: number;
	}> = [];

	(obj.elements as unknown[]).forEach((raw, idx) => {
		const prefix = `Element[${idx}]`;
		if (!isPlainObject(raw)) {
			errors.push(`${prefix}: expected an object.`);
			return;
		}

		let elId: string | undefined;
		if (raw.id !== undefined) {
			if (typeof raw.id !== 'string' || raw.id.trim() === '') {
				errors.push(`${prefix}: "id" must be a non-empty string if provided.`);
			} else {
				elId = raw.id.trim();
				if (seenIds.has(elId)) {
					errors.push(`${prefix}: duplicate element id "${elId}".`);
				}
				seenIds.add(elId);
			}
		}

		if (typeof raw.kind !== 'string' || !ALLOWED_KINDS.has(raw.kind as ComponentKind)) {
			errors.push(
				`${prefix} (${elId ?? '?'}): invalid kind "${String(raw.kind)}". Allowed: resistor, capacitor, inductor, voltage_source, current_source, vcvs, vccs, ccvs, cccs, ground, terminal, voltmeter.`
			);
			return;
		}
		const kind = raw.kind as ComponentKind;
		const labelStr = typeof raw.label === 'string' ? raw.label.trim() : '';
		const displayName = labelStr || elId || `${kind}#${idx + 1}`;

		// Validate nodes (accept either from/to or nodes: [from, to])
		let fromNode = '';
		let toNode = '';
		if (kind === 'ground' || kind === 'terminal') {
			const n =
				(typeof raw.from === 'string' && raw.from.trim()) ||
				(Array.isArray(raw.nodes) &&
					typeof raw.nodes[0] === 'string' &&
					raw.nodes[0].trim()) ||
				(typeof raw.to === 'string' && raw.to.trim()) ||
				'';
			if (!n) {
				errors.push(`${prefix} (${displayName}): missing node name for ${kind}.`);
			}
			fromNode = n;
			toNode = n;
		} else {
			if (raw.from !== undefined || raw.to !== undefined) {
				if (typeof raw.from !== 'string' || raw.from.trim() === '') {
					errors.push(
						`${prefix} (${displayName}): "from" must be a non-empty node string.`
					);
				} else {
					fromNode = raw.from.trim();
				}
				if (typeof raw.to !== 'string' || raw.to.trim() === '') {
					errors.push(
						`${prefix} (${displayName}): "to" must be a non-empty node string.`
					);
				} else {
					toNode = raw.to.trim();
				}
			} else if (Array.isArray(raw.nodes)) {
				if (
					raw.nodes.length !== 2 ||
					typeof raw.nodes[0] !== 'string' ||
					raw.nodes[0].trim() === '' ||
					typeof raw.nodes[1] !== 'string' ||
					raw.nodes[1].trim() === ''
				) {
					errors.push(
						`${prefix} (${displayName}): "nodes" must be an array of 2 non-empty node strings.`
					);
				} else {
					fromNode = raw.nodes[0].trim();
					toNode = raw.nodes[1].trim();
				}
			} else {
				errors.push(
					`${prefix} (${displayName}): must specify "from" & "to" (or "nodes": [from, to]).`
				);
			}
		}

		if (fromNode && toNode && fromNode === toNode && kind !== 'ground' && kind !== 'terminal') {
			warnings.push(
				`Element "${displayName}" has identical "from" and "to" nodes ("${fromNode}").`
			);
		}

		// Parse optional visual grid positions
		let fromPos: [number, number] | undefined;
		let toPos: [number, number] | undefined;
		if (raw.fromPos !== undefined) {
			const parsedPos = parseGridPos(raw.fromPos);
			if (parsedPos) {
				fromPos = parsedPos;
			} else {
				warnings.push(
					`Element "${displayName}" has invalid "fromPos" (expected [col, row]); ignored.`
				);
			}
		}
		if (raw.toPos !== undefined) {
			const parsedPos = parseGridPos(raw.toPos);
			if (parsedPos) {
				toPos = parsedPos;
			} else {
				warnings.push(
					`Element "${displayName}" has invalid "toPos" (expected [col, row]); ignored.`
				);
			}
		}

		// Detect unknown-value markers & algebraic scaled expressions (e.g. "V", "2V", "-0.5V")
		const rawValTrimmed = typeof raw.value === 'string' ? raw.value.trim() : '';
		const isUnknownPlaceholder =
			rawValTrimmed === '?' || rawValTrimmed.toLowerCase() === 'unknown';
		const explicitlyKnown = raw.unknown === false;
		const matchesTopLevelUnknown =
			topLevelUnknownRef !== undefined &&
			(elId === topLevelUnknownRef || labelStr === topLevelUnknownRef);
		const topLevelTermMult =
			(elId !== undefined ? topLevelTermMultMap.get(elId) : undefined) ??
			(labelStr !== '' ? topLevelTermMultMap.get(labelStr) : undefined);
		const explicitMultiplier =
			typeof raw.unknownMultiplier === 'number' &&
			Number.isFinite(raw.unknownMultiplier) &&
			Math.abs(raw.unknownMultiplier) > 1e-15
				? raw.unknownMultiplier
				: undefined;

		let unknownSymbol =
			typeof raw.unknownSymbol === 'string' && raw.unknownSymbol.trim() !== ''
				? raw.unknownSymbol.trim()
				: undefined;

		let algebraicParsed: { multiplier: number; symbol: string } | null = null;
		if (
			kind !== 'ground' &&
			kind !== 'terminal' &&
			kind !== 'voltmeter' &&
			rawValTrimmed !== '' &&
			!isUnknownPlaceholder
		) {
			if (raw.unknown === true || matchesTopLevelUnknown || topLevelTermMult !== undefined) {
				algebraicParsed =
					parseAlgebraicUnknownValue(
						rawValTrimmed,
						unknownSymbol ?? topLevelUnknownSymbol
					) ?? parseAlgebraicUnknownValue(rawValTrimmed);
			} else if (!explicitlyKnown) {
				if (topLevelUnknownSymbol) {
					algebraicParsed = parseAlgebraicUnknownValue(
						rawValTrimmed,
						topLevelUnknownSymbol
					);
				}
				if (
					!algebraicParsed &&
					parseEngineeringNumber(rawValTrimmed) === null &&
					parseComplexValue(rawValTrimmed) === null
				) {
					algebraicParsed = parseAlgebraicUnknownValue(rawValTrimmed);
				}
			}
		}

		const isMarkedUnknown =
			kind !== 'ground' &&
			kind !== 'terminal' &&
			kind !== 'voltmeter' &&
			(raw.unknown === true ||
				isUnknownPlaceholder ||
				matchesTopLevelUnknown ||
				topLevelTermMult !== undefined ||
				algebraicParsed !== null);

		const resolvedMultiplier =
			explicitMultiplier ?? topLevelTermMult ?? algebraicParsed?.multiplier ?? 1;
		if (!unknownSymbol && algebraicParsed?.symbol) {
			unknownSymbol = algebraicParsed.symbol;
		}

		// Parse optional passive valueMode & unit (auto-inferring direct AC impedance for L/C)
		const rawUnit = typeof raw.unit === 'string' && raw.unit.trim() !== '' ? raw.unit.trim() : undefined;
		let explicitValueMode: PassiveValueMode | undefined;
		if (raw.valueMode !== undefined) {
			if (raw.valueMode === 'physical' || raw.valueMode === 'impedance') {
				explicitValueMode = raw.valueMode;
			} else {
				errors.push(
					`${prefix} (${displayName}): invalid "valueMode" (${JSON.stringify(raw.valueMode)}); expected "physical" or "impedance".`
				);
			}
		}

		const isReactiveKind = kind === 'inductor' || kind === 'capacitor';
		const inferredImpedanceMode =
			isReactiveKind &&
			(explicitValueMode === 'impedance' ||
				rawUnit === 'Ω' ||
				(!isMarkedUnknown && /[j∠@<]/i.test(rawValTrimmed)));
		const resolvedValueMode: PassiveValueMode | undefined = inferredImpedanceMode
			? 'impedance'
			: explicitValueMode;
		const resolvedUnit: string | undefined = inferredImpedanceMode ? 'Ω' : rawUnit;

		// Validate value (allowing "?" / "unknown" / algebraic expression when element is marked unknown)
		let valueStr = '';
		if (kind === 'ground' || kind === 'terminal' || kind === 'voltmeter') {
			valueStr = typeof raw.value === 'string' && raw.value.trim() !== '' ? raw.value.trim() : '0';
		} else if (isMarkedUnknown) {
			const defaultPlaceholder = inferredImpedanceMode
				? kind === 'inductor'
					? 'j1'
					: '-j1'
				: '1';
			if (algebraicParsed !== null || isUnknownPlaceholder || rawValTrimmed === '') {
				valueStr = defaultPlaceholder;
			} else if (typeof raw.value === 'number' && Number.isFinite(raw.value) && raw.value > 0) {
				valueStr = inferredImpedanceMode
					? kind === 'inductor'
						? `j${raw.value}`
						: `-j${raw.value}`
					: String(raw.value);
			} else {
				const validAsKnown = PASSIVE_KINDS.has(kind)
					? inferredImpedanceMode
						? parseDirectImpedance({
								kind,
								value: rawValTrimmed,
								unit: 'Ω',
								valueMode: 'impedance'
							}) !== null
						: (() => {
								const n = parseEngineeringNumber(rawValTrimmed);
								return n !== null && Number.isFinite(n) && n > 0;
							})()
					: (() => {
							const c = parseComplexValue(rawValTrimmed);
							return c !== null && c.isFinite() && (mode === 'ac' || c.isReal(1e-12));
						})();
				if (validAsKnown) {
					valueStr = rawValTrimmed;
				} else {
					if (!unknownSymbol) unknownSymbol = rawValTrimmed;
					valueStr = defaultPlaceholder;
				}
			}
		} else {
			if (typeof raw.value === 'number' && Number.isFinite(raw.value)) {
				valueStr = String(raw.value);
				warnings.push(
					`Element "${displayName}" provided numeric value ${raw.value}; normalized to "${valueStr}".`
				);
			} else if (rawValTrimmed !== '') {
				valueStr = rawValTrimmed;
			} else {
				errors.push(`${prefix} (${displayName}): "value" must be a non-empty string.`);
			}
		}

		let phaseDeg: number | undefined;
		if (raw.phaseDeg !== undefined) {
			if (typeof raw.phaseDeg !== 'number' || !Number.isFinite(raw.phaseDeg)) {
				errors.push(`${prefix} (${displayName}): "phaseDeg" must be a finite number.`);
			} else {
				phaseDeg = raw.phaseDeg;
			}
		}

		if (!isMarkedUnknown) {
			if (PASSIVE_KINDS.has(kind) && valueStr !== '') {
				if (inferredImpedanceMode) {
					const parsedZ = parseDirectImpedance({
						kind,
						value: valueStr,
						unit: 'Ω',
						valueMode: 'impedance'
					});
					if (parsedZ === null) {
						errors.push(
							`${prefix} (${displayName}): impedance value "${valueStr}" must be a non-zero complex impedance with non-negative resistance.`
						);
					}
				} else {
					const parsed = parseEngineeringNumber(valueStr);
					if (parsed === null || !Number.isFinite(parsed) || parsed <= 0) {
						errors.push(
							`${prefix} (${displayName}): passive value "${valueStr}" must be a positive finite number.`
						);
					}
				}
			} else if ((SOURCE_KINDS.has(kind) || isDependentSourceKind(kind)) && valueStr !== '') {
				const parsed = parseComplexValue(valueStr);
				if (!parsed || !parsed.isFinite()) {
					errors.push(
						`${prefix} (${displayName}): invalid source value "${valueStr}".`
					);
				} else if (mode === 'dc' && !parsed.isReal(1e-12)) {
					errors.push(
						`${prefix} (${displayName}): complex/phasor value "${valueStr}" is not valid in DC mode.`
					);
				}
			}
		}

		const el: LayoutNetlistElement = {
			kind,
			from: fromNode,
			to: toNode,
			value: valueStr
		};
		if (elId !== undefined) el.id = elId;
		if (labelStr !== '') el.label = labelStr;
		if (phaseDeg !== undefined) el.phaseDeg = phaseDeg;
		if (resolvedUnit !== undefined) el.unit = resolvedUnit;
		if (resolvedValueMode !== undefined) el.valueMode = resolvedValueMode;
		if (typeof raw.frequencyHz === 'number' && Number.isFinite(raw.frequencyHz)) {
			el.frequencyHz = raw.frequencyHz;
		}
		if (raw.sourceMode === 'dc' || raw.sourceMode === 'ac') el.sourceMode = raw.sourceMode;
		if (typeof raw.terminalName === 'string') el.terminalName = raw.terminalName;
		if (fromPos) el.fromPos = fromPos;
		if (toPos) el.toPos = toPos;
		const parsedControlRef = parseControlRefObject(raw.controlRef);
		if (parsedControlRef) el.controlRef = parsedControlRef;
		if (isMarkedUnknown) {
			el.unknown = true;
			if (unknownSymbol) el.unknownSymbol = unknownSymbol;
			el.unknownMultiplier = resolvedMultiplier;
			unknownHints.push({
				index: elements.length,
				symbol: unknownSymbol ?? (labelStr || undefined),
				multiplier: resolvedMultiplier
			});
		}

		elements.push(el);
	});

	if (errors.length > 0) {
		return { ok: false, errors };
	}

	const firstUnknownElementHint = unknownHints[0] ?? null;

	// Normalize unknownProblem (accepting full `obj.unknownProblem` OR shorthand `obj.constraint` + element `unknown: true`)
	let rawUnknownProblem: UnknownProblemSpec | undefined;
	if (rawTopUnknown) {
		const parsedConstraint = parseConstraintObject(
			rawTopUnknown.constraint,
			warnings,
			'unknownProblem.constraint'
		);
		const compRef =
			topLevelUnknownRef ??
			(topLevelTerms[0]?.componentId || '') ??
			(firstUnknownElementHint !== null
				? (elements[firstUnknownElementHint.index]?.id ??
					elements[firstUnknownElementHint.index]?.label ??
					'')
				: '');
		const resolvedCompRef =
			compRef ||
			(firstUnknownElementHint !== null
				? (elements[firstUnknownElementHint.index]?.id ??
					elements[firstUnknownElementHint.index]?.label ??
					'')
				: '');
		if (parsedConstraint && resolvedCompRef) {
			rawUnknownProblem = {
				componentId: resolvedCompRef,
				symbol: topLevelUnknownSymbol ?? firstUnknownElementHint?.symbol,
				...(topLevelTerms.length > 0 ? { terms: topLevelTerms } : {}),
				constraint: parsedConstraint
			};
		}
	} else if (isPlainObject(obj.constraint) && firstUnknownElementHint !== null) {
		const parsedConstraint = parseConstraintObject(obj.constraint, warnings, 'constraint');
		const targetEl = elements[firstUnknownElementHint.index];
		if (parsedConstraint && targetEl) {
			rawUnknownProblem = {
				componentId: targetEl.id ?? targetEl.label ?? '',
				symbol: targetEl.unknownSymbol ?? firstUnknownElementHint.symbol,
				constraint: parsedConstraint
			};
		}
	} else if (firstUnknownElementHint !== null) {
		const targetEl = elements[firstUnknownElementHint.index];
		warnings.push(
			`Element "${targetEl?.label ?? targetEl?.id ?? 'unknown'}" was marked unknown without a constraint; defaulted value to "1".`
		);
	}

	const layoutResult = layoutNetlistWithMeta({
		schemaVersion: 1,
		id: typeof obj.id === 'string' ? obj.id.trim() : undefined,
		name: typeof obj.name === 'string' ? obj.name.trim() : undefined,
		mode,
		frequencyHz,
		acMagnitudeMode,
		unitSystem,
		groundNode: typeof obj.groundNode === 'string' ? obj.groundNode.trim() : undefined,
		elements
	});

	const { document, layoutMode, nodeIdMap } = layoutResult;
	warnings.push(...layoutResult.warnings);

	const resolveCompId = (ref: string): string | null => {
		const byId = document.components.find((c) => c.id === ref);
		if (byId) return byId.id;
		const byLabel = document.components.find((c) => c.label === ref);
		if (byLabel) return byLabel.id;
		return null;
	};

	// Resolve dependent source controlRef component/node references against laid-out IDs
	for (const comp of document.components) {
		if (!isDependentSourceKind(comp.kind) || !comp.controlRef) continue;
		const ref = { ...comp.controlRef };
		if (ref.controlComponentId) {
			const resolved = resolveCompId(ref.controlComponentId);
			if (resolved) ref.controlComponentId = resolved;
		}
		if (ref.controlBranchComponentId) {
			const resolved = resolveCompId(ref.controlBranchComponentId);
			if (resolved) ref.controlBranchComponentId = resolved;
		}
		if (ref.controlNodePos !== undefined) {
			ref.controlNodePos = nodeIdMap[ref.controlNodePos] ?? ref.controlNodePos;
		}
		if (ref.controlNodeNeg !== undefined) {
			ref.controlNodeNeg = nodeIdMap[ref.controlNodeNeg] ?? ref.controlNodeNeg;
		}
		comp.controlRef = ref;
	}

	// Resolve and attach `unknownProblem` using actual laid-out component IDs and graph node IDs
	if (rawUnknownProblem) {

		let resolvedCompId = resolveCompId(rawUnknownProblem.componentId);
		if (!resolvedCompId && firstUnknownElementHint !== null) {
			const fallbackEl = elements[firstUnknownElementHint.index];
			const fallbackComp = document.components.find(
				(c) =>
					(fallbackEl?.id && c.id === fallbackEl.id) ||
					(fallbackEl?.label && c.label === fallbackEl.label)
			);
			if (fallbackComp) resolvedCompId = fallbackComp.id;
		}

		// Merge explicit top-level terms + all per-element unknownHints, deduplicating by resolved componentId
		const mergedTerms: UnknownTerm[] = [];
		const seenTermCompIds = new Set<string>();
		const pushResolvedTerm = (compId: string | null, multiplier: number) => {
			if (!compId || seenTermCompIds.has(compId)) return;
			if (!Number.isFinite(multiplier) || Math.abs(multiplier) <= 1e-15) return;
			seenTermCompIds.add(compId);
			mergedTerms.push({ componentId: compId, multiplier });
		};

		if (rawUnknownProblem.terms) {
			for (const t of rawUnknownProblem.terms) {
				pushResolvedTerm(resolveCompId(t.componentId), t.multiplier);
			}
		}
		for (const hint of unknownHints) {
			const el = elements[hint.index];
			const ref = el?.id ?? el?.label ?? '';
			const resolved = ref ? resolveCompId(ref) : null;
			pushResolvedTerm(resolved, hint.multiplier);
		}
		if (resolvedCompId && !seenTermCompIds.has(resolvedCompId)) {
			mergedTerms.unshift({ componentId: resolvedCompId, multiplier: 1 });
			seenTermCompIds.add(resolvedCompId);
		}

		let resolvedTargetId: string | null = rawUnknownProblem.constraint.targetId;
		if (rawUnknownProblem.constraint.kind === 'node_voltage') {
			resolvedTargetId = nodeIdMap[resolvedTargetId] ?? resolvedTargetId;
		} else {
			resolvedTargetId = resolveCompId(resolvedTargetId);
		}

		if (resolvedCompId && resolvedTargetId) {
			const shouldAttachTerms =
				mergedTerms.length >= 2 ||
				(mergedTerms.length === 1 && Math.abs(mergedTerms[0].multiplier - 1) >= 1e-12) ||
				Boolean(rawUnknownProblem.terms && rawUnknownProblem.terms.length > 0);
			document.unknownProblem = {
				componentId: resolvedCompId,
				symbol: rawUnknownProblem.symbol,
				...(shouldAttachTerms ? { terms: mergedTerms } : {}),
				constraint: {
					...rawUnknownProblem.constraint,
					targetId: resolvedTargetId
				}
			};
		} else {
			warnings.push(
				`Could not match unknownProblem references (component "${rawUnknownProblem.componentId}", target "${rawUnknownProblem.constraint.targetId}"); imported circuit without unknown constraint.`
			);
		}
	}

	const graph = buildElectricalGraph(document);
	for (const diag of graph.diagnostics) {
		if (diag.severity === 'warning' || diag.severity === 'info') {
			warnings.push(diag.message);
		}
	}

	return {
		ok: true,
		document,
		sourceFormat: 'ai-netlist',
		layoutMode,
		warnings
	};
}

/**
 * Parses either a full `CircuitDocument` JSON or an AI-generated `AINetlistDocument` JSON
 * (automatically stripping markdown code fences or surrounding AI commentary).
 */
export function parseCircuitImport(rawText: string): CircuitImportResult {
	if (typeof rawText !== 'string' || rawText.trim() === '') {
		return {
			ok: false,
			errors: ['Input is empty. Paste Circuit Lab JSON or AI-generated netlist JSON.']
		};
	}

	const candidates = extractJsonCandidates(rawText);
	if (candidates.length === 0) {
		return {
			ok: false,
			errors: ['No JSON object found in input. Expected a JSON object starting with "{".']
		};
	}

	let parsed: unknown = null;
	let lastParseError = 'Invalid JSON syntax.';
	let didParse = false;

	for (const candidate of candidates) {
		try {
			parsed = JSON.parse(candidate);
			didParse = true;
			break;
		} catch (err) {
			lastParseError = err instanceof Error ? err.message : String(err);
		}
	}

	if (!didParse) {
		return {
			ok: false,
			errors: [`Invalid JSON: ${lastParseError}`]
		};
	}

	if (!isPlainObject(parsed)) {
		return {
			ok: false,
			errors: ['Top-level JSON value must be an object ({ ... }).']
		};
	}

	if ('components' in parsed) {
		return parseCircuitDocumentFormat(parsed);
	}

	if ('elements' in parsed) {
		return parseAiNetlistFormat(parsed);
	}

	return {
		ok: false,
		errors: [
			'Unrecognized JSON format: expected either a CircuitDocument ("components" + "wires") or an AI netlist ("elements").'
		]
	};
}
