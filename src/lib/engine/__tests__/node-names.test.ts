import { describe, expect, it } from 'vitest';
import { PRESETS } from '../../data/presets';
import { buildElectricalGraph, nodeLetterName, validateNodeName } from '../graph';
import { exportCircuitJson, parseCircuitImport } from '../io';
import { decodeCircuitFromHash, encodeCircuitToHash } from '../share';
import { solveCircuit } from '../solve';
import type { CircuitDocument } from '../types';

function preset(id: string): CircuitDocument {
	const p = PRESETS.find((x) => x.id === id);
	if (!p) throw new Error(`missing preset ${id}`);
	return structuredClone(p.document);
}

// dc-supermesh nodes by position: A = V1.0/R1.0, B = R1.1/I1.1/R2.0, C = R2.1/R3.0
const withNames = (names: CircuitDocument['nodeNames']): CircuitDocument => ({
	...preset('dc-supermesh'),
	nodeNames: names
});

describe('node names: automatic letters', () => {
	it('names a 3-node circuit A, B, C and keeps the reference as "0"', () => {
		const g = buildElectricalGraph(preset('dc-supermesh'));
		expect(g.nonRefNodeIds).toEqual(['A', 'B', 'C']);
		expect(Object.keys(g.nodes).sort()).toEqual(['0', 'A', 'B', 'C']);
		expect(g.nodes['0'].isReference).toBe(true);
	});

	it('continues Z -> AA -> AB ... -> AZ -> BA', () => {
		expect(nodeLetterName(0)).toBe('A');
		expect(nodeLetterName(25)).toBe('Z');
		expect(nodeLetterName(26)).toBe('AA');
		expect(nodeLetterName(27)).toBe('AB');
		expect(nodeLetterName(51)).toBe('AZ');
		expect(nodeLetterName(52)).toBe('BA');
	});
});

describe('node names: custom names', () => {
	it('uses the custom name and keeps the other nodes on collision-free letters', () => {
		const g = buildElectricalGraph(withNames([{ pin: { componentId: 'R1', pinIndex: 1 }, name: 'Vo' }]));
		expect(g.nonRefNodeIds).toEqual(['A', 'Vo', 'B']);
		expect(g.nodes['Vo'].componentPins.map((p) => p.componentId).sort()).toEqual(['I1', 'R1', 'R2']);
	});

	it('skips auto letters that a custom name already uses', () => {
		// Name the first node "B": the others become A and C (no duplicate B)
		const g = buildElectricalGraph(withNames([{ pin: { componentId: 'V1', pinIndex: 0 }, name: 'B' }]));
		expect(g.nonRefNodeIds).toEqual(['B', 'A', 'C']);
		expect(new Set(g.nonRefNodeIds).size).toBe(3);
	});

	it('ignores stale, reference, invalid and duplicate entries (first wins)', () => {
		const g = buildElectricalGraph(
			withNames([
				{ pin: { componentId: 'NOPE', pinIndex: 0 }, name: 'X' }, // component gone
				{ pin: { componentId: 'R1', pinIndex: 7 }, name: 'Y' }, // pin gone
				{ pin: { componentId: 'G1', pinIndex: 0 }, name: 'Ground' }, // reference node
				{ pin: { componentId: 'R1', pinIndex: 0 }, name: '9bad' }, // invalid
				{ pin: { componentId: 'R2', pinIndex: 0 }, name: 'Vo' },
				{ pin: { componentId: 'R3', pinIndex: 0 }, name: 'Vo' }, // duplicate name
				{ pin: { componentId: 'I1', pinIndex: 1 }, name: 'Other' } // same node as R2.0: ignored
			])
		);
		expect(g.nonRefNodeIds).toEqual(['A', 'Vo', 'B']);
		expect(g.nodes['0'].isReference).toBe(true);
	});

	it('renders node names in the nodal method as V_{name}, escaping underscores', () => {
		const doc = withNames([{ pin: { componentId: 'R1', pinIndex: 1 }, name: 'Vo' }]);
		const nodal = solveCircuit(doc).methods.nodal;
		expect(JSON.stringify(nodal)).toContain('V_{Vo}');

		const underscored = withNames([{ pin: { componentId: 'R1', pinIndex: 1 }, name: 'V_o1' }]);
		const text = JSON.stringify(solveCircuit(underscored).methods.nodal);
		expect(text).toContain('V_{V\\\\_o1}');
		expect(text).not.toContain('V_{V_o1}');
	});
});

