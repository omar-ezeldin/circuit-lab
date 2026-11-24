import { describe, expect, it } from 'vitest';
import {
	AI_MACHINES_IMPORT_PROMPT,
	ALL_MACHINE_AI_TOPIC_SLUGS,
	MACHINE_AI_TOPIC_SLUG_MAP,
	MACHINE_QUESTION_TYPES,
	MACHINE_QUESTION_TYPE_TO_SLUG,
	parseMachineAiImport,
	resolveMachineQuestionType,
	type MachineQuestionTypeId
} from '../index';

describe('Electrical Machines AI Import', () => {
	it('maps all 14 semantic slugs 1-to-1 with MachineQuestionTypeId and exposes zero QT-* codes in prompt', () => {
		expect(ALL_MACHINE_AI_TOPIC_SLUGS).toHaveLength(14);
		const allQtIds = Object.keys(MACHINE_QUESTION_TYPES) as MachineQuestionTypeId[];
		expect(allQtIds).toHaveLength(14);

		for (const slug of ALL_MACHINE_AI_TOPIC_SLUGS) {
			const qtId = MACHINE_AI_TOPIC_SLUG_MAP[slug];
			expect(MACHINE_QUESTION_TYPE_TO_SLUG[qtId]).toBe(slug);
			expect(resolveMachineQuestionType(slug)).toBe(qtId);
			expect(resolveMachineQuestionType(slug.toUpperCase())).toBe(qtId);
			expect(resolveMachineQuestionType(slug.replace(/_/g, '-'))).toBe(qtId);
			expect(resolveMachineQuestionType(qtId)).toBe(qtId);
			expect(resolveMachineQuestionType(qtId.toLowerCase())).toBe(qtId);
			expect(AI_MACHINES_IMPORT_PROMPT).toContain(`"${slug}"`);
		}

		// Prompt is user-previewable in the UI and must never expose internal QT-* codes
		expect(AI_MACHINES_IMPORT_PROMPT).not.toMatch(/\bQT-[A-Z0-9]+-\d+\b/);
	});

	it('parses and solves all 14 catalog presets through their semantic AI slugs', () => {
		for (const slug of ALL_MACHINE_AI_TOPIC_SLUGS) {
			const qtId = MACHINE_AI_TOPIC_SLUG_MAP[slug];
			const preset = MACHINE_QUESTION_TYPES[qtId].presets[0];
			// Simulate JSON serialization (Infinity becomes null, so use idealCore: true where needed)
			const jsonSafeInput = JSON.parse(
				JSON.stringify(preset.input, (_key, val) => (val === Infinity ? 0 : val))
			);
			const payload = JSON.stringify({
				type: slug,
				title: preset.label,
				input: jsonSafeInput
			});

			const res = parseMachineAiImport(payload);
			expect(res.ok, `Slug "${slug}" failed: ${!res.ok ? res.error : ''}`).toBe(true);
			if (res.ok) {
				expect(res.questionTypeId).toBe(qtId);
				expect(res.topicSlug).toBe(slug);
				expect(res.title).toBe(preset.label);
				expect(res.previewResult.valid).toBe(true);
				expect(res.previewResult.answers.length).toBeGreaterThan(0);
			}
		}
	});

	it('extracts JSON wrapped in markdown code fences and surrounding AI prose', () => {
		const raw = `Sure! Here is the structured JSON for your transformer problem:

\`\`\`json
{
  "questionType": "Transformer-OC-SC",
  "title": "Spring 2024 Final Q3a",
  "input": {
    "ratedVA": 20000,
    "v1Rated": 2000,
    "v2Rated": 200,
    "frequencyHz": 50,
    "ocSide": "LV",
    "vOc": 200,
    "iOc": 4,
    "pOc": 120,
    "scSide": "HV",
    "vSc": 60,
    "iSc": 10,
    "pSc": 300,
    "referTo": "primary",
    "evalLoadFraction": 1,
    "evalPf": 0.8,
    "evalPfType": "lag"
  }
}
\`\`\`

Let me know if you want me to verify any other question!`;

		const res = parseMachineAiImport(raw);
		expect(res.ok).toBe(true);
		if (!res.ok) return;

		expect(res.questionTypeId).toBe('QT-XFMR-2');
		expect(res.title).toBe('Spring 2024 Final Q3a');
		expect(res.previewResult.valid).toBe(true);
		// Exact solved values from Spring 2024 Final Q3a (referred to primary)
		expect(res.previewResult.values.rcRef).toBeCloseTo(33333.33, 1);
		expect(res.previewResult.values.reRef).toBeCloseTo(3.0, 2);
		expect(res.previewResult.values.xeRef).toBeCloseTo(5.196, 2);
	});

	it('accepts topic alias, QT-* fallback, numeric string coercion, enum normalization, and B-H tables', () => {
		const raw = `Here is the nonlinear magnetic circuit:
{
  "topic": "QT-MAG-2",
  "input": {
    "topology": "SERIES-NONLINEAR",
    "coreLengthM": "0.3",
    "coreAreaM2": "0.000314159265",
    "gapLengthM": "0.001",
    "turns": "600",
    "solveFor": "CURRENT",
    "fluxWb": "0.0005",
    "bhTable": [
      { "h": "2500", "b": "1.55" },
      [3000, 1.59],
      { "H": 3500, "B": 1.6 },
      { "H": "4000", "B": "1.615" }
    ],
    "extraComment": "should be ignored with warning"
  }
}`;

		const res = parseMachineAiImport(raw);
		expect(res.ok).toBe(true);
		if (!res.ok) return;

		expect(res.questionTypeId).toBe('QT-MAG-2');
		expect(res.previewResult.valid).toBe(true);
		expect(res.previewResult.values.currentA).toBeGreaterThan(3);
		expect(res.warnings).toContain('Ignored unrecognized field "extraComment".');
	});

	it('handles idealCore with muR: "Infinity" or muR: 0 for variable-reluctance relay', () => {
		const raw = JSON.stringify({
			type: 'magnetic_relay',
			input: {
				coreLengthM: 0,
				coreAreaM2: '0.0015',
				muR: 'Infinity',
				idealCore: 'true',
				turns: '100',
				numGaps: '1',
				initialGapM: '0.04',
				finalGapM: '0',
				constraint: 'constant-flux',
				initialFluxWb: '0.1'
			}
		});

		const res = parseMachineAiImport(raw);
		expect(res.ok).toBe(true);
		if (!res.ok) return;
		expect(res.questionTypeId).toBe('QT-MAG-3');
		expect(res.previewResult.valid).toBe(true);
	});

	it('returns clear errors for invalid JSON, unknown topic, malformed input, and unphysical parameters', () => {
		const emptyRes = parseMachineAiImport('   ');
		expect(emptyRes.ok).toBe(false);

		const badJson = parseMachineAiImport('not valid json at all');
		expect(badJson.ok).toBe(false);

		const unknownType = parseMachineAiImport(
			JSON.stringify({ type: 'quantum_motor', input: { poles: 4 } })
		);
		expect(unknownType.ok).toBe(false);
		if (!unknownType.ok) {
			expect(unknownType.error).toContain('Unknown machine topic');
			expect(unknownType.error).not.toMatch(/\bQT-[A-Z0-9]+-\d+\b/);
		}

		const missingInput = parseMachineAiImport(JSON.stringify({ type: 'induction_basic' }));
		expect(missingInput.ok).toBe(false);

		const unphysical = parseMachineAiImport(
			JSON.stringify({
				type: 'three_phase',
				input: {
					loadConnection: 'Y',
					voltageType: 'line',
					voltageV: -400,
					loadMode: 'impedance',
					loadR: 10,
					loadX: 5
				}
			})
		);
		expect(unphysical.ok).toBe(false);
		if (!unphysical.ok) {
			expect(unphysical.error.length).toBeGreaterThan(0);
		}
	});
});
