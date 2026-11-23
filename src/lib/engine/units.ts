/**
 * SI engineering prefix parsing/formatting and complex phasor string parsing.
 */

import { Complex } from './complex';
import type { UnitSystemId } from './types';

export interface FixedUnitPrefix {
	symbol: string;
	factor: number;
}

export interface UnitSystemDefinition {
	id: UnitSystemId;
	label: string;
	shortLabel: string;
	description: string;
	prefixes?: Record<string, FixedUnitPrefix>;
}

export const UNIT_SYSTEMS: Record<UnitSystemId, UnitSystemDefinition> = {
	auto: {
		id: 'auto',
		label: 'Auto SI',
		shortLabel: 'Auto SI',
		description: 'Best-fit engineering prefixes (Ω/kΩ, V, A/mA/µA)'
	},
	'ohm-v-a': {
		id: 'ohm-v-a',
		label: 'Ω · V · A · W',
		shortLabel: 'Ω · V · A',
		description: 'Base SI units (ohms, volts, amperes, watts)',
		prefixes: {
			Ω: { symbol: '', factor: 1 },
			V: { symbol: '', factor: 1 },
			A: { symbol: '', factor: 1 },
			W: { symbol: '', factor: 1 },
			VAR: { symbol: '', factor: 1 },
			VA: { symbol: '', factor: 1 }
		}
	},
	'kohm-v-ma': {
		id: 'kohm-v-ma',
		label: 'kΩ · V · mA · mW',
		shortLabel: 'kΩ · V · mA',
		description: 'Electronics scale (kiloohms, volts, milliamperes, milliwatts)',
		prefixes: {
			Ω: { symbol: 'k', factor: 1e3 },
			V: { symbol: '', factor: 1 },
			A: { symbol: 'm', factor: 1e-3 },
			W: { symbol: 'm', factor: 1e-3 },
			VAR: { symbol: 'm', factor: 1e-3 },
			VA: { symbol: 'm', factor: 1e-3 }
		}
	},
	'mohm-v-ua': {
		id: 'mohm-v-ua',
		label: 'MΩ · V · µA · µW',
		shortLabel: 'MΩ · V · µA',
		description: 'High-impedance scale (megaohms, volts, microamperes, microwatts)',
		prefixes: {
			Ω: { symbol: 'M', factor: 1e6 },
			V: { symbol: '', factor: 1 },
			A: { symbol: 'µ', factor: 1e-6 },
			W: { symbol: 'µ', factor: 1e-6 },
			VAR: { symbol: 'µ', factor: 1e-6 },
			VA: { symbol: 'µ', factor: 1e-6 }
		}
	}
};

const SI_PREFIXES: Record<string, number> = {
	f: 1e-15,
	p: 1e-12,
	n: 1e-9,
	u: 1e-6,
	µ: 1e-6,
	μ: 1e-6,
	m: 1e-3,
	k: 1e3,
	K: 1e3,
	M: 1e6,
	Meg: 1e6,
	meg: 1e6,
	G: 1e9,
	T: 1e12
};

const KNOWN_UNITS = new Set([
	'ω',
	'ohm',
	'ohms',
	'f',
	'h',
	'v',
	'a',
	'hz',
	'w',
	'va',
	'var',
	's',
	'v/v',
	'a/v',
	'v/a',
	'a/a'
]);

const DISPLAY_PREFIXES: Array<{ exp: number; symbol: string; factor: number }> = [
	{ exp: 12, symbol: 'T', factor: 1e12 },
	{ exp: 9, symbol: 'G', factor: 1e9 },
	{ exp: 6, symbol: 'M', factor: 1e6 },
	{ exp: 3, symbol: 'k', factor: 1e3 },
	{ exp: 0, symbol: '', factor: 1 },
	{ exp: -3, symbol: 'm', factor: 1e-3 },
	{ exp: -6, symbol: 'µ', factor: 1e-6 },
	{ exp: -9, symbol: 'n', factor: 1e-9 },
	{ exp: -12, symbol: 'p', factor: 1e-12 },
	{ exp: -15, symbol: 'f', factor: 1e-15 }
];

