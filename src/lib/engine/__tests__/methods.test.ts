import { describe, expect, it } from 'vitest';
import { getPresetById } from '$lib/data/presets';
import { Complex } from '../complex';
import { solveCircuit } from '../solve';
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

describe('All 6 Pedagogical Method Solvers + Cross-Verification Gate', () => {
	it('1. DC Supernode Network: all 6 methods agree with MNA (< 1e-8)', () => {
		// V1=10V (0,0)-(0,4), R1=2Ω (0,0)-(4,0), R2=4Ω (4,0)-(4,4),
		// Floating V2=6V (4,0)-(8,0), R3=6Ω (8,0)-(8,4), I1=3A (12,4)->(12,0)
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

		const full = solveCircuit(doc, {
			theveninTarget: { kind: 'component', componentId: 'R3' }
		});
		expect(full.mna.valid).toBe(true);
		expect(full.allVerified).toBe(true);
		expect(full.maxDiscrepancy).toBeLessThan(1e-8);

		for (const id of [
			'kcl_kvl',
			'nodal',
			'mesh',
			'superposition',
			'source_transform',
			'thevenin_norton'
		] as const) {
			const res = full.methods[id]!;
			expect(res.applicable).toBe(true);
			expect(res.verifiedAgainstMna).toBe(true);
			expect(res.maxDiscrepancy!).toBeLessThan(1e-8);
			expect(res.steps.length).toBeGreaterThan(0);
		}

		// Verify supernode step explicitly emitted in Nodal
		expect(full.methods.nodal!.steps.some((s) => s.title.includes('Supernode'))).toBe(true);
	});

	it('2. DC Supermesh Circuit (shared current source between two meshes): all 6 methods agree (< 1e-8)', () => {
		// Mesh 1 (left): V1=12V (0,0)-(0,4), R1=4Ω (0,0)-(4,0), I1=2A (4,4)->(4,0) shared with Mesh 2
		// Mesh 2 (right): R2=2Ω (4,0)-(8,0), R3=6Ω (8,0)-(8,4), bottom wire (0,4)-(8,4)
		// Hand solution: V(N2) [at (4,0)]: (V2 - 12)/4 + V2/(2+6) = 2 => (1/4+1/8)V2 = 5 => (3/8)V2 = 5 => V2 = 40/3 V
		const doc: CircuitDocument = {
			schemaVersion: 1,
			mode: 'dc',
			frequencyHz: 60,
			components: [
				comp('V1', 'voltage_source', 0, 2, 90, '12'),
				comp('R1', 'resistor', 2, 0, 0, '4'),
				comp('I1', 'current_source', 4, 2, 270, '2'),
				comp('R2', 'resistor', 6, 0, 0, '2'),
				comp('R3', 'resistor', 8, 2, 90, '6'),
				comp('G1', 'ground', 0, 4, 0, '0')
			],
			wires: [wire('w_gnd', [0, 4], [8, 4])]
		};

		const full = solveCircuit(doc);
		expect(full.mna.valid).toBe(true);
		expect(full.mna.branches['R3'].voltage.re).toBeCloseTo(10, 9); // 6/(2+6) * 40/3 = 10V
		expect(full.allVerified).toBe(true);
		expect(full.maxDiscrepancy).toBeLessThan(1e-8);

		// Verify Mesh detected the Supermesh
		expect(full.methods.mesh!.applicable).toBe(true);
		expect(full.methods.mesh!.steps.some((s) => s.title.includes('Supermesh'))).toBe(true);
	});

	it('3. DC Wheatstone Bridge (3 meshes) + Thévenin across bridge resistor R5', () => {
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

		const full = solveCircuit(doc, {
			theveninTarget: { kind: 'component', componentId: 'R5' }
		});
		expect(full.mna.valid).toBe(true);
		expect(full.allVerified).toBe(true);
		expect(full.maxDiscrepancy).toBeLessThan(1e-8);

		// Hand-derived Thévenin across R5 (A=(4,4), B=(8,4)):
		// V_A_open = 24 * 3/9 = 8V, V_B_open = 24 * 12/16 = 18V => V_th = 8 - 18 = -10V
		// R_th = (6||3) + (4||12) = 2 + 3 = 5Ω
		// I_L = -10 / (5 + 2) = -10/7 A!
		const tn = full.theveninNorton!;
		expect(tn.vth.re).toBeCloseTo(-10, 9);
		expect(tn.zth!.re).toBeCloseTo(5, 9);
		expect(tn.isc!.re).toBeCloseTo(-2, 9);
		expect(tn.maxPowerTransfer!.optimalLoadImpedance.re).toBeCloseTo(5, 9);
		expect(tn.maxPowerTransfer!.maxRealPowerW).toBeCloseTo(100 / 20, 9); // (-10)^2 / (4*5) = 5W
	});

	it('4. DC Source Transformation Ladder (multi-stage V->I and I->V reductions)', () => {
		// V1=12V (0,0)-(0,4), R1=4Ω (0,0)-(4,0), R2=4Ω (4,0)-(4,4), R3=2Ω (4,0)-(8,0),
		// I1=2A (8,4)->(8,0), R4=4Ω (12,0)-(12,4)
		// Hand solve: V1/R1 = 3A || 4Ω -> with R2=4Ω => 3A || 2Ω -> Vth=6V + 2Ω + R3(2Ω) = 6V + 4Ω -> 1.5A || 4Ω
		// Combine with I1=2A => 3.5A || 4Ω -> with R4=4Ω => 3.5A || 2Ω => V(N_right) = 7V!
		const doc: CircuitDocument = {
			schemaVersion: 1,
			mode: 'dc',
			frequencyHz: 60,
			components: [
				comp('V1', 'voltage_source', 0, 2, 90, '12'),
				comp('R1', 'resistor', 2, 0, 0, '4'),
				comp('R2', 'resistor', 4, 2, 90, '4'),
				comp('R3', 'resistor', 6, 0, 0, '2'),
				comp('I1', 'current_source', 8, 2, 270, '2'),
				comp('R4', 'resistor', 12, 2, 90, '4'),
				comp('G1', 'ground', 0, 4, 0, '0')
			],
			wires: [wire('w_top2', [8, 0], [12, 0]), wire('w_gnd', [0, 4], [12, 4])]
		};

		const full = solveCircuit(doc);
		expect(full.mna.valid).toBe(true);
		expect(full.mna.branches['R4'].voltage.re).toBeCloseTo(7, 9);
		expect(full.allVerified).toBe(true);
		expect(full.maxDiscrepancy).toBeLessThan(1e-8);
		expect(full.methods.source_transform!.steps.length).toBeGreaterThanOrEqual(4);
	});

	it('5. AC Multi-Source Supernode & Supermesh Phasor Network: all 6 methods agree (< 1e-8)', () => {
		const freq = 1000 / (2 * Math.PI); // omega = 1000
		const doc: CircuitDocument = {
			schemaVersion: 1,
			mode: 'ac',
			frequencyHz: freq,
			components: [
				comp('V1', 'voltage_source', 0, 2, 90, '10∠0°'),
				comp('R1', 'resistor', 2, 0, 0, '10'),
				comp('L1', 'inductor', 4, 2, 90, '10m'), // j10
				comp('V2', 'voltage_source', 6, 0, 0, '5∠90°'), // floating AC source -> supernode!
				comp('C1', 'capacitor', 8, 2, 90, '100u'), // -j10
				comp('I1', 'current_source', 12, 2, 270, '1∠-30°'),
				comp('R2', 'resistor', 16, 2, 90, '20'),
				comp('G1', 'ground', 0, 4, 0, '0')
			],
			wires: [wire('w_top', [8, 0], [16, 0]), wire('w_gnd', [0, 4], [16, 4])]
		};

		const full = solveCircuit(doc, {
			theveninTarget: { kind: 'component', componentId: 'R2' }
		});
		expect(full.mna.valid).toBe(true);
		expect(full.allVerified).toBe(true);
		expect(full.maxDiscrepancy).toBeLessThan(1e-8);

		for (const id of [
			'kcl_kvl',
			'nodal',
			'mesh',
			'superposition',
			'source_transform',
			'thevenin_norton'
		] as const) {
			expect(full.methods[id]!.applicable).toBe(true);
			expect(full.methods[id]!.verifiedAgainstMna).toBe(true);
			expect(full.methods[id]!.maxDiscrepancy!).toBeLessThan(1e-8);
		}
	});

	it('3b. Thévenin test-source wires never merge with an unrelated pin', () => {
		// Layout where a straight wire from the far test source to the port lines up at exactly
		// 45° with R5's pin, which used to short it into the port (Z_th = 5 Ω instead of 7.5 Ω).
		const doc: CircuitDocument = {
			schemaVersion: 1,
			mode: 'dc',
			frequencyHz: 60,
			components: [
				comp('V1', 'voltage_source', -4, 16, 90, '10'),
				comp('R1', 'resistor', -2, 14, 0, '10'),
				comp('RL', 'resistor', 0, 16, 90, '10'),
				comp('R4', 'resistor', 2, 14, 0, '10'),
				comp('R5', 'resistor', 4, 16, 90, '10'),
				comp('R6', 'resistor', 4, 20, 90, '10'),
				comp('G', 'ground', -4, 18, 0, '0')
			],
			wires: [wire('g1', [-4, 18], [0, 18]), wire('g2', [4, 22], [-4, 22], [-4, 18])]
		};
		const r = solveCircuit(doc, { theveninTarget: { kind: 'component', componentId: 'RL' } });
		expect(r.theveninNorton!.vth.re).toBeCloseTo(7.5, 9);
		expect(r.theveninNorton!.zth!.re).toBeCloseTo(7.5, 9); // 10 || (10 + 10 + 10)
		expect(r.methods.thevenin_norton!.verifiedAgainstMna).toBe(true);
	});

	it('3c. Thévenin with a source as the target is not applicable', () => {
		const doc: CircuitDocument = {
			schemaVersion: 1,
			mode: 'dc',
			frequencyHz: 60,
			components: [
				comp('V1', 'voltage_source', 0, 2, 90, '10'),
				comp('R1', 'resistor', 2, 0, 0, '2'),
				comp('R2', 'resistor', 4, 2, 90, '4'),
				comp('G1', 'ground', 0, 4, 0, '0')
			],
			wires: [wire('w_gnd', [0, 4], [4, 4])]
		};
		const r = solveCircuit(doc, { theveninTarget: { kind: 'component', componentId: 'V1' } });
		expect(r.methods.thevenin_norton!.applicable).toBe(false);
		expect(r.theveninNorton).toBeUndefined();
	});

	it('4b. Source transformation does not ping-pong Norton <-> Thévenin', () => {
		// I1 || R1 (ground-N1), V1 from N1 to N2, I2 from N2 to ground
		const doc: CircuitDocument = {
			schemaVersion: 1,
			mode: 'dc',
			frequencyHz: 60,
			components: [
				comp('I1', 'current_source', 0, 2, 270, '2'),
				comp('R1', 'resistor', 2, 2, 90, '4'),
				comp('V1', 'voltage_source', 4, 0, 0, '6'),
				comp('I2', 'current_source', 6, 2, 90, '1'),
				comp('G', 'ground', 0, 4, 0, '0')
			],
			wires: [wire('wa', [0, 0], [2, 0]), wire('wc', [0, 4], [6, 4])]
		};
		const st = solveCircuit(doc).methods.source_transform!;
		expect(st.steps.length).toBeLessThan(10);
		if (st.applicable) expect(st.verifiedAgainstMna).toBe(true);
		const titles = st.steps.map((x) => x.title).join('|');
		expect(titles).not.toMatch(/Thévenin → Norton.*Norton → Thévenin.*Thévenin → Norton/);
	});

	it('5b. Superposition without a ground symbol uses one reference for every sub-circuit', () => {
		const doc: CircuitDocument = {
			schemaVersion: 1,
			mode: 'dc',
			frequencyHz: 60,
			components: [
				comp('I1', 'current_source', 0, 2, 270, '2'),
				comp('R1', 'resistor', 2, 2, 90, '4'),
				comp('R3', 'resistor', 4, 0, 0, '2'),
				comp('R2', 'resistor', 6, 2, 90, '3'),
				comp('I2', 'current_source', 8, 2, 270, '1')
			],
			wires: [wire('wa', [0, 0], [2, 0]), wire('wb', [6, 0], [8, 0]), wire('wc', [0, 4], [8, 4])]
		};
		const sup = solveCircuit(doc).methods.superposition!;
		expect(sup.applicable).toBe(true);
		expect(sup.verifiedAgainstMna).toBe(true);
	});

	it('3d. Dependent sources: delivered pf (lagging into R+jX) and not offered as Thévenin load', () => {
		// V1 10 V -> R1 1 Ω -> R2 1 Ω divider; VCVS E1 = 2·V(R2) drives R3 3 Ω + jX_L 4 Ω
		const doc: CircuitDocument = {
			schemaVersion: 1,
			mode: 'ac',
			frequencyHz: 60,
			components: [
				comp('V1', 'voltage_source', 0, 2, 90, '10'),
				comp('R1', 'resistor', 2, 0, 0, '1'),
				comp('R2', 'resistor', 4, 2, 90, '1'),
				comp('E1', 'vcvs', 8, 2, 90, '2', { controlRef: { controlComponentId: 'R2', gain: '2' } }),
				comp('R3', 'resistor', 10, 0, 0, '3'),
				comp('L1', 'inductor', 12, 2, 90, 'j4', { valueMode: 'impedance', unit: 'Ω' }),
				comp('G1', 'ground', 0, 4, 0, '0')
			],
			wires: [wire('w_gnd', [0, 4], [12, 4])]
		};
		const r = solveCircuit(doc, { theveninTarget: { kind: 'component', componentId: 'E1' } });
		expect(r.mna.valid).toBe(true);
		const e1 = r.mna.branches['E1'];
		expect(e1.realPower).toBeCloseTo(-12, 9);
		expect(e1.powerFactor).toBeCloseTo(0.6, 9);
		expect(e1.powerFactorType).toBe('lagging');
		expect(r.methods.thevenin_norton!.applicable).toBe(false);
	});

	it('6. AC RLC Series-Parallel Thévenin & Conjugate Max Power Transfer', () => {
		const freq = 1000 / (2 * Math.PI); // omega = 1000
		// V1=50∠0° V, R1=30Ω, L1=40mH (j40 Ω) in series, load R_L=20Ω
		const doc: CircuitDocument = {
			schemaVersion: 1,
			mode: 'ac',
			frequencyHz: freq,
			components: [
				comp('V1', 'voltage_source', 0, 2, 90, '50∠0°'),
				comp('R1', 'resistor', 2, 0, 0, '30'),
				comp('L1', 'inductor', 6, 0, 0, '40m'),
				comp('RL', 'resistor', 8, 2, 90, '20'),
				comp('G1', 'ground', 0, 4, 0, '0')
			],
			wires: [wire('w_gnd', [0, 4], [8, 4])]
		};

		const full = solveCircuit(doc, {
			theveninTarget: { kind: 'component', componentId: 'RL' }
		});
		expect(full.allVerified).toBe(true);

		const tn = full.theveninNorton!;
		expect(tn.vth.equals(Complex.from(50, 0), 1e-9)).toBe(true);
		expect(tn.zth!.equals(Complex.from(30, 40), 1e-9)).toBe(true);
		// Conjugate optimal load Z_L,opt = 30 - j40
		expect(tn.maxPowerTransfer!.optimalLoadImpedance.equals(Complex.from(30, -40), 1e-9)).toBe(
			true
		);
		// P_max = 50^2 / (4 * 30) = 2500 / 120 = 20.833333... W
		expect(tn.maxPowerTransfer!.maxRealPowerW).toBeCloseTo(2500 / 120, 9);
	});

	it('7. Multi-Frequency AC Superposition (60 Hz + 120 Hz -> time-domain & RMS synthesis)', () => {
		const doc: CircuitDocument = {
			schemaVersion: 1,
			mode: 'ac',
			frequencyHz: 60,
			components: [
				comp('V1', 'voltage_source', 0, 2, 90, '10∠0°', { frequencyHz: 60 }),
				comp('R1', 'resistor', 2, 0, 0, '10'),
				comp('R2', 'resistor', 4, 2, 90, '10'),
				comp('V2', 'voltage_source', 8, 2, 90, '6∠90°', { frequencyHz: 120 }),
				comp('R3', 'resistor', 6, 0, 0, '10'),
				comp('G1', 'ground', 0, 4, 0, '0')
			],
			wires: [wire('w_gnd', [0, 4], [8, 4])]
		};

		const full = solveCircuit(doc, { methods: ['superposition'] });
		const sup = full.methods.superposition!;
		expect(sup.applicable).toBe(true);
		expect(sup.verifiedAgainstMna).toBe(true);
		const lastStep = sup.steps[sup.steps.length - 1];
		expect(lastStep.title).toContain('Multi-Frequency');
		const allLatex = lastStep.latex!.join('\n');
		expect(allLatex).toContain('\\cos(');
		expect(allLatex).toContain('V_{N2,\\text{rms}}');
	});

	it('7b. Multi-Frequency: MNA is flagged and single-phasor methods are not applicable', () => {
		const doc: CircuitDocument = {
			schemaVersion: 1,
			mode: 'ac',
			frequencyHz: 60,
			components: [
				comp('V1', 'voltage_source', 0, 2, 90, '10∠0°', { frequencyHz: 60 }),
				comp('R1', 'resistor', 2, 0, 0, '10'),
				comp('R2', 'resistor', 4, 2, 90, '10'),
				comp('V2', 'voltage_source', 8, 2, 90, '6∠90°', { frequencyHz: 120 }),
				comp('R3', 'resistor', 6, 0, 0, '10'),
				comp('G1', 'ground', 0, 4, 0, '0')
			],
			wires: [wire('w_gnd', [0, 4], [8, 4])]
		};

		const full = solveCircuit(doc);
		expect(full.mna.multiFrequencyHz).toEqual([60, 120]);
		expect(full.mna.diagnostics.some((d) => d.code === 'MULTI_FREQUENCY')).toBe(true);
		for (const id of ['kcl_kvl', 'nodal', 'mesh', 'source_transform', 'thevenin_norton'] as const) {
			expect(full.methods[id]?.applicable).toBe(false);
		}
		expect(full.methods.superposition?.applicable).toBe(true);

		// Same circuit at one frequency is not flagged
		const single = solveCircuit({
			...doc,
			components: doc.components.map((c) => (c.id === 'V2' ? { ...c, frequencyHz: 60 } : c))
		});
		expect(single.mna.multiFrequencyHz).toBeUndefined();
		expect(single.methods.nodal?.applicable).toBe(true);
	});

	it('8. Non-Planar K_{3,3} Graph: Mesh returns applicable=false while Nodal & KCL/KVL solve accurately', () => {
		// Bipartite K_{3,3}: left nodes L0='0', L1=(0,2), L2=(0,4); right nodes R0=(4,0), R1=(4,2), R2=(4,4)
		// Connect all 9 pairs via resistors + 1 voltage source V1 across (L1, 0)
		const doc: CircuitDocument = {
			schemaVersion: 1,
			mode: 'dc',
			frequencyHz: 60,
			components: [
				comp('G1', 'ground', 0, 0, 0, '0'),
				comp('V1', 'voltage_source', 0, 10, 90, '10'), // +:(0,8) [L1], -:(0,12) [0]
				// 9 resistors connecting {L0(0,0), L1(0,8), L2(0,16)} to {R0(10,0), R1(10,8), R2(10,16)}
				comp('R_00', 'resistor', 20, 0, 0, '10'),
				comp('R_01', 'resistor', 20, 4, 0, '10'),
				comp('R_02', 'resistor', 20, 8, 0, '10'),
				comp('R_10', 'resistor', 20, 12, 0, '10'),
				comp('R_11', 'resistor', 20, 16, 0, '10'),
				comp('R_12', 'resistor', 20, 20, 0, '10'),
				comp('R_20', 'resistor', 20, 24, 0, '10'),
				comp('R_21', 'resistor', 20, 28, 0, '10'),
				comp('R_22', 'resistor', 20, 32, 0, '10')
			],
			wires: [
				// L0 = (0,0) = ground, tie V1- (0,12) to (0,0)
				wire('wl0_g', [0, 12], [-2, 12], [-2, 0], [0, 0]),
				// L0 -> R_00, R_01, R_02 pins at x=18, y=0,4,8
				wire('wl0_a', [0, 0], [18, 0]),
				wire('wl0_b', [18, 0], [18, 8]),
				// L1 = (0,8) -> R_10, R_11, R_12 pins at x=18, y=12,16,20
				wire('wl1_a', [0, 8], [16, 8], [16, 12], [18, 12]),
				wire('wl1_b', [18, 12], [18, 20]),
				// L2 = (0,16) -> R_20, R_21, R_22 pins at x=18, y=24,28,32
				wire('wl2_a', [0, 16], [14, 16], [14, 24], [18, 24]),
				wire('wl2_b', [18, 24], [18, 32]),
				// R0 -> right pins of R_00 (22,0), R_10 (22,12), R_20 (22,24)
				wire('wr0_a', [22, 0], [26, 0], [26, 24], [22, 24]),
				wire('wr0_b', [22, 12], [26, 12]),
				// R1 -> right pins of R_01 (22,4), R_11 (22,16), R_21 (22,28)
				wire('wr1_a', [22, 4], [28, 4], [28, 28], [22, 28]),
				wire('wr1_b', [22, 16], [28, 16]),
				// R2 -> right pins of R_02 (22,8), R_12 (22,20), R_22 (22,32)
				wire('wr2_a', [22, 8], [30, 8], [30, 32], [22, 32]),
				wire('wr2_b', [22, 20], [30, 20])
			]
		};

		const full = solveCircuit(doc, { methods: ['kcl_kvl', 'nodal', 'mesh'] });
		expect(full.mna.valid).toBe(true);
		expect(full.methods.mesh!.applicable).toBe(false);
		expect(full.methods.mesh!.inapplicableReason).toContain('non-planar');
		expect(full.methods.nodal!.applicable).toBe(true);
		expect(full.methods.nodal!.verifiedAgainstMna).toBe(true);
		expect(full.methods.kcl_kvl!.applicable).toBe(true);
		expect(full.methods.kcl_kvl!.verifiedAgainstMna).toBe(true);
		expect(full.allVerified).toBe(true);
	});

	it('9. Ideal Voltmeters spanning multiple loads pass all 6 pedagogical methods with allVerified=true and maxDiscrepancy < 1e-8', () => {
		// 9a. DC Divider preset with VM1 spanning across R1 + R2 (V_N1 - V_0 = 12 V) and VM2 across R1 (4 V)
		const dividerPreset = getPresetById('dc-divider')!;
		const dividerWithVm: CircuitDocument = {
			...dividerPreset.document,
			components: [
				...dividerPreset.document.components,
				comp('VM1', 'voltmeter', 8, 0, 0, '0'), // +:(6,0) -> (4,4), -:(10,0) -> (12,10)
				comp('VM_OPEN', 'voltmeter', 24, 0, 0, '0') // unconnected voltmeter must not disturb methods
			],
			wires: [
				...dividerPreset.document.wires,
				wire('w_vm1_p', [6, 0], [4, 0], [4, 4]),
				wire('w_vm1_n', [10, 0], [22, 0], [22, 10], [18, 10])
			]
		};
		const dividerSol = solveCircuit(dividerWithVm);
		expect(dividerSol.mna.valid).toBe(true);
		expect(dividerSol.mna.powerBalance.balanced).toBe(true);
		expect(dividerSol.mna.branches['VM1'].voltage.re).toBeCloseTo(12, 9);
		expect(dividerSol.mna.branches['VM1'].current.abs()).toBe(0);
		expect(dividerSol.allVerified).toBe(true);
		expect(dividerSol.maxDiscrepancy).toBeLessThan(1e-8);

		// 9b. DC Wheatstone Bridge preset with VM1 spanning across R1 + R5 (node N1 to right bridge node)
		const bridgePreset = getPresetById('dc-wheatstone-bridge')!;
		const bridgeWithVm: CircuitDocument = {
			...bridgePreset.document,
			components: [
				...bridgePreset.document.components,
				comp('VM1', 'voltmeter', 14, -2, 0, '0') // +:(12,-2)->(4,2), -:(16,-2)->(18,8)
			],
			wires: [
				...bridgePreset.document.wires,
				wire('w_bvm_p', [12, -2], [4, -2], [4, 2]),
				wire('w_bvm_n', [16, -2], [22, -2], [22, 8], [18, 8])
			]
		};
		const bridgeSol = solveCircuit(bridgeWithVm);
		expect(bridgeSol.mna.valid).toBe(true);
		expect(bridgeSol.mna.powerBalance.balanced).toBe(true);
		const expectedBridgeVm = bridgeSol.mna.branches['R1'].voltage.add(
			bridgeSol.mna.branches['R5'].voltage
		);
		expect(bridgeSol.mna.branches['VM1'].voltage.sub(expectedBridgeVm).abs()).toBeLessThan(1e-9);
		expect(bridgeSol.allVerified).toBe(true);
		expect(bridgeSol.maxDiscrepancy).toBeLessThan(1e-8);

		// 9c. AC Impedance Supernode preset with VM1 spanning across C1 + R1 (between N2 and GND) and VM2 across L1 + R3 (between N3 and GND)
		const acPreset = getPresetById('ac-impedance-supernode')!;
		const acWithVm: CircuitDocument = {
			...acPreset.document,
			components: [
				...acPreset.document.components,
				comp('VM1', 'voltmeter', 16, 0, 0, '0') // +:(14,0)->(6,4)[N1], -:(18,0)->(28,4)[N4]
			],
			wires: [
				...acPreset.document.wires,
				wire('w_acvm_p', [14, 0], [4, 0], [4, 4]),
				wire('w_acvm_n', [18, 0], [28, 0], [28, 4])
			]
		};
		const acSol = solveCircuit(acWithVm);
		expect(acSol.mna.valid).toBe(true);
		expect(acSol.mna.powerBalance.balanced).toBe(true);
		const vN1 = acSol.mna.nodeVoltages[acSol.mna.branches['VM1'].nodeA].voltage;
		const vN4 = acSol.mna.nodeVoltages[acSol.mna.branches['VM1'].nodeB].voltage;
		expect(acSol.mna.branches['VM1'].voltage.sub(vN1.sub(vN4)).abs()).toBeLessThan(1e-9);
		expect(acSol.allVerified).toBe(true);
		expect(acSol.maxDiscrepancy).toBeLessThan(1e-8);
	});

	it('10. Superposition with Dependent Source + 2 Independent Sources keeps dependent source active in every sub-circuit', () => {
		// V1=12V (N1->0), R1=4Ω (N1->N2), R2=4Ω (N2->0), E1=2*V_R1 (N3->0), R3=2Ω (N2->N3), I1=2A (0->N2)
		// Hand solution: V_N3 = 2*(12 - V2) = 24 - 2*V2
		// KCL at N2: (V2 - 12)/4 + V2/4 + (V2 - (24 - 2*V2))/2 - 2 = 0
		// *4: (V2 - 12) + V2 + 2*(3*V2 - 24) - 8 = 0 => 8*V2 = 68 => V2 = 8.5 V, V_N3 = 7 V
		const doc: CircuitDocument = {
			schemaVersion: 1,
			mode: 'dc',
			frequencyHz: 60,
			components: [
				comp('V1', 'voltage_source', 4, 8, 90, '12'),
				comp('R1', 'resistor', 8, 4, 0, '4'),
				comp('R2', 'resistor', 12, 8, 90, '4'),
				comp('I1', 'current_source', 16, 8, 270, '2'),
				comp('R3', 'resistor', 20, 4, 0, '2'),
				comp('E1', 'vcvs', 24, 8, 90, '2', {
					controlRef: { controlComponentId: 'R1', controlVarName: 'v_x' }
				}),
				comp('G1', 'ground', 4, 10, 0, '0')
			],
			wires: [
				wire('w1', [4, 6], [4, 4], [6, 4]),
				wire('w2', [10, 4], [18, 4]),
				wire('w3', [12, 4], [12, 6]),
				wire('w4', [16, 4], [16, 6]),
				wire('w5', [22, 4], [24, 4], [24, 6]),
				wire('w6', [4, 10], [24, 10])
			]
		};

		const full = solveCircuit(doc, {
			theveninTarget: { kind: 'component', componentId: 'R2' }
		});
		expect(full.mna.valid).toBe(true);
		expect(full.mna.powerBalance.balanced).toBe(true);
		expect(full.mna.branches['R2'].voltage.re).toBeCloseTo(8.5, 9);
		expect(full.mna.branches['E1'].voltage.re).toBeCloseTo(7, 9);
		expect(full.allVerified).toBe(true);
		expect(full.maxDiscrepancy).toBeLessThan(1e-8);

		const sup = full.methods.superposition!;
		expect(sup.applicable).toBe(true);
		expect(sup.verifiedAgainstMna).toBe(true);
		expect(sup.maxDiscrepancy!).toBeLessThan(1e-8);
		expect(sup.steps[0].description).toContain('NEVER deactivated');
	});

	it('11. Thévenin & Norton Test-Source Method with Dependent Sources (VCVS & CCCS) matches exact textbook R_th', () => {
		// 11a. dc-dependent-vcvs preset across R2: V_th = 80/7 V, R_th = 4000/7 Ω, I_N = 20 mA
		const preset = getPresetById('dc-dependent-vcvs')!;
		const fullVcvs = solveCircuit(preset.document, {
			theveninTarget: { kind: 'component', componentId: 'R2' }
		});
		expect(fullVcvs.allVerified).toBe(true);
		expect(fullVcvs.theveninNorton).toBeDefined();
		expect(fullVcvs.theveninNorton!.vth.re).toBeCloseTo(80 / 7, 9);
		expect(fullVcvs.theveninNorton!.zth!.re).toBeCloseTo(4000 / 7, 9);
		expect(fullVcvs.theveninNorton!.isc!.re).toBeCloseTo(0.02, 9);
		expect(
			fullVcvs.methods.thevenin_norton!.steps.some((s) => s.title.includes('Test-Source Method'))
		).toBe(true);

		// 11b. CCCS circuit: V1=12V (N1->0), R1=4Ω (N1->N2), F1=2*I_R1 (0->N2), R2=6Ω (N2->0)
		// Removing R2: I_R1 enters N2, F1=2*I_R1 enters N2 => 3*I_R1 = 0 => I_R1 = 0 => V_th = 12 V!
		// Test source I_test=1A into N2 with V1=0:
		// I_R1 = -V2/4 (from N1=0 to N2), F1 = 2*I_R1 = -V2/2 (from 0 to N2)
		// KCL at N2: V2/4 - (-V2/2) = 1 => (3/4)*V2 = 1 => R_th = 4/3 Ω!
		// Reconnect R2=6Ω: I_R2 = 12 / (4/3 + 6) = 12 / (22/3) = 18/11 A, V_R2 = 108/11 V!
		const cccsDoc: CircuitDocument = {
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
		const fullCccs = solveCircuit(cccsDoc, {
			theveninTarget: { kind: 'component', componentId: 'R2' }
		});
		expect(fullCccs.mna.valid).toBe(true);
		expect(fullCccs.allVerified).toBe(true);
		expect(fullCccs.maxDiscrepancy).toBeLessThan(1e-8);
		expect(fullCccs.theveninNorton!.vth.re).toBeCloseTo(12, 9);
		expect(fullCccs.theveninNorton!.zth!.re).toBeCloseTo(4 / 3, 9);
		expect(fullCccs.methods.kcl_kvl!.verifiedAgainstMna).toBe(true);
		expect(fullCccs.methods.nodal!.verifiedAgainstMna).toBe(true);
		expect(fullCccs.methods.mesh!.verifiedAgainstMna).toBe(true);
		expect(fullCccs.methods.superposition!.verifiedAgainstMna).toBe(true);
	});
});
