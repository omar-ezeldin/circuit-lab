import type { MachineAnswerItem, MachineQuestionTypeId, MachineSolveResult } from './types';

export const MU_0 = 4 * Math.PI * 1e-7;
export const HP_TO_WATTS = 746;
export const J_PER_KWH = 3.6e6;
export const SQRT3 = Math.sqrt(3);
export const RAD_TO_DEG = 180 / Math.PI;
export const DEG_TO_RAD = Math.PI / 180;

export interface Complex {
	re: number;
	im: number;
}

export function c(re: number, im = 0): Complex {
	return { re, im };
}

export function cFromPolar(mag: number, deg: number): Complex {
	const rad = deg * DEG_TO_RAD;
	return { re: mag * Math.cos(rad), im: mag * Math.sin(rad) };
}

export function cAdd(a: Complex, b: Complex): Complex {
	return { re: a.re + b.re, im: a.im + b.im };
}

export function cSub(a: Complex, b: Complex): Complex {
	return { re: a.re - b.re, im: a.im - b.im };
}

export function cMul(a: Complex, b: Complex): Complex {
	return { re: a.re * b.re - a.im * b.im, im: a.re * b.im + a.im * b.re };
}

export function cDiv(a: Complex, b: Complex): Complex {
	const denom = b.re * b.re + b.im * b.im;
	if (denom === 0) return { re: NaN, im: NaN };
	return {
		re: (a.re * b.re + a.im * b.im) / denom,
		im: (a.im * b.re - a.re * b.im) / denom
	};
}

export function cConj(a: Complex): Complex {
	return { re: a.re, im: -a.im };
}

export function cAbs(a: Complex): number {
	return Math.hypot(a.re, a.im);
}

export function cArgDeg(a: Complex): number {
	return Math.atan2(a.im, a.re) * RAD_TO_DEG;
}

export function cParallel(a: Complex, b: Complex): Complex {
	return cDiv(cMul(a, b), cAdd(a, b));
}

export function isFinitePos(v: unknown): v is number {
	return typeof v === 'number' && Number.isFinite(v) && v > 0;
}

export function isFiniteNonNeg(v: unknown): v is number {
	return typeof v === 'number' && Number.isFinite(v) && v >= 0;
}

export function isFiniteNum(v: unknown): v is number {
	return typeof v === 'number' && Number.isFinite(v);
}

export function fmt(n: number, decimals = 4): string {
	if (!Number.isFinite(n)) return n === Infinity ? '\\infty' : 'NaN';
	if (Math.abs(n) === 0) return '0';
	const abs = Math.abs(n);
	if (abs >= 1e6 || (abs > 0 && abs < 1e-4)) {
		return n.toExponential(decimals);
	}
	return Number(n.toFixed(decimals)).toString();
}

export function fmtTexSci(n: number, decimals = 3): string {
	if (!Number.isFinite(n)) return n === Infinity ? '\\infty' : '\\text{NaN}';
	if (Math.abs(n) === 0) return '0';
	const abs = Math.abs(n);
	if (abs >= 1e6 || (abs > 0 && abs < 1e-3)) {
		const exp = Math.floor(Math.log10(abs));
		const mant = n / Math.pow(10, exp);
		return `${mant.toFixed(decimals)} \\times 10^{${exp}}`;
	}
	return Number(n.toFixed(decimals)).toString();
}

export function fmtPolar(mag: number, deg: number, unit = '', decimals = 2): string {
	const suffix = unit ? ` ${unit}` : '';
	return `${fmt(mag, decimals)} ∠ ${fmt(deg, decimals)}°${suffix}`;
}

export function fmtPolarTex(mag: number, deg: number, unit = '', decimals = 2): string {
	const suffix = unit ? `\\text{ ${unit}}` : '';
	return `${fmt(mag, decimals)}\\angle ${fmt(deg, decimals)}^\\circ${suffix}`;
}

export function fmtComplex(z: Complex, unit = '', decimals = 3): string {
	const sign = z.im >= 0 ? '+' : '-';
	const suffix = unit ? ` ${unit}` : '';
	return `${fmt(z.re, decimals)} ${sign} j${fmt(Math.abs(z.im), decimals)}${suffix}`;
}

export function makeAnswer(
	key: string,
	label: string,
	value: number,
	unit: string,
	options?: { symbolLatex?: string; decimals?: number; highlight?: boolean; formatted?: string }
): MachineAnswerItem {
	const decimals = options?.decimals ?? 4;
	const formatted =
		options?.formatted ?? `${fmt(value, decimals)}${unit ? ` ${unit}` : ''}`;
	return {
		key,
		label,
		symbolLatex: options?.symbolLatex,
		value,
		unit,
		formatted,
		highlight: options?.highlight
	};
}

export function errorResult(
	questionType: MachineQuestionTypeId,
	title: string,
	error: string
): MachineSolveResult {
	return {
		valid: false,
		questionType,
		title,
		answers: [],
		values: {},
		steps: [],
		error
	};
}
