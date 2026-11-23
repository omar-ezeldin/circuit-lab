import { describe, expect, it } from 'vitest';
import { Complex } from '../complex';
import { latexName, reduceSeriesParallel, reqLatex, walkToTarget, type SpEdge } from './sp-reduce';

function edge(id: string, nodeA: string, nodeB: string, r: number): SpEdge {
	return { id, label: id, nodeA, nodeB, z: Complex.from(r, 0) };
}

describe('sp-reduce: series-parallel reduction', () => {
	it('series', () => {
		const red = reduceSeriesParallel({
			edges: [edge('R1', 'a', 'b', 1000), edge('R2', 'b', 'c', 2000)],
			ports: ['a', 'c']
		});
		expect(red.ok).toBe(true);
		expect(red.root?.kind).toBe('series');
		expect(red.root?.z.re).toBeCloseTo(3000, 9);
		expect(reqLatex(red.root!, 'dc')).toBe(
			'R_{eq} = R_{1} + R_{2} = 1000 + 2000 = 3000\\;\\Omega'
		);
	});

	it('parallel of two uses product over sum, three uses the reciprocal form', () => {
		const two = reduceSeriesParallel({
			edges: [edge('R1', 'a', 'b', 1000), edge('R2', 'a', 'b', 1000)],
			ports: ['a', 'b']
		});
		expect(two.ok).toBe(true);
		expect(two.root?.z.re).toBeCloseTo(500, 9);
		expect(reqLatex(two.root!, 'dc')).toBe(
			'R_{eq} = R_{1} \\parallel R_{2} = \\frac{1000 \\cdot 1000}{1000 + 1000} = 500\\;\\Omega'
		);
		const three = reduceSeriesParallel({
			edges: [edge('Ra', 'a', 'b', 30), edge('Rb', 'a', 'b', 60), edge('Rc', 'b', 'a', 60)],
			ports: ['a', 'b']
		});
		expect(three.root?.z.re).toBeCloseTo(15, 9);
		expect(reqLatex(three.root!, 'dc')).toContain('\\left(\\frac{1}{30} + \\frac{1}{60} + \\frac{1}{60}\\right)^{-1}');
	});

	it('series of a parallel pair, written as the course writes it', () => {
		const red = reduceSeriesParallel({
			edges: [edge('R1', 'a', 'b', 1000), edge('R2', 'b', 'c', 1000), edge('R3', 'b', 'c', 1000)],
			ports: ['a', 'c']
		});
		expect(red.ok).toBe(true);
		expect(red.root?.z.re).toBeCloseTo(1500, 9);
		expect(reqLatex(red.root!, 'dc')).toBe(
			'R_{eq} = R_{1} + (R_{2} \\parallel R_{3}) = 1000 + \\frac{1000 \\cdot 1000}{1000 + 1000} = 1500\\;\\Omega'
		);
	});

	it('a bridge is reported as not reducible', () => {
		const red = reduceSeriesParallel({
			edges: [
				edge('R1', 'a', 'b', 100),
				edge('R2', 'a', 'c', 200),
				edge('R3', 'b', 'd', 300),
				edge('R4', 'c', 'd', 100),
				edge('R5', 'b', 'c', 150)
			],
			ports: ['a', 'd']
		});
		expect(red.ok).toBe(false);
		expect(red.reason).toMatch(/bridge/);
		expect(red.root).toBeUndefined();
	});

	it('drops a dangling edge and says it carries no current', () => {
		const red = reduceSeriesParallel({
			edges: [edge('R1', 'a', 'b', 100), edge('R2', 'b', 'c', 200), edge('R5', 'c', 'x', 50)],
			ports: ['a', 'b']
		});
		// c is a dead end (R5 dangles at x, then R2 dangles at c): both carry no current.
		expect(red.ok).toBe(true);
		expect(red.dangling.map((e) => e.id).sort()).toEqual(['R2', 'R5']);
		expect(red.root?.z.re).toBeCloseTo(100, 9);
	});

	it('contracts a shorted edge (wire across it) and keeps the rest', () => {
		const red = reduceSeriesParallel({
			edges: [edge('R1', 'a', 'b', 100), edge('R2', 'b', 'c', 200)],
			shorts: [['b', 'c']],
			ports: ['a', 'c']
		});
		expect(red.ok).toBe(true);
		expect(red.shorted.map((e) => e.id)).toEqual(['R2']);
		expect(red.root?.z.re).toBeCloseTo(100, 9);
	});

	it('treats a zero-impedance edge as a wire and fails when the ports end up shorted', () => {
		const zero: SpEdge = { id: 'L1', label: 'L1', nodeA: 'a', nodeB: 'b', z: Complex.zero() };
		const red = reduceSeriesParallel({ edges: [zero, edge('R1', 'b', 'c', 100)], ports: ['a', 'c'] });
		expect(red.ok).toBe(true);
		expect(red.zeroImpedance.map((e) => e.id)).toEqual(['L1']);
		const shorted = reduceSeriesParallel({ edges: [edge('R1', 'a', 'b', 100)], shorts: [['a', 'b']], ports: ['a', 'b'] });
		expect(shorted.ok).toBe(false);
	});

	it('works with complex impedances', () => {
		const red = reduceSeriesParallel({
			edges: [
				{ id: 'L1', label: 'L1', nodeA: 'a', nodeB: 'b', z: Complex.j(4) },
				{ id: 'R1', label: 'R1', nodeA: 'b', nodeB: 'c', z: Complex.from(3, 0) }
			],
			ports: ['a', 'c']
		});
		expect(red.root?.z.re).toBeCloseTo(3, 9);
		expect(red.root?.z.im).toBeCloseTo(4, 9);
	});

	it('fails cleanly on a lossless parallel resonance instead of throwing', () => {
		const red = reduceSeriesParallel({
			edges: [
				{ id: 'L1', label: 'L1', nodeA: 'a', nodeB: 'b', z: Complex.j(5) },
				{ id: 'C1', label: 'C1', nodeA: 'a', nodeB: 'b', z: Complex.j(-5) }
			],
			ports: ['a', 'b']
		});
		expect(red.ok).toBe(false);
	});
});

