export type SymbolKind =
	| 'resistor'
	| 'capacitor'
	| 'inductor'
	| 'voltage_source'
	| 'current_source'
	| 'vcvs'
	| 'vccs'
	| 'ccvs'
	| 'cccs'
	| 'ground'
	| 'terminal'
	| 'voltmeter'
	| 'wire'
	| 'probe';

export type SymbolVariant = 'icon' | 'schematic';
export type SymbolRotation = 0 | 90 | 180 | 270;
export type SourceMode = 'dc' | 'ac';
export type PaletteCategory = 'sources' | 'dependent' | 'passives' | 'connections';

export interface PinGridOffset {
	name: string;
	dx: number;
	dy: number;
}

export interface PinPixelOffset {
	name: string;
	x: number;
	y: number;
}

export interface SymbolGeometrySpec {
	viewBox: string;
	width: number;
	height: number;
	pins: ReadonlyArray<PinPixelOffset>;
}

export interface PaletteItem {
	id: string;
	label: string;
	/** Alias matching workbench palette items */
	name: string;
	shortcut: string;
	category: PaletteCategory;
	kind: SymbolKind;
	sourceMode?: SourceMode;
	defaultValue?: number;
	defaultInput?: string;
	unit?: string;
	description: string;
}

/** Canonical schematic grid unit size in SVG pixels. */
export const GRID_SIZE = 20;

const TWO_TERMINAL_PASSIVE_PINS: ReadonlyArray<PinGridOffset> = Object.freeze([
	{ name: 'a', dx: -2, dy: 0 },
	{ name: 'b', dx: 2, dy: 0 }
]);

/**
 * Canonical source pin offsets at rotation = 0.
 *
 * Pin 0 ('+') is at (-2, 0) grid units (-40px, 0); pin 1 ('-') is at (+2, 0) (+40px, 0).
 * - Voltage source: V_pin0 - V_pin1 = V_s.
 * - Current source: forces current I_s from pin 0 ('+') -> pin 1 ('-'); arrow points pin 0 -> pin 1.
 */
const TWO_TERMINAL_SOURCE_PINS: ReadonlyArray<PinGridOffset> = Object.freeze([
	{ name: '+', dx: -2, dy: 0 },
	{ name: '-', dx: 2, dy: 0 }
]);

const ONE_TERMINAL_PINS: ReadonlyArray<PinGridOffset> = Object.freeze([
	{ name: 'a', dx: 0, dy: 0 }
]);

const GROUND_PINS: ReadonlyArray<PinGridOffset> = Object.freeze([
	{ name: 'gnd', dx: 0, dy: 0 }
]);

/**
 * Unrotated (rotation = 0) pin offsets in integer grid units relative to component center (0, 0).
 * Multiply by GRID_SIZE (20px) to obtain schematic SVG coordinates.
 */
export const COMPONENT_PINS: Record<SymbolKind, ReadonlyArray<PinGridOffset>> = {
	resistor: TWO_TERMINAL_PASSIVE_PINS,
	capacitor: TWO_TERMINAL_PASSIVE_PINS,
	inductor: TWO_TERMINAL_PASSIVE_PINS,
	voltage_source: TWO_TERMINAL_SOURCE_PINS,
	current_source: TWO_TERMINAL_SOURCE_PINS,
	vcvs: TWO_TERMINAL_SOURCE_PINS,
	vccs: TWO_TERMINAL_SOURCE_PINS,
	ccvs: TWO_TERMINAL_SOURCE_PINS,
	cccs: TWO_TERMINAL_SOURCE_PINS,
	voltmeter: TWO_TERMINAL_SOURCE_PINS,
	ground: GROUND_PINS,
	terminal: ONE_TERMINAL_PINS,
	probe: ONE_TERMINAL_PINS,
	wire: []
};

/**
 * Pixel-space schematic geometry and exact terminal pin coordinates within each symbol's viewBox.
 * All 2-terminal components use viewBox="-40 -20 80 40" with pins at (-40, 0) and (+40, 0).
 * All 1-terminal components use viewBox="-20 -20 40 40" with pin 0 at (0, 0).
 */
