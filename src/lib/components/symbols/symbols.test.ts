import { afterEach, describe, expect, it } from 'vitest';
import { render } from 'svelte/server';
import {
	COMPONENT_PINS,
	CircuitSymbol,
	GRID_SIZE,
	PALETTE_ITEMS,
	SYMBOL_PIN_OFFSETS,
	getComponentPinGridOffsets,
	type SymbolKind,
	type SymbolRotation
} from './index';
import { DEFAULT_SETTINGS, settings } from '$lib/stores/settings.svelte';

afterEach(() => {
	settings.reset();
});

describe('settings store', () => {
	it('defaults to IEEE schematic standard and canonical workbench preferences', () => {
		expect(settings.schematicStandard).toBe('ieee');
		expect(settings.angleDisplay).toBe('polar');
		expect(settings.precision).toBe(3);
		expect(settings.showDcFractions).toBe(false);
		expect(settings.acMagnitudeMode).toBe('rms');
		expect(settings.showGrid).toBe(true);
		expect(settings.snapToGrid).toBe(true);
		expect(settings.showLiveOverlays).toBe(true);
		expect(settings.snapshot()).toEqual(DEFAULT_SETTINGS);
	});

	it('toggles schematicStandard and showDcFractions and resets cleanly', () => {
		expect(settings.schematicStandard).toBe('ieee');
		settings.schematicStandard = 'iec';
		expect(settings.schematicStandard).toBe('iec');
		settings.schematicStandard = 'ieee';
		expect(settings.schematicStandard).toBe('ieee');

		expect(settings.showDcFractions).toBe(false);
		settings.showDcFractions = true;
		expect(settings.showDcFractions).toBe(true);

		settings.update({ schematicStandard: 'iec', precision: 4, showGrid: false });
		expect(settings.schematicStandard).toBe('iec');
		expect(settings.precision).toBe(4);
		expect(settings.showGrid).toBe(false);

		settings.reset();
		expect(settings.schematicStandard).toBe('ieee');
		expect(settings.showDcFractions).toBe(false);
		expect(settings.precision).toBe(3);
		expect(settings.showGrid).toBe(true);
	});
});

