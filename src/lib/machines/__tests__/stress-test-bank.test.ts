import { describe, expect, it } from 'vitest';
import {
	MACHINE_CATEGORIES,
	MACHINE_QUESTION_TYPES,
	solveDcEmfAndTorque,
	solveDcGenerator,
	solveDcMotor,
	solveInductionMotorBasic,
	solveInductionMotorEquivCircuit,
	solveInductionMotorPowerFlow,
	solveLinearMagneticCircuit,
	solveMachineQuestion,
	solveNonlinearOrParallelMagnetic,
	solveThreePhase,
	solveTransformerEfficiencyLoad,
	solveTransformerEmfAndCoreLoss,
	solveTransformerOcScTests,
	solveTransformerOnLoad,
	solveVariableReluctanceActuator,
	type MachineQuestionTypeId,
	type MachineSolveResult
} from '../index';

function assertRelClose(actual: number, expected: number, maxRelErr = 0.005, absFloor = 1e-6) {
	expect(Number.isFinite(actual)).toBe(true);
	if (Math.abs(expected) < absFloor) {
		expect(Math.abs(actual - expected)).toBeLessThanOrEqual(absFloor);
		return;
	}
	const relErr = Math.abs(actual - expected) / Math.abs(expected);
	expect(relErr).toBeLessThanOrEqual(maxRelErr);
}

function assertValidResult(res: MachineSolveResult, expectedType: MachineQuestionTypeId) {
	expect(res.valid).toBe(true);
	expect(res.questionType).toBe(expectedType);
	expect(res.steps.length).toBeGreaterThanOrEqual(2);
	expect(res.answers.length).toBeGreaterThan(0);
	for (const [k, v] of Object.entries(res.values)) {
		expect(Number.isFinite(v), `values.${k} must be finite, got ${v}`).toBe(true);
	}
}

