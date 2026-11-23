import { beforeEach, describe, expect, it } from 'vitest';
import { circuit } from './circuit.svelte';

beforeEach(() => {
	circuit.resetToDefault();
});

describe('dependent-source control nodes', () => {
	it('keep sensing the same physical node when node IDs are renumbered', () => {
		// dc-divider preset (V1 12 V, R1 2k, R2 6k || R3 12k). Add a VCCS (0.1 mS) across R3 sensing
		// the R2 top node vs ground, wired in parallel with R3.
		const ctrlNode = circuit.graph.componentNodes['R2'][0];
		const gnd = circuit.graph.componentNodes['G1'][0];
		const g = circuit.addComponent('vccs', 22, 8, { rotation: 90 });
		circuit.addWire([
			{ x: 18, y: 4 },
			{ x: 22, y: 4 },
			{ x: 22, y: 6 }
		]);
		circuit.addWire([
			{ x: 22, y: 10 },
			{ x: 18, y: 10 }
		]);
		circuit.updateComponent(g.id, { value: '0.1m' });
		circuit.updateComponentControlRef(g.id, { controlNodePos: ctrlNode, controlNodeNeg: gnd });
		expect(circuit.solution.mna.valid).toBe(true);
		const iBefore = circuit.solution.mna.branches[g.id].current.re;
		expect(Math.abs(iBefore)).toBeGreaterThan(0);

		// An unrelated part above everything becomes the topmost node and renumbers A, B, ...
		circuit.addComponent('resistor', 4, -10);
		const nodeAfter = circuit.graph.componentNodes['R2'][0];
		expect(nodeAfter).not.toBe(ctrlNode);
		const ref = circuit.document.components.find((c) => c.id === g.id)!.controlRef!;
		expect(ref.controlNodePos).toBe(nodeAfter);

		// Same answer once the stray part is removed again (it only renumbered nodes)
		const stray = circuit.document.components[circuit.document.components.length - 1];
		circuit.deleteComponent(stray.id);
		expect(circuit.solution.mna.branches[g.id].current.re).toBeCloseTo(iBefore, 12);
	});
});
