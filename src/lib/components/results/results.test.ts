import { describe, expect, it } from 'vitest';
import { render } from 'svelte/server';
import {
	FinalAnswersCard,
	PhasorDiagram,
	ResultsPanel,
	UnknownSolutionCard,
	type CustomPhasor
} from './index';
import { circuit } from '$lib/stores/circuit.svelte';

describe('Circuit Results Dashboard & Upgraded PhasorDiagram', () => {
	it('renders ResultsPanel without MethodStepsPanel working-out tabs and includes Power Summary, Node Voltages, Branch Quantities, and AC PhasorDiagram', () => {
		circuit.loadPreset('ac-rlc-phasor');
		expect(circuit.document.mode).toBe('ac');
		expect(circuit.solution.mna.valid).toBe(true);

		const out = render(ResultsPanel, {
			props: {
				solution: circuit.solution,
				document: circuit.document
			}
		});

		expect(out.body).toContain('Power Summary');
		expect(out.body).toContain('Reactive Power (Q)');
		expect(out.body).toContain('Apparent Power (|S|)');
		expect(out.body).toContain('Power Factor (cos θ)');
		expect(out.body).toContain('Node Voltages');
		expect(out.body).toContain('Branch Quantities');
		expect(out.body).toContain('Impedance');
		expect(out.body).toContain('AC Polar Phasor Diagram');

		// Working-out method tabs must be removed
		expect(out.body).not.toContain('Step-by-Step');
		expect(out.body).not.toContain('KCL &amp; KVL');
		expect(out.body).not.toContain('Source Transform');
	});

	it('renders FinalAnswersCard in DC mode with Supplied/Absorbed KPI tiles and Thévenin/Norton summary without working-out', () => {
		circuit.loadPreset('dc-divider');
		expect(circuit.solution.mna.valid).toBe(true);

		const out = render(FinalAnswersCard, {
			props: {
				solution: circuit.solution,
				document: circuit.document
			}
		});

		expect(out.body).toContain('Total Supplied');
		expect(out.body).toContain('Total Absorbed');
		expect(out.body).toContain('ΣP = 0 · Balanced');
		expect(out.body).toContain('Node Voltages');
		expect(out.body).toContain('Branch Quantities');
		expect(out.body).toContain('Sources');
		expect(out.body).toContain('Loads');
	});

	it('renders UnknownSolutionCard without step-by-step derivation accordion', () => {
		circuit.loadPreset('dc-divider');
		const r2 = circuit.document.components.find((c) => c.label === 'R2');
		expect(r2).toBeDefined();
		circuit.setUnknownProblem({
			componentId: r2!.id,
			symbol: 'R_x',
			constraint: {
				kind: 'node_voltage',
				targetId: 'B',
				value: '8'
			}
		});
		expect(circuit.solution.unknownSolution?.valid).toBe(true);

		const out = render(UnknownSolutionCard, {
			props: {
				unknownSolution: circuit.solution.unknownSolution!,
				document: circuit.document,
				mode: circuit.document.mode,
				onApplySolution: () => {}
			}
		});

		expect(out.body).toContain('Unknown Parameter Solution');
		expect(out.body).toContain('Apply Solved Value to Circuit');
		expect(out.body).not.toContain('Step-by-Step Derivation');
	});

	it('renders PhasorDiagram with customPhasors (Machines Mode reuse), All/Voltages/Currents filter pills, 0/90/180/270 axes, and Legend Table', () => {
		const threePhasePhasors: CustomPhasor[] = [
			{ id: 'van', label: 'V_an', kind: 'voltage', magnitude: 230, angleDeg: 0, unit: 'V' },
			{ id: 'vbn', label: 'V_bn', kind: 'voltage', magnitude: 230, angleDeg: -120, unit: 'V' },
			{ id: 'vcn', label: 'V_cn', kind: 'voltage', magnitude: 230, angleDeg: 120, unit: 'V' },
			{ id: 'ia', label: 'I_a', kind: 'current', magnitude: 15, angleDeg: -36.87, unit: 'A' }
		];

		const out = render(PhasorDiagram, {
			props: {
				customPhasors: threePhasePhasors
			}
		});

		expect(out.body).toContain('All');
		expect(out.body).toContain('Voltages');
		expect(out.body).toContain('Currents');
		expect(out.body).toContain('0°');
		expect(out.body).toContain('90°');
		expect(out.body).toContain('180°');
		expect(out.body).toContain('270°');
		expect(out.body).toContain('Symbol');
		expect(out.body).toContain('Magnitude');
		expect(out.body).toContain('Angle');
		expect(out.body).toContain('Rect (a + jb)');
		const html = out.body.replaceAll(/<!--[\s\S]*?-->/g, '');
		expect(html).toContain('V<tspan dy="2.5" font-size="75%">an</tspan>');
		expect(html).toContain('V<tspan dy="2.5" font-size="75%">bn</tspan>');
		expect(html).toContain('V<tspan dy="2.5" font-size="75%">cn</tspan>');
		expect(html).toContain('I<tspan dy="2.5" font-size="75%">a</tspan>');
		expect(html).toContain('V<sub>an</sub>');
		expect(html).toContain('V<sub>bn</sub>');
		expect(html).toContain('V<sub>cn</sub>');
		expect(html).toContain('I<sub>a</sub>');
		expect(html).not.toContain('V_an');
		expect(html).not.toContain('V_bn');
		expect(html).not.toContain('V_cn');
		expect(html).not.toContain('I_a');
	});
});
