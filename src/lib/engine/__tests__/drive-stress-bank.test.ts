/**
 * 80-Case EPM214s DC & AC Circuits Stress-Test Bank.
 *
 * Exercises the full Circuit Lab pipeline end-to-end:
 *   AI Netlist JSON -> parseCircuitImport (auto-layout + validation) -> solveCircuit (MNA +
 *   Thévenin/Norton + Max Power Transfer + Unknown Inverse Solver) -> URL share round-trip
 *   (encodeCircuitToHash -> decodeCircuitFromHash -> solveCircuit) + autoWireDocument.
 *
 * - 36 DC EPM214s Exam/Sheet/Quiz Problems (DC-01..DC-36)
 * - 32 AC EPM214s Exam/Sheet/Quiz Problems (AC-01..AC-32)
 * - 12 Adversarial & Edge-Case Stress Tests (EDGE-01..EDGE-12)
 */

import { describe, expect, it } from 'vitest';
import {
	autoWireDocument,
	buildElectricalGraph,
	Complex,
	decodeCircuitFromHash,
	encodeCircuitToHash,
	getPinPositions,
	solveCircuit,
	solveMNA,
	type AcMagnitudeMode,
	type BranchResult,
	type CircuitDocument,
	type CircuitWire,
	type ComponentKind,
	type DependentControlRef,
	type MnaSolution,
	type TheveninTarget
} from '../index';
import { parseCircuitImport } from '../io';

// ============================================================================
// Pool Schema Types
// ============================================================================

interface DcDependentSpec {
	controlType: 'voltage' | 'current';
	controlFrom?: string;
	controlTo?: string;
	controlLabel?: string;
	gain: number;
}

interface DcPoolComponent {
	label: string;
	kind: 'V' | 'I' | 'R' | 'VCVS' | 'VCCS' | 'CCVS' | 'CCCS';
	fromNode: string;
	toNode: string;
	value: number;
	dependentSpec?: DcDependentSpec;
}

interface DcPoolProblem {
	id: string;
	source: string;
	category: string;
	nodes: string[];
	components: DcPoolComponent[];
	theveninTarget?: { componentLabel?: string; portA: string; portB: string };
	unknownSpec?: {
		targetComponent: string;
		parameter: string;
		givenConstraint: Record<string, unknown>;
	};
	expected: Record<string, unknown>;
}

interface AcDependentSpec {
	controlBranchLabel?: string;
	controlNodePos?: string;
	controlNodeNeg?: string;
	gain: number;
	controlVarName?: string;
}

interface AcPoolComponent {
	label: string;
	kind:
		| 'resistor'
		| 'capacitor'
		| 'inductor'
		| 'voltage_source'
		| 'current_source'
		| 'vcvs'
		| 'vccs'
		| 'ccvs'
		| 'cccs';
	fromNode: string;
	toNode: string;
	value: number | string;
	phaseDeg?: number;
	impedanceMode?: boolean;
	resistanceOhm?: number;
	reactanceOhm?: number;
	dependentSpec?: AcDependentSpec;
}

interface PhasorExpect {
	mag: number;
	deg: number;
	re?: number;
	im?: number;
}

interface AcPoolProblem {
	id: string;
	source: string;
	category: string;
	frequencyHz: number;
	omegaRadPerSec?: number;
	acMagnitudeMode: AcMagnitudeMode;
	nodes: string[];
	components: AcPoolComponent[];
	theveninTarget?: string;
	expected: Record<string, unknown>;
}

// ============================================================================
// Embedded Harvested EPM214s Pools (36 DC + 32 AC)
// ============================================================================

