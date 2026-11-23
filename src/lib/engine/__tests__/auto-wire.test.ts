import { describe, expect, it } from 'vitest';
import { PRESETS, getPresetById } from '$lib/data/presets';
import {
	autoWireDocument,
	buildElectricalGraph,
	getPinPositions,
	solveMNA,
	type CircuitDocument,
	type CircuitWire
} from '../index';

function stripWires(doc: CircuitDocument): CircuitDocument {
	return {
		...doc,
		components: doc.components.map((c) => ({ ...c })),
		wires: []
	};
}

function getComponentInteriorCells(doc: CircuitDocument): Set<string> {
	const cells = new Set<string>();
	for (const comp of doc.components) {
		if (comp.kind === 'ground' || comp.kind === 'terminal') continue;
		const [p0, p1] = getPinPositions(comp);
		if (p0.y === p1.y) {
			const minX = Math.min(p0.x, p1.x);
			const maxX = Math.max(p0.x, p1.x);
			for (let x = minX + 1; x < maxX; x++) {
				cells.add(`${x},${p0.y}`);
			}
		} else if (p0.x === p1.x) {
			const minY = Math.min(p0.y, p1.y);
			const maxY = Math.max(p0.y, p1.y);
			for (let y = minY + 1; y < maxY; y++) {
				cells.add(`${p0.x},${y}`);
			}
		}
	}
	return cells;
}

function assertWiresAvoidInteriorCells(doc: CircuitDocument, wires: CircuitWire[]): void {
	const interiors = getComponentInteriorCells(doc);
	for (const wire of wires) {
		for (let i = 0; i + 1 < wire.points.length; i++) {
			const a = wire.points[i];
			const b = wire.points[i + 1];
			// Every wire segment must be orthogonal
			expect(a.x === b.x || a.y === b.y).toBe(true);
			if (a.y === b.y) {
				const minX = Math.min(a.x, b.x);
				const maxX = Math.max(a.x, b.x);
				for (let x = minX; x <= maxX; x++) {
					expect(interiors.has(`${x},${a.y}`)).toBe(false);
				}
			} else {
				const minY = Math.min(a.y, b.y);
				const maxY = Math.max(a.y, b.y);
				for (let y = minY; y <= maxY; y++) {
					expect(interiors.has(`${a.x},${y}`)).toBe(false);
				}
			}
		}
	}
}

function assertNoSelfShorts(doc: CircuitDocument): void {
	const graph = buildElectricalGraph(doc);
	for (const comp of doc.components) {
		if (comp.kind === 'ground' || comp.kind === 'terminal' || comp.kind === 'voltmeter') continue;
		const nodes = graph.componentNodes[comp.id];
		expect(nodes).toHaveLength(2);
		expect(nodes[0]).not.toBe(nodes[1]);
	}
}

