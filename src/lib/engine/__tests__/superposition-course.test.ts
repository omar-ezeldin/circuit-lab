import { describe, expect, it } from 'vitest';
import { PRESETS, getPresetById } from '../../data/presets';
import { solveMNA } from '../mna';
import { solveCircuit } from '../solve';
import { buildDeactivatedDocument, formatLatexTerm, formatLatexValue } from '../methods/shared';
import type { CircuitComponent, CircuitDocument, MethodResult } from '../types';

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

/** Two voltage sources feeding R1 - R3 - V2 with R2 to ground in the middle. */
function twoSourceLadder(): CircuitDocument {
	return {
		schemaVersion: 1,
		mode: 'dc',
		frequencyHz: 60,
		components: [
			comp('V1', 'voltage_source', 0, 2, 90, '12'),
			comp('R1', 'resistor', 2, 0, 0, '1000'),
			comp('R2', 'resistor', 4, 2, 90, '1000'),
			comp('R3', 'resistor', 6, 0, 0, '1000'),
			comp('V2', 'voltage_source', 8, 2, 90, '6'),
			comp('G1', 'ground', 0, 4, 0, '0')
		],
		wires: [wire('wb', [0, 4], [8, 4])]
	};
}

function sup(doc: CircuitDocument, target?: string): { res: MethodResult; full: ReturnType<typeof solveCircuit> } {
	const full = solveCircuit(doc, {
		methods: ['superposition'],
		theveninTarget: target ? { kind: 'component', componentId: target } : undefined
	});
	return { res: full.methods.superposition!, full };
}

const partSteps = (res: MethodResult) => res.steps.filter((s) => /^\d+\. Part /.test(s.title));

/** MNA of the sub-circuit with only `sourceId` on. */
function subMna(doc: CircuitDocument, sourceId: string) {
	const sub = buildDeactivatedDocument(doc, sourceId);
	return solveMNA(sub, { frequencyHz: sub.frequencyHz });
}