const DC_POOL: DcPoolProblem[] = [
	{
		"id": "DC-01",
		"source": "Midterm Fall 2025 Q1 (Midterm_Fall2025_EPM214s.pdf / Worked_Answers B1 / Sadiku 2.57)",
		"category": "series_parallel",
		"nodes": [
			"0",
			"S",
			"A",
			"B",
			"C",
			"D",
			"E",
			"F",
			"G"
		],
		"components": [
			{
				"label": "V1",
				"kind": "V",
				"fromNode": "S",
				"toNode": "0",
				"value": 20
			},
			{
				"label": "R1",
				"kind": "R",
				"fromNode": "S",
				"toNode": "A",
				"value": 4
			},
			{
				"label": "R2",
				"kind": "R",
				"fromNode": "A",
				"toNode": "B",
				"value": 6
			},
			{
				"label": "R3",
				"kind": "R",
				"fromNode": "B",
				"toNode": "C",
				"value": 8
			},
			{
				"label": "R4",
				"kind": "R",
				"fromNode": "C",
				"toNode": "0",
				"value": 10
			},
			{
				"label": "R5",
				"kind": "R",
				"fromNode": "A",
				"toNode": "D",
				"value": 2
			},
			{
				"label": "R6",
				"kind": "R",
				"fromNode": "D",
				"toNode": "E",
				"value": 1
			},
			{
				"label": "R7",
				"kind": "R",
				"fromNode": "B",
				"toNode": "E",
				"value": 12
			},
			{
				"label": "R8",
				"kind": "R",
				"fromNode": "E",
				"toNode": "F",
				"value": 2
			},
			{
				"label": "R9",
				"kind": "R",
				"fromNode": "C",
				"toNode": "F",
				"value": 4
			},
			{
				"label": "R10",
				"kind": "R",
				"fromNode": "F",
				"toNode": "G",
				"value": 3
			},
			{
				"label": "R11",
				"kind": "R",
				"fromNode": "G",
				"toNode": "0",
				"value": 5
			}
		],
		"expected": {
			"Req_at_V1_ohm": 12.211566,
			"I_source_A": 1.637792,
			"P_V1_sup_W": 32.755833,
			"nodeVoltages_V": {
				"S": 20,
				"A": 13.4488,
				"B": 10.4689,
				"C": 6.7914,
				"D": 11.1666,
				"E": 10.0254,
				"F": 7.6692,
				"G": 4.7933
			}
		}
	},
	{
		"id": "DC-02",
		"source": "Midterm Summer 2023 Q1 (Guide_and_Questions A8 / Worked_Answers A8)",
		"category": "series_parallel",
		"nodes": [
			"0",
			"A",
			"B",
			"C"
		],
		"components": [
			{
				"label": "R1",
				"kind": "R",
				"fromNode": "C",
				"toNode": "0",
				"value": 12000
			},
			{
				"label": "R2",
				"kind": "R",
				"fromNode": "C",
				"toNode": "0",
				"value": 12000
			},
			{
				"label": "R3",
				"kind": "R",
				"fromNode": "C",
				"toNode": "A",
				"value": 12000
			},
			{
				"label": "R4",
				"kind": "R",
				"fromNode": "A",
				"toNode": "0",
				"value": 12000
			},
			{
				"label": "R5",
				"kind": "R",
				"fromNode": "C",
				"toNode": "B",
				"value": 12000
			},
			{
				"label": "R6",
				"kind": "R",
				"fromNode": "B",
				"toNode": "0",
				"value": 12000
			},
			{
				"label": "V1",
				"kind": "V",
				"fromNode": "A",
				"toNode": "B",
				"value": 24
			}
		],
		"expected": {
			"nodeVoltages_V": {
				"A": 12,
				"B": -12,
				"C": 0
			},
			"P_V1_sup_W": 0.048,
			"P_total_W": 0.048
		}
	},
	{
		"id": "DC-03",
		"source": "Midterm Fall 2022 Q1 (Guide_and_Questions A9 / Worked_Answers A9)",
		"category": "series_parallel",
		"nodes": [
			"0",
			"A",
			"B",
			"C"
		],
		"components": [
			{
				"label": "V1",
				"kind": "V",
				"fromNode": "0",
				"toNode": "A",
				"value": 6
			},
			{
				"label": "R1",
				"kind": "R",
				"fromNode": "A",
				"toNode": "C",
				"value": 2000
			},
			{
				"label": "R2",
				"kind": "R",
				"fromNode": "A",
				"toNode": "B",
				"value": 3000
			},
			{
				"label": "R3",
				"kind": "R",
				"fromNode": "B",
				"toNode": "0",
				"value": 6000
			},
			{
				"label": "I1",
				"kind": "I",
				"fromNode": "B",
				"toNode": "C",
				"value": 0.002
			},
			{
				"label": "R4",
				"kind": "R",
				"fromNode": "C",
				"toNode": "0",
				"value": 4000
			}
		],
		"expected": {
			"nodeVoltages_V": {
				"A": -6,
				"B": -8,
				"C": -1.333333
			},
			"I_R3_A": -0.001333333,
			"P_total_W": 0.023333333
		}
	},
	{
		"id": "DC-04",
		"source": "Classmate MCQ / Worked_Answers A16",
		"category": "series_parallel",
		"nodes": [
			"0",
			"A",
			"B",
			"C",
			"D"
		],
		"components": [
			{
				"label": "V1",
				"kind": "V",
				"fromNode": "B",
				"toNode": "0",
				"value": 250
			},
			{
				"label": "R1",
				"kind": "R",
				"fromNode": "B",
				"toNode": "0",
				"value": 125
			},
			{
				"label": "R2",
				"kind": "R",
				"fromNode": "B",
				"toNode": "C",
				"value": 25
			},
			{
				"label": "I1",
				"kind": "I",
				"fromNode": "C",
				"toNode": "A",
				"value": 8
			},
			{
				"label": "R3",
				"kind": "R",
				"fromNode": "A",
				"toNode": "0",
				"value": 10
			},
			{
				"label": "R4",
				"kind": "R",
				"fromNode": "C",
				"toNode": "0",
				"value": 100
			},
			{
				"label": "R5",
				"kind": "R",
				"fromNode": "C",
				"toNode": "D",
				"value": 5
			},
			{
				"label": "R6",
				"kind": "R",
				"fromNode": "D",
				"toNode": "0",
				"value": 15
			}
		],
		"expected": {
			"nodeVoltages_V": {
				"A": 80,
				"B": 250,
				"C": 20,
				"D": 15
			},
			"I_R4_A": 0.2,
			"P_V1_sup_W": 2800,
			"P_I1_sup_W": 480,
			"P_total_W": 3280
		}
	},
	{
		"id": "DC-05",
		"source": "Sheet 2 Q2(b) (ocr/04 / Worked_Answers B8)",
		"category": "bridge_delta_wye",
		"nodes": [
			"0",
			"a",
			"n1",
			"n2",
			"n3"
		],
		"components": [
			{
				"label": "R1",
				"kind": "R",
				"fromNode": "a",
				"toNode": "n1",
				"value": 25
			},
			{
				"label": "R2",
				"kind": "R",
				"fromNode": "n1",
				"toNode": "n2",
				"value": 10
			},
			{
				"label": "R3",
				"kind": "R",
				"fromNode": "n2",
				"toNode": "n3",
				"value": 20
			},
			{
				"label": "R4",
				"kind": "R",
				"fromNode": "n1",
				"toNode": "n3",
				"value": 30
			},
			{
				"label": "R5",
				"kind": "R",
				"fromNode": "n2",
				"toNode": "0",
				"value": 5
			},
			{
				"label": "R6",
				"kind": "R",
				"fromNode": "n3",
				"toNode": "0",
				"value": 15
			}
		],
		"theveninTarget": {
			"portA": "a",
			"portB": "0"
		},
		"expected": {
			"Rab_ohm": 36.25
		}
	},
	{
		"id": "DC-06",
		"source": "Guide_and_Questions B13 / Worked_Answers B13 (Unbalanced Wheatstone Bridge)",
		"category": "bridge_delta_wye",
		"nodes": [
			"0",
			"a",
			"n1",
			"n2"
		],
		"components": [
			{
				"label": "R1",
				"kind": "R",
				"fromNode": "a",
				"toNode": "n1",
				"value": 10
			},
			{
				"label": "R2",
				"kind": "R",
				"fromNode": "a",
				"toNode": "n2",
				"value": 20
			},
			{
				"label": "R3",
				"kind": "R",
				"fromNode": "n1",
				"toNode": "n2",
				"value": 30
			},
			{
				"label": "R4",
				"kind": "R",
				"fromNode": "n1",
				"toNode": "0",
				"value": 40
			},
			{
				"label": "R5",
				"kind": "R",
				"fromNode": "n2",
				"toNode": "0",
				"value": 50
			}
		],
		"theveninTarget": {
			"portA": "a",
			"portB": "0"
		},
		"expected": {
			"Rab_ohm": 29.047619
		}
	},
	{
		"id": "DC-07",
		"source": "Midterm Fall 2020 Q1 (Guide_and_Questions B2 / Worked_Answers B2)",
		"category": "bridge_delta_wye",
		"nodes": [
			"0",
			"a",
			"b",
			"c",
			"d"
		],
		"components": [
			{
				"label": "R1",
				"kind": "R",
				"fromNode": "a",
				"toNode": "0",
				"value": 12
			},
			{
				"label": "R2",
				"kind": "R",
				"fromNode": "a",
				"toNode": "0",
				"value": 12
			},
			{
				"label": "R3",
				"kind": "R",
				"fromNode": "a",
				"toNode": "c",
				"value": 3
			},
			{
				"label": "I1",
				"kind": "I",
				"fromNode": "0",
				"toNode": "b",
				"value": 6
			},
			{
				"label": "R4",
				"kind": "R",
				"fromNode": "b",
				"toNode": "c",
				"value": 6
			},
			{
				"label": "R5",
				"kind": "R",
				"fromNode": "b",
				"toNode": "0",
				"value": 8
			},
			{
				"label": "R6",
				"kind": "R",
				"fromNode": "b",
				"toNode": "d",
				"value": 12
			},
			{
				"label": "R7",
				"kind": "R",
				"fromNode": "c",
				"toNode": "d",
				"value": 18
			},
			{
				"label": "R8",
				"kind": "R",
				"fromNode": "d",
				"toNode": "0",
				"value": 6
			}
		],
		"expected": {
			"nodeVoltages_V": {
				"a": 9,
				"b": 24,
				"c": 13.5,
				"d": 9
			},
			"Vo_V": 9,
			"P_I1_sup_W": 144,
			"P_total_W": 144
		}
	},
	{
		"id": "DC-08",
		"source": "Midterm Fall 2025 Q2 (Midterm_Fall2025_EPM214s.pdf / Worked_Answers C1 - Source Transformation)",
		"category": "bridge_delta_wye",
		"nodes": [
			"0",
			"n1",
			"n2",
			"n3",
			"n4"
		],
		"components": [
			{
				"label": "V1",
				"kind": "V",
				"fromNode": "n1",
				"toNode": "n2",
				"value": 6
			},
			{
				"label": "R1",
				"kind": "R",
				"fromNode": "n2",
				"toNode": "0",
				"value": 2000
			},
			{
				"label": "I1",
				"kind": "I",
				"fromNode": "0",
				"toNode": "n1",
				"value": 0.002
			},
			{
				"label": "V2",
				"kind": "V",
				"fromNode": "n3",
				"toNode": "0",
				"value": 12
			},
			{
				"label": "R2",
				"kind": "R",
				"fromNode": "n1",
				"toNode": "n3",
				"value": 2000
			},
			{
				"label": "R3",
				"kind": "R",
				"fromNode": "n1",
				"toNode": "n4",
				"value": 1000
			},
			{
				"label": "R4",
				"kind": "R",
				"fromNode": "n4",
				"toNode": "0",
				"value": 1000
			},
			{
				"label": "I2",
				"kind": "I",
				"fromNode": "0",
				"toNode": "n4",
				"value": 0.002
			}
		],
		"expected": {
			"nodeVoltages_V": {
				"n1": 8,
				"n2": 2,
				"n3": 12,
				"n4": 5
			},
			"Io_R3_A": 0.003,
			"P_total_W": 0.05
		}
	},
	{
		"id": "DC-09",
		"source": "Sheet 2 Q10 (ocr/04 / Worked_Answers C18 - Source Transformation)",
		"category": "bridge_delta_wye",
		"nodes": [
			"0",
			"P",
			"Q",
			"G2",
			"M"
		],
		"components": [
			{
				"label": "I1",
				"kind": "I",
				"fromNode": "P",
				"toNode": "0",
				"value": 3
			},
			{
				"label": "R1",
				"kind": "R",
				"fromNode": "P",
				"toNode": "0",
				"value": 4
			},
			{
				"label": "I2",
				"kind": "I",
				"fromNode": "P",
				"toNode": "Q",
				"value": 2
			},
			{
				"label": "R2",
				"kind": "R",
				"fromNode": "P",
				"toNode": "Q",
				"value": 9
			},
			{
				"label": "R3",
				"kind": "R",
				"fromNode": "Q",
				"toNode": "G2",
				"value": 5
			},
			{
				"label": "I3",
				"kind": "I",
				"fromNode": "Q",
				"toNode": "G2",
				"value": 6
			},
			{
				"label": "V1",
				"kind": "V",
				"fromNode": "M",
				"toNode": "G2",
				"value": 30
			},
			{
				"label": "R4",
				"kind": "R",
				"fromNode": "0",
				"toNode": "M",
				"value": 2
			}
		],
		"expected": {
			"nodeVoltages_V": {
				"P": -25.2,
				"Q": -36.9,
				"G2": -23.4,
				"M": 6.6
			},
			"Vo_0_minus_M_V": -6.6,
			"P_total_W": 255.6
		}
	},
	{
		"id": "DC-10",
		"source": "Sheet 3 Q1 (ocr/05 / Worked_Answers D10)",
		"category": "nodal",
		"nodes": [
			"0",
			"1",
			"2"
		],
		"components": [
			{
				"label": "I1",
				"kind": "I",
				"fromNode": "0",
				"toNode": "1",
				"value": 1
			},
			{
				"label": "R1",
				"kind": "R",
				"fromNode": "1",
				"toNode": "0",
				"value": 2
			},
			{
				"label": "R2",
				"kind": "R",
				"fromNode": "1",
				"toNode": "2",
				"value": 6
			},
			{
				"label": "R3",
				"kind": "R",
				"fromNode": "2",
				"toNode": "0",
				"value": 7
			},
			{
				"label": "I2",
				"kind": "I",
				"fromNode": "2",
				"toNode": "0",
				"value": 4
			}
		],
		"expected": {
			"nodeVoltages_V": {
				"1": -2,
				"2": -14
			},
			"P_total_W": 56
		}
	},
	{
		"id": "DC-11",
		"source": "Sheet 3 Q4 / Sheet 1 Q6 (ocr/05 / Worked_Answers D13)",
		"category": "nodal",
		"nodes": [
			"0",
			"a",
			"b",
			"c",
			"d"
		],
		"components": [
			{
				"label": "V1",
				"kind": "V",
				"fromNode": "b",
				"toNode": "0",
				"value": 40
			},
			{
				"label": "R1",
				"kind": "R",
				"fromNode": "b",
				"toNode": "a",
				"value": 1
			},
			{
				"label": "R2",
				"kind": "R",
				"fromNode": "a",
				"toNode": "c",
				"value": 2
			},
			{
				"label": "I1",
				"kind": "I",
				"fromNode": "a",
				"toNode": "c",
				"value": 5
			},
			{
				"label": "R3",
				"kind": "R",
				"fromNode": "c",
				"toNode": "0",
				"value": 4
			},
			{
				"label": "R4",
				"kind": "R",
				"fromNode": "c",
				"toNode": "d",
				"value": 8
			},
			{
				"label": "V2",
				"kind": "V",
				"fromNode": "0",
				"toNode": "d",
				"value": 20
			}
		],
		"expected": {
			"nodeVoltages_V": {
				"a": 30,
				"b": 40,
				"c": 20,
				"d": -20
			},
			"Vo_Vc_V": 20,
			"P_total_W": 500
		}
	},
	{
		"id": "DC-12",
		"source": "Sheet 3 Q2 (ocr/05 / Worked_Answers D11 - Conductances 6S, 5S, 3S + Supernode)",
		"category": "supernode",
		"nodes": [
			"0",
			"a",
			"b",
			"c"
		],
		"components": [
			{
				"label": "R1",
				"kind": "R",
				"fromNode": "a",
				"toNode": "0",
				"value": 0.1666666667
			},
			{
				"label": "V1",
				"kind": "V",
				"fromNode": "a",
				"toNode": "b",
				"value": 10
			},
			{
				"label": "R2",
				"kind": "R",
				"fromNode": "b",
				"toNode": "0",
				"value": 0.2
			},
			{
				"label": "R3",
				"kind": "R",
				"fromNode": "b",
				"toNode": "c",
				"value": 0.3333333333
			},
			{
				"label": "I1",
				"kind": "I",
				"fromNode": "a",
				"toNode": "c",
				"value": 2
			},
			{
				"label": "I2",
				"kind": "I",
				"fromNode": "0",
				"toNode": "c",
				"value": 4
			}
		],
		"expected": {
			"nodeVoltages_V": {
				"a": 4.909091,
				"b": -5.090909,
				"c": -3.090909
			},
			"io_R1_A": 29.454545
		}
	},
	{
		"id": "DC-13",
		"source": "Midterm Fall 2025 Q3 (Midterm_Fall2025_EPM214s.pdf / Worked_Answers D1)",
		"category": "supernode",
		"nodes": [
			"0",
			"a",
			"b",
			"c",
			"d"
		],
		"components": [
			{
				"label": "V1",
				"kind": "V",
				"fromNode": "a",
				"toNode": "0",
				"value": 6
			},
			{
				"label": "I1",
				"kind": "I",
				"fromNode": "a",
				"toNode": "c",
				"value": 0.006
			},
			{
				"label": "R1",
				"kind": "R",
				"fromNode": "a",
				"toNode": "b",
				"value": 1000
			},
			{
				"label": "R2",
				"kind": "R",
				"fromNode": "b",
				"toNode": "c",
				"value": 1000
			},
			{
				"label": "R3",
				"kind": "R",
				"fromNode": "b",
				"toNode": "0",
				"value": 1000
			},
			{
				"label": "V2",
				"kind": "V",
				"fromNode": "d",
				"toNode": "b",
				"value": 12
			},
			{
				"label": "R4",
				"kind": "R",
				"fromNode": "c",
				"toNode": "d",
				"value": 2000
			},
			{
				"label": "R5",
				"kind": "R",
				"fromNode": "d",
				"toNode": "0",
				"value": 2000
			}
		],
		"expected": {
			"nodeVoltages_V": {
				"a": 6,
				"b": 2.4,
				"c": 10.4,
				"d": 14.4
			},
			"Vo_Vd_V": 14.4,
			"P_total_W": 0.1944
		}
	},
	{
		"id": "DC-14",
		"source": "Midterm Spring 2026 Q1 / Fall 2023 Q2 (Midterm_Spring2026_EPM214s.pdf / Worked_Answers D2 - Double Floating V-Source Supernode)",
		"category": "supernode",
		"nodes": [
			"0",
			"a",
			"b",
			"c",
			"d"
		],
		"components": [
			{
				"label": "R1",
				"kind": "R",
				"fromNode": "c",
				"toNode": "a",
				"value": 2000
			},
			{
				"label": "R2",
				"kind": "R",
				"fromNode": "a",
				"toNode": "0",
				"value": 2000
			},
			{
				"label": "V1",
				"kind": "V",
				"fromNode": "a",
				"toNode": "b",
				"value": 6
			},
			{
				"label": "I1",
				"kind": "I",
				"fromNode": "b",
				"toNode": "c",
				"value": 0.004
			},
			{
				"label": "R3",
				"kind": "R",
				"fromNode": "b",
				"toNode": "0",
				"value": 1000
			},
			{
				"label": "V2",
				"kind": "V",
				"fromNode": "d",
				"toNode": "b",
				"value": 12
			},
			{
				"label": "R4",
				"kind": "R",
				"fromNode": "c",
				"toNode": "d",
				"value": 1000
			},
			{
				"label": "R5",
				"kind": "R",
				"fromNode": "d",
				"toNode": "0",
				"value": 1000
			}
		],
		"expected": {
			"nodeVoltages_V": {
				"a": 0,
				"b": -6,
				"c": 6.666667,
				"d": 6
			},
			"Vo_Vd_V": 6,
			"P_I1_sup_W": 0.050666667,
			"P_V1_sup_W": -0.02,
			"P_V2_sup_W": 0.064
		}
	},
	{
		"id": "DC-15",
		"source": "Midterm Spring 2024 Q2 (Guide_and_Questions D3 / Worked_Answers D3)",
		"category": "supernode",
		"nodes": [
			"0",
			"1",
			"2",
			"3",
			"a",
			"b"
		],
		"components": [
			{
				"label": "V1",
				"kind": "V",
				"fromNode": "b",
				"toNode": "a",
				"value": 100
			},
			{
				"label": "R1",
				"kind": "R",
				"fromNode": "a",
				"toNode": "0",
				"value": 3
			},
			{
				"label": "R2",
				"kind": "R",
				"fromNode": "b",
				"toNode": "1",
				"value": 7
			},
			{
				"label": "R3",
				"kind": "R",
				"fromNode": "1",
				"toNode": "0",
				"value": 10
			},
			{
				"label": "R4",
				"kind": "R",
				"fromNode": "1",
				"toNode": "2",
				"value": 5
			},
			{
				"label": "R5",
				"kind": "R",
				"fromNode": "2",
				"toNode": "3",
				"value": 10
			},
			{
				"label": "I1",
				"kind": "I",
				"fromNode": "2",
				"toNode": "3",
				"value": 5
			},
			{
				"label": "R6",
				"kind": "R",
				"fromNode": "3",
				"toNode": "0",
				"value": 20
			}
		],
		"expected": {
			"nodeVoltages_V": {
				"1": 37.5,
				"2": 25,
				"3": 50,
				"a": -18.75,
				"b": 81.25
			},
			"P_V1_sup_W": 625,
			"P_I1_sup_W": 125,
			"P_total_W": 750
		}
	},
	{
		"id": "DC-16",
		"source": "Sheet 3 Q10 (ocr/05 / Worked_Answers E11 - 3-Mesh Pure Voltage Sources)",
		"category": "mesh",
		"nodes": [
			"0",
			"n1",
			"n2",
			"a",
			"b",
			"c"
		],
		"components": [
			{
				"label": "V1",
				"kind": "V",
				"fromNode": "n1",
				"toNode": "0",
				"value": 80
			},
			{
				"label": "V2",
				"kind": "V",
				"fromNode": "n2",
				"toNode": "n1",
				"value": 80
			},
			{
				"label": "R1",
				"kind": "R",
				"fromNode": "n2",
				"toNode": "a",
				"value": 20
			},
			{
				"label": "R2",
				"kind": "R",
				"fromNode": "n1",
				"toNode": "c",
				"value": 20
			},
			{
				"label": "R3",
				"kind": "R",
				"fromNode": "0",
				"toNode": "b",
				"value": 20
			},
			{
				"label": "R4",
				"kind": "R",
				"fromNode": "c",
				"toNode": "a",
				"value": 30
			},
			{
				"label": "R5",
				"kind": "R",
				"fromNode": "c",
				"toNode": "b",
				"value": 30
			},
			{
				"label": "R6",
				"kind": "R",
				"fromNode": "a",
				"toNode": "b",
				"value": 30
			}
		],
		"expected": {
			"nodeVoltages_V": {
				"n1": 80,
				"n2": 160,
				"a": 106.666667,
				"b": 53.333333,
				"c": 80
			},
			"Vab_V": 53.333333,
			"P_total_W": 426.666667
		}
	},
	{
		"id": "DC-17",
		"source": "Sheet 3 Q7 (ocr/05 / Worked_Answers E9 - 3-Mesh Supermesh)",
		"category": "supermesh",
		"nodes": [
			"0",
			"n1",
			"n2",
			"n3",
			"n4"
		],
		"components": [
			{
				"label": "R1",
				"kind": "R",
				"fromNode": "n1",
				"toNode": "0",
				"value": 5
			},
			{
				"label": "R2",
				"kind": "R",
				"fromNode": "n1",
				"toNode": "n2",
				"value": 2
			},
			{
				"label": "V1",
				"kind": "V",
				"fromNode": "n2",
				"toNode": "n3",
				"value": 6
			},
			{
				"label": "R3",
				"kind": "R",
				"fromNode": "n1",
				"toNode": "n4",
				"value": 1
			},
			{
				"label": "R4",
				"kind": "R",
				"fromNode": "n3",
				"toNode": "n4",
				"value": 4
			},
			{
				"label": "I1",
				"kind": "I",
				"fromNode": "0",
				"toNode": "n4",
				"value": 3
			},
			{
				"label": "V2",
				"kind": "V",
				"fromNode": "n3",
				"toNode": "0",
				"value": 12
			}
		],
		"expected": {
			"nodeVoltages_V": {
				"n1": 15.333333,
				"n2": 18,
				"n3": 12,
				"n4": 17.066667
			},
			"io_R3_A": -1.733333,
			"P_total_W": 60
		}
	},
	{
		"id": "DC-18",
		"source": "Sheet 3 Q8 (ocr/05 / Worked_Answers E10 - 4-Mesh Supermesh)",
		"category": "supermesh",
		"nodes": [
			"0",
			"n1",
			"n2",
			"n3",
			"n4"
		],
		"components": [
			{
				"label": "V1",
				"kind": "V",
				"fromNode": "n1",
				"toNode": "0",
				"value": 30
			},
			{
				"label": "R1",
				"kind": "R",
				"fromNode": "n1",
				"toNode": "n2",
				"value": 4
			},
			{
				"label": "R2",
				"kind": "R",
				"fromNode": "n1",
				"toNode": "n3",
				"value": 2
			},
			{
				"label": "I1",
				"kind": "I",
				"fromNode": "n3",
				"toNode": "n2",
				"value": 4
			},
			{
				"label": "R3",
				"kind": "R",
				"fromNode": "n3",
				"toNode": "0",
				"value": 3
			},
			{
				"label": "R4",
				"kind": "R",
				"fromNode": "n2",
				"toNode": "n4",
				"value": 8
			},
			{
				"label": "R5",
				"kind": "R",
				"fromNode": "n3",
				"toNode": "n4",
				"value": 6
			},
			{
				"label": "R6",
				"kind": "R",
				"fromNode": "n4",
				"toNode": "0",
				"value": 1
			}
		],
		"expected": {
			"nodeVoltages_V": {
				"n1": 30,
				"n2": 32.212121,
				"n3": 11.772727,
				"n4": 4.636364
			},
			"i_leaving_V1_A": 8.560606,
			"I_R6_A": 4.636364,
			"P_total_W": 338.575758
		}
	},
	{
		"id": "DC-19",
		"source": "Midterm Summer 2025 Q3 (Guide_and_Questions E2 / Worked_Answers E2 - 4-Mesh Diamond with 2 Supermeshes)",
		"category": "supermesh",
		"nodes": [
			"0",
			"L",
			"T",
			"R",
			"C"
		],
		"components": [
			{
				"label": "R1",
				"kind": "R",
				"fromNode": "L",
				"toNode": "T",
				"value": 2000
			},
			{
				"label": "R2",
				"kind": "R",
				"fromNode": "T",
				"toNode": "R",
				"value": 1000
			},
			{
				"label": "R3",
				"kind": "R",
				"fromNode": "L",
				"toNode": "0",
				"value": 1000
			},
			{
				"label": "R4",
				"kind": "R",
				"fromNode": "R",
				"toNode": "0",
				"value": 2000
			},
			{
				"label": "I1",
				"kind": "I",
				"fromNode": "C",
				"toNode": "T",
				"value": 0.002
			},
			{
				"label": "I2",
				"kind": "I",
				"fromNode": "C",
				"toNode": "0",
				"value": 0.004
			},
			{
				"label": "V1",
				"kind": "V",
				"fromNode": "C",
				"toNode": "L",
				"value": 6
			},
			{
				"label": "V2",
				"kind": "V",
				"fromNode": "C",
				"toNode": "R",
				"value": 4
			}
		],
		"expected": {
			"nodeVoltages_V": {
				"T": -0.666667,
				"L": -3.333333,
				"R": -1.333333,
				"C": 2.666667
			},
			"Vo_VT_V": -0.666667
		}
	},
	{
		"id": "DC-20",
		"source": "Midterm Summer 2024 Q3 (Guide_and_Questions E4 / Worked_Answers E4 - 4-Mesh with 3-Mesh Supermesh)",
		"category": "supermesh",
		"nodes": [
			"0",
			"top",
			"ml",
			"C",
			"mr"
		],
		"components": [
			{
				"label": "V1",
				"kind": "V",
				"fromNode": "top",
				"toNode": "ml",
				"value": 6
			},
			{
				"label": "R1",
				"kind": "R",
				"fromNode": "ml",
				"toNode": "0",
				"value": 6000
			},
			{
				"label": "I1",
				"kind": "I",
				"fromNode": "ml",
				"toNode": "C",
				"value": 0.002
			},
			{
				"label": "R2",
				"kind": "R",
				"fromNode": "top",
				"toNode": "C",
				"value": 2000
			},
			{
				"label": "I2",
				"kind": "I",
				"fromNode": "0",
				"toNode": "C",
				"value": 0.001
			},
			{
				"label": "R3",
				"kind": "R",
				"fromNode": "C",
				"toNode": "mr",
				"value": 2000
			},
			{
				"label": "R4",
				"kind": "R",
				"fromNode": "top",
				"toNode": "mr",
				"value": 4000
			},
			{
				"label": "R5",
				"kind": "R",
				"fromNode": "mr",
				"toNode": "0",
				"value": 2000
			}
		],
		"expected": {
			"nodeVoltages_V": {
				"top": 3,
				"ml": -3,
				"C": 6,
				"mr": 3
			},
			"Io_R2_A": -0.0015
		}
	},
	{
		"id": "DC-21",
		"source": "Midterm Spring 2026 Q2 (Midterm_Spring2026_EPM214s.pdf / Worked_Answers F1 & G3)",
		"category": "superposition",
		"nodes": [
			"0",
			"a",
			"b"
		],
		"components": [
			{
				"label": "V1",
				"kind": "V",
				"fromNode": "b",
				"toNode": "a",
				"value": 24
			},
			{
				"label": "R1",
				"kind": "R",
				"fromNode": "a",
				"toNode": "0",
				"value": 3000
			},
			{
				"label": "I1",
				"kind": "I",
				"fromNode": "a",
				"toNode": "0",
				"value": 0.002
			},
			{
				"label": "R2",
				"kind": "R",
				"fromNode": "b",
				"toNode": "0",
				"value": 6000
			},
			{
				"label": "R_load",
				"kind": "R",
				"fromNode": "b",
				"toNode": "0",
				"value": 4000
			},
			{
				"label": "I2",
				"kind": "I",
				"fromNode": "0",
				"toNode": "b",
				"value": 0.002
			},
			{
				"label": "R3",
				"kind": "R",
				"fromNode": "b",
				"toNode": "0",
				"value": 2000
			}
		],
		"theveninTarget": {
			"componentLabel": "R_load",
			"portA": "b",
			"portB": "0"
		},
		"expected": {
			"nodeVoltages_V": {
				"a": -17.6,
				"b": 6.4
			},
			"Io_R_load_A": 0.0016,
			"Vth_V": 8,
			"Rth_ohm": 1000,
			"P_total_W": 0.1408
		}
	},
	{
		"id": "DC-22",
		"source": "Final Spring 2025 Q1 (Guide_and_Questions F2 / Worked_Answers F2)",
		"category": "superposition",
		"nodes": [
			"0",
			"a",
			"b",
			"c",
			"d"
		],
		"components": [
			{
				"label": "V1",
				"kind": "V",
				"fromNode": "a",
				"toNode": "0",
				"value": 12
			},
			{
				"label": "R1",
				"kind": "R",
				"fromNode": "a",
				"toNode": "d",
				"value": 4000
			},
			{
				"label": "V2",
				"kind": "V",
				"fromNode": "d",
				"toNode": "c",
				"value": 12
			},
			{
				"label": "R2",
				"kind": "R",
				"fromNode": "a",
				"toNode": "b",
				"value": 4000
			},
			{
				"label": "R3",
				"kind": "R",
				"fromNode": "b",
				"toNode": "0",
				"value": 4000
			},
			{
				"label": "I1",
				"kind": "I",
				"fromNode": "b",
				"toNode": "c",
				"value": 0.006
			},
			{
				"label": "R4",
				"kind": "R",
				"fromNode": "c",
				"toNode": "0",
				"value": 4000
			}
		],
		"expected": {
			"nodeVoltages_V": {
				"a": 12,
				"b": -6,
				"c": 12,
				"d": 24
			},
			"Io_R2_A": 0.0045,
			"P_total_W": 0.162
		}
	},
	{
		"id": "DC-23",
		"source": "Sheet 4 Q2 (ocr/06 / Worked_Answers F7)",
		"category": "superposition",
		"nodes": [
			"0",
			"a",
			"b",
			"c",
			"d"
		],
		"components": [
			{
				"label": "V1",
				"kind": "V",
				"fromNode": "a",
				"toNode": "0",
				"value": 12
			},
			{
				"label": "R1",
				"kind": "R",
				"fromNode": "a",
				"toNode": "b",
				"value": 6
			},
			{
				"label": "R2",
				"kind": "R",
				"fromNode": "b",
				"toNode": "0",
				"value": 3
			},
			{
				"label": "R3",
				"kind": "R",
				"fromNode": "b",
				"toNode": "c",
				"value": 5
			},
			{
				"label": "I1",
				"kind": "I",
				"fromNode": "c",
				"toNode": "b",
				"value": 2
			},
			{
				"label": "R4",
				"kind": "R",
				"fromNode": "c",
				"toNode": "0",
				"value": 12
			},
			{
				"label": "R5",
				"kind": "R",
				"fromNode": "c",
				"toNode": "d",
				"value": 4
			},
			{
				"label": "V2",
				"kind": "V",
				"fromNode": "d",
				"toNode": "0",
				"value": 19
			}
		],
		"expected": {
			"nodeVoltages_V": {
				"a": 12,
				"b": 8.05,
				"c": 8.175,
				"d": 19
			},
			"vo_Vb_minus_Vc_V": -0.125,
			"P_total_W": 59.31875
		}
	},
	{
		"id": "DC-24",
		"source": "Final Fall 2025 Q1 (Final_Fall2025_EPM214s.pdf + Final_Fall2025_key.pdf / Worked_Answers G1)",
		"category": "thevenin_norton",
		"nodes": [
			"0",
			"a",
			"b",
			"c",
			"d"
		],
		"components": [
			{
				"label": "I1",
				"kind": "I",
				"fromNode": "0",
				"toNode": "d",
				"value": 0.002
			},
			{
				"label": "R1",
				"kind": "R",
				"fromNode": "d",
				"toNode": "a",
				"value": 1000
			},
			{
				"label": "V1",
				"kind": "V",
				"fromNode": "a",
				"toNode": "b",
				"value": 2
			},
			{
				"label": "R2",
				"kind": "R",
				"fromNode": "d",
				"toNode": "b",
				"value": 1000
			},
			{
				"label": "R3",
				"kind": "R",
				"fromNode": "d",
				"toNode": "c",
				"value": 1000
			},
			{
				"label": "V2",
				"kind": "V",
				"fromNode": "c",
				"toNode": "0",
				"value": 4
			},
			{
				"label": "R_load",
				"kind": "R",
				"fromNode": "b",
				"toNode": "0",
				"value": 4000
			}
		],
		"theveninTarget": {
			"componentLabel": "R_load",
			"portA": "b",
			"portB": "0"
		},
		"expected": {
			"Vth_V": 5,
			"Rth_ohm": 1500,
			"IN_A": 0.003333333,
			"Io_R_load_A": 0.000909091,
			"nodeVoltages_with_load_V": {
				"a": 5.636364,
				"b": 3.636364,
				"c": 4,
				"d": 5.090909
			}
		}
	},
	{
		"id": "DC-25",
		"source": "Sheet 4 Q8 (ocr/06 / Worked_Answers G7)",
		"category": "thevenin_norton",
		"nodes": [
			"0",
			"a",
			"b",
			"c",
			"d"
		],
		"components": [
			{
				"label": "V1",
				"kind": "V",
				"fromNode": "a",
				"toNode": "0",
				"value": 6
			},
			{
				"label": "R1",
				"kind": "R",
				"fromNode": "a",
				"toNode": "b",
				"value": 6000
			},
			{
				"label": "R2",
				"kind": "R",
				"fromNode": "b",
				"toNode": "0",
				"value": 12000
			},
			{
				"label": "I1",
				"kind": "I",
				"fromNode": "b",
				"toNode": "c",
				"value": 0.004
			},
			{
				"label": "R3",
				"kind": "R",
				"fromNode": "c",
				"toNode": "0",
				"value": 4000
			},
			{
				"label": "R4",
				"kind": "R",
				"fromNode": "c",
				"toNode": "d",
				"value": 8000
			},
			{
				"label": "R5",
				"kind": "R",
				"fromNode": "b",
				"toNode": "d",
				"value": 4000
			},
			{
				"label": "R_load",
				"kind": "R",
				"fromNode": "d",
				"toNode": "0",
				"value": 6000
			}
		],
		"theveninTarget": {
			"componentLabel": "R_load",
			"portA": "d",
			"portB": "0"
		},
		"expected": {
			"Vth_V": -0.8,
			"Rth_ohm": 4800,
			"IN_A": -0.000166667,
			"Vo_Vd_V": -0.444444,
			"nodeVoltages_with_load_V": {
				"a": 6,
				"b": -6.222222,
				"c": 10.518519,
				"d": -0.444444
			}
		}
	},
	{
		"id": "DC-26",
		"source": "Sheet 4 Q9 (ocr/06 / Worked_Answers G8 - Floating Load Thévenin)",
		"category": "thevenin_norton",
		"nodes": [
			"0",
			"a",
			"b",
			"c",
			"d"
		],
		"components": [
			{
				"label": "I1",
				"kind": "I",
				"fromNode": "d",
				"toNode": "a",
				"value": 0.001
			},
			{
				"label": "R1",
				"kind": "R",
				"fromNode": "a",
				"toNode": "0",
				"value": 1000
			},
			{
				"label": "R2",
				"kind": "R",
				"fromNode": "d",
				"toNode": "b",
				"value": 1000
			},
			{
				"label": "I2",
				"kind": "I",
				"fromNode": "0",
				"toNode": "b",
				"value": 0.002
			},
			{
				"label": "R3",
				"kind": "R",
				"fromNode": "b",
				"toNode": "c",
				"value": 500
			},
			{
				"label": "I3",
				"kind": "I",
				"fromNode": "c",
				"toNode": "d",
				"value": 0.002
			},
			{
				"label": "V1",
				"kind": "V",
				"fromNode": "0",
				"toNode": "c",
				"value": 6
			},
			{
				"label": "R_load",
				"kind": "R",
				"fromNode": "a",
				"toNode": "b",
				"value": 500
			}
		],
		"theveninTarget": {
			"componentLabel": "R_load",
			"portA": "a",
			"portB": "b"
		},
		"expected": {
			"Vth_V": 5.5,
			"Rth_ohm": 1500,
			"IN_A": 0.003666667,
			"Vo_Va_minus_Vb_V": 1.375,
			"nodeVoltages_with_load_V": {
				"a": -1.75,
				"b": -3.125,
				"c": -6,
				"d": -2.125
			}
		}
	},
	{
		"id": "DC-27",
		"source": "Lecture Slides Ex 4.13 (ocr/01 / Worked_Answers G11)",
		"category": "max_power",
		"nodes": [
			"0",
			"a",
			"b",
			"c",
			"d"
		],
		"components": [
			{
				"label": "V1",
				"kind": "V",
				"fromNode": "d",
				"toNode": "0",
				"value": 12
			},
			{
				"label": "R1",
				"kind": "R",
				"fromNode": "d",
				"toNode": "b",
				"value": 6
			},
			{
				"label": "R2",
				"kind": "R",
				"fromNode": "b",
				"toNode": "0",
				"value": 12
			},
			{
				"label": "R3",
				"kind": "R",
				"fromNode": "b",
				"toNode": "c",
				"value": 3
			},
			{
				"label": "I1",
				"kind": "I",
				"fromNode": "0",
				"toNode": "c",
				"value": 2
			},
			{
				"label": "R4",
				"kind": "R",
				"fromNode": "c",
				"toNode": "a",
				"value": 2
			},
			{
				"label": "RL",
				"kind": "R",
				"fromNode": "a",
				"toNode": "0",
				"value": 9
			}
		],
		"theveninTarget": {
			"componentLabel": "RL",
			"portA": "a",
			"portB": "0"
		},
		"expected": {
			"Vth_V": 22,
			"Rth_ohm": 9,
			"RL_opt_ohm": 9,
			"Pmax_W": 13.444444,
			"nodeVoltages_at_RL_opt_V": {
				"a": 11,
				"b": 11.111111,
				"c": 13.444444,
				"d": 12
			}
		}
	},
	{
		"id": "DC-28",
		"source": "Past Exam / Worked_Answers G6 (kΩ/mA Max Power Transfer)",
		"category": "max_power",
		"nodes": [
			"0",
			"a",
			"b",
			"c",
			"d"
		],
		"components": [
			{
				"label": "V1",
				"kind": "V",
				"fromNode": "c",
				"toNode": "a",
				"value": 60
			},
			{
				"label": "R1",
				"kind": "R",
				"fromNode": "c",
				"toNode": "b",
				"value": 2400
			},
			{
				"label": "R2",
				"kind": "R",
				"fromNode": "b",
				"toNode": "a",
				"value": 4800
			},
			{
				"label": "I1",
				"kind": "I",
				"fromNode": "b",
				"toNode": "a",
				"value": 0.015
			},
			{
				"label": "R3",
				"kind": "R",
				"fromNode": "b",
				"toNode": "d",
				"value": 1600
			},
			{
				"label": "R4",
				"kind": "R",
				"fromNode": "d",
				"toNode": "0",
				"value": 5000
			},
			{
				"label": "R5",
				"kind": "R",
				"fromNode": "a",
				"toNode": "0",
				"value": 1800
			},
			{
				"label": "Ro",
				"kind": "R",
				"fromNode": "d",
				"toNode": "0",
				"value": 2500
			}
		],
		"theveninTarget": {
			"componentLabel": "Ro",
			"portA": "d",
			"portB": "0"
		},
		"expected": {
			"Vth_V": 8,
			"Rth_ohm": 2500,
			"Ro_opt_ohm": 2500,
			"Pmax_W": 0.0064,
			"nodeVoltages_at_Ro_opt_V": {
				"a": -4.32,
				"b": 7.84,
				"c": 55.68,
				"d": 4
			}
		}
	},
	{
		"id": "DC-29",
		"source": "Lec 1 External Q2.21 (ocr/21 p.6 & ocr/22 p.3 - VCVS)",
		"category": "dependent_source",
		"nodes": [
			"0",
			"A",
			"B",
			"C",
			"D"
		],
		"components": [
			{
				"label": "V1",
				"kind": "V",
				"fromNode": "A",
				"toNode": "0",
				"value": 15
			},
			{
				"label": "R1",
				"kind": "R",
				"fromNode": "A",
				"toNode": "B",
				"value": 1
			},
			{
				"label": "E1",
				"kind": "VCVS",
				"fromNode": "B",
				"toNode": "C",
				"value": 2,
				"dependentSpec": {
					"controlType": "voltage",
					"controlFrom": "C",
					"controlTo": "D",
					"gain": 2
				}
			},
			{
				"label": "R2",
				"kind": "R",
				"fromNode": "C",
				"toNode": "D",
				"value": 5
			},
			{
				"label": "R3",
				"kind": "R",
				"fromNode": "D",
				"toNode": "0",
				"value": 2
			}
		],
		"expected": {
			"Vx_VC_minus_VD_V": 4.166667,
			"I_loop_A": 0.833333,
			"nodeVoltages_V": {
				"A": 15,
				"B": 14.166667,
				"C": 5.833333,
				"D": 1.666667
			},
			"P_E1_abs_W": 6.944444,
			"P_V1_sup_W": 12.5
		}
	},
	{
		"id": "DC-30",
		"source": "Fall 2024 Quiz 2 Q3 / Fall 2022 Q10 / Fall 2023 Q7 (Quiz2_ALL_Solved.pdf p.2, 7, 9 - CCVS)",
		"category": "dependent_source",
		"nodes": [
			"0",
			"A",
			"B",
			"C"
		],
		"components": [
			{
				"label": "V1",
				"kind": "V",
				"fromNode": "A",
				"toNode": "0",
				"value": 10
			},
			{
				"label": "R1",
				"kind": "R",
				"fromNode": "A",
				"toNode": "B",
				"value": 2
			},
			{
				"label": "I1",
				"kind": "I",
				"fromNode": "0",
				"toNode": "B",
				"value": 3
			},
			{
				"label": "R2",
				"kind": "R",
				"fromNode": "B",
				"toNode": "C",
				"value": 1
			},
			{
				"label": "H1",
				"kind": "CCVS",
				"fromNode": "C",
				"toNode": "0",
				"value": 2,
				"dependentSpec": {
					"controlType": "current",
					"controlLabel": "R1",
					"gain": 2
				}
			}
		],
		"expected": {
			"i1_R1_A": 1.4,
			"nodeVoltages_V": {
				"A": 10,
				"B": 7.2,
				"C": 2.8
			},
			"P_H1_abs_W": 12.32,
			"P_V1_sup_W": 14,
			"P_I1_sup_W": 21.6
		}
	},
	{
		"id": "DC-31",
		"source": "Fall 2022 Quiz 2 Q5 (Quiz2_ALL_Solved.pdf p.5 - VCVS Polarity Trap)",
		"category": "dependent_source",
		"nodes": [
			"0",
			"A",
			"B",
			"C",
			"D"
		],
		"components": [
			{
				"label": "R1",
				"kind": "R",
				"fromNode": "A",
				"toNode": "0",
				"value": 3
			},
			{
				"label": "I1",
				"kind": "I",
				"fromNode": "B",
				"toNode": "A",
				"value": 2
			},
			{
				"label": "V1",
				"kind": "V",
				"fromNode": "B",
				"toNode": "C",
				"value": 4
			},
			{
				"label": "R2",
				"kind": "R",
				"fromNode": "C",
				"toNode": "0",
				"value": 2
			},
			{
				"label": "R3",
				"kind": "R",
				"fromNode": "B",
				"toNode": "D",
				"value": 5
			},
			{
				"label": "E1",
				"kind": "VCVS",
				"fromNode": "D",
				"toNode": "0",
				"value": 3,
				"dependentSpec": {
					"controlType": "voltage",
					"controlFrom": "C",
					"controlTo": "0",
					"gain": 3
				}
			}
		],
		"expected": {
			"I_R3_A": 12,
			"VR_VC_V": -28,
			"nodeVoltages_V": {
				"A": 6,
				"B": -24,
				"C": -28,
				"D": -84
			},
			"P_E1_sup_W": 1008
		}
	},
	{
		"id": "DC-32",
		"source": "Fall 2024 Quiz 2 Q5 (Quiz2_ALL_Solved.pdf p.3 - Thévenin Resistance with VCVS via Test Source)",
		"category": "dependent_source",
		"nodes": [
			"0",
			"n1",
			"A"
		],
		"components": [
			{
				"label": "R1",
				"kind": "R",
				"fromNode": "n1",
				"toNode": "0",
				"value": 2000
			},
			{
				"label": "R2",
				"kind": "R",
				"fromNode": "n1",
				"toNode": "0",
				"value": 2000
			},
			{
				"label": "E1",
				"kind": "VCVS",
				"fromNode": "n1",
				"toNode": "A",
				"value": 3,
				"dependentSpec": {
					"controlType": "voltage",
					"controlFrom": "A",
					"controlTo": "0",
					"gain": 3
				}
			},
			{
				"label": "R3",
				"kind": "R",
				"fromNode": "A",
				"toNode": "0",
				"value": 1000
			}
		],
		"theveninTarget": {
			"portA": "A",
			"portB": "0"
		},
		"expected": {
			"Vth_V": 0,
			"Rth_ohm": 200
		}
	},
	{
		"id": "DC-33",
		"source": "Sheet 2 Q1 (ocr/04 / Worked_Answers B6 - Unknown R from Req)",
		"category": "unknown_param",
		"nodes": [
			"0",
			"a",
			"d",
			"x",
			"c"
		],
		"components": [
			{
				"label": "R1",
				"kind": "R",
				"fromNode": "a",
				"toNode": "d",
				"value": 30
			},
			{
				"label": "R2",
				"kind": "R",
				"fromNode": "d",
				"toNode": "0",
				"value": 60
			},
			{
				"label": "R3",
				"kind": "R",
				"fromNode": "d",
				"toNode": "x",
				"value": 10
			},
			{
				"label": "Rx",
				"kind": "R",
				"fromNode": "x",
				"toNode": "c",
				"value": 16
			},
			{
				"label": "R4",
				"kind": "R",
				"fromNode": "c",
				"toNode": "0",
				"value": 12
			},
			{
				"label": "R5",
				"kind": "R",
				"fromNode": "c",
				"toNode": "0",
				"value": 12
			},
			{
				"label": "R6",
				"kind": "R",
				"fromNode": "c",
				"toNode": "0",
				"value": 12
			}
		],
		"theveninTarget": {
			"portA": "a",
			"portB": "0"
		},
		"unknownSpec": {
			"targetComponent": "Rx",
			"parameter": "resistance",
			"givenConstraint": {
				"metric": "Req",
				"portA": "a",
				"portB": "0",
				"value": 50
			}
		},
		"expected": {
			"Rx_ohm": 16,
			"Req_check_ohm": 50
		}
	},
	{
		"id": "DC-34",
		"source": "Midterm Summer 2021 Q3 (Guide_and_Questions G2 / Worked_Answers G2 - Unknown R from Power, 2 Roots)",
		"category": "unknown_param",
		"nodes": [
			"0",
			"a",
			"b",
			"c"
		],
		"components": [
			{
				"label": "I1",
				"kind": "I",
				"fromNode": "0",
				"toNode": "a",
				"value": 0.002
			},
			{
				"label": "V1",
				"kind": "V",
				"fromNode": "c",
				"toNode": "a",
				"value": 6
			},
			{
				"label": "R1",
				"kind": "R",
				"fromNode": "a",
				"toNode": "b",
				"value": 2000
			},
			{
				"label": "R2",
				"kind": "R",
				"fromNode": "c",
				"toNode": "b",
				"value": 4000
			},
			{
				"label": "R3",
				"kind": "R",
				"fromNode": "b",
				"toNode": "0",
				"value": 2000
			},
			{
				"label": "Rx",
				"kind": "R",
				"fromNode": "c",
				"toNode": "0",
				"value": 2000
			}
		],
		"theveninTarget": {
			"componentLabel": "Rx",
			"portA": "c",
			"portB": "0"
		},
		"unknownSpec": {
			"targetComponent": "Rx",
			"parameter": "resistance",
			"givenConstraint": {
				"metric": "power_absorbed",
				"component": "Rx",
				"value": 0.008
			}
		},
		"expected": {
			"Rx_solutions_ohm": [
				2000,
				5555.555556
			],
			"Vth_V": 10.666667,
			"Rth_ohm": 3333.333333
		}
	},
	{
		"id": "DC-35",
		"source": "Midterm Fall 2023 Q1 (Guide_and_Questions A6 / Worked_Answers A6 - Unknown Vx from Source Power)",
		"category": "unknown_param",
		"nodes": [
			"0",
			"a",
			"b",
			"c",
			"d"
		],
		"components": [
			{
				"label": "V1",
				"kind": "V",
				"fromNode": "a",
				"toNode": "0",
				"value": 5
			},
			{
				"label": "R1",
				"kind": "R",
				"fromNode": "a",
				"toNode": "0",
				"value": 2
			},
			{
				"label": "R2",
				"kind": "R",
				"fromNode": "a",
				"toNode": "d",
				"value": 4
			},
			{
				"label": "R3",
				"kind": "R",
				"fromNode": "d",
				"toNode": "0",
				"value": 2
			},
			{
				"label": "I1",
				"kind": "I",
				"fromNode": "0",
				"toNode": "d",
				"value": 5
			},
			{
				"label": "I2",
				"kind": "I",
				"fromNode": "a",
				"toNode": "d",
				"value": 3
			},
			{
				"label": "R4",
				"kind": "R",
				"fromNode": "a",
				"toNode": "b",
				"value": 1
			},
			{
				"label": "Vx",
				"kind": "V",
				"fromNode": "b",
				"toNode": "c",
				"value": -6.5
			},
			{
				"label": "R5",
				"kind": "R",
				"fromNode": "c",
				"toNode": "d",
				"value": 1
			}
		],
		"unknownSpec": {
			"targetComponent": "Vx",
			"parameter": "voltage",
			"givenConstraint": {
				"metric": "power_supplied",
				"component": "V1",
				"value": 17.5
			}
		},
		"expected": {
			"Vx_V": -6.5,
			"P_V1_sup_check_W": 17.5,
			"nodeVoltages_at_sol_V": {
				"a": 5,
				"b": 5.25,
				"c": 11.75,
				"d": 12
			}
		}
	},
	{
		"id": "DC-36",
		"source": "Summer 2024 Quiz 2 Q2 (Quiz2_ALL_Solved.pdf p.11 - Unknown IA from Target Voltage)",
		"category": "unknown_param",
		"nodes": [
			"0",
			"X",
			"Y",
			"M"
		],
		"components": [
			{
				"label": "V1",
				"kind": "V",
				"fromNode": "Y",
				"toNode": "X",
				"value": 12
			},
			{
				"label": "R1",
				"kind": "R",
				"fromNode": "X",
				"toNode": "M",
				"value": 2
			},
			{
				"label": "R2",
				"kind": "R",
				"fromNode": "M",
				"toNode": "Y",
				"value": 2
			},
			{
				"label": "R3",
				"kind": "R",
				"fromNode": "X",
				"toNode": "0",
				"value": 2
			},
			{
				"label": "IA",
				"kind": "I",
				"fromNode": "0",
				"toNode": "M",
				"value": -2
			},
			{
				"label": "R4",
				"kind": "R",
				"fromNode": "Y",
				"toNode": "0",
				"value": 2
			}
		],
		"unknownSpec": {
			"targetComponent": "IA",
			"parameter": "current",
			"givenConstraint": {
				"metric": "node_voltage",
				"node": "Y",
				"value": 4
			}
		},
		"expected": {
			"IA_A": -2,
			"Vo_VY_check_V": 4,
			"nodeVoltages_at_sol_V": {
				"X": -8,
				"Y": 4,
				"M": -4
			},
			"I_R4_A": 2
		}
	}
];