describe('algorithmic autoWireDocument', () => {
	it('wires a simple series loop (V1, R1, R2, GND) into an exact voltage divider', () => {
		const doc: CircuitDocument = {
			schemaVersion: 1,
			name: 'Simple Series Divider',
			mode: 'dc',
			frequencyHz: 60,
			components: [
				{ id: 'V1', kind: 'voltage_source', label: 'V1', x: 4, y: 8, rotation: 90, value: '12' },
				{ id: 'R1', kind: 'resistor', label: 'R1', x: 8, y: 4, rotation: 0, value: '2k' },
				{ id: 'R2', kind: 'resistor', label: 'R2', x: 12, y: 8, rotation: 90, value: '4k' },
				{ id: 'G1', kind: 'ground', label: 'GND', x: 4, y: 12, rotation: 0, value: '0' }
			],
			wires: []
		};

		const result = autoWireDocument(doc);
		expect(result.skippedReason).toBeUndefined();
		expect(result.addedWires.length).toBeGreaterThanOrEqual(3);
		expect(result.connectionsAdded).toBe(result.addedWires.length);

		const wired: CircuitDocument = { ...doc, wires: result.wires };
		assertNoSelfShorts(wired);
		assertWiresAvoidInteriorCells(wired, result.addedWires);

		const mna = solveMNA(wired);
		expect(mna.valid).toBe(true);
		expect(mna.powerBalance.balanced).toBe(true);

		// V1 = 12 V, R1 = 2k, R2 = 4k -> V(R2) = 8 V, I = 2 mA
		expect(Math.abs(mna.branches['R1'].voltage.re)).toBeCloseTo(4, 6);
		expect(Math.abs(mna.branches['R2'].voltage.re)).toBeCloseTo(8, 6);
		expect(Math.abs(mna.branches['R2'].current.re)).toBeCloseTo(0.002, 6);
	});

	it('reconstructs Preset 1 (dc-divider) from zero wires with exact A = 12 V and B = 8 V', () => {
		const preset = getPresetById('dc-divider')!;
		const unwired = stripWires(preset.document);

		const result = autoWireDocument(unwired);
		expect(result.skippedReason).toBeUndefined();
		expect(result.addedWires.length).toBeGreaterThan(0);

		const wired: CircuitDocument = { ...unwired, wires: result.wires };
		assertNoSelfShorts(wired);
		assertWiresAvoidInteriorCells(wired, result.addedWires);

		const mna = solveMNA(wired);
		expect(mna.valid).toBe(true);
		expect(mna.powerBalance.balanced).toBe(true);
		expect(
			mna.diagnostics.filter((d) => d.code === 'FLOATING_SUBCIRCUIT' || d.code === 'SHORTED_COMPONENT')
		).toHaveLength(0);

		expect(mna.nodeVoltages['A']?.voltage.re).toBeCloseTo(12, 6);
		expect(mna.nodeVoltages['B']?.voltage.re).toBeCloseTo(8, 6);
	});

	it('auto-wires parallel branches and multi-source presets (supernode, superposition, wheatstone, AC) into valid power-balanced circuits', () => {
		for (const preset of PRESETS) {
			const originalMna = solveMNA(preset.document);
			const unwired = stripWires(preset.document);
			const result = autoWireDocument(unwired);

			expect(result.skippedReason, `preset ${preset.id}`).toBeUndefined();
			expect(result.addedWires.length, `preset ${preset.id}`).toBeGreaterThan(0);

			const wired: CircuitDocument = { ...unwired, wires: result.wires };
			assertNoSelfShorts(wired);
			assertWiresAvoidInteriorCells(wired, result.addedWires);

			const mna = solveMNA(wired);
			expect(mna.valid, `preset ${preset.id} MNA valid`).toBe(true);
			expect(mna.powerBalance.balanced, `preset ${preset.id} power balanced`).toBe(true);
			expect(
				mna.diagnostics.filter((d) => d.code === 'FLOATING_SUBCIRCUIT'),
				`preset ${preset.id} zero floating nodes`
			).toHaveLength(0);

			// Verify exact electrical equivalence against the original hand-wired preset
			for (const comp of preset.document.components) {
				if (comp.kind === 'ground' || comp.kind === 'terminal') continue;
				const origBranch = originalMna.branches[comp.id];
				const autoBranch = mna.branches[comp.id];
				expect(autoBranch, `preset ${preset.id} branch ${comp.id}`).toBeDefined();
				expect(autoBranch.voltage.re, `${preset.id} ${comp.id} V.re`).toBeCloseTo(
					origBranch.voltage.re,
					5
				);
				expect(autoBranch.voltage.im, `${preset.id} ${comp.id} V.im`).toBeCloseTo(
					origBranch.voltage.im,
					5
				);
				expect(autoBranch.current.re, `${preset.id} ${comp.id} I.re`).toBeCloseTo(
					origBranch.current.re,
					5
				);
				expect(autoBranch.current.im, `${preset.id} ${comp.id} I.im`).toBeCloseTo(
					origBranch.current.im,
					5
				);
			}
		}
	});

	it('detours cleanly around a component body sitting directly between two pins', () => {
		// V1 and R1 sit horizontally in a line at y=6:
		// V1+ is (2,6), V1 body is (3..5,6), V1- is (6,6), R1.a is (8,6), R1 body is (9..11,6), R1.b is (12,6).
		// V1- connects straight to R1.a, while V1+ (2,6) MUST detour around BOTH bodies & foreign pins to reach R1.b (12,6).
		const doc: CircuitDocument = {
			schemaVersion: 1,
			name: 'Obstacle Detour Test',
			mode: 'dc',
			frequencyHz: 60,
			components: [
				{ id: 'V1', kind: 'voltage_source', label: 'V1', x: 4, y: 6, rotation: 0, value: '10' },
				{ id: 'R1', kind: 'resistor', label: 'R1', x: 10, y: 6, rotation: 0, value: '5k' },
				{ id: 'G1', kind: 'ground', label: 'GND', x: 2, y: 6, rotation: 0, value: '0' }
			],
			wires: []
		};

		const result = autoWireDocument(doc);
		expect(result.addedWires.length).toBe(2);

		const wired: CircuitDocument = { ...doc, wires: result.wires };
		assertNoSelfShorts(wired);
		assertWiresAvoidInteriorCells(wired, result.addedWires);

		// Detour wire connecting (2,6) to (12,6) must have bends (length >= 4 vertices)
		const hasDetourWire = result.addedWires.some((w) => w.points.length >= 4);
		expect(hasDetourWire).toBe(true);

		const mna = solveMNA(wired);
		expect(mna.valid).toBe(true);
		expect(mna.powerBalance.balanced).toBe(true);
		expect(Math.abs(mna.branches['R1'].voltage.re)).toBeCloseTo(10, 6);
		expect(Math.abs(mna.branches['R1'].current.re)).toBeCloseTo(0.002, 6);
	});

	it('respects existing user wires without deleting or overwriting them', () => {
		const preset = getPresetById('dc-divider')!;
		const existingWire: CircuitWire = {
			id: 'user_w1',
			points: [
				{ x: 4, y: 6 },
				{ x: 4, y: 4 },
				{ x: 6, y: 4 }
			]
		};
		const partialDoc: CircuitDocument = {
			...stripWires(preset.document),
			wires: [existingWire]
		};

		const result = autoWireDocument(partialDoc);
		expect(result.addedWires.length).toBeGreaterThan(0);

		// Existing user wire is preserved untouched as first entry
		expect(result.wires[0]).toEqual(existingWire);
		expect(result.addedWires.every((w) => w.id !== 'user_w1')).toBe(true);

		const wired: CircuitDocument = { ...partialDoc, wires: result.wires };
		assertNoSelfShorts(wired);
		assertWiresAvoidInteriorCells(wired, result.addedWires);

		const mna = solveMNA(wired);
		expect(mna.valid).toBe(true);
		expect(mna.nodeVoltages['A']?.voltage.re).toBeCloseTo(12, 6);
		expect(mna.nodeVoltages['B']?.voltage.re).toBeCloseTo(8, 6);
	});

	it('is idempotent on already-connected Preset 1 and all other presets', () => {
		for (const preset of PRESETS) {
			const result = autoWireDocument(preset.document);
			expect(result.addedWires, `preset ${preset.id}`).toHaveLength(0);
			expect(result.connectionsAdded, `preset ${preset.id}`).toBe(0);
			expect(result.skippedReason, `preset ${preset.id}`).toBe('already_connected');
			expect(result.wires, `preset ${preset.id}`).toHaveLength(preset.document.wires.length);
		}
	});

	it('handles 0 or 1 component cleanly without throwing', () => {
		const emptyDoc: CircuitDocument = {
			schemaVersion: 1,
			name: 'Empty',
			mode: 'dc',
			frequencyHz: 60,
			components: [],
			wires: []
		};
		const emptyRes = autoWireDocument(emptyDoc);
		expect(emptyRes.addedWires).toHaveLength(0);
		expect(emptyRes.connectionsAdded).toBe(0);
		expect(emptyRes.skippedReason).toBe('too_few_components');

		const singleDoc: CircuitDocument = {
			...emptyDoc,
			components: [
				{ id: 'R1', kind: 'resistor', label: 'R1', x: 6, y: 6, rotation: 0, value: '1k' }
			]
		};
		const singleRes = autoWireDocument(singleDoc);
		expect(singleRes.addedWires).toHaveLength(0);
		expect(singleRes.connectionsAdded).toBe(0);
		expect(singleRes.skippedReason).toBe('too_few_components');
	});

	it('ignores placed voltmeters in Phase A while routing circuit wires cleanly around them', () => {
		// Unwired simple divider with an unconnected voltmeter placed directly in the middle
		const doc: CircuitDocument = {
			schemaVersion: 1,
			name: 'Divider with Placed Voltmeter',
			mode: 'dc',
			frequencyHz: 60,
			components: [
				{ id: 'V1', kind: 'voltage_source', label: 'V1', x: 4, y: 8, rotation: 90, value: '12' },
				{ id: 'R1', kind: 'resistor', label: 'R1', x: 10, y: 4, rotation: 0, value: '2k' },
				{ id: 'R2', kind: 'resistor', label: 'R2', x: 16, y: 8, rotation: 90, value: '4k' },
				{ id: 'G1', kind: 'ground', label: 'GND', x: 4, y: 12, rotation: 0, value: '0' },
				// Voltmeter placed in the interior of the loop
				{ id: 'VM1', kind: 'voltmeter', label: 'VM1', x: 10, y: 8, rotation: 0, value: '0' }
			],
			wires: []
		};

		const result = autoWireDocument(doc);
		expect(result.addedWires.length).toBeGreaterThan(0);

		const wired: CircuitDocument = { ...doc, wires: result.wires };
		assertNoSelfShorts(wired);
		assertWiresAvoidInteriorCells(wired, result.addedWires);

		// Voltmeter remains unwired (not accidentally wired in series with loads)
		const graph = buildElectricalGraph(wired);
		expect(graph.componentNodes['VM1']).toEqual(['', '']);

		// Underlying circuit solves cleanly with expected divider voltage (8 V)
		const mna = solveMNA(wired);
		expect(mna.valid).toBe(true);
		expect(mna.branches['R2'].voltage.abs()).toBeCloseTo(8, 6);
	});
});
