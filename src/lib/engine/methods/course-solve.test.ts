import { describe, expect, it } from 'vitest';
import { Complex } from '../complex';
import { courseSolveDisplay } from './shared';

const c = (re: number) => Complex.from(re, 0);

/** The number at the end of the last line that defines `name` (e.g. "x = ... = 2\text{ V}"). */
function printedValue(lines: string[], name: string): number | undefined {
	for (const l of [...lines].reverse()) {
		if (!l.includes(`${name} =`)) continue;
		const m = l.match(/= (-?\d+(?:\.\d+)?)\\text\{ \w+\}$/);
		if (m) return Number(m[1]);
	}
	return undefined;
}

describe('courseSolveDisplay', () => {
	it('solves a single equation in one line, without a matrix', () => {
		const d = courseSolveDisplay([[c(0.75)]], [c(3)], ['V_{N1}'], 'V', 'dc');
		expect(d.remaining).toBe(1);
		expect(d).not.toHaveProperty('matrixLatex');
		expect(d.latex.join(' ')).toMatch(/V_{N1} = .* = 4\\text/);
		// No bare ';' (a lost backslash in "\;") and no nested fractions.
		for (const l of d.latex) {
			expect(l).not.toMatch(/(^|[^\\]);/);
			expect(l).not.toMatch(/\\frac\{[^}]*\\frac/);
		}
	});

	it('substitutes a mesh current fixed by a current source, then solves the one left', () => {
		// I1 = 2 (current source); 6 I2 - 2 I1 = 8  ->  I2 = 2
		const d = courseSolveDisplay(
			[
				[c(1), c(0)],
				[c(-2), c(6)]
			],
			[c(2), c(8)],
			['I_{m1}', 'I_{m2}'],
			'A',
			'dc'
		);
		expect(d.remaining).toBe(1);
		expect(d.latex[0]).toBe('I_{m1} = 2\\text{ A}');
		expect(d.latex.at(-1)).toContain('I_{m2} = \\frac{12}{6} = 2');
	});

	it('solves 2 simultaneous equations by substitution, with no matrix', () => {
		// 3x + y = 7 ; x + 2y = 4  ->  x = 2, y = 1
		const d = courseSolveDisplay(
			[
				[c(3), c(1)],
				[c(1), c(2)]
			],
			[c(7), c(4)],
			['x', 'y'],
			'V',
			'dc'
		);
		expect(d.remaining).toBe(2);
		const all = d.latex.join('\n');
		expect(all).not.toContain('bmatrix');
		expect(all).toContain('Back-substituting');
		expect(printedValue(d.latex, 'y')).toBe(1);
		expect(printedValue(d.latex, 'x')).toBe(2);
		for (const l of d.latex) expect(l).not.toMatch(/(^|[^\\]);/);
	});

	it('solves 3 simultaneous equations by substitution, with no matrix', () => {
		// x + y + z = 6 ; 2y + z = 5 ; x - y + 2z = 7  ->  x = 2, y = 1, z = 3
		const d = courseSolveDisplay(
			[
				[c(1), c(1), c(1)],
				[c(0), c(2), c(1)],
				[c(1), c(-1), c(2)]
			],
			[c(6), c(5), c(7)],
			['x', 'y', 'z'],
			'V',
			'dc'
		);
		expect(d.remaining).toBe(3);
		const all = d.latex.join('\n');
		expect(all).not.toContain('bmatrix');
		expect(printedValue(d.latex, 'z')).toBe(3);
		expect(printedValue(d.latex, 'y')).toBe(1);
		expect(printedValue(d.latex, 'x')).toBe(2);
		for (const l of d.latex) {
			expect(l).not.toMatch(/(^|[^\\]);/);
			expect(l).not.toMatch(/\\frac\{[^}]*\\frac/);
		}
	});

	it('shows one elimination then points to the calculator beyond 4 unknowns', () => {
		const n = 5;
		const A = Array.from({ length: n }, (_, i) =>
			Array.from({ length: n }, (_, j) => c(i === j ? 4 : j === i + 1 || j === i - 1 ? -1 : 0))
		);
		const b = Array.from({ length: n }, () => c(1));
		const d = courseSolveDisplay(A, b, ['a', 'b', 'c', 'd', 'e'], 'V', 'dc');
		const all = d.latex.join('\n');
		expect(all).toContain('MODE EQN');
		expect(all).not.toContain('bmatrix');
		expect(d.latex.filter((l) => l.includes('fewest unknowns')).length).toBe(1);
		expect(d.latex.at(-1)).toContain('e = ');
	});
});