const AC_POOL: AcPoolProblem[] = [
	{
		"id": "AC-01",
		"source": "Dr Khaled AC Slides Ex 9.9 (Page 72)",
		"category": "ac_rl_rc_rlc",
		"frequencyHz": 0.6366197723675814,
		"omegaRadPerSec": 4,
		"acMagnitudeMode": "peak",
		"nodes": [
			"0",
			"A",
			"B"
		],
		"components": [
			{
				"label": "Vs",
				"kind": "voltage_source",
				"fromNode": "A",
				"toNode": "0",
				"value": 10,
				"phaseDeg": 0
			},
			{
				"label": "R1",
				"kind": "resistor",
				"fromNode": "A",
				"toNode": "B",
				"value": 5
			},
			{
				"label": "C1",
				"kind": "capacitor",
				"fromNode": "B",
				"toNode": "0",
				"value": 0.1
			}
		],
		"expected": {
			"I_R1": {
				"mag": 1.7889,
				"deg": 26.57
			},
			"V_B": {
				"mag": 4.4721,
				"deg": -63.43
			},
			"P_source_delivered": 8,
			"Q_source_delivered": -4,
			"S_mag": 8.9443,
			"pf": 0.8944,
			"pfType": "leading"
		}
	},
	{
		"id": "AC-02",
		"source": "Dr Khaled AC Slides Ex 9.11 (Page 73)",
		"category": "ac_rl_rc_rlc",
		"frequencyHz": 0.6366197723675814,
		"omegaRadPerSec": 4,
		"acMagnitudeMode": "peak",
		"nodes": [
			"0",
			"A",
			"B"
		],
		"components": [
			{
				"label": "Vs",
				"kind": "voltage_source",
				"fromNode": "A",
				"toNode": "0",
				"value": 20,
				"phaseDeg": -15
			},
			{
				"label": "R1",
				"kind": "resistor",
				"fromNode": "A",
				"toNode": "B",
				"value": 60
			},
			{
				"label": "C1",
				"kind": "capacitor",
				"fromNode": "B",
				"toNode": "0",
				"value": 0.01
			},
			{
				"label": "L1",
				"kind": "inductor",
				"fromNode": "B",
				"toNode": "0",
				"value": 5
			}
		],
		"expected": {
			"V_B": {
				"mag": 17.1499,
				"deg": 15.96
			},
			"I_R1": {
				"mag": 0.1715,
				"deg": -74.04
			},
			"P_source_delivered": 0.8824,
			"Q_source_delivered": 1.4706,
			"S_mag": 1.715
		}
	},
	{
		"id": "AC-03",
		"source": "Sheet 5 Q4(a) (Pages 10, 16)",
		"category": "ac_rl_rc_rlc",
		"frequencyHz": 0.477464829275686,
		"omegaRadPerSec": 3,
		"acMagnitudeMode": "peak",
		"nodes": [
			"0",
			"A"
		],
		"components": [
			{
				"label": "Is",
				"kind": "current_source",
				"fromNode": "0",
				"toNode": "A",
				"value": 10,
				"phaseDeg": 45
			},
			{
				"label": "R1",
				"kind": "resistor",
				"fromNode": "A",
				"toNode": "0",
				"value": 4
			},
			{
				"label": "C1",
				"kind": "capacitor",
				"fromNode": "A",
				"toNode": "0",
				"value": 0.16666666666666666
			}
		],
		"expected": {
			"I_R1": {
				"mag": 4.4721,
				"deg": -18.43
			},
			"I_C1": {
				"mag": 8.9443,
				"deg": 71.57
			},
			"V_A": {
				"mag": 17.8885,
				"deg": -18.43
			}
		}
	},
	{
		"id": "AC-04",
		"source": "Sheet 5 Q4(b) (Pages 10, 17-18)",
		"category": "ac_rl_rc_rlc",
		"frequencyHz": 0.6366197723675814,
		"omegaRadPerSec": 4,
		"acMagnitudeMode": "peak",
		"nodes": [
			"0",
			"A",
			"B",
			"C"
		],
		"components": [
			{
				"label": "Vs",
				"kind": "voltage_source",
				"fromNode": "A",
				"toNode": "0",
				"value": 50,
				"phaseDeg": 0
			},
			{
				"label": "R1",
				"kind": "resistor",
				"fromNode": "A",
				"toNode": "B",
				"value": 4
			},
			{
				"label": "C1",
				"kind": "capacitor",
				"fromNode": "B",
				"toNode": "0",
				"value": 0.08333333333333333
			},
			{
				"label": "R2",
				"kind": "resistor",
				"fromNode": "A",
				"toNode": "C",
				"value": 8
			},
			{
				"label": "L1",
				"kind": "inductor",
				"fromNode": "C",
				"toNode": "0",
				"value": 3
			}
		],
		"expected": {
			"I_total": {
				"mag": 10.4006,
				"deg": 17.43
			},
			"I_R1": {
				"mag": 10,
				"deg": 36.87
			},
			"I_R2": {
				"mag": 3.4669,
				"deg": -56.31
			},
			"V_C": {
				"mag": 41.6025,
				"deg": 33.69
			}
		}
	},
	{
		"id": "AC-05",
		"source": "Fall 2025 Final Q2 (Subcase 1: vs = 50 sin(2t), ω = 2)",
		"category": "ac_rl_rc_rlc",
		"frequencyHz": 0.3183098861837907,
		"omegaRadPerSec": 2,
		"acMagnitudeMode": "peak",
		"nodes": [
			"0",
			"A",
			"B",
			"C"
		],
		"components": [
			{
				"label": "Vs",
				"kind": "voltage_source",
				"fromNode": "C",
				"toNode": "0",
				"value": 50,
				"phaseDeg": -90
			},
			{
				"label": "L1",
				"kind": "inductor",
				"fromNode": "C",
				"toNode": "B",
				"value": 5
			},
			{
				"label": "R1",
				"kind": "resistor",
				"fromNode": "B",
				"toNode": "A",
				"value": 20
			},
			{
				"label": "R2",
				"kind": "resistor",
				"fromNode": "A",
				"toNode": "0",
				"value": 16
			}
		],
		"expected": {
			"V_A": {
				"mag": 21.4115,
				"deg": -105.52
			},
			"I_R2": {
				"mag": 1.3382,
				"deg": -105.52
			}
		}
	},
	{
		"id": "AC-06",
		"source": "Fall 2025 Final Q2 (Subcase 2: is = 12 cos(6t + 10°), ω = 6)",
		"category": "ac_rl_rc_rlc",
		"frequencyHz": 0.954929658551372,
		"omegaRadPerSec": 6,
		"acMagnitudeMode": "peak",
		"nodes": [
			"0",
			"A",
			"B"
		],
		"components": [
			{
				"label": "Is",
				"kind": "current_source",
				"fromNode": "0",
				"toNode": "A",
				"value": 12,
				"phaseDeg": 10
			},
			{
				"label": "R2",
				"kind": "resistor",
				"fromNode": "A",
				"toNode": "0",
				"value": 16
			},
			{
				"label": "R1",
				"kind": "resistor",
				"fromNode": "A",
				"toNode": "B",
				"value": 20
			},
			{
				"label": "L1",
				"kind": "inductor",
				"fromNode": "B",
				"toNode": "0",
				"value": 5
			}
		],
		"expected": {
			"V_A": {
				"mag": 147.7259,
				"deg": 26.5
			},
			"I_R2": {
				"mag": 9.2329,
				"deg": 26.5
			},
			"I_L1": {
				"mag": 4.0972,
				"deg": -29.81
			}
		}
	},
	{
		"id": "AC-07",
		"source": "Sheet 5 Q5 (Pages 10, 19)",
		"category": "ac_direct_impedance",
		"frequencyHz": 60,
		"acMagnitudeMode": "peak",
		"nodes": [
			"0",
			"A",
			"B"
		],
		"components": [
			{
				"label": "Vs",
				"kind": "voltage_source",
				"fromNode": "A",
				"toNode": "0",
				"value": 40,
				"phaseDeg": 0
			},
			{
				"label": "R1",
				"kind": "resistor",
				"fromNode": "A",
				"toNode": "B",
				"value": 8
			},
			{
				"label": "L1",
				"kind": "inductor",
				"fromNode": "B",
				"toNode": "0",
				"value": 5,
				"impedanceMode": true,
				"reactanceOhm": 5
			},
			{
				"label": "C1",
				"kind": "capacitor",
				"fromNode": "B",
				"toNode": "0",
				"value": 10,
				"impedanceMode": true,
				"reactanceOhm": -10
			}
		],
		"expected": {
			"I_R1": {
				"mag": 3.1235,
				"deg": -51.34
			},
			"I_L1": {
				"mag": 6.247,
				"deg": -51.34
			},
			"I_C1": {
				"mag": 3.1235,
				"deg": 128.66
			}
		}
	},
	{
		"id": "AC-08",
		"source": "Sheet 5 Q6 (Pages 10, 20-21) — AC Bridge / Y-Delta",
		"category": "ac_direct_impedance",
		"frequencyHz": 60,
		"acMagnitudeMode": "rms",
		"nodes": [
			"0",
			"A",
			"B",
			"N"
		],
		"components": [
			{
				"label": "Vs",
				"kind": "voltage_source",
				"fromNode": "A",
				"toNode": "0",
				"value": 10,
				"phaseDeg": 0
			},
			{
				"label": "R2",
				"kind": "resistor",
				"fromNode": "N",
				"toNode": "A",
				"value": 2
			},
			{
				"label": "C1",
				"kind": "capacitor",
				"fromNode": "N",
				"toNode": "B",
				"value": 1,
				"impedanceMode": true,
				"reactanceOhm": -1
			},
			{
				"label": "L2",
				"kind": "inductor",
				"fromNode": "N",
				"toNode": "0",
				"value": 2,
				"impedanceMode": true,
				"reactanceOhm": 2
			},
			{
				"label": "L1",
				"kind": "inductor",
				"fromNode": "A",
				"toNode": "B",
				"value": 4,
				"impedanceMode": true,
				"reactanceOhm": 4
			},
			{
				"label": "R1",
				"kind": "resistor",
				"fromNode": "B",
				"toNode": "0",
				"value": 1
			},
			{
				"label": "C2",
				"kind": "capacitor",
				"fromNode": "A",
				"toNode": "0",
				"value": 2,
				"impedanceMode": true,
				"reactanceOhm": -2
			}
		],
		"expected": {
			"Zeq_rect": {
				"re": 1.0588,
				"im": -2.2353
			},
			"Zeq_polar": {
				"mag": 2.4734,
				"deg": -64.65
			},
			"I_source_out": {
				"mag": 4.043,
				"deg": 64.65
			}
		}
	},
	{
		"id": "AC-09",
		"source": "Dr Khaled AC Slides Ex 10.7 (Page 78) — AC Source Transformation",
		"category": "ac_direct_impedance",
		"frequencyHz": 60,
		"acMagnitudeMode": "peak",
		"nodes": [
			"0",
			"A",
			"B",
			"C",
			"D",
			"E"
		],
		"components": [
			{
				"label": "Vs",
				"kind": "voltage_source",
				"fromNode": "A",
				"toNode": "0",
				"value": 20,
				"phaseDeg": -90
			},
			{
				"label": "R1",
				"kind": "resistor",
				"fromNode": "A",
				"toNode": "B",
				"value": 5
			},
			{
				"label": "R2",
				"kind": "resistor",
				"fromNode": "B",
				"toNode": "C",
				"value": 3
			},
			{
				"label": "L1",
				"kind": "inductor",
				"fromNode": "C",
				"toNode": "0",
				"value": 4,
				"impedanceMode": true,
				"reactanceOhm": 4
			},
			{
				"label": "R3",
				"kind": "resistor",
				"fromNode": "B",
				"toNode": "D",
				"value": 4
			},
			{
				"label": "C1",
				"kind": "capacitor",
				"fromNode": "D",
				"toNode": "E",
				"value": 13,
				"impedanceMode": true,
				"reactanceOhm": -13
			},
			{
				"label": "RL",
				"kind": "resistor",
				"fromNode": "E",
				"toNode": "0",
				"value": 10
			}
		],
		"expected": {
			"V_E": {
				"mag": 5.5195,
				"deg": -27.98
			}
		}
	},
	{
		"id": "AC-10",
		"source": "Sheet 6 Q4 (Pages 26, 35-36) — AC Source Transformation",
		"category": "ac_direct_impedance",
		"frequencyHz": 60,
		"acMagnitudeMode": "peak",
		"nodes": [
			"0",
			"A",
			"B",
			"C",
			"D",
			"E"
		],
		"components": [
			{
				"label": "Is",
				"kind": "current_source",
				"fromNode": "0",
				"toNode": "A",
				"value": 4,
				"phaseDeg": 90
			},
			{
				"label": "R1",
				"kind": "resistor",
				"fromNode": "A",
				"toNode": "B",
				"value": 4
			},
			{
				"label": "C1",
				"kind": "capacitor",
				"fromNode": "B",
				"toNode": "0",
				"value": 3,
				"impedanceMode": true,
				"reactanceOhm": -3
			},
			{
				"label": "R2",
				"kind": "resistor",
				"fromNode": "A",
				"toNode": "C",
				"value": 2
			},
			{
				"label": "L1",
				"kind": "inductor",
				"fromNode": "C",
				"toNode": "D",
				"value": 1,
				"impedanceMode": true,
				"reactanceOhm": 1
			},
			{
				"label": "L2",
				"kind": "inductor",
				"fromNode": "D",
				"toNode": "0",
				"value": 5,
				"impedanceMode": true,
				"reactanceOhm": 5
			},
			{
				"label": "R3",
				"kind": "resistor",
				"fromNode": "D",
				"toNode": "E",
				"value": 1
			},
			{
				"label": "C2",
				"kind": "capacitor",
				"fromNode": "E",
				"toNode": "0",
				"value": 2,
				"impedanceMode": true,
				"reactanceOhm": -2
			}
		],
		"expected": {
			"I_R3": {
				"mag": 3.288,
				"deg": 99.46
			}
		}
	},
	{
		"id": "AC-11",
		"source": "Sheet 6 Q1 (Pages 25, 27-28) & Quiz2_AC_Part.pdf Page 1",
		"category": "ac_nodal",
		"frequencyHz": 60,
		"acMagnitudeMode": "peak",
		"nodes": [
			"0",
			"S",
			"V1",
			"V2"
		],
		"components": [
			{
				"label": "Vs1",
				"kind": "voltage_source",
				"fromNode": "S",
				"toNode": "0",
				"value": 15,
				"phaseDeg": 0
			},
			{
				"label": "R1",
				"kind": "resistor",
				"fromNode": "S",
				"toNode": "V1",
				"value": 4
			},
			{
				"label": "L1",
				"kind": "inductor",
				"fromNode": "V1",
				"toNode": "0",
				"value": 4,
				"impedanceMode": true,
				"reactanceOhm": 4
			},
			{
				"label": "Vs2",
				"kind": "voltage_source",
				"fromNode": "V1",
				"toNode": "V2",
				"value": 20,
				"phaseDeg": 60
			},
			{
				"label": "C1",
				"kind": "capacitor",
				"fromNode": "V2",
				"toNode": "0",
				"value": 1,
				"impedanceMode": true,
				"reactanceOhm": -1
			},
			{
				"label": "R2",
				"kind": "resistor",
				"fromNode": "V2",
				"toNode": "0",
				"value": 2
			}
		],
		"expected": {
			"V1": {
				"mag": 19.36,
				"deg": 69.67
			},
			"V2": {
				"mag": 3.3779,
				"deg": 165.72
			}
		}
	},
	{
		"id": "AC-12",
		"source": "Dr Khaled AC Slides Ex 10.2 (Page 74)",
		"category": "ac_nodal",
		"frequencyHz": 60,
		"acMagnitudeMode": "peak",
		"nodes": [
			"0",
			"V1",
			"V2"
		],
		"components": [
			{
				"label": "Is",
				"kind": "current_source",
				"fromNode": "0",
				"toNode": "V1",
				"value": 3,
				"phaseDeg": 0
			},
			{
				"label": "C1",
				"kind": "capacitor",
				"fromNode": "V1",
				"toNode": "0",
				"value": 3,
				"impedanceMode": true,
				"reactanceOhm": -3
			},
			{
				"label": "Vs",
				"kind": "voltage_source",
				"fromNode": "V1",
				"toNode": "V2",
				"value": 10,
				"phaseDeg": 45
			},
			{
				"label": "R1",
				"kind": "resistor",
				"fromNode": "V1",
				"toNode": "V2",
				"value": 4
			},
			{
				"label": "L1",
				"kind": "inductor",
				"fromNode": "V2",
				"toNode": "0",
				"value": 6,
				"impedanceMode": true,
				"reactanceOhm": 6
			},
			{
				"label": "R2",
				"kind": "resistor",
				"fromNode": "V2",
				"toNode": "0",
				"value": 12
			}
		],
		"expected": {
			"V1": {
				"mag": 25.7812,
				"deg": -70.48
			},
			"V2": {
				"mag": 31.4085,
				"deg": -87.18
			}
		}
	},
	{
		"id": "AC-13",
		"source": "Quiz2_AC_Part.pdf Page 6 (Problem 8.58 — Forward Verification)",
		"category": "ac_nodal",
		"frequencyHz": 60,
		"acMagnitudeMode": "rms",
		"nodes": [
			"0",
			"S",
			"V1",
			"M",
			"Vo"
		],
		"components": [
			{
				"label": "Vs",
				"kind": "voltage_source",
				"fromNode": "S",
				"toNode": "0",
				"value": 12,
				"phaseDeg": 0
			},
			{
				"label": "R1",
				"kind": "resistor",
				"fromNode": "S",
				"toNode": "V1",
				"value": 2
			},
			{
				"label": "RZ",
				"kind": "resistor",
				"fromNode": "V1",
				"toNode": "M",
				"value": 0.239121
			},
			{
				"label": "LZ",
				"kind": "inductor",
				"fromNode": "M",
				"toNode": "0",
				"value": 1.97099,
				"impedanceMode": true,
				"reactanceOhm": 1.97099
			},
			{
				"label": "C1",
				"kind": "capacitor",
				"fromNode": "V1",
				"toNode": "Vo",
				"value": 1,
				"impedanceMode": true,
				"reactanceOhm": -1
			},
			{
				"label": "R2",
				"kind": "resistor",
				"fromNode": "Vo",
				"toNode": "0",
				"value": 1
			}
		],
		"expected": {
			"V1": {
				"mag": 5.6569,
				"deg": 0
			},
			"Vo": {
				"mag": 4,
				"deg": 45
			}
		}
	},
	{
		"id": "AC-14",
		"source": "Sheet 6 Q2 (Pages 25, 29-31 — Sadiku Fig. 10.8)",
		"category": "ac_mesh",
		"frequencyHz": 60,
		"acMagnitudeMode": "peak",
		"nodes": [
			"0",
			"A",
			"B",
			"C"
		],
		"components": [
			{
				"label": "C1",
				"kind": "capacitor",
				"fromNode": "0",
				"toNode": "B",
				"value": 2,
				"impedanceMode": true,
				"reactanceOhm": -2
			},
			{
				"label": "R1",
				"kind": "resistor",
				"fromNode": "B",
				"toNode": "A",
				"value": 8
			},
			{
				"label": "L1",
				"kind": "inductor",
				"fromNode": "A",
				"toNode": "0",
				"value": 4,
				"impedanceMode": true,
				"reactanceOhm": 4
			},
			{
				"label": "R2",
				"kind": "resistor",
				"fromNode": "A",
				"toNode": "C",
				"value": 6
			},
			{
				"label": "Vs",
				"kind": "voltage_source",
				"fromNode": "C",
				"toNode": "0",
				"value": 10,
				"phaseDeg": 30
			},
			{
				"label": "Is",
				"kind": "current_source",
				"fromNode": "C",
				"toNode": "A",
				"value": 2,
				"phaseDeg": 0
			}
		],
		"expected": {
			"I1": {
				"mag": 1.1939,
				"deg": -114.55
			},
			"I2": {
				"mag": 2.4613,
				"deg": 169.48
			},
			"Io": {
				"mag": 1.1939,
				"deg": 65.45
			}
		}
	},
	{
		"id": "AC-15",
		"source": "Sheet 6 Q3 & Dr Khaled AC Slides Ex 10.4 (Page 75 — Sadiku Fig. 10.9)",
		"category": "ac_mesh",
		"frequencyHz": 60,
		"acMagnitudeMode": "peak",
		"nodes": [
			"0",
			"N1",
			"N2",
			"N3",
			"N4"
		],
		"components": [
			{
				"label": "Vs",
				"kind": "voltage_source",
				"fromNode": "N1",
				"toNode": "0",
				"value": 10,
				"phaseDeg": 0
			},
			{
				"label": "R1",
				"kind": "resistor",
				"fromNode": "N1",
				"toNode": "N2",
				"value": 8
			},
			{
				"label": "C1",
				"kind": "capacitor",
				"fromNode": "N2",
				"toNode": "0",
				"value": 2,
				"impedanceMode": true,
				"reactanceOhm": -2
			},
			{
				"label": "C2",
				"kind": "capacitor",
				"fromNode": "N1",
				"toNode": "N4",
				"value": 4,
				"impedanceMode": true,
				"reactanceOhm": -4
			},
			{
				"label": "Is1",
				"kind": "current_source",
				"fromNode": "N2",
				"toNode": "N4",
				"value": 4,
				"phaseDeg": 0
			},
			{
				"label": "R2",
				"kind": "resistor",
				"fromNode": "N4",
				"toNode": "N3",
				"value": 6
			},
			{
				"label": "L1",
				"kind": "inductor",
				"fromNode": "N3",
				"toNode": "N2",
				"value": 5,
				"impedanceMode": true,
				"reactanceOhm": 5
			},
			{
				"label": "Is2",
				"kind": "current_source",
				"fromNode": "0",
				"toNode": "N3",
				"value": 3,
				"phaseDeg": 0
			}
		],
		"expected": {
			"I1": {
				"mag": 3.618,
				"deg": -85.52
			},
			"Vo": {
				"mag": 9.7542,
				"deg": -137.69
			}
		}
	},
	{
		"id": "AC-16",
		"source": "Sheet 6 Q7 (Pages 26, 43-45)",
		"category": "ac_mesh",
		"frequencyHz": 60,
		"acMagnitudeMode": "peak",
		"nodes": [
			"0",
			"A",
			"B",
			"C",
			"D"
		],
		"components": [
			{
				"label": "R1",
				"kind": "resistor",
				"fromNode": "0",
				"toNode": "A",
				"value": 8
			},
			{
				"label": "L1",
				"kind": "inductor",
				"fromNode": "A",
				"toNode": "B",
				"value": 10,
				"impedanceMode": true,
				"reactanceOhm": 10
			},
			{
				"label": "C1",
				"kind": "capacitor",
				"fromNode": "B",
				"toNode": "0",
				"value": 2,
				"impedanceMode": true,
				"reactanceOhm": -2
			},
			{
				"label": "C2",
				"kind": "capacitor",
				"fromNode": "B",
				"toNode": "C",
				"value": 2,
				"impedanceMode": true,
				"reactanceOhm": -2
			},
			{
				"label": "R2",
				"kind": "resistor",
				"fromNode": "C",
				"toNode": "D",
				"value": 4
			},
			{
				"label": "Vs",
				"kind": "voltage_source",
				"fromNode": "D",
				"toNode": "0",
				"value": 20,
				"phaseDeg": 90
			},
			{
				"label": "Is",
				"kind": "current_source",
				"fromNode": "A",
				"toNode": "C",
				"value": 5,
				"phaseDeg": 0
			}
		],
		"expected": {
			"I1": {
				"mag": 3.5902,
				"deg": 55.01
			},
			"I2": {
				"mag": 6.1202,
				"deg": -35.22
			},
			"Io": {
				"mag": 6.1202,
				"deg": 144.78
			}
		}
	},
	{
		"id": "AC-17",
		"source": "Quiz2_AC_Part.pdf Page 3 (2nd AC Quiz Q4)",
		"category": "ac_mesh",
		"frequencyHz": 60,
		"acMagnitudeMode": "peak",
		"nodes": [
			"0",
			"S",
			"A",
			"B"
		],
		"components": [
			{
				"label": "Vs",
				"kind": "voltage_source",
				"fromNode": "S",
				"toNode": "0",
				"value": 12,
				"phaseDeg": 0
			},
			{
				"label": "R1",
				"kind": "resistor",
				"fromNode": "S",
				"toNode": "A",
				"value": 4
			},
			{
				"label": "C1",
				"kind": "capacitor",
				"fromNode": "A",
				"toNode": "B",
				"value": 4,
				"impedanceMode": true,
				"reactanceOhm": -4
			},
			{
				"label": "R2",
				"kind": "resistor",
				"fromNode": "B",
				"toNode": "0",
				"value": 2
			},
			{
				"label": "Is",
				"kind": "current_source",
				"fromNode": "0",
				"toNode": "A",
				"value": 4,
				"phaseDeg": 90
			}
		],
		"expected": {
			"I1": {
				"mag": 1.2403,
				"deg": -82.87
			},
			"Vo": {
				"mag": 5.547,
				"deg": 86.82
			}
		}
	},
	{
		"id": "AC-18",
		"source": "Sheet 6 Q5 & Dr Khaled AC Slides Ex 10.6 (Pages 76-77, Subcase ω = 5, 2 sin 5t)",
		"category": "ac_superposition",
		"frequencyHz": 0.7957747154594768,
		"omegaRadPerSec": 5,
		"acMagnitudeMode": "peak",
		"nodes": [
			"0",
			"A",
			"B"
		],
		"components": [
			{
				"label": "Is",
				"kind": "current_source",
				"fromNode": "0",
				"toNode": "A",
				"value": 2,
				"phaseDeg": -90
			},
			{
				"label": "L1",
				"kind": "inductor",
				"fromNode": "A",
				"toNode": "0",
				"value": 2
			},
			{
				"label": "R1",
				"kind": "resistor",
				"fromNode": "A",
				"toNode": "B",
				"value": 1
			},
			{
				"label": "C1",
				"kind": "capacitor",
				"fromNode": "B",
				"toNode": "0",
				"value": 0.1
			},
			{
				"label": "R2",
				"kind": "resistor",
				"fromNode": "B",
				"toNode": "0",
				"value": 4
			}
		],
		"expected": {
			"V_R1": {
				"mag": 2.3281,
				"deg": -77.91
			},
			"I_R1": {
				"mag": 2.3281,
				"deg": -77.91
			}
		}
	},
	{
		"id": "AC-19",
		"source": "Adapted from Sheet 5 Q1(a) — Same-Frequency AC Superposition (cos + sin at ω = 4)",
		"category": "ac_superposition",
		"frequencyHz": 0.6366197723675814,
		"omegaRadPerSec": 4,
		"acMagnitudeMode": "peak",
		"nodes": [
			"0",
			"S",
			"A",
			"B"
		],
		"components": [
			{
				"label": "Vs",
				"kind": "voltage_source",
				"fromNode": "S",
				"toNode": "0",
				"value": 10,
				"phaseDeg": -60
			},
			{
				"label": "R1",
				"kind": "resistor",
				"fromNode": "S",
				"toNode": "A",
				"value": 4
			},
			{
				"label": "C1",
				"kind": "capacitor",
				"fromNode": "A",
				"toNode": "0",
				"value": 0.125
			},
			{
				"label": "L1",
				"kind": "inductor",
				"fromNode": "A",
				"toNode": "B",
				"value": 0.5
			},
			{
				"label": "R2",
				"kind": "resistor",
				"fromNode": "B",
				"toNode": "0",
				"value": 4
			},
			{
				"label": "Is",
				"kind": "current_source",
				"fromNode": "0",
				"toNode": "B",
				"value": 4,
				"phaseDeg": -40
			}
		],
		"expected": {
			"V_B_total": {
				"mag": 3.8824,
				"deg": -82.22
			},
			"V_A_total": {
				"mag": 10.0785,
				"deg": -105.5
			}
		}
	},
	{
		"id": "AC-20",
		"source": "Adapted from Sheet 5 Q1(b) — Same-Frequency Superposition with Negative Cosine (-20 cos 377t)",
		"category": "ac_superposition",
		"frequencyHz": 60,
		"acMagnitudeMode": "peak",
		"nodes": [
			"0",
			"S1",
			"A",
			"B",
			"S2"
		],
		"components": [
			{
				"label": "Vs1",
				"kind": "voltage_source",
				"fromNode": "S1",
				"toNode": "0",
				"value": 4,
				"phaseDeg": 10
			},
			{
				"label": "R1",
				"kind": "resistor",
				"fromNode": "S1",
				"toNode": "A",
				"value": 4
			},
			{
				"label": "C1",
				"kind": "capacitor",
				"fromNode": "A",
				"toNode": "0",
				"value": 5,
				"impedanceMode": true,
				"reactanceOhm": -5
			},
			{
				"label": "R2",
				"kind": "resistor",
				"fromNode": "A",
				"toNode": "B",
				"value": 3
			},
			{
				"label": "L1",
				"kind": "inductor",
				"fromNode": "B",
				"toNode": "S2",
				"value": 4,
				"impedanceMode": true,
				"reactanceOhm": 4
			},
			{
				"label": "Vs2",
				"kind": "voltage_source",
				"fromNode": "S2",
				"toNode": "0",
				"value": 20,
				"phaseDeg": 180
			}
		],
		"expected": {
			"V_A_total": {
				"mag": 9.8304,
				"deg": 106.59
			},
			"I_C1": {
				"mag": 1.9661,
				"deg": -163.41
			}
		}
	},
	{
		"id": "AC-21",
		"source": "Final_Spring2026_EPM214s.pdf Q2 & Final_Spring2026_key.pdf Pages 1-2",
		"category": "ac_thevenin_max_power",
		"frequencyHz": 60,
		"acMagnitudeMode": "rms",
		"nodes": [
			"0",
			"X",
			"A",
			"N1",
			"M",
			"N2"
		],
		"components": [
			{
				"label": "Vs",
				"kind": "voltage_source",
				"fromNode": "X",
				"toNode": "0",
				"value": 40,
				"phaseDeg": 90
			},
			{
				"label": "R1",
				"kind": "resistor",
				"fromNode": "X",
				"toNode": "A",
				"value": 5
			},
			{
				"label": "R2",
				"kind": "resistor",
				"fromNode": "X",
				"toNode": "N1",
				"value": 8
			},
			{
				"label": "C1",
				"kind": "capacitor",
				"fromNode": "N1",
				"toNode": "M",
				"value": 2,
				"impedanceMode": true,
				"reactanceOhm": -2
			},
			{
				"label": "Is",
				"kind": "current_source",
				"fromNode": "M",
				"toNode": "A",
				"value": 3,
				"phaseDeg": 0
			},
			{
				"label": "R3",
				"kind": "resistor",
				"fromNode": "M",
				"toNode": "N2",
				"value": 10
			},
			{
				"label": "L1",
				"kind": "inductor",
				"fromNode": "N2",
				"toNode": "0",
				"value": 4,
				"impedanceMode": true,
				"reactanceOhm": 4
			},
			{
				"label": "ZL",
				"kind": "inductor",
				"fromNode": "A",
				"toNode": "0",
				"value": "20+j15",
				"impedanceMode": true,
				"resistanceOhm": 20,
				"reactanceOhm": 15
			}
		],
		"theveninTarget": "ZL",
		"expected": {
			"I_N": {
				"mag": 8.544,
				"deg": 69.44,
				"re": 3,
				"im": 8
			},
			"Z_th": {
				"re": 5,
				"im": 0,
				"mag": 5,
				"deg": 0
			},
			"V_th": {
				"mag": 42.72,
				"deg": 69.44,
				"re": 15,
				"im": 40
			},
			"I_ZL": {
				"mag": 1.4653,
				"deg": 38.48
			}
		}
	},
	{
		"id": "AC-22",
		"source": "Dr Khaled AC Slides Ex 10.8 (Pages 79-80) — AC Bridge Thévenin & RMS Max Power",
		"category": "ac_thevenin_max_power",
		"frequencyHz": 60,
		"acMagnitudeMode": "rms",
		"nodes": [
			"0",
			"S",
			"A",
			"B"
		],
		"components": [
			{
				"label": "Vs",
				"kind": "voltage_source",
				"fromNode": "S",
				"toNode": "0",
				"value": 120,
				"phaseDeg": 75
			},
			{
				"label": "R1",
				"kind": "resistor",
				"fromNode": "S",
				"toNode": "A",
				"value": 8
			},
			{
				"label": "C1",
				"kind": "capacitor",
				"fromNode": "A",
				"toNode": "0",
				"value": 6,
				"impedanceMode": true,
				"reactanceOhm": -6
			},
			{
				"label": "L1",
				"kind": "inductor",
				"fromNode": "S",
				"toNode": "B",
				"value": 12,
				"impedanceMode": true,
				"reactanceOhm": 12
			},
			{
				"label": "R2",
				"kind": "resistor",
				"fromNode": "B",
				"toNode": "0",
				"value": 4
			},
			{
				"label": "ZL",
				"kind": "resistor",
				"fromNode": "B",
				"toNode": "A",
				"value": 10
			}
		],
		"theveninTarget": "ZL",
		"expected": {
			"V_th": {
				"mag": 37.9473,
				"deg": -139.7,
				"re": -28.9392,
				"im": -24.5464
			},
			"Z_th": {
				"re": 6.48,
				"im": -2.64,
				"mag": 6.9971,
				"deg": -22.17
			},
			"Z_L_opt": {
				"re": 6.48,
				"im": 2.64
			},
			"P_max_rms": 55.5556,
			"I_ZL": {
				"mag": 2.2736,
				"deg": -130.59
			}
		}
	},
	{
		"id": "AC-23",
		"source": "Dr Khaled AC Slides Ex 11.5 (Page 84) — Peak Maximum Average Power Transfer",
		"category": "ac_thevenin_max_power",
		"frequencyHz": 60,
		"acMagnitudeMode": "peak",
		"nodes": [
			"0",
			"S",
			"A",
			"B",
			"T"
		],
		"components": [
			{
				"label": "Vs",
				"kind": "voltage_source",
				"fromNode": "S",
				"toNode": "0",
				"value": 10,
				"phaseDeg": 0
			},
			{
				"label": "R1",
				"kind": "resistor",
				"fromNode": "S",
				"toNode": "A",
				"value": 4
			},
			{
				"label": "R2",
				"kind": "resistor",
				"fromNode": "A",
				"toNode": "B",
				"value": 8
			},
			{
				"label": "C1",
				"kind": "capacitor",
				"fromNode": "B",
				"toNode": "0",
				"value": 6,
				"impedanceMode": true,
				"reactanceOhm": -6
			},
			{
				"label": "L1",
				"kind": "inductor",
				"fromNode": "A",
				"toNode": "T",
				"value": 5,
				"impedanceMode": true,
				"reactanceOhm": 5
			},
			{
				"label": "ZL",
				"kind": "capacitor",
				"fromNode": "T",
				"toNode": "0",
				"value": "2.933333-j4.466667",
				"impedanceMode": true,
				"resistanceOhm": 2.9333333333,
				"reactanceOhm": -4.4666666667
			}
		],
		"theveninTarget": "ZL",
		"expected": {
			"V_th": {
				"mag": 7.4536,
				"deg": -10.3,
				"re": 7.3333,
				"im": -1.3333
			},
			"Z_th": {
				"re": 2.9333,
				"im": 4.4667,
				"mag": 5.3437,
				"deg": 56.71
			},
			"Z_L_opt": {
				"re": 2.9333,
				"im": -4.4667
			},
			"P_max_peak": 2.3674,
			"P_ZL": 2.3674
		}
	},
	{
		"id": "AC-24",
		"source": "Alexander & Sadiku Ch. 10 (EPM214s Textbook) — AC Nodal with CCCS",
		"category": "ac_dependent_source",
		"frequencyHz": 0.6366197723675814,
		"omegaRadPerSec": 4,
		"acMagnitudeMode": "peak",
		"nodes": [
			"0",
			"S",
			"A",
			"B"
		],
		"components": [
			{
				"label": "Vs",
				"kind": "voltage_source",
				"fromNode": "S",
				"toNode": "0",
				"value": 20,
				"phaseDeg": 0
			},
			{
				"label": "R1",
				"kind": "resistor",
				"fromNode": "S",
				"toNode": "A",
				"value": 10
			},
			{
				"label": "C1",
				"kind": "capacitor",
				"fromNode": "A",
				"toNode": "0",
				"value": 0.1
			},
			{
				"label": "L1",
				"kind": "inductor",
				"fromNode": "A",
				"toNode": "B",
				"value": 0.5
			},
			{
				"label": "F1",
				"kind": "cccs",
				"fromNode": "0",
				"toNode": "B",
				"value": 2,
				"dependentSpec": {
					"controlBranchLabel": "C1",
					"gain": 2,
					"controlVarName": "Ix"
				}
			},
			{
				"label": "R2",
				"kind": "resistor",
				"fromNode": "B",
				"toNode": "0",
				"value": 5
			}
		],
		"expected": {
			"V_A": {
				"mag": 5.5767,
				"deg": 90.55
			},
			"V_B": {
				"mag": 3.1067,
				"deg": -111.25
			},
			"I_C1": {
				"mag": 2.2307,
				"deg": -179.45
			}
		}
	},
	{
		"id": "AC-25",
		"source": "Alexander & Sadiku Ch. 10 (EPM214s Textbook) — AC VCVS & Thévenin with Dependent Source",
		"category": "ac_dependent_source",
		"frequencyHz": 60,
		"acMagnitudeMode": "rms",
		"nodes": [
			"0",
			"A",
			"B",
			"C"
		],
		"components": [
			{
				"label": "Is",
				"kind": "current_source",
				"fromNode": "0",
				"toNode": "A",
				"value": 5,
				"phaseDeg": 0
			},
			{
				"label": "R1",
				"kind": "resistor",
				"fromNode": "A",
				"toNode": "0",
				"value": 2
			},
			{
				"label": "L1",
				"kind": "inductor",
				"fromNode": "A",
				"toNode": "B",
				"value": 4,
				"impedanceMode": true,
				"reactanceOhm": 4
			},
			{
				"label": "E1",
				"kind": "vcvs",
				"fromNode": "C",
				"toNode": "0",
				"value": 1.5,
				"dependentSpec": {
					"controlNodePos": "A",
					"controlNodeNeg": "0",
					"gain": 1.5,
					"controlVarName": "Vx"
				}
			},
			{
				"label": "R2",
				"kind": "resistor",
				"fromNode": "B",
				"toNode": "C",
				"value": 4
			},
			{
				"label": "ZL",
				"kind": "resistor",
				"fromNode": "B",
				"toNode": "0",
				"value": 10
			}
		],
		"theveninTarget": "ZL",
		"expected": {
			"V_A": {
				"mag": 10.1689,
				"deg": -1.38
			},
			"V_B": {
				"mag": 10.6554,
				"deg": 0.47
			},
			"I_ZL": {
				"mag": 1.0655,
				"deg": 0.47
			},
			"V_th": {
				"mag": 14.4222,
				"deg": 3.18,
				"re": 14.4,
				"im": 0.8
			},
			"I_N": {
				"mag": 4.0311,
				"deg": -7.13,
				"re": 4,
				"im": -0.5
			},
			"Z_th": {
				"re": 3.52,
				"im": 0.64,
				"mag": 3.5777,
				"deg": 10.3
			},
			"Z_L_opt": {
				"re": 3.52,
				"im": -0.64
			},
			"P_max_rms": 14.7727
		}
	},
	{
		"id": "AC-26",
		"source": "Alexander & Sadiku Ch. 10 (EPM214s Textbook) — AC VCCS + CCVS Phasor Network",
		"category": "ac_dependent_source",
		"frequencyHz": 60,
		"acMagnitudeMode": "rms",
		"nodes": [
			"0",
			"S",
			"A",
			"B",
			"C"
		],
		"components": [
			{
				"label": "Vs",
				"kind": "voltage_source",
				"fromNode": "S",
				"toNode": "0",
				"value": 10,
				"phaseDeg": 30
			},
			{
				"label": "R1",
				"kind": "resistor",
				"fromNode": "S",
				"toNode": "A",
				"value": 4
			},
			{
				"label": "L1",
				"kind": "inductor",
				"fromNode": "A",
				"toNode": "0",
				"value": 3,
				"impedanceMode": true,
				"reactanceOhm": 3
			},
			{
				"label": "G1",
				"kind": "vccs",
				"fromNode": "0",
				"toNode": "B",
				"value": 0.5,
				"dependentSpec": {
					"controlNodePos": "A",
					"controlNodeNeg": "0",
					"gain": 0.5,
					"controlVarName": "Vx"
				}
			},
			{
				"label": "R2",
				"kind": "resistor",
				"fromNode": "B",
				"toNode": "0",
				"value": 10
			},
			{
				"label": "H1",
				"kind": "ccvs",
				"fromNode": "C",
				"toNode": "B",
				"value": 4,
				"dependentSpec": {
					"controlBranchLabel": "L1",
					"gain": 4,
					"controlVarName": "Ix"
				}
			},
			{
				"label": "C1",
				"kind": "capacitor",
				"fromNode": "C",
				"toNode": "0",
				"value": 5,
				"impedanceMode": true,
				"reactanceOhm": -5
			}
		],
		"expected": {
			"V_A": {
				"mag": 6,
				"deg": 83.13
			},
			"I_L1": {
				"mag": 2,
				"deg": -6.87
			},
			"V_B": {
				"mag": 6.261,
				"deg": 19.7
			},
			"V_C": {
				"mag": 13.8852,
				"deg": 4.76
			},
			"I_C1": {
				"mag": 2.777,
				"deg": 94.76
			}
		}
	},
	{
		"id": "AC-27",
		"source": "Dr Khaled AC Slides Ex 11.1 / Sadiku Ex 11.11 (Page 91) — Peak Mode Leading PF",
		"category": "ac_power_pf",
		"frequencyHz": 60,
		"acMagnitudeMode": "peak",
		"nodes": [
			"0",
			"A",
			"B"
		],
		"components": [
			{
				"label": "Vs",
				"kind": "voltage_source",
				"fromNode": "A",
				"toNode": "0",
				"value": 60,
				"phaseDeg": -10
			},
			{
				"label": "R1",
				"kind": "resistor",
				"fromNode": "A",
				"toNode": "B",
				"value": 20
			},
			{
				"label": "C1",
				"kind": "capacitor",
				"fromNode": "B",
				"toNode": "0",
				"value": 34.641016,
				"impedanceMode": true,
				"reactanceOhm": -34.641016
			}
		],
		"expected": {
			"I_R1": {
				"mag": 1.5,
				"deg": 50
			},
			"P": 22.5,
			"Q": -38.9711,
			"S_mag": 45,
			"pf": 0.5,
			"pfType": "leading"
		}
	},
	{
		"id": "AC-28",
		"source": "Sheet 7 Q5 & Dr Khaled AC Slides Ex 11.14 (Pages 93-94) — RMS Parallel Loads",
		"category": "ac_power_pf",
		"frequencyHz": 60,
		"acMagnitudeMode": "rms",
		"nodes": [
			"0",
			"A",
			"B",
			"C"
		],
		"components": [
			{
				"label": "Vs",
				"kind": "voltage_source",
				"fromNode": "A",
				"toNode": "0",
				"value": 120,
				"phaseDeg": 10
			},
			{
				"label": "R1",
				"kind": "resistor",
				"fromNode": "A",
				"toNode": "B",
				"value": 51.961524
			},
			{
				"label": "C1",
				"kind": "capacitor",
				"fromNode": "B",
				"toNode": "0",
				"value": 30,
				"impedanceMode": true,
				"reactanceOhm": -30
			},
			{
				"label": "R2",
				"kind": "resistor",
				"fromNode": "A",
				"toNode": "C",
				"value": 28.284271
			},
			{
				"label": "L2",
				"kind": "inductor",
				"fromNode": "C",
				"toNode": "0",
				"value": 28.284271,
				"impedanceMode": true,
				"reactanceOhm": 28.284271
			}
		],
		"expected": {
			"I1": {
				"mag": 2,
				"deg": 40
			},
			"I2": {
				"mag": 3,
				"deg": -35
			},
			"I_total": {
				"mag": 4.0132,
				"deg": -6.22
			},
			"P": 462.4045,
			"Q": 134.5584,
			"S_mag": 481.5848,
			"pf": 0.9602,
			"pfType": "lagging"
		}
	},
	{
		"id": "AC-29",
		"source": "Sheet 7 Q1 (Pages 5, 7-8) — RMS Transmission Line + Inductive Load",
		"category": "ac_power_pf",
		"frequencyHz": 50,
		"acMagnitudeMode": "rms",
		"nodes": [
			"0",
			"S",
			"M",
			"L",
			"N"
		],
		"components": [
			{
				"label": "Vs",
				"kind": "voltage_source",
				"fromNode": "S",
				"toNode": "0",
				"value": 241.5342,
				"phaseDeg": 1.9423
			},
			{
				"label": "R_line",
				"kind": "resistor",
				"fromNode": "S",
				"toNode": "M",
				"value": 0.08
			},
			{
				"label": "L_line",
				"kind": "inductor",
				"fromNode": "M",
				"toNode": "L",
				"value": 0.25,
				"impedanceMode": true,
				"reactanceOhm": 0.25
			},
			{
				"label": "R_load",
				"kind": "resistor",
				"fromNode": "L",
				"toNode": "N",
				"value": 1.575521
			},
			{
				"label": "L_load",
				"kind": "inductor",
				"fromNode": "N",
				"toNode": "0",
				"value": 1.967825,
				"impedanceMode": true,
				"reactanceOhm": 1.967825
			}
		],
		"expected": {
			"V_L": {
				"mag": 220,
				"deg": 0
			},
			"I_line": {
				"mag": 87.2727,
				"deg": -51.32
			},
			"P_load": 12000,
			"Q_load": 14988,
			"S_load_mag": 19200,
			"pf_load": 0.625,
			"P_source": 12609.32,
			"Q_source": 16892.12,
			"S_source_mag": 21079.35,
			"pf_source": 0.5982,
			"pfType": "lagging"
		}
	},
	{
		"id": "AC-30",
		"source": "Dr Khaled AC Slides Ex 11.15 (Page 97) — Power Factor Correction (0.8 -> 0.95 lag)",
		"category": "ac_pf_correction",
		"frequencyHz": 60,
		"acMagnitudeMode": "rms",
		"nodes": [
			"0",
			"A",
			"B"
		],
		"components": [
			{
				"label": "Vs",
				"kind": "voltage_source",
				"fromNode": "A",
				"toNode": "0",
				"value": 120,
				"phaseDeg": 0
			},
			{
				"label": "R_load",
				"kind": "resistor",
				"fromNode": "A",
				"toNode": "B",
				"value": 2.304
			},
			{
				"label": "L_load",
				"kind": "inductor",
				"fromNode": "B",
				"toNode": "0",
				"value": 0.0045836624
			},
			{
				"label": "C_pf",
				"kind": "capacitor",
				"fromNode": "A",
				"toNode": "0",
				"value": 0.0003105
			}
		],
		"expected": {
			"before_C_pf": {
				"P": 4000,
				"Q": 3000,
				"S_mag": 5000,
				"pf": 0.8,
				"pfType": "lagging"
			},
			"after_C_pf": {
				"P": 4000,
				"Q": 1314.4,
				"Q_C": -1685.6,
				"S_mag": 4210.42,
				"pf": 0.95,
				"pfType": "lagging"
			}
		}
	},
	{
		"id": "AC-31",
		"source": "EPM214s AC Resonance (Series RLC, cf. Quiz2_AC_Part 8.26)",
		"category": "ac_resonance",
		"frequencyHz": 15.915494309189533,
		"omegaRadPerSec": 100,
		"acMagnitudeMode": "rms",
		"nodes": [
			"0",
			"A",
			"B",
			"C"
		],
		"components": [
			{
				"label": "Vs",
				"kind": "voltage_source",
				"fromNode": "A",
				"toNode": "0",
				"value": 100,
				"phaseDeg": 0
			},
			{
				"label": "R1",
				"kind": "resistor",
				"fromNode": "A",
				"toNode": "B",
				"value": 10
			},
			{
				"label": "L1",
				"kind": "inductor",
				"fromNode": "B",
				"toNode": "C",
				"value": 1
			},
			{
				"label": "C1",
				"kind": "capacitor",
				"fromNode": "C",
				"toNode": "0",
				"value": 0.0001
			}
		],
		"expected": {
			"I_R1": {
				"mag": 10,
				"deg": 0
			},
			"V_R1": {
				"mag": 100,
				"deg": 0
			},
			"V_L1": {
				"mag": 1000,
				"deg": 90
			},
			"V_C1": {
				"mag": 1000,
				"deg": -90
			},
			"P": 1000,
			"Q": 0,
			"S_mag": 1000,
			"pf": 1,
			"pfType": "unity"
		}
	},
	{
		"id": "AC-32",
		"source": "EPM214s AC Resonance (Parallel RLC Tank Circuit)",
		"category": "ac_resonance",
		"frequencyHz": 159.15494309189535,
		"omegaRadPerSec": 1000,
		"acMagnitudeMode": "rms",
		"nodes": [
			"0",
			"A"
		],
		"components": [
			{
				"label": "Is",
				"kind": "current_source",
				"fromNode": "0",
				"toNode": "A",
				"value": 2,
				"phaseDeg": 0
			},
			{
				"label": "R1",
				"kind": "resistor",
				"fromNode": "A",
				"toNode": "0",
				"value": 100
			},
			{
				"label": "L1",
				"kind": "inductor",
				"fromNode": "A",
				"toNode": "0",
				"value": 0.02
			},
			{
				"label": "C1",
				"kind": "capacitor",
				"fromNode": "A",
				"toNode": "0",
				"value": 0.00005
			}
		],
		"expected": {
			"V_A": {
				"mag": 200,
				"deg": 0
			},
			"I_R1": {
				"mag": 2,
				"deg": 0
			},
			"I_L1": {
				"mag": 10,
				"deg": -90
			},
			"I_C1": {
				"mag": 10,
				"deg": 90
			},
			"P": 400,
			"Q": 0,
			"S_mag": 400,
			"pf": 1,
			"pfType": "unity"
		}
	}
];