export const SYMBOL_PIN_OFFSETS: Record<SymbolKind, SymbolGeometrySpec> = {
	resistor: {
		viewBox: '-40 -20 80 40',
		width: 80,
		height: 40,
		pins: [
			{ name: 'a', x: -40, y: 0 },
			{ name: 'b', x: 40, y: 0 }
		]
	},
	capacitor: {
		viewBox: '-40 -20 80 40',
		width: 80,
		height: 40,
		pins: [
			{ name: 'a', x: -40, y: 0 },
			{ name: 'b', x: 40, y: 0 }
		]
	},
	inductor: {
		viewBox: '-40 -20 80 40',
		width: 80,
		height: 40,
		pins: [
			{ name: 'a', x: -40, y: 0 },
			{ name: 'b', x: 40, y: 0 }
		]
	},
	voltage_source: {
		viewBox: '-40 -20 80 40',
		width: 80,
		height: 40,
		pins: [
			{ name: '+', x: -40, y: 0 },
			{ name: '-', x: 40, y: 0 }
		]
	},
	current_source: {
		viewBox: '-40 -20 80 40',
		width: 80,
		height: 40,
		pins: [
			{ name: '+', x: -40, y: 0 },
			{ name: '-', x: 40, y: 0 }
		]
	},
	vcvs: {
		viewBox: '-40 -20 80 40',
		width: 80,
		height: 40,
		pins: [
			{ name: '+', x: -40, y: 0 },
			{ name: '-', x: 40, y: 0 }
		]
	},
	vccs: {
		viewBox: '-40 -20 80 40',
		width: 80,
		height: 40,
		pins: [
			{ name: '+', x: -40, y: 0 },
			{ name: '-', x: 40, y: 0 }
		]
	},
	ccvs: {
		viewBox: '-40 -20 80 40',
		width: 80,
		height: 40,
		pins: [
			{ name: '+', x: -40, y: 0 },
			{ name: '-', x: 40, y: 0 }
		]
	},
	cccs: {
		viewBox: '-40 -20 80 40',
		width: 80,
		height: 40,
		pins: [
			{ name: '+', x: -40, y: 0 },
			{ name: '-', x: 40, y: 0 }
		]
	},
	ground: {
		viewBox: '-20 -20 40 40',
		width: 40,
		height: 40,
		pins: [{ name: 'gnd', x: 0, y: 0 }]
	},
	terminal: {
		viewBox: '-20 -20 40 40',
		width: 40,
		height: 40,
		pins: [{ name: 'a', x: 0, y: 0 }]
	},
	voltmeter: {
		viewBox: '-40 -20 80 40',
		width: 80,
		height: 40,
		pins: [
			{ name: '+', x: -40, y: 0 },
			{ name: '-', x: 40, y: 0 }
		]
	},
	probe: {
		viewBox: '-20 -20 40 40',
		width: 40,
		height: 40,
		pins: [{ name: 'a', x: 0, y: 0 }]
	},
	wire: {
		viewBox: '-40 -20 80 40',
		width: 80,
		height: 40,
		pins: []
	}
};

/**
 * Returns exact integer grid offsets for a component's pins after clockwise SVG rotation
 * (`0 | 90 | 180 | 270` degrees). Clockwise 90° in SVG y-down coordinates maps `(dx, dy) -> (-dy, dx)`.
 */
export function getComponentPinGridOffsets(
	kind: SymbolKind,
	rotation: SymbolRotation = 0
): PinGridOffset[] {
	const basePins = COMPONENT_PINS[kind];
	const normalized = (((rotation % 360) + 360) % 360) as SymbolRotation;

	return basePins.map(({ name, dx, dy }) => {
		let rdx = dx;
		let rdy = dy;

		if (normalized === 90) {
			rdx = -dy;
			rdy = dx;
		} else if (normalized === 180) {
			rdx = -dx;
			rdy = -dy;
		} else if (normalized === 270) {
			rdx = dy;
			rdy = -dx;
		}

		return {
			name,
			dx: rdx === 0 ? 0 : rdx,
			dy: rdy === 0 ? 0 : rdy
		};
	});
}

