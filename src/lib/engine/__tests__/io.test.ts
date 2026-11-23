import { describe, expect, it } from 'vitest';
import { layoutNetlistToDocument, layoutNetlistWithMeta } from '../auto-layout';
import { buildElectricalGraph } from '../graph';
import { AI_CIRCUIT_IMPORT_PROMPT, exportCircuitJson, parseCircuitImport } from '../io';
import { solveMNA } from '../mna';
import { solveCircuit } from '../solve';
import type { CircuitDocument, UnitSystemId } from '../types';

function assertNoComponentOverlap(doc: CircuitDocument): void {
	const active = doc.components;
	for (let i = 0; i < active.length; i++) {
		for (let j = i + 1; j < active.length; j++) {
			const a = active[i];
			const b = active[j];
			const dx = Math.abs(a.x - b.x);
			const dy = Math.abs(a.y - b.y);
			expect(dx === 0 && dy === 0).toBe(false);
		}
	}
}

describe('Circuit Lab JSON I/O, AI Import & Auto-Layout', () => {
	it('provides a complete AI_CIRCUIT_IMPORT_PROMPT with DC & AC examples and rules', () => {
		expect(AI_CIRCUIT_IMPORT_PROMPT).toContain('"resistor"');
		expect(AI_CIRCUIT_IMPORT_PROMPT).toContain('"voltage_source"');
		expect(AI_CIRCUIT_IMPORT_PROMPT).toContain('"current_source"');
		expect(AI_CIRCUIT_IMPORT_PROMPT).toContain('"0"');
		expect(AI_CIRCUIT_IMPORT_PROMPT).toContain('Example 1 (DC)');
		expect(AI_CIRCUIT_IMPORT_PROMPT).toContain('Example 2 (AC)');
		expect(AI_CIRCUIT_IMPORT_PROMPT).toContain('frequencyHz');
	});

	it('round-trips a full CircuitDocument through exportCircuitJson and parseCircuitImport', () => {
		const doc: CircuitDocument = {
			schemaVersion: 1,
			id: 'roundtrip-test',
			name: 'Roundtrip Divider',
			mode: 'dc',
			frequencyHz: 60,
			components: [
				{ id: 'V1', kind: 'voltage_source', label: 'V1', x: 4, y: 8, rotation: 90, value: '12' },
				{ id: 'R1', kind: 'resistor', label: 'R1', x: 8, y: 4, rotation: 0, value: '2k' },
				{ id: 'R2', kind: 'resistor', label: 'R2', x: 12, y: 8, rotation: 90, value: '4k' },
				{ id: 'G1', kind: 'ground', label: 'GND', x: 4, y: 10, rotation: 0, value: '0' }
			],
			wires: [
				{ id: 'w1', points: [{ x: 4, y: 6 }, { x: 4, y: 4 }, { x: 6, y: 4 }] },
				{ id: 'w2', points: [{ x: 10, y: 4 }, { x: 12, y: 4 }, { x: 12, y: 6 }] },
				{ id: 'w3', points: [{ x: 4, y: 10 }, { x: 12, y: 10 }] }
			]
		};

		const json1 = exportCircuitJson(doc);
		const parsed = parseCircuitImport(json1);
		expect(parsed.ok).toBe(true);
		if (!parsed.ok) return;

		expect(parsed.sourceFormat).toBe('circuit-document');
		expect(parsed.warnings).toEqual([]);
		expect(exportCircuitJson(parsed.document)).toBe(json1);

		const sol = solveMNA(parsed.document);
		expect(sol.valid).toBe(true);
		expect(sol.branches['R2'].voltage.re).toBeCloseTo(8, 9);
	});

	it('extracts markdown-fenced and prose-wrapped AI JSON netlists', () => {
		const rawResponse = `Here is the extracted circuit netlist from your schematic photo:

\`\`\`json
{
  "schemaVersion": 1,
  "name": "Fenced DC Divider",
  "mode": "dc",
  "elements": [
    { "id": "V1", "kind": "voltage_source", "label": "V1", "from": "N1", "to": "0", "value": "12" },
    { "id": "R1", "kind": "resistor", "label": "R1", "from": "N1", "to": "N2", "value": "2k" },
    { "id": "R2", "kind": "resistor", "label": "R2", "from": "N2", "to": "0", "value": "4k" }
  ]
}
\`\`\`

Let me know if you want node voltages calculated!`;

		const res = parseCircuitImport(rawResponse);
		expect(res.ok).toBe(true);
		if (!res.ok) return;

		expect(res.sourceFormat).toBe('ai-netlist');
		expect(res.document.name).toBe('Fenced DC Divider');
		assertNoComponentOverlap(res.document);

		const sol = solveMNA(res.document);
		expect(sol.valid).toBe(true);
		expect(sol.powerBalance.balanced).toBe(true);
		expect(sol.branches['R2'].voltage.re).toBeCloseTo(8, 9);
		expect(sol.branches['R1'].current.re).toBeCloseTo(0.002, 9);
	});

	it('extracts unfenced JSON embedded in leading/trailing AI commentary', () => {
		const raw = `Sure! Here is the netlist: { "mode": "dc", "elements": [
			{ "id": "V1", "kind": "voltage_source", "from": "N1", "to": "0", "value": "10" },
			{ "id": "R1", "kind": "resistor", "from": "N1", "to": "0", "value": "5" }
		] } Hope that helps!`;

		const res = parseCircuitImport(raw);
		expect(res.ok).toBe(true);
		if (!res.ok) return;
		const sol = solveMNA(res.document);
		expect(sol.valid).toBe(true);
		expect(sol.branches['R1'].current.re).toBeCloseTo(2, 9);
	});

	it('reports crisp human-readable errors on invalid JSON and malformed inputs', () => {
		const emptyRes = parseCircuitImport('   ');
		expect(emptyRes.ok).toBe(false);

		const badJson = parseCircuitImport('{ not valid json');
		expect(badJson.ok).toBe(false);
		if (!badJson.ok) expect(badJson.errors[0]).toContain('Invalid JSON');

		const badFields = parseCircuitImport(
			JSON.stringify({
				mode: 'transient',
				elements: [
					{ id: 'R1', kind: 'transistor', from: 'N1', to: '0', value: '1k' },
					{ id: 'R2', kind: 'resistor', from: 'N1', to: '', value: '-10' },
					{ id: 'V1', kind: 'voltage_source', from: 'N1', to: '0', value: '' }
				]
			})
		);
		expect(badFields.ok).toBe(false);
		if (!badFields.ok) {
			expect(badFields.errors.some((e) => e.includes('"mode"'))).toBe(true);
			expect(badFields.errors.some((e) => e.includes('invalid kind'))).toBe(true);
			expect(badFields.errors.some((e) => e.includes('"to"'))).toBe(true);
			expect(badFields.errors.some((e) => e.includes('positive finite'))).toBe(true);
			expect(badFields.errors.some((e) => e.includes('"value"'))).toBe(true);
		}

		const missingAcFreq = parseCircuitImport(
			JSON.stringify({
				mode: 'ac',
				elements: [
					{ id: 'V1', kind: 'voltage_source', from: 'N1', to: '0', value: '10∠0°' },
					{ id: 'R1', kind: 'resistor', from: 'N1', to: '0', value: '10' }
				]
			})
		);
		expect(missingAcFreq.ok).toBe(false);
		if (!missingAcFreq.ok) {
			expect(missingAcFreq.errors.some((e) => e.includes('frequencyHz'))).toBe(true);
		}
	});

	it('auto-layout preserves exact Wheatstone bridge topology and analytical values', () => {
		const doc = layoutNetlistToDocument({
			name: 'Wheatstone Bridge',
			mode: 'dc',
			elements: [
				{ id: 'V1', kind: 'voltage_source', label: 'V1', from: 'N1', to: 'GND', value: '10' },
				{ id: 'R1', kind: 'resistor', label: 'R1', from: 'N1', to: 'N2', value: '100' },
				{ id: 'R2', kind: 'resistor', label: 'R2', from: 'N2', to: 'GND', value: '200' },
				{ id: 'R3', kind: 'resistor', label: 'R3', from: 'N1', to: 'N3', value: '300' },
				{ id: 'R4', kind: 'resistor', label: 'R4', from: 'N3', to: 'GND', value: '100' },
				{ id: 'R5', kind: 'resistor', label: 'R5', from: 'N2', to: 'N3', value: '150' }
			]
		});

		assertNoComponentOverlap(doc);

		const graph = buildElectricalGraph(doc);
		expect(graph.nonRefNodeIds.length).toBe(3);

		const sol = solveMNA(doc);
		expect(sol.valid).toBe(true);
		expect(sol.powerBalance.balanced).toBe(true);
		// Analytical check: Vth = 25/6 V, Rth = 425/3 ohm, R5 = 150 ohm => I(R5) = 1/70 A
		expect(sol.branches['R5'].current.re).toBeCloseTo(1 / 70, 9);
		expect(sol.branches['R5'].voltage.re).toBeCloseTo(150 / 70, 9);
	});

	it('auto-layout handles parallel series branches and parallel shunts without overlap or shorts', () => {
		const doc = layoutNetlistToDocument({
			mode: 'dc',
			elements: [
				// Current source pushing 6 A from 0 -> N1, parallel with R1=6 and R2=12 (equiv 4 ohm)
				{ id: 'I1', kind: 'current_source', from: '0', to: 'N1', value: '6' },
				{ id: 'R1', kind: 'resistor', from: 'N1', to: '0', value: '6' },
				{ id: 'R2', kind: 'resistor', from: 'N1', to: '0', value: '12' },
				// Two parallel resistors R3=6, R4=6 between N1 and N2 (equiv 3 ohm)
				{ id: 'R3', kind: 'resistor', from: 'N1', to: 'N2', value: '6' },
				{ id: 'R4', kind: 'resistor', from: 'N1', to: 'N2', value: '6' },
				// Two parallel load resistors R5=2, R6=2 from N2 to 0 (equiv 1 ohm)
				{ id: 'R5', kind: 'resistor', from: 'N2', to: '0', value: '2' },
				{ id: 'R6', kind: 'resistor', from: 'N2', to: '0', value: '2' }
			]
		});

		assertNoComponentOverlap(doc);

		const graph = buildElectricalGraph(doc);
		expect(graph.nonRefNodeIds.length).toBe(2);

		// Series branch from N1 to N2 to 0 has R_right = 3 + 1 = 4 ohm.
		// In parallel with R1||R2 = 4 ohm -> total Req seen by I1 = 2 ohm -> V(N1) = 12 V, V(N2) = 3 V!
		const sol = solveMNA(doc);
		expect(sol.valid).toBe(true);
		expect(sol.powerBalance.balanced).toBe(true);
		expect(sol.branches['R1'].voltage.re).toBeCloseTo(12, 9);
		expect(sol.branches['R5'].voltage.re).toBeCloseTo(3, 9);
		expect(sol.branches['R3'].current.re).toBeCloseTo(1.5, 9);
		expect(sol.branches['R4'].current.re).toBeCloseTo(1.5, 9);
	});

	it('auto-layout preserves exact AC RLC topology and complex phasor solution', () => {
		const res = parseCircuitImport(
			JSON.stringify({
				schemaVersion: 1,
				name: 'AC RLC Test',
				mode: 'ac',
				frequencyHz: 1000,
				acMagnitudeMode: 'rms',
				elements: [
					{ id: 'V1', kind: 'voltage_source', from: 'N1', to: '0', value: '10∠30°' },
					{ id: 'R1', kind: 'resistor', from: 'N1', to: 'N2', value: '100' },
					{ id: 'L1', kind: 'inductor', from: 'N2', to: 'N3', value: '20m' },
					{ id: 'C1', kind: 'capacitor', from: 'N3', to: '0', value: '2.2u' },
					{ id: 'R2', kind: 'resistor', from: 'N3', to: '0', value: '100' }
				]
			})
		);

		expect(res.ok).toBe(true);
		if (!res.ok) return;

		assertNoComponentOverlap(res.document);

		const graph = buildElectricalGraph(res.document);
		expect(graph.nonRefNodeIds.length).toBe(3);

		const sol = solveMNA(res.document);
		expect(sol.valid).toBe(true);
		expect(sol.powerBalance.balanced).toBe(true);

		// Analytical impedance check at f = 1000 Hz
		const omega = 2 * Math.PI * 1000;
		const zLoadRe = 1 / (1 / 100); // Y_R2 = 0.01
		const yLoadRe = 0.01;
		const yLoadIm = omega * 2.2e-6;
		const yMagSq = yLoadRe * yLoadRe + yLoadIm * yLoadIm;
		const zParRe = yLoadRe / yMagSq;
		const zParIm = -yLoadIm / yMagSq;
		const zTotRe = 100 + zParRe;
		const zTotIm = omega * 20e-3 + zParIm;

		const vSrc = {
			re: 10 * Math.cos((30 * Math.PI) / 180),
			im: 10 * Math.sin((30 * Math.PI) / 180)
		};
		const zTotMagSq = zTotRe * zTotRe + zTotIm * zTotIm;
		const iTotRe = (vSrc.re * zTotRe + vSrc.im * zTotIm) / zTotMagSq;
		const iTotIm = (vSrc.im * zTotRe - vSrc.re * zTotIm) / zTotMagSq;

		expect(zLoadRe).toBe(100);
		expect(sol.branches['R1'].current.re).toBeCloseTo(iTotRe, 9);
		expect(sol.branches['R1'].current.im).toBeCloseTo(iTotIm, 9);
	});

	it('includes visual-grid, unitSystem, and unknownProblem instructions in AI_CIRCUIT_IMPORT_PROMPT', () => {
		expect(AI_CIRCUIT_IMPORT_PROMPT).toContain('"fromPos"');
		expect(AI_CIRCUIT_IMPORT_PROMPT).toContain('"toPos"');
		expect(AI_CIRCUIT_IMPORT_PROMPT).toContain('"unitSystem"');
		expect(AI_CIRCUIT_IMPORT_PROMPT).toContain('"ohm-v-a"');
		expect(AI_CIRCUIT_IMPORT_PROMPT).toContain('"kohm-v-ma"');
		expect(AI_CIRCUIT_IMPORT_PROMPT).toContain('"mohm-v-ua"');
		expect(AI_CIRCUIT_IMPORT_PROMPT).toContain('"unknownProblem"');
	});

	it('visual-grid cloner preserves exact horizontal/vertical orientations, upward current source, left-to-right vs right-to-left, and MNA equivalence', () => {
		const res = parseCircuitImport(
			JSON.stringify({
				schemaVersion: 1,
				name: 'Oriented Dual-Source Schematic',
				mode: 'dc',
				unitSystem: 'kohm-v-ma',
				elements: [
					// Downward voltage source (+ top, - bottom) at col 0
					{
						id: 'V1',
						kind: 'voltage_source',
						label: 'V1',
						from: 'N1',
						to: '0',
						fromPos: [0, 0],
						toPos: [0, 1],
						value: '12'
					},
					// Left-to-right horizontal resistor on top rail (0 -> 1)
					{
						id: 'R1',
						kind: 'resistor',
						label: 'R1',
						from: 'N1',
						to: 'N2',
						fromPos: [0, 0],
						toPos: [1, 0],
						value: '2k'
					},
					// Downward vertical resistor at col 1
					{
						id: 'R2',
						kind: 'resistor',
						label: 'R2',
						from: 'N2',
						to: '0',
						fromPos: [1, 0],
						toPos: [1, 1],
						value: '4k'
					},
					// Right-to-left horizontal resistor on top rail (2 -> 1) -> rotation 180
					{
						id: 'R3',
						kind: 'resistor',
						label: 'R3',
						from: 'N3',
						to: 'N2',
						fromPos: [2, 0],
						toPos: [1, 0],
						value: '2k'
					},
					// Upward current source (tail at bottom [2,1], head at top [2,0]) -> rotation 270
					{
						id: 'I1',
						kind: 'current_source',
						label: 'I1',
						from: '0',
						to: 'N3',
						fromPos: [2, 1],
						toPos: [2, 0],
						value: '1m'
					}
				]
			})
		);

		expect(res.ok).toBe(true);
		if (!res.ok) return;

		expect(res.sourceFormat).toBe('ai-netlist');
		expect(res.layoutMode).toBe('visual-grid');
		expect(res.warnings).toEqual([]);
		expect(res.document.unitSystem).toBe('kohm-v-ma');
		assertNoComponentOverlap(res.document);

		const byId = Object.fromEntries(res.document.components.map((c) => [c.id, c]));
		// Exact orientation checks
		expect(byId['V1'].rotation).toBe(90);
		expect(byId['R1'].rotation).toBe(0);
		expect(byId['R2'].rotation).toBe(90);
		expect(byId['R3'].rotation).toBe(180);
		expect(byId['I1'].rotation).toBe(270);

		// Exact left-to-right spatial order preserved
		expect(byId['V1'].x).toBeLessThan(byId['R1'].x);
		expect(byId['R1'].x).toBeLessThan(byId['R2'].x);
		expect(byId['R2'].x).toBeLessThan(byId['R3'].x);
		expect(byId['R3'].x).toBeLessThan(byId['I1'].x);
		// Top-rail resistors sit strictly above vertical branch centers
		expect(byId['R1'].y).toBe(byId['R3'].y);
		expect(byId['R1'].y).toBeLessThan(byId['V1'].y);
		expect(byId['V1'].y).toBe(byId['R2'].y);
		expect(byId['R2'].y).toBe(byId['I1'].y);

		// Analytical MNA check:
		// KCL at N2: (V2 - 12)/2k + V2/4k - 1mA = 0 => V2*(3/4k) = 7mA => V2 = 28/3 V
		// I(R2) = V2/4k = 7/3 mA; I(R3) = +1mA (from N3 to N2)
		const sol = solveMNA(res.document);
		expect(sol.valid).toBe(true);
		expect(sol.powerBalance.balanced).toBe(true);
		expect(sol.branches['R2'].voltage.re).toBeCloseTo(28 / 3, 9);
		expect(sol.branches['R2'].current.re).toBeCloseTo(7 / 3000, 9);
		expect(sol.branches['R3'].current.re).toBeCloseTo(1e-3, 9);
	});

	it('visual-grid cloner handles parallel branches on the same segment and a spanning top branch without overlap or shorts', () => {
		const res = parseCircuitImport(
			JSON.stringify({
				schemaVersion: 1,
				name: 'Parallel + Spanning Visual Grid',
				mode: 'dc',
				elements: [
					{
						id: 'V1',
						kind: 'voltage_source',
						from: 'N1',
						to: '0',
						fromPos: [0, 0],
						toPos: [0, 1],
						value: '12'
					},
					{
						id: 'R1',
						kind: 'resistor',
						from: 'N1',
						to: 'N2',
						fromPos: [0, 0],
						toPos: [1, 0],
						value: '2'
					},
					// Two parallel vertical resistors on the same [1,0]->[1,1] segment
					{
						id: 'R2a',
						kind: 'resistor',
						from: 'N2',
						to: '0',
						fromPos: [1, 0],
						toPos: [1, 1],
						value: '4'
					},
					{
						id: 'R2b',
						kind: 'resistor',
						from: 'N2',
						to: '0',
						fromPos: [1, 0],
						toPos: [1, 1],
						value: '4'
					},
					{
						id: 'R3',
						kind: 'resistor',
						from: 'N2',
						to: 'N3',
						fromPos: [1, 0],
						toPos: [2, 0],
						value: '2'
					},
					{
						id: 'R4',
						kind: 'resistor',
						from: 'N3',
						to: '0',
						fromPos: [2, 0],
						toPos: [2, 1],
						value: '2'
					},
					// Spanning top resistor across N1 ([0,0]) -> N3 ([2,0]) leaping over N2 ([1,0])
					{
						id: 'Rtop',
						kind: 'resistor',
						from: 'N1',
						to: 'N3',
						fromPos: [0, 0],
						toPos: [2, 0],
						value: '4'
					}
				]
			})
		);

		expect(res.ok).toBe(true);
		if (!res.ok) return;

		expect(res.layoutMode).toBe('visual-grid');
		assertNoComponentOverlap(res.document);

		const byId = Object.fromEntries(res.document.components.map((c) => [c.id, c]));
		// Parallel vertical branches spread cleanly side-by-side at same Y
		expect(byId['R2a'].y).toBe(byId['R2b'].y);
		expect(byId['R2a'].x).not.toBe(byId['R2b'].x);
		// Spanning top branch sits strictly above main top rail
		expect(byId['Rtop'].y).toBeLessThan(byId['R1'].y);

		// Verify exact electrical equivalence against ladder reference layout
		const ladderDoc = layoutNetlistToDocument({
			mode: 'dc',
			elements: [
				{ id: 'V1', kind: 'voltage_source', from: 'N1', to: '0', value: '12' },
				{ id: 'R1', kind: 'resistor', from: 'N1', to: 'N2', value: '2' },
				{ id: 'R2a', kind: 'resistor', from: 'N2', to: '0', value: '4' },
				{ id: 'R2b', kind: 'resistor', from: 'N2', to: '0', value: '4' },
				{ id: 'R3', kind: 'resistor', from: 'N2', to: 'N3', value: '2' },
				{ id: 'R4', kind: 'resistor', from: 'N3', to: '0', value: '2' },
				{ id: 'Rtop', kind: 'resistor', from: 'N1', to: 'N3', value: '4' }
			]
		});
		const solVisual = solveMNA(res.document);
		const solRef = solveMNA(ladderDoc);
		expect(solVisual.valid).toBe(true);
		expect(solVisual.powerBalance.balanced).toBe(true);
		for (const id of ['V1', 'R1', 'R2a', 'R2b', 'R3', 'R4', 'Rtop']) {
			expect(solVisual.branches[id].current.re).toBeCloseTo(solRef.branches[id].current.re, 9);
			expect(solVisual.branches[id].voltage.re).toBeCloseTo(solRef.branches[id].voltage.re, 9);
		}
	});

	it('falls back safely to auto-layout when visual-grid coordinates conflict electrically, and keeps legacy netlists backwards compatible', () => {
		// Conflicting coordinates: two different nodes N1 and N2 placed at the same vertex [1,0]
		const conflict = parseCircuitImport(
			JSON.stringify({
				mode: 'dc',
				elements: [
					{
						id: 'V1',
						kind: 'voltage_source',
						from: 'N1',
						to: '0',
						fromPos: [1, 0],
						toPos: [0, 1],
						value: '12'
					},
					{
						id: 'R1',
						kind: 'resistor',
						from: 'N1',
						to: 'N2',
						fromPos: [0, 0],
						toPos: [1, 0],
						value: '2k'
					},
					{
						id: 'R2',
						kind: 'resistor',
						from: 'N2',
						to: '0',
						fromPos: [1, 0],
						toPos: [1, 1],
						value: '4k'
					}
				]
			})
		);
		expect(conflict.ok).toBe(true);
		if (!conflict.ok) return;
		expect(conflict.layoutMode).toBe('auto-layout');
		expect(conflict.warnings.some((w) => w.includes('fell back'))).toBe(true);
		const conflictSol = solveMNA(conflict.document);
		expect(conflictSol.valid).toBe(true);
		expect(conflictSol.branches['R2'].voltage.re).toBeCloseTo(8, 9);

		// Legacy netlist without fromPos/toPos uses auto-layout with zero warnings
		const legacy = layoutNetlistWithMeta({
			mode: 'dc',
			elements: [
				{ id: 'V1', kind: 'voltage_source', from: 'N1', to: '0', value: '12' },
				{ id: 'R1', kind: 'resistor', from: 'N1', to: 'N2', value: '2k' },
				{ id: 'R2', kind: 'resistor', from: 'N2', to: '0', value: '4k' }
			]
		});
		expect(legacy.layoutMode).toBe('auto-layout');
		expect(legacy.warnings).toEqual([]);
		expect(solveMNA(legacy.document).branches['R2'].voltage.re).toBeCloseTo(8, 9);
	});

	it('parses and round-trips all unitSystem options across AI netlist import and CircuitDocument JSON export', () => {
		const systems: UnitSystemId[] = ['auto', 'ohm-v-a', 'kohm-v-ma', 'mohm-v-ua'];
		for (const unitSystem of systems) {
			const imported = parseCircuitImport(
				JSON.stringify({
					schemaVersion: 1,
					name: `Unit System ${unitSystem}`,
					mode: 'dc',
					unitSystem,
					elements: [
						{
							id: 'V1',
							kind: 'voltage_source',
							from: 'N1',
							to: '0',
							fromPos: [0, 0],
							toPos: [0, 1],
							value: '10'
						},
						{
							id: 'R1',
							kind: 'resistor',
							from: 'N1',
							to: '0',
							fromPos: [1, 0],
							toPos: [1, 1],
							value: '1k'
						}
					]
				})
			);
			expect(imported.ok).toBe(true);
			if (!imported.ok) continue;
			expect(imported.document.unitSystem).toBe(unitSystem);

			const exportedJson = exportCircuitJson(imported.document);
			expect(exportedJson).toContain(`"unitSystem": "${unitSystem}"`);

			const reparsed = parseCircuitImport(exportedJson);
			expect(reparsed.ok).toBe(true);
			if (!reparsed.ok) continue;
			expect(reparsed.sourceFormat).toBe('circuit-document');
			expect(reparsed.document.unitSystem).toBe(unitSystem);
		}
	});

	it('imports an unknown-value textbook problem (value "?" + unknownProblem) and solves the exact unknown voltage via solveCircuit()', () => {
		const res = parseCircuitImport(
			JSON.stringify({
				schemaVersion: 1,
				name: 'Find Vs Given Io = 2 mA',
				mode: 'dc',
				unitSystem: 'kohm-v-ma',
				elements: [
					{
						id: 'V1',
						kind: 'voltage_source',
						label: 'Vs',
						from: 'N1',
						to: '0',
						fromPos: [0, 0],
						toPos: [0, 1],
						value: '?',
						unknown: true,
						unknownSymbol: 'Vs'
					},
					{
						id: 'R1',
						kind: 'resistor',
						label: 'R1',
						from: 'N1',
						to: 'N2',
						fromPos: [0, 0],
						toPos: [1, 0],
						value: '2k'
					},
					{
						id: 'R2',
						kind: 'resistor',
						label: 'R2',
						from: 'N2',
						to: '0',
						fromPos: [1, 0],
						toPos: [1, 1],
						value: '4k'
					},
					{
						id: 'R3',
						kind: 'resistor',
						label: 'R3',
						from: 'N2',
						to: 'N3',
						fromPos: [1, 0],
						toPos: [2, 0],
						value: '2k'
					},
					{
						id: 'I1',
						kind: 'current_source',
						label: 'I1',
						from: '0',
						to: 'N3',
						fromPos: [2, 1],
						toPos: [2, 0],
						value: '1m'
					}
				],
				unknownProblem: {
					componentId: 'V1',
					symbol: 'Vs',
					constraint: {
						kind: 'branch_current',
						targetId: 'R2',
						value: '2m',
						label: 'I_o'
					}
				}
			})
		);

		expect(res.ok).toBe(true);
		if (!res.ok) return;

		expect(res.layoutMode).toBe('visual-grid');
		expect(res.document.unitSystem).toBe('kohm-v-ma');
		expect(res.document.unknownProblem?.componentId).toBe('V1');
		expect(res.document.unknownProblem?.symbol).toBe('Vs');
		expect(res.document.unknownProblem?.constraint.kind).toBe('branch_current');

		// Analytical check: V(N2) = 4k * 2mA = 8 V; KCL at N2 => (8 - Vs)/2k + 2mA - 1mA = 0 => Vs = 10 V
		const solved = solveCircuit(res.document);
		expect(solved.mna.valid).toBe(true);
		expect(solved.unknownSolution?.valid).toBe(true);
		expect(solved.unknownSolution?.solutions[0].value.re).toBeCloseTo(10, 9);
		expect(solved.unknownSolution?.solutions[0].verified).toBe(true);
		expect(solved.mna.branches['R2'].current.re).toBeCloseTo(2e-3, 9);
	});

	it('normalizes shorthand top-level constraint + unknown element and remaps custom node_voltage target IDs', () => {
		const res = parseCircuitImport(
			JSON.stringify({
				mode: 'dc',
				unitSystem: 'kohm-v-ma',
				elements: [
					{
						id: 'V1',
						kind: 'voltage_source',
						from: 'Vin',
						to: '0',
						fromPos: [0, 0],
						toPos: [0, 1],
						value: '12'
					},
					{
						id: 'R1',
						kind: 'resistor',
						from: 'Vin',
						to: 'Vo',
						fromPos: [0, 0],
						toPos: [1, 0],
						value: '2k'
					},
					{
						id: 'R2',
						kind: 'resistor',
						label: 'Rx',
						from: 'Vo',
						to: '0',
						fromPos: [1, 0],
						toPos: [1, 1],
						value: 'unknown',
						unknown: true,
						unknownSymbol: 'Rx'
					}
				],
				constraint: {
					kind: 'node_voltage',
					targetId: 'Vo',
					value: '8',
					label: 'V_o'
				}
			})
		);

		expect(res.ok).toBe(true);
		if (!res.ok) return;

		expect(res.document.unknownProblem).toBeDefined();
		expect(res.document.unknownProblem?.componentId).toBe('R2');
		expect(res.document.unknownProblem?.symbol).toBe('Rx');

		const solved = solveCircuit(res.document);
		expect(solved.mna.valid).toBe(true);
		expect(solved.unknownSolution?.valid).toBe(true);
		// Voltage divider: 12 * Rx / (2k + Rx) = 8 => Rx = 4k = 4000 ohm
		expect(solved.unknownSolution?.solutions[0].value.re).toBeCloseTo(4000, 6);
		expect(solved.unknownSolution?.solutions[0].verified).toBe(true);
	});

	it('imports AI netlist with explicit multiple/scaled unknowns (V1 = V, V2 = 2V), solves exact V, and round-trips JSON', () => {
		const res = parseCircuitImport(
			JSON.stringify({
				schemaVersion: 1,
				name: 'Two Scaled Voltage Sources',
				mode: 'dc',
				unitSystem: 'kohm-v-ma',
				elements: [
					{
						id: 'V1',
						kind: 'voltage_source',
						label: 'V1',
						from: 'N1',
						to: '0',
						fromPos: [0, 0],
						toPos: [0, 1],
						value: 'V',
						unknown: true,
						unknownSymbol: 'V',
						unknownMultiplier: 1
					},
					{
						id: 'R1',
						kind: 'resistor',
						label: 'R1',
						from: 'N1',
						to: 'N2',
						fromPos: [0, 0],
						toPos: [1, 0],
						value: '2k'
					},
					{
						id: 'R2',
						kind: 'resistor',
						label: 'R2',
						from: 'N2',
						to: '0',
						fromPos: [1, 0],
						toPos: [1, 1],
						value: '4k'
					},
					{
						id: 'R3',
						kind: 'resistor',
						label: 'R3',
						from: 'N2',
						to: 'N3',
						fromPos: [1, 0],
						toPos: [2, 0],
						value: '2k'
					},
					{
						id: 'V2',
						kind: 'voltage_source',
						label: 'V2',
						from: 'N3',
						to: '0',
						fromPos: [2, 0],
						toPos: [2, 1],
						value: '2V',
						unknown: true,
						unknownSymbol: 'V',
						unknownMultiplier: 2
					}
				],
				unknownProblem: {
					componentId: 'V1',
					symbol: 'V',
					terms: [
						{ componentId: 'V1', multiplier: 1 },
						{ componentId: 'V2', multiplier: 2 }
					],
					constraint: {
						kind: 'branch_current',
						targetId: 'R2',
						value: '3m',
						label: 'I_o'
					}
				}
			})
		);

		expect(res.ok).toBe(true);
		if (!res.ok) return;

		expect(res.document.unknownProblem?.terms).toEqual([
			{ componentId: 'V1', multiplier: 1 },
			{ componentId: 'V2', multiplier: 2 }
		]);

		const solved = solveCircuit(res.document);
		expect(solved.unknownSolution?.valid).toBe(true);
		expect(solved.unknownSolution?.solutions[0].value.re).toBeCloseTo(10, 9);
		expect(solved.unknownSolution?.solutions[0].termValues?.[1].value.re).toBeCloseTo(20, 9);
		expect(solved.allVerified).toBe(true);

		// JSON export/import round-trip preserves unknownProblem.terms
		const exported = exportCircuitJson(res.document);
		const reimported = parseCircuitImport(exported);
		expect(reimported.ok).toBe(true);
		if (!reimported.ok) return;
		expect(reimported.document.unknownProblem?.terms).toEqual([
			{ componentId: 'V1', multiplier: 1 },
			{ componentId: 'V2', multiplier: 2 }
		]);
		const solvedAgain = solveCircuit(reimported.document);
		expect(solvedAgain.unknownSolution?.solutions[0].value.re).toBeCloseTo(10, 9);
	});

	it('infers multipliers from algebraic strings "V" and "2V" using unknownProblem.symbol without explicit unknownMultiplier', () => {
		const res = parseCircuitImport(
			JSON.stringify({
				schemaVersion: 1,
				name: 'Algebraic Multi-Unknown Netlist',
				mode: 'dc',
				elements: [
					{ id: 'V1', kind: 'voltage_source', from: 'N1', to: '0', value: 'V' },
					{ id: 'R1', kind: 'resistor', from: 'N1', to: 'N2', value: '2k' },
					{ id: 'R2', kind: 'resistor', from: 'N2', to: '0', value: '4k' },
					{ id: 'R3', kind: 'resistor', from: 'N2', to: 'N3', value: '2k' },
					{ id: 'V2', kind: 'voltage_source', from: 'N3', to: '0', value: '2V' }
				],
				unknownProblem: {
					componentId: 'V1',
					symbol: 'V',
					constraint: {
						kind: 'branch_current',
						targetId: 'R2',
						value: '3m',
						label: 'I_o'
					}
				}
			})
		);

		expect(res.ok).toBe(true);
		if (!res.ok) return;

		expect(res.document.unknownProblem?.terms).toEqual([
			{ componentId: 'V1', multiplier: 1 },
			{ componentId: 'V2', multiplier: 2 }
		]);

		const solved = solveCircuit(res.document);
		expect(solved.unknownSolution?.valid).toBe(true);
		expect(solved.unknownSolution?.solutions[0].value.re).toBeCloseTo(10, 9);
		expect(solved.unknownSolution?.solutions[0].termValues?.[0].value.re).toBeCloseTo(10, 9);
		expect(solved.unknownSolution?.solutions[0].termValues?.[1].value.re).toBeCloseTo(20, 9);
		expect(solved.allVerified).toBe(true);
	});

	it('imports direct AC impedance passives from AI netlist (explicit and inferred) and round-trips CircuitDocument JSON', () => {
		expect(AI_CIRCUIT_IMPORT_PROMPT).toContain('"valueMode": "impedance"');

		const aiPayload = JSON.stringify({
			schemaVersion: 1,
			name: 'AC Impedance Supernode Import',
			mode: 'ac',
			frequencyHz: 60,
			acMagnitudeMode: 'rms',
			unitSystem: 'ohm-v-a',
			elements: [
				{ id: 'R1', kind: 'resistor', label: 'R1', from: 'N1', to: '0', fromPos: [0, 0], toPos: [0, 1], value: '1' },
				{ id: 'C1', kind: 'capacitor', label: 'C1', from: 'N1', to: 'N2', fromPos: [0, 0], toPos: [1, 0], value: '-j1', valueMode: 'impedance', unit: 'Ω' },
				{ id: 'R2', kind: 'resistor', label: 'R2', from: 'N2', to: '0', fromPos: [1, 0], toPos: [1, 1], value: '2' },
				{ id: 'Vs', kind: 'voltage_source', label: 'Vs', from: 'N3', to: 'N2', fromPos: [2, 0], toPos: [1, 0], value: '10∠0°' },
				// Auto-inferred impedance mode from "-j1" without explicit valueMode
				{ id: 'C2', kind: 'capacitor', label: 'C2', from: 'N3', to: '0', fromPos: [2, 0], toPos: [2, 1], value: '-j1' },
				{ id: 'L1', kind: 'inductor', label: 'L1', from: 'N3', to: 'N4', fromPos: [2, 0], toPos: [3, 0], value: 'j1', unit: 'Ω' },
				{ id: 'R3', kind: 'resistor', label: 'R3', from: 'N4', to: '0', fromPos: [3, 0], toPos: [3, 1], value: '2' }
			]
		});

		const imported = parseCircuitImport(aiPayload);
		expect(imported.ok).toBe(true);
		if (!imported.ok) return;

		const c1 = imported.document.components.find((c) => c.id === 'C1')!;
		const c2 = imported.document.components.find((c) => c.id === 'C2')!;
		const l1 = imported.document.components.find((c) => c.id === 'L1')!;
		expect(c1.valueMode).toBe('impedance');
		expect(c1.unit).toBe('Ω');
		expect(c2.valueMode).toBe('impedance');
		expect(c2.unit).toBe('Ω');
		expect(l1.valueMode).toBe('impedance');
		expect(l1.unit).toBe('Ω');

		const solved = solveCircuit(imported.document);
		expect(solved.mna.valid).toBe(true);
		expect(solved.mna.powerBalance.balanced).toBe(true);
		expect(solved.allVerified).toBe(true);
		expect(solved.maxDiscrepancy).toBeLessThan(1e-8);

		// Export as CircuitDocument JSON and re-import
		const exported = exportCircuitJson(imported.document);
		expect(exported).toContain('"valueMode": "impedance"');
		const reimported = parseCircuitImport(exported);
		expect(reimported.ok).toBe(true);
		if (!reimported.ok) return;
		expect(reimported.document.components.find((c) => c.id === 'C1')?.valueMode).toBe('impedance');
		expect(reimported.document.components.find((c) => c.id === 'L1')?.valueMode).toBe('impedance');
		const solvedAgain = solveCircuit(reimported.document);
		expect(solvedAgain.allVerified).toBe(true);
	});

	it('imports ideal voltmeters from AI netlist and round-trips through exportCircuitJson / parseCircuitImport', () => {
		const aiNetlistWithVm = JSON.stringify({
			schemaVersion: 1,
			name: 'Divider with Voltmeter',
			mode: 'dc',
			elements: [
				{ id: 'V1', kind: 'voltage_source', label: 'V1', from: 'N1', to: '0', value: '12' },
				{ id: 'R1', kind: 'resistor', label: 'R1', from: 'N1', to: 'N2', value: '2k' },
				{ id: 'R2', kind: 'resistor', label: 'R2', from: 'N2', to: '0', value: '4k' },
				{ id: 'VM1', kind: 'voltmeter', label: 'VM1', from: 'N2', to: '0' }
			]
		});

		const imported = parseCircuitImport(aiNetlistWithVm);
		expect(imported.ok).toBe(true);
		if (!imported.ok) return;

		const vm = imported.document.components.find((c) => c.kind === 'voltmeter');
		expect(vm).toBeDefined();
		expect(vm?.label).toBe('VM1');

		const solved = solveCircuit(imported.document);
		expect(solved.mna.valid).toBe(true);
		expect(solved.mna.branches[vm!.id].voltage.re).toBeCloseTo(8, 9);
		expect(solved.mna.branches[vm!.id].current.abs()).toBe(0);
		expect(solved.allVerified).toBe(true);

		const exported = exportCircuitJson(imported.document);
		expect(exported).toContain('"kind": "voltmeter"');

		const reimported = parseCircuitImport(exported);
		expect(reimported.ok).toBe(true);
		if (!reimported.ok) return;
		expect(reimported.sourceFormat).toBe('circuit-document');
		const solvedAgain = solveCircuit(reimported.document);
		expect(solvedAgain.mna.valid).toBe(true);
		expect(solvedAgain.mna.branches[vm!.id].voltage.re).toBeCloseTo(8, 9);
		expect(solvedAgain.allVerified).toBe(true);
	});

	it('imports dependent sources (VCVS & CCCS) from AI netlist resolving controlRef by label and round-trips JSON', () => {
		const aiNetlistDep = JSON.stringify({
			schemaVersion: 1,
			name: 'Dependent Source VCVS Test',
			mode: 'dc',
			unitSystem: 'kohm-v-ma',
			elements: [
				{
					id: 'V1',
					kind: 'voltage_source',
					label: 'Vs',
					from: 'N1',
					to: '0',
					fromPos: [0, 0],
					toPos: [0, 1],
					value: '16'
				},
				{
					id: 'R1',
					kind: 'resistor',
					label: 'R_sense',
					from: 'N1',
					to: 'N2',
					fromPos: [0, 0],
					toPos: [1, 0],
					value: '4k'
				},
				{
					id: 'R2',
					kind: 'resistor',
					label: 'R2',
					from: 'N2',
					to: '0',
					fromPos: [1, 0],
					toPos: [1, 1],
					value: '4k'
				},
				{
					id: 'R3',
					kind: 'resistor',
					label: 'R3',
					from: 'N2',
					to: 'N3',
					fromPos: [1, 0],
					toPos: [2, 0],
					value: '2k'
				},
				{
					id: 'E1',
					kind: 'vcvs',
					label: 'E1',
					from: 'N3',
					to: '0',
					fromPos: [2, 0],
					toPos: [2, 1],
					value: '2',
					controlRef: {
						controlComponentId: 'R_sense',
						controlPolarity: 1,
						controlVarName: 'v_x',
						gain: '2'
					}
				}
			]
		});

		const imported = parseCircuitImport(aiNetlistDep);
		expect(imported.ok).toBe(true);
		if (!imported.ok) return;

		const e1 = imported.document.components.find((c) => c.id === 'E1');
		expect(e1?.kind).toBe('vcvs');
		expect(e1?.controlRef?.controlComponentId).toBe('R1');
		expect(e1?.controlRef?.controlVarName).toBe('v_x');

		const solved = solveCircuit(imported.document);
		expect(solved.mna.valid).toBe(true);
		expect(solved.mna.branches['R2'].voltage.re).toBeCloseTo(10, 9);
		expect(solved.mna.branches['E1'].voltage.re).toBeCloseTo(12, 9);
		expect(solved.allVerified).toBe(true);

		const exported = exportCircuitJson(imported.document);
		expect(exported).toContain('"kind": "vcvs"');
		expect(exported).toContain('"controlComponentId": "R1"');

		const reimported = parseCircuitImport(exported);
		expect(reimported.ok).toBe(true);
		if (!reimported.ok) return;
		const solvedAgain = solveCircuit(reimported.document);
		expect(solvedAgain.mna.valid).toBe(true);
		expect(solvedAgain.mna.branches['R2'].voltage.re).toBeCloseTo(10, 9);
		expect(solvedAgain.allVerified).toBe(true);
	});
});