// ============================================================================
// Shared Assertion & Netlist Mapping Helpers
// ============================================================================

const DC_KIND_MAP: Record<DcPoolComponent['kind'], ComponentKind> = {
	V: 'voltage_source',
	I: 'current_source',
	R: 'resistor',
	VCVS: 'vcvs',
	VCCS: 'vccs',
	CCVS: 'ccvs',
	CCCS: 'cccs'
};

function expectCloseReal(
	actual: number,
	expected: number,
	label: string,
	relTol = 1e-3,
	absTol = 1e-4
): void {
	expect(Number.isFinite(actual), `${label}: expected finite value, got ${actual}`).toBe(true);
	const tol = Math.max(absTol, relTol * Math.abs(expected));
	const diff = Math.abs(actual - expected);
	expect(
		diff,
		`${label}: expected ${expected} ± ${tol.toExponential(2)}, got ${actual} (diff ${diff.toExponential(2)})`
	).toBeLessThanOrEqual(tol);
}

function wrapAngleDiffDeg(actualDeg: number, expectedDeg: number): number {
	const raw = ((((actualDeg - expectedDeg + 540) % 360) + 360) % 360) - 180;
	return Math.abs(raw);
}

function expectClosePhasor(
	actual: Complex,
	expected: PhasorExpect,
	label: string,
	relTol = 1e-3,
	absTol = 1e-4,
	degTol = 0.1
): void {
	expect(
		Number.isFinite(actual.re) && Number.isFinite(actual.im),
		`${label}: non-finite phasor (${actual.re}, ${actual.im})`
	).toBe(true);
	expectCloseReal(actual.abs(), expected.mag, `${label}.mag`, relTol, absTol);
	if (expected.mag > 1e-6) {
		const angleDiff = wrapAngleDiffDeg(actual.argDeg(), expected.deg);
		expect(
			angleDiff,
			`${label}.deg: expected ${expected.deg}° ± ${degTol}°, got ${actual.argDeg().toFixed(4)}° (diff ${angleDiff.toFixed(4)}°)`
		).toBeLessThanOrEqual(degTol);
	}
	if (expected.re !== undefined) {
		expectCloseReal(actual.re, expected.re, `${label}.re`, relTol, absTol);
	}
	if (expected.im !== undefined) {
		expectCloseReal(actual.im, expected.im, `${label}.im`, relTol, absTol);
	}
}

