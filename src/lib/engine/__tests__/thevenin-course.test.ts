import { describe, expect, it } from 'vitest';
import { PRESETS, getPresetById } from '../../data/presets';
import { Complex } from '../complex';
import { parseCircuitImport } from '../io';
import { formatLatexValue } from '../methods/shared';
import { solveCircuit } from '../solve';
import type { CircuitComponent, CircuitDocument, SolutionStep } from '../types';

type El = { id: string; kind: string; from: string; to: string; value: string };

function netlist(elements: El[]): CircuitDocument {
	const imp = parseCircuitImport(
		JSON.stringify({
			schemaVersion: 1,
			name: 'thevenin-course',
			mode: 'dc',
			frequencyHz: 60,
			elements: elements.map((e) => ({ ...e, label: e.id }))
		})
	);
	if (!imp.ok) throw new Error('import failed');
	return imp.document;
}

function comp(
	id: string,
	kind: CircuitComponent['kind'],
	x: number,
	y: number,
	rotation: CircuitComponent['rotation'],
	value: string,
	extra?: Partial<CircuitComponent>
): CircuitComponent {
	return { id, kind, label: id, x, y, rotation, value, ...extra };
}

function wire(id: string, ...pts: Array<[number, number]>) {
	return { id, points: pts.map(([x, y]) => ({ x, y })) };
}

function run(doc: CircuitDocument, target: string) {
	const full = solveCircuit(doc, {
		methods: ['thevenin_norton'],
		theveninTarget: { kind: 'component', componentId: target }
	});
	const res = full.methods.thevenin_norton!;
	expect(res.applicable).toBe(true);
	return { full, res, tn: full.theveninNorton! };
}

const stepOf = (steps: SolutionStep[], prefix: string) =>
	steps.find((s) => s.title.startsWith(prefix))!;

/** Series-parallel network: V1 and I1 feed a ladder; the load RL hangs on the end. */
const ladder = () =>
	netlist([
		{ id: 'V1', kind: 'voltage_source', from: 'S', to: '0', value: '12' },
		{ id: 'R1', kind: 'resistor', from: 'S', to: 'X', value: '100' },
		{ id: 'R2', kind: 'resistor', from: 'X', to: '0', value: '200' },
		{ id: 'I1', kind: 'current_source', from: '0', to: 'X', value: '1m' },
		{ id: 'R3', kind: 'resistor', from: 'X', to: 'Y', value: '300' },
		{ id: 'RL', kind: 'resistor', from: 'Y', to: '0', value: '400' }
	]);