function stripUnitSuffix(tail: string): { prefixFactor: number; valid: boolean } {
	const cleaned = tail.trim();
	if (cleaned === '') return { prefixFactor: 1, valid: true };

	// For single-character suffixes, SI prefixes (e.g. 'f' femto, 'm' milli) take
	// precedence over case-insensitive unit letters (e.g. 'F' Farad).
	if (cleaned.length === 1) {
		if (cleaned in SI_PREFIXES) {
			return { prefixFactor: SI_PREFIXES[cleaned], valid: true };
		}
		if (KNOWN_UNITS.has(cleaned.toLowerCase())) {
			return { prefixFactor: 1, valid: true };
		}
		return { prefixFactor: 1, valid: false };
	}

	// Check multi-character bare units (e.g. "ohm", "ohms", "Hz", "VA", "VAR")
	if (KNOWN_UNITS.has(cleaned.toLowerCase())) {
		return { prefixFactor: 1, valid: true };
	}

	// Check multi-char "Meg" / "meg" prefix first
	if (cleaned.startsWith('Meg') || cleaned.startsWith('meg')) {
		const rest = cleaned.slice(3).trim();
		if (rest === '' || KNOWN_UNITS.has(rest.toLowerCase())) {
			return { prefixFactor: 1e6, valid: true };
		}
		return { prefixFactor: 1, valid: false };
	}

	// Check single-char SI prefix followed by a unit (e.g. "10kΩ", "5.5fF", "4.7µF", "100mH")
	const first = cleaned[0];
	if (first in SI_PREFIXES) {
		const rest = cleaned.slice(1).trim();
		if (rest === '' || KNOWN_UNITS.has(rest.toLowerCase())) {
			return { prefixFactor: SI_PREFIXES[first], valid: true };
		}
	}

	return { prefixFactor: 1, valid: false };
}

/**
 * Normalises text pasted from PDFs/Word: Unicode minus and dashes (−, –, —) become "-", and
 * resistor-code values put the prefix in place of the decimal point ("4k7" -> "4.7k",
 * "2M2" -> "2.2M", "4R7" -> "4.7").
 */
export function normalizeNumericText(input: string): string {
	return input
		.replace(/[\u2212\u2012\u2013\u2014\uFE63\uFF0D]/g, '-')
		.replace(/^([+-]?\d+)([pnuµμmkKMGR])(\d+)(?![\d.])/, (_m, int: string, p: string, frac: string) =>
			p === 'R' ? `${int}.${frac}` : `${int}.${frac}${p}`
		);
}

/**
 * Parses an engineering number with optional SI prefix and unit.
 * Examples: "10k" -> 10000, "4.7u" -> 4.7e-6, "100m" -> 0.1, "2.2M" -> 2.2e6, "470 Ω" -> 470.
 * Returns `null` if the string cannot be parsed.
 */