function expectCloseComplexRect(
	actual: Complex,
	expected: { re: number; im: number },
	label: string,
	relTol = 1e-3,
	absTol = 1e-4
): void {
	expectCloseReal(actual.re, expected.re, `${label}.re`, relTol, absTol);
	expectCloseReal(actual.im, expected.im, `${label}.im`, relTol, absTol);
}

function assertZeroNaNOrInfinity(mna: MnaSolution, context: string): void {
	for (const [nid, nr] of Object.entries(mna.nodeVoltages)) {
		expect(
			Number.isFinite(nr.voltage.re) && Number.isFinite(nr.voltage.im),
			`${context}: node ${nid} has non-finite voltage`
		).toBe(true);
	}
	for (const [bid, br] of Object.entries(mna.branches)) {
		expect(
			Number.isFinite(br.voltage.re) &&
				Number.isFinite(br.voltage.im) &&
				Number.isFinite(br.current.re) &&
				Number.isFinite(br.current.im) &&
				Number.isFinite(br.complexPower.re) &&
				Number.isFinite(br.complexPower.im) &&
				Number.isFinite(br.realPower) &&
				Number.isFinite(br.reactivePower) &&
				Number.isFinite(br.apparentPower),
			`${context}: branch ${bid} (${br.label}) has NaN/Infinity`
		).toBe(true);
	}
	expect(Number.isFinite(mna.powerBalance.totalRealPower)).toBe(true);
	expect(Number.isFinite(mna.powerBalance.totalReactivePower)).toBe(true);
	expect(Number.isFinite(mna.powerBalance.totalAbsorbedReal)).toBe(true);
	expect(Number.isFinite(mna.powerBalance.totalSuppliedReal)).toBe(true);
}

function assertComplexPowerConservation(mna: MnaSolution, context: string): void {
	let sumP = 0;
	let sumQ = 0;
	let maxP = 1;
	let maxQ = 1;
	for (const br of Object.values(mna.branches)) {
		if (br.isMeasurementOnly) continue;
		sumP += br.realPower;
		sumQ += br.reactivePower;
		if (Math.abs(br.realPower) > maxP) maxP = Math.abs(br.realPower);
		if (Math.abs(br.reactivePower) > maxQ) maxQ = Math.abs(br.reactivePower);
	}
	expect(
		Math.abs(sumP),
		`${context}: real power not conserved (sumP=${sumP}, maxP=${maxP})`
	).toBeLessThan(1e-4 * maxP);
	expect(
		Math.abs(sumQ),
		`${context}: reactive power not conserved (sumQ=${sumQ}, maxQ=${maxQ})`
	).toBeLessThan(1e-4 * maxQ);
	expect(mna.powerBalance.balanced, `${context}: mna.powerBalance.balanced must be true`).toBe(
		true
	);
}

function getCompIdByLabel(doc: CircuitDocument, label: string): string {
	const comp = doc.components.find((c) => c.label === label || c.id === label);
	if (!comp) {
		throw new Error(`Component "${label}" not found in imported CircuitDocument`);
	}
	return comp.id;
}

function getBranchByLabel(doc: CircuitDocument, mna: MnaSolution, label: string): BranchResult {
	const id = getCompIdByLabel(doc, label);
	const br = mna.branches[id];
	if (!br) {
		throw new Error(`Branch for component "${label}" (id="${id}") not found in MNA result`);
	}
	return br;
}

/**
 * Pin-mapped original-node resolver.
 * Resolves any original netlist node name via the solved pin nodeA/nodeB of every component
 * attached to that original node — NEVER depending on internal auto-layout node renumbering.
 * Also verifies strict topology consistency (no split nets, no accidental shorts).
 */
function buildOriginalNodeMap(
	doc: CircuitDocument,
	mna: MnaSolution,
	elements: Array<{ label: string; fromNode: string; toNode: string }>,
	context: string
): Map<string, string> {
	const origToInternal = new Map<string, string>();
	const internalToOrig = new Map<string, string>();

	const record = (origName: string, internalId: string) => {
		const existing = origToInternal.get(origName);
		if (existing !== undefined) {
			expect(
				internalId,
				`${context}: original node "${origName}" split across internal nodes "${existing}" and "${internalId}"`
			).toBe(existing);
		} else {
			origToInternal.set(origName, internalId);
		}
		const rev = internalToOrig.get(internalId);
		if (rev !== undefined) {
			expect(
				origName,
				`${context}: distinct original nodes "${rev}" and "${origName}" shorted to internal node "${internalId}"`
			).toBe(rev);
		} else {
			internalToOrig.set(internalId, origName);
		}
	};

	for (const el of elements) {
		const br = getBranchByLabel(doc, mna, el.label);
		record(el.fromNode, br.nodeA);
		record(el.toNode, br.nodeB);
	}

	if (origToInternal.has('0')) {
		expect(origToInternal.get('0'), `${context}: ground node "0" must map to reference "0"`).toBe(
			'0'
		);
	}
	return origToInternal;
}

function getOriginalNodeVoltage(
	nodeMap: Map<string, string>,
	mna: MnaSolution,
	origNode: string
): Complex {
	if (origNode === '0') return Complex.zero();
	const internalId = nodeMap.get(origNode);
	if (!internalId) {
		throw new Error(`Original node "${origNode}" not present in pin-mapped node map`);
	}
	const nr = mna.nodeVoltages[internalId];
	if (!nr) {
		throw new Error(`Internal node "${internalId}" (from "${origNode}") missing in mna.nodeVoltages`);
	}
	return nr.voltage;
}

async function assertShareRoundTrip(
	doc: CircuitDocument,
	origMna: MnaSolution,
	context: string,
	theveninTarget?: TheveninTarget
): Promise<void> {
	const hash = await encodeCircuitToHash({
		document: doc,
		...(theveninTarget ? { theveninTarget } : {})
	});
	expect(hash.startsWith('#c='), `${context}: share hash must start with #c=`).toBe(true);

	const decoded = await decodeCircuitFromHash(hash);
	expect(decoded, `${context}: decodeCircuitFromHash returned null`).not.toBeNull();
	expect(decoded!.document.mode).toBe(doc.mode);
	expect(decoded!.document.frequencyHz).toBeCloseTo(doc.frequencyHz, 10);
	if (doc.acMagnitudeMode !== undefined) {
		expect(decoded!.document.acMagnitudeMode).toBe(doc.acMagnitudeMode);
	}

	for (const origComp of doc.components) {
		const decComp = decoded!.document.components.find((c) => c.id === origComp.id);
		expect(decComp, `${context}: missing component ${origComp.id} after share round-trip`).toBeDefined();
		if (origComp.valueMode === 'impedance') {
			expect(
				decComp!.valueMode,
				`${context}: component ${origComp.id} lost valueMode="impedance" in share round-trip`
			).toBe('impedance');
		}
	}

	const reSolved = solveCircuit(decoded!.document, {
		...(decoded!.theveninTarget ? { theveninTarget: decoded!.theveninTarget } : {})
	});
	expect(reSolved.mna.valid, `${context}: re-solved circuit after share round-trip is invalid`).toBe(
		true
	);
	assertZeroNaNOrInfinity(reSolved.mna, `${context} [share round-trip]`);

	for (const [compId, origBr] of Object.entries(origMna.branches)) {
		const decBr = reSolved.mna.branches[compId];
		expect(decBr, `${context}: missing branch ${compId} after share round-trip`).toBeDefined();
		const vTol = 1e-8 * Math.max(1, origBr.voltage.abs());
		const iTol = 1e-8 * Math.max(1, origBr.current.abs());
		expect(
			decBr.voltage.sub(origBr.voltage).abs(),
			`${context}: branch ${origBr.label} voltage changed after share round-trip`
		).toBeLessThan(vTol);
		expect(
			decBr.current.sub(origBr.current).abs(),
			`${context}: branch ${origBr.label} current changed after share round-trip`
		).toBeLessThan(iTol);
	}
}

function buildDcNetlist(
	problem: DcPoolProblem,
	options?: {
		extraElements?: Array<Record<string, unknown>>;
		unknownElementLabel?: string;
		unknownSymbol?: string;
		unknownProblem?: Record<string, unknown>;
	}
): Record<string, unknown> {
	const elements: Array<Record<string, unknown>> = problem.components.map((c) => {
		const kind = DC_KIND_MAP[c.kind];
		const isUnknown = options?.unknownElementLabel === c.label;
		const el: Record<string, unknown> = {
			id: c.label,
			kind,
			label: c.label,
			from: c.fromNode,
			to: c.toNode,
			value: isUnknown ? '?' : String(c.value)
		};
		if (isUnknown) {
			el.unknown = true;
			if (options?.unknownSymbol) el.unknownSymbol = options.unknownSymbol;
		}
		if (c.dependentSpec) {
			const ref: DependentControlRef = { gain: c.dependentSpec.gain };
			if (c.dependentSpec.controlType === 'voltage') {
				ref.controlNodePos = c.dependentSpec.controlFrom;
				ref.controlNodeNeg = c.dependentSpec.controlTo;
			} else {
				ref.controlBranchComponentId = c.dependentSpec.controlLabel;
			}
			el.controlRef = ref;
		}
		return el;
	});

	if (options?.extraElements) {
		elements.push(...options.extraElements);
	}

	const doc: Record<string, unknown> = {
		schemaVersion: 1,
		name: `${problem.id}: ${problem.source}`,
		mode: 'dc',
		elements
	};
	if (options?.unknownProblem) {
		doc.unknownProblem = options.unknownProblem;
	}
	return doc;
}

function buildAcNetlist(
	problem: AcPoolProblem,
	options?: { excludeLabels?: string[] }
): Record<string, unknown> {
	const excluded = new Set(options?.excludeLabels ?? []);
	const elements: Array<Record<string, unknown>> = problem.components
		.filter((c) => !excluded.has(c.label))
		.map((c) => {
			const el: Record<string, unknown> = {
				id: c.label,
				kind: c.kind,
				label: c.label,
				from: c.fromNode,
				to: c.toNode
			};

			if (c.impedanceMode) {
				el.valueMode = 'impedance';
				el.unit = 'Ω';
				if (typeof c.value === 'string') {
					el.value = c.value;
				} else if (c.reactanceOhm !== undefined) {
					const x = c.reactanceOhm;
					if (c.resistanceOhm !== undefined && Math.abs(c.resistanceOhm) > 1e-12) {
						el.value = x >= 0 ? `${c.resistanceOhm}+j${x}` : `${c.resistanceOhm}-j${Math.abs(x)}`;
					} else {
						el.value = x >= 0 ? `j${x}` : `-j${Math.abs(x)}`;
					}
				} else {
					el.value = String(c.value);
				}
			} else {
				el.value = String(c.value);
			}

			if (c.phaseDeg !== undefined) {
				el.phaseDeg = c.phaseDeg;
			}

			if (c.dependentSpec) {
				const ref: DependentControlRef = { gain: c.dependentSpec.gain };
				if (c.dependentSpec.controlBranchLabel) {
					ref.controlBranchComponentId = c.dependentSpec.controlBranchLabel;
				}
				if (c.dependentSpec.controlNodePos !== undefined) {
					ref.controlNodePos = c.dependentSpec.controlNodePos;
				}
				if (c.dependentSpec.controlNodeNeg !== undefined) {
					ref.controlNodeNeg = c.dependentSpec.controlNodeNeg;
				}
				if (c.dependentSpec.controlVarName) {
					ref.controlVarName = c.dependentSpec.controlVarName;
				}
				el.controlRef = ref;
			}
			return el;
		});

	return {
		schemaVersion: 1,
		name: `${problem.id}: ${problem.source}`,
		mode: 'ac',
		frequencyHz: problem.frequencyHz,
		acMagnitudeMode: problem.acMagnitudeMode,
		elements
	};
}

// ============================================================================
// PART 1: 36 DC EPM214s Stress-Test Cases (DC-01..DC-36)
// ============================================================================

