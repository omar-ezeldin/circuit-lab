/**
 * Curated library of 10 classic textbook DC & AC circuits for Circuit Lab.
 * All schematics use clean, non-overlapping orthogonal coordinates aligned
 * to the canonical 20 px grid (2-terminal pin offset ±2, 1-terminal pin offset 0).
 */

import type { CircuitComponent, CircuitDocument, CircuitWire, MethodId } from '../engine/types';

export interface CircuitPreset {
	id: string;
	name: string;
	category: 'dc' | 'ac';
	featuredMethod: MethodId;
	description: string;
	theveninLoadId?: string;
	document: CircuitDocument;
}

function comp(
	id: string,
	kind: CircuitComponent['kind'],
	x: number,
	y: number,
	rotation: CircuitComponent['rotation'],
	value: string,
	extra?: Partial<CircuitComponent>
): CircuitComponent {
	return { id, kind, label: id, x, y, rotation, value, ...extra };
}

function wire(id: string, ...pts: Array<[number, number]>): CircuitWire {
	return { id, points: pts.map(([x, y]) => ({ x, y })) };
}

export const PRESETS: CircuitPreset[] = [
	{
		id: 'dc-divider',
		name: 'DC Voltage & Current Divider',
		category: 'dc',
		featuredMethod: 'nodal',
		description:
			'12 V source feeding a 2 kΩ series resistor into parallel 6 kΩ and 12 kΩ load branches (8 V divider output).',
		theveninLoadId: 'R3',
		document: {
			schemaVersion: 1,
			id: 'dc-divider',
			name: 'DC Voltage & Current Divider',
			mode: 'dc',
			frequencyHz: 60,
			components: [
				comp('V1', 'voltage_source', 4, 8, 90, '12'),
				comp('R1', 'resistor', 8, 4, 0, '2k'),
				comp('R2', 'resistor', 12, 8, 90, '6k'),
				comp('R3', 'resistor', 18, 8, 90, '12k'),
				comp('G1', 'ground', 4, 10, 0, '0')
			],
			wires: [
				wire('w1', [4, 6], [4, 4], [6, 4]),
				wire('w2', [10, 4], [18, 4], [18, 6]),
				wire('w3', [12, 4], [12, 6]),
				wire('w4', [4, 10], [18, 10])
			]
		}
	},
	{
		id: 'dc-supernode',
		name: 'DC Supernode Network',
		category: 'dc',
		featuredMethod: 'nodal',
		description:
			'Floating 12 V voltage source bridging nodes N1 and N2, driven by a 6 A current source (V1 = 16 V, V2 = 4 V).',
		theveninLoadId: 'R3',
		document: {
			schemaVersion: 1,
			id: 'dc-supernode',
			name: 'DC Supernode Network',
			mode: 'dc',
			frequencyHz: 60,
			components: [
				comp('I1', 'current_source', 4, 8, 270, '6'),
				comp('R1', 'resistor', 10, 8, 90, '4'),
				comp('V1', 'voltage_source', 14, 4, 0, '12'),
				comp('R2', 'resistor', 18, 8, 90, '4'),
				comp('R3', 'resistor', 24, 8, 90, '4'),
				comp('G1', 'ground', 4, 10, 0, '0')
			],
			wires: [
				wire('w1', [4, 6], [4, 4], [12, 4]),
				wire('w2', [10, 4], [10, 6]),
				wire('w3', [16, 4], [24, 4], [24, 6]),
				wire('w4', [18, 4], [18, 6]),
				wire('w5', [4, 10], [24, 10])
			]
		}
	},
	{
		id: 'dc-supermesh',
		name: 'DC Supermesh Two-Source Circuit',
		category: 'dc',
		featuredMethod: 'mesh',
		description:
			'Two-loop circuit with a 32 V source and a shared 2 A current source in the center branch requiring a supermesh.',
		theveninLoadId: 'R3',
		document: {
			schemaVersion: 1,
			id: 'dc-supermesh',
			name: 'DC Supermesh Two-Source Circuit',
			mode: 'dc',
			frequencyHz: 60,
			components: [
				comp('V1', 'voltage_source', 4, 8, 90, '32'),
				comp('R1', 'resistor', 8, 4, 0, '2'),
				comp('I1', 'current_source', 12, 8, 270, '2'),
				comp('R2', 'resistor', 16, 4, 0, '2'),
				comp('R3', 'resistor', 20, 8, 90, '4'),
				comp('G1', 'ground', 4, 10, 0, '0')
			],
			wires: [
				wire('w1', [4, 6], [4, 4], [6, 4]),
				wire('w2', [10, 4], [14, 4]),
				wire('w3', [12, 4], [12, 6]),
				wire('w4', [18, 4], [20, 4], [20, 6]),
				wire('w5', [4, 10], [20, 10])
			]
		}
	},
	{
		id: 'dc-wheatstone-bridge',
		name: 'DC Wheatstone Bridge',
		category: 'dc',
		featuredMethod: 'thevenin_norton',
		description:
			'Unbalanced Wheatstone bridge excited at 10 V; ideal for Mesh, Nodal, and Thévenin analysis across bridge resistor R5.',
		theveninLoadId: 'R5',
		document: {
			schemaVersion: 1,
			id: 'dc-wheatstone-bridge',
			name: 'DC Wheatstone Bridge',
			mode: 'dc',
			frequencyHz: 60,
			components: [
				comp('V1', 'voltage_source', 4, 8, 90, '10'),
				comp('R1', 'resistor', 10, 4, 90, '100'),
				comp('R3', 'resistor', 18, 4, 90, '300'),
				comp('R5', 'resistor', 14, 8, 0, '150'),
				comp('R2', 'resistor', 10, 12, 90, '200'),
				comp('R4', 'resistor', 18, 12, 90, '100'),
				comp('G1', 'ground', 4, 14, 0, '0')
			],
			wires: [
				wire('w1', [4, 6], [4, 2], [18, 2]),
				wire('w2', [10, 6], [10, 10]),
				wire('w3', [10, 8], [12, 8]),
				wire('w4', [18, 6], [18, 10]),
				wire('w5', [16, 8], [18, 8]),
				wire('w6', [4, 10], [4, 14], [18, 14])
			]
		}
	},
	{
		id: 'dc-superposition-source-transform',
		name: 'DC Multi-Source Superposition & Source Transform',
		category: 'dc',
		featuredMethod: 'superposition',
		description:
			'Dual-source resistive ladder (12 V & 4 A) yielding exact integer node voltages via Superposition or Source Transformation.',
		theveninLoadId: 'R3',
		document: {
			schemaVersion: 1,
			id: 'dc-superposition-source-transform',
			name: 'DC Multi-Source Superposition & Source Transform',
			mode: 'dc',
			frequencyHz: 60,
			components: [
				comp('V1', 'voltage_source', 4, 8, 90, '12'),
				comp('R1', 'resistor', 8, 4, 0, '6'),
				comp('R3', 'resistor', 12, 8, 90, '6'),
				comp('R2', 'resistor', 16, 4, 0, '3'),
				comp('R4', 'resistor', 20, 8, 90, '3'),
				comp('I1', 'current_source', 24, 8, 270, '4'),
				comp('G1', 'ground', 4, 10, 0, '0')
			],
			wires: [
				wire('w1', [4, 6], [4, 4], [6, 4]),
				wire('w2', [10, 4], [14, 4]),
				wire('w3', [12, 4], [12, 6]),
				wire('w4', [18, 4], [24, 4], [24, 6]),
				wire('w5', [20, 4], [20, 6]),
				wire('w6', [4, 10], [24, 10])
			]
		}
	},
	{
		id: 'dc-dependent-vcvs',
		name: 'DC Dependent Source (VCVS)',
		category: 'dc',
		featuredMethod: 'nodal',
		description:
			'16 V source driving a resistor T-network with a Voltage-Controlled Voltage Source E1 = 2 v_x sensing R1 (exact integer solution: V_N1 = 16 V, V_N2 = 10 V, V_N3 = 12 V).',
		theveninLoadId: 'R2',
		document: {
			schemaVersion: 1,
			id: 'dc-dependent-vcvs',
			name: 'DC Dependent Source (VCVS)',
			mode: 'dc',
			frequencyHz: 60,
			unitSystem: 'kohm-v-ma',
			components: [
				comp('V1', 'voltage_source', 4, 8, 90, '16'),
				comp('R1', 'resistor', 8, 4, 0, '4k'),
				comp('R2', 'resistor', 12, 8, 90, '4k'),
				comp('R3', 'resistor', 16, 4, 0, '2k'),
				comp('E1', 'vcvs', 20, 8, 90, '2', {
					unit: 'V/V',
					controlRef: {
						controlComponentId: 'R1',
						controlPolarity: 1,
						controlVarName: 'v_x',
						gain: '2'
					}
				}),
				comp('G1', 'ground', 4, 10, 0, '0')
			],
			wires: [
				wire('w1', [4, 6], [4, 4], [6, 4]),
				wire('w2', [10, 4], [14, 4]),
				wire('w3', [12, 4], [12, 6]),
				wire('w4', [18, 4], [20, 4], [20, 6]),
				wire('w5', [4, 10], [20, 10])
			]
		}
	},
	{
		id: 'dc-steady-state-rlc',
		name: 'DC Steady-State RLC Network',
		category: 'dc',
		featuredMethod: 'nodal',
		description:
			'Demonstrates DC steady-state reactive behavior: capacitor C1 acts as an open circuit while inductor L1 acts as a short circuit.',
		theveninLoadId: 'R3',
		document: {
			schemaVersion: 1,
			id: 'dc-steady-state-rlc',
			name: 'DC Steady-State RLC Network',
			mode: 'dc',
			frequencyHz: 60,
			components: [
				comp('V1', 'voltage_source', 4, 8, 90, '24'),
				comp('R1', 'resistor', 8, 4, 0, '4'),
				comp('C1', 'capacitor', 12, 8, 90, '100u'),
				comp('L1', 'inductor', 16, 4, 0, '10m'),
				comp('R2', 'resistor', 20, 8, 90, '8'),
				comp('R3', 'resistor', 26, 8, 90, '8'),
				comp('G1', 'ground', 4, 10, 0, '0')
			],
			wires: [
				wire('w1', [4, 6], [4, 4], [6, 4]),
				wire('w2', [10, 4], [14, 4]),
				wire('w3', [12, 4], [12, 6]),
				wire('w4', [18, 4], [26, 4], [26, 6]),
				wire('w5', [20, 4], [20, 6]),
				wire('w6', [4, 10], [26, 10])
			]
		}
	},
	{
		id: 'ac-rlc-phasor',
		name: 'AC Series-Parallel RLC Phasor Circuit',
		category: 'ac',
		featuredMethod: 'thevenin_norton',
		description:
			'1 kHz RMS AC network (120∠0° V) with series RL and parallel RC load; computes complex impedance, power factor, and Thévenin equivalent.',
		theveninLoadId: 'R2',
		document: {
			schemaVersion: 1,
			id: 'ac-rlc-phasor',
			name: 'AC Series-Parallel RLC Phasor Circuit',
			mode: 'ac',
			frequencyHz: 1000,
			acMagnitudeMode: 'rms',
			components: [
				comp('V1', 'voltage_source', 4, 8, 90, '120∠0°'),
				comp('R1', 'resistor', 8, 4, 0, '100'),
				comp('L1', 'inductor', 14, 4, 0, '20m'),
				comp('C1', 'capacitor', 18, 8, 90, '2.2u'),
				comp('R2', 'resistor', 24, 8, 90, '100'),
				comp('G1', 'ground', 4, 10, 0, '0')
			],
			wires: [
				wire('w1', [4, 6], [4, 4], [6, 4]),
				wire('w2', [10, 4], [12, 4]),
				wire('w3', [16, 4], [24, 4], [24, 6]),
				wire('w4', [18, 4], [18, 6]),
				wire('w5', [4, 10], [24, 10])
			]
		}
	},
	{
		id: 'ac-multi-source-phasor',
		name: 'AC Multi-Source Phasor Network',
		category: 'ac',
		featuredMethod: 'superposition',
		description:
			'60 Hz network driven by two quadrature phasor sources (10∠0° V and 5∠90° V) across a resistive-inductive-capacitive T-branch.',
		theveninLoadId: 'R2',
		document: {
			schemaVersion: 1,
			id: 'ac-multi-source-phasor',
			name: 'AC Multi-Source Phasor Network',
			mode: 'ac',
			frequencyHz: 60,
			acMagnitudeMode: 'rms',
			components: [
				comp('V1', 'voltage_source', 4, 8, 90, '10∠0°'),
				comp('R1', 'resistor', 8, 4, 0, '10'),
				comp('R2', 'resistor', 12, 8, 90, '10'),
				comp('L1', 'inductor', 16, 4, 0, '26.5m'),
				comp('C1', 'capacitor', 22, 4, 0, '265u'),
				comp('V2', 'voltage_source', 26, 8, 90, '5∠90°'),
				comp('G1', 'ground', 4, 10, 0, '0')
			],
			wires: [
				wire('w1', [4, 6], [4, 4], [6, 4]),
				wire('w2', [10, 4], [14, 4]),
				wire('w3', [12, 4], [12, 6]),
				wire('w4', [18, 4], [20, 4]),
				wire('w5', [24, 4], [26, 4], [26, 6]),
				wire('w6', [4, 10], [26, 10])
			]
		}
	},
	{
		id: 'ac-impedance-supernode',
		name: 'AC Impedance Supernode',
		category: 'ac',
		featuredMethod: 'nodal',
		description:
			'Phasor-domain AC supernode network with direct reactance impedances (-j1 Ω capacitors, j1 Ω inductor) and a floating 10∠0° V source bridging nodes N2 and N3.',
		theveninLoadId: 'R3',
		document: {
			schemaVersion: 1,
			id: 'ac-impedance-supernode',
			name: 'AC Impedance Supernode',
			mode: 'ac',
			frequencyHz: 60,
			acMagnitudeMode: 'rms',
			unitSystem: 'ohm-v-a',
			components: [
				comp('R1', 'resistor', 4, 8, 90, '1', { unit: 'Ω' }),
				comp('C1', 'capacitor', 8, 4, 0, '-j1', { valueMode: 'impedance', unit: 'Ω' }),
				comp('R2', 'resistor', 12, 8, 90, '2', { unit: 'Ω' }),
				comp('Vs', 'voltage_source', 16, 4, 180, '10∠0°', { unit: 'V' }),
				comp('C2', 'capacitor', 20, 8, 90, '-j1', { valueMode: 'impedance', unit: 'Ω' }),
				comp('L1', 'inductor', 24, 4, 0, 'j1', { valueMode: 'impedance', unit: 'Ω' }),
				comp('R3', 'resistor', 28, 8, 90, '2', { unit: 'Ω' }),
				comp('G1', 'ground', 4, 10, 0, '0')
			],
			wires: [
				wire('w1', [4, 6], [4, 4], [6, 4]),
				wire('w2', [10, 4], [14, 4]),
				wire('w3', [12, 4], [12, 6]),
				wire('w4', [18, 4], [22, 4]),
				wire('w5', [20, 4], [20, 6]),
				wire('w6', [26, 4], [28, 4], [28, 6]),
				wire('w7', [4, 10], [28, 10])
			]
		}
	}
];

export function getPresetById(id: string): CircuitPreset | undefined {
	return PRESETS.find((preset) => preset.id === id);
}
