import { describe, expect, it } from 'vitest';
import { render } from 'svelte/server';
import {
	MACHINE_CATEGORIES,
	MACHINE_QUESTION_TYPES,
	solveMachineQuestion,
	type MachineQuestionTypeId
} from '$lib/machines';
import {
	ImportMachineFromAIDialog,
	MachineDiagram,
	MachineInputForm,
	MachineSolutionPanel,
	MachinesWorkbench
} from './index';

const ALL_QUESTION_TYPES = Object.keys(MACHINE_QUESTION_TYPES) as MachineQuestionTypeId[];

function escapeHtml(text: string): string {
	return text.replace(/&/g, '&amp;');
}

function stripTags(html: string): string {
	return html
		.replace(/<annotation\b[^>]*>[\s\S]*?<\/annotation>/gi, ' ')
		.replace(/<[^>]+>/g, ' ');
}

describe('Machines UI Components', () => {
	it('renders MachinesWorkbench default state (OC & SC Tests) with Beta badges, results-only panel, and zero KaTeX errors', () => {
		const { body } = render(MachinesWorkbench);
		const visibleText = stripTags(body);

		expect(body).toContain('OC &amp; SC Tests');
		expect(body).toContain('Course Examples');
		expect(body).toContain('Final Answers');
		expect(body).toContain('Beta');
		expect(body).toContain('Solved');
		expect(body).not.toContain('Step-by-Step Derivation');
		expect(body).toContain('Key Formulas');
		expect(body).toContain('class="katex"');
		expect(body).not.toContain('katex-error');

		// Internal QT-* codes must never leak into visible UI text
		expect(visibleText).not.toContain('QT-XFMR-2');
		expect(visibleText).not.toContain('QT-3PH-1');
		expect(visibleText).not.toMatch(/\bQT-[A-Z0-9]+-\d+\b/);
	});

	it('renders shared PhasorDiagram on Three-Phase (QT-3PH-1) and On-Load Transformer (QT-XFMR-3)', () => {
		const { body: threePhaseBody } = render(MachinesWorkbench, {
			props: { initialQuestionTypeId: 'QT-3PH-1' }
		});
		expect(threePhaseBody).toContain('Phasor Diagram');
		expect(threePhaseBody).toContain('AC Polar Phasor Diagram');
		expect(threePhaseBody).toContain('Van');
		expect(threePhaseBody).toContain('Vab');
		expect(threePhaseBody).not.toContain('Step-by-Step Derivation');
		expect(threePhaseBody).not.toContain('katex-error');

		const { body: xfmrBody } = render(MachinesWorkbench, {
			props: { initialQuestionTypeId: 'QT-XFMR-3' }
		});
		expect(xfmrBody).toContain('Phasor Diagram');
		expect(xfmrBody).toContain('AC Polar Phasor Diagram');
		expect(xfmrBody).not.toContain('Step-by-Step Derivation');
		expect(xfmrBody).not.toContain('katex-error');
	});

	it('renders MachinesWorkbench across all 14 topics with plain-English labels, Beta badges, valid answers, and zero KaTeX errors', () => {
		for (const qtId of ALL_QUESTION_TYPES) {
			const meta = MACHINE_QUESTION_TYPES[qtId];
			const { body } = render(MachinesWorkbench, {
				props: { initialQuestionTypeId: qtId }
			});
			const visibleText = stripTags(body);

			expect(visibleText, `${qtId} must not expose internal QT code`).not.toContain(qtId);
			expect(visibleText, `${qtId} must not expose any QT-* code`).not.toMatch(/\bQT-[A-Z0-9]+-\d+\b/);
			expect(body, `${qtId} should render its plain-English title`).toContain(escapeHtml(meta.title));
			expect(body, `${qtId} should render its plain-English short label`).toContain(
				escapeHtml(meta.shortLabel)
			);
			expect(body, `${qtId} should render Beta badge`).toContain('Beta');
			expect(body, `${qtId} should not render Step-by-Step Derivation wall`).not.toContain(
				'Step-by-Step Derivation'
			);
			expect(body, `${qtId} should render first preset label`).toContain(
				escapeHtml(meta.presets[0].label)
			);
			expect(body, `${qtId} should render KaTeX formulas`).toContain('class="katex"');
			expect(body, `${qtId} must have zero KaTeX parse errors`).not.toContain('katex-error');
			expect(body, `${qtId} should not show invalid error banner for preset`).not.toContain(
				'Invalid Parameter Combination'
			);
			// Ensure no raw ASCII underscore variable names leak into visible text (excluding KaTeX annotations)
			expect(visibleText, `${qtId} must not render raw ASCII underscores in labels`).not.toMatch(
				/\b[A-Za-zμΦη]_[A-Za-z0-9φ]+\b/
			);
		}
	});

	it('renders MachineSolutionPanel answer cards with data-answer-card, min-w-0, overflow-hidden, math-inline, and zero overflow-x-auto across all 14 topics', () => {
		for (const qtId of ALL_QUESTION_TYPES) {
			const meta = MACHINE_QUESTION_TYPES[qtId];
			const solved = solveMachineQuestion(qtId, meta.presets[0].input as never);
			expect(solved.valid, `${qtId} default preset must solve cleanly`).toBe(true);

			const { body } = render(MachineSolutionPanel, {
				props: {
					result: solved,
					meta
				}
			});

			const cardMatches = [...body.matchAll(/<div\b[^>]*data-answer-card[^>]*>/g)];
			expect(cardMatches.length, `${qtId} should render data-answer-card elements`).toBeGreaterThan(0);

			for (const match of cardMatches) {
				const tag = match[0];
				expect(tag, `${qtId} answer card must include min-w-0`).toContain('min-w-0');
				expect(tag, `${qtId} answer card must include overflow-hidden`).toContain('overflow-hidden');
			}

			const inlineMathMatches = [...body.matchAll(/<span\b[^>]*math-inline[^>]*>/g)];
			expect(inlineMathMatches.length, `${qtId} should render math-inline symbols`).toBeGreaterThan(0);
			for (const match of inlineMathMatches) {
				expect(match[0], `${qtId} inline math must never include overflow-x-auto`).not.toContain(
					'overflow-x-auto'
				);
			}
			expect(body, `${qtId} must have zero KaTeX parse errors`).not.toContain('katex-error');
		}
	});

	it('renders MachineDiagram for all 5 categories using theme tokens (no hardcoded hex colors)', () => {
		for (const cat of MACHINE_CATEGORIES) {
			const { body } = render(MachineDiagram, {
				props: { category: cat.id }
			});
			expect(body).toContain('<svg');
			expect(body).toContain('role="img"');
			expect(body).not.toMatch(/#[0-9a-fA-F]{3,6}\b/);
		}
	});

	it('renders MachineInputForm with B-H table editor controls for QT-MAG-2', () => {
		const meta = MACHINE_QUESTION_TYPES['QT-MAG-2'];
		const preset = meta.presets[0];
		const { body } = render(MachineInputForm, {
			props: {
				questionTypeId: 'QT-MAG-2',
				meta,
				inputState: preset.input,
				activePresetId: preset.id,
				onSelectPreset: () => {},
				onResetPreset: () => {},
				onChange: () => {}
			}
		});

		expect(body).toContain('B–H Curve Points');
		expect(body).toContain('Add Point');
		expect(body).toContain('Remove point 1');
		expect(body).toContain(escapeHtml(preset.source));
	});

	it('renders MachineSolutionPanel error state cleanly when result is invalid', () => {
		const meta = MACHINE_QUESTION_TYPES['QT-3PH-1'];
		const invalidResult = solveMachineQuestion('QT-3PH-1', {
			loadConnection: 'Y',
			voltageType: 'line',
			voltageV: -10,
			loadMode: 'impedance',
			loadR: 10,
			loadX: 5
		});
		expect(invalidResult.valid).toBe(false);

		const { body } = render(MachineSolutionPanel, {
			props: {
				result: invalidResult,
				meta
			}
		});

		expect(body).toContain('role="alert"');
		expect(body).toContain('Invalid Parameter Combination');
		expect(body).not.toContain('QT-3PH-1');
		expect(body).not.toContain('katex-error');
	});

	it('renders ImportMachineFromAIDialog with plain-English preview, mobile-safe textarea, and zero QT-* codes', () => {
		const sampleJson = JSON.stringify({
			type: 'transformer_oc_sc',
			title: '20 kVA 2000/200 V Exam Problem',
			input: {
				ratedVA: 20000,
				v1Rated: 2000,
				v2Rated: 200,
				frequencyHz: 50,
				ocSide: 'LV',
				vOc: 200,
				iOc: 4,
				pOc: 120,
				scSide: 'HV',
				vSc: 60,
				iSc: 10,
				pSc: 300,
				referTo: 'primary',
				evalLoadFraction: 1,
				evalPf: 0.8,
				evalPfType: 'lag'
			}
		});

		const { body } = render(ImportMachineFromAIDialog, {
			props: {
				open: true,
				initialJson: sampleJson,
				onImportMachine: () => {}
			}
		});
		const visibleText = stripTags(body);

		expect(body).toContain('Import Machines Problem from AI');
		expect(body).toContain('Copy AI Prompt');
		expect(body).toContain('Load Sample');
		expect(body).toContain('Load &amp; Solve');
		expect(body).toContain('text-base');
		expect(visibleText).toContain(escapeHtml('Transformer · OC & SC Tests'));
		expect(visibleText).toContain('20 kVA 2000/200 V Exam Problem');
		expect(visibleText).not.toMatch(/\bQT-[A-Z0-9]+-\d+\b/);

		const { body: invalidBody } = render(ImportMachineFromAIDialog, {
			props: {
				open: true,
				initialJson: '{"type":"unknown_topic","input":{}}',
				onImportMachine: () => {}
			}
		});
		expect(invalidBody).toContain('role="alert"');
		expect(invalidBody).toContain('Could not validate machines JSON');
		expect(stripTags(invalidBody)).not.toMatch(/\bQT-[A-Z0-9]+-\d+\b/);
	});
});