describe('EPM214s DC Stress-Test Bank (DC-01..DC-36)', () => {
	for (const problem of DC_POOL) {
		it(`${problem.id} [${problem.category}]: ${problem.source}`, async () => {
			const isPurePortNetwork =
				problem.theveninTarget !== undefined &&
				problem.theveninTarget.componentLabel === undefined;

			// -----------------------------------------------------------------
			// A. Pure passive / dependent 2-terminal port networks (DC-05, DC-06, DC-32, DC-33)
			// -----------------------------------------------------------------
			if (isPurePortNetwork) {
				const { portA, portB } = problem.theveninTarget!;
				// 1) Test direct port impedance via Thévenin terminals (no independent source)
				const portNetlist = buildDcNetlist(problem);
				const portImport = parseCircuitImport(JSON.stringify(portNetlist));
				expect(portImport.ok, `${problem.id} port import failed: ${!portImport.ok ? portImport.errors.join('; ') : ''}`).toBe(true);
				if (!portImport.ok) return;

				const portDoc = portImport.document;
				expect(portDoc.components.length).toBeGreaterThan(0);
				expect(portDoc.wires.length).toBeGreaterThan(0);

				const baseMna = solveMNA(portDoc);
				expect(baseMna.valid, `${problem.id}: passive/dependent port MNA invalid`).toBe(true);
				assertZeroNaNOrInfinity(baseMna, `${problem.id} [port]`);

				const portNodeMap = buildOriginalNodeMap(
					portDoc,
					baseMna,
					problem.components,
					`${problem.id} [port]`
				);
				const internalPortA = portNodeMap.get(portA)!;
				const internalPortB = portNodeMap.get(portB)!;
				const termTarget: TheveninTarget = {
					kind: 'terminals',
					nodeA: internalPortA,
					nodeB: internalPortB
				};

				const portSol = solveCircuit(portDoc, { theveninTarget: termTarget });
				expect(portSol.mna.valid).toBe(true);
				expect(portSol.mna.powerBalance.balanced).toBe(true);
				expect(
					portSol.allVerified,
					`${problem.id} [port]: pedagogical methods failed cross-verification (maxDiscrepancy=${portSol.maxDiscrepancy}, failed=${Object.entries(portSol.methods).filter(([, m]) => m?.applicable && !m.verifiedAgainstMna).map(([k, m]) => `${k}(${m?.maxDiscrepancy})`).join(', ')})`
				).toBe(true);
				expect(portSol.theveninNorton, `${problem.id}: expected theveninNorton result`).toBeDefined();
				expect(portSol.theveninNorton!.zth, `${problem.id}: expected finite zth`).not.toBeNull();

				const expectedR =
					(problem.expected.Rab_ohm as number | undefined) ??
					(problem.expected.Rth_ohm as number | undefined) ??
					(problem.expected.Req_check_ohm as number | undefined);
				expect(expectedR).toBeDefined();

				expectCloseReal(
					portSol.theveninNorton!.zth!.re,
					expectedR!,
					`${problem.id} theveninNorton.zth`,
					1e-3,
					1e-4
				);
				if (problem.expected.Vth_V !== undefined) {
					expectCloseReal(
						portSol.theveninNorton!.vth.re,
						problem.expected.Vth_V as number,
						`${problem.id} theveninNorton.vth`,
						1e-3,
						1e-4
					);
				}

				// 2) Independently verify with an explicit 1 V test voltage source across (portA, portB)
				const testSrcEl = {
					id: 'V_test',
					kind: 'voltage_source',
					label: 'V_test',
					from: portA,
					to: portB,
					value: '1'
				};
				const testNetlist = buildDcNetlist(problem, { extraElements: [testSrcEl] });
				const testImport = parseCircuitImport(JSON.stringify(testNetlist));
				expect(testImport.ok, `${problem.id} 1V-test import failed`).toBe(true);
				if (!testImport.ok) return;

				const testDoc = testImport.document;
				const testSol = solveCircuit(testDoc);
				expect(testSol.mna.valid).toBe(true);
				expect(testSol.mna.powerBalance.balanced).toBe(true);
				expect(
					testSol.allVerified,
					`${problem.id} [1V test]: pedagogical methods failed cross-verification (maxDiscrepancy=${testSol.maxDiscrepancy}, failed=${Object.entries(testSol.methods).filter(([, m]) => m?.applicable && !m.verifiedAgainstMna).map(([k, m]) => `${k}(${m?.maxDiscrepancy})`).join(', ')})`
				).toBe(true);
				assertZeroNaNOrInfinity(testSol.mna, `${problem.id} [1V test]`);

				const vTestBr = getBranchByLabel(testDoc, testSol.mna, 'V_test');
				const iOut = -vTestBr.current.re;
				const reqMeasured = 1 / iOut;
				expectCloseReal(reqMeasured, expectedR!, `${problem.id} 1V-test Req`, 1e-3, 1e-4);

				// Share round-trip on the energized 1V-test circuit
				await assertShareRoundTrip(testDoc, testSol.mna, `${problem.id} [1V test]`);

				// 3) DC-33 bonus inverse check: solve unknown Rx given V_test = 1 V & I(V_test) = -1/50 A
				if (problem.id === 'DC-33') {
					const invNetlist = buildDcNetlist(problem, {
						extraElements: [testSrcEl],
						unknownElementLabel: 'Rx',
						unknownSymbol: 'Rx',
						unknownProblem: {
							componentId: 'Rx',
							symbol: 'Rx',
							constraint: {
								kind: 'branch_current',
								targetId: 'V_test',
								value: String(-1 / (problem.expected.Req_check_ohm as number)),
								label: 'I_test'
							}
						}
					});
					const invImport = parseCircuitImport(JSON.stringify(invNetlist));
					expect(invImport.ok).toBe(true);
					if (invImport.ok) {
						const invSol = solveCircuit(invImport.document);
						expect(invSol.unknownSolution?.valid, 'DC-33 inverse unknownSolution.valid').toBe(true);
						expect(invSol.unknownSolution!.solutions.length).toBeGreaterThanOrEqual(1);
						expect(invSol.unknownSolution!.solutions[0].verified).toBe(true);
						expectCloseReal(
							invSol.unknownSolution!.solutions[0].value.re,
							problem.expected.Rx_ohm as number,
							'DC-33 inverse Rx',
							1e-3,
							1e-4
						);
					}
				}
				return;
			}

			// -----------------------------------------------------------------
			// B. Standard DC circuits (with optional Thévenin load target)
			// -----------------------------------------------------------------
			const netlist = buildDcNetlist(problem);
			const imported = parseCircuitImport(JSON.stringify(netlist));
			expect(
				imported.ok,
				`${problem.id} import failed: ${!imported.ok ? imported.errors.join('; ') : ''}`
			).toBe(true);
			if (!imported.ok) return;

			const doc = imported.document;
			expect(doc.components.length).toBeGreaterThan(0);
			expect(doc.wires.length).toBeGreaterThan(0);

			let theveninTarget: TheveninTarget | undefined;
			if (problem.theveninTarget?.componentLabel) {
				theveninTarget = {
					kind: 'component',
					componentId: getCompIdByLabel(doc, problem.theveninTarget.componentLabel)
				};
			}

			const sol = solveCircuit(doc, { ...(theveninTarget ? { theveninTarget } : {}) });
			expect(
				sol.mna.valid,
				`${problem.id}: MNA invalid (${sol.mna.diagnostics.map((d) => d.message).join('; ')})`
			).toBe(true);
			expect(sol.mna.powerBalance.balanced, `${problem.id}: DC power not balanced`).toBe(true);
			expect(
				sol.allVerified,
				`${problem.id}: pedagogical methods failed cross-verification (maxDiscrepancy=${sol.maxDiscrepancy}, failed=${Object.entries(sol.methods).filter(([, m]) => m?.applicable && !m.verifiedAgainstMna).map(([k, m]) => `${k}(${m?.maxDiscrepancy})`).join(', ')})`
			).toBe(true);
			assertZeroNaNOrInfinity(sol.mna, problem.id);

			const nodeMap = buildOriginalNodeMap(doc, sol.mna, problem.components, problem.id);
			const exp = problem.expected;

			// 1. Check all expected node voltage maps
			for (const nvKey of [
				'nodeVoltages_V',
				'nodeVoltages_with_load_V',
				'nodeVoltages_at_RL_opt_V',
				'nodeVoltages_at_Ro_opt_V',
				'nodeVoltages_at_sol_V'
			] as const) {
				const nvMap = exp[nvKey] as Record<string, number> | undefined;
				if (!nvMap) continue;
				for (const [origNode, expV] of Object.entries(nvMap)) {
					const actualV = getOriginalNodeVoltage(nodeMap, sol.mna, origNode);
					expectCloseReal(actualV.re, expV, `${problem.id} V(${origNode})`, 1e-3, 1e-4);
				}
			}

			// 2. Check all expected scalar currents, voltages, powers, equivalents
			if (exp.Req_at_V1_ohm !== undefined) {
				const brV1 = getBranchByLabel(doc, sol.mna, 'V1');
				const req = brV1.voltage.re / -brV1.current.re;
				expectCloseReal(req, exp.Req_at_V1_ohm as number, `${problem.id} Req_at_V1`);
			}
			if (exp.I_source_A !== undefined) {
				const brV1 = getBranchByLabel(doc, sol.mna, 'V1');
				expectCloseReal(-brV1.current.re, exp.I_source_A as number, `${problem.id} I_source`);
			}
			if (exp.i_leaving_V1_A !== undefined) {
				const brV1 = getBranchByLabel(doc, sol.mna, 'V1');
				expectCloseReal(
					-brV1.current.re,
					exp.i_leaving_V1_A as number,
					`${problem.id} i_leaving_V1`
				);
			}

			// Branch currents (from -> to)
			const branchCurrentKeys: Array<[string, string]> = [
				['I_R3_A', 'R3'],
				['I_R4_A', 'R4'],
				['I_R6_A', 'R6'],
				['Io_R3_A', 'R3'],
				['io_R3_A', 'R3'],
				['io_R1_A', 'R1'],
				['i1_R1_A', 'R1'],
				['Io_R2_A', 'R2'],
				['Io_R_load_A', 'R_load'],
				['I_loop_A', 'R1']
			];
			for (const [key, compLabel] of branchCurrentKeys) {
				if (exp[key] !== undefined) {
					const br = getBranchByLabel(doc, sol.mna, compLabel);
					expectCloseReal(br.current.re, exp[key] as number, `${problem.id} ${key}`);
				}
			}

			// Specific node / differential voltages
			if (exp.Vo_V !== undefined) {
				expectCloseReal(
					getOriginalNodeVoltage(nodeMap, sol.mna, 'a').re,
					exp.Vo_V as number,
					`${problem.id} Vo_V`
				);
			}
			if (exp.Vo_0_minus_M_V !== undefined) {
				const diff = -getOriginalNodeVoltage(nodeMap, sol.mna, 'M').re;
				expectCloseReal(diff, exp.Vo_0_minus_M_V as number, `${problem.id} Vo_0_minus_M_V`);
			}
			if (exp.Vo_Vc_V !== undefined) {
				expectCloseReal(
					getOriginalNodeVoltage(nodeMap, sol.mna, 'c').re,
					exp.Vo_Vc_V as number,
					`${problem.id} Vo_Vc_V`
				);
			}
			if (exp.Vo_Vd_V !== undefined) {
				expectCloseReal(
					getOriginalNodeVoltage(nodeMap, sol.mna, 'd').re,
					exp.Vo_Vd_V as number,
					`${problem.id} Vo_Vd_V`
				);
			}
			if (exp.Vab_V !== undefined) {
				const vab =
					getOriginalNodeVoltage(nodeMap, sol.mna, 'a').re -
					getOriginalNodeVoltage(nodeMap, sol.mna, 'b').re;
				expectCloseReal(vab, exp.Vab_V as number, `${problem.id} Vab_V`);
			}
			if (exp.Vo_VT_V !== undefined) {
				expectCloseReal(
					getOriginalNodeVoltage(nodeMap, sol.mna, 'T').re,
					exp.Vo_VT_V as number,
					`${problem.id} Vo_VT_V`
				);
			}
			if (exp.vo_Vb_minus_Vc_V !== undefined) {
				const diff =
					getOriginalNodeVoltage(nodeMap, sol.mna, 'b').re -
					getOriginalNodeVoltage(nodeMap, sol.mna, 'c').re;
				expectCloseReal(diff, exp.vo_Vb_minus_Vc_V as number, `${problem.id} vo_Vb_minus_Vc_V`);
			}
			if (exp.Vo_Va_minus_Vb_V !== undefined) {
				const diff =
					getOriginalNodeVoltage(nodeMap, sol.mna, 'a').re -
					getOriginalNodeVoltage(nodeMap, sol.mna, 'b').re;
				expectCloseReal(diff, exp.Vo_Va_minus_Vb_V as number, `${problem.id} Vo_Va_minus_Vb_V`);
			}
			if (exp.Vx_VC_minus_VD_V !== undefined) {
				const diff =
					getOriginalNodeVoltage(nodeMap, sol.mna, 'C').re -
					getOriginalNodeVoltage(nodeMap, sol.mna, 'D').re;
				expectCloseReal(diff, exp.Vx_VC_minus_VD_V as number, `${problem.id} Vx_VC_minus_VD_V`);
			}
			if (exp.VR_VC_V !== undefined) {
				expectCloseReal(
					getOriginalNodeVoltage(nodeMap, sol.mna, 'C').re,
					exp.VR_VC_V as number,
					`${problem.id} VR_VC_V`
				);
			}
			if (exp.Vo_VY_check_V !== undefined) {
				expectCloseReal(
					getOriginalNodeVoltage(nodeMap, sol.mna, 'Y').re,
					exp.Vo_VY_check_V as number,
					`${problem.id} Vo_VY_check_V`
				);
			}

			// Source / element / total powers
			if (exp.P_V1_sup_W !== undefined) {
				const br = getBranchByLabel(doc, sol.mna, 'V1');
				expectCloseReal(-br.realPower, exp.P_V1_sup_W as number, `${problem.id} P_V1_sup_W`);
			}
			if (exp.P_V1_sup_check_W !== undefined) {
				const br = getBranchByLabel(doc, sol.mna, 'V1');
				expectCloseReal(
					-br.realPower,
					exp.P_V1_sup_check_W as number,
					`${problem.id} P_V1_sup_check_W`
				);
			}
			if (exp.P_V2_sup_W !== undefined) {
				const br = getBranchByLabel(doc, sol.mna, 'V2');
				expectCloseReal(-br.realPower, exp.P_V2_sup_W as number, `${problem.id} P_V2_sup_W`);
			}
			if (exp.P_I1_sup_W !== undefined) {
				const br = getBranchByLabel(doc, sol.mna, 'I1');
				expectCloseReal(-br.realPower, exp.P_I1_sup_W as number, `${problem.id} P_I1_sup_W`);
			}
			if (exp.P_E1_abs_W !== undefined) {
				const br = getBranchByLabel(doc, sol.mna, 'E1');
				expectCloseReal(br.realPower, exp.P_E1_abs_W as number, `${problem.id} P_E1_abs_W`);
			}
			if (exp.P_E1_sup_W !== undefined) {
				const br = getBranchByLabel(doc, sol.mna, 'E1');
				expectCloseReal(-br.realPower, exp.P_E1_sup_W as number, `${problem.id} P_E1_sup_W`);
			}
			if (exp.P_H1_abs_W !== undefined) {
				const br = getBranchByLabel(doc, sol.mna, 'H1');
				expectCloseReal(br.realPower, exp.P_H1_abs_W as number, `${problem.id} P_H1_abs_W`);
			}
			if (exp.P_total_W !== undefined) {
				expectCloseReal(
					sol.mna.powerBalance.totalAbsorbedReal,
					exp.P_total_W as number,
					`${problem.id} P_total_W`
				);
			}

			// 3. Thévenin / Norton & Max Power Transfer assertions (DC-21, DC-24..DC-28, DC-34)
			if (problem.theveninTarget?.componentLabel) {
				expect(sol.theveninNorton, `${problem.id}: missing theveninNorton`).toBeDefined();
				const th = sol.theveninNorton!;
				if (exp.Vth_V !== undefined) {
					expectCloseReal(th.vth.re, exp.Vth_V as number, `${problem.id} Vth`);
				}
				if (exp.Rth_ohm !== undefined) {
					expect(th.zth, `${problem.id}: expected non-null zth`).not.toBeNull();
					expectCloseReal(th.zth!.re, exp.Rth_ohm as number, `${problem.id} Rth`);
				}
				if (exp.IN_A !== undefined) {
					expect(th.isc, `${problem.id}: expected non-null isc`).not.toBeNull();
					expectCloseReal(th.isc!.re, exp.IN_A as number, `${problem.id} I_N`);
				}
				const optR = (exp.RL_opt_ohm ?? exp.Ro_opt_ohm) as number | undefined;
				if (optR !== undefined) {
					expect(th.maxPowerTransfer, `${problem.id}: missing maxPowerTransfer`).toBeDefined();
					expectCloseReal(
						th.maxPowerTransfer!.optimalLoadImpedance.re,
						optR,
						`${problem.id} optimalLoadImpedance`
					);
				}
				if (exp.Pmax_W !== undefined) {
					expect(th.maxPowerTransfer, `${problem.id}: missing maxPowerTransfer`).toBeDefined();
					expectCloseReal(
						th.maxPowerTransfer!.maxRealPowerW,
						exp.Pmax_W as number,
						`${problem.id} maxRealPowerW`
					);
				}
			}

			// 4. Inverse Unknown-Parameter Solver tests (DC-34, DC-35, DC-36)
			if (problem.id === 'DC-34') {
				const invNetlist = buildDcNetlist(problem, {
					unknownElementLabel: 'Rx',
					unknownSymbol: 'Rx',
					unknownProblem: {
						componentId: 'Rx',
						symbol: 'Rx',
						constraint: {
							kind: 'branch_power',
							targetId: 'Rx',
							value: '0.008',
							label: 'P_Rx'
						}
					}
				});
				const invImp = parseCircuitImport(JSON.stringify(invNetlist));
				expect(invImp.ok, 'DC-34 inverse import failed').toBe(true);
				if (invImp.ok) {
					const invSol = solveCircuit(invImp.document);
					expect(invSol.unknownSolution?.valid, 'DC-34 unknownSolution.valid').toBe(true);
					expect(invSol.unknownSolution!.solutions).toHaveLength(2);
					const roots = invSol.unknownSolution!.solutions
						.map((s) => s.value.re)
						.sort((a, b) => a - b);
					const expectedRoots = [...(exp.Rx_solutions_ohm as number[])].sort((a, b) => a - b);
					expectCloseReal(roots[0], expectedRoots[0], 'DC-34 root 1');
					expectCloseReal(roots[1], expectedRoots[1], 'DC-34 root 2');
					for (const cand of invSol.unknownSolution!.solutions) {
						expect(cand.verified, `DC-34 candidate ${cand.valueString} must be verified`).toBe(
							true
						);
					}
					const invHash = await encodeCircuitToHash({ document: invImp.document });
					const invDec = await decodeCircuitFromHash(invHash);
					expect(invDec?.document.unknownProblem).toBeDefined();
					const invReSol = solveCircuit(invDec!.document);
					expect(invReSol.unknownSolution?.valid).toBe(true);
					expect(invReSol.unknownSolution!.solutions).toHaveLength(2);
				}
			} else if (problem.id === 'DC-35') {
				const invNetlist = buildDcNetlist(problem, {
					unknownElementLabel: 'Vx',
					unknownSymbol: 'Vx',
					unknownProblem: {
						componentId: 'Vx',
						symbol: 'Vx',
						constraint: {
							kind: 'branch_power',
							targetId: 'V1',
							value: '-17.5',
							label: 'P_V1'
						}
					}
				});
				const invImp = parseCircuitImport(JSON.stringify(invNetlist));
				expect(invImp.ok, 'DC-35 inverse import failed').toBe(true);
				if (invImp.ok) {
					const invSol = solveCircuit(invImp.document);
					expect(invSol.unknownSolution?.valid, 'DC-35 unknownSolution.valid').toBe(true);
					expect(invSol.unknownSolution!.solutions.length).toBeGreaterThanOrEqual(1);
					const matching = invSol.unknownSolution!.solutions.find(
						(s) => Math.abs(s.value.re - (exp.Vx_V as number)) < 1e-3
					);
					expect(
						matching,
						`DC-35 expected root ${exp.Vx_V}, got [${invSol.unknownSolution!.solutions.map((s) => s.value.re).join(', ')}]`
					).toBeDefined();
					expect(matching!.verified).toBe(true);
					const invHash = await encodeCircuitToHash({ document: invImp.document });
					const invDec = await decodeCircuitFromHash(invHash);
					expect(invDec?.document.unknownProblem).toBeDefined();
					const invReSol = solveCircuit(invDec!.document);
					expect(invReSol.unknownSolution?.valid).toBe(true);
				}
			} else if (problem.id === 'DC-36') {
				const invNetlist = buildDcNetlist(problem, {
					unknownElementLabel: 'IA',
					unknownSymbol: 'IA',
					unknownProblem: {
						componentId: 'IA',
						symbol: 'IA',
						constraint: {
							kind: 'node_voltage',
							targetId: 'Y',
							value: '4',
							label: 'V_Y'
						}
					}
				});
				const invImp = parseCircuitImport(JSON.stringify(invNetlist));
				expect(invImp.ok, 'DC-36 inverse import failed').toBe(true);
				if (invImp.ok) {
					const invSol = solveCircuit(invImp.document);
					expect(invSol.unknownSolution?.valid, 'DC-36 unknownSolution.valid').toBe(true);
					expect(invSol.unknownSolution!.solutions).toHaveLength(1);
					expect(invSol.unknownSolution!.solutions[0].verified).toBe(true);
					expectCloseReal(
						invSol.unknownSolution!.solutions[0].value.re,
						exp.IA_A as number,
						'DC-36 inverse IA'
					);
					const invHash = await encodeCircuitToHash({ document: invImp.document });
					const invDec = await decodeCircuitFromHash(invHash);
					expect(invDec?.document.unknownProblem).toBeDefined();
					const invReSol = solveCircuit(invDec!.document);
					expect(invReSol.unknownSolution?.valid).toBe(true);
					expectCloseReal(
						invReSol.unknownSolution!.solutions[0].value.re,
						exp.IA_A as number,
						'DC-36 inverse IA [share round-trip]'
					);
				}
			}

			// 5. URL share round-trip verification
			await assertShareRoundTrip(doc, sol.mna, problem.id, theveninTarget);
		});
	}
});

// ============================================================================
// PART 2: 32 AC EPM214s Stress-Test Cases (AC-01..AC-32)
// ============================================================================