describe('node names: validation', () => {
	it.each([
		['', 'empty'],
		['   ', 'blank'],
		['0', 'reference id'],
		['gnd', 'GND (any case)'],
		['GND', 'GND'],
		['1A', 'starts with digit'],
		['a b', 'space'],
		['a-b', 'dash'],
		['ABCDEFG', '7 characters'],
		['B', 'duplicate']
	])('rejects %j (%s)', (name) => {
		expect(validateNodeName(name, ['A', 'B'])).toEqual(expect.any(String));
	});

	it.each(['Vo', 'Vout', 'v_1', 'X9', 'ABCDEF', '  Vo  '])('accepts %j', (name) => {
		expect(validateNodeName(name, ['A', 'B'])).toBeNull();
	});
});

describe('node names: persistence', () => {
	const named = withNames([{ pin: { componentId: 'R1', pinIndex: 1 }, name: 'Vo' }]);

	it('survives the JSON export/import round trip', () => {
		const res = parseCircuitImport(exportCircuitJson(named));
		expect(res.ok && res.sourceFormat === 'circuit-document').toBe(true);
		if (!res.ok) return;
		expect(res.document.nodeNames).toEqual(named.nodeNames);
		expect(buildElectricalGraph(res.document).nonRefNodeIds).toEqual(['A', 'Vo', 'B']);
	});

	it('survives the share-link round trip', async () => {
		const hash = await encodeCircuitToHash({ document: named });
		const decoded = await decodeCircuitFromHash(hash);
		expect(decoded).not.toBeNull();
		expect(decoded!.document.nodeNames).toEqual(named.nodeNames);
		expect(buildElectricalGraph(decoded!.document).nonRefNodeIds).toEqual(['A', 'Vo', 'B']);
	});

	it('loads old documents and links that have no nodeNames', async () => {
		const plain = preset('dc-supermesh');
		const res = parseCircuitImport(exportCircuitJson(plain));
		expect(res.ok).toBe(true);
		if (res.ok) expect(res.document.nodeNames).toBeUndefined();
		const decoded = await decodeCircuitFromHash(await encodeCircuitToHash({ document: plain }));
		expect(decoded).not.toBeNull();
		expect(decoded!.document.nodeNames).toBeUndefined();
	});

	it('drops malformed nodeNames entries with a warning instead of failing the import', () => {
		const obj = JSON.parse(exportCircuitJson(named));
		obj.nodeNames.push({ pin: { componentId: 'nope', pinIndex: 0 }, name: 'Z' }, 'junk');
		const res = parseCircuitImport(JSON.stringify(obj));
		expect(res.ok).toBe(true);
		if (!res.ok) return;
		expect(res.document.nodeNames).toEqual(named.nodeNames);
		expect(res.warnings.length).toBeGreaterThanOrEqual(2);
	});
});

describe('node names: LaTeX safety', () => {
	it('renders every step of every method without KaTeX errors when a node is named "a_b_c"', async () => {
		const katex = (await import('katex')).default;
		const failures: string[] = [];
		for (const p of PRESETS) {
			const g = buildElectricalGraph(p.document);
			const first = g.nonRefNodeIds[0];
			if (!first) continue;
			const pin = g.nodes[first].componentPins[0];
			const doc = { ...structuredClone(p.document), nodeNames: [{ pin, name: 'a_b_c' }] };
			const res = solveCircuit(doc, {
				methods: ['nodal', 'mesh', 'superposition', 'source_transform', 'thevenin_norton', 'kcl_kvl']
			});
			for (const [id, m] of Object.entries(res.methods ?? {})) {
				for (const step of m?.steps ?? []) {
					for (const tex of step.latex ?? []) {
						try {
							katex.renderToString(tex, { throwOnError: true });
						} catch (e) {
							failures.push(`${p.id}/${id}: ${String((e as Error).message).slice(0, 60)}`);
						}
					}
				}
			}
		}
		expect(failures).toEqual([]);
	});
});

describe('node names: legacy N<k> references', () => {
	it('maps old N1-style dependent-control and Thevenin terminal IDs to letters on load', async () => {
		const doc = preset('dc-supermesh');
		const legacy = JSON.parse(exportCircuitJson(doc));
		legacy.unknownProblem = {
			componentId: legacy.components.find((c: { kind: string }) => c.kind === 'resistor').id,
			constraint: { kind: 'node_voltage', targetId: 'N2', value: '1' }
		};
		const imported = parseCircuitImport(JSON.stringify(legacy));
		expect(imported.ok).toBe(true);
		if (!imported.ok) return;
		expect(imported.document.unknownProblem?.constraint.targetId).toBe('B');
		const hash = await encodeCircuitToHash({
			document: imported.document,
			theveninTarget: { kind: 'terminals', nodeA: 'N1', nodeB: 'N3' }
		});
		const back = await decodeCircuitFromHash(hash);
		expect(back?.theveninTarget).toEqual({ kind: 'terminals', nodeA: 'A', nodeB: 'C' });
	});
});