describe('getComponentPinGridOffsets', () => {
	const twoTerminalPassives: SymbolKind[] = ['resistor', 'capacitor', 'inductor'];
	const twoTerminalSources: SymbolKind[] = [
		'voltage_source',
		'current_source',
		'vcvs',
		'vccs',
		'ccvs',
		'cccs',
		'voltmeter'
	];
	const oneTerminalKinds: SymbolKind[] = ['ground', 'terminal', 'probe'];

	it('rotates 2-terminal passive components accurately across 0, 90, 180, 270 degrees', () => {
		for (const kind of twoTerminalPassives) {
			expect(getComponentPinGridOffsets(kind, 0)).toEqual([
				{ name: 'a', dx: -2, dy: 0 },
				{ name: 'b', dx: 2, dy: 0 }
			]);
			expect(getComponentPinGridOffsets(kind, 90)).toEqual([
				{ name: 'a', dx: 0, dy: -2 },
				{ name: 'b', dx: 0, dy: 2 }
			]);
			expect(getComponentPinGridOffsets(kind, 180)).toEqual([
				{ name: 'a', dx: 2, dy: 0 },
				{ name: 'b', dx: -2, dy: 0 }
			]);
			expect(getComponentPinGridOffsets(kind, 270)).toEqual([
				{ name: 'a', dx: 0, dy: 2 },
				{ name: 'b', dx: 0, dy: -2 }
			]);
		}
	});

	it('rotates 2-terminal sources accurately with + on pin 0 and - on pin 1', () => {
		for (const kind of twoTerminalSources) {
			expect(getComponentPinGridOffsets(kind, 0)).toEqual([
				{ name: '+', dx: -2, dy: 0 },
				{ name: '-', dx: 2, dy: 0 }
			]);
			expect(getComponentPinGridOffsets(kind, 90)).toEqual([
				{ name: '+', dx: 0, dy: -2 },
				{ name: '-', dx: 0, dy: 2 }
			]);
			expect(getComponentPinGridOffsets(kind, 180)).toEqual([
				{ name: '+', dx: 2, dy: 0 },
				{ name: '-', dx: -2, dy: 0 }
			]);
			expect(getComponentPinGridOffsets(kind, 270)).toEqual([
				{ name: '+', dx: 0, dy: 2 },
				{ name: '-', dx: 0, dy: -2 }
			]);
		}
	});

	it('keeps 1-terminal components anchored at (0, 0) across all rotations', () => {
		const rotations: SymbolRotation[] = [0, 90, 180, 270];
		for (const kind of oneTerminalKinds) {
			const expectedName = kind === 'ground' ? 'gnd' : 'a';
			for (const rot of rotations) {
				expect(getComponentPinGridOffsets(kind, rot)).toEqual([
					{ name: expectedName, dx: 0, dy: 0 }
				]);
			}
		}
	});

	it('matches pixel pin offsets in SYMBOL_PIN_OFFSETS with GRID_SIZE * COMPONENT_PINS', () => {
		for (const kind of [...twoTerminalPassives, ...twoTerminalSources, ...oneTerminalKinds]) {
			const gridPins = COMPONENT_PINS[kind];
			const pixelPins = SYMBOL_PIN_OFFSETS[kind].pins;
			expect(pixelPins).toHaveLength(gridPins.length);
			gridPins.forEach((gp, idx) => {
				expect(pixelPins[idx]).toEqual({
					name: gp.name,
					x: gp.dx * GRID_SIZE,
					y: gp.dy * GRID_SIZE
				});
			});
		}
	});
});