export function parseEngineeringNumber(input: string | number): number | null {
	if (typeof input === 'number') {
		return Number.isFinite(input) ? input : null;
	}
	const trimmed = normalizeNumericText(input.trim());
	if (!trimmed) return null;

	const match = trimmed.match(/^([+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?)\s*(.*)$/);
	if (!match) return null;

	const base = Number(match[1]);
	if (!Number.isFinite(base)) return null;

	const { prefixFactor, valid } = stripUnitSuffix(match[2]);
	if (!valid) return null;

	const result = base * prefixFactor;
	return Number.isFinite(result) ? result : null;
}

/**
 * Strips matching outer parentheses around a string if they wrap the entire expression.
 */
function unwrapOuterParens(raw: string): string {
	let s = raw.trim();
	while (s.startsWith('(') && s.endsWith(')')) {
		let depth = 0;
		let wrapsWhole = true;
		for (let i = 0; i < s.length - 1; i++) {
			if (s[i] === '(') depth++;
			else if (s[i] === ')') {
				depth--;
				if (depth === 0) {
					wrapsWhole = false;
					break;
				}
			}
		}
		if (!wrapsWhole) break;
		s = s.slice(1, -1).trim();
	}
	return s;
}

/**
 * Parses a real or complex engineering value.
 * Supports:
 * - Polar: "50∠30°", "50@-30", "120<30", "10k∠-45 deg", "100<-90 Ω"
 * - Rectangular: "30+j40", "30-40j", "j100", "-j50", "j1 Ω", "-j1 Ω", "2 + j 1", "1-j", "j", "-j"
 * - Pure real engineering numbers: "10k", "470 Ω"
 */
export function parseComplexValue(input: string | number): Complex | null {
	if (typeof input === 'number') {
		return Number.isFinite(input) ? Complex.from(input, 0) : null;
	}
	// Strip optional trailing Ω / ohm / ohms (case-insensitive) and matching outer parentheses
	const withoutOhm = input
		.trim()
		.replace(/[\u2212\u2012\u2013\u2014\uFE63\uFF0D]/g, '-')
		.replace(/\s*(?:Ω|ohms?)\s*$/i, '').trim();
	const trimmed = unwrapOuterParens(withoutOhm);
	if (!trimmed) return null;

	// Strip trailing common electrical units when attached after polar/complex forms like "50∠30° V"
	const polarMatch = trimmed.match(/^(.+?)\s*(?:∠|@|<)\s*(.+?)(?:°|deg)?(?:\s*(?:Ω|ohms?|va|var|[vaw]))?$/i);
	if (polarMatch) {
		const mag = parseEngineeringNumber(polarMatch[1]);
		// Angle should be a plain number (possibly with ° or deg stripped)
		const angleStr = polarMatch[2].replace(/(?:°|deg)\s*$/i, '').trim();
		const deg = Number(angleStr);
		if (mag !== null && angleStr !== '' && Number.isFinite(deg)) {
			return Complex.fromPolar(mag, deg);
		}
		return null;
	}

	// Try pure real engineering number first
	const realOnly = parseEngineeringNumber(trimmed);
	if (realOnly !== null) {
		return Complex.from(realOnly, 0);
	}

	// Normalize whitespace for rectangular complex parsing
	const compact = trimmed.replace(/\s+/g, '');

	// Pure imaginary: "[+-]?j<num>" or "[+-]?<num>j" or "[+-]?j"
	const pureJPrefix = compact.match(/^([+-]?)j(.*)$/i);
	if (pureJPrefix) {
		const sign = pureJPrefix[1] === '-' ? -1 : 1;
		const rest = pureJPrefix[2];
		if (rest === '') return Complex.from(0, sign);
		const val = parseEngineeringNumber(rest);
		if (val !== null) return Complex.from(0, sign * val);
	}

	const pureJSuffix = compact.match(/^(.+?)j$/i);
	if (pureJSuffix && !/[+-]/.test(pureJSuffix[1].replace(/^[+-]/, '').replace(/[eE][+-]/g, ''))) {
		const val = parseEngineeringNumber(pureJSuffix[1]);
		if (val !== null) return Complex.from(0, val);
	}

	// General rectangular form: <realTerm><op><imagTerm>
	// Scan for binary '+' or '-' that is not at index 0 and not immediately preceded by 'e' or 'E'.
	let splitIdx = -1;
	for (let i = 1; i < compact.length; i++) {
		const ch = compact[i];
		if ((ch === '+' || ch === '-') && compact[i - 1] !== 'e' && compact[i - 1] !== 'E') {
			splitIdx = i;
			break;
		}
	}

	if (splitIdx !== -1) {
		const left = compact.slice(0, splitIdx);
		const right = compact.slice(splitIdx); // includes leading '+' or '-'
		const re = parseEngineeringNumber(left);
		if (re === null) return null;

		const imag = parseComplexValue(right);
		if (imag !== null && imag.re === 0) {
			return Complex.from(re, imag.im);
		}
	}

	return null;
}

/**
 * Formats a real scalar value using SI engineering prefixes and an optional unit.
 */
export function formatEngineering(value: number, unit = '', prec = 3): string {
	if (!Number.isFinite(value)) return String(value);
	if (value === 0 || Math.abs(value) < 1e-18) {
		return unit ? `0 ${unit}` : '0';
	}

	const abs = Math.abs(value);
	let chosen = DISPLAY_PREFIXES[DISPLAY_PREFIXES.length - 1];
	for (const candidate of DISPLAY_PREFIXES) {
		if (abs >= candidate.factor * (1 - 1e-12)) {
			chosen = candidate;
			break;
		}
	}

	// Handle numbers larger than 1000 T or smaller than 1 f
	if (abs >= 1e15 || abs < 1e-15) {
		const expStr = Number(value.toPrecision(prec)).toExponential().replace(/e\+?/, 'e');
		return unit ? `${expStr} ${unit}` : expStr;
	}

	const scaled = value / chosen.factor;
	// If rounding bumps 999.999 to 1000, step up one SI tier if available
	const rounded = Number(scaled.toPrecision(prec));
	if (Math.abs(rounded) >= 1000) {
		const idx = DISPLAY_PREFIXES.indexOf(chosen);
		if (idx > 0) {
			chosen = DISPLAY_PREFIXES[idx - 1];
			const rescaled = Number((value / chosen.factor).toPrecision(prec));
			const numStr = rescaled.toString();
			return unit ? `${numStr} ${chosen.symbol}${unit}` : `${numStr}${chosen.symbol}`;
		}
	}

	const numStr = rounded.toString();
	return unit ? `${numStr} ${chosen.symbol}${unit}` : `${numStr}${chosen.symbol}`;
}

/**
 * Returns the fixed SI prefix for a given electrical unit under a defined unit system,
 * or `null` when `unitSystem` is `'auto'` or the unit (e.g. `F`, `H`, `Hz`) is not fixed.
 */
export function getFixedUnitPrefix(
	unit: string,
	unitSystem: UnitSystemId
): FixedUnitPrefix | null {
	if (unitSystem === 'auto' || !unit) {
		return null;
	}
	const def = UNIT_SYSTEMS[unitSystem];
	if (!def?.prefixes) {
		return null;
	}
	return def.prefixes[unit] ?? null;
}

/**
 * Formats a real scalar value honoring an active defined engineering unit system.
 * Delegates to `formatEngineering` when `unitSystem === 'auto'` or the unit has no
 * fixed prefix in the selected system (e.g. `F`, `H`, `Hz`).
 */
export function formatEngineeringWithSystem(
	value: number,
	unit = '',
	prec = 3,
	unitSystem: UnitSystemId = 'auto'
): string {
	if (!Number.isFinite(value)) return String(value);

	const fixed = getFixedUnitPrefix(unit, unitSystem);
	if (!fixed) {
		return formatEngineering(value, unit, prec);
	}

	const unitWithPrefix = `${fixed.symbol}${unit}`;
	if (value === 0 || Math.abs(value) < 1e-18) {
		return `0 ${unitWithPrefix}`;
	}

	const scaled = value / fixed.factor;
	const rounded = Number(scaled.toPrecision(prec));
	const absRounded = Math.abs(rounded);

	let numStr: string;
	if (rounded === 0) {
		numStr = '0';
	} else if (absRounded >= 1e-4 && absRounded < 1e6) {
		numStr = rounded.toString();
	} else {
		numStr = rounded.toExponential().replace(/e\+?/, 'e');
	}

	return `${numStr} ${unitWithPrefix}`;
}
