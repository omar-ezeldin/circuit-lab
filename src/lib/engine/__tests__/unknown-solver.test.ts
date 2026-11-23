import { describe, expect, it } from 'vitest';
import { Complex } from '../complex';
import { exportCircuitJson, parseCircuitImport } from '../io';
import { solveCircuit } from '../solve';
import type { CircuitComponent, CircuitDocument } from '../types';
import {
	formatLatexResidual,
	formatUnknownTermExpr,
	formatUnknownTermLatex,
	getUnknownTerms,
	parseAlgebraicUnknownValue,
	solveUnknownParameter
} from '../unknown-solver';

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

const OMEGA_1000_HZ = 1000 / (2 * Math.PI);

describe('solveUnknownParameter — Exact Analytical Inverse Circuit Solver', () => {
	it('1. DC unknown voltage source given branch current (I_R3 = 2mA -> exact V1 = 36V)', () => {
		// V1: (0,4) rot 90 -> +:(0,2)[A], -:(0,6)[0]
		// R1: (2,2) rot 0 -> a:(0,2)[A], b:(4,2)[B], 6k
		// R2: (4,4) rot 90 -> a:(4,2)[B], b:(4,6)[0], 6k
		// R3: (8,4) rot 90 -> a:(8,2)[B], b:(8,6)[0], 6k
		const doc: CircuitDocument = {
			schemaVersion: 1,
			mode: 'dc',
			frequencyHz: 60,
			components: [
				comp('V1', 'voltage_source', 0, 4, 90, '?'),
				comp('R1', 'resistor', 2, 2, 0, '6k'),
				comp('R2', 'resistor', 4, 4, 90, '6k'),
				comp('R3', 'resistor', 8, 4, 90, '6k'),
				comp('G1', 'ground', 0, 6, 0, '0')
			],
			wires: [wire('w_top', [4, 2], [8, 2]), wire('w_gnd', [0, 6], [8, 6])]
		};

		const res = solveUnknownParameter(doc, {
			componentId: 'V1',
			symbol: 'Vs',
			constraint: { kind: 'branch_current', targetId: 'R3', value: '2m' }
		});

		expect(res.valid).toBe(true);
		expect(res.solutions).toHaveLength(1);
		expect(res.solutions[0].value.re).toBeCloseTo(36, 10);
		expect(res.solutions[0].discrepancy).toBeLessThan(1e-10);
		expect(res.solutions[0].verified).toBe(true);
		expect(res.steps.length).toBeGreaterThanOrEqual(3);
		expect(res.steps[0].description).toContain('measured quantity I(R3)');
		expect(res.steps[0].description).toContain('unknown source Vs (V1)');
		expect(res.steps[2].latex?.[1]).toContain('= 0\\text{ A}');
		expect(res.steps[2].latex?.[1]).not.toMatch(/\de[+-]\d/i);
	});

	it('1b. Formats LaTeX residuals cleanly and deduplicates symbol/label prose', () => {
		expect(formatLatexResidual(0, 'A')).toBe('0\\text{ A}');
		expect(formatLatexResidual(1e-15, 'W')).toBe('0\\text{ W}');
		expect(formatLatexResidual(0, '')).toBe('0');
		expect(formatLatexResidual(1.25e-9, 'A')).toBe('1.25 \\times 10^{-9}\\text{ A}');
		expect(formatLatexResidual(3.4e-11, 'W')).toBe('3.40 \\times 10^{-11}\\text{ W}');
		const doc: CircuitDocument = {
			schemaVersion: 1,
			mode: 'dc',
			frequencyHz: 60,
			components: [
				comp('Vs', 'voltage_source', 0, 4, 90, '?'),
				comp('R1', 'resistor', 2, 2, 0, '2k'),
				comp('R2', 'resistor', 4, 4, 90, '4k'),
				comp('G1', 'ground', 0, 6, 0, '0')
			],
			wires: [wire('w_gnd', [0, 6], [4, 6])]
		};

		const res = solveUnknownParameter(doc, {
			componentId: 'Vs',
			symbol: 'Vs',
			constraint: { kind: 'branch_current', targetId: 'R2', value: '2m' }
		});

		expect(res.valid).toBe(true);
		expect(res.solutions[0].value.re).toBeCloseTo(12, 10);
		expect(res.steps[0].description).toContain('measured quantity I(R2)');
		expect(res.steps[0].description).toContain('unknown source Vs.');
		expect(res.steps[0].description).not.toContain('Vs (Vs)');
	});

	it('2. DC unknown voltage source given node voltage with nonzero offset y(0) != 0', () => {
		// V1 (A -> 0), R1 = 2k (A -> B), R2 = 2k (B -> 0), I1 = 3m (0 -> B)
		// V_B = 0.5 * V1 + 3 => V_B = 10 V gives V1 = 14 V
		const doc: CircuitDocument = {
			schemaVersion: 1,
			mode: 'dc',
			frequencyHz: 60,
			components: [
				comp('V1', 'voltage_source', 0, 4, 90, '10'),
				comp('R1', 'resistor', 2, 2, 0, '2k'),
				comp('R2', 'resistor', 4, 4, 90, '2k'),
				comp('I1', 'current_source', 8, 4, 270, '3m'),
				comp('G1', 'ground', 0, 6, 0, '0')
			],
			wires: [wire('w_top', [4, 2], [8, 2]), wire('w_gnd', [0, 6], [8, 6])]
		};

		const res = solveUnknownParameter(doc, {
			componentId: 'V1',
			symbol: 'V',
			constraint: { kind: 'node_voltage', targetId: 'B', value: '10' }
		});

		expect(res.valid).toBe(true);
		expect(res.solutions).toHaveLength(1);
		expect(res.solutions[0].value.re).toBeCloseTo(14, 10);
		expect(res.solutions[0].discrepancy).toBeLessThan(1e-10);
		expect(res.solutions[0].verified).toBe(true);
	});

	it('3. DC unknown current source given branch voltage (V_R2 = 12V -> I1 = 6A)', () => {
		const doc: CircuitDocument = {
			schemaVersion: 1,
			mode: 'dc',
			frequencyHz: 60,
			components: [
				comp('I1', 'current_source', 0, 4, 270, '1'),
				comp('R1', 'resistor', 4, 4, 90, '3'),
				comp('R2', 'resistor', 8, 4, 90, '6'),
				comp('G1', 'ground', 0, 6, 0, '0')
			],
			wires: [wire('w_top', [0, 2], [8, 2]), wire('w_bot', [0, 6], [8, 6])]
		};

		const res = solveUnknownParameter(doc, {
			componentId: 'I1',
			symbol: 'Is',
			constraint: { kind: 'branch_voltage', targetId: 'R2', value: '12' }
		});

		expect(res.valid).toBe(true);
		expect(res.solutions).toHaveLength(1);
		expect(res.solutions[0].value.re).toBeCloseTo(6, 10);
		expect(res.solutions[0].discrepancy).toBeLessThan(1e-10);
		expect(res.solutions[0].verified).toBe(true);
	});

	it('4. DC unknown resistor given node voltage & branch current (exact Möbius inversion)', () => {
		// Ladder: V1 = 20V (A->0), R1 = 10 (A->B), Rx (B->0), R2 = 10 (B->C), R3 = 10 (C->0)
		// When Rx = 20 Ω: V_B = 10 V, V_C = 5 V, I_R3 = 0.5 A
		const doc: CircuitDocument = {
			schemaVersion: 1,
			mode: 'dc',
			frequencyHz: 60,
			components: [
				comp('V1', 'voltage_source', 0, 4, 90, '20'),
				comp('R1', 'resistor', 2, 2, 0, '10'),
				comp('Rx', 'resistor', 4, 4, 90, '100'),
				comp('R2', 'resistor', 6, 2, 0, '10'),
				comp('R3', 'resistor', 8, 4, 90, '10'),
				comp('G1', 'ground', 0, 6, 0, '0')
			],
			wires: [wire('w_gnd', [0, 6], [8, 6])]
		};

		const byNodeV = solveUnknownParameter(doc, {
			componentId: 'Rx',
			symbol: 'Rx',
			constraint: { kind: 'node_voltage', targetId: 'C', value: '5' }
		});
		expect(byNodeV.valid).toBe(true);
		expect(byNodeV.solutions).toHaveLength(1);
		expect(byNodeV.solutions[0].value.re).toBeCloseTo(20, 10);
		expect(byNodeV.solutions[0].discrepancy).toBeLessThan(1e-10);
		expect(byNodeV.solutions[0].verified).toBe(true);

		const byBranchI = solveUnknownParameter(doc, {
			componentId: 'Rx',
			symbol: 'Rx',
			constraint: { kind: 'branch_current', targetId: 'R3', value: '0.5' }
		});
		expect(byBranchI.valid).toBe(true);
		expect(byBranchI.solutions).toHaveLength(1);
		expect(byBranchI.solutions[0].value.re).toBeCloseTo(20, 10);
		expect(byBranchI.solutions[0].discrepancy).toBeLessThan(1e-10);
		expect(byBranchI.solutions[0].verified).toBe(true);
	});

	it('5. DC unknown resistor given branch power: returns BOTH positive roots and rejects P > P_max', () => {
		// V1 = 12 V, R1 = 4 Ω, Rx = ? => P_max = 144 / 16 = 9 W at Rx = 4 Ω
		// For P(Rx) = 8 W => Rx^2 - 10 Rx + 16 = 0 => Rx = 2 Ω and Rx = 8 Ω
		const doc: CircuitDocument = {
			schemaVersion: 1,
			mode: 'dc',
			frequencyHz: 60,
			components: [
				comp('V1', 'voltage_source', 0, 4, 90, '12'),
				comp('R1', 'resistor', 2, 2, 0, '4'),
				comp('Rx', 'resistor', 4, 4, 90, '10'),
				comp('G1', 'ground', 0, 6, 0, '0')
			],
			wires: [wire('w_gnd', [0, 6], [4, 6])]
		};

		const twoRoots = solveUnknownParameter(doc, {
			componentId: 'Rx',
			symbol: 'R_L',
			constraint: { kind: 'branch_power', targetId: 'Rx', value: '8' }
		});
		expect(twoRoots.valid).toBe(true);
		expect(twoRoots.solutions).toHaveLength(2);
		expect(twoRoots.solutions[0].value.re).toBeCloseTo(2, 10);
		expect(twoRoots.solutions[1].value.re).toBeCloseTo(8, 10);
		expect(twoRoots.solutions[0].discrepancy).toBeLessThan(1e-10);
		expect(twoRoots.solutions[1].discrepancy).toBeLessThan(1e-10);
		expect(twoRoots.solutions[0].verified).toBe(true);
		expect(twoRoots.solutions[1].verified).toBe(true);

		// Target exceeding P_max = 9 W
		const overMax = solveUnknownParameter(doc, {
			componentId: 'Rx',
			symbol: 'R_L',
			constraint: { kind: 'branch_power', targetId: 'Rx', value: '10' }
		});
		expect(overMax.valid).toBe(false);
		expect(overMax.error).toMatch(/P_max|maximum transferable power/i);

		// Power on ANOTHER branch R1: P_R1 = 16 W => (4 + Rx)^2 = 36 => Rx = 2 Ω
		const otherBranch = solveUnknownParameter(doc, {
			componentId: 'Rx',
			symbol: 'R_L',
			constraint: { kind: 'branch_power', targetId: 'R1', value: '16' }
		});
		expect(otherBranch.valid).toBe(true);
		expect(otherBranch.solutions).toHaveLength(1);
		expect(otherBranch.solutions[0].value.re).toBeCloseTo(2, 10);
		expect(otherBranch.solutions[0].discrepancy).toBeLessThan(1e-10);
	});

	it('6. DC unknown voltage source given branch power (quadratic roots)', () => {
		// V1 (A->0), R1 = 2 (A->B), R2 = 2 (B->0), I1 = 1 A (0->B)
		// V_B = 0.5*V1 + 1; P_R2 = V_B^2 / 2 = 8 W => V_B = ±4 V => V1 = 6 V or -10 V
		const doc: CircuitDocument = {
			schemaVersion: 1,
			mode: 'dc',
			frequencyHz: 60,
			components: [
				comp('V1', 'voltage_source', 0, 4, 90, '1'),
				comp('R1', 'resistor', 2, 2, 0, '2'),
				comp('R2', 'resistor', 4, 4, 90, '2'),
				comp('I1', 'current_source', 8, 4, 270, '1'),
				comp('G1', 'ground', 0, 6, 0, '0')
			],
			wires: [wire('w_top', [4, 2], [8, 2]), wire('w_gnd', [0, 6], [8, 6])]
		};

		const res = solveUnknownParameter(doc, {
			componentId: 'V1',
			symbol: 'V',
			constraint: { kind: 'branch_power', targetId: 'R2', value: '8' }
		});

		expect(res.valid).toBe(true);
		expect(res.solutions).toHaveLength(2);
		expect(res.solutions[0].value.re).toBeCloseTo(6, 10);
		expect(res.solutions[1].value.re).toBeCloseTo(-10, 10);
		expect(res.solutions.every((s) => s.verified && s.discrepancy < 1e-10)).toBe(true);
	});

	it('7. AC unknown phasor voltage source given complex branch current', () => {
		// omega = 1000 rad/s; R1 = 30 Ω, L1 = 40 mH => Z = 30 + j40 Ω
		// Target I_R1 = 2∠0° A => Vs = 60 + j80 V = 100∠53.1301° V
		const doc: CircuitDocument = {
			schemaVersion: 1,
			mode: 'ac',
			frequencyHz: OMEGA_1000_HZ,
			acMagnitudeMode: 'rms',
			components: [
				comp('V1', 'voltage_source', 0, 4, 90, '10∠15°', { phaseDeg: 15 }),
				comp('R1', 'resistor', 2, 2, 0, '30'),
				comp('L1', 'inductor', 4, 4, 90, '40m'),
				comp('G1', 'ground', 0, 6, 0, '0')
			],
			wires: [wire('w_gnd', [0, 6], [4, 6])]
		};

		const res = solveUnknownParameter(doc, {
			componentId: 'V1',
			symbol: 'Vs',
			constraint: { kind: 'branch_current', targetId: 'R1', value: '2∠0°' }
		});

		expect(res.valid).toBe(true);
		expect(res.solutions).toHaveLength(1);
		const expected = Complex.from(60, 80);
		expect(res.solutions[0].value.sub(expected).abs()).toBeLessThan(1e-9);
		expect(res.solutions[0].discrepancy).toBeLessThan(1e-10);
		expect(res.solutions[0].verified).toBe(true);
	});

	it('8. AC unknown inductor L and unknown capacitor C given target node voltage', () => {
		// Series V1 = 10∠0° V, R1 = 100 Ω, L1 = ? at omega = 1000 rad/s
		// Target V(B) = 5+j5 V => Z_L = j100 Ω => L = 100 mH
		const docL: CircuitDocument = {
			schemaVersion: 1,
			mode: 'ac',
			frequencyHz: OMEGA_1000_HZ,
			acMagnitudeMode: 'rms',
			components: [
				comp('V1', 'voltage_source', 0, 4, 90, '10∠0°'),
				comp('R1', 'resistor', 2, 2, 0, '100'),
				comp('L1', 'inductor', 4, 4, 90, '1m'),
				comp('G1', 'ground', 0, 6, 0, '0')
			],
			wires: [wire('w_gnd', [0, 6], [4, 6])]
		};

		const resL = solveUnknownParameter(docL, {
			componentId: 'L1',
			symbol: 'Lx',
			constraint: { kind: 'node_voltage', targetId: 'B', value: '5+j5' }
		});

		expect(resL.valid).toBe(true);
		expect(resL.solutions).toHaveLength(1);
		expect(resL.solutions[0].value.re).toBeCloseTo(0.1, 10);
		expect(resL.solutions[0].discrepancy).toBeLessThan(1e-10);
		expect(resL.solutions[0].verified).toBe(true);

		// Series V1 = 10∠0° V, R1 = 100 Ω, C1 = ? at omega = 1000 rad/s
		// Target V(B) = 5-j5 V => Z_C = -j100 Ω => C = 10 µF
		const docC: CircuitDocument = {
			schemaVersion: 1,
			mode: 'ac',
			frequencyHz: OMEGA_1000_HZ,
			acMagnitudeMode: 'rms',
			components: [
				comp('V1', 'voltage_source', 0, 4, 90, '10∠0°'),
				comp('R1', 'resistor', 2, 2, 0, '100'),
				comp('C1', 'capacitor', 4, 4, 90, '1u'),
				comp('G1', 'ground', 0, 6, 0, '0')
			],
			wires: [wire('w_gnd', [0, 6], [4, 6])]
		};

		const resC = solveUnknownParameter(docC, {
			componentId: 'C1',
			symbol: 'Cx',
			constraint: { kind: 'node_voltage', targetId: 'B', value: '5-j5' }
		});

		expect(resC.valid).toBe(true);
		expect(resC.solutions).toHaveLength(1);
		expect(resC.solutions[0].value.re).toBeCloseTo(1e-5, 12);
		expect(resC.solutions[0].discrepancy).toBeLessThan(1e-10);
		expect(resC.solutions[0].verified).toBe(true);
	});

	it('9. Zero-sensitivity, DC reactive, and unphysical targets return clear valid: false errors', () => {
		// Two decoupled sub-branches sharing GND: V1 drives R1, V2 drives R2
		const docDecoupled: CircuitDocument = {
			schemaVersion: 1,
			mode: 'dc',
			frequencyHz: 60,
			components: [
				comp('V1', 'voltage_source', 0, 4, 90, '10'),
				comp('R1', 'resistor', 4, 4, 90, '1k'),
				comp('V2', 'voltage_source', 10, 4, 90, '5'),
				comp('R2', 'resistor', 14, 4, 90, '1k'),
				comp('G1', 'ground', 0, 6, 0, '0')
			],
			wires: [
				wire('w1', [0, 2], [4, 2]),
				wire('w2', [10, 2], [14, 2]),
				wire('w_gnd', [0, 6], [14, 6])
			]
		};

		const zeroSens = solveUnknownParameter(docDecoupled, {
			componentId: 'V1',
			constraint: { kind: 'branch_current', targetId: 'R2', value: '10m' }
		});
		expect(zeroSens.valid).toBe(false);
		expect(zeroSens.error).toMatch(/independent|sensitivity k = 0/i);

		// Unphysical resistor target: V_B = 15 V > 12 V supply
		const divider: CircuitDocument = {
			schemaVersion: 1,
			mode: 'dc',
			frequencyHz: 60,
			components: [
				comp('V1', 'voltage_source', 0, 4, 90, '12'),
				comp('R1', 'resistor', 2, 2, 0, '2k'),
				comp('R2', 'resistor', 4, 4, 90, '4k'),
				comp('G1', 'ground', 0, 6, 0, '0')
			],
			wires: [wire('w_gnd', [0, 6], [4, 6])]
		};
		const negRes = solveUnknownParameter(divider, {
			componentId: 'R2',
			constraint: { kind: 'node_voltage', targetId: 'B', value: '15' }
		});
		expect(negRes.valid).toBe(false);
		expect(negRes.error).toMatch(/non-positive|physical/i);

		// Unknown capacitor in DC mode
		const dcCap: CircuitDocument = {
			schemaVersion: 1,
			mode: 'dc',
			frequencyHz: 60,
			components: [
				comp('V1', 'voltage_source', 0, 4, 90, '12'),
				comp('R1', 'resistor', 2, 2, 0, '1k'),
				comp('C1', 'capacitor', 4, 4, 90, '10u'),
				comp('G1', 'ground', 0, 6, 0, '0')
			],
			wires: [wire('w_gnd', [0, 6], [4, 6])]
		};
		const dcCapRes = solveUnknownParameter(dcCap, {
			componentId: 'C1',
			constraint: { kind: 'node_voltage', targetId: 'B', value: '6' }
		});
		expect(dcCapRes.valid).toBe(false);
		expect(dcCapRes.error).toMatch(/DC steady-state|AC mode/i);
	});

	it('10. Full solveCircuit() integration & JSON round-trip preserves unknownProblem and verifies all methods', () => {
		const doc: CircuitDocument = {
			schemaVersion: 1,
			name: 'Inverse Divider Verification',
			mode: 'dc',
			frequencyHz: 60,
			components: [
				comp('V1', 'voltage_source', 0, 4, 90, '10'),
				comp('R1', 'resistor', 2, 2, 0, '6k'),
				comp('R2', 'resistor', 4, 4, 90, '6k'),
				comp('R3', 'resistor', 8, 4, 90, '6k'),
				comp('G1', 'ground', 0, 6, 0, '0')
			],
			wires: [wire('w_top', [4, 2], [8, 2]), wire('w_gnd', [0, 6], [8, 6])],
			unknownProblem: {
				componentId: 'V1',
				symbol: 'V',
				constraint: { kind: 'branch_current', targetId: 'R3', value: '2m', label: 'I_x' }
			}
		};

		const full = solveCircuit(doc);
		expect(full.unknownSolution?.valid).toBe(true);
		expect(full.unknownSolution?.solutions[0].value.re).toBeCloseTo(36, 10);
		expect(full.mna.valid).toBe(true);
		expect(full.mna.branches['V1'].voltage.re).toBeCloseTo(36, 10);
		expect(full.mna.branches['R3'].current.re).toBeCloseTo(0.002, 10);
		expect(full.mna.powerBalance.balanced).toBe(true);
		expect(full.allVerified).toBe(true);
		expect(full.maxDiscrepancy).toBeLessThan(1e-8);

		// JSON round-trip preserves unknownProblem cleanly
		const json = exportCircuitJson(doc);
		const reimported = parseCircuitImport(json);
		expect(reimported.ok).toBe(true);
		if (reimported.ok) {
			expect(reimported.document.unknownProblem).toEqual(doc.unknownProblem);
		}
	});

	it('11. Multi-term helpers: getUnknownTerms, formatUnknownTermExpr/Latex, parseAlgebraicUnknownValue', () => {
		expect(
			getUnknownTerms({
				componentId: 'V1',
				constraint: { kind: 'branch_current', targetId: 'R1', value: '1m' }
			})
		).toEqual([{ componentId: 'V1', multiplier: 1 }]);

		expect(
			getUnknownTerms({
				componentId: 'V1',
				terms: [
					{ componentId: 'V1', multiplier: 1 },
					{ componentId: 'V2', multiplier: 2 },
					{ componentId: 'V2', multiplier: 5 }, // duplicate ignored
					{ componentId: 'V3', multiplier: 0 } // zero ignored
				],
				constraint: { kind: 'branch_current', targetId: 'R1', value: '1m' }
			})
		).toEqual([
			{ componentId: 'V1', multiplier: 1 },
			{ componentId: 'V2', multiplier: 2 }
		]);

		expect(formatUnknownTermExpr(1, 'V')).toBe('V');
		expect(formatUnknownTermExpr(-1, 'V')).toBe('-V');
		expect(formatUnknownTermExpr(2, 'V')).toBe('2V');
		expect(formatUnknownTermExpr(0.5, 'V')).toBe('0.5V');
		expect(formatUnknownTermExpr(2.000000001, 'V')).toBe('2V');
		expect(formatUnknownTermLatex(2, 'V_s')).toBe('2V_s');
		expect(formatUnknownTermLatex(-1, 'V_s')).toBe('-V_s');

		expect(parseAlgebraicUnknownValue('V')).toEqual({ multiplier: 1, symbol: 'V' });
		expect(parseAlgebraicUnknownValue('2V')).toEqual({ multiplier: 2, symbol: 'V' });
		expect(parseAlgebraicUnknownValue('2*V')).toEqual({ multiplier: 2, symbol: 'V' });
		expect(parseAlgebraicUnknownValue('2 V')).toEqual({ multiplier: 2, symbol: 'V' });
		expect(parseAlgebraicUnknownValue('-V')).toEqual({ multiplier: -1, symbol: 'V' });
		expect(parseAlgebraicUnknownValue('-0.5V')).toEqual({ multiplier: -0.5, symbol: 'V' });
		expect(parseAlgebraicUnknownValue('3.5R_x')).toEqual({ multiplier: 3.5, symbol: 'R_x' });
		expect(parseAlgebraicUnknownValue('1/2 V')).toEqual({ multiplier: 0.5, symbol: 'V' });
		expect(parseAlgebraicUnknownValue('2V', 'V')).toEqual({ multiplier: 2, symbol: 'V' });

		// Reject engineering numbers, SI suffixes, phasors, and placeholders
		expect(parseAlgebraicUnknownValue('10k')).toBeNull();
		expect(parseAlgebraicUnknownValue('2m')).toBeNull();
		expect(parseAlgebraicUnknownValue('4.7u')).toBeNull();
		expect(parseAlgebraicUnknownValue('100')).toBeNull();
		expect(parseAlgebraicUnknownValue('1e-3')).toBeNull();
		expect(parseAlgebraicUnknownValue('120∠30°')).toBeNull();
		expect(parseAlgebraicUnknownValue('?')).toBeNull();
		expect(parseAlgebraicUnknownValue('2mA')).toBeNull();
		expect(parseAlgebraicUnknownValue('10kΩ')).toBeNull();
		expect(parseAlgebraicUnknownValue('4.7uF')).toBeNull();
		expect(parseAlgebraicUnknownValue('0V')).toBeNull();
	});

	it('12. Multi-source DC: V1 = V and V2 = 2V given branch current I(R2) solves exact V and verifies all methods', () => {
		// V1 (A -> 0) = V, R1 = 2k (A -> B), R2 = 4k (B -> 0), R3 = 2k (B -> C), V2 (C -> 0) = 2V
		// KCL at B: (V_B - V)/2k + V_B/4k + (V_B - 2V)/2k = 0
		// Multiply by 4k: 2(V_B - V) + V_B + 2(V_B - 2V) = 0 => 5 V_B = 6 V => V_B = 1.2 V
		// I(R2) = V_B / 4k = 1.2 V / 4k = 0.3e-3 * V.
		// Target I(R2) = 3mA => V = 10 V, V1 = 10 V, V2 = 20 V, V_B = 12 V.
		const doc: CircuitDocument = {
			schemaVersion: 1,
			name: 'Coupled Sources V and 2V',
			mode: 'dc',
			frequencyHz: 60,
			components: [
				comp('V1', 'voltage_source', 0, 4, 90, '1'),
				comp('R1', 'resistor', 2, 2, 0, '2k'),
				comp('R2', 'resistor', 4, 4, 90, '4k'),
				comp('R3', 'resistor', 6, 2, 0, '2k'),
				comp('V2', 'voltage_source', 8, 4, 90, '1'),
				comp('G1', 'ground', 0, 6, 0, '0')
			],
			wires: [wire('w_gnd', [0, 6], [8, 6])],
			unknownProblem: {
				componentId: 'V1',
				symbol: 'V',
				terms: [
					{ componentId: 'V1', multiplier: 1 },
					{ componentId: 'V2', multiplier: 2 }
				],
				constraint: { kind: 'branch_current', targetId: 'R2', value: '3m', label: 'I_o' }
			}
		};

		const full = solveCircuit(doc);
		expect(full.unknownSolution?.valid).toBe(true);
		expect(full.unknownSolution?.solutions).toHaveLength(1);
		const sol0 = full.unknownSolution!.solutions[0];
		expect(sol0.value.re).toBeCloseTo(10, 10);
		expect(sol0.discrepancy).toBeLessThan(1e-10);
		expect(sol0.verified).toBe(true);
		expect(sol0.termValues).toHaveLength(2);
		expect(sol0.termValues![0].value.re).toBeCloseTo(10, 10);
		expect(sol0.termValues![1].value.re).toBeCloseTo(20, 10);
		expect(full.mna.valid).toBe(true);
		expect(full.mna.branches['V1'].voltage.re).toBeCloseTo(10, 10);
		expect(full.mna.branches['V2'].voltage.re).toBeCloseTo(20, 10);
		expect(full.mna.branches['R2'].current.re).toBeCloseTo(0.003, 10);
		expect(full.mna.powerBalance.balanced).toBe(true);
		expect(full.allVerified).toBe(true);
		expect(full.maxDiscrepancy).toBeLessThan(1e-8);
	});

	it('13. Multi-source DC with negative multiplier: V1 = V and V2 = -0.5V', () => {
		// KCL at B: 2(V_B - V) + V_B + 2(V_B - (-0.5V)) = 0 => 5 V_B = V => V_B = 0.2 V
		// Target V_B = 4 V => V = 20 V, V1 = 20 V, V2 = -10 V.
		const doc: CircuitDocument = {
			schemaVersion: 1,
			mode: 'dc',
			frequencyHz: 60,
			components: [
				comp('V1', 'voltage_source', 0, 4, 90, '1'),
				comp('R1', 'resistor', 2, 2, 0, '2k'),
				comp('R2', 'resistor', 4, 4, 90, '4k'),
				comp('R3', 'resistor', 6, 2, 0, '2k'),
				comp('V2', 'voltage_source', 8, 4, 90, '1'),
				comp('G1', 'ground', 0, 6, 0, '0')
			],
			wires: [wire('w_gnd', [0, 6], [8, 6])]
		};

		const res = solveUnknownParameter(doc, {
			componentId: 'V1',
			symbol: 'V',
			terms: [
				{ componentId: 'V1', multiplier: 1 },
				{ componentId: 'V2', multiplier: -0.5 }
			],
			constraint: { kind: 'branch_voltage', targetId: 'R2', value: '4' }
		});

		expect(res.valid).toBe(true);
		expect(res.solutions[0].value.re).toBeCloseTo(20, 10);
		expect(res.solutions[0].termValues?.[1].value.re).toBeCloseTo(-10, 10);
		expect(res.solutions[0].verified).toBe(true);
		expect(res.solutions[0].discrepancy).toBeLessThan(1e-10);
	});

	it('14. Multi-source DC current sources: I1 = I and I2 = 3I', () => {
		// I1 (0 -> A) = I, I2 (0 -> A) = 3I, R1 = 1k (A -> 0)
		// Total current through R1 = 4I => V(R1) = 4k * I. Target V(R1) = 8 V => I = 2 mA, I1 = 2 mA, I2 = 6 mA.
		const doc: CircuitDocument = {
			schemaVersion: 1,
			mode: 'dc',
			frequencyHz: 60,
			components: [
				comp('I1', 'current_source', 0, 4, 270, '1m'),
				comp('R1', 'resistor', 4, 4, 90, '1k'),
				comp('I2', 'current_source', 8, 4, 270, '1m'),
				comp('G1', 'ground', 0, 6, 0, '0')
			],
			wires: [wire('w_top', [0, 2], [8, 2]), wire('w_gnd', [0, 6], [8, 6])]
		};

		const res = solveUnknownParameter(doc, {
			componentId: 'I1',
			symbol: 'I',
			terms: [
				{ componentId: 'I1', multiplier: 1 },
				{ componentId: 'I2', multiplier: 3 }
			],
			constraint: { kind: 'branch_voltage', targetId: 'R1', value: '8' }
		});

		expect(res.valid).toBe(true);
		expect(res.solutions[0].value.re).toBeCloseTo(0.002, 10);
		expect(res.solutions[0].termValues?.[0].value.re).toBeCloseTo(0.002, 10);
		expect(res.solutions[0].termValues?.[1].value.re).toBeCloseTo(0.006, 10);
		expect(res.solutions[0].verified).toBe(true);
	});

	it('15. AC phasor multi-source: V1 = V and V2 = 2V solves exact complex phasor', () => {
		// V1 (A -> 0) = V, R1 = 100 (A -> B), C1 = 10u (B -> 0) at ω = 1000 => Z_C = -j100
		// R2 = 100 (B -> C), V2 (C -> 0) = 2V
		// KCL at B: (V_B - V)/100 + V_B/(-j100) + (V_B - 2V)/100 = 0
		// => (2 + j) V_B = 3V => V_B = 3V / (2 + j).
		// Choose V_target = 10∠30° => V_B = 3*(10∠30°)/(2+j). Setting V_B_target = that yields exact V = 10∠30°!
		const trueV = Complex.fromPolar(10, 30);
		const targetVn2 = trueV.scale(3).div(Complex.from(2, 1));
		const doc: CircuitDocument = {
			schemaVersion: 1,
			mode: 'ac',
			frequencyHz: OMEGA_1000_HZ,
			acMagnitudeMode: 'rms',
			components: [
				comp('V1', 'voltage_source', 0, 4, 90, '1'),
				comp('R1', 'resistor', 2, 2, 0, '100'),
				comp('C1', 'capacitor', 4, 4, 90, '10u'),
				comp('R2', 'resistor', 6, 2, 0, '100'),
				comp('V2', 'voltage_source', 8, 4, 90, '1'),
				comp('G1', 'ground', 0, 6, 0, '0')
			],
			wires: [wire('w_gnd', [0, 6], [8, 6])]
		};

		const res = solveUnknownParameter(doc, {
			componentId: 'V1',
			symbol: 'V',
			terms: [
				{ componentId: 'V1', multiplier: 1 },
				{ componentId: 'V2', multiplier: 2 }
			],
			constraint: {
				kind: 'branch_voltage',
				targetId: 'C1',
				value: `${targetVn2.abs()}∠${targetVn2.argDeg()}°`
			}
		});

		expect(res.valid).toBe(true);
		expect(res.solutions[0].value.re).toBeCloseTo(trueV.re, 8);
		expect(res.solutions[0].value.im).toBeCloseTo(trueV.im, 8);
		expect(res.solutions[0].termValues?.[1].value.re).toBeCloseTo(2 * trueV.re, 8);
		expect(res.solutions[0].termValues?.[1].value.im).toBeCloseTo(2 * trueV.im, 8);
		expect(res.solutions[0].verified).toBe(true);
		expect(res.solutions[0].discrepancy).toBeLessThan(1e-8);
	});

	it('16. Multi-source DC quadratic branch_power target: V1 = V and V2 = 2V yields both exact roots', () => {
		// Same network as test 12: V_R2 = 1.2 * V, R2 = 4k => P(R2) = (1.2 V)^2 / 4000 = 0.00036 * V^2.
		// Target P(R2) = 36mW => V^2 = 100 => V = +10 V and V = -10 V!
		const doc: CircuitDocument = {
			schemaVersion: 1,
			mode: 'dc',
			frequencyHz: 60,
			components: [
				comp('V1', 'voltage_source', 0, 4, 90, '1'),
				comp('R1', 'resistor', 2, 2, 0, '2k'),
				comp('R2', 'resistor', 4, 4, 90, '4k'),
				comp('R3', 'resistor', 6, 2, 0, '2k'),
				comp('V2', 'voltage_source', 8, 4, 90, '1'),
				comp('G1', 'ground', 0, 6, 0, '0')
			],
			wires: [wire('w_gnd', [0, 6], [8, 6])]
		};

		const res = solveUnknownParameter(doc, {
			componentId: 'V1',
			symbol: 'V',
			terms: [
				{ componentId: 'V1', multiplier: 1 },
				{ componentId: 'V2', multiplier: 2 }
			],
			constraint: { kind: 'branch_power', targetId: 'R2', value: '36m' }
		});

		expect(res.valid).toBe(true);
		expect(res.solutions).toHaveLength(2);
		expect(res.solutions[0].value.re).toBeCloseTo(10, 9);
		expect(res.solutions[1].value.re).toBeCloseTo(-10, 9);
		expect(res.solutions[0].verified).toBe(true);
		expect(res.solutions[1].verified).toBe(true);
		expect(res.solutions[0].termValues?.[1].value.re).toBeCloseTo(20, 9);
		expect(res.solutions[1].termValues?.[1].value.re).toBeCloseTo(-20, 9);
	});

	it('17. Multi-term scaled passives: R1 = R and R2 = 2R solved to < 1e-8 via coupled parametric solver', () => {
		// V1 = 12 V (A -> 0), R1 = R (A -> B), R2 = 2R (B -> 0), R3 = 3k (B -> 0)
		// R_eq = R + (2R || 3k).
		// When R = 1.5k (1500 Ω): R1 = 1.5k, R2 = 3k, R2 || R3 = 1.5k => V(B) = 12 * 1.5k / (1.5k + 1.5k) = 6 V!
		// And I(R1) = 12 / 3k = 4 mA!
		const doc: CircuitDocument = {
			schemaVersion: 1,
			mode: 'dc',
			frequencyHz: 60,
			components: [
				comp('V1', 'voltage_source', 0, 4, 90, '12'),
				comp('R1', 'resistor', 2, 2, 0, '1k'),
				comp('R2', 'resistor', 4, 4, 90, '1k'),
				comp('R3', 'resistor', 8, 4, 90, '3k'),
				comp('G1', 'ground', 0, 6, 0, '0')
			],
			wires: [wire('w_top', [4, 2], [8, 2]), wire('w_gnd', [0, 6], [8, 6])],
			unknownProblem: {
				componentId: 'R1',
				symbol: 'R',
				terms: [
					{ componentId: 'R1', multiplier: 1 },
					{ componentId: 'R2', multiplier: 2 }
				],
				constraint: { kind: 'branch_voltage', targetId: 'R3', value: '6' }
			}
		};

		const full = solveCircuit(doc);
		expect(full.unknownSolution?.valid).toBe(true);
		expect(full.unknownSolution?.solutions).toHaveLength(1);
		const sol0 = full.unknownSolution!.solutions[0];
		expect(sol0.value.re).toBeCloseTo(1500, 6);
		expect(sol0.termValues?.[0].value.re).toBeCloseTo(1500, 6);
		expect(sol0.termValues?.[1].value.re).toBeCloseTo(3000, 6);
		expect(sol0.discrepancy).toBeLessThan(1e-8);
		expect(sol0.verified).toBe(true);
		expect(full.mna.valid).toBe(true);
		expect(full.mna.branches['R3'].voltage.re).toBeCloseTo(6, 8);
		expect(full.mna.powerBalance.balanced).toBe(true);
		expect(full.allVerified).toBe(true);
		expect(full.maxDiscrepancy).toBeLessThan(1e-8);
	});

	it('18. Rejects incompatible mixed source + passive terms and non-positive passive multipliers cleanly', () => {
		const doc: CircuitDocument = {
			schemaVersion: 1,
			mode: 'dc',
			frequencyHz: 60,
			components: [
				comp('V1', 'voltage_source', 0, 4, 90, '12'),
				comp('R1', 'resistor', 2, 2, 0, '2k'),
				comp('R2', 'resistor', 4, 4, 90, '4k'),
				comp('G1', 'ground', 0, 6, 0, '0')
			],
			wires: [wire('w_gnd', [0, 6], [4, 6])]
		};

		const mixedRes = solveUnknownParameter(doc, {
			componentId: 'V1',
			symbol: 'X',
			terms: [
				{ componentId: 'V1', multiplier: 1 },
				{ componentId: 'R1', multiplier: 2 }
			],
			constraint: { kind: 'branch_current', targetId: 'R2', value: '2m' }
		});
		expect(mixedRes.valid).toBe(false);
		expect(mixedRes.error).toMatch(/mix independent sources and passive/i);

		const negPassiveRes = solveUnknownParameter(doc, {
			componentId: 'R1',
			symbol: 'R',
			terms: [
				{ componentId: 'R1', multiplier: 1 },
				{ componentId: 'R2', multiplier: -2 }
			],
			constraint: { kind: 'branch_current', targetId: 'R2', value: '2m' }
		});
		expect(negPassiveRes.valid).toBe(false);
		expect(negPassiveRes.error).toMatch(/strictly positive/i);
	});

	it('19. Solves unknown Vs and unknown impedance-mode L/C in AC impedance supernode circuit', () => {
		const supernodeBase: CircuitDocument = {
			schemaVersion: 1,
			mode: 'ac',
			frequencyHz: 60,
			acMagnitudeMode: 'rms',
			components: [
				comp('R1', 'resistor', 4, 8, 90, '1', { unit: 'Ω' }),
				comp('C1', 'capacitor', 8, 4, 0, '-j1', { valueMode: 'impedance', unit: 'Ω' }),
				comp('R2', 'resistor', 12, 8, 90, '2', { unit: 'Ω' }),
				comp('Vs', 'voltage_source', 16, 4, 180, '10∠0°', { unit: 'V' }),
				comp('C2', 'capacitor', 20, 8, 90, '-j1', { valueMode: 'impedance', unit: 'Ω' }),
				comp('L1', 'inductor', 24, 4, 0, 'j1', { valueMode: 'impedance', unit: 'Ω' }),
				comp('R3', 'resistor', 28, 8, 90, '2', { unit: 'Ω' }),
				comp('G1', 'ground', 4, 10, 0, '0')
			],
			wires: [
				wire('w1', [4, 6], [4, 4], [6, 4]),
				wire('w2', [10, 4], [14, 4]),
				wire('w3', [12, 4], [12, 6]),
				wire('w4', [18, 4], [22, 4]),
				wire('w5', [20, 4], [20, 6]),
				wire('w6', [26, 4], [28, 4], [28, 6]),
				wire('w7', [4, 10], [28, 10])
			]
		};

		const baseline = solveCircuit(supernodeBase);
		expect(baseline.mna.valid).toBe(true);
		const vN2 = baseline.mna.nodeVoltages['B'].voltage;
		const vN2Str = `${vN2.re}${vN2.im >= 0 ? '+j' : '-j'}${Math.abs(vN2.im)}`;

		// 19a: Solve for unknown floating source Vs given V(B) -> exact 10∠0° V
		const vsSolved = solveCircuit({
			...supernodeBase,
			unknownProblem: {
				componentId: 'Vs',
				symbol: 'Vs',
				constraint: { kind: 'node_voltage', targetId: 'B', value: vN2Str, label: 'V_1' }
			}
		});
		expect(vsSolved.unknownSolution?.valid).toBe(true);
		expect(vsSolved.unknownSolution?.solutions[0].value.re).toBeCloseTo(10, 8);
		expect(vsSolved.unknownSolution?.solutions[0].value.im).toBeCloseTo(0, 8);
		expect(vsSolved.unknownSolution?.solutions[0].verified).toBe(true);
		expect(vsSolved.allVerified).toBe(true);
		expect(vsSolved.maxDiscrepancy).toBeLessThan(1e-8);

		// 19b: Solve for unknown impedance-mode inductor L1 -> exact j1 Ω
		const l1Solved = solveCircuit({
			...supernodeBase,
			unknownProblem: {
				componentId: 'L1',
				symbol: 'X_L',
				constraint: { kind: 'node_voltage', targetId: 'B', value: vN2Str }
			}
		});
		expect(l1Solved.unknownSolution?.valid).toBe(true);
		const l1Cand = l1Solved.unknownSolution!.solutions[0];
		expect(l1Cand.value.re).toBeCloseTo(1, 8);
		expect(l1Cand.valueString).toBe('j1');
		expect(l1Cand.termValues?.[0].unit).toBe('Ω');
		expect(l1Cand.verified).toBe(true);
		expect(l1Cand.discrepancy).toBeLessThan(1e-8);
		expect(l1Solved.allVerified).toBe(true);

		// 19c: Solve for unknown impedance-mode capacitor C2 -> exact -j1 Ω
		const c2Solved = solveCircuit({
			...supernodeBase,
			unknownProblem: {
				componentId: 'C2',
				symbol: 'X_C',
				constraint: { kind: 'node_voltage', targetId: 'B', value: vN2Str }
			}
		});
		expect(c2Solved.unknownSolution?.valid).toBe(true);
		const c2Cand = c2Solved.unknownSolution!.solutions[0];
		expect(c2Cand.value.re).toBeCloseTo(1, 8);
		expect(c2Cand.valueString).toBe('-j1');
		expect(c2Cand.termValues?.[0].unit).toBe('Ω');
		expect(c2Cand.verified).toBe(true);
		expect(c2Cand.discrepancy).toBeLessThan(1e-8);
		expect(c2Solved.allVerified).toBe(true);
	});

	it('solves unknown source Vs given ideal Voltmeter VM1 spanning two series loads R1 + R2 as a branch_voltage constraint', () => {
		// V1 = Vs across R1=1k, R2=2k, R3=3k in series.
		// VM1 spans R1 + R2: V_VM1 = Vs * (1k + 2k) / (1k + 2k + 3k) = 0.5 * Vs.
		// Target V_VM1 = 8 V => exact Vs = 16 V!
		const doc: CircuitDocument = {
			schemaVersion: 1,
			mode: 'dc',
			frequencyHz: 60,
			components: [
				comp('V1', 'voltage_source', 0, 4, 90, '1'),
				comp('R1', 'resistor', 4, 2, 0, '1k'),
				comp('R2', 'resistor', 10, 2, 0, '2k'),
				comp('R3', 'resistor', 14, 4, 90, '3k'),
				comp('G1', 'ground', 0, 6, 0, '0'),
				comp('VM1', 'voltmeter', 7, -2, 0, '0')
			],
			wires: [
				wire('w1', [0, 2], [2, 2]),
				wire('w2', [6, 2], [8, 2]),
				wire('w3', [12, 2], [14, 2]),
				wire('w4', [0, 6], [14, 6]),
				wire('w_vm_p', [5, -2], [0, -2], [0, 2]),
				wire('w_vm_n', [9, -2], [12, -2], [12, 2])
			],
			unknownProblem: {
				componentId: 'V1',
				symbol: 'Vs',
				constraint: {
					kind: 'branch_voltage',
					targetId: 'VM1',
					value: '8',
					label: 'V_VM1'
				}
			}
		};

		const full = solveCircuit(doc);
		expect(full.unknownSolution?.valid).toBe(true);
		expect(full.unknownSolution?.solutions).toHaveLength(1);
		expect(full.unknownSolution?.solutions[0].value.re).toBeCloseTo(16, 9);
		expect(full.unknownSolution?.solutions[0].verified).toBe(true);
		expect(full.mna.valid).toBe(true);
		expect(full.mna.branches['VM1'].voltage.re).toBeCloseTo(8, 9);
		expect(full.allVerified).toBe(true);
		expect(full.maxDiscrepancy).toBeLessThan(1e-8);

		// Voltmeter itself cannot be marked as an unknown parameter
		const invalidUnknown = solveUnknownParameter(doc, {
			componentId: 'VM1',
			constraint: { kind: 'branch_voltage', targetId: 'R1', value: '2' }
		});
		expect(invalidUnknown.valid).toBe(false);

		// Voltmeter cannot be used as a branch_current constraint
		const invalidKind = solveUnknownParameter(doc, {
			componentId: 'V1',
			constraint: { kind: 'branch_current', targetId: 'VM1', value: '1m' }
		});
		expect(invalidKind.valid).toBe(false);
	});
});