describe('CircuitSymbol rendering & IEEE/IEC switching', () => {
	it('renders IEEE zigzag resistor by default and IEC rectangle when toggled', () => {
		const ieeeOut = render(CircuitSymbol, {
			props: { kind: 'resistor', variant: 'schematic' }
		});
		expect(ieeeOut.body).toContain('data-symbol-standard="ieee"');
		expect(ieeeOut.body).toContain('viewBox="-40 -20 80 40"');
		expect(ieeeOut.body).toContain('M -40 0 L -21 0');
		expect(ieeeOut.body).not.toContain('<rect');

		settings.schematicStandard = 'iec';
		const iecOut = render(CircuitSymbol, {
			props: { kind: 'resistor', variant: 'schematic' }
		});
		expect(iecOut.body).toContain('data-symbol-standard="iec"');
		expect(iecOut.body).toContain('<rect x="-18" y="-7" width="36" height="14"');

		settings.schematicStandard = 'ieee';
		const backToIeee = render(CircuitSymbol, {
			props: { kind: 'resistor', variant: 'icon' }
		});
		expect(backToIeee.body).toContain('data-symbol-standard="ieee"');
		expect(backToIeee.body).toContain('viewBox="0 0 24 24"');
	});

	it('renders all symbol kinds in icon and schematic variants with uniform stroke contract', () => {
		const kinds: SymbolKind[] = [
			'resistor',
			'capacitor',
			'inductor',
			'voltage_source',
			'current_source',
			'vcvs',
			'vccs',
			'ccvs',
			'cccs',
			'ground',
			'terminal',
			'voltmeter',
			'wire',
			'probe'
		];

		for (const kind of kinds) {
			const icon = render(CircuitSymbol, { props: { kind, variant: 'icon' } });
			expect(icon.body).toContain('stroke-width="1.75"');
			expect(icon.body).toContain('stroke="currentColor"');
			expect(icon.body).toContain('viewBox="0 0 24 24"');

			const schematic = render(CircuitSymbol, {
				props: { kind, variant: 'schematic', terminalLabel: kind === 'terminal' ? 'A' : undefined }
			});
			expect(schematic.body).toContain('stroke-width="1.75"');
			expect(schematic.body).toContain(`viewBox="${SYMBOL_PIN_OFFSETS[kind].viewBox}"`);
		}
	});

	it('renders textbook diamond symbols for all 4 dependent sources in icon and schematic variants', () => {
		for (const kind of ['vcvs', 'ccvs'] as const) {
			const icon = render(CircuitSymbol, { props: { kind, variant: 'icon' } });
			expect(icon.body).toContain('M 12 4.5 L 19.5 12 L 12 19.5 L 4.5 12 Z');
			expect(icon.body).toContain('M 7.5 12 L 10.5 12 M 9 10.5 L 9 13.5');
			expect(icon.body).toContain('M 13.5 12 L 16.5 12');

			const schematic = render(CircuitSymbol, { props: { kind, variant: 'schematic' } });
			expect(schematic.body).toContain('M 0 -16 L 16 0 L 0 16 L -16 0 Z');
			expect(schematic.body).toContain('M -10 0 L -4 0 M -7 -3 L -7 3');
			expect(schematic.body).toContain('M 4 0 L 10 0');
		}

		for (const kind of ['vccs', 'cccs'] as const) {
			const icon = render(CircuitSymbol, { props: { kind, variant: 'icon' } });
			expect(icon.body).toContain('M 12 4.5 L 19.5 12 L 12 19.5 L 4.5 12 Z');
			expect(icon.body).toContain('M 13 9.5 L 16 12 L 13 14.5');

			const schematic = render(CircuitSymbol, { props: { kind, variant: 'schematic' } });
			expect(schematic.body).toContain('M 0 -16 L 16 0 L 0 16 L -16 0 Z');
			expect(schematic.body).toContain('M -9 0 L 9 0');
			expect(schematic.body).toContain('M 4 -4.5 L 9 0 L 4 4.5');
		}
	});

	it('exports PALETTE_ITEMS with shortcuts, units, dependent sources, and default values', () => {
		expect(PALETTE_ITEMS.length).toBeGreaterThanOrEqual(15);
		const nonEmptyShortcuts = PALETTE_ITEMS.map((item) => item.shortcut).filter(Boolean);
		expect(new Set(nonEmptyShortcuts).size).toBe(nonEmptyShortcuts.length);

		const resistorItem = PALETTE_ITEMS.find((item) => item.id === 'resistor');
		expect(resistorItem).toMatchObject({
			kind: 'resistor',
			shortcut: 'R',
			defaultValue: 1000,
			unit: 'Ω'
		});

		const voltmeterItem = PALETTE_ITEMS.find((item) => item.id === 'voltmeter');
		expect(voltmeterItem).toMatchObject({
			kind: 'voltmeter',
			label: 'Voltmeter',
			shortcut: 'M',
			category: 'connections'
		});

		const dependentItems = PALETTE_ITEMS.filter((item) => item.category === 'dependent');
		expect(dependentItems.map((i) => i.kind)).toEqual(['vcvs', 'vccs', 'ccvs', 'cccs']);
		expect(dependentItems.find((i) => i.kind === 'vcvs')).toMatchObject({
			label: 'VCVS',
			defaultValue: 2,
			defaultInput: '2',
			unit: 'V/V'
		});
		expect(dependentItems.find((i) => i.kind === 'vccs')).toMatchObject({
			label: 'VCCS',
			defaultInput: '1m',
			unit: 'S'
		});
		expect(dependentItems.find((i) => i.kind === 'ccvs')).toMatchObject({
			label: 'CCVS',
			defaultInput: '1k',
			unit: 'Ω'
		});
		expect(dependentItems.find((i) => i.kind === 'cccs')).toMatchObject({
			label: 'CCCS',
			defaultInput: '2',
			unit: 'A/A'
		});
	});
});
