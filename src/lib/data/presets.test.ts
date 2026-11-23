import { describe, expect, it } from 'vitest';
import { Complex } from '../engine/complex';
import { buildElectricalGraph } from '../engine/graph';
import { solveMNA } from '../engine/mna';
import { solveCircuit } from '../engine/solve';
import { getPresetById, PRESETS } from './presets';

const EXPECTED_NON_REF_NODES: Record<string, number> = {
	'dc-divider': 2,
	'dc-supernode': 2,
	'dc-supermesh': 3,
	'dc-wheatstone-bridge': 3,
	'dc-superposition-source-transform': 3,
	'dc-steady-state-rlc': 3,
	'dc-dependent-vcvs': 3,
	'ac-rlc-phasor': 3,
	'ac-multi-source-phasor': 4,
	'ac-impedance-supernode': 4
};

describe('Curated Textbook DC & AC Presets', () => {
	it('contains 10 unique presets spanning DC and AC modes with valid load references', () => {
		expect(PRESETS.length).toBe(10);

		const ids = new Set(PRESETS.map((p) => p.id));
		expect(ids.size).toBe(10);

		const dcCount = PRESETS.filter((p) => p.category === 'dc').length;
		const acCount = PRESETS.filter((p) => p.category === 'ac').length;
		expect(dcCount).toBe(7);
		expect(acCount).toBe(3);

		for (const preset of PRESETS) {
			expect(getPresetById(preset.id)).toBe(preset);
			if (preset.theveninLoadId) {
				expect(
					preset.document.components.some((c) => c.id === preset.theveninLoadId)
				).toBe(true);
			}
		}
	});

	it.each(PRESETS)('preset "$id" solves cleanly with balanced power and zero errors', (preset) => {
		const graph = buildElectricalGraph(preset.document);
		expect(graph.nodes['0']).toBeDefined();
		expect(graph.nonRefNodeIds.length).toBe(EXPECTED_NON_REF_NODES[preset.id]);

		const sol = solveMNA(preset.document);
		const errorDiags = sol.diagnostics.filter((d) => d.severity === 'error');
		expect(errorDiags).toEqual([]);
		expect(sol.valid).toBe(true);
		expect(sol.powerBalance.balanced).toBe(true);
		expect(sol.powerBalance.totalSuppliedReal).toBeGreaterThan(0);

		const full = solveCircuit(preset.document, {
			theveninTarget: preset.theveninLoadId
				? { kind: 'component', componentId: preset.theveninLoadId }
				: undefined
		});
		expect(full.mna.valid).toBe(true);
		expect(full.mna.powerBalance.balanced).toBe(true);
		expect(full.allVerified).toBe(true);
		expect(full.maxDiscrepancy).toBeLessThan(1e-8);

		const isDependentPreset = preset.id === 'dc-dependent-vcvs';
		for (const methodId of [
			'nodal',
			'mesh',
			'superposition',
			'source_transform',
			'thevenin_norton'
		] as const) {
			const mRes = full.methods[methodId]!;
			if (isDependentPreset && methodId === 'source_transform') {
				expect(mRes.applicable).toBe(false);
			} else {
				expect(mRes.applicable).toBe(true);
				expect(mRes.verifiedAgainstMna).toBe(true);
				expect(mRes.maxDiscrepancy!).toBeLessThan(1e-8);
			}
		}
	});

	it('matches exact analytical textbook solutions on all DC presets', () => {
		// 1. DC Divider: V(R3) = 8 V, I(R1) = 2 mA
		const divSol = solveMNA(getPresetById('dc-divider')!.document);
		expect(divSol.branches['R3'].voltage.re).toBeCloseTo(8, 9);
		expect(divSol.branches['R1'].current.re).toBeCloseTo(0.002, 9);

		// 2. DC Supernode: V(R1) = 16 V, V(R2) = 4 V, I(V1) = 2 A
		const supNodeSol = solveMNA(getPresetById('dc-supernode')!.document);
		expect(supNodeSol.branches['R1'].voltage.re).toBeCloseTo(16, 9);
		expect(supNodeSol.branches['R2'].voltage.re).toBeCloseTo(4, 9);
		expect(supNodeSol.branches['V1'].current.re).toBeCloseTo(2, 9);

		// 3. DC Supermesh: I(R1) = 2.5 A, I(R2) = 4.5 A, V(R3) = 18 V
		const supMeshSol = solveMNA(getPresetById('dc-supermesh')!.document);
		expect(supMeshSol.branches['R1'].current.re).toBeCloseTo(2.5, 9);
		expect(supMeshSol.branches['R2'].current.re).toBeCloseTo(4.5, 9);
		expect(supMeshSol.branches['R3'].voltage.re).toBeCloseTo(18, 9);

		// 4. DC Wheatstone Bridge: I(R5) = 1/70 A
		const bridgeSol = solveMNA(getPresetById('dc-wheatstone-bridge')!.document);
		expect(bridgeSol.branches['R5'].current.re).toBeCloseTo(1 / 70, 9);

		// 5. DC Superposition & Source Transform: V(R3) = 8 V, V(R4) = 10 V
		const superPosSol = solveMNA(getPresetById('dc-superposition-source-transform')!.document);
		expect(superPosSol.branches['R3'].voltage.re).toBeCloseTo(8, 9);
		expect(superPosSol.branches['R4'].voltage.re).toBeCloseTo(10, 9);

		// 6. DC Steady-State RLC: I(C1) = 0 A, V(C1) = 12 V, V(L1) = 0 V, I(L1) = 3 A
		const rlcDcSol = solveMNA(getPresetById('dc-steady-state-rlc')!.document);
		expect(rlcDcSol.branches['C1'].current.re).toBeCloseTo(0, 9);
		expect(rlcDcSol.branches['C1'].voltage.re).toBeCloseTo(12, 9);
		expect(rlcDcSol.branches['L1'].voltage.re).toBeCloseTo(0, 9);
		expect(rlcDcSol.branches['L1'].current.re).toBeCloseTo(3, 9);

		// 7. DC Dependent Source (VCVS): V(R1) = 6 V, V(R2) = 10 V, V(E1) = 12 V, I(R3) = -1 mA
		const depSol = solveMNA(getPresetById('dc-dependent-vcvs')!.document);
		expect(depSol.branches['R1'].voltage.re).toBeCloseTo(6, 9);
		expect(depSol.branches['R2'].voltage.re).toBeCloseTo(10, 9);
		expect(depSol.branches['E1'].voltage.re).toBeCloseTo(12, 9);
		expect(depSol.branches['R3'].current.re).toBeCloseTo(-0.001, 9);
	});

	it('matches exact analytical solution on ac-impedance-supernode preset', () => {
		const preset = getPresetById('ac-impedance-supernode')!;
		const full = solveCircuit(preset.document, {
			theveninTarget: preset.theveninLoadId
				? { kind: 'component', componentId: preset.theveninLoadId }
				: undefined
		});

		expect(full.mna.valid).toBe(true);
		expect(full.mna.powerBalance.balanced).toBe(true);
		expect(Math.abs(full.mna.powerBalance.totalRealPower)).toBeLessThan(1e-10);
		expect(Math.abs(full.mna.powerBalance.totalReactivePower)).toBeLessThan(1e-10);
		expect(full.allVerified).toBe(true);
		expect(full.maxDiscrepancy).toBeLessThan(1e-8);

		// Analytical: V(B) = -((0.4 + j0.8) / (1.4 + j1.3)) * 10
		const expectedVN2 = Complex.from(0.4, 0.8)
			.div(Complex.from(1.4, 1.3))
			.scale(-10);
		const expectedVN3 = expectedVN2.add(Complex.from(10, 0));

		const vN2 = full.mna.nodeVoltages['B'].voltage;
		const vN3 = full.mna.nodeVoltages['C'].voltage;
		expect(vN2.sub(expectedVN2).abs()).toBeLessThan(1e-12);
		expect(vN3.sub(expectedVN3).abs()).toBeLessThan(1e-12);
		expect(full.mna.branches['C1'].impedance?.equals(Complex.j(-1), 1e-12)).toBe(true);
		expect(full.mna.branches['C2'].impedance?.equals(Complex.j(-1), 1e-12)).toBe(true);
		expect(full.mna.branches['L1'].impedance?.equals(Complex.j(1), 1e-12)).toBe(true);
	});
});