describe('EPM214s Electrical Machines — 24-Problem Past-Exam Stress-Test Bank (ST-01..ST-24)', () => {
	// ST-01: Lecture 1 Slides 18-19
	it('ST-01 (QT-3PH-1): Balanced Y-load with line impedance', () => {
		const res = solveThreePhase({
			loadConnection: 'Y',
			sourceConnection: 'Y',
			voltageType: 'line',
			voltageV: 600,
			loadMode: 'power',
			powerScope: 'per-phase',
			powerW: 160_000,
			pf: 0.8,
			pfType: 'lag',
			lineR: 0.005,
			lineX: 0.025
		});
		assertValidResult(res, 'QT-3PH-1');
		assertRelClose(res.values.iLineMag, 577.35, 0.001);
		assertRelClose(res.values.iLineDeg, -36.87, 0.001);
		assertRelClose(res.values.vSourcePhaseMag, 357.51, 0.001);
		assertRelClose(res.values.vSourcePhaseDeg, 1.57, 0.005);
		assertRelClose(res.values.sSourcePhaseKVA, 206.41, 0.001);
		assertRelClose(res.values.sSourcePhaseDeg, 38.44, 0.001);
		assertRelClose(res.values.sLinePhaseKVA, 8.5, 0.002);
		assertRelClose(res.values.sLinePhaseDeg, 78.69, 0.001);
	});

	// ST-02: Summer 2023 Final Q4d / Lecture 2&3 Example 1
	it('ST-02 (QT-MAG-1): Series core + air gap with 5% and 0% fringing', () => {
		const resFringe = solveLinearMagneticCircuit({
			coreLengthM: 0.4,
			coreAreaM2: 12e-4,
			muR: 4000,
			gapLengthM: 0.0005,
			fringingPercent: 5,
			turns: 400,
			excitationMode: 'flux-density',
			gapFluxDensityT: 0.5
		});
		assertValidResult(resFringe, 'QT-MAG-1');
		assertRelClose(resFringe.values.rCore, 66314.6, 0.001);
		assertRelClose(resFringe.values.rGap, 315783.6, 0.001);
		assertRelClose(resFringe.values.currentA, 0.6018, 0.001);
		assertRelClose(resFringe.values.inductanceH, 0.4187, 0.001);

		const resNoFringe = solveLinearMagneticCircuit({
			coreLengthM: 0.4,
			coreAreaM2: 12e-4,
			muR: 4000,
			gapLengthM: 0.0005,
			fringingPercent: 0,
			turns: 400,
			excitationMode: 'flux-density',
			gapFluxDensityT: 0.5
		});
		assertValidResult(resNoFringe, 'QT-MAG-1');
		assertRelClose(resNoFringe.values.rGap, 331572.8, 0.001);
		assertRelClose(resNoFringe.values.currentA, 0.5968, 0.001);
		assertRelClose(resNoFringe.values.inductanceH, 0.4021, 0.001);
	});

	// ST-03: Fall 2024 Final Q4a / Spring 2025 Final Q3b
	it('ST-03 (QT-MAG-1): Iron ring with air gap (area-independent B_g, H_c, M)', () => {
		const res = solveLinearMagneticCircuit({
			coreLengthM: 0.5,
			muR: 400,
			gapLengthM: 0.001,
			turns: 300,
			excitationMode: 'current',
			currentA: 1
		});
		assertValidResult(res, 'QT-MAG-1');
		assertRelClose(res.values.bGapT, 0.1676, 0.001);
		assertRelClose(res.values.hCore, 333.33, 0.001);
		assertRelClose(res.values.magnetization, 133000, 0.001);
	});

	// ST-04: Fall 2023 Q4b / Spring 2024 Q4b / Lecture 2&3 Ex 3a,b
	it('ST-04 (QT-MAG-1): Core with and without 1 mm air gap', () => {
		const resNoGap = solveLinearMagneticCircuit({
			coreLengthM: 0.3,
			coreAreaM2: Math.PI * 1e-4,
			muR: 4000,
			gapLengthM: 0,
			turns: 600,
			excitationMode: 'flux',
			fluxWb: 0.5e-3
		});
		assertValidResult(resNoGap, 'QT-MAG-1');
		assertRelClose(resNoGap.values.rEq, 189977.2, 0.001);
		assertRelClose(resNoGap.values.currentA, 0.1583, 0.001);
		assertRelClose(resNoGap.values.inductanceH, 1.895, 0.001);
		assertRelClose(resNoGap.values.storedEnergyJ, 0.0237, 0.003);

		const resGap = solveLinearMagneticCircuit({
			coreLengthM: 0.3,
			coreAreaM2: Math.PI * 1e-4,
			muR: 4000,
			gapLengthM: 0.001,
			turns: 600,
			excitationMode: 'flux',
			fluxWb: 0.5e-3
		});
		assertValidResult(resGap, 'QT-MAG-1');
		assertRelClose(resGap.values.rEq, 2723006.8, 0.001);
		assertRelClose(resGap.values.currentA, 2.2692, 0.001);
		assertRelClose(resGap.values.inductanceH, 0.1322, 0.001);
		assertRelClose(resGap.values.storedEnergyJ, 0.3404, 0.001);
	});

	// ST-05: Lecture 2&3 Example 3c (Nonlinear B-H table)
	it('ST-05 (QT-MAG-2): Nonlinear ferromagnetic core with 1 mm air gap', () => {
		const res = solveNonlinearOrParallelMagnetic({
			topology: 'series-nonlinear',
			coreLengthM: 0.3,
			coreAreaM2: Math.PI * 1e-4,
			gapLengthM: 0.001,
			turns: 600,
			solveFor: 'current',
			fluxWb: 0.5e-3,
			bhTable: [
				{ H: 2500, B: 1.55 },
				{ H: 3000, B: 1.59 },
				{ H: 3500, B: 1.6 },
				{ H: 4000, B: 1.615 }
			]
		});
		assertValidResult(res, 'QT-MAG-2');
		assertRelClose(res.values.bCoreT, 1.5915, 0.001);
		assertRelClose(res.values.hGap, 1.2665e6, 0.001);
		// Piecewise-linear interpolation between (3000, 1.59) and (3500, 1.60) gives H_c = 3077.47 A/m -> I = 3.6496 A
		// (Doctor's slide rounds B_c = 1.5915 T directly to table point H_c = 3000 A/m -> I = 3.611 A, ~1.07% lower)
		assertRelClose(res.values.hCore, 3077.47, 0.001);
		assertRelClose(res.values.currentA, 3.6496, 0.001);
	});

	// ST-06: Spring 2026 Final Q3b (2-Gap Relay, Slow Closure)
	it('ST-06 (QT-MAG-3): 2-gap relay slow closure at constant current', () => {
		const res = solveVariableReluctanceActuator({
			coreLengthM: 0.5,
			coreAreaM2: 0.003,
			muR: 400,
			turns: 300,
			numGaps: 2,
			initialGapM: 0.004,
			finalGapM: 0,
			constraint: 'constant-current',
			initialFluxDensityT: 1.1
		});
		assertValidResult(res, 'QT-MAG-3');
		assertRelClose(res.values.rCore, 331572.8, 0.001);
		assertRelClose(res.values.rGap1, 2122065.9, 0.001);
		assertRelClose(res.values.rEq1, 2453638.7, 0.001);
		assertRelClose(res.values.i1A, 26.99, 0.001);
		assertRelClose(res.values.lambda1, 0.99, 0.001);
		assertRelClose(res.values.wf1J, 13.36, 0.001);
		assertRelClose(res.values.l1mH, 36.68, 0.001);
		assertRelClose(res.values.lambda2, 7.326, 0.001);
		assertRelClose(res.values.wf2J, 98.864, 0.001);
		assertRelClose(res.values.l2mH, 271.43, 0.001);
		assertRelClose(res.values.wmJ, 85.504, 0.001);
		assertRelClose(res.values.wmKwh, 2.3751e-5, 0.001);
	});

	// ST-07: Summer 2024 Final Q4b (Variable Reluctance, Constant Flux)
	it('ST-07 (QT-MAG-3): Ideal core single-gap variable reluctance at constant flux', () => {
		const res = solveVariableReluctanceActuator({
			coreLengthM: 0,
			coreAreaM2: 15e-4,
			muR: Infinity,
			idealCore: true,
			turns: 100,
			numGaps: 1,
			initialGapM: 0.04,
			finalGapM: 0,
			constraint: 'constant-flux',
			initialFluxWb: 0.1
		});
		assertValidResult(res, 'QT-MAG-3');
		assertRelClose(res.values.rEq1, 21.221e6, 0.001);
		assertRelClose(res.values.l1mH, 0.4712, 0.001);
		assertRelClose(res.values.i1A, 21220.7, 0.001);
		assertRelClose(res.values.wf1J, 106103.3, 0.001);
		expect(res.values.rEq2).toBe(0);
		expect(res.values.i2A).toBe(0);
		expect(res.values.wf2J).toBe(0);
	});

	// ST-08: Spring 2026 Final Q4b / Summer 2023 Q3c
	it('ST-08 (QT-XFMR-1): Core loss separation at constant B_m (40 & 60 Hz -> 50 Hz)', () => {
		const res = solveTransformerEmfAndCoreLoss({
			mode: 'loss-separation',
			f1Hz: 40,
			pc1W: 52,
			f2Hz: 60,
			pc2W: 90,
			targetFreqHz: 50
		});
		assertValidResult(res, 'QT-XFMR-1');
		assertRelClose(res.values.coeffA, 0.9, 1e-6);
		assertRelClose(res.values.coeffB, 0.01, 1e-6);
		assertRelClose(res.values.phTargetW, 45.0, 1e-6);
		assertRelClose(res.values.peTargetW, 25.0, 1e-6);
		assertRelClose(res.values.pcTargetW, 70.0, 1e-6);
	});

	// ST-09: Fall 2023 Q3b / Spring 2025 Q4.6 & Spring 2024 Q3b
	it('ST-09 (QT-XFMR-1): Core loss (V, f) scaling with Steinmetz n = 1.6', () => {
		const res230 = solveTransformerEmfAndCoreLoss({
			mode: 'vf-scaling',
			v1V: 220,
			f1Hz: 60,
			ph1W: 340,
			pe1W: 120,
			v2V: 230,
			f2Hz: 50,
			steinmetzN: 1.6
		});
		assertValidResult(res230, 'QT-XFMR-1');
		assertRelClose(res230.values.ph2W, 407.26, 0.001);
		assertRelClose(res230.values.pe2W, 131.16, 0.001);
		assertRelClose(res230.values.pc2W, 538.42, 0.001);

		const res220 = solveTransformerEmfAndCoreLoss({
			mode: 'vf-scaling',
			v1V: 220,
			f1Hz: 60,
			ph1W: 340,
			pe1W: 120,
			v2V: 220,
			f2Hz: 50,
			steinmetzN: 1.6
		});
		assertValidResult(res220, 'QT-XFMR-1');
		assertRelClose(res220.values.ph2W, 379.3, 0.001);
		assertRelClose(res220.values.pe2W, 120.0, 1e-6);
		assertRelClose(res220.values.pc2W, 499.3, 0.001);
	});

	// ST-10: Spring 2024 Final Q3a
	it('ST-10 (QT-XFMR-2): 20 kVA 2000/200 V OC/SC tests & FL 0.8 lag performance', () => {
		const res = solveTransformerOcScTests({
			ratedVA: 20_000,
			v1Rated: 2000,
			v2Rated: 200,
			frequencyHz: 50,
			ocSide: 'LV',
			vOc: 200,
			iOc: 4,
			pOc: 120,
			scSide: 'HV',
			vSc: 60,
			iSc: 10,
			pSc: 300,
			referTo: 'primary',
			evalLoadFraction: 1,
			evalPf: 0.8,
			evalPfType: 'lag'
		});
		assertValidResult(res, 'QT-XFMR-2');
		assertRelClose(res.values.rcRef, 33333.3, 0.001);
		assertRelClose(res.values.xmRef, 5057.2, 0.001);
		assertRelClose(res.values.reRef, 3.0, 0.001);
		assertRelClose(res.values.xeRef, 5.196, 0.001);
		assertRelClose(res.values.vrExactPercent, 2.766, 0.002);
		assertRelClose(res.values.vrApproxPercent, 2.759, 0.002);
		assertRelClose(res.values.efficiencyPercent, 97.44, 0.001);
	});

	// ST-11: Fall 2024 Final Q3c (Step-up 200/400 V)
	it('ST-11 (QT-XFMR-2): 4 kVA 200/400 V step-up transformer OC/SC tests', () => {
		const res = solveTransformerOcScTests({
			ratedVA: 4000,
			v1Rated: 200,
			v2Rated: 400,
			frequencyHz: 50,
			ocSide: 'LV',
			vOc: 200,
			iOc: 0.8,
			pOc: 70,
			scSide: 'HV',
			vSc: 20,
			iSc: 10,
			pSc: 60,
			referTo: 'primary',
			evalLoadFraction: 1,
			evalPf: 0.8,
			evalPfType: 'lag'
		});
		assertValidResult(res, 'QT-XFMR-2');
		assertRelClose(res.values.efficiencyPercent, 96.1, 0.001);
		assertRelClose(res.values.xMaxEff, 1.0801, 0.001);
		assertRelClose(res.values.sMaxEffKVA, 4.32, 0.001);
		assertRelClose(res.values.i1Mag, 20.715, 0.001);
		assertRelClose(res.values.i1Deg, -37.88, 0.001);
	});

	// ST-12: Spring 2026 Q4a / Summer 2024 Q3c / Summer 2023 Q3b
	it('ST-12 (QT-XFMR-3): 2.2 kVA 440/220 V transformer at FL 0.707 lag', () => {
		const res = solveTransformerOnLoad({
			ratedVA: 2200,
			v1Rated: 440,
			v2Rated: 220,
			frequencyHz: 50,
			paramRef: 'primary',
			re: 3,
			xe: 4,
			rc: 2500,
			xm: 2000,
			loadFraction: 1,
			pf: 0.707,
			pfType: 'lag'
		});
		assertValidResult(res, 'QT-XFMR-3');
		assertRelClose(res.values.vrExactPercent, 5.628, 0.002);
		assertRelClose(res.values.vrApproxPercent, 5.625, 0.002);
		assertRelClose(res.values.pCoreW, 77.44, 0.001);
		assertRelClose(res.values.pCuW, 75.0, 0.001);
		assertRelClose(res.values.efficiencyPercent, 91.07, 0.001);
		assertRelClose(res.values.sMaxEffKVA, 2.236, 0.001);
	});

	// ST-13: Fall 2025 Q3b / Summer 2025 Q3b
	it('ST-13 (QT-XFMR-3): 10 kVA 2000/200 V max efficiency & VR at 8 kW, 0.8 lag', () => {
		const res = solveTransformerOnLoad({
			ratedVA: 10_000,
			v1Rated: 2000,
			v2Rated: 200,
			frequencyHz: 50,
			paramRef: 'primary',
			re: 2,
			xe: 4,
			pCoreW: 125,
			pfNoLoad: 0.15,
			loadWatts: 8000,
			pf: 0.8,
			pfType: 'lag'
		});
		assertValidResult(res, 'QT-XFMR-3');
		assertRelClose(res.values.pCuFlW, 50.0, 0.001);
		assertRelClose(res.values.xMaxEff, 1.5811, 0.001);
		assertRelClose(res.values.sMaxEffKVA, 15.811, 0.001);
		assertRelClose(res.values.etaMaxAtUpf, 98.44, 0.001);
		assertRelClose(res.values.vrExactPercent, 1.001, 0.002);
		assertRelClose(res.values.vrApproxPercent, 1.0, 0.002);
	});

	// ST-14: Sheet 3 Q11
	it('ST-14 (QT-XFMR-4): 500 kVA two-point loss separation (95% at FL & 60% FL)', () => {
		const res = solveTransformerEfficiencyLoad({
			mode: 'two-point-separation',
			ratedVA: 500_000,
			point1: { loadFraction: 1, pf: 1, efficiencyPercent: 95 },
			point2: { loadFraction: 0.6, pf: 1, efficiencyPercent: 95 },
			targetLoadFraction: 0.75,
			targetPf: 1
		});
		assertValidResult(res, 'QT-XFMR-4');
		assertRelClose(res.values.pCuFlKW, 16.447, 0.001);
		assertRelClose(res.values.pCoreKW, 9.868, 0.001);
		assertRelClose(res.values.efficiencyPercent, 95.15, 0.001);
	});

	// ST-15: Summer 2024 Q3b / Fall 2023 Q3a / Sheet 3 Q9
	it('ST-15 (QT-XFMR-4): 30 kVA half-load, full-load & max efficiency', () => {
		const resHalf = solveTransformerEfficiencyLoad({
			mode: 'known-losses',
			ratedVA: 30_000,
			pCoreW: 360,
			pCuFlW: 480,
			loadFraction: 0.5,
			pf: 1,
			maxEffPf: 1
		});
		assertValidResult(resHalf, 'QT-XFMR-4');
		assertRelClose(resHalf.values.efficiencyPercent, 96.9, 0.001);
		assertRelClose(resHalf.values.xMaxEff, 0.866, 0.001);
		assertRelClose(resHalf.values.sMaxEffKVA, 25.98, 0.001);

		const resFull = solveTransformerEfficiencyLoad({
			mode: 'known-losses',
			ratedVA: 30_000,
			pCoreW: 360,
			pCuFlW: 480,
			loadFraction: 1,
			pf: 1,
			maxEffPf: 1
		});
		assertValidResult(resFull, 'QT-XFMR-4');
		assertRelClose(resFull.values.efficiencyPercent, 97.28, 0.001);
	});

	// ST-16: Summer 2024 Final Q4a
	it('ST-16 (QT-DC-1): Torque constant K_t of 25 HP separately excited DC motor', () => {
		const res = solveDcEmfAndTorque({
			mode: 'operating-point',
			machineMode: 'motor',
			vtV: 120,
			raOhm: 0.473,
			speedRpm: 250,
			armatureCurrentA: 5.6
		});
		assertValidResult(res, 'QT-DC-1');
		assertRelClose(res.values.eaV, 117.351, 0.001);
		assertRelClose(res.values.omegaRadS, 26.18, 0.001);
		assertRelClose(res.values.kt, 4.4825, 0.001);
	});

	// ST-17: Sheet 4 Q2
	it('ST-17 (QT-DC-1): Torque scaling at constant field current (20 A -> 10 A)', () => {
		const res = solveDcEmfAndTorque({
			mode: 'operating-point',
			machineMode: 'motor',
			vtV: 250,
			raOhm: 0.5,
			speedRpm: 1500,
			armatureCurrentA: 20,
			targetArmatureCurrentA: 10
		});
		assertValidResult(res, 'QT-DC-1');
		assertRelClose(res.values.eaV, 240.0, 0.001);
		assertRelClose(res.values.td1Nm, 30.56, 0.001);
		assertRelClose(res.values.td2Nm, 15.28, 0.001);
	});

	// ST-18: Summer 2024 Q4c / Summer 2023 Q4c
	it('ST-18 (QT-DC-2): DC shunt generator load current', () => {
		const res = solveDcGenerator({
			generatorType: 'shunt',
			solveFor: 'load-from-emf',
			eaV: 254,
			vtV: 240,
			raOhm: 0.04,
			rfOhm: 24
		});
		assertValidResult(res, 'QT-DC-2');
		assertRelClose(res.values.iaA, 350.0, 1e-6);
		assertRelClose(res.values.ifA, 10.0, 1e-6);
		assertRelClose(res.values.iLoadA, 340.0, 1e-6);
	});

	// ST-19: Fall 2025 Q3c / Summer 2025 Q3c / Spring 2025 Q3d / Fall 2023 Q3c
	it('ST-19 (QT-DC-3): DC motor voltage reduced by 20% at constant P_in', () => {
		const res = solveDcMotor({
			motorType: 'separately-excited',
			vt1V: 240,
			n1Rpm: 1000,
			raOhm: 0.221,
			pIn1W: 7800,
			controlMode: 'terminal-voltage',
			vt2V: 192,
			loadConstraint: 'constant-power'
		});
		assertValidResult(res, 'QT-DC-3');
		assertRelClose(res.values.ia1A, 32.5, 0.001);
		assertRelClose(res.values.ea1V, 232.817, 0.001);
		assertRelClose(res.values.ke, 2.2232, 0.001);
		assertRelClose(res.values.keRpm, 0.23282, 0.001);
		assertRelClose(res.values.ia2A, 40.625, 0.001);
		assertRelClose(res.values.ea2V, 183.022, 0.001);
		assertRelClose(res.values.n2Rpm, 786.12, 0.001);
	});

	// ST-20: Spring 2024 Q3c / Fall 2024 Q4b
	it('ST-20 (QT-DC-3): DC shunt motor with added R_add = 1.0 Ohm at FL and 2x FL torque', () => {
		const resFl = solveDcMotor({
			motorType: 'shunt',
			vt1V: 240,
			n1Rpm: 600,
			raOhm: 0.4,
			ia1A: 25,
			controlMode: 'armature-resistance',
			rAddOhm: 1.0,
			torqueRatio: 1
		});
		assertValidResult(resFl, 'QT-DC-3');
		assertRelClose(resFl.values.ea1V, 230.0, 1e-6);
		assertRelClose(resFl.values.ea2V, 205.0, 1e-6);
		assertRelClose(resFl.values.n2Rpm, 534.78, 0.001);

		const res2Fl = solveDcMotor({
			motorType: 'shunt',
			vt1V: 240,
			n1Rpm: 600,
			raOhm: 0.4,
			ia1A: 25,
			controlMode: 'armature-resistance',
			rAddOhm: 1.0,
			torqueRatio: 2
		});
		assertValidResult(res2Fl, 'QT-DC-3');
		assertRelClose(res2Fl.values.ea2V, 170.0, 1e-6);
		assertRelClose(res2Fl.values.n2Rpm, 443.48, 0.001);
	});

	// ST-21: Fall 2023 Final Q4a
	it('ST-21 (QT-IM-1): 4-pole 50 Hz 10 HP induction motor speeds, f_r & T_fl', () => {
		const res = solveInductionMotorBasic({
			poles: 4,
			frequencyHz: 50,
			slip: 0.04,
			noLoadSlip: 0.01,
			pOutHp: 10
		});
		assertValidResult(res, 'QT-IM-1');
		assertRelClose(res.values.nsRpm, 1500, 1e-6);
		assertRelClose(res.values.nNoLoadRpm, 1485, 1e-6);
		assertRelClose(res.values.nrRpm, 1440, 1e-6);
		assertRelClose(res.values.rotorFreqHz, 2.0, 1e-6);
		assertRelClose(res.values.tShaftNm, 49.47, 0.001);
	});

	// ST-22: Spring 2026 Q3c / Fall 2025 Q4b / Summer 2025 Q4a / Lecture 6 Example
	it('ST-22 (QT-IM-2): 480 V 50 HP induction motor forward power flow (60 Hz & 50 Hz)', () => {
		const res60 = solveInductionMotorPowerFlow({
			direction: 'forward',
			connection: 'Y',
			vLineV: 480,
			poles: 4,
			frequencyHz: 60,
			iLineA: 60,
			pf: 0.85,
			pStatorCuW: 2000,
			pCoreW: 1800,
			pRotorCuW: 700,
			pMechW: 600
		});
		assertValidResult(res60, 'QT-IM-2');
		assertRelClose(res60.values.pInKW, 42.401, 0.001);
		assertRelClose(res60.values.pAirGapKW, 38.601, 0.001);
		assertRelClose(res60.values.slipPercent, 1.813, 0.002);
		assertRelClose(res60.values.pDevKW, 37.901, 0.001);
		assertRelClose(res60.values.pOutKW, 37.301, 0.001);
		assertRelClose(res60.values.efficiencyPercent, 87.97, 0.001);
		assertRelClose(res60.values.nrRpm, 1767.36, 0.001);
		assertRelClose(res60.values.tShaftNm, 201.54, 0.001);

		const res50 = solveInductionMotorPowerFlow({
			direction: 'forward',
			connection: 'D',
			vLineV: 480,
			poles: 4,
			frequencyHz: 50,
			iLineA: 60,
			pf: 0.85,
			pStatorCuW: 2000,
			pCoreW: 1800,
			pRotorCuW: 700,
			pMechW: 600
		});
		assertValidResult(res50, 'QT-IM-2');
		assertRelClose(res50.values.nrRpm, 1472.8, 0.001);
		assertRelClose(res50.values.tShaftNm, 241.85, 0.001);
	});

	// ST-23: Spring 2024 Q4a (Forward) & Sheet 5 Q8 (Backward)
	it('ST-23 (QT-IM-2): Forward (Spring 2024 Q4a) & Backward (Sheet 5 Q8) power flow', () => {
		const resFwd = solveInductionMotorPowerFlow({
			direction: 'forward',
			connection: 'Y',
			vLineV: 500,
			poles: 6,
			frequencyHz: 50,
			pInW: 40_000,
			rotorSpeedRpm: 975,
			pStatorCuW: 1000,
			pCoreW: 0,
			pMechW: 2000
		});
		assertValidResult(resFwd, 'QT-IM-2');
		assertRelClose(resFwd.values.nsRpm, 1000, 1e-6);
		assertRelClose(resFwd.values.slipPercent, 2.5, 0.001);
		assertRelClose(resFwd.values.pAirGapKW, 39.0, 0.001);
		assertRelClose(resFwd.values.pRotorCuW, 975.0, 0.001);
		assertRelClose(resFwd.values.pDevKW, 38.025, 0.001);
		assertRelClose(resFwd.values.pOutKW, 36.025, 0.001);
		assertRelClose(resFwd.values.efficiencyPercent, 90.06, 0.001);

		const resBwd = solveInductionMotorPowerFlow({
			direction: 'backward',
			connection: 'Y',
			poles: 4,
			frequencyHz: 60,
			pOutHp: 100,
			rotorSpeedRpm: 1732,
			pMechW: 900,
			pCoreW: 4200,
			pStatorCuW: 2700
		});
		assertValidResult(resBwd, 'QT-IM-2');
		assertRelClose(resBwd.values.nsRpm, 1800, 1e-6);
		assertRelClose(resBwd.values.slipPercent, 3.778, 0.001);
		assertRelClose(resBwd.values.pDevKW, 75.5, 0.001);
		assertRelClose(resBwd.values.pAirGapKW, 78.464, 0.001);
		assertRelClose(resBwd.values.pRotorCuKW, 2.964, 0.002);
		assertRelClose(resBwd.values.pInKW, 85.364, 0.001);
		assertRelClose(resBwd.values.efficiencyPercent, 87.39, 0.001);
	});

	// ST-24: Sheet 5 Q7 (Exact T-circuit & Approx. Cantilever circuit)
	it('ST-24 (QT-IM-3): 208 V 30 HP IM equivalent circuit (Exact T & Approx. Cantilever)', () => {
		const resExact = solveInductionMotorEquivCircuit({
			model: 'exact-T',
			connection: 'Y',
			vLineV: 208,
			poles: 4,
			frequencyHz: 60,
			slip: 0.05,
			r1: 0.1,
			x1: 0.21,
			r2Prime: 0.07,
			x2Prime: 0.21,
			xm: 10,
			pCoreW: 400,
			pMechW: 500
		});
		assertValidResult(resExact, 'QT-IM-3');
		assertRelClose(resExact.values.zEqRe, 1.4182, 0.001);
		assertRelClose(resExact.values.zEqIm, 0.5964, 0.001);
		assertRelClose(resExact.values.i1Mag, 78.05, 0.001);
		assertRelClose(resExact.values.i1Deg, -22.81, 0.001);
		assertRelClose(resExact.values.i2PrimeMag, 75.74, 0.001);
		assertRelClose(resExact.values.pStatorCuW, 1827.7, 0.001);
		assertRelClose(resExact.values.pAirGapW, 24093.6, 0.001);
		assertRelClose(resExact.values.pDevW, 22888.9, 0.001);
		assertRelClose(resExact.values.pOutW, 22388.9, 0.001);
		assertRelClose(resExact.values.tdNm, 127.82, 0.001);
		assertRelClose(resExact.values.tShaftNm, 125.03, 0.001);
		assertRelClose(resExact.values.efficiencyPercent, 85.06, 0.001);

		const resApprox = solveInductionMotorEquivCircuit({
			model: 'approx-cantilever',
			connection: 'Y',
			vLineV: 208,
			poles: 4,
			frequencyHz: 60,
			slip: 0.05,
			r1: 0.1,
			x1: 0.21,
			r2Prime: 0.07,
			x2Prime: 0.21,
			xm: 10,
			pCoreW: 400,
			pMechW: 500
		});
		assertValidResult(resApprox, 'QT-IM-3');
		assertRelClose(resApprox.values.i2PrimeMag, 77.09, 0.001);
		assertRelClose(resApprox.values.pAirGapW, 24962.7, 0.001);
		assertRelClose(resApprox.values.tdNm, 132.43, 0.001);
		assertRelClose(resApprox.values.tStartNm, 78.26, 0.001);
	});
});