describe('EPM214s AC Stress-Test Bank (AC-01..AC-32)', () => {
	for (const problem of AC_POOL) {
		it(`${problem.id} [${problem.category} / ${problem.acMagnitudeMode}]: ${problem.source}`, async () => {
			// Helper to import, solve, verify invariants, and check AC-30 before/after cleanly
			const solveAcVariant = async (excludeLabels?: string[], suffix = '') => {
				const ctx = suffix ? `${problem.id} [${suffix}]` : problem.id;
				const netlist = buildAcNetlist(problem, { excludeLabels });
				const imported = parseCircuitImport(JSON.stringify(netlist));
				expect(
					imported.ok,
					`${ctx} import failed: ${!imported.ok ? imported.errors.join('; ') : ''}`
				).toBe(true);
				if (!imported.ok) throw new Error(`${ctx} import failed`);

				const doc = imported.document;
				expect(doc.components.length).toBeGreaterThan(0);
				expect(doc.wires.length).toBeGreaterThan(0);
				expect(doc.mode).toBe('ac');
				expect(doc.acMagnitudeMode).toBe(problem.acMagnitudeMode);
				expect(doc.frequencyHz).toBeCloseTo(problem.frequencyHz, 10);

				let theveninTarget: TheveninTarget | undefined;
				if (problem.theveninTarget && !(excludeLabels ?? []).includes(problem.theveninTarget)) {
					theveninTarget = {
						kind: 'component',
						componentId: getCompIdByLabel(doc, problem.theveninTarget)
					};
				}

				const sol = solveCircuit(doc, { ...(theveninTarget ? { theveninTarget } : {}) });
				expect(
					sol.mna.valid,
					`${ctx}: MNA invalid (${sol.mna.diagnostics.map((d) => d.message).join('; ')})`
				).toBe(true);
				expect(
					sol.allVerified,
					`${ctx}: pedagogical methods failed cross-verification (maxDiscrepancy=${sol.maxDiscrepancy}, failed=${Object.entries(sol.methods).filter(([, m]) => m?.applicable && !m.verifiedAgainstMna).map(([k, m]) => `${k}(${m?.maxDiscrepancy})`).join(', ')})`
				).toBe(true);
				assertZeroNaNOrInfinity(sol.mna, ctx);
				assertComplexPowerConservation(sol.mna, ctx);

				const activePoolComps = problem.components.filter(
					(c) => !(excludeLabels ?? []).includes(c.label)
				);
				const nodeMap = buildOriginalNodeMap(doc, sol.mna, activePoolComps, ctx);

				await assertShareRoundTrip(doc, sol.mna, ctx, theveninTarget);
				return { doc, sol, nodeMap, ctx };
			};

			// Special handling for AC-30 (Power Factor Correction: BEFORE and AFTER C_pf)
			if (problem.id === 'AC-30') {
				const beforeExp = problem.expected.before_C_pf as {
					P: number;
					Q: number;
					S_mag: number;
					pf: number;
					pfType: 'lagging' | 'leading' | 'unity';
				};
				const afterExp = problem.expected.after_C_pf as {
					P: number;
					Q: number;
					Q_C: number;
					S_mag: number;
					pf: number;
					pfType: 'lagging' | 'leading' | 'unity';
				};

				const before = await solveAcVariant(['C_pf'], 'before C_pf');
				const vsBefore = getBranchByLabel(before.doc, before.sol.mna, 'Vs');
				expectCloseReal(-vsBefore.realPower, beforeExp.P, 'AC-30 before P');
				expectCloseReal(-vsBefore.reactivePower, beforeExp.Q, 'AC-30 before Q');
				expectCloseReal(vsBefore.apparentPower, beforeExp.S_mag, 'AC-30 before |S|');
				expectCloseReal(vsBefore.powerFactor!, beforeExp.pf, 'AC-30 before pf');
				expect(vsBefore.powerFactorType).toBe(beforeExp.pfType);

				const after = await solveAcVariant(undefined, 'after C_pf');
				const vsAfter = getBranchByLabel(after.doc, after.sol.mna, 'Vs');
				const cPfAfter = getBranchByLabel(after.doc, after.sol.mna, 'C_pf');
				expectCloseReal(-vsAfter.realPower, afterExp.P, 'AC-30 after P');
				expectCloseReal(-vsAfter.reactivePower, afterExp.Q, 'AC-30 after Q');
				expectCloseReal(cPfAfter.reactivePower, afterExp.Q_C, 'AC-30 after Q_C');
				expectCloseReal(vsAfter.apparentPower, afterExp.S_mag, 'AC-30 after |S|');
				expectCloseReal(vsAfter.powerFactor!, afterExp.pf, 'AC-30 after pf');
				expect(vsAfter.powerFactorType).toBe(afterExp.pfType);
				return;
			}

			const { doc, sol, nodeMap, ctx } = await solveAcVariant();
			const exp = problem.expected;

			// Helper to find primary independent source (Vs or Is)
			const primarySourceLabel = problem.components.find(
				(c) => c.kind === 'voltage_source' || c.kind === 'current_source'
			)?.label;

			// 1. Direct node voltage phasors
			const nodePhasorMap: Array<[string, string]> = [
				['V_A', 'A'],
				['V_B', 'B'],
				['V_C', 'C'],
				['V_E', 'E'],
				['V_L', 'L'],
				['V_A_total', 'A'],
				['V_B_total', 'B'],
				['V1', 'V1'],
				['V2', 'V2']
			];
			for (const [key, origNode] of nodePhasorMap) {
				if (exp[key] !== undefined) {
					const actual = getOriginalNodeVoltage(nodeMap, sol.mna, origNode);
					expectClosePhasor(actual, exp[key] as PhasorExpect, `${ctx} ${key}`);
				}
			}

			// Special Vo node mapping per problem
			if (exp.Vo !== undefined) {
				const voNode =
					problem.id === 'AC-13'
						? 'Vo'
						: problem.id === 'AC-15'
							? 'N2'
							: problem.id === 'AC-17'
								? 'B'
								: 'Vo';
				const actual = getOriginalNodeVoltage(nodeMap, sol.mna, voNode);
				expectClosePhasor(actual, exp.Vo as PhasorExpect, `${ctx} Vo`);
			}

			// 2. Direct branch voltage phasors
			const branchVoltageKeys: Array<[string, string]> = [
				['V_R1', 'R1'],
				['V_L1', 'L1'],
				['V_C1', 'C1']
			];
			for (const [key, compLabel] of branchVoltageKeys) {
				if (exp[key] !== undefined) {
					const br = getBranchByLabel(doc, sol.mna, compLabel);
					expectClosePhasor(br.voltage, exp[key] as PhasorExpect, `${ctx} ${key}`);
				}
			}

			// 3. Direct branch current phasors
			const branchCurrentKeys: Array<[string, string]> = [
				['I_R1', 'R1'],
				['I_R2', 'R2'],
				['I_R3', 'R3'],
				['I_C1', 'C1'],
				['I_L1', 'L1'],
				['I_ZL', 'ZL'],
				['I_line', 'R_line']
			];
			for (const [key, compLabel] of branchCurrentKeys) {
				if (exp[key] !== undefined) {
					const br = getBranchByLabel(doc, sol.mna, compLabel);
					expectClosePhasor(br.current, exp[key] as PhasorExpect, `${ctx} ${key}`);
				}
			}

			// Source output current (leaving + terminal = -I_Vs)
			if (exp.I_total !== undefined) {
				const brVs = getBranchByLabel(doc, sol.mna, 'Vs');
				expectClosePhasor(brVs.current.neg(), exp.I_total as PhasorExpect, `${ctx} I_total`);
			}
			if (exp.I_source_out !== undefined) {
				const brVs = getBranchByLabel(doc, sol.mna, 'Vs');
				expectClosePhasor(
					brVs.current.neg(),
					exp.I_source_out as PhasorExpect,
					`${ctx} I_source_out`
				);
			}

			// Mesh / branch currents specific to AC-14, AC-15, AC-16, AC-17, AC-28
			if (exp.I1 !== undefined) {
				const actual =
					problem.id === 'AC-15'
						? getBranchByLabel(doc, sol.mna, 'Vs').current.neg()
						: getBranchByLabel(doc, sol.mna, 'R1').current;
				expectClosePhasor(actual, exp.I1 as PhasorExpect, `${ctx} I1`);
			}
			if (exp.I2 !== undefined) {
				const actual =
					problem.id === 'AC-14'
						? getBranchByLabel(doc, sol.mna, 'Vs').current
						: getBranchByLabel(doc, sol.mna, 'R2').current;
				expectClosePhasor(actual, exp.I2 as PhasorExpect, `${ctx} I2`);
			}
			if (exp.Io !== undefined) {
				const actual =
					problem.id === 'AC-14'
						? getBranchByLabel(doc, sol.mna, 'R1').current.neg()
						: getBranchByLabel(doc, sol.mna, 'R2').current.neg();
				expectClosePhasor(actual, exp.Io as PhasorExpect, `${ctx} Io`);
			}

			// 4. Input impedance Zeq (AC-08)
			if (exp.Zeq_rect !== undefined || exp.Zeq_polar !== undefined) {
				const brVs = getBranchByLabel(doc, sol.mna, 'Vs');
				const zeq = brVs.voltage.div(brVs.current.neg());
				if (exp.Zeq_rect !== undefined) {
					expectCloseComplexRect(
						zeq,
						exp.Zeq_rect as { re: number; im: number },
						`${ctx} Zeq_rect`
					);
				}
				if (exp.Zeq_polar !== undefined) {
					expectClosePhasor(zeq, exp.Zeq_polar as PhasorExpect, `${ctx} Zeq_polar`);
				}
			}

			// 5. Power & Power Factor checks (respecting Peak vs RMS!)
			if (primarySourceLabel) {
				const srcBr = getBranchByLabel(doc, sol.mna, primarySourceLabel);
				if (exp.P_source_delivered !== undefined) {
					expectCloseReal(
						-srcBr.realPower,
						exp.P_source_delivered as number,
						`${ctx} P_source_delivered`
					);
				}
				if (exp.Q_source_delivered !== undefined) {
					expectCloseReal(
						-srcBr.reactivePower,
						exp.Q_source_delivered as number,
						`${ctx} Q_source_delivered`
					);
				}
				if (exp.P !== undefined) {
					expectCloseReal(-srcBr.realPower, exp.P as number, `${ctx} P`);
				}
				if (exp.Q !== undefined) {
					expectCloseReal(-srcBr.reactivePower, exp.Q as number, `${ctx} Q`);
				}
				if (exp.S_mag !== undefined) {
					expectCloseReal(srcBr.apparentPower, exp.S_mag as number, `${ctx} S_mag`);
				}
				if (exp.pf !== undefined) {
					expect(srcBr.powerFactor, `${ctx}: expected non-null powerFactor`).not.toBeNull();
					expectCloseReal(srcBr.powerFactor!, exp.pf as number, `${ctx} pf`);
				}
				if (exp.P_source !== undefined) {
					expectCloseReal(-srcBr.realPower, exp.P_source as number, `${ctx} P_source`);
				}
				if (exp.Q_source !== undefined) {
					expectCloseReal(-srcBr.reactivePower, exp.Q_source as number, `${ctx} Q_source`);
				}
				if (exp.S_source_mag !== undefined) {
					expectCloseReal(srcBr.apparentPower, exp.S_source_mag as number, `${ctx} S_source_mag`);
				}
				if (exp.pf_source !== undefined) {
					expectCloseReal(srcBr.powerFactor!, exp.pf_source as number, `${ctx} pf_source`);
				}
				if (exp.pfType !== undefined) {
					expect(srcBr.powerFactorType, `${ctx} pfType`).toBe(exp.pfType);
				}
			}

			// AC-29 load-side power breakdown
			if (exp.P_load !== undefined) {
				const brRLoad = getBranchByLabel(doc, sol.mna, 'R_load');
				const brLLoad = getBranchByLabel(doc, sol.mna, 'L_load');
				const pLoad = brRLoad.realPower + brLLoad.realPower;
				const qLoad = brRLoad.reactivePower + brLLoad.reactivePower;
				const sLoad = Math.hypot(pLoad, qLoad);
				expectCloseReal(pLoad, exp.P_load as number, `${ctx} P_load`);
				expectCloseReal(qLoad, exp.Q_load as number, `${ctx} Q_load`);
				expectCloseReal(sLoad, exp.S_load_mag as number, `${ctx} S_load_mag`);
				expectCloseReal(pLoad / sLoad, exp.pf_load as number, `${ctx} pf_load`);
			}

			// AC-23 load real power
			if (exp.P_ZL !== undefined) {
				const brZL = getBranchByLabel(doc, sol.mna, 'ZL');
				expectCloseReal(brZL.realPower, exp.P_ZL as number, `${ctx} P_ZL`);
			}

			// 6. AC Thévenin / Norton & Max Power Transfer (AC-21, AC-22, AC-23, AC-25)
			if (problem.theveninTarget) {
				expect(sol.theveninNorton, `${ctx}: missing theveninNorton`).toBeDefined();
				const th = sol.theveninNorton!;
				if (exp.V_th !== undefined) {
					expectClosePhasor(th.vth, exp.V_th as PhasorExpect, `${ctx} V_th`);
				}
				if (exp.Z_th !== undefined) {
					expect(th.zth, `${ctx}: expected non-null Z_th`).not.toBeNull();
					expectClosePhasor(th.zth!, exp.Z_th as PhasorExpect, `${ctx} Z_th`);
				}
				if (exp.I_N !== undefined) {
					expect(th.isc, `${ctx}: expected non-null I_N`).not.toBeNull();
					expectClosePhasor(th.isc!, exp.I_N as PhasorExpect, `${ctx} I_N`);
				}
				if (exp.Z_L_opt !== undefined) {
					expect(th.maxPowerTransfer, `${ctx}: missing maxPowerTransfer`).toBeDefined();
					expectCloseComplexRect(
						th.maxPowerTransfer!.optimalLoadImpedance,
						exp.Z_L_opt as { re: number; im: number },
						`${ctx} Z_L_opt`
					);
				}
				const expectedPmax = (exp.P_max_rms ?? exp.P_max_peak) as number | undefined;
				if (expectedPmax !== undefined) {
					expect(th.maxPowerTransfer, `${ctx}: missing maxPowerTransfer`).toBeDefined();
					expectCloseReal(
						th.maxPowerTransfer!.maxRealPowerW,
						expectedPmax,
						`${ctx} maxRealPowerW`
					);
				}
			}
		});
	}
});

// ============================================================================
// PART 3: 12 Adversarial & Edge-Case Stress Tests (EDGE-01..EDGE-12)
// ============================================================================