describe('superposition, course style', () => {
	it('two-source ladder with a target: R_eq, source current and divider per part; values equal sub-circuit MNA', () => {
		const doc = twoSourceLadder();
		const { res, full } = sup(doc, 'R3');
		expect(res.applicable).toBe(true);
		expect(res.verifiedAgainstMna).toBe(true);

		const parts = partSteps(res);
		expect(parts.map((p) => p.title)).toEqual([
			'2. Part ′: V1 Alone',
			'3. Part ″: V2 Alone'
		]);

		for (const [i, id] of ['V1', 'V2'].entries()) {
			const lines = parts[i].latex ?? [];
			expect(lines.some((l) => l.startsWith('R_{eq} = '))).toBe(true);
			expect(lines.some((l) => l.startsWith('I_s = \\frac{'))).toBe(true);
			if (i === 0) {
				// R3 is in parallel with R2 here: a current divider.
				expect(lines.some((l) => l.startsWith("I'_{R_{3}} = I_s \\cdot \\frac{R_{2}}{R_{3} + R_{2}}"))).toBe(true);
			} else {
				// R3 is in series with V2 here: it carries the source current.
				expect(lines.some((l) => l.startsWith("I''_{R_{3}} = -I_s = "))).toBe(true);
			}
			expect(lines.join('\n')).not.toContain('This part');

			// The displayed target values equal the sub-circuit MNA solution.
			const br = subMna(doc, id).branches['R3'];
			const prime = i === 0 ? "'" : "''";
			expect(
				lines.some(
					(l) =>
						l.startsWith(`I${prime}_{R_{3}} = `) &&
						l.endsWith(` = ${formatLatexValue(br.current, 'dc')}\\text{ A}`)
				)
			).toBe(true);
			expect(lines.some((l) => l.startsWith(`V${prime}_{R_{3}} = I${prime}_{R_{3}} R_{3} = `))).toBe(true);
			expect(lines[lines.length - 1]).toBe(
				`V${prime}_{R_{3}} = I${prime}_{R_{3}} R_{3} = ${formatLatexTerm(br.current, 'dc')} \\cdot 1000 = ${formatLatexValue(br.voltage, 'dc')}\\text{ V}`
			);
		}

		// Part V2 pushes current through R3 against its arrow: the negative is explained.
		expect((parts[1].latex ?? []).join('\n')).toContain('against its arrow');

		const sum = res.steps.find((s) => s.title.endsWith('Superposition Sum'))!;
		const total = full.mna.branches['R3'];
		expect(sum.latex?.[0]).toMatch(/^I_\{R_\{3\}\} = I'_\{R_\{3\}\} \+ I''_\{R_\{3\}\} = /);
		expect(sum.latex?.[0]).toContain(`= ${formatLatexValue(total.current, 'dc')}\\text{ A}`);
		expect(sum.latex?.[1]).toContain(`= ${formatLatexValue(total.voltage, 'dc')}\\text{ V}`);

		// solve.ts still appends the Ans. step.
		const last = res.steps[res.steps.length - 1];
		expect(last.title).toBe('Ans.');
		expect(last.latex?.[0]).toContain('Ans.');
	});

	it('voltage source plus current source preset: both parts reduce, current source part uses I_s = I1', () => {
		const doc = getPresetById('dc-superposition-source-transform')!.document;
		const { res } = sup(structuredClone(doc), 'R3');
		expect(res.verifiedAgainstMna).toBe(true);
		const parts = partSteps(res);
		expect(parts).toHaveLength(2);
		const second = (parts[1].latex ?? []).join('\n');
		expect(second).toContain('\\text{V1 off} \\to \\text{short}');
		expect(second).toContain('I_s = I_{1} = 4\\text{ A}');
		expect(second).not.toContain('This part');
		const br = subMna(structuredClone(doc), 'I1').branches['R3'];
		expect(
			parts[1].latex?.some(
				(l) =>
					l.startsWith("I''_{R_{3}} = ") &&
					l.endsWith(` = ${formatLatexValue(br.current, 'dc')}\\text{ A}`)
			)
		).toBe(true);
	});

	it('without a target keeps the node-voltage contributions and adds R_eq and the source current', () => {
		const { res } = sup(twoSourceLadder());
		expect(res.verifiedAgainstMna).toBe(true);
		const lines = partSteps(res)[0].latex ?? [];
		expect(lines.some((l) => l.startsWith('R_{eq} = '))).toBe(true);
		expect(lines.some((l) => l.startsWith('I_s = '))).toBe(true);
		expect(lines.some((l) => l.startsWith('V_{') && l.includes('^{(1)}'))).toBe(true);
		const sum = res.steps.find((s) => s.title.endsWith('Superposition Sum'))!;
		expect(sum.latex?.some((l) => l.includes('\\sum_k'))).toBe(true);
	});

	it('a bridge forced to superposition falls back per part, never throws, still verified', () => {
		const bridge = getPresetById('dc-wheatstone-bridge')!.document;
		for (const target of ['R5', 'R1']) {
			const { res } = sup(structuredClone(bridge), target);
			expect(res.applicable).toBe(true);
			expect(res.verifiedAgainstMna).toBe(true);
			const lines = (partSteps(res)[0].latex ?? []).join('\n');
			expect(lines).toContain("This part isn't a series–parallel circuit, so solve it by nodal analysis:");
			expect(lines).toContain('\\text{Nodal KCL Equations}');
			expect(lines).toContain(`I'_{`);
		}
	});

	it('a source as the target is not worked toward (it is off in some parts), but still solves', () => {
		const bridge = getPresetById('dc-wheatstone-bridge')!.document;
		const { res } = sup(structuredClone(bridge), 'V1');
		expect(res.applicable).toBe(true);
		expect(res.verifiedAgainstMna).toBe(true);
		const all = res.steps.flatMap((s) => s.latex ?? []).join('\n');
		expect(all).not.toContain(`I'_{V`);
	});

	it('a circuit with a dependent source falls back and is verified', () => {
		const doc = getPresetById('dc-dependent-vcvs')!.document;
		const { res } = sup(structuredClone(doc), 'R2');
		expect(res.applicable).toBe(true);
		expect(res.verifiedAgainstMna).toBe(true);
		const part = partSteps(res)[0];
		expect(part.description).toContain('dependent source');
		expect((part.latex ?? []).join('\n')).toContain('solve it by nodal analysis');
		const br = subMna(structuredClone(doc), 'V1').branches['R2'];
		expect(part.latex).toContain(`I'_{R_{2}} = ${formatLatexValue(br.current, 'dc')}\\text{ A}`);
	});

	it('a single-frequency AC circuit works with complex impedances and is verified', () => {
		const doc = getPresetById('ac-multi-source-phasor')!.document;
		const { res } = sup(structuredClone(doc), 'R2');
		expect(res.verifiedAgainstMna).toBe(true);
		const lines = (partSteps(res)[0].latex ?? []).join('\n');
		expect(lines).toContain('Z_{eq} = ');
		expect(lines).toContain('Z_{L1}');
		expect(lines).not.toContain('This part');
	});

	it('target in a dead-end branch carries no current', () => {
		// R1 carries V1 to R2 to ground; R3 hangs off the R1-R2 node and goes nowhere.
		const doc: CircuitDocument = {
			schemaVersion: 1,
			mode: 'dc',
			frequencyHz: 60,
			components: [
				comp('V1', 'voltage_source', 0, 2, 90, '10'),
				comp('R1', 'resistor', 2, 0, 0, '100'),
				comp('R2', 'resistor', 4, 2, 90, '100'),
				comp('R3', 'resistor', 4, -2, 90, '100'),
				comp('G1', 'ground', 0, 4, 0, '0')
			],
			wires: [wire('wb', [0, 4], [4, 4])]
		};
		const { res } = sup(doc, 'R3');
		expect(res.applicable).toBe(true);
		expect(res.verifiedAgainstMna).toBe(true);
		const lines = (partSteps(res)[0].latex ?? []).join('\n');
		expect(lines).toContain('\\text{R3 carries no current}');
		expect(lines).toContain("I'_{R_{3}} = 0\\text{ A}");
		expect(lines).not.toContain('This part');
	});

	it('multi-frequency superposition is unchanged (no worked chain, time-domain step kept)', () => {
		const doc: CircuitDocument = {
			schemaVersion: 1,
			mode: 'ac',
			frequencyHz: 60,
			components: [
				comp('V1', 'voltage_source', 0, 2, 90, '10', { frequencyHz: 60 }),
				comp('R1', 'resistor', 2, 0, 0, '10'),
				comp('R2', 'resistor', 4, 2, 90, '10'),
				comp('V2', 'voltage_source', 8, 2, 90, '5', { frequencyHz: 120 }),
				comp('R3', 'resistor', 6, 0, 0, '10'),
				comp('G1', 'ground', 0, 4, 0, '0')
			],
			wires: [wire('wb', [0, 4], [8, 4])]
		};
		const { res } = sup(doc, 'R2');
		expect(res.applicable).toBe(true);
		const titles = res.steps.map((s) => s.title);
		expect(titles.some((t) => t.includes('Contribution of V1 Alone'))).toBe(true);
		expect(titles.some((t) => t.includes('Multi-Frequency Time-Domain'))).toBe(true);
		for (const s of partSteps(res)) expect(s.title).not.toContain('Part');
	});
});

describe('superposition: LaTeX safety', () => {
	it('every line renders in KaTeX for every preset, with and without a target, and has no bare semicolon', async () => {
		const katex = (await import('katex')).default;
		const failures: string[] = [];
		for (const p of PRESETS) {
			const firstPassive = p.document.components.find((c) =>
				['resistor', 'capacitor', 'inductor'].includes(c.kind)
			);
			const targets: Array<string | undefined> = [undefined, firstPassive?.id, p.theveninLoadId];
			for (const t of targets) {
				const doc = structuredClone(p.document);
				const full = solveCircuit(doc, {
					methods: ['superposition'],
					theveninTarget: t ? { kind: 'component', componentId: t } : undefined
				});
				const m = full.methods.superposition;
				if (!m) continue;
				for (const step of m.steps) {
					for (const tex of step.latex ?? []) {
						try {
							katex.renderToString(tex, { throwOnError: true });
						} catch (e) {
							failures.push(`${p.id}/${t}: ${String((e as Error).message).slice(0, 80)}`);
						}
						if (tex.replace(/\\;/g, '').replace(/&#59;/g, '').includes(';')) {
							failures.push(`${p.id}/${t}: bare ; in ${tex.slice(0, 60)}`);
						}
					}
				}
			}
		}
		expect(failures).toEqual([]);
	});
});