describe('sp-reduce: walking to a target', () => {
	const ladder = reduceSeriesParallel({
		edges: [edge('R1', 'a', 'b', 1000), edge('R2', 'b', 'c', 1000), edge('R3', 'b', 'c', 3000)],
		ports: ['a', 'c']
	});

	it('series element carries the source current; parallel splits it with a divider', () => {
		const r1 = walkToTarget({
			root: ladder.root!,
			entry: 'a',
			current: Complex.from(0.004, 0),
			currentName: 'I_s',
			targetId: 'R1',
			finalName: "I'_{R_{1}}",
			mode: 'dc'
		})!;
		expect(r1.lines).toEqual([]);
		expect(r1.current.re).toBeCloseTo(0.004, 12);
		expect(r1.reversed).toBe(false);

		const r2 = walkToTarget({
			root: ladder.root!,
			entry: 'a',
			current: Complex.from(0.004, 0),
			currentName: 'I_s',
			targetId: 'R2',
			finalName: "I'_{R_{2}}",
			mode: 'dc'
		})!;
		// I * 3000 / (1000 + 3000) = 3 mA
		expect(r2.current.re).toBeCloseTo(0.003, 12);
		expect(r2.lines).toHaveLength(1);
		expect(r2.lines[0]).toContain("I'_{R_{2}} = I_s \\cdot \\frac{R_{3}}{R_{2} + R_{3}}");
		expect(r2.lines[0]).toContain('\\text{ A}');
	});

	it('gives the negative current when the walk runs against the edge direction', () => {
		const w = walkToTarget({
			root: ladder.root!,
			entry: 'c',
			current: Complex.from(0.004, 0),
			currentName: 'I_s',
			targetId: 'R1',
			finalName: 'I_x',
			mode: 'dc'
		})!;
		expect(w.reversed).toBe(true);
		expect(w.current.re).toBeCloseTo(-0.004, 12);
	});

	it('returns null for a target that is not in the tree', () => {
		const w = walkToTarget({
			root: ladder.root!,
			entry: 'a',
			current: Complex.one(),
			currentName: 'I_s',
			targetId: 'nope',
			finalName: 'I_x',
			mode: 'dc'
		});
		expect(w).toBeNull();
	});
});

describe('sp-reduce: names', () => {
	it('subscripts labels', () => {
		expect(latexName('R1')).toBe('R_{1}');
		expect(latexName('RL')).toBe('R_{L}');
		expect(latexName('R')).toBe('R');
		expect(latexName('')).toBe('\\text{?}');
	});
});

describe('walkToTarget: series chain entered from its far end', () => {
	it('keeps the right sign when the chain was built from the other port', () => {
		const red = reduceSeriesParallel({
			edges: [edge('Ra', 'Q', 'M', 1000), edge('Rb', 'M', 'P', 2000)],
			ports: ['P', 'Q']
		});
		const w = walkToTarget({
			root: red.root!,
			entry: 'Q',
			current: Complex.from(1, 0),
			currentName: 'I_s',
			targetId: 'Ra',
			finalName: "I'_{R_{a}}",
			mode: 'dc'
		})!;
		expect(w.current.re).toBeCloseTo(1, 12);
		expect(w.reversed).toBe(false);
	});
});
