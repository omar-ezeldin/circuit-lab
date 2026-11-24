import { beforeEach, describe, expect, it } from 'vitest';
import { PRESETS } from '$lib/data/presets';
import { buildElectricalGraph, type CircuitDocument } from '$lib/engine';
import { computeWireCrossings } from '$lib/components/editor/helpers';
import { circuit } from './circuit.svelte';
import { settings } from './settings.svelte';

beforeEach(() => {
	settings.reset();
	circuit.resetToDefault();
});

describe('circuit reactive store', () => {
	it('loads PRESETS[0] on startup with valid MNA and Thévenin solution', () => {
		expect(circuit.document.id).toBe(PRESETS[0].id);
		expect(circuit.document.components.length).toBeGreaterThan(0);
		expect(circuit.solution.mna.valid).toBe(true);
		expect(circuit.theveninTarget).toEqual({ kind: 'component', componentId: 'R3' });
		expect(circuit.solution.theveninNorton).toBeDefined();
		expect(circuit.solution.allVerified).toBe(true);
		expect(circuit.canUndo).toBe(false);
		expect(circuit.canRedo).toBe(false);
	});

	it('adds components with unique IDs and canonical labels (R1, R2, V1, C1, L1, I1, GND1, TA/TB)', () => {
		circuit.clearCircuit();
		expect(circuit.document.components).toHaveLength(0);

		const r1 = circuit.addComponent('resistor', 4, 4);
		const r2 = circuit.addComponent('resistor', 8, 4);
		const v1 = circuit.addComponent('voltage_source', 2, 6, { rotation: 90 });
		const c1 = circuit.addComponent('capacitor', 12, 6, { rotation: 90 });
		const l1 = circuit.addComponent('inductor', 16, 4);
		const i1 = circuit.addComponent('current_source', 20, 6, { rotation: 270 });
		const g1 = circuit.addComponent('ground', 2, 8);
		const ta = circuit.addComponent('terminal', 22, 4);
		const tb = circuit.addComponent('terminal', 22, 8);

		expect(r1.label).toBe('R1');
		expect(r2.label).toBe('R2');
		expect(v1.label).toBe('V1');
		expect(c1.label).toBe('C1');
		expect(l1.label).toBe('L1');
		expect(i1.label).toBe('I1');
		expect(g1.label).toBe('GND1');
		expect(ta.label).toBe('TA');
		expect(ta.terminalName).toBe('A');
		expect(tb.label).toBe('TB');
		expect(tb.terminalName).toBe('B');
		expect(circuit.selectedComponentId).toBe(tb.id);
	});

	it('moves, rotates, updates, and deletes components and wires reactively', () => {
		circuit.clearCircuit();

		const v1 = circuit.addComponent('voltage_source', 4, 6, { rotation: 90, value: '12' });
		const r1 = circuit.addComponent('resistor', 10, 6, { rotation: 90, value: '4k' });
		const gnd = circuit.addComponent('ground', 4, 8);

		// Move R1 to (8, 6)
		circuit.moveComponent(r1.id, 8, 6);
		expect(circuit.document.components.find((c) => c.id === r1.id)).toMatchObject({ x: 8, y: 6 });

		// Rotate placement & component
		expect(circuit.placementRotation).toBe(0);
		circuit.rotateComponent(); // rotates placementRotation when no id
		expect(circuit.placementRotation).toBe(90);
		circuit.rotateComponent(r1.id);
		expect(circuit.document.components.find((c) => c.id === r1.id)?.rotation).toBe(180);
		circuit.rotateComponent(r1.id);
		circuit.rotateComponent(r1.id);
		circuit.rotateComponent(r1.id);
		expect(circuit.document.components.find((c) => c.id === r1.id)?.rotation).toBe(90);

		// Connect circuit with orthogonal wires: V1(4,4)->(8,4) and (4,8)->(8,8)
		const w1 = circuit.addWire([
			{ x: 4, y: 4 },
			{ x: 8, y: 4 }
		]);
		const w2 = circuit.addWire([
			{ x: 4, y: 8 },
			{ x: 8, y: 8 }
		]);
		expect(w1).not.toBeNull();
		expect(w2).not.toBeNull();

		// Zero-length and duplicate wires are ignored
		expect(
			circuit.addWire([
				{ x: 4, y: 4 },
				{ x: 4, y: 4 }
			])
		).toBeNull();
		expect(
			circuit.addWire([
				{ x: 4, y: 4 },
				{ x: 8, y: 4 }
			])
		).toBeNull();

		// Reactive solution updates automatically
		expect(circuit.solution.mna.valid).toBe(true);
		const branchR1 = circuit.solution.mna.branches[r1.id];
		expect(branchR1.voltage.re).toBeCloseTo(12, 8);
		expect(branchR1.current.re).toBeCloseTo(0.003, 8); // 12 V / 4 kΩ = 3 mA

		// Update resistor value to 6k -> current becomes 2 mA
		circuit.updateComponent(r1.id, { value: '6k' });
		expect(circuit.solution.mna.valid).toBe(true);
		expect(circuit.solution.mna.branches[r1.id].current.re).toBeCloseTo(0.002, 8);

		// Delete selected wire
		circuit.selectWire(w1!.id);
		circuit.deleteSelected();
		expect(circuit.document.wires).toHaveLength(1);
		expect(circuit.selectedWireId).toBeNull();

		// Delete selected component
		circuit.selectComponent(v1.id);
		circuit.deleteSelected();
		expect(circuit.document.components.some((c) => c.id === v1.id)).toBe(false);
		expect(circuit.selectedComponentId).toBeNull();
		expect(gnd.id).toBe('GND1');
	});

	it('maintains undo/redo history up to 50 snapshots and reconciles Thévenin target', () => {
		const initialR3 = circuit.document.components.find((c) => c.id === 'R3')!;
		expect(initialR3.value).toBe('12k');

		circuit.updateComponent('R3', { value: '24k' });
		expect(circuit.canUndo).toBe(true);
		expect(circuit.canRedo).toBe(false);
		expect(circuit.document.components.find((c) => c.id === 'R3')?.value).toBe('24k');

		// Delete R3 -> clears theveninTarget
		circuit.selectComponent('R3');
		circuit.deleteSelected();
		expect(circuit.theveninTarget).toBeUndefined();
		expect(circuit.document.components.find((c) => c.id === 'R3')).toBeUndefined();

		// Undo deletion -> restores R3 and theveninTarget
		expect(circuit.undo()).toBe(true);
		expect(circuit.document.components.find((c) => c.id === 'R3')?.value).toBe('24k');
		expect(circuit.theveninTarget).toEqual({ kind: 'component', componentId: 'R3' });
		expect(circuit.canRedo).toBe(true);

		// Undo value edit -> back to 12k
		expect(circuit.undo()).toBe(true);
		expect(circuit.document.components.find((c) => c.id === 'R3')?.value).toBe('12k');
		expect(circuit.canUndo).toBe(false);

		// Redo value edit -> 24k
		expect(circuit.redo()).toBe(true);
		expect(circuit.document.components.find((c) => c.id === 'R3')?.value).toBe('24k');

		// Cap at 50 snapshots
		for (let i = 0; i < 60; i++) {
			circuit.updateComponent('R1', { value: `${i + 1}k` });
		}
		let undoCount = 0;
		while (circuit.undo()) {
			undoCount++;
		}
		expect(undoCount).toBe(50);
	});

	it('switches DC/AC mode, updates frequency, loads presets, and toggles Thévenin target', () => {
		const acPreset = PRESETS.find((p) => p.category === 'ac')!;
		expect(circuit.loadPreset(acPreset.id)).toBe(true);
		expect(circuit.document.mode).toBe('ac');
		expect(circuit.document.frequencyHz).toBe(acPreset.document.frequencyHz);
		expect(circuit.solution.mna.valid).toBe(true);
		expect(circuit.activeMethod).toBe(acPreset.featuredMethod);

		circuit.setFrequency(2000);
		expect(circuit.document.frequencyHz).toBe(2000);
		expect(circuit.solution.mna.frequencyHz).toBe(2000);
		expect(circuit.solution.mna.valid).toBe(true);

		circuit.setMode('dc');
		expect(circuit.document.mode).toBe('dc');
		expect(circuit.solution.mna.valid).toBe(true);

		circuit.clearTheveninTarget();
		expect(circuit.theveninTarget).toBeUndefined();
		circuit.setTheveninComponent('R1');
		expect(circuit.theveninTarget).toEqual({ kind: 'component', componentId: 'R1' });
		expect(circuit.solution.theveninNorton?.loadComponentId).toBe('R1');
	});

	it('manages emptyBannerDismissed lifecycle and accepts full TheveninTarget in loadDocument', () => {
		expect(circuit.emptyBannerDismissed).toBe(false);

		circuit.clearCircuit();
		expect(circuit.document.components).toHaveLength(0);
		expect(circuit.emptyBannerDismissed).toBe(true);

		circuit.resetEmptyBanner();
		expect(circuit.emptyBannerDismissed).toBe(false);

		circuit.dismissEmptyBanner();
		expect(circuit.emptyBannerDismissed).toBe(true);

		// Loading a non-empty document resets emptyBannerDismissed and applies TheveninTarget
		circuit.loadDocument(PRESETS[0].document, {
			kind: 'terminals',
			nodeA: 'A',
			nodeB: '0'
		});
		expect(circuit.emptyBannerDismissed).toBe(false);
		expect(circuit.theveninTarget).toMatchObject({ kind: 'terminals', nodeA: 'A', nodeB: '0' });

		// Loading with component TheveninTarget
		circuit.loadDocument(PRESETS[0].document, {
			kind: 'component',
			componentId: 'R2'
		});
		expect(circuit.theveninTarget).toEqual({ kind: 'component', componentId: 'R2' });

		// Backwards-compatible string ID still works
		circuit.loadDocument(PRESETS[0].document, 'R3');
		expect(circuit.theveninTarget).toEqual({ kind: 'component', componentId: 'R3' });

		// Loading a document always resets any armed placement/wire tool back to 'select'
		circuit.activeTool = 'resistor';
		expect(circuit.activeTool).toBe('resistor');
		circuit.loadDocument(PRESETS[0].document);
		expect(circuit.activeTool).toBe('select');

		circuit.activeTool = 'wire';
		expect(circuit.loadPreset(PRESETS[1].id)).toBe(true);
		expect(circuit.activeTool).toBe('select');

		// documentLoadSeq increments on loadDocument even when doc.id is undefined (e.g. AI import / share URL)
		const seqBefore = circuit.documentLoadSeq;
		const { id: _omittedId, ...docWithoutId } = PRESETS[0].document;
		expect('id' in docWithoutId).toBe(false);
		circuit.loadDocument(docWithoutId);
		expect(circuit.document.id).toBeUndefined();
		expect(circuit.documentLoadSeq).toBe(seqBefore + 1);

		// Reloading another id-less document also increments documentLoadSeq
		circuit.loadDocument(docWithoutId);
		expect(circuit.documentLoadSeq).toBe(seqBefore + 2);

		// resetToDefault also increments documentLoadSeq
		circuit.resetToDefault();
		expect(circuit.documentLoadSeq).toBe(seqBefore + 3);
	});

	it('manages multi-term unknown linking, multiplier updates, unlinking, applySolvedUnknown + single undo, and deleteComponent cleanup', () => {
		circuit.loadDocument({
			schemaVersion: 1,
			name: 'Multi Unknown Store Test',
			mode: 'dc',
			frequencyHz: 60,
			components: [
				{ id: 'V1', kind: 'voltage_source', label: 'V1', x: 0, y: 4, rotation: 90, value: '5' },
				{ id: 'R1', kind: 'resistor', label: 'R1', x: 2, y: 2, rotation: 0, value: '2k' },
				{ id: 'R2', kind: 'resistor', label: 'R2', x: 4, y: 4, rotation: 90, value: '4k' },
				{ id: 'R3', kind: 'resistor', label: 'R3', x: 6, y: 2, rotation: 0, value: '2k' },
				{ id: 'V2', kind: 'voltage_source', label: 'V2', x: 8, y: 4, rotation: 90, value: '5' },
				{ id: 'G1', kind: 'ground', label: 'GND', x: 0, y: 6, rotation: 0, value: '0' }
			],
			wires: [{ id: 'w_gnd', points: [{ x: 0, y: 6 }, { x: 8, y: 6 }] }]
		});

		circuit.setUnknownProblem({
			componentId: 'V1',
			symbol: 'V',
			terms: [{ componentId: 'V1', multiplier: 1 }],
			constraint: { kind: 'branch_current', targetId: 'R2', value: '3m', label: 'I_o' }
		});

		// Incompatible passive component cannot be linked to source unknown
		circuit.linkComponentToUnknown('R1', 2);
		expect(circuit.document.unknownProblem?.terms).toHaveLength(1);

		// Link compatible voltage source V2 with multiplier 2 -> V1 = V = 10 V, V2 = 2V = 20 V
		circuit.linkComponentToUnknown('V2', 1);
		circuit.setUnknownTermMultiplier('V2', 2);
		expect(circuit.document.unknownProblem?.terms).toEqual([
			{ componentId: 'V1', multiplier: 1 },
			{ componentId: 'V2', multiplier: 2 }
		]);
		expect(circuit.solution.unknownSolution?.valid).toBe(true);
		expect(circuit.solution.unknownSolution?.solutions[0].value.re).toBeCloseTo(10, 9);
		expect(circuit.solution.unknownSolution?.solutions[0].termValues?.[1].value.re).toBeCloseTo(20, 9);

		// applySolvedUnknown writes BOTH scaled values and clears unknownProblem in ONE undoable step
		expect(circuit.applySolvedUnknown(0)).toBe(true);
		expect(circuit.document.unknownProblem).toBeUndefined();
		expect(circuit.document.components.find((c) => c.id === 'V1')?.value).toBe('10');
		expect(circuit.document.components.find((c) => c.id === 'V2')?.value).toBe('20');

		// Single undo restores both original values and unknownProblem.terms
		expect(circuit.undo()).toBe(true);
		expect(circuit.document.unknownProblem?.terms).toEqual([
			{ componentId: 'V1', multiplier: 1 },
			{ componentId: 'V2', multiplier: 2 }
		]);
		expect(circuit.document.components.find((c) => c.id === 'V1')?.value).toBe('5');
		expect(circuit.document.components.find((c) => c.id === 'V2')?.value).toBe('5');

		// Unlink primary V1 -> promotes V2 to primary componentId
		circuit.unlinkComponentFromUnknown('V1');
		expect(circuit.document.unknownProblem?.componentId).toBe('V2');
		expect(circuit.document.unknownProblem?.terms).toEqual([{ componentId: 'V2', multiplier: 2 }]);

		// Undo unlink, then delete V1 -> promotes V2 cleanly instead of clearing entire unknownProblem
		expect(circuit.undo()).toBe(true);
		circuit.deleteComponent('V1');
		expect(circuit.document.unknownProblem?.componentId).toBe('V2');
		expect(circuit.document.unknownProblem?.terms).toEqual([{ componentId: 'V2', multiplier: 2 }]);

		// Deleting last remaining unknown component V2 clears unknownProblem
		circuit.deleteComponent('V2');
		expect(circuit.document.unknownProblem).toBeUndefined();
	});

	it('keeps node-voltage and terminal targets on the same physical node when nodes are renumbered', () => {
		// dc-divider preset: target the node on R3's top pin
		const nodeBefore = circuit.graph.componentNodes['R3'][0];
		circuit.setUnknownProblem({
			componentId: 'V1',
			symbol: 'V',
			constraint: { kind: 'node_voltage', targetId: nodeBefore, value: '8' }
		});
		const groundNode = circuit.graph.componentNodes['G1'][0];
		circuit.setTheveninTerminals(nodeBefore, groundNode);

		// A part placed above everything becomes the topmost node and shifts A, B, ...
		circuit.addComponent('resistor', 4, -10);
		const nodeAfter = circuit.graph.componentNodes['R3'][0];
		expect(nodeAfter).not.toBe(nodeBefore);
		expect(circuit.document.unknownProblem!.constraint.targetId).toBe(nodeAfter);
		const tt = circuit.theveninTarget;
		expect(tt?.kind === 'terminals' && tt.nodeA).toBe(nodeAfter);

		// Deleting the anchor component moves the anchor to another pin of the same node
		const r2Top = circuit.graph.componentNodes['R2'][0];
		expect(r2Top).toBe(nodeAfter); // R2 and R3 share the top node
		circuit.deleteComponent('R3');
		expect(circuit.document.unknownProblem!.constraint.targetId).toBe(
			circuit.graph.componentNodes['R2'][0]
		);
	});

	it('rejects duplicate labels (including ones that render the same) and keeps Thévenin changes in undo history', () => {
		expect(circuit.updateComponent('R2', { label: 'R1' })).toBe(false);
		expect(circuit.updateComponent('R2', { label: 'R-1' })).toBe(false); // renders as R_1
		expect(circuit.document.components.find((c) => c.id === 'R2')!.label).toBe('R2');
		expect(circuit.updateComponent('R2', { label: 'Rload' })).toBe(true);

		expect(circuit.theveninTarget).toEqual({ kind: 'component', componentId: 'R3' });
		circuit.updateComponent('R1', { value: '3k' });
		circuit.setTheveninComponent('R2');
		circuit.undo(); // undoes only the target change
		expect(circuit.theveninTarget).toEqual({ kind: 'component', componentId: 'R3' });
		expect(circuit.document.components.find((c) => c.id === 'R1')!.value).toBe('3k');
		circuit.redo();
		expect(circuit.theveninTarget).toEqual({ kind: 'component', componentId: 'R2' });
	});

	it('auto-wires unlinked components into a valid MNA solution and restores unwired state in a single undo step', () => {
		circuit.clearCircuit();
		circuit.addComponent('voltage_source', 4, 8, { rotation: 90, value: '12' });
		circuit.addComponent('resistor', 8, 4, { rotation: 0, value: '2k' });
		circuit.addComponent('resistor', 12, 8, { rotation: 90, value: '4k' });
		circuit.addComponent('ground', 4, 10, { rotation: 0 });

		expect(circuit.document.wires).toHaveLength(0);
		expect(circuit.solution.mna.valid).toBe(false);

		const res = circuit.autoWireCircuit();
		expect(res.addedWires).toBeGreaterThanOrEqual(3);
		expect(res.reason).toBeUndefined();
		expect(circuit.document.wires).toHaveLength(res.addedWires);
		expect(circuit.solution.mna.valid).toBe(true);
		expect(circuit.solution.mna.powerBalance.balanced).toBe(true);
		expect(circuit.solution.mna.branches['R2'].voltage.re).toBeCloseTo(8, 6);

		// Calling autoWireCircuit again is a no-op and does NOT push a redundant undo snapshot
		const second = circuit.autoWireCircuit();
		expect(second.addedWires).toBe(0);
		expect(second.reason).toBe('already_connected');

		// Single undo restores the unwired state cleanly
		expect(circuit.undo()).toBe(true);
		expect(circuit.document.wires).toHaveLength(0);
		expect(circuit.solution.mna.valid).toBe(false);
	});

	it('toggles orthogonal wire crossings between insulated bridge and connected junction with 1-step undo', () => {
		circuit.loadDocument({
			schemaVersion: 1,
			name: 'Crossing Toggle Test',
			mode: 'dc',
			frequencyHz: 60,
			components: [
				// Horizontal branch pins at (2,6) and (10,6) via terminals
				{ id: 'TA', kind: 'terminal', label: 'TA', terminalName: 'A', x: 2, y: 6, rotation: 0, value: '0' },
				{ id: 'TB', kind: 'terminal', label: 'TB', terminalName: 'B', x: 10, y: 6, rotation: 0, value: '0' },
				// Vertical branch pins at (6,2) and (6,10)
				{ id: 'TC', kind: 'terminal', label: 'TC', terminalName: 'C', x: 6, y: 2, rotation: 0, value: '0' },
				{ id: 'TD', kind: 'terminal', label: 'TD', terminalName: 'D', x: 6, y: 10, rotation: 0, value: '0' }
			],
			wires: [
				{ id: 'wH', points: [{ x: 2, y: 6 }, { x: 10, y: 6 }] },
				{ id: 'wV', points: [{ x: 6, y: 2 }, { x: 6, y: 10 }] }
			]
		});

		// Initially insulated: TA/TB and TC/TD belong to two distinct electrical nodes
		let graph = buildElectricalGraph(circuit.document);
		expect(graph.componentNodes['TA'][0]).toBe(graph.componentNodes['TB'][0]);
		expect(graph.componentNodes['TC'][0]).toBe(graph.componentNodes['TD'][0]);
		expect(graph.componentNodes['TA'][0]).not.toBe(graph.componentNodes['TC'][0]);
		expect(computeWireCrossings(circuit.document.components, circuit.document.wires)).toEqual([
			{ x: 6, y: 6, connected: false, wireIds: ['wH', 'wV'] }
		]);

		// Reject toggling on a component pin or non-crossing point
		expect(circuit.toggleWireCrossing(2, 6)).toBeNull();
		expect(circuit.toggleWireCrossing(3, 3)).toBeNull();

		// 1st toggle -> connect into a single electrical node
		expect(circuit.toggleWireCrossing(6, 6)).toBe('connected');
		graph = buildElectricalGraph(circuit.document);
		expect(graph.componentNodes['TA'][0]).toBe(graph.componentNodes['TC'][0]);
		expect(graph.componentNodes['TB'][0]).toBe(graph.componentNodes['TD'][0]);
		const connectedCrossings = computeWireCrossings(
			circuit.document.components,
			circuit.document.wires
		);
		expect(connectedCrossings).toHaveLength(1);
		expect(connectedCrossings[0].connected).toBe(true);

		// 2nd toggle -> disconnect back into two insulated crossing nets
		expect(circuit.toggleWireCrossing(6, 6)).toBe('disconnected');
		graph = buildElectricalGraph(circuit.document);
		expect(graph.componentNodes['TA'][0]).toBe(graph.componentNodes['TB'][0]);
		expect(graph.componentNodes['TC'][0]).toBe(graph.componentNodes['TD'][0]);
		expect(graph.componentNodes['TA'][0]).not.toBe(graph.componentNodes['TC'][0]);
		const disconnectedCrossings = computeWireCrossings(
			circuit.document.components,
			circuit.document.wires
		);
		expect(disconnectedCrossings).toHaveLength(1);
		expect(disconnectedCrossings[0].connected).toBe(false);
		expect(
			circuit.document.wires.some((w) => w.points.some((pt) => pt.x === 6 && pt.y === 6))
		).toBe(false);

		// 1-step undo reverses disconnect back to connected
		expect(circuit.undo()).toBe(true);
		expect(
			computeWireCrossings(circuit.document.components, circuit.document.wires)[0].connected
		).toBe(true);
		expect(buildElectricalGraph(circuit.document).componentNodes['TA'][0]).toBe(
			buildElectricalGraph(circuit.document).componentNodes['TC'][0]
		);

		// 1 more undo reverses connect back to original insulated crossing
		expect(circuit.undo()).toBe(true);
		expect(
			computeWireCrossings(circuit.document.components, circuit.document.wires)[0].connected
		).toBe(false);
		expect(buildElectricalGraph(circuit.document).componentNodes['TA'][0]).not.toBe(
			buildElectricalGraph(circuit.document).componentNodes['TC'][0]
		);
	});

	it('disconnects two L-bends touching corner-to-corner at a 4-way crossing into two insulated crossing wires', () => {
		circuit.loadDocument({
			schemaVersion: 1,
			name: 'L-Bend 4-Way Crossing Test',
			mode: 'dc',
			frequencyHz: 60,
			components: [
				{ id: 'TA', kind: 'terminal', label: 'TA', terminalName: 'A', x: 2, y: 6, rotation: 0, value: '0' },
				{ id: 'TB', kind: 'terminal', label: 'TB', terminalName: 'B', x: 10, y: 6, rotation: 0, value: '0' },
				{ id: 'TC', kind: 'terminal', label: 'TC', terminalName: 'C', x: 6, y: 2, rotation: 0, value: '0' },
				{ id: 'TD', kind: 'terminal', label: 'TD', terminalName: 'D', x: 6, y: 10, rotation: 0, value: '0' }
			],
			wires: [
				// L-bend from left -> corner (6,6) -> up
				{ id: 'w1', points: [{ x: 2, y: 6 }, { x: 6, y: 6 }, { x: 6, y: 2 }] },
				// L-bend from right -> corner (6,6) -> down
				{ id: 'w2', points: [{ x: 10, y: 6 }, { x: 6, y: 6 }, { x: 6, y: 10 }] }
			]
		});

		// Initially all 4 terminals share 1 node at the 4-way corner (6,6)
		let graph = buildElectricalGraph(circuit.document);
		expect(graph.componentNodes['TA'][0]).toBe(graph.componentNodes['TC'][0]);
		expect(graph.componentNodes['TB'][0]).toBe(graph.componentNodes['TD'][0]);
		expect(computeWireCrossings(circuit.document.components, circuit.document.wires)).toEqual([
			{ x: 6, y: 6, connected: true, wireIds: ['w1', 'w2'] }
		]);

		// Toggle disconnects them into straight horizontal (TA-TB) and straight vertical (TC-TD)
		expect(circuit.toggleWireCrossing(6, 6)).toBe('disconnected');
		graph = buildElectricalGraph(circuit.document);
		expect(graph.componentNodes['TA'][0]).toBe(graph.componentNodes['TB'][0]);
		expect(graph.componentNodes['TC'][0]).toBe(graph.componentNodes['TD'][0]);
		expect(graph.componentNodes['TA'][0]).not.toBe(graph.componentNodes['TC'][0]);
		expect(
			computeWireCrossings(circuit.document.components, circuit.document.wires)[0].connected
		).toBe(false);
		expect(
			circuit.document.wires.some((w) => w.points.some((pt) => pt.x === 6 && pt.y === 6))
		).toBe(false);

		// 1-step undo restores the original connected L-bends cleanly
		expect(circuit.undo()).toBe(true);
		expect(buildElectricalGraph(circuit.document).componentNodes['TA'][0]).toBe(
			buildElectricalGraph(circuit.document).componentNodes['TC'][0]
		);
		expect(
			computeWireCrossings(circuit.document.components, circuit.document.wires)[0].connected
		).toBe(true);
	});

	it('applies document acMagnitudeMode for the session without overwriting persisted preference, halves Peak AC power vs RMS, and allows manual override', () => {
		// Persisted user preference starts as 'rms'
		settings.acMagnitudeMode = 'rms';
		expect(settings.acMagnitudeMode).toBe('rms');

		const peakAcDoc: CircuitDocument = {
			schemaVersion: 1,
			name: 'Peak AC Divider',
			mode: 'ac',
			frequencyHz: 60,
			acMagnitudeMode: 'peak',
			components: [
				{
					id: 'V1',
					kind: 'voltage_source',
					label: 'V1',
					x: 4,
					y: 6,
					rotation: 90,
					value: '10∠0°',
					unit: 'V'
				},
				{
					id: 'R1',
					kind: 'resistor',
					label: 'R1',
					x: 8,
					y: 4,
					rotation: 0,
					value: '10',
					unit: 'Ω'
				},
				{
					id: 'R2',
					kind: 'resistor',
					label: 'R2',
					x: 12,
					y: 6,
					rotation: 90,
					value: '10',
					unit: 'Ω'
				},
				{ id: 'G1', kind: 'ground', label: 'GND', x: 4, y: 8, rotation: 0, value: '0' }
			],
			wires: [
				{ id: 'w1', points: [{ x: 4, y: 4 }, { x: 6, y: 4 }] },
				{ id: 'w2', points: [{ x: 10, y: 4 }, { x: 12, y: 4 }] },
				{ id: 'w3', points: [{ x: 4, y: 8 }, { x: 12, y: 8 }] }
			]
		};

		// Loading a Peak AC document switches effective acMagnitudeMode to 'peak' for this session
		circuit.loadDocument(peakAcDoc, { kind: 'component', componentId: 'R2' });
		expect(settings.acMagnitudeMode).toBe('peak');
		expect(settings.snapshot().acMagnitudeMode).toBe('peak');
		expect(circuit.solution.mna.valid).toBe(true);
		expect(circuit.solution.mna.acMagnitudeMode).toBe('peak');

		// Peak: V = 10 V_pk across 20 Ω -> I = 0.5 A_pk -> P_total = 0.5 * 10 * 0.5 = 2.5 W
		// Thévenin looking into R2: V_th = 10 V_pk, Z_th = 10 Ω -> P_max = |V_th|^2 / (8 R_th) = 100 / 80 = 1.25 W
		const peakPower = circuit.solution.mna.powerBalance.totalAbsorbedReal;
		const peakMaxPower = circuit.solution.theveninNorton?.maxPowerTransfer?.maxRealPowerW;
		expect(peakPower).toBeCloseTo(2.5, 9);
		expect(peakMaxPower).toBeCloseTo(1.25, 9);

		// Persisted preference was NOT overwritten: loading a document without acMagnitudeMode restores 'rms'
		const { acMagnitudeMode: _omitted, ...unspecifiedAcDoc } = peakAcDoc;
		circuit.loadDocument(unspecifiedAcDoc, { kind: 'component', componentId: 'R2' });
		expect(settings.acMagnitudeMode).toBe('rms');
		expect(circuit.solution.mna.acMagnitudeMode).toBe('rms');
		expect(circuit.solution.mna.powerBalance.totalAbsorbedReal).toBeCloseTo(peakPower * 2, 9);
		expect(circuit.solution.theveninNorton?.maxPowerTransfer?.maxRealPowerW).toBeCloseTo(
			peakMaxPower! * 2,
			9
		);

		// Reload Peak doc, then manually toggle settings.acMagnitudeMode = 'rms' -> immediately overrides session mode
		circuit.loadDocument(peakAcDoc, { kind: 'component', componentId: 'R2' });
		expect(settings.acMagnitudeMode).toBe('peak');
		expect(circuit.solution.mna.powerBalance.totalAbsorbedReal).toBeCloseTo(2.5, 9);

		settings.acMagnitudeMode = 'rms';
		expect(settings.acMagnitudeMode).toBe('rms');
		expect(circuit.solution.mna.acMagnitudeMode).toBe('rms');
		expect(circuit.solution.mna.powerBalance.totalAbsorbedReal).toBeCloseTo(5.0, 9);
		expect(circuit.solution.theveninNorton?.maxPowerTransfer?.maxRealPowerW).toBeCloseTo(2.5, 9);

		// Clearing a Peak session returns to persisted preference ('rms')
		circuit.loadDocument(peakAcDoc);
		expect(settings.acMagnitudeMode).toBe('peak');
		circuit.clearCircuit();
		expect(settings.acMagnitudeMode).toBe('rms');
	});
});
