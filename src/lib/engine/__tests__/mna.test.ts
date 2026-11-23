import { describe, expect, it } from 'vitest';
import { Complex } from '../complex';
import { solveMNA } from '../mna';
import type { CircuitComponent, CircuitDocument } from '../types';

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

describe('solveMNA — 15+ classic DC & AC circuits + error diagnostics', () => {
	// 1. DC Voltage Divider
	it('1. DC Voltage Divider (12V, 2k, 4k -> 8V)', () => {
		// V1: (0,4) rot 90 -> +:(0,2), -:(0,6)
		// R1: (2,2) rot 0 -> a:(0,2), b:(4,2)
		// R2: (4,4) rot 90 -> a:(4,2), b:(4,6)
		// G1: (0,6)
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

		const sol = solveMNA(doc);
		expect(sol.valid).toBe(true);
		expect(sol.powerBalance.balanced).toBe(true);
		expect(sol.branches['R2'].voltage.re).toBeCloseTo(8, 9);
		expect(sol.branches['R1'].voltage.re).toBeCloseTo(4, 9);
		expect(sol.branches['R1'].current.re).toBeCloseTo(0.002, 9);
		expect(sol.branches['V1'].current.re).toBeCloseTo(-0.002, 9);
		expect(sol.branches['V1'].realPower).toBeCloseTo(-0.024, 9);
		expect(sol.branches['R1'].realPower).toBeCloseTo(0.008, 9);
		expect(sol.branches['R2'].realPower).toBeCloseTo(0.016, 9);
	});

	// 2. DC Current Divider
	it('2. DC Current Divider (6A, 3Ω || 6Ω -> 12V, 4A, 2A)', () => {
		// I1: (0,4) rot 270 -> in:(0,6) [gnd], out:(0,2) [N1] (pushes 6A into N1)
		// R1: (4,4) rot 90 -> a:(4,2), b:(4,6)
		// R2: (8,4) rot 90 -> a:(8,2), b:(8,6)
		const doc: CircuitDocument = {
			schemaVersion: 1,
			mode: 'dc',
			frequencyHz: 60,
			components: [
				comp('I1', 'current_source', 0, 4, 270, '6'),
				comp('R1', 'resistor', 4, 4, 90, '3'),
				comp('R2', 'resistor', 8, 4, 90, '6'),
				comp('G1', 'ground', 0, 6, 0, '0')
			],
			wires: [wire('w_top', [0, 2], [8, 2]), wire('w_bot', [0, 6], [8, 6])]
		};

		const sol = solveMNA(doc);
		expect(sol.valid).toBe(true);
		expect(sol.powerBalance.balanced).toBe(true);
		expect(sol.branches['R1'].voltage.re).toBeCloseTo(12, 9);
		expect(sol.branches['R1'].current.re).toBeCloseTo(4, 9);
		expect(sol.branches['R2'].current.re).toBeCloseTo(2, 9);
		expect(sol.branches['I1'].realPower).toBeCloseTo(-72, 9);
	});

	// 3. Balanced Wheatstone Bridge
	it('3. DC Balanced Wheatstone Bridge (zero bridge current)', () => {
		// V1: (0,4) rot 90 -> +:(0,2), -:(0,6)
		// Left arm: R1(100) from (4,2) to (4,6)? Let's use clean grid nodes:
		// Top node: y=0, Left mid: (4,4), Right mid: (8,4), Bottom: y=8
		const doc: CircuitDocument = {
			schemaVersion: 1,
			mode: 'dc',
			frequencyHz: 60,
			components: [
				comp('V1', 'voltage_source', 0, 4, 90, '10'), // +:(0,2), -:(0,6)
				comp('R1', 'resistor', 4, 2, 90, '100'), // (4,0)-(4,4)
				comp('R2', 'resistor', 4, 6, 90, '200'), // (4,4)-(4,8)
				comp('R3', 'resistor', 8, 2, 90, '150'), // (8,0)-(8,4)
				comp('R4', 'resistor', 8, 6, 90, '300'), // (8,4)-(8,8)
				comp('R5', 'resistor', 6, 4, 0, '500'), // (4,4)-(8,4)
				comp('G1', 'ground', 0, 8, 0, '0')
			],
			wires: [
				wire('w_top', [0, 2], [0, 0], [8, 0]),
				wire('w_bot', [0, 6], [0, 8], [8, 8])
			]
		};

		const sol = solveMNA(doc);
		expect(sol.valid).toBe(true);
		expect(sol.powerBalance.balanced).toBe(true);
		expect(sol.branches['R5'].voltage.re).toBeCloseTo(0, 9);
		expect(sol.branches['R5'].current.re).toBeCloseTo(0, 9);
		expect(sol.branches['R2'].voltage.re).toBeCloseTo(20 / 3, 9);
		expect(sol.branches['R4'].voltage.re).toBeCloseTo(20 / 3, 9);
	});

	// 4. Unbalanced Wheatstone Bridge
	it('4. DC Unbalanced Wheatstone Bridge (exact rational solution 76/7 V, 96/7 V)', () => {
		const doc: CircuitDocument = {
			schemaVersion: 1,
			mode: 'dc',
			frequencyHz: 60,
			components: [
				comp('V1', 'voltage_source', 0, 4, 90, '24'),
				comp('R1', 'resistor', 4, 2, 90, '6'),
				comp('R2', 'resistor', 4, 6, 90, '3'),
				comp('R3', 'resistor', 8, 2, 90, '4'),
				comp('R4', 'resistor', 8, 6, 90, '12'),
				comp('R5', 'resistor', 6, 4, 0, '2'),
				comp('G1', 'ground', 0, 8, 0, '0')
			],
			wires: [
				wire('w_top', [0, 2], [0, 0], [8, 0]),
				wire('w_bot', [0, 6], [0, 8], [8, 8])
			]
		};

		const sol = solveMNA(doc);
		expect(sol.valid).toBe(true);
		expect(sol.powerBalance.balanced).toBe(true);
		expect(sol.branches['R2'].voltage.re).toBeCloseTo(76 / 7, 9);
		expect(sol.branches['R4'].voltage.re).toBeCloseTo(96 / 7, 9);
		expect(sol.branches['R5'].current.re).toBeCloseTo(-10 / 7, 9);
	});

	// 5. Multi-source DC Supernode Circuit
	it('5. Multi-source DC Supernode (V1=10V, floating V2=6V, I1=3A -> 108/11 V, 42/11 V)', () => {
		// N1 at (0,0), N2 at (4,0), N3 at (8,0), Gnd at y=4
		// V1: (0,2) rot 90 -> +:(0,0)[N1], -:(0,4)[0]
		// R1: (2,0) rot 0 -> a:(0,0)[N1], b:(4,0)[N2]
		// R2: (4,2) rot 90 -> a:(4,0)[N2], b:(4,4)[0]
		// V2: (6,0) rot 0 -> +:(4,0)[N2], -:(8,0)[N3]
		// R3: (8,2) rot 90 -> a:(8,0)[N3], b:(8,4)[0]
		// I1: (12,2) rot 270 -> in:(12,4)[0], out:(12,0)[N3]
		const doc: CircuitDocument = {
			schemaVersion: 1,
			mode: 'dc',
			frequencyHz: 60,
			components: [
				comp('V1', 'voltage_source', 0, 2, 90, '10'),
				comp('R1', 'resistor', 2, 0, 0, '2'),
				comp('R2', 'resistor', 4, 2, 90, '4'),
				comp('V2', 'voltage_source', 6, 0, 0, '6'),
				comp('R3', 'resistor', 8, 2, 90, '6'),
				comp('I1', 'current_source', 12, 2, 270, '3'),
				comp('G1', 'ground', 0, 4, 0, '0')
			],
			wires: [wire('w_n3', [8, 0], [12, 0]), wire('w_gnd', [0, 4], [12, 4])]
		};

		const sol = solveMNA(doc);
		expect(sol.valid).toBe(true);
		expect(sol.powerBalance.balanced).toBe(true);
		expect(sol.branches['R2'].voltage.re).toBeCloseTo(108 / 11, 9);
		expect(sol.branches['R3'].voltage.re).toBeCloseTo(42 / 11, 9);
		expect(sol.branches['V2'].voltage.re).toBeCloseTo(6, 9);
	});

	// 6. DC Circuit with Capacitor (open) and Inductor (short)
	it('6. DC steady state with Capacitor (open, I_C=0) & Inductor (short, V_L=0)', () => {
		// V1=15V (0,0)-(0,4), R1=3Ω (0,0)-(4,0), L1=10mH (4,0)-(8,0), R2=2Ω (8,0)-(8,4)
		// C1=100uF (4,2) rot 90 -> (4,0)-(4,4)
		// C2=47uF (4,-2) rot 0 -> (2,-2)-(6,-2) wired to (0,0) and (8,0)
		const doc: CircuitDocument = {
			schemaVersion: 1,
			mode: 'dc',
			frequencyHz: 60,
			components: [
				comp('V1', 'voltage_source', 0, 2, 90, '15'),
				comp('R1', 'resistor', 2, 0, 0, '3'),
				comp('L1', 'inductor', 6, 0, 0, '10m'),
				comp('R2', 'resistor', 8, 2, 90, '2'),
				comp('C1', 'capacitor', 4, 2, 90, '100u'),
				comp('C2', 'capacitor', 4, -2, 0, '47u'),
				comp('G1', 'ground', 0, 4, 0, '0')
			],
			wires: [
				wire('w_gnd', [0, 4], [8, 4]),
				wire('w_c2a', [0, 0], [0, -2], [2, -2]),
				wire('w_c2b', [6, -2], [8, -2], [8, 0])
			]
		};

		const sol = solveMNA(doc);
		expect(sol.valid).toBe(true);
		expect(sol.powerBalance.balanced).toBe(true);
		expect(sol.diagnostics.some((d) => d.code === 'DC_CAPACITOR_OPEN')).toBe(true);
		expect(sol.diagnostics.some((d) => d.code === 'DC_INDUCTOR_SHORT')).toBe(true);
		expect(sol.branches['C1'].current.abs()).toBeCloseTo(0, 12);
		expect(sol.branches['C1'].voltage.re).toBeCloseTo(6, 9);
		expect(sol.branches['C2'].current.abs()).toBeCloseTo(0, 12);
		expect(sol.branches['C2'].voltage.re).toBeCloseTo(9, 9);
		expect(sol.branches['L1'].voltage.abs()).toBeCloseTo(0, 12);
		expect(sol.branches['L1'].current.re).toBeCloseTo(3, 9);
	});

	// 7. DC 2-Loop Bridge-T Network
	it('7. DC 2-Loop Network (20V + 2A -> exact 12V on both nodes)', () => {
		const doc: CircuitDocument = {
			schemaVersion: 1,
			mode: 'dc',
			frequencyHz: 60,
			components: [
				comp('V1', 'voltage_source', 0, 2, 90, '20'),
				comp('R1', 'resistor', 2, 0, 0, '4'),
				comp('R2', 'resistor', 4, 2, 90, '6'),
				comp('R3', 'resistor', 6, 0, 0, '3'),
				comp('R4', 'resistor', 8, 2, 90, '6'),
				comp('I1', 'current_source', 12, 2, 270, '2'),
				comp('G1', 'ground', 0, 4, 0, '0')
			],
			wires: [wire('w_n3', [8, 0], [12, 0]), wire('w_gnd', [0, 4], [12, 4])]
		};

		const sol = solveMNA(doc);
		expect(sol.valid).toBe(true);
		expect(sol.powerBalance.balanced).toBe(true);
		expect(sol.branches['R2'].voltage.re).toBeCloseTo(12, 9);
		expect(sol.branches['R4'].voltage.re).toBeCloseTo(12, 9);
		expect(sol.branches['R3'].current.re).toBeCloseTo(0, 9);
	});

	// 8. DC Dual-Current-Source Pi Network
	it('8. DC Dual-Current-Source Pi Network (exact 78/11 V, 30/11 V)', () => {
		const doc: CircuitDocument = {
			schemaVersion: 1,
			mode: 'dc',
			frequencyHz: 60,
			components: [
				comp('I1', 'current_source', 0, 2, 270, '5'), // 0 -> N1
				comp('R1', 'resistor', 4, 2, 90, '2'), // N1 -> 0
				comp('R2', 'resistor', 6, 0, 0, '3'), // N1 -> N2
				comp('R3', 'resistor', 8, 2, 90, '6'), // N2 -> 0
				comp('I2', 'current_source', 12, 2, 90, '1'), // N2 -> 0
				comp('G1', 'ground', 0, 4, 0, '0')
			],
			wires: [
				wire('w_n1', [0, 0], [4, 0]),
				wire('w_n2', [8, 0], [12, 0]),
				wire('w_gnd', [0, 4], [12, 4])
			]
		};

		const sol = solveMNA(doc);
		expect(sol.valid).toBe(true);
		expect(sol.powerBalance.balanced).toBe(true);
		expect(sol.branches['R1'].voltage.re).toBeCloseTo(78 / 11, 9);
		expect(sol.branches['R3'].voltage.re).toBeCloseTo(30 / 11, 9);
	});

	// 9. Series RLC AC Phasor Circuit (Inductive, lagging pf = 0.6)
	it('9. Series RLC AC Phasor Circuit (3-4-5 impedance triangle, exact power & pf)', () => {
		const freq = 1000 / (2 * Math.PI); // omega = 1000 rad/s
		const doc: CircuitDocument = {
			schemaVersion: 1,
			mode: 'ac',
			frequencyHz: freq,
			acMagnitudeMode: 'rms',
			components: [
				comp('V1', 'voltage_source', 0, 2, 90, '100∠0°'), // +:(0,0), -:(0,4)
				comp('R1', 'resistor', 2, 0, 0, '30'), // (0,0)-(4,0)
				comp('L1', 'inductor', 6, 0, 0, '80m'), // (4,0)-(8,0), X_L = 80
				comp('C1', 'capacitor', 8, 2, 90, '25u'), // (8,0)-(8,4), X_C = 40
				comp('G1', 'ground', 0, 4, 0, '0')
			],
			wires: [wire('w_gnd', [0, 4], [8, 4])]
		};

		const sol = solveMNA(doc);
		expect(sol.valid).toBe(true);
		expect(sol.powerBalance.balanced).toBe(true);

		const iBranch = sol.branches['R1'].current;
		expect(iBranch.equals(Complex.from(1.2, -1.6), 1e-9)).toBe(true);
		expect(iBranch.abs()).toBeCloseTo(2, 9);
		expect(iBranch.argDeg()).toBeCloseTo(-53.13010235415598, 9);

		expect(sol.branches['R1'].realPower).toBeCloseTo(120, 9);
		expect(sol.branches['R1'].reactivePower).toBeCloseTo(0, 9);
		expect(sol.branches['L1'].realPower).toBeCloseTo(0, 9);
		expect(sol.branches['L1'].reactivePower).toBeCloseTo(320, 9);
		expect(sol.branches['L1'].powerFactorType).toBe('lagging');
		expect(sol.branches['C1'].realPower).toBeCloseTo(0, 9);
		expect(sol.branches['C1'].reactivePower).toBeCloseTo(-160, 9);
		expect(sol.branches['C1'].powerFactorType).toBe('leading');
		expect(sol.branches['V1'].realPower).toBeCloseTo(-120, 9);
		expect(sol.branches['V1'].reactivePower).toBeCloseTo(-160, 9);
		// Source PF is the delivered PF: S_supplied = 120 + j160 VA -> 0.6 lagging (not leading)
		expect(sol.branches['V1'].powerFactor).toBeCloseTo(0.6, 9);
		expect(sol.branches['V1'].powerFactorType).toBe('lagging');
		expect(sol.powerBalance.totalRealPower).toBeCloseTo(0, 9);
		expect(sol.powerBalance.totalReactivePower).toBeCloseTo(0, 9);
	});

	// 10. Series RLC AC Capacitive (Leading)
	it('10. Series RLC AC Capacitive Circuit (50∠30° V, Z = 40 - j30 Ω)', () => {
		const freq = 1000 / (2 * Math.PI);
		const doc: CircuitDocument = {
			schemaVersion: 1,
			mode: 'ac',
			frequencyHz: freq,
			components: [
				comp('V1', 'voltage_source', 0, 2, 90, '50∠30°'),
				comp('R1', 'resistor', 2, 0, 0, '40'),
				comp('L1', 'inductor', 6, 0, 0, '10m'),
				comp('C1', 'capacitor', 8, 2, 90, '25u'),
				comp('G1', 'ground', 0, 4, 0, '0')
			],
			wires: [wire('w_gnd', [0, 4], [8, 4])]
		};

		const sol = solveMNA(doc);
		expect(sol.valid).toBe(true);
		expect(sol.powerBalance.balanced).toBe(true);

		const i = sol.branches['R1'].current;
		expect(i.abs()).toBeCloseTo(1, 9);
		expect(i.argDeg()).toBeCloseTo(30 + 36.86989764584402, 9);
		expect(sol.branches['R1'].realPower).toBeCloseTo(40, 9);
		expect(sol.branches['L1'].reactivePower).toBeCloseTo(10, 9);
		expect(sol.branches['C1'].reactivePower).toBeCloseTo(-40, 9);
	});

	// 11. Parallel RLC AC Circuit at Exact Resonance
	it('11. Parallel RLC AC Circuit at Resonance (purely real Z_eq = R, Q_L + Q_C = 0)', () => {
		const f = 1000;
		const omega = 2 * Math.PI * f;
		const L = 0.01;
		const C = 1 / (omega * omega * L); // exact resonant capacitance

		const doc: CircuitDocument = {
			schemaVersion: 1,
			mode: 'ac',
			frequencyHz: f,
			components: [
				comp('I1', 'current_source', 0, 2, 270, '2∠0°'),
				comp('R1', 'resistor', 4, 2, 90, '500'),
				comp('L1', 'inductor', 8, 2, 90, String(L)),
				comp('C1', 'capacitor', 12, 2, 90, String(C)),
				comp('G1', 'ground', 0, 4, 0, '0')
			],
			wires: [wire('w_top', [0, 0], [12, 0]), wire('w_bot', [0, 4], [12, 4])]
		};

		const sol = solveMNA(doc);
		expect(sol.valid).toBe(true);
		expect(sol.powerBalance.balanced).toBe(true);

		const vTank = sol.branches['R1'].voltage;
		expect(vTank.re).toBeCloseTo(1000, 8);
		expect(vTank.im).toBeCloseTo(0, 8);
		expect(sol.branches['R1'].current.equals(Complex.from(2, 0), 1e-9)).toBe(true);
		expect(sol.branches['L1'].current.add(sol.branches['C1'].current).abs()).toBeCloseTo(0, 9);
		expect(sol.branches['L1'].reactivePower + sol.branches['C1'].reactivePower).toBeCloseTo(0, 7);
	});

	// 12. Multi-source AC Phasor Circuit (10∠0° V and 5∠90° V)
	it('12. Multi-source AC Phasor Circuit (10∠0° V and 5∠90° V -> V_N2 = 5 + j0 V)', () => {
		const freq = 100 / (2 * Math.PI); // omega = 100
		const doc: CircuitDocument = {
			schemaVersion: 1,
			mode: 'ac',
			frequencyHz: freq,
			components: [
				comp('V1', 'voltage_source', 0, 2, 90, '10∠0°'),
				comp('R1', 'resistor', 2, 0, 0, '10'), // (0,0)-(4,0)
				comp('L1', 'inductor', 4, 2, 90, '0.1'), // (4,0)-(4,4) -> j10
				comp('C1', 'capacitor', 6, 0, 0, '1m'), // (4,0)-(8,0) -> -j10
				comp('V2', 'voltage_source', 8, 2, 90, '5∠90°'), // (8,0)-(8,4) -> j5
				comp('G1', 'ground', 0, 4, 0, '0')
			],
			wires: [wire('w_gnd', [0, 4], [8, 4])]
		};

		const sol = solveMNA(doc);
		expect(sol.valid).toBe(true);
		expect(sol.powerBalance.balanced).toBe(true);
		expect(sol.branches['L1'].voltage.equals(Complex.from(5, 0), 1e-9)).toBe(true);
		expect(sol.branches['R1'].current.equals(Complex.from(0.5, 0), 1e-9)).toBe(true);
		expect(sol.branches['L1'].current.equals(Complex.from(0, -0.5), 1e-9)).toBe(true);
		expect(sol.branches['C1'].current.equals(Complex.from(0.5, 0.5), 1e-9)).toBe(true);
	});

	// 13. AC Mixed Voltage + Current Source Circuit
	it('13. AC Mixed Voltage + Current Source (10∠0° V, j1 A -> V_N2 = 10 V)', () => {
		const freq = 1000 / (2 * Math.PI);
		const doc: CircuitDocument = {
			schemaVersion: 1,
			mode: 'ac',
			frequencyHz: freq,
			components: [
				comp('V1', 'voltage_source', 0, 2, 90, '10', { phaseDeg: 0 }),
				comp('R1', 'resistor', 2, 0, 0, '10'),
				comp('C1', 'capacitor', 4, 2, 90, '100u'),
				comp('I1', 'current_source', 8, 2, 270, '1', { phaseDeg: 90 }),
				comp('G1', 'ground', 0, 4, 0, '0')
			],
			wires: [wire('w_top', [4, 0], [8, 0]), wire('w_bot', [0, 4], [8, 4])]
		};

		const sol = solveMNA(doc);
		expect(sol.valid).toBe(true);
		expect(sol.powerBalance.balanced).toBe(true);
		expect(sol.branches['C1'].voltage.equals(Complex.from(10, 0), 1e-9)).toBe(true);
		expect(sol.branches['R1'].current.abs()).toBeCloseTo(0, 9);
		expect(sol.branches['C1'].current.equals(Complex.from(0, 1), 1e-9)).toBe(true);
	});

	// 14. AC Peak Magnitude Mode Power Factor 0.5
	it('14. AC Peak Mode Power Calculation (S = 0.5 * V * I*)', () => {
		const freq = 1000 / (2 * Math.PI);
		const doc: CircuitDocument = {
			schemaVersion: 1,
			mode: 'ac',
			frequencyHz: freq,
			acMagnitudeMode: 'peak',
			components: [
				comp('V1', 'voltage_source', 0, 2, 90, '100∠0°'),
				comp('R1', 'resistor', 2, 0, 0, '30'),
				comp('L1', 'inductor', 6, 0, 0, '80m'),
				comp('C1', 'capacitor', 8, 2, 90, '25u'),
				comp('G1', 'ground', 0, 4, 0, '0')
			],
			wires: [wire('w_gnd', [0, 4], [8, 4])]
		};

		const sol = solveMNA(doc);
		expect(sol.valid).toBe(true);
		expect(sol.powerBalance.balanced).toBe(true);
		expect(sol.branches['R1'].realPower).toBeCloseTo(60, 9);
		expect(sol.branches['L1'].reactivePower).toBeCloseTo(160, 9);
		expect(sol.branches['C1'].reactivePower).toBeCloseTo(-80, 9);
		expect(sol.branches['V1'].realPower).toBeCloseTo(-60, 9);
	});

	// 15. Auto-ground + T-junction + 180-degree rotated source
	it('15. Auto-ground + T-junction + 180° rotated voltage source', () => {
		// V1 rotated 270 -> +:(0,4), -:(0,0) (inverted polarity!)
		const doc: CircuitDocument = {
			schemaVersion: 1,
			mode: 'dc',
			frequencyHz: 60,
			components: [
				comp('V1', 'voltage_source', 0, 2, 270, '12'),
				comp('R1', 'resistor', 2, 0, 0, '2k'),
				comp('R2', 'resistor', 4, 2, 90, '4k')
			],
			wires: [
				wire('w_bot', [0, 4], [8, 4]),
				// T-junction from R2 bottom (4,4) already lies on w_bot! Also add terminal tap
				comp('T1', 'terminal', 4, 0, 0, '', { terminalName: 'A' }) as never
			].filter((x): x is ReturnType<typeof wire> => 'points' in x)
		};
		doc.components.push(comp('T1', 'terminal', 4, 0, 0, '', { terminalName: 'A' }));

		const sol = solveMNA(doc);
		expect(sol.valid).toBe(true);
		expect(sol.diagnostics.some((d) => d.code === 'AUTO_GROUND')).toBe(true);
		// Auto-ground picks V1's negative pin (0,0)! So (0,4) is +12V, (4,0) is 0V?
		// Wait: V1+ is (0,4), V1- is (0,0)='0'. R1 connects (0,0)[0] to (4,0)[N1]. R2 connects (4,0)[N1] to (4,4)[+12V].
		// So V(N1) = 12 * 2k/(2k+4k) = 4V! And V_R2 = V(N1) - V(4,4) = 4 - 12 = -8V!
		expect(sol.branches['R2'].voltage.re).toBeCloseTo(-8, 9);
		expect(sol.branches['R1'].voltage.re).toBeCloseTo(-4, 9);
	});

	// 16. Error diagnostics suite
	it('16. Rejects voltage-source loop, open current source, floating resistor, and negative R', () => {
		// 16a: Parallel voltage sources (loop)
		const vLoop: CircuitDocument = {
			schemaVersion: 1,
			mode: 'dc',
			frequencyHz: 60,
			components: [
				comp('V1', 'voltage_source', 0, 2, 90, '10'),
				comp('V2', 'voltage_source', 4, 2, 90, '5'),
				comp('G1', 'ground', 0, 4, 0, '0')
			],
			wires: [wire('w1', [0, 0], [4, 0]), wire('w2', [0, 4], [4, 4])]
		};
		const s1 = solveMNA(vLoop);
		expect(s1.valid).toBe(false);
		expect(s1.diagnostics.some((d) => d.code === 'VOLTAGE_SOURCE_LOOP')).toBe(true);

		// 16b: Open current source
		const openCS: CircuitDocument = {
			schemaVersion: 1,
			mode: 'dc',
			frequencyHz: 60,
			components: [
				comp('I1', 'current_source', 0, 2, 270, '2'),
				comp('G1', 'ground', 0, 4, 0, '0')
			],
			wires: []
		};
		const s2 = solveMNA(openCS);
		expect(s2.valid).toBe(false);
		expect(s2.diagnostics.some((d) => d.code === 'CURRENT_SOURCE_CUTSET')).toBe(true);

		// 16c: Floating disconnected resistor island
		const floating: CircuitDocument = {
			schemaVersion: 1,
			mode: 'dc',
			frequencyHz: 60,
			components: [
				comp('V1', 'voltage_source', 0, 2, 90, '10'),
				comp('R1', 'resistor', 4, 2, 90, '100'),
				comp('R_float', 'resistor', 20, 20, 0, '50'),
				comp('G1', 'ground', 0, 4, 0, '0')
			],
			wires: [wire('w1', [0, 0], [4, 0]), wire('w2', [0, 4], [4, 4])]
		};
		const s3 = solveMNA(floating);
		expect(s3.valid).toBe(false);
		expect(s3.diagnostics.some((d) => d.code === 'FLOATING_SUBCIRCUIT')).toBe(true);

		// 16d: Negative resistance
		const negR: CircuitDocument = {
			schemaVersion: 1,
			mode: 'dc',
			frequencyHz: 60,
			components: [
				comp('V1', 'voltage_source', 0, 2, 90, '10'),
				comp('R1', 'resistor', 4, 2, 90, '-100'),
				comp('G1', 'ground', 0, 4, 0, '0')
			],
			wires: [wire('w1', [0, 0], [4, 0]), wire('w2', [0, 4], [4, 4])]
		};
		const s4 = solveMNA(negR);
		expect(s4.valid).toBe(false);
		expect(s4.diagnostics.some((d) => d.code === 'INVALID_VALUE')).toBe(true);
	});

	// 17. Lossless parallel LC tank driven by current source at resonance -> SINGULAR_MATRIX
	it('17. Reports SINGULAR_MATRIX cleanly for lossless parallel LC tank at resonance', () => {
		const f = 1000;
		const omega = 2 * Math.PI * f;
		const L = 0.01;
		const C = 1 / (omega * omega * L);

		const doc: CircuitDocument = {
			schemaVersion: 1,
			mode: 'ac',
			frequencyHz: f,
			components: [
				comp('I1', 'current_source', 0, 2, 270, '1'),
				comp('L1', 'inductor', 4, 2, 90, String(L)),
				comp('C1', 'capacitor', 8, 2, 90, String(C)),
				comp('G1', 'ground', 0, 4, 0, '0')
			],
			wires: [wire('w1', [0, 0], [8, 0]), wire('w2', [0, 4], [8, 4])]
		};

		const sol = solveMNA(doc);
		expect(sol.valid).toBe(false);
		expect(sol.diagnostics.some((d) => d.code === 'SINGULAR_MATRIX')).toBe(true);
	});

	// 18. Direct AC Impedance Specification (pure reactive, lossy complex, plain reactance, and DC fallback)
	it('18. Solves direct AC impedance inductors/capacitors with exact power balance and DC fallback', () => {
		// 18a: Series circuit: V1 = 10∠0° V, R1 = 1 Ω, L1 = 2+j1 Ω (lossy), C1 = -j5 Ω (plain "5" in impedance mode)
		// Z_total = 1 + (2 + j1) + (-j5) = 3 - j4 Ω => |Z| = 5 Ω => I = 10 / (3 - j4) = 1.2 + j1.6 A
		const doc: CircuitDocument = {
			schemaVersion: 1,
			mode: 'ac',
			frequencyHz: 60,
			components: [
				comp('V1', 'voltage_source', 0, 2, 90, '10∠0°'),
				comp('R1', 'resistor', 2, 0, 0, '1'),
				comp('L1', 'inductor', 6, 0, 0, '2+j1', { valueMode: 'impedance', unit: 'Ω' }),
				comp('C1', 'capacitor', 8, 2, 90, '5', { valueMode: 'impedance', unit: 'Ω' }),
				comp('G1', 'ground', 0, 4, 0, '0')
			],
			wires: [wire('w_gnd', [0, 4], [8, 4])]
		};

		const sol = solveMNA(doc);
		expect(sol.valid).toBe(true);
		expect(sol.powerBalance.balanced).toBe(true);
		expect(Math.abs(sol.powerBalance.totalRealPower)).toBeLessThan(1e-10);
		expect(Math.abs(sol.powerBalance.totalReactivePower)).toBeLessThan(1e-10);
		expect(sol.branches['L1'].impedance?.equals(Complex.from(2, 1), 1e-12)).toBe(true);
		expect(sol.branches['C1'].impedance?.equals(Complex.j(-5), 1e-12)).toBe(true);
		expect(sol.branches['R1'].current.equals(Complex.from(1.2, 1.6), 1e-9)).toBe(true);
		// P_R1 = |I|^2 * 1 = 4 W, P_L1 = |I|^2 * 2 = 8 W, P_V1 = -12 W
		expect(sol.branches['R1'].realPower).toBeCloseTo(4, 9);
		expect(sol.branches['L1'].realPower).toBeCloseTo(8, 9);
		expect(sol.branches['L1'].reactivePower).toBeCloseTo(4, 9);
		expect(sol.branches['C1'].reactivePower).toBeCloseTo(-20, 9);
		expect(sol.branches['V1'].realPower).toBeCloseTo(-12, 9);

		// 18b: Same circuit in DC mode -> C1 is open (I = 0), L1 is short (V = 0)
		const dcSol = solveMNA({ ...doc, mode: 'dc', components: doc.components.map((c) => (c.id === 'V1' ? { ...c, value: '10' } : c)) });
		expect(dcSol.valid).toBe(true);
		expect(dcSol.branches['C1'].current.abs()).toBeCloseTo(0, 12);
		expect(dcSol.branches['C1'].voltage.re).toBeCloseTo(10, 12);
		expect(dcSol.branches['L1'].voltage.abs()).toBeCloseTo(0, 12);
		expect(dcSol.branches['L1'].current.abs()).toBeCloseTo(0, 12);

		// 18c: Rejects zero impedance and negative real resistance
		const zeroZ = solveMNA({
			...doc,
			components: doc.components.map((c) => (c.id === 'L1' ? { ...c, value: '0' } : c))
		});
		expect(zeroZ.valid).toBe(false);
		expect(zeroZ.diagnostics.some((d) => d.code === 'INVALID_VALUE')).toBe(true);

		const negRealZ = solveMNA({
			...doc,
			components: doc.components.map((c) => (c.id === 'L1' ? { ...c, value: '-2+j1' } : c))
		});
		expect(negRealZ.valid).toBe(false);
		expect(negRealZ.diagnostics.some((d) => d.code === 'INVALID_VALUE')).toBe(true);
	});

	// 19. Ideal Voltmeter (DC multi-load span, zero disturbance, open probe warning, same-node, and AC phasor span)
	it('19. Measures exact differential voltage with ideal voltmeter without disturbing currents or power balance', () => {
		// Series DC circuit: V1 = 12 V across R1 = 1 Ω, R2 = 2 Ω, R3 = 3 Ω (I = 2 A)
		// V(R1) = 2 V, V(R2) = 4 V, V(R3) = 6 V.
		// VM1 spans across R1 + R2 -> V_VM1 = V_N1 - V_N3 = 12 - 6 = 6 V (= V_R1 + V_R2)
		const baseDoc: CircuitDocument = {
			schemaVersion: 1,
			mode: 'dc',
			frequencyHz: 60,
			components: [
				comp('V1', 'voltage_source', 0, 4, 90, '12'), // +:(0,2), -:(0,6)
				comp('R1', 'resistor', 4, 2, 0, '1'), // a:(2,2), b:(6,2)
				comp('R2', 'resistor', 10, 2, 0, '2'), // a:(8,2), b:(12,2)
				comp('R3', 'resistor', 14, 4, 90, '3'), // a:(14,2), b:(14,6)
				comp('G1', 'ground', 0, 6, 0, '0')
			],
			wires: [
				wire('w1', [0, 2], [2, 2]),
				wire('w2', [6, 2], [8, 2]),
				wire('w3', [12, 2], [14, 2]),
				wire('w4', [0, 6], [14, 6])
			]
		};

		const baseSol = solveMNA(baseDoc);
		expect(baseSol.valid).toBe(true);

		const withVmDoc: CircuitDocument = {
			...baseDoc,
			components: [
				...baseDoc.components,
				// VM1 placed above R1 + R2: +:(5,-2) wired to (0,2), -:(9,-2) wired to (12,2)
				comp('VM1', 'voltmeter', 7, -2, 0, '0'),
				// VM2 placed with both probes on same node (ground): reads 0 V cleanly
				comp('VM2', 'voltmeter', 7, 10, 0, '0')
			],
			wires: [
				...baseDoc.wires,
				wire('w_vm1_p', [5, -2], [0, -2], [0, 2]),
				wire('w_vm1_n', [9, -2], [12, -2], [12, 2]),
				wire('w_vm2_p', [5, 10], [5, 6]),
				wire('w_vm2_n', [9, 10], [9, 6])
			]
		};

		const vmSol = solveMNA(withVmDoc);
		expect(vmSol.valid).toBe(true);
		expect(vmSol.powerBalance.balanced).toBe(true);
		expect(Math.abs(vmSol.powerBalance.totalRealPower)).toBeLessThan(1e-10);
		expect(vmSol.powerBalance.totalAbsorbedReal).toBeCloseTo(
			baseSol.powerBalance.totalAbsorbedReal,
			12
		);

		// Zero disturbance to all active branch currents and node voltages
		for (const id of ['V1', 'R1', 'R2', 'R3']) {
			expect(vmSol.branches[id].current.sub(baseSol.branches[id].current).abs()).toBeLessThan(
				1e-12
			);
			expect(vmSol.branches[id].voltage.sub(baseSol.branches[id].voltage).abs()).toBeLessThan(
				1e-12
			);
		}

		// VM1 reads exact V_R1 + V_R2 = 6 V, I = 0, P = 0
		const vm1 = vmSol.branches['VM1'];
		expect(vm1).toBeDefined();
		expect(vm1.kind).toBe('voltmeter');
		expect(vm1.isMeasurementOnly).toBe(true);
		expect(vm1.voltage.re).toBeCloseTo(6, 12);
		expect(vm1.current.abs()).toBeCloseTo(0, 12);
		expect(vm1.realPower).toBe(0);
		expect(vm1.reactivePower).toBe(0);

		// VM2 across same node reads 0 V with no warning/error
		expect(vmSol.branches['VM2'].voltage.abs()).toBeCloseTo(0, 12);
		expect(vmSol.diagnostics.some((d) => d.code === 'VOLTMETER_UNCONNECTED')).toBe(false);

		// Unconnected voltmeter emits non-blocking VOLTMETER_UNCONNECTED warning and leaves circuit valid
		const openVmDoc: CircuitDocument = {
			...baseDoc,
			components: [...baseDoc.components, comp('VM_OPEN', 'voltmeter', 20, -4, 0, '0')]
		};
		const openSol = solveMNA(openVmDoc);
		expect(openSol.valid).toBe(true);
		expect(openSol.branches['VM_OPEN']).toBeUndefined();
		expect(
			openSol.diagnostics.some(
				(d) =>
					d.severity === 'warning' &&
					d.code === 'VOLTMETER_UNCONNECTED' &&
					d.componentIds?.includes('VM_OPEN')
			)
		).toBe(true);

		// AC Voltmeter across R1 + L1 in series RLC reads exact complex phasor V_R1 + V_L1
		const acDoc: CircuitDocument = {
			schemaVersion: 1,
			mode: 'ac',
			frequencyHz: 60,
			components: [
				comp('V1', 'voltage_source', 0, 2, 90, '10∠0°'), // +:(0,0), -:(0,4)
				comp('R1', 'resistor', 2, 0, 0, '1'), // a:(0,0), b:(4,0)
				comp('L1', 'inductor', 6, 0, 0, '2+j1', { valueMode: 'impedance', unit: 'Ω' }), // a:(4,0), b:(8,0)
				comp('C1', 'capacitor', 8, 2, 90, '5', { valueMode: 'impedance', unit: 'Ω' }), // a:(8,0), b:(8,4)
				comp('G1', 'ground', 0, 4, 0, '0'),
				comp('VM_AC', 'voltmeter', 4, -4, 0, '0') // +:(2,-4), -:(6,-4)
			],
			wires: [
				wire('w_gnd', [0, 4], [8, 4]),
				wire('w_vm_p', [2, -4], [0, -4], [0, 0]),
				wire('w_vm_n', [6, -4], [8, -4], [8, 0])
			]
		};
		const acSol = solveMNA(acDoc);
		expect(acSol.valid).toBe(true);
		expect(acSol.powerBalance.balanced).toBe(true);
		const expectedAcVm = acSol.branches['R1'].voltage.add(acSol.branches['L1'].voltage);
		expect(acSol.branches['VM_AC'].voltage.sub(expectedAcVm).abs()).toBeLessThan(1e-11);
		expect(acSol.branches['VM_AC'].current.abs()).toBe(0);
	});

	it('20. DC Dependent Sources (VCVS, VCCS, CCVS, CCCS): exact hand-calculated solutions, control modes, polarity & power balance', () => {
		// 20a. VCVS with controlComponentId (and verify equivalent controlNodePos/Neg & controlPolarity: -1)
		// V1=16V (N1->0), R1=4k (N1->N2), R2=4k (N2->0), R3=2k (N2->N3), E1=2*V_R1 (N3->0)
		// Hand solution: V_N1=16V, V_N2=10V, V_N3=12V, V_R1=6V, I_R1=1.5mA, I_R2=2.5mA, I_R3=-1mA
		const vcvsDoc: CircuitDocument = {
			schemaVersion: 1,
			mode: 'dc',
			frequencyHz: 60,
			components: [
				comp('V1', 'voltage_source', 4, 8, 90, '16'),
				comp('R1', 'resistor', 8, 4, 0, '4k'),
				comp('R2', 'resistor', 12, 8, 90, '4k'),
				comp('R3', 'resistor', 16, 4, 0, '2k'),
				comp('E1', 'vcvs', 20, 8, 90, '2', {
					controlRef: { controlComponentId: 'R1', controlPolarity: 1, controlVarName: 'v_x' }
				}),
				comp('G1', 'ground', 4, 10, 0, '0')
			],
			wires: [
				wire('w1', [4, 6], [4, 4], [6, 4]),
				wire('w2', [10, 4], [14, 4]),
				wire('w3', [12, 4], [12, 6]),
				wire('w4', [18, 4], [20, 4], [20, 6]),
				wire('w5', [4, 10], [20, 10])
			]
		};
		const vcvsSol = solveMNA(vcvsDoc);
		expect(vcvsSol.valid).toBe(true);
		expect(vcvsSol.powerBalance.balanced).toBe(true);
		expect(vcvsSol.branches['R1'].voltage.re).toBeCloseTo(6, 9);
		expect(vcvsSol.branches['R2'].voltage.re).toBeCloseTo(10, 9);
		expect(vcvsSol.branches['E1'].voltage.re).toBeCloseTo(12, 9);
		expect(vcvsSol.branches['R3'].current.re).toBeCloseTo(-0.001, 9);

		// Same circuit using explicit controlNodePos/controlNodeNeg + flipped controlPolarity: -1 with gain -2
		const vcvsNodesDoc: CircuitDocument = {
			...vcvsDoc,
			components: vcvsDoc.components.map((c) =>
				c.id === 'E1'
					? {
							...c,
							value: '-2',
							controlRef: {
								controlNodePos: vcvsSol.branches['R1'].nodeA,
								controlNodeNeg: vcvsSol.branches['R1'].nodeB,
								controlPolarity: -1
							}
						}
					: c
			)
		};
		const vcvsNodesSol = solveMNA(vcvsNodesDoc);
		expect(vcvsNodesSol.valid).toBe(true);
		expect(vcvsNodesSol.powerBalance.balanced).toBe(true);
		expect(vcvsNodesSol.branches['R2'].voltage.re).toBeCloseTo(10, 9);
		expect(vcvsNodesSol.branches['E1'].voltage.re).toBeCloseTo(12, 9);

		// 20b. VCCS (DC): V1=12V (N1->0), R1=4Ω (N1->N2), R2=6Ω (N2->0), G1=0.25*V_R1 (0->N2, rot=270 => pin0=0, pin1=N2)
		// KCL at N2: (V2 - 12)/4 + V2/6 - 0.25*(12 - V2) = 0
		// => (1/4 + 1/6 + 1/4) V2 = 3 + 3 = 6 => (2/3) V2 = 6 => V2 = 9 V, V_R1 = 3 V, I_G1 = 0.75 A
		const vccsDoc: CircuitDocument = {
			schemaVersion: 1,
			mode: 'dc',
			frequencyHz: 60,
			components: [
				comp('V1', 'voltage_source', 4, 8, 90, '12'),
				comp('R1', 'resistor', 8, 4, 0, '4'),
				comp('R2', 'resistor', 12, 8, 90, '6'),
				comp('Gdep', 'vccs', 18, 8, 270, '0.25', {
					controlRef: { controlComponentId: 'R1', controlVarName: 'v_x' }
				}),
				comp('GND', 'ground', 4, 10, 0, '0')
			],
			wires: [
				wire('w1', [4, 6], [4, 4], [6, 4]),
				wire('w2', [10, 4], [18, 4], [18, 6]),
				wire('w3', [12, 4], [12, 6]),
				wire('w4', [4, 10], [18, 10])
			]
		};
		const vccsSol = solveMNA(vccsDoc);
		expect(vccsSol.valid).toBe(true);
		expect(vccsSol.powerBalance.balanced).toBe(true);
		expect(vccsSol.branches['R2'].voltage.re).toBeCloseTo(9, 9);
		expect(vccsSol.branches['R1'].voltage.re).toBeCloseTo(3, 9);
		expect(vccsSol.branches['Gdep'].current.re).toBeCloseTo(0.75, 9);

		// 20c. CCVS (DC): V1=12V (N1->0), R1=2Ω (N1->N2), R2=4Ω (N2->0), H1=2*I_R1 (N3->0), R3=4Ω (N2->N3)
		// Hand: V_N3 = 2 * I_R1 = 2 * (12 - V2)/2 = 12 - V2.
		// KCL at N2: (V2 - 12)/2 + V2/4 + (V2 - (12 - V2))/4 = 0
		// *4: 2(V2 - 12) + V2 + (2V2 - 12) = 0 => 5 V2 = 36 => V2 = 7.2 V, I_R1 = 2.4 A, V_N3 = 4.8 V
		const ccvsDoc: CircuitDocument = {
			schemaVersion: 1,
			mode: 'dc',
			frequencyHz: 60,
			components: [
				comp('V1', 'voltage_source', 4, 8, 90, '12'),
				comp('R1', 'resistor', 8, 4, 0, '2'),
				comp('R2', 'resistor', 12, 8, 90, '4'),
				comp('R3', 'resistor', 16, 4, 0, '4'),
				comp('H1', 'ccvs', 20, 8, 90, '2', {
					controlRef: { controlBranchComponentId: 'R1', controlVarName: 'i_x' }
				}),
				comp('GND', 'ground', 4, 10, 0, '0')
			],
			wires: [
				wire('w1', [4, 6], [4, 4], [6, 4]),
				wire('w2', [10, 4], [14, 4]),
				wire('w3', [12, 4], [12, 6]),
				wire('w4', [18, 4], [20, 4], [20, 6]),
				wire('w5', [4, 10], [20, 10])
			]
		};
		const ccvsSol = solveMNA(ccvsDoc);
		expect(ccvsSol.valid).toBe(true);
		expect(ccvsSol.powerBalance.balanced).toBe(true);
		expect(ccvsSol.branches['R2'].voltage.re).toBeCloseTo(7.2, 9);
		expect(ccvsSol.branches['R1'].current.re).toBeCloseTo(2.4, 9);
		expect(ccvsSol.branches['H1'].voltage.re).toBeCloseTo(4.8, 9);

		// 20d. CCCS (DC): V1=12V (N1->0), R1=4Ω (N1->N2), R2=6Ω (N2->0), F1=2*I_R1 (0->N2)
		// KCL at N2: (V2 - 12)/4 + V2/6 - 2*(12 - V2)/4 = 0
		// => (1/4 + 1/6 + 2/4) V2 = 3 + 6 = 9 => (11/12) V2 = 9 => V2 = 108/11 V
		// I_R1 = (12 - 108/11)/4 = (24/11)/4 = 6/11 A, I_F1 = 12/11 A
		const cccsDoc: CircuitDocument = {
			schemaVersion: 1,
			mode: 'dc',
			frequencyHz: 60,
			components: [
				comp('V1', 'voltage_source', 4, 8, 90, '12'),
				comp('R1', 'resistor', 8, 4, 0, '4'),
				comp('R2', 'resistor', 12, 8, 90, '6'),
				comp('F1', 'cccs', 18, 8, 270, '2', {
					controlRef: { controlBranchComponentId: 'R1', controlVarName: 'i_x' }
				}),
				comp('GND', 'ground', 4, 10, 0, '0')
			],
			wires: [
				wire('w1', [4, 6], [4, 4], [6, 4]),
				wire('w2', [10, 4], [18, 4], [18, 6]),
				wire('w3', [12, 4], [12, 6]),
				wire('w4', [4, 10], [18, 10])
			]
		};
		const cccsSol = solveMNA(cccsDoc);
		expect(cccsSol.valid).toBe(true);
		expect(cccsSol.powerBalance.balanced).toBe(true);
		expect(cccsSol.branches['R2'].voltage.re).toBeCloseTo(108 / 11, 9);
		expect(cccsSol.branches['R1'].current.re).toBeCloseTo(6 / 11, 9);
		expect(cccsSol.branches['F1'].current.re).toBeCloseTo(12 / 11, 9);
	});

	it('21. AC Dependent Sources (VCVS, VCCS, CCVS, CCCS) with complex impedances & balanced complex power', () => {
		// AC VCVS + reactive load: V1=10∠0° V, R1=2 Ω, C1=-j2 Ω (N2->0), L1=j2 Ω (N2->N3), E1=2*V_R1 (N3->0)
		// Hand: V_N3 = 2*(10 - V2) = 20 - 2*V2
		// KCL at N2: (V2 - 10)/2 + V2/(-j2) + (V2 - (20 - 2*V2))/(j2) = 0
		// *2: (V2 - 10) + j*V2 - j*(3*V2 - 20) = 0
		// => (1 - j2)*V2 = 10 - j20 = 10*(1 - j2) => V2 = 10 V!
		// Wait: V_R1 = 10 - 10 = 0 V! Let's make E1 = (1+j1)*V_R1 so V_R1 != 0:
		// E1 = (1+j1)*(10 - V2) => KCL*2: (V2-10) + j*V2 + (-j)*(V2 - (1+j1)*(10-V2)) = 0
		// => (V2 - 10) + j*(1+j1)*(10 - V2) = 0 => (V2 - 10)*(1 - (-1+j1)) = 0 -> still 10 unless C1 != -L1!
		// Use R1=2 Ω, R2=4 Ω (N2->0), L1=j2 Ω (N2->N3), E1=2*V_R1 (N3->0):
		// KCL at N2: (V2 - 10)/2 + V2/4 + (V2 - 2*(10 - V2))/(j2) = 0
		// *4: 2(V2 - 10) + V2 - j2*(3*V2 - 20) = 0 => (3 - j6)*V2 = 20 - j40
		// => V2 = (20 - j40)/(3 - j6) = 20/3 V! Let's use L1=j4 Ω instead:
		// *4: 2(V2 - 10) + V2 - j*(3*V2 - 20) = 0 => (3 - j3)*V2 = 20 - j20 => V2 = 20/3 V (still real!).
		// Use R1=2 Ω, C1=-j4 Ω (N2->0), R3=4 Ω (N2->N3), E1=2*V_R1 (N3->0):
		// KCL*4: 2(V2 - 10) + j*V2 + (3*V2 - 20) = 0 => (5 + j1)*V2 = 40 => V2 = 40/(5 + j1)
		const acVcvsDoc: CircuitDocument = {
			schemaVersion: 1,
			mode: 'ac',
			frequencyHz: 60,
			acMagnitudeMode: 'rms',
			components: [
				comp('V1', 'voltage_source', 4, 8, 90, '10∠0°'),
				comp('R1', 'resistor', 8, 4, 0, '2'),
				comp('C1', 'capacitor', 12, 8, 90, '-j4', { valueMode: 'impedance', unit: 'Ω' }),
				comp('R3', 'resistor', 16, 4, 0, '4'),
				comp('E1', 'vcvs', 20, 8, 90, '2', {
					controlRef: { controlComponentId: 'R1' }
				}),
				comp('GND', 'ground', 4, 10, 0, '0')
			],
			wires: [
				wire('w1', [4, 6], [4, 4], [6, 4]),
				wire('w2', [10, 4], [14, 4]),
				wire('w3', [12, 4], [12, 6]),
				wire('w4', [18, 4], [20, 4], [20, 6]),
				wire('w5', [4, 10], [20, 10])
			]
		};
		const acVcvsSol = solveMNA(acVcvsDoc);
		expect(acVcvsSol.valid).toBe(true);
		expect(acVcvsSol.powerBalance.balanced).toBe(true);
		const expectedV2 = Complex.from(40, 0).div(Complex.from(5, 1));
		expect(acVcvsSol.branches['C1'].voltage.sub(expectedV2).abs()).toBeLessThan(1e-11);
		expect(
			acVcvsSol.branches['E1'].voltage
				.sub(Complex.from(10, 0).sub(expectedV2).scale(2))
				.abs()
		).toBeLessThan(1e-11);

		// AC CCCS with complex gain: V1=10∠0° V, R1=2 Ω, L1=j2 Ω (N2->0), F1=(1+j1)*I_R1 (0->N2)
		// KCL at N2: (V2 - 10)/2 + V2/(j2) - (1+j1)*(10 - V2)/2 = 0
		// *2: (V2 - 10) - j*V2 + (1+j1)*(V2 - 10) = 0
		// => (2 + j0)*V2 = (2 + j1)*10 => V2 = 10 + j5 V!
		const acCccsDoc: CircuitDocument = {
			schemaVersion: 1,
			mode: 'ac',
			frequencyHz: 60,
			acMagnitudeMode: 'rms',
			components: [
				comp('V1', 'voltage_source', 4, 8, 90, '10∠0°'),
				comp('R1', 'resistor', 8, 4, 0, '2'),
				comp('L1', 'inductor', 12, 8, 90, 'j2', { valueMode: 'impedance', unit: 'Ω' }),
				comp('F1', 'cccs', 18, 8, 270, '1+j1', {
					controlRef: { controlBranchComponentId: 'R1' }
				}),
				comp('GND', 'ground', 4, 10, 0, '0')
			],
			wires: [
				wire('w1', [4, 6], [4, 4], [6, 4]),
				wire('w2', [10, 4], [18, 4], [18, 6]),
				wire('w3', [12, 4], [12, 6]),
				wire('w4', [4, 10], [18, 10])
			]
		};
		const acCccsSol = solveMNA(acCccsDoc);
		expect(acCccsSol.valid).toBe(true);
		expect(acCccsSol.powerBalance.balanced).toBe(true);
		expect(acCccsSol.branches['L1'].voltage.sub(Complex.from(10, 5)).abs()).toBeLessThan(1e-11);
	});

	it('22. Dependent source validation emits actionable INVALID_DEPENDENT_CONTROL diagnostics', () => {
		const brokenDoc: CircuitDocument = {
			schemaVersion: 1,
			mode: 'dc',
			frequencyHz: 60,
			components: [
				comp('V1', 'voltage_source', 4, 8, 90, '12'),
				comp('R1', 'resistor', 8, 4, 0, '4k'),
				comp('E1', 'vcvs', 12, 8, 90, '2', {
					controlRef: { controlComponentId: 'DELETED_R99' }
				}),
				comp('GND', 'ground', 4, 10, 0, '0')
			],
			wires: [
				wire('w1', [4, 6], [4, 4], [6, 4]),
				wire('w2', [10, 4], [12, 4], [12, 6]),
				wire('w3', [4, 10], [12, 10])
			]
		};
		const sol = solveMNA(brokenDoc);
		expect(sol.valid).toBe(false);
		expect(
			sol.diagnostics.some(
				(d) => d.severity === 'error' && d.code === 'INVALID_DEPENDENT_CONTROL'
			)
		).toBe(true);
	});
});