describe('Thevenin, course style', () => {
	it('1. independent sources only: kills the sources and shows R_th = R_eq (names, numbers, value)', () => {
		const { res, tn } = run(ladder(), 'RL');
		expect(res.verifiedAgainstMna).toBe(true);
		expect(tn.zth!.re).toBeCloseTo(300 + (100 * 200) / 300, 9);

		const step = stepOf(res.steps, '3. ');
		expect(step.title).toBe('3. Thevenin Resistance (R_th)');
		const lines = step.latex ?? [];
		expect(lines[0]).toBe('\\text{V1 off} \\to \\text{short},\\; \\text{I1 off} \\to \\text{open}');
		const rth = lines.find((l) => l.startsWith('R_{th} = '))!;
		expect(rth).toContain('R_{3} + (R_{1} \\parallel R_{2})');
		expect(rth).toContain('\\frac{'); // numbers step
		expect(rth.endsWith(`= ${formatLatexValue(tn.zth!, 'dc')}\\;\\Omega`)).toBe(true);
		expect(lines.join(' ')).not.toMatch(/test/i);
		expect(step.description).not.toMatch(/test/i);
	});

	it('2. a bridge as the network: falls back to the test-source line, still verified, never throws', () => {
		const doc = netlist([
			{ id: 'V1', kind: 'voltage_source', from: 'S', to: '0', value: '10' },
			{ id: 'Rs', kind: 'resistor', from: 'S', to: 'X', value: '10' },
			{ id: 'R1', kind: 'resistor', from: 'X', to: 'M1', value: '6' },
			{ id: 'R2', kind: 'resistor', from: 'M1', to: '0', value: '3' },
			{ id: 'R3', kind: 'resistor', from: 'X', to: 'M2', value: '4' },
			{ id: 'R4', kind: 'resistor', from: 'M2', to: '0', value: '12' },
			{ id: 'R5', kind: 'resistor', from: 'M1', to: 'M2', value: '2' },
			{ id: 'RL', kind: 'resistor', from: 'X', to: '0', value: '5' }
		]);
		const { res, tn } = run(doc, 'RL');
		expect(res.verifiedAgainstMna).toBe(true);
		const step = stepOf(res.steps, '3. ');
		expect(step.description).toBe("This network isn't series–parallel, so apply a 1 A test current source at the terminals:");
		expect(step.latex).toEqual([
			`R_{th} = \\frac{V_{test}}{I_{test}} = ${formatLatexValue(tn.zth!, 'dc')}\\;\\Omega`
		]);
	});

	it('3. independent + dependent sources: I_sc, then R_th = V_oc / I_sc, equal to the hidden test-source value', () => {
		const preset = getPresetById('dc-dependent-vcvs')!;
		const { res, tn } = run(preset.document, 'R2');
		expect(tn.zth!.re).toBeCloseTo(4000 / 7, 9);
		const step = stepOf(res.steps, '3. ');
		const lines = step.latex ?? [];
		expect(lines[0]).toBe(`I_{sc} = ${formatLatexValue(tn.isc!, 'dc')}\\text{ A}`);
		expect(lines[1].startsWith('R_{th} = \\frac{V_{oc}}{I_{sc}} = \\frac{')).toBe(true);
		expect(lines[1].endsWith(`= ${formatLatexValue(tn.zth!, 'dc')}\\;\\Omega`)).toBe(true);
		expect(lines.join(' ')).not.toMatch(/test/i);

		const norton = stepOf(res.steps, '4. ');
		expect(norton.title).toBe('4. Norton Current (I_N)');
		expect(norton.description).toContain('I_N = I_sc');
		expect(norton.latex![0].startsWith('I_N = \\frac{V_{th}}{R_{th}} = \\frac{')).toBe(true);
	});

	it('3b. CCCS with a source: short-circuit path also matches', () => {
		const doc: CircuitDocument = {
			schemaVersion: 1,
			mode: 'dc',
			frequencyHz: 60,
			components: [
				comp('V1', 'voltage_source', 4, 8, 90, '12'),
				comp('R1', 'resistor', 8, 4, 0, '4'),
				comp('F1', 'cccs', 12, 8, 270, '2', {
					controlRef: { controlBranchComponentId: 'R1', controlVarName: 'i_x' }
				}),
				comp('R2', 'resistor', 18, 8, 90, '6'),
				comp('G1', 'ground', 4, 10, 0, '0')
			],
			wires: [
				wire('w1', [4, 6], [4, 4], [6, 4]),
				wire('w2', [10, 4], [18, 4], [18, 6]),
				wire('w3', [12, 4], [12, 6]),
				wire('w4', [4, 10], [18, 10])
			]
		};
		const { res, tn } = run(doc, 'R2');
		expect(res.verifiedAgainstMna).toBe(true);
		const lines = stepOf(res.steps, '3. ').latex ?? [];
		expect(lines[0].startsWith('I_{sc} = ')).toBe(true);
		expect(lines[1]).toContain('\\frac{V_{oc}}{I_{sc}}');
		expect(tn.zth!.re).toBeCloseTo(4 / 3, 9);
	});

	it('4. dependent source only (V_th = 0): test-source wording', () => {
		const doc: CircuitDocument = {
			schemaVersion: 1,
			mode: 'dc',
			frequencyHz: 60,
			components: [
				comp('R1', 'resistor', 8, 4, 0, '4'),
				comp('F1', 'cccs', 12, 8, 270, '2', {
					controlRef: { controlBranchComponentId: 'R1', controlVarName: 'i_x' }
				}),
				comp('R2', 'resistor', 18, 8, 90, '6'),
				comp('G1', 'ground', 4, 10, 0, '0')
			],
			wires: [
				wire('w1', [4, 6], [4, 4], [6, 4]),
				wire('w1b', [4, 6], [4, 10]),
				wire('w2', [10, 4], [18, 4], [18, 6]),
				wire('w3', [12, 4], [12, 6]),
				wire('w4', [4, 10], [18, 10])
			]
		};
		const { res, tn } = run(doc, 'R2');
		expect(tn.vth.abs()).toBeLessThan(1e-9);
		expect(tn.zth!.re).toBeCloseTo(4 / 3, 9);
		const step = stepOf(res.steps, '3. ');
		expect(step.description).toContain('only sources are dependent');
		expect(step.description).toContain('test current source');
		expect(step.latex).toEqual([
			`R_{th} = \\frac{V_{test}}{I_{test}} = ${formatLatexValue(tn.zth!, 'dc')}\\;\\Omega`
		]);
	});

	it('5. max power (DC): P_max = V_th^2 / (4 R_th) with numbers, equal to maxRealPowerW', () => {
		const { res, tn } = run(ladder(), 'RL');
		const mp = res.steps.at(-1)!;
		expect(mp.title).toBe('6. Maximum Power Transfer');
		const lines = mp.latex!;
		expect(lines[0]).toBe(`R_{L} = R_{th} = ${formatLatexValue(tn.maxPowerTransfer!.optimalLoadImpedance, 'dc')}\\;\\Omega`);
		expect(lines[1].startsWith('P_{\\max} = \\frac{V_{th}^2}{4R_{th}} = \\frac{')).toBe(true);
		expect(lines[1]).toContain('4 \\cdot ');
		expect(
			lines[1].endsWith(
				`= ${formatLatexValue(Complex.from(tn.maxPowerTransfer!.maxRealPowerW, 0), 'dc')}\\text{ W}`
			)
		).toBe(true);
		// V_th^2 / 4R_th by hand
		const v = tn.vth.re;
		expect(tn.maxPowerTransfer!.maxRealPowerW).toBeCloseTo((v * v) / (4 * tn.zth!.re), 12);
	});

	it('6. AC preset with a target: Z_th wording and the value equals zth', () => {
		const preset = getPresetById('ac-rlc-phasor')!;
		const { res, tn } = run(preset.document, preset.theveninLoadId!);
		const step = stepOf(res.steps, '3. ');
		expect(step.title).toBe('3. Thevenin Impedance (Z_th)');
		const line = (step.latex ?? []).find((l) => l.startsWith('Z_{th} = '))!;
		expect(line).toBeDefined();
		expect(line.endsWith(`= ${formatLatexValue(tn.zth!, 'ac')}\\;\\Omega`)).toBe(true);
		expect((step.latex ?? []).join(' ')).not.toMatch(/R_\{th\}/);
		const norton = stepOf(res.steps, '4. ');
		expect(norton.latex![0].startsWith('I_N = \\frac{V_{th}}{Z_{th}} = ')).toBe(true);
		if (tn.maxPowerTransfer) {
			expect(res.steps.at(-1)!.latex![0].startsWith('Z_{L} = Z_{th}^{*} = ')).toBe(true);
		}
	});

	it('V_th step uses plain wording', () => {
		const { res } = run(ladder(), 'RL');
		expect(res.steps[0].title).toBe('1. Remove the Load');
		expect(res.steps[1].title).toBe('2. Open-Circuit Voltage (V_th)');
		expect(res.steps[1].description).toBe('Remove the load and find the voltage across the terminals.');
		expect(res.steps.some((s) => /Deactivated|Test-Source/.test(s.title + s.description))).toBe(false);
	});
});

