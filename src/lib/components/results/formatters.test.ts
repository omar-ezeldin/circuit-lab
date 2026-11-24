import { describe, expect, it } from 'vitest';
import { Complex } from '$lib/engine/complex';
import {
	formatApparentPower,
	formatComplexParts,
	formatComplexValue,
	formatDcQuantity,
	formatFrequency,
	formatPolarQuantity,
	formatPowerFactor,
	formatReactivePower,
	formatRealPower,
	formatRectangularQuantity
} from './formatters';

describe('results formatters', () => {
	it('formats DC quantities with optional exact repeating rational fractions', () => {
		expect(
			formatDcQuantity(10 / 3, 'V', { precision: 4, showDcFractions: true })
		).toBe('10/3 V = 3.333 V');

		expect(
			formatDcQuantity(10 / 3, 'V', { precision: 3, showDcFractions: false })
		).toBe('3.33 V');

		// Terminating decimals do not emit redundant fractions
		expect(
			formatDcQuantity(12, 'V', { precision: 3, showDcFractions: true })
		).toBe('12 V');
		expect(
			formatDcQuantity(0.004, 'A', { precision: 3, showDcFractions: true })
		).toBe('4 mA');

		// Auto SI scaled exact fractions (4/3 mA and 2/3 mA)
		expect(
			formatDcQuantity(0.004 / 3, 'A', {
				precision: 3,
				showDcFractions: true,
				unitSystem: 'auto'
			})
		).toBe('4/3 mA = 1.33 mA');
		expect(
			formatDcQuantity(0.004 / 3, 'A', {
				precision: 3,
				showDcFractions: false,
				unitSystem: 'auto'
			})
		).toBe('1.33 mA');

		expect(
			formatDcQuantity(0.002 / 3, 'A', {
				precision: 3,
				showDcFractions: true,
				unitSystem: 'auto'
			})
		).toBe('2/3 mA = 667 µA');
		expect(
			formatDcQuantity(0.002 / 3, 'A', {
				precision: 3,
				showDcFractions: false,
				unitSystem: 'auto'
			})
		).toBe('667 µA');
	});

	it('formats AC polar and rectangular quantities with SI prefixes', () => {
		const v = Complex.from(9.92, -7.45);
		expect(formatRectangularQuantity(v, 'V', 3)).toBe('9.92 - j7.45 V');
		expect(formatPolarQuantity(v, 'V', 3)).toBe('12.4∠-36.9° V');

		const smallI = Complex.fromPolar(0.0124, -36.9);
		expect(formatPolarQuantity(smallI, 'A', 3)).toBe('12.4∠-36.9° mA');
	});

	it('respects angleDisplay: polar, rectangular, and both', () => {
		const c = Complex.fromPolar(12.4, -36.9);

		expect(
			formatComplexValue(c, 'V', 'ac', { angleDisplay: 'polar', precision: 3 })
		).toContain('12.4∠-36.9° V');

		expect(
			formatComplexValue(c, 'V', 'ac', { angleDisplay: 'rectangular', precision: 3 })
		).toContain('9.92 - j7.45 V');

		const both = formatComplexParts(c, 'V', 'ac', { angleDisplay: 'both', precision: 3 });
		expect(both.primary).toBe('12.4∠-36.9° V');
		expect(both.secondary).toBe('9.92 - j7.45 V');
	});

	it('formats power, power factor, and frequency cleanly', () => {
		expect(formatRealPower(1500, { precision: 3 })).toBe('1.5 kW');
		expect(formatPowerFactor(0.85, 'lagging')).toBe('0.85 lag');
		expect(formatPowerFactor(null)).toBe('—');
		expect(formatFrequency(1000)).toBe('1 kHz');
	});

	it('honors all four unit systems for DC quantities including scaled rational fractions', () => {
		// 2/3 mA = 0.0006666... A
		const twoThirdsMa = 2 / 3000;
		expect(
			formatDcQuantity(twoThirdsMa, 'A', {
				precision: 3,
				showDcFractions: true,
				unitSystem: 'kohm-v-ma'
			})
		).toBe('2/3 mA = 0.667 mA');

		expect(
			formatDcQuantity(twoThirdsMa, 'A', {
				precision: 3,
				showDcFractions: false,
				unitSystem: 'kohm-v-ma'
			})
		).toBe('0.667 mA');

		expect(
			formatDcQuantity(0.05, 'A', {
				precision: 3,
				showDcFractions: true,
				unitSystem: 'ohm-v-a'
			})
		).toBe('0.05 A');

		expect(
			formatDcQuantity(1500, 'Ω', {
				precision: 3,
				showDcFractions: true,
				unitSystem: 'ohm-v-a'
			})
		).toBe('1500 Ω');

		expect(
			formatDcQuantity(470, 'Ω', {
				precision: 3,
				showDcFractions: true,
				unitSystem: 'kohm-v-ma'
			})
		).toBe('0.47 kΩ');

		expect(
			formatDcQuantity(2.5e-5, 'A', {
				precision: 3,
				showDcFractions: true,
				unitSystem: 'mohm-v-ua'
			})
		).toBe('25 µA');

		expect(
			formatDcQuantity(0, 'A', {
				precision: 3,
				showDcFractions: true,
				unitSystem: 'kohm-v-ma'
			})
		).toBe('0 mA');

		// Pass-through unit (F) stays auto SI
		expect(
			formatDcQuantity(4.7e-6, 'F', {
				precision: 3,
				showDcFractions: true,
				unitSystem: 'kohm-v-ma'
			})
		).toBe('4.7 µF');
	});

	it('honors unit systems for AC polar and rectangular quantities', () => {
		const iPhasor = Complex.fromPolar(0.0124, -36.9);
		expect(formatPolarQuantity(iPhasor, 'A', 3, 'auto')).toBe('12.4∠-36.9° mA');
		expect(formatPolarQuantity(iPhasor, 'A', 3, 'ohm-v-a')).toBe('0.0124∠-36.9° A');
		expect(formatPolarQuantity(iPhasor, 'A', 3, 'kohm-v-ma')).toBe('12.4∠-36.9° mA');
		expect(formatPolarQuantity(iPhasor, 'A', 3, 'mohm-v-ua')).toBe('12400∠-36.9° µA');

		const iRect = Complex.from(0.003, -0.004);
		expect(formatRectangularQuantity(iRect, 'A', 3, 'auto')).toBe('3 - j4 mA');
		expect(formatRectangularQuantity(iRect, 'A', 3, 'ohm-v-a')).toBe('0.003 - j0.004 A');
		expect(formatRectangularQuantity(iRect, 'A', 3, 'kohm-v-ma')).toBe('3 - j4 mA');
		expect(formatRectangularQuantity(iRect, 'A', 3, 'mohm-v-ua')).toBe('3000 - j4000 µA');

		const z = Complex.from(1500, 2000);
		expect(
			formatComplexValue(z, 'Ω', 'ac', {
				angleDisplay: 'rectangular',
				precision: 3,
				unitSystem: 'ohm-v-a'
			})
		).toBe('1500 + j2000 Ω');
		expect(
			formatComplexValue(z, 'Ω', 'ac', {
				angleDisplay: 'rectangular',
				precision: 3,
				unitSystem: 'kohm-v-ma'
			})
		).toBe('1.5 + j2 kΩ');

		// Zero complex honors fixed unit prefix
		expect(formatPolarQuantity(Complex.zero(), 'A', 3, 'kohm-v-ma')).toBe('0∠0° mA');
		expect(formatRectangularQuantity(Complex.zero(), 'A', 3, 'mohm-v-ua')).toBe('0 µA');
	});

	it('honors unit systems for real, reactive, and apparent power', () => {
		expect(formatRealPower(0.045, { precision: 3, unitSystem: 'auto' })).toBe('45 mW');
		expect(formatRealPower(0.045, { precision: 3, unitSystem: 'ohm-v-a' })).toBe('0.045 W');
		expect(formatRealPower(0.045, { precision: 3, unitSystem: 'kohm-v-ma' })).toBe('45 mW');
		expect(formatRealPower(0.045, { precision: 3, unitSystem: 'mohm-v-ua' })).toBe('45000 µW');

		expect(formatReactivePower(-0.012, { precision: 3, unitSystem: 'ohm-v-a' })).toBe('-0.012 VAR');
		expect(formatReactivePower(-0.012, { precision: 3, unitSystem: 'kohm-v-ma' })).toBe('-12 mVAR');
		expect(formatReactivePower(-5e-5, { precision: 3, unitSystem: 'mohm-v-ua' })).toBe('-50 µVAR');

		expect(formatApparentPower(0.5, { precision: 3, unitSystem: 'ohm-v-a' })).toBe('0.5 VA');
		expect(formatApparentPower(0.5, { precision: 3, unitSystem: 'kohm-v-ma' })).toBe('500 mVA');
		expect(formatApparentPower(2e-4, { precision: 3, unitSystem: 'mohm-v-ua' })).toBe('200 µVA');
	});

	it('renders explicit 1 for unit-magnitude imaginary terms with units while keeping dimensionless j / -j', () => {
		expect(formatRectangularQuantity(Complex.from(0, -1000), 'V', 3)).toBe('-j1 kV');
		expect(formatRectangularQuantity(Complex.from(0, 1), 'Ω', 3)).toBe('j1 Ω');
		expect(formatRectangularQuantity(Complex.from(2, -1), 'Ω', 3)).toBe('2 - j1 Ω');
		expect(formatRectangularQuantity(Complex.from(0, 1), '', 3)).toBe('j');
		expect(formatRectangularQuantity(Complex.from(0, -1), '', 3)).toBe('-j');
	});
});
