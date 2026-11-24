import { describe, expect, it } from 'vitest';
import { render } from 'svelte/server';
import {
	MACHINE_CATEGORIES,
	MACHINE_QUESTION_TYPES,
	solveMachineQuestion,
	type MachineQuestionTypeId
} from '$lib/machines';
import {
	MachineDiagram,
	MachineInputForm,
	MachineSolutionPanel,
	MachinesWorkbench
} from './index';

const ALL_QUESTION_TYPES = Object.keys(MACHINE_QUESTION_TYPES) as MachineQuestionTypeId[];

function escapeHtml(text: string): string {
	return text.replace(/&/g, '&amp;');
}

describe('Machines UI Components', () => {
	it('renders MachinesWorkbench default state (QT-XFMR-2) with live solution and zero KaTeX errors', () => {
		const { body } = render(MachinesWorkbench);
		expect(body).toContain('QT-XFMR-2');
		expect(body).toContain('Course Examples');
		expect(body).toContain('Final Answers');
		expect(body).toContain('Step-by-Step Derivation');
		expect(body).toContain('Key Formulas');
		expect(body).toContain('class="katex"');
		expect(body).not.toContain('katex-error');
	});

	it('renders MachinesWorkbench across all 14 question types with valid answers and zero KaTeX errors', () => {
		for (const qtId of ALL_QUESTION_TYPES) {
			const meta = MACHINE_QUESTION_TYPES[qtId];
			const { body } = render(MachinesWorkbench, {
				props: { initialQuestionTypeId: qtId }
			});

			expect(body, `${qtId} should render its code`).toContain(qtId);
			expect(body, `${qtId} should render its title`).toContain(escapeHtml(meta.title));
			expect(body, `${qtId} should render first preset label`).toContain(
				escapeHtml(meta.presets[0].label)
			);
			expect(body, `${qtId} should render KaTeX formulas`).toContain('class="katex"');
			expect(body, `${qtId} must have zero KaTeX parse errors`).not.toContain('katex-error');
			expect(body, `${qtId} should not show invalid error banner for preset`).not.toContain(
				'Invalid Parameter Combination'
			);
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
		expect(body).not.toContain('katex-error');
	});
});