describe('Adversarial & Edge-Case Stress Tests (EDGE-01..EDGE-12)', () => {
	it('EDGE-01: Extreme dynamic range DC (1 mΩ to 100 MΩ — 11 decades)', async () => {
		const netlist = {
			schemaVersion: 1,
			name: 'EDGE-01 Extreme Dynamic Range DC',
			mode: 'dc',
			elements: [
				{ id: 'V1', kind: 'voltage_source', label: 'V1', from: 'A', to: '0', value: '10' },
				{ id: 'R_low', kind: 'resistor', label: 'R_low', from: 'A', to: '0', value: '1m' },
				{ id: 'R_s1', kind: 'resistor', label: 'R_s1', from: 'A', to: 'B', value: '1m' },
				{ id: 'R_high', kind: 'resistor', label: 'R_high', from: 'B', to: '0', value: '100M' }
			]
		};
		const imp = parseCircuitImport(JSON.stringify(netlist));
		expect(imp.ok).toBe(true);
		if (!imp.ok) return;

		const sol = solveCircuit(imp.document);
		expect(sol.mna.valid).toBe(true);
		expect(sol.mna.powerBalance.balanced).toBe(true);
		assertZeroNaNOrInfinity(sol.mna, 'EDGE-01');

		const rLow = getBranchByLabel(imp.document, sol.mna, 'R_low');
		const rHigh = getBranchByLabel(imp.document, sol.mna, 'R_high');
		expectCloseReal(rLow.current.re, 10000, 'EDGE-01 I(R_low)', 1e-6, 1e-6);
		expectCloseReal(rHigh.current.re, 1e-7, 'EDGE-01 I(R_high)', 1e-4, 1e-12);
		expectCloseReal(rHigh.voltage.re, 10, 'EDGE-01 V(R_high)', 1e-6, 1e-6);

		await assertShareRoundTrip(imp.document, sol.mna, 'EDGE-01');
	});

	it('EDGE-02: High-Q series RLC resonance (R=0.1Ω, L=1H, C=100µF -> Q=1000, 1000x magnification)', async () => {
		const f0 = 100 / (2 * Math.PI); // ω0 = 1 / sqrt(1 * 1e-4) = 100 rad/s
		const netlist = {
			schemaVersion: 1,
			name: 'EDGE-02 High-Q Series RLC',
			mode: 'ac',
			frequencyHz: f0,
			acMagnitudeMode: 'rms',
			elements: [
				{ id: 'Vs', kind: 'voltage_source', label: 'Vs', from: 'A', to: '0', value: '1', phaseDeg: 0 },
				{ id: 'R1', kind: 'resistor', label: 'R1', from: 'A', to: 'B', value: '0.1' },
				{ id: 'L1', kind: 'inductor', label: 'L1', from: 'B', to: 'C', value: '1' },
				{ id: 'C1', kind: 'capacitor', label: 'C1', from: 'C', to: '0', value: '100u' }
			]
		};
		const imp = parseCircuitImport(JSON.stringify(netlist));
		expect(imp.ok).toBe(true);
		if (!imp.ok) return;

		const sol = solveCircuit(imp.document);
		expect(sol.mna.valid).toBe(true);
		assertZeroNaNOrInfinity(sol.mna, 'EDGE-02');
		assertComplexPowerConservation(sol.mna, 'EDGE-02');

		const brR = getBranchByLabel(imp.document, sol.mna, 'R1');
		const brL = getBranchByLabel(imp.document, sol.mna, 'L1');
		const brC = getBranchByLabel(imp.document, sol.mna, 'C1');
		const brVs = getBranchByLabel(imp.document, sol.mna, 'Vs');

		expectClosePhasor(brR.current, { mag: 10, deg: 0 }, 'EDGE-02 I');
		expectClosePhasor(brR.voltage, { mag: 1, deg: 0 }, 'EDGE-02 V_R');
		expectClosePhasor(brL.voltage, { mag: 1000, deg: 90 }, 'EDGE-02 V_L (1000x)');
		expectClosePhasor(brC.voltage, { mag: 1000, deg: -90 }, 'EDGE-02 V_C (1000x)');
		expectCloseReal(-brVs.realPower, 10, 'EDGE-02 P');
		expectCloseReal(-brVs.reactivePower, 0, 'EDGE-02 Q', 1e-3, 1e-4);
		expectCloseReal(brVs.powerFactor!, 1, 'EDGE-02 pf');
		expect(brVs.powerFactorType).toBe('unity');
	});

	it('EDGE-03: Undamped singular series LC resonance (R=0 at f0) returns valid=false cleanly with zero NaN/Inf', () => {
		const f0 = 100 / (2 * Math.PI);
		const seriesLc = {
			schemaVersion: 1,
			name: 'EDGE-03a Singular Undamped Series LC',
			mode: 'ac',
			frequencyHz: f0,
			acMagnitudeMode: 'rms',
			elements: [
				{ id: 'Vs', kind: 'voltage_source', label: 'Vs', from: 'A', to: '0', value: '10', phaseDeg: 0 },
				{ id: 'L1', kind: 'inductor', label: 'L1', from: 'A', to: 'B', value: '1' },
				{ id: 'C1', kind: 'capacitor', label: 'C1', from: 'B', to: '0', value: '100u' }
			]
		};
		const impA = parseCircuitImport(JSON.stringify(seriesLc));
		expect(impA.ok).toBe(true);
		if (impA.ok) {
			const solA = solveCircuit(impA.document);
			expect(solA.mna.valid).toBe(false);
			expect(
				solA.mna.diagnostics.some(
					(d) => d.severity === 'error' && d.code === 'SINGULAR_MATRIX'
				)
			).toBe(true);
			assertZeroNaNOrInfinity(solA.mna, 'EDGE-03a');
		}

		// Also verify undamped lossless parallel LC tank driven by ideal current source at f0
		const parallelLc = {
			schemaVersion: 1,
			name: 'EDGE-03b Singular Undamped Parallel LC Tank',
			mode: 'ac',
			frequencyHz: f0,
			acMagnitudeMode: 'rms',
			elements: [
				{ id: 'Is', kind: 'current_source', label: 'Is', from: '0', to: 'A', value: '2', phaseDeg: 0 },
				{ id: 'L1', kind: 'inductor', label: 'L1', from: 'A', to: '0', value: '1' },
				{ id: 'C1', kind: 'capacitor', label: 'C1', from: 'A', to: '0', value: '100u' }
			]
		};
		const impB = parseCircuitImport(JSON.stringify(parallelLc));
		expect(impB.ok).toBe(true);
		if (impB.ok) {
			const solB = solveCircuit(impB.document);
			expect(solB.mna.valid).toBe(false);
			expect(
				solB.mna.diagnostics.some(
					(d) => d.severity === 'error' && d.code === 'SINGULAR_MATRIX'
				)
			).toBe(true);
			assertZeroNaNOrInfinity(solB.mna, 'EDGE-03b');
		}
	});

	it('EDGE-04: Conflicting parallel DC voltage sources (10 V || 20 V) returns valid=false with clean diagnostic', () => {
		const netlist = {
			schemaVersion: 1,
			name: 'EDGE-04 Conflicting Parallel Voltage Sources',
			mode: 'dc',
			elements: [
				{ id: 'V1', kind: 'voltage_source', label: 'V1', from: 'A', to: '0', value: '10' },
				{ id: 'V2', kind: 'voltage_source', label: 'V2', from: 'A', to: '0', value: '20' },
				{ id: 'R1', kind: 'resistor', label: 'R1', from: 'A', to: '0', value: '100' }
			]
		};
		const imp = parseCircuitImport(JSON.stringify(netlist));
		expect(imp.ok).toBe(true);
		if (!imp.ok) return;

		const sol = solveCircuit(imp.document);
		expect(sol.mna.valid).toBe(false);
		expect(
			sol.mna.diagnostics.some(
				(d) => d.severity === 'error' && d.code === 'VOLTAGE_SOURCE_LOOP'
			)
		).toBe(true);
		assertZeroNaNOrInfinity(sol.mna, 'EDGE-04');
	});

	it('EDGE-05: Floating disconnected current source / open branch returns valid=false cleanly with zero crash', () => {
		// Case 5a: current source in series with open capacitor in DC (current-source cutset)
		const cutsetNetlist = {
			schemaVersion: 1,
			name: 'EDGE-05a Current Source Cutset',
			mode: 'dc',
			elements: [
				{ id: 'I1', kind: 'current_source', label: 'I1', from: '0', to: 'A', value: '2' },
				{ id: 'C1', kind: 'capacitor', label: 'C1', from: 'A', to: '0', value: '10u' }
			]
		};
		const impA = parseCircuitImport(JSON.stringify(cutsetNetlist));
		expect(impA.ok).toBe(true);
		if (impA.ok) {
			const solA = solveCircuit(impA.document);
			expect(solA.mna.valid).toBe(false);
			expect(solA.mna.diagnostics.some((d) => d.severity === 'error')).toBe(true);
			assertZeroNaNOrInfinity(solA.mna, 'EDGE-05a');
		}

		// Case 5b: disconnected floating subcircuit with current source
		const floatingDoc: CircuitDocument = {
			schemaVersion: 1,
			name: 'EDGE-05b Disconnected Floating Island',
			mode: 'dc',
			frequencyHz: 60,
			components: [
				{ id: 'V1', kind: 'voltage_source', label: 'V1', x: 2, y: 4, rotation: 90, value: '10' },
				{ id: 'R1', kind: 'resistor', label: 'R1', x: 6, y: 4, rotation: 90, value: '10' },
				{ id: 'G1', kind: 'ground', label: 'GND', x: 2, y: 6, rotation: 0, value: '0' },
				{ id: 'I2', kind: 'current_source', label: 'I2', x: 16, y: 4, rotation: 90, value: '1' },
				{ id: 'R2', kind: 'resistor', label: 'R2', x: 20, y: 4, rotation: 90, value: '5' }
			],
			wires: [
				{ id: 'w1', points: [{ x: 2, y: 2 }, { x: 6, y: 2 }] },
				{ id: 'w2', points: [{ x: 2, y: 6 }, { x: 6, y: 6 }] },
				{ id: 'w3', points: [{ x: 16, y: 2 }, { x: 20, y: 2 }] },
				{ id: 'w4', points: [{ x: 16, y: 6 }, { x: 20, y: 6 }] }
			]
		};
		const solB = solveCircuit(floatingDoc);
		expect(solB.mna.valid).toBe(false);
		expect(solB.mna.diagnostics.some((d) => d.severity === 'error')).toBe(true);
		assertZeroNaNOrInfinity(solB.mna, 'EDGE-05b');
	});

	it('EDGE-06: Zero-value independent sources (0 V & 0 A) in DC and AC solve cleanly to exact zero', () => {
		const dcNetlist = {
			schemaVersion: 1,
			name: 'EDGE-06a Zero Sources DC',
			mode: 'dc',
			elements: [
				{ id: 'V1', kind: 'voltage_source', label: 'V1', from: 'A', to: '0', value: '0' },
				{ id: 'R1', kind: 'resistor', label: 'R1', from: 'A', to: 'B', value: '100' },
				{ id: 'R2', kind: 'resistor', label: 'R2', from: 'B', to: '0', value: '200' },
				{ id: 'I1', kind: 'current_source', label: 'I1', from: '0', to: 'B', value: '0' }
			]
		};
		const impDc = parseCircuitImport(JSON.stringify(dcNetlist));
		expect(impDc.ok).toBe(true);
		if (impDc.ok) {
			const solDc = solveCircuit(impDc.document);
			expect(solDc.mna.valid).toBe(true);
			expect(solDc.mna.powerBalance.balanced).toBe(true);
			assertZeroNaNOrInfinity(solDc.mna, 'EDGE-06a');
			for (const br of Object.values(solDc.mna.branches)) {
				expect(br.voltage.abs()).toBeLessThan(1e-12);
				expect(br.current.abs()).toBeLessThan(1e-12);
				expect(Math.abs(br.realPower)).toBeLessThan(1e-12);
			}
		}

		const acNetlist = {
			schemaVersion: 1,
			name: 'EDGE-06b Zero Sources AC',
			mode: 'ac',
			frequencyHz: 60,
			acMagnitudeMode: 'rms',
			elements: [
				{ id: 'V1', kind: 'voltage_source', label: 'V1', from: 'A', to: '0', value: '0', phaseDeg: 30 },
				{ id: 'R1', kind: 'resistor', label: 'R1', from: 'A', to: 'B', value: '50' },
				{ id: 'L1', kind: 'inductor', label: 'L1', from: 'B', to: '0', value: '0.1' },
				{ id: 'I1', kind: 'current_source', label: 'I1', from: '0', to: 'B', value: '0', phaseDeg: -45 }
			]
		};
		const impAc = parseCircuitImport(JSON.stringify(acNetlist));
		expect(impAc.ok).toBe(true);
		if (impAc.ok) {
			const solAc = solveCircuit(impAc.document);
			expect(solAc.mna.valid).toBe(true);
			assertZeroNaNOrInfinity(solAc.mna, 'EDGE-06b');
			assertComplexPowerConservation(solAc.mna, 'EDGE-06b');
			for (const br of Object.values(solAc.mna.branches)) {
				expect(br.voltage.abs()).toBeLessThan(1e-12);
				expect(br.current.abs()).toBeLessThan(1e-12);
			}
		}
	});

	it('EDGE-07: Large 20-resistor DC ladder network (< 200ms + exact KCL, Req, & power balance)', () => {
		// 10 rungs: series 10 Ω + shunt 20 Ω each = 20 resistors, driven by 100 V
		const rungs = 10;
		const rSeries = 10;
		const rShunt = 20;
		const elements: Array<Record<string, unknown>> = [
			{ id: 'V1', kind: 'voltage_source', label: 'V1', from: 'N0', to: '0', value: '100' }
		];
		for (let i = 0; i < rungs; i++) {
			elements.push({
				id: `Rs${i + 1}`,
				kind: 'resistor',
				label: `Rs${i + 1}`,
				from: `N${i}`,
				to: `N${i + 1}`,
				value: String(rSeries)
			});
			elements.push({
				id: `Rp${i + 1}`,
				kind: 'resistor',
				label: `Rp${i + 1}`,
				from: `N${i + 1}`,
				to: '0',
				value: String(rShunt)
			});
		}

		const imp = parseCircuitImport(
			JSON.stringify({
				schemaVersion: 1,
				name: 'EDGE-07 20-Resistor DC Ladder',
				mode: 'dc',
				elements
			})
		);
		expect(imp.ok).toBe(true);
		if (!imp.ok) return;

		const t0 = performance.now();
		const fullSol = solveCircuit(imp.document);
		const elapsedMs = performance.now() - t0;
		const mna = fullSol.mna;

		expect(mna.valid).toBe(true);
		expect(mna.powerBalance.balanced).toBe(true);
		expect(fullSol.allVerified).toBe(true);
		assertZeroNaNOrInfinity(mna, 'EDGE-07');
		expect(elapsedMs, `EDGE-07 full solveCircuit took ${elapsedMs.toFixed(1)}ms (> 200ms)`).toBeLessThan(
			200
		);

		// Compute exact ladder input resistance backwards from last rung
		let reqExact = rSeries + rShunt;
		for (let i = rungs - 2; i >= 0; i--) {
			reqExact = rSeries + (rShunt * reqExact) / (rShunt + reqExact);
		}
		const brV1 = getBranchByLabel(imp.document, mna, 'V1');
		const reqSolved = 100 / -brV1.current.re;
		expectCloseReal(reqSolved, reqExact, 'EDGE-07 ladder Req', 1e-9, 1e-9);

		// Verify KCL at every non-reference node
		for (const [nodeId, nr] of Object.entries(mna.nodeVoltages)) {
			if (nr.isReference) continue;
			let kclSum = 0;
			for (const br of Object.values(mna.branches)) {
				if (br.nodeA === nodeId) kclSum += br.current.re;
				if (br.nodeB === nodeId) kclSum -= br.current.re;
			}
			expect(Math.abs(kclSum), `EDGE-07 KCL residual at node ${nodeId}`).toBeLessThan(1e-9);
		}
	});

	it('EDGE-08: Linked scaled DC unknowns (V and 2V via unknownProblem.terms with target branch current)', () => {
		// V1 = V (A -> 0), V2 = 2V (C -> 0), R1 = 2 Ω (A -> B), R2 = 2 Ω (B -> C), R3 = 4 Ω (B -> 0)
		// KCL at B: (V_B - V)/2 + (V_B - 2V)/2 + V_B/4 = 0 => (5/4) V_B = 1.5 V => V_B = 1.2 V
		// I(R3) = V_B / 4 = 0.3 V. Target I(R3) = 3 A => V = 10 V, V2 = 20 V!
		const netlist = {
			schemaVersion: 1,
			name: 'EDGE-08 Linked Scaled Unknowns (V and 2V)',
			mode: 'dc',
			elements: [
				{ id: 'V1', kind: 'voltage_source', label: 'V1', from: 'A', to: '0', value: 'V', unknown: true, unknownSymbol: 'V', unknownMultiplier: 1 },
				{ id: 'V2', kind: 'voltage_source', label: 'V2', from: 'C', to: '0', value: '2V', unknown: true, unknownSymbol: 'V', unknownMultiplier: 2 },
				{ id: 'R1', kind: 'resistor', label: 'R1', from: 'A', to: 'B', value: '2' },
				{ id: 'R2', kind: 'resistor', label: 'R2', from: 'B', to: 'C', value: '2' },
				{ id: 'R3', kind: 'resistor', label: 'R3', from: 'B', to: '0', value: '4' }
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
					targetId: 'R3',
					value: '3',
					label: 'I_R3'
				}
			}
		};
		const imp = parseCircuitImport(JSON.stringify(netlist));
		expect(imp.ok).toBe(true);
		if (!imp.ok) return;

		const sol = solveCircuit(imp.document);
		expect(sol.mna.valid).toBe(true);
		expect(sol.unknownSolution?.valid).toBe(true);
		expect(sol.unknownSolution!.solutions).toHaveLength(1);
		const primary = sol.unknownSolution!.solutions[0];
		expect(primary.verified).toBe(true);
		expectCloseReal(primary.value.re, 10, 'EDGE-08 base V', 1e-6, 1e-6);

		const tv1 = primary.termValues?.find((t) => t.componentLabel === 'V1');
		const tv2 = primary.termValues?.find((t) => t.componentLabel === 'V2');
		expect(tv1).toBeDefined();
		expect(tv2).toBeDefined();
		expectCloseReal(tv1!.value.re, 10, 'EDGE-08 V1', 1e-6, 1e-6);
		expectCloseReal(tv2!.value.re, 20, 'EDGE-08 V2 (2V)', 1e-6, 1e-6);

		const brR3 = getBranchByLabel(imp.document, sol.mna, 'R3');
		expectCloseReal(brR3.current.re, 3, 'EDGE-08 I(R3)', 1e-6, 1e-6);
	});

	it('EDGE-09: AC unknown parameter problem (unknown AC resistor & unknown AC voltage source)', () => {
		// 9a: Unknown AC voltage source Vs driving R1 = 3 Ω and L1 = j4 Ω (impedance mode)
		// If V_B (across L1) = 8∠90° V, then I = 8∠90° / j4 = 2∠0° A, so Vs = I * (3 + j4) = 6 + j8 = 10∠53.1301° V
		const netlistSrc = {
			schemaVersion: 1,
			name: 'EDGE-09a Unknown AC Voltage Source',
			mode: 'ac',
			frequencyHz: 60,
			acMagnitudeMode: 'rms',
			elements: [
				{ id: 'Vs', kind: 'voltage_source', label: 'Vs', from: 'A', to: '0', value: '?', unknown: true, unknownSymbol: 'Vs' },
				{ id: 'R1', kind: 'resistor', label: 'R1', from: 'A', to: 'B', value: '3' },
				{ id: 'L1', kind: 'inductor', label: 'L1', from: 'B', to: '0', value: 'j4', valueMode: 'impedance', unit: 'Ω' }
			],
			unknownProblem: {
				componentId: 'Vs',
				symbol: 'Vs',
				constraint: {
					kind: 'node_voltage',
					targetId: 'B',
					value: '8∠90°',
					label: 'V_B'
				}
			}
		};
		const impSrc = parseCircuitImport(JSON.stringify(netlistSrc));
		expect(impSrc.ok).toBe(true);
		if (impSrc.ok) {
			const solSrc = solveCircuit(impSrc.document);
			expect(solSrc.mna.valid).toBe(true);
			expect(solSrc.unknownSolution?.valid).toBe(true);
			expect(solSrc.unknownSolution!.solutions[0].verified).toBe(true);
			expectClosePhasor(
				solSrc.unknownSolution!.solutions[0].value,
				{ mag: 10, deg: 53.1301, re: 6, im: 8 },
				'EDGE-09a Vs'
			);
		}

		// 9b: Unknown AC resistor Rx in series with L1 = j4 Ω driven by Vs = 10∠0° V
		// If V_B (across L1) = 8∠36.8699° V => I = 8∠36.8699° / j4 = 2∠-53.1301° => Z_tot = 5∠53.1301° = 3 + j4 => Rx = 3 Ω
		const netlistRes = {
			schemaVersion: 1,
			name: 'EDGE-09b Unknown AC Resistor',
			mode: 'ac',
			frequencyHz: 60,
			acMagnitudeMode: 'rms',
			elements: [
				{ id: 'Vs', kind: 'voltage_source', label: 'Vs', from: 'A', to: '0', value: '10', phaseDeg: 0 },
				{ id: 'Rx', kind: 'resistor', label: 'Rx', from: 'A', to: 'B', value: '?', unknown: true, unknownSymbol: 'Rx' },
				{ id: 'L1', kind: 'inductor', label: 'L1', from: 'B', to: '0', value: 'j4', valueMode: 'impedance', unit: 'Ω' }
			],
			unknownProblem: {
				componentId: 'Rx',
				symbol: 'Rx',
				constraint: {
					kind: 'branch_voltage',
					targetId: 'L1',
					value: '8∠36.8698976°',
					label: 'V_L1'
				}
			}
		};
		const impRes = parseCircuitImport(JSON.stringify(netlistRes));
		expect(impRes.ok).toBe(true);
		if (impRes.ok) {
			const solRes = solveCircuit(impRes.document);
			expect(solRes.mna.valid).toBe(true);
			expect(solRes.unknownSolution?.valid).toBe(true);
			expect(solRes.unknownSolution!.solutions[0].verified).toBe(true);
			expectCloseReal(solRes.unknownSolution!.solutions[0].value.re, 3, 'EDGE-09b Rx', 1e-3, 1e-4);
		}
	});

	it('EDGE-10: Ideal Voltmeter differential reading across floating bridge nodes in DC & AC (0 A, zero disturbance)', () => {
		// DC unbalanced Wheatstone bridge: Vs = 12 V (Top -> 0)
		// Left arm: R1 = 1k (Top -> M1), R2 = 3k (M1 -> 0) => V_M1 = 9 V
		// Right arm: R3 = 2k (Top -> M2), R4 = 2k (M2 -> 0) => V_M2 = 6 V
		// Voltmeter VM1 across M1 -> M2 must read +3 V, draw 0 A, and not disturb M1/M2!
		const dcBridgeNoVm = {
			schemaVersion: 1,
			name: 'EDGE-10a DC Bridge No VM',
			mode: 'dc',
			elements: [
				{ id: 'V1', kind: 'voltage_source', label: 'V1', from: 'T', to: '0', value: '12' },
				{ id: 'R1', kind: 'resistor', label: 'R1', from: 'T', to: 'M1', value: '1k' },
				{ id: 'R2', kind: 'resistor', label: 'R2', from: 'M1', to: '0', value: '3k' },
				{ id: 'R3', kind: 'resistor', label: 'R3', from: 'T', to: 'M2', value: '2k' },
				{ id: 'R4', kind: 'resistor', label: 'R4', from: 'M2', to: '0', value: '2k' }
			]
		};
		const dcBridgeWithVm = {
			...dcBridgeNoVm,
			name: 'EDGE-10a DC Bridge With VM',
			elements: [
				...dcBridgeNoVm.elements,
				{ id: 'VM1', kind: 'voltmeter', label: 'VM1', from: 'M1', to: 'M2', value: '0' }
			]
		};

		const impDcNo = parseCircuitImport(JSON.stringify(dcBridgeNoVm));
		const impDcVm = parseCircuitImport(JSON.stringify(dcBridgeWithVm));
		expect(impDcNo.ok && impDcVm.ok).toBe(true);
		if (impDcNo.ok && impDcVm.ok) {
			const solNo = solveCircuit(impDcNo.document);
			const solVm = solveCircuit(impDcVm.document);
			expect(solVm.mna.valid).toBe(true);
			expect(solVm.mna.powerBalance.balanced).toBe(true);
			expect(solVm.allVerified).toBe(true);

			const vmBr = getBranchByLabel(impDcVm.document, solVm.mna, 'VM1');
			expect(vmBr.isMeasurementOnly).toBe(true);
			expectCloseReal(vmBr.voltage.re, 3, 'EDGE-10a VM1 voltage', 1e-9, 1e-9);
			expect(vmBr.current.abs()).toBeLessThan(1e-15);
			expect(Math.abs(vmBr.realPower)).toBeLessThan(1e-15);

			// Zero disturbance check against circuit without voltmeter
			for (const label of ['R1', 'R2', 'R3', 'R4']) {
				const bNo = getBranchByLabel(impDcNo.document, solNo.mna, label);
				const bVm = getBranchByLabel(impDcVm.document, solVm.mna, label);
				expect(bVm.current.sub(bNo.current).abs()).toBeLessThan(1e-12);
			}
		}

		// AC bridge: Vs = 10∠0° V, Left: R1=10 (T->M1), C1=-j10 (M1->0) => V_M1 = 5 - j5
		// Right: R2=10 (T->M2), L1=j10 (M2->0) => V_M2 = 5 + j5
		// Differential V_M1 - V_M2 = -j10 = 10∠-90° V!
		const acBridgeWithVm = {
			schemaVersion: 1,
			name: 'EDGE-10b AC Bridge With VM',
			mode: 'ac',
			frequencyHz: 60,
			acMagnitudeMode: 'rms',
			elements: [
				{ id: 'Vs', kind: 'voltage_source', label: 'Vs', from: 'T', to: '0', value: '10', phaseDeg: 0 },
				{ id: 'R1', kind: 'resistor', label: 'R1', from: 'T', to: 'M1', value: '10' },
				{ id: 'C1', kind: 'capacitor', label: 'C1', from: 'M1', to: '0', value: '-j10', valueMode: 'impedance', unit: 'Ω' },
				{ id: 'R2', kind: 'resistor', label: 'R2', from: 'T', to: 'M2', value: '10' },
				{ id: 'L1', kind: 'inductor', label: 'L1', from: 'M2', to: '0', value: 'j10', valueMode: 'impedance', unit: 'Ω' },
				{ id: 'VM1', kind: 'voltmeter', label: 'VM1', from: 'M1', to: 'M2', value: '0' }
			]
		};
		const impAcVm = parseCircuitImport(JSON.stringify(acBridgeWithVm));
		expect(impAcVm.ok).toBe(true);
		if (impAcVm.ok) {
			const solAc = solveCircuit(impAcVm.document);
			expect(solAc.mna.valid).toBe(true);
			assertComplexPowerConservation(solAc.mna, 'EDGE-10b');
			const vmBr = getBranchByLabel(impAcVm.document, solAc.mna, 'VM1');
			expect(vmBr.isMeasurementOnly).toBe(true);
			expectClosePhasor(vmBr.voltage, { mag: 10, deg: -90, re: 0, im: -10 }, 'EDGE-10b AC VM1');
			expect(vmBr.current.abs()).toBeLessThan(1e-15);
			expect(Math.abs(vmBr.realPower) + Math.abs(vmBr.reactivePower)).toBeLessThan(1e-15);
		}
	});

	it('EDGE-11: Exact Peak vs RMS AC power invariant (identical phasors, P_peak = 0.5*P_rms, Q_peak = 0.5*Q_rms, Pmax_peak = 0.5*Pmax_rms)', () => {
		const makeNetlist = (acMagnitudeMode: AcMagnitudeMode) => ({
			schemaVersion: 1,
			name: `EDGE-11 RLC (${acMagnitudeMode})`,
			mode: 'ac',
			frequencyHz: 60,
			acMagnitudeMode,
			elements: [
				{ id: 'Vs', kind: 'voltage_source', label: 'Vs', from: 'A', to: '0', value: '120', phaseDeg: 25 },
				{ id: 'R1', kind: 'resistor', label: 'R1', from: 'A', to: 'B', value: '12' },
				{ id: 'L1', kind: 'inductor', label: 'L1', from: 'B', to: 'C', value: 'j16', valueMode: 'impedance', unit: 'Ω' },
				{ id: 'C1', kind: 'capacitor', label: 'C1', from: 'C', to: '0', value: '-j25', valueMode: 'impedance', unit: 'Ω' },
				{ id: 'RL', kind: 'resistor', label: 'RL', from: 'C', to: '0', value: '20' }
			]
		});

		const impRms = parseCircuitImport(JSON.stringify(makeNetlist('rms')));
		const impPeak = parseCircuitImport(JSON.stringify(makeNetlist('peak')));
		expect(impRms.ok && impPeak.ok).toBe(true);
		if (!impRms.ok || !impPeak.ok) return;

		const targetRms: TheveninTarget = {
			kind: 'component',
			componentId: getCompIdByLabel(impRms.document, 'RL')
		};
		const targetPeak: TheveninTarget = {
			kind: 'component',
			componentId: getCompIdByLabel(impPeak.document, 'RL')
		};

		const solRms = solveCircuit(impRms.document, { theveninTarget: targetRms });
		const solPeak = solveCircuit(impPeak.document, { theveninTarget: targetPeak });

		expect(solRms.mna.valid && solPeak.mna.valid).toBe(true);
		assertComplexPowerConservation(solRms.mna, 'EDGE-11 RMS');
		assertComplexPowerConservation(solPeak.mna, 'EDGE-11 Peak');

		// 1. Identical phasor voltages & currents across every single branch
		for (const label of ['Vs', 'R1', 'L1', 'C1', 'RL']) {
			const brRms = getBranchByLabel(impRms.document, solRms.mna, label);
			const brPeak = getBranchByLabel(impPeak.document, solPeak.mna, label);
			expect(brPeak.voltage.sub(brRms.voltage).abs()).toBeLessThan(1e-11);
			expect(brPeak.current.sub(brRms.current).abs()).toBeLessThan(1e-11);
			// 2. Exact 0.5 scaling of P, Q, |S|
			expectCloseReal(brPeak.realPower, 0.5 * brRms.realPower, `EDGE-11 P(${label})`, 1e-12, 1e-12);
			expectCloseReal(
				brPeak.reactivePower,
				0.5 * brRms.reactivePower,
				`EDGE-11 Q(${label})`,
				1e-12,
				1e-12
			);
			expectCloseReal(
				brPeak.apparentPower,
				0.5 * brRms.apparentPower,
				`EDGE-11 |S|(${label})`,
				1e-12,
				1e-12
			);
		}

		// 3. Exact 0.5 scaling of Thévenin Maximum Power Transfer
		expect(solRms.theveninNorton?.maxPowerTransfer).toBeDefined();
		expect(solPeak.theveninNorton?.maxPowerTransfer).toBeDefined();
		expect(
			solPeak.theveninNorton!.vth.sub(solRms.theveninNorton!.vth).abs()
		).toBeLessThan(1e-11);
		expect(
			solPeak.theveninNorton!.zth!.sub(solRms.theveninNorton!.zth!).abs()
		).toBeLessThan(1e-11);
		expectCloseReal(
			solPeak.theveninNorton!.maxPowerTransfer!.maxRealPowerW,
			0.5 * solRms.theveninNorton!.maxPowerTransfer!.maxRealPowerW,
			'EDGE-11 maxPowerTransfer.maxRealPowerW',
			1e-12,
			1e-12
		);
	});

	it('EDGE-12: autoWireDocument stress test on multi-component placed layouts (no crashes, valid wiring, zero shorts)', () => {
		const assertValidAutoWire = (doc: CircuitDocument, label: string) => {
			const res = autoWireDocument(doc);
			expect(res.skippedReason, `${label}: unexpected skippedReason`).toBeUndefined();
			expect(res.addedWires.length, `${label}: expected added wires`).toBeGreaterThan(0);

			const wired: CircuitDocument = { ...doc, wires: res.wires };

			// 1. No self-shorted 2-terminal components
			const graph = buildElectricalGraph(wired);
			for (const comp of wired.components) {
				if (comp.kind === 'ground' || comp.kind === 'terminal' || comp.kind === 'voltmeter') {
					continue;
				}
				const nodes = graph.componentNodes[comp.id];
				expect(nodes, `${label}: ${comp.id} missing graph nodes`).toHaveLength(2);
				expect(nodes[0], `${label}: ${comp.id} was self-shorted!`).not.toBe(nodes[1]);
			}

			// 2. All wire segments are strictly orthogonal and avoid component interiors
			const interiors = new Set<string>();
			for (const comp of wired.components) {
				if (comp.kind === 'ground' || comp.kind === 'terminal') continue;
				const [p0, p1] = getPinPositions(comp);
				if (p0.y === p1.y) {
					for (let x = Math.min(p0.x, p1.x) + 1; x < Math.max(p0.x, p1.x); x++) {
						interiors.add(`${x},${p0.y}`);
					}
				} else if (p0.x === p1.x) {
					for (let y = Math.min(p0.y, p1.y) + 1; y < Math.max(p0.y, p1.y); y++) {
						interiors.add(`${p0.x},${y}`);
					}
				}
			}
			for (const wire of res.addedWires as CircuitWire[]) {
				for (let i = 0; i + 1 < wire.points.length; i++) {
					const a = wire.points[i];
					const b = wire.points[i + 1];
					expect(a.x === b.x || a.y === b.y, `${label}: non-orthogonal wire segment`).toBe(true);
					if (a.y === b.y) {
						for (let x = Math.min(a.x, b.x); x <= Math.max(a.x, b.x); x++) {
							expect(interiors.has(`${x},${a.y}`), `${label}: wire cuts component interior`).toBe(
								false
							);
						}
					} else {
						for (let y = Math.min(a.y, b.y); y <= Math.max(a.y, b.y); y++) {
							expect(interiors.has(`${a.x},${y}`), `${label}: wire cuts component interior`).toBe(
								false
							);
						}
					}
				}
			}

			// 3. Resulting wired circuit solves cleanly in MNA with balanced power
			const mna = solveMNA(wired);
			expect(
				mna.valid,
				`${label}: auto-wired circuit failed MNA (${mna.diagnostics.map((d) => d.message).join('; ')})`
			).toBe(true);
			expect(mna.powerBalance.balanced).toBe(true);
			assertZeroNaNOrInfinity(mna, label);
		};

		// Layout A: 6-component DC two-stage ladder (unwired)
		assertValidAutoWire(
			{
				schemaVersion: 1,
				name: 'EDGE-12a DC Two-Stage Ladder',
				mode: 'dc',
				frequencyHz: 60,
				components: [
					{ id: 'V1', kind: 'voltage_source', label: 'V1', x: 2, y: 8, rotation: 90, value: '24' },
					{ id: 'R1', kind: 'resistor', label: 'R1', x: 6, y: 4, rotation: 0, value: '4' },
					{ id: 'R2', kind: 'resistor', label: 'R2', x: 10, y: 8, rotation: 90, value: '6' },
					{ id: 'R3', kind: 'resistor', label: 'R3', x: 14, y: 4, rotation: 0, value: '3' },
					{ id: 'R4', kind: 'resistor', label: 'R4', x: 18, y: 8, rotation: 90, value: '6' },
					{ id: 'G1', kind: 'ground', label: 'GND', x: 2, y: 12, rotation: 0, value: '0' }
				],
				wires: []
			},
			'EDGE-12a DC Two-Stage Ladder'
		);

		// Layout B: 5-component AC RLC parallel-series filter (unwired)
		assertValidAutoWire(
			{
				schemaVersion: 1,
				name: 'EDGE-12b AC RLC Filter',
				mode: 'ac',
				frequencyHz: 1000,
				acMagnitudeMode: 'rms',
				components: [
					{ id: 'Vs', kind: 'voltage_source', label: 'Vs', x: 2, y: 8, rotation: 90, value: '12', phaseDeg: 0 },
					{ id: 'R1', kind: 'resistor', label: 'R1', x: 6, y: 4, rotation: 0, value: '100' },
					{ id: 'L1', kind: 'inductor', label: 'L1', x: 12, y: 4, rotation: 0, value: '10m' },
					{ id: 'C1', kind: 'capacitor', label: 'C1', x: 16, y: 8, rotation: 90, value: '1u' },
					{ id: 'G1', kind: 'ground', label: 'GND', x: 2, y: 12, rotation: 0, value: '0' }
				],
				wires: []
			},
			'EDGE-12b AC RLC Filter'
		);
	});
});