describe('Catalog Presets, Dispatcher & Invalid-Input Handling', () => {
	it('executes every catalog preset across all 14 question types with valid results', () => {
		expect(MACHINE_CATEGORIES).toHaveLength(5);
		const allIds = Object.keys(MACHINE_QUESTION_TYPES) as MachineQuestionTypeId[];
		expect(allIds).toHaveLength(14);

		for (const id of allIds) {
			const meta = MACHINE_QUESTION_TYPES[id];
			expect(meta.presets.length).toBeGreaterThanOrEqual(1);
			for (const preset of meta.presets) {
				const res = solveMachineQuestion(id, preset.input as never);
				assertValidResult(res, id);
			}
		}
	});

	it('returns valid: false with clear error messages for invalid inputs', () => {
		const badPf = solveThreePhase({
			loadConnection: 'Y',
			voltageType: 'line',
			voltageV: 400,
			loadMode: 'power',
			powerW: 10000,
			pf: 1.5
		});
		expect(badPf.valid).toBe(false);
		expect(badPf.error).toBeTruthy();

		const negRes = solveDcMotor({
			motorType: 'shunt',
			vt1V: 240,
			n1Rpm: 1000,
			raOhm: -0.5,
			ia1A: 20,
			controlMode: 'armature-resistance',
			rAddOhm: 1
		});
		expect(negRes.valid).toBe(false);
		expect(negRes.error).toBeTruthy();

		const badPoles = solveInductionMotorBasic({
			poles: 3,
			frequencyHz: 50,
			slip: 0.04
		});
		expect(badPoles.valid).toBe(false);
		expect(badPoles.error).toBeTruthy();

		const badXfmr = solveTransformerOnLoad({
			ratedVA: 10000,
			v1Rated: 2000,
			v2Rated: 200,
			re: -1,
			xe: 4,
			pf: 0.8,
			pfType: 'lag'
		});
		expect(badXfmr.valid).toBe(false);
		expect(badXfmr.error).toBeTruthy();

		const badMag = solveLinearMagneticCircuit({
			coreLengthM: 0.4,
			coreAreaM2: 1e-3,
			muR: 0,
			gapLengthM: 0.001,
			turns: 100,
			excitationMode: 'current',
			currentA: 1
		});
		expect(badMag.valid).toBe(false);
		expect(badMag.error).toBeTruthy();
	});

	it('QT-3PH-1 returns exhaustive positive-sequence voltages, currents, power, and phasors for Y and Delta loads', () => {
		const yRes = solveThreePhase({
			loadConnection: 'Y',
			voltageType: 'line',
			voltageV: 400,
			loadMode: 'impedance',
			loadR: 8,
			loadX: 6,
			lineR: 0.5,
			lineX: 1
		});
		assertValidResult(yRes, 'QT-3PH-1');
		const yKeys = new Set(yRes.answers.map((a) => a.key));
		for (const k of [
			'vAn',
			'vBn',
			'vCn',
			'vAb',
			'vBc',
			'vCa',
			'vSourcePhaseMag',
			'vBnSrc',
			'vCnSrc',
			'vSourceLineMag',
			'vBcSrc',
			'vCaSrc',
			'iLineMag',
			'iB',
			'iC',
			'pTotalW',
			'qTotalVar',
			'sTotalVA',
			'pfLoad',
			'pPhaseW',
			'pLineTotalW',
			'pSourceTotalW',
			'efficiencyPercent'
		]) {
			expect(yKeys.has(k), `Y-load answers should contain ${k}`).toBe(true);
		}
		expect(yRes.phasors?.length ?? 0).toBeGreaterThanOrEqual(9);
		expect(yRes.answers.every((a) => Boolean(a.group))).toBe(true);

		const dRes = solveThreePhase({
			loadConnection: 'D',
			voltageType: 'line',
			voltageV: 400,
			loadMode: 'impedance',
			loadR: 12,
			loadX: 9
		});
		assertValidResult(dRes, 'QT-3PH-1');
		const dKeys = new Set(dRes.answers.map((a) => a.key));
		for (const k of ['iLineMag', 'iB', 'iC', 'iPhaseMag', 'iBc', 'iCa']) {
			expect(dKeys.has(k), `Delta-load answers should contain ${k}`).toBe(true);
		}
		expect(dRes.phasors?.length ?? 0).toBe(12);
	});

	it('QT-XFMR-2 returns both primary and secondary referred parameters, and QT-XFMR-3 includes phasors', () => {
		const ocSc = solveTransformerOcScTests({
			ratedVA: 20_000,
			v1Rated: 2000,
			v2Rated: 200,
			frequencyHz: 50,
			ocSide: 'LV',
			vOc: 200,
			iOc: 4,
			pOc: 120,
			scSide: 'HV',
			vSc: 60,
			iSc: 10,
			pSc: 300,
			referTo: 'primary'
		});
		assertValidResult(ocSc, 'QT-XFMR-2');
		const keys = new Set(ocSc.answers.map((a) => a.key));
		for (const k of ['rc1', 'xm1', 're1', 'xe1', 'rc2', 'xm2', 're2', 'xe2', 'iOc', 'iwOc', 'imOc', 'cosPhi0', 'turnsRatio']) {
			expect(keys.has(k), `QT-XFMR-2 answers should contain ${k}`).toBe(true);
		}
		assertRelClose(ocSc.values.rc2, ocSc.values.rc1 / 100, 1e-6);
		assertRelClose(ocSc.values.re2, ocSc.values.re1 / 100, 1e-6);

		const onLoad = solveTransformerOnLoad({
			ratedVA: 20_000,
			v1Rated: 2000,
			v2Rated: 200,
			paramRef: 'primary',
			re: 3,
			xe: 5.196,
			rc: 33333,
			xm: 5058,
			loadFraction: 1,
			pf: 0.8,
			pfType: 'lag'
		});
		assertValidResult(onLoad, 'QT-XFMR-3');
		expect(onLoad.phasors?.length).toBe(4);
	});
});
