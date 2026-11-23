import { beforeEach, describe, expect, it } from 'vitest';
import { PRESETS } from '$lib/data/presets';
import { circuit } from './circuit.svelte';

// dc-divider preset: A = V1.0/R1.0, B = R1.1/R2.0/R3.0 (R2 || R3 to ground)
beforeEach(() => {
	circuit.resetToDefault();
});

describe('circuit.renameNode', () => {
	it('renames a node, keeps the others on letters, and clears back to the auto letter', () => {
		expect(circuit.graph.nonRefNodeIds).toEqual(['A', 'B']);
		expect(circuit.renameNode('B', 'Vo')).toBeNull();
		expect(circuit.graph.nonRefNodeIds).toEqual(['A', 'Vo']);
		expect(circuit.solution.mna.nodeVoltages['Vo'].voltage.re).toBeCloseTo(8, 9);

		expect(circuit.renameNode('Vo', '')).toBeNull();
		expect(circuit.graph.nonRefNodeIds).toEqual(['A', 'B']);
		expect(circuit.document.nodeNames).toBeUndefined();
	});

	it('replaces an earlier name on the same node instead of stacking entries', () => {
		circuit.renameNode('B', 'Vo');
		circuit.renameNode('Vo', 'Vout');
		expect(circuit.graph.nonRefNodeIds).toEqual(['A', 'Vout']);
		expect(circuit.document.nodeNames).toHaveLength(1);
	});

	it('returns an error and changes nothing for invalid names, the reference node, and unknown nodes', () => {
		const before = circuit.document.nodeNames;
		for (const bad of ['0', 'gnd', '1A', 'a b', 'ABCDEFG', 'A']) {
			expect(circuit.renameNode('B', bad)).toEqual(expect.any(String));
		}
		expect(circuit.renameNode('0', 'Ref')).toEqual(expect.any(String));
		expect(circuit.renameNode('ZZ', 'Q')).toEqual(expect.any(String));
		expect(circuit.document.nodeNames).toBe(before);
		expect(circuit.canUndo).toBe(false);
	});

	it('is undoable and redoable', () => {
		circuit.renameNode('B', 'Vo');
		expect(circuit.undo()).toBe(true);
		expect(circuit.graph.nonRefNodeIds).toEqual(['A', 'B']);
		expect(circuit.redo()).toBe(true);
		expect(circuit.graph.nonRefNodeIds).toEqual(['A', 'Vo']);
	});

	it('keeps the name on the same physical node when the layout renumbers the others', () => {
		circuit.renameNode('B', 'Vo');
		circuit.addComponent('resistor', 4, -10); // new topmost node takes letter A
		expect(circuit.graph.componentNodes['R2'][0]).toBe('Vo');
		expect(circuit.graph.nonRefNodeIds).toContain('Vo');
		expect(new Set(circuit.graph.nonRefNodeIds).size).toBe(circuit.graph.nonRefNodeIds.length);
	});

	it('keeps a node_voltage constraint, and Thevenin terminals on the renamed node', () => {
		circuit.setUnknownProblem({
			componentId: 'V1',
			symbol: 'V',
			constraint: { kind: 'node_voltage', targetId: 'B', value: '8' }
		});
		circuit.setTheveninTerminals('B', '0');
		expect(circuit.solution.unknownSolution?.valid).toBe(true);
		expect(circuit.solution.unknownSolution?.solutions[0].value.re).toBeCloseTo(12, 9);

		expect(circuit.renameNode('B', 'Vo')).toBeNull();
		expect(circuit.graph.nonRefNodeIds).toContain('Vo');
		expect(circuit.solution.unknownSolution?.valid).toBe(true);
		expect(circuit.solution.unknownSolution?.solutions[0].value.re).toBeCloseTo(12, 9);
		const tt = circuit.theveninTarget;
		expect(tt?.kind === 'terminals' && tt.nodeA).toBe('Vo');

		// Rename again and then clear: still solves
		circuit.renameNode('Vo', 'Out');
		circuit.renameNode('Out', '');
		expect(circuit.solution.unknownSolution?.valid).toBe(true);
		expect(circuit.solution.unknownSolution?.solutions[0].value.re).toBeCloseTo(12, 9);
	});
});

describe('circuit.renameNode with node-referencing dependent sources', () => {
	it('keeps a control-node reference (loaded without pin anchors) on the renamed node', () => {
		const base = PRESETS.find((p) => p.id === 'dc-dependent-vcvs')!.document;
		circuit.loadDocument({
			...structuredClone(base),
			components: structuredClone(base.components).map((c) =>
				c.id === 'E1'
					? { ...c, controlRef: { controlNodePos: 'A', controlNodeNeg: '0', controlPolarity: 1 as const } }
					: c
			)
		});
		expect(circuit.solution.mna.valid).toBe(true);
		const before = circuit.solution.mna.branches['E1'].voltage.re;

		expect(circuit.renameNode('A', 'Vx')).toBeNull();
		const ref = circuit.document.components.find((c) => c.id === 'E1')!.controlRef!;
		expect(ref.controlNodePos).toBe('Vx');
		expect(circuit.solution.mna.valid).toBe(true);
		expect(circuit.solution.mna.branches['E1'].voltage.re).toBeCloseTo(before, 9);
	});
});

describe('deleting the component a node name is anchored to', () => {
	it('re-anchors the name to another pin on the same node', () => {
		circuit.renameNode('B', 'Vo');
		const anchor = circuit.document.nodeNames![0].pin.componentId;
		circuit.deleteComponent(anchor);
		expect(circuit.document.nodeNames).toHaveLength(1);
		expect(circuit.document.nodeNames![0].pin.componentId).not.toBe(anchor);
		expect(circuit.graph.nonRefNodeIds).toContain('Vo');
	});

	it('drops the entry when the node has no other pin', () => {
		const r = circuit.addComponent('resistor', 4, -10);
		const nodeId = circuit.graph.componentNodes[r.id][0];
		expect(circuit.renameNode(nodeId, 'Lone')).toBeNull();
		expect(circuit.graph.nonRefNodeIds).toContain('Lone');
		circuit.deleteComponent(r.id);
		expect(circuit.document.nodeNames).toBeUndefined();
		expect(circuit.graph.nonRefNodeIds).not.toContain('Lone');
	});
});