describe('Thevenin, LaTeX safety', () => {
	it('every latex line of every preset (each passive and the preset target) renders in KaTeX', async () => {
		const katex = (await import('katex')).default;
		const failures: string[] = [];
		let rendered = 0;
		for (const p of PRESETS) {
			const targets = new Set<string | undefined>([p.theveninLoadId]);
			for (const c of p.document.components) {
				if (['resistor', 'capacitor', 'inductor'].includes(c.kind)) targets.add(c.id);
			}
			for (const t of targets) {
				const full = solveCircuit(p.document, {
					methods: ['thevenin_norton'],
					theveninTarget: t ? { kind: 'component', componentId: t } : undefined
				});
				const res = full.methods.thevenin_norton;
				for (const step of res?.steps ?? []) {
					for (const tex of step.latex ?? []) {
						rendered++;
						const where = `${p.id}/${t}: ${tex.slice(0, 50)}`;
						try {
							katex.renderToString(tex, { throwOnError: true });
						} catch (e) {
							failures.push(`${where} -> ${String((e as Error).message).slice(0, 60)}`);
						}
						if (/(?<!\\);/.test(tex)) failures.push(`${where} -> bare ;`);
						if (/NaN|Infinity|undefined/.test(tex)) failures.push(`${where} -> bad number`);
					}
					expect(step.title + step.description).not.toMatch(/NaN|Infinity|undefined/);
				}
			}
		}
		expect(rendered).toBeGreaterThan(50);
		expect(failures).toEqual([]);
	});
});