/** Unified palette metadata catalog with labels, shortcuts, default values, and units. */
export const PALETTE_ITEMS: ReadonlyArray<PaletteItem> = [
	{
		id: 'vdc',
		label: 'DC Voltage Source',
		name: 'DC Voltage Source',
		shortcut: 'V',
		category: 'sources',
		kind: 'voltage_source',
		sourceMode: 'dc',
		defaultValue: 10,
		defaultInput: '10',
		unit: 'V',
		description: 'Independent DC voltage source (pin 0 is +, pin 1 is -)'
	},
	{
		id: 'vac',
		label: 'AC Voltage Source',
		name: 'AC Voltage Source',
		shortcut: 'A',
		category: 'sources',
		kind: 'voltage_source',
		sourceMode: 'ac',
		defaultValue: 10,
		defaultInput: '10∠0°',
		unit: 'V',
		description: 'Independent AC sinusoidal phasor voltage source'
	},
	{
		id: 'idc',
		label: 'Current Source',
		name: 'Current Source',
		shortcut: 'I',
		category: 'sources',
		kind: 'current_source',
		sourceMode: 'dc',
		defaultValue: 0.01,
		defaultInput: '10m',
		unit: 'A',
		description: 'Independent current source (arrow points pin 0 -> pin 1)'
	},
	{
		id: 'vcvs',
		label: 'VCVS',
		name: 'VCVS (V → V)',
		shortcut: '',
		category: 'dependent',
		kind: 'vcvs',
		defaultValue: 2,
		defaultInput: '2',
		unit: 'V/V',
		description: 'Voltage-Controlled Voltage Source (E = A_v · v_x)'
	},
	{
		id: 'vccs',
		label: 'VCCS',
		name: 'VCCS (V → I)',
		shortcut: '',
		category: 'dependent',
		kind: 'vccs',
		defaultValue: 1,
		defaultInput: '1m',
		unit: 'S',
		description: 'Voltage-Controlled Current Source (G = g_m · v_x)'
	},
	{
		id: 'ccvs',
		label: 'CCVS',
		name: 'CCVS (I → V)',
		shortcut: '',
		category: 'dependent',
		kind: 'ccvs',
		defaultValue: 1,
		defaultInput: '1k',
		unit: 'Ω',
		description: 'Current-Controlled Voltage Source (H = r_m · i_x)'
	},
	{
		id: 'cccs',
		label: 'CCCS',
		name: 'CCCS (I → I)',
		shortcut: '',
		category: 'dependent',
		kind: 'cccs',
		defaultValue: 2,
		defaultInput: '2',
		unit: 'A/A',
		description: 'Current-Controlled Current Source (F = β · i_x)'
	},
	{
		id: 'resistor',
		label: 'Resistor',
		name: 'Resistor',
		shortcut: 'R',
		category: 'passives',
		kind: 'resistor',
		defaultValue: 1000,
		defaultInput: '1k',
		unit: 'Ω',
		description: 'Linear bilateral resistor'
	},
	{
		id: 'capacitor',
		label: 'Capacitor',
		name: 'Capacitor',
		shortcut: 'C',
		category: 'passives',
		kind: 'capacitor',
		defaultValue: 10e-6,
		defaultInput: '10u',
		unit: 'F',
		description: 'Ideal linear capacitor (open in DC steady state)'
	},
	{
		id: 'inductor',
		label: 'Inductor',
		name: 'Inductor',
		shortcut: 'L',
		category: 'passives',
		kind: 'inductor',
		defaultValue: 10e-3,
		defaultInput: '10m',
		unit: 'H',
		description: 'Ideal linear inductor (short in DC steady state)'
	},
	{
		id: 'wire',
		label: 'Orthogonal Wire',
		name: 'Orthogonal Wire',
		shortcut: 'W',
		category: 'connections',
		kind: 'wire',
		description: 'Ideal zero-impedance orthogonal conductor'
	},
	{
		id: 'ground',
		label: 'Ground Reference',
		name: 'Ground Reference',
		shortcut: 'G',
		category: 'connections',
		kind: 'ground',
		description: 'Canonical 0 V reference node'
	},
	{
		id: 'terminal',
		label: 'Port Terminal',
		name: 'Port Terminal',
		shortcut: 'T',
		category: 'connections',
		kind: 'terminal',
		description: 'Open port terminal (e.g. A / B for Thévenin & Norton)'
	},
	{
		id: 'voltmeter',
		label: 'Voltmeter',
		name: 'Voltmeter',
		shortcut: 'M',
		category: 'connections',
		kind: 'voltmeter',
		description: 'Ideal differential voltmeter (V+ − V− across any two points or multiple loads)'
	},
	{
		id: 'probe',
		label: 'Node Voltage Probe',
		name: 'Node Voltage Probe',
		shortcut: 'P',
		category: 'connections',
		kind: 'probe',
		description: 'Inspect node voltage relative to reference ground'
	}
];
