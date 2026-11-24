import {
	HP_TO_WATTS,
	SQRT3,
	c,
	cAbs,
	cAdd,
	cArgDeg,
	cDiv,
	cMul,
	cParallel,
	errorResult,
	fmt,
	fmtComplex,
	fmtPolar,
	fmtPolarTex,
	isFiniteNonNeg,
	isFinitePos,
	makeAnswer
} from './math-helpers';
import type {
	InductionMotorBasicInput,
	InductionMotorEquivCircuitInput,
	InductionMotorPowerFlowInput,
	MachineAnswerItem,
	MachineSolveResult,
	MachineStep
} from './types';

const TITLE_IM1 = 'Induction Motor Speed, Slip & Rated Torque';
const TITLE_IM2 = 'Induction Motor Power Flow Analysis';
const TITLE_IM3 = 'Induction Motor Equivalent Circuit Analysis';

// ============================================================================
// QT-IM-1: Synchronous Speed, Slip, Rotor Speed, Rotor Frequency & Shaft Torque
// ============================================================================

export function solveInductionMotorBasic(input: InductionMotorBasicInput): MachineSolveResult {
	if (!isFinitePos(input.poles) || input.poles % 2 !== 0) {
		return errorResult('QT-IM-1', TITLE_IM1, 'Number of poles P must be a positive even integer.');
	}
	if (!isFinitePos(input.frequencyHz)) {
		return errorResult('QT-IM-1', TITLE_IM1, 'Supply frequency f_s must be positive.');
	}

	const nsRpm = (120 * input.frequencyHz) / input.poles;
	const omegaS = (2 * Math.PI * nsRpm) / 60;

	let slip: number;
	let nrRpm: number;
	if (isFiniteNonNeg(input.slip) && input.slip <= 1) {
		slip = input.slip;
		nrRpm = (1 - slip) * nsRpm;
	} else if (isFiniteNonNeg(input.rotorSpeedRpm) && input.rotorSpeedRpm <= nsRpm) {
		nrRpm = input.rotorSpeedRpm;
		slip = (nsRpm - nrRpm) / nsRpm;
	} else {
		return errorResult(
			'QT-IM-1',
			TITLE_IM1,
			'Provide valid slip (0 <= s <= 1) or rotorSpeedRpm (0 <= N_r <= N_s).'
		);
	}

	const omegaR = (2 * Math.PI * nrRpm) / 60;
	const slipSpeedRpm = nsRpm - nrRpm;
	const rotorFreqHz = slip * input.frequencyHz;

	const steps: MachineStep[] = [
		{
			title: 'Synchronous Speed',
			formulaLatex: 'N_s = \\frac{120 f_s}{P}, \\quad \\omega_s = \\frac{2\\pi N_s}{60}',
			substitutionLatex: `N_s = \\frac{120(${input.frequencyHz})}{${input.poles}}`,
			resultLatex: `N_s = ${fmt(nsRpm, 2)}\\text{ rpm}, \\quad \\omega_s = ${fmt(omegaS, 3)}\\text{ rad/s}`
		},
		{
			title: 'Slip, Rotor Speed & Rotor Frequency',
			formulaLatex: 's = \\frac{N_s - N_r}{N_s}, \\quad N_r = (1 - s)N_s, \\quad f_r = s f_s',
			substitutionLatex: `N_r = (1 - ${fmt(slip, 4)})(${fmt(nsRpm, 1)}), \\quad f_r = (${fmt(slip, 4)})(${input.frequencyHz})`,
			resultLatex: `s = ${fmt(slip * 100, 3)}\\%, \\quad N_r = ${fmt(nrRpm, 2)}\\text{ rpm}, \\quad f_r = ${fmt(rotorFreqHz, 3)}\\text{ Hz}`
		}
	];

	const answers: MachineAnswerItem[] = [
		makeAnswer('nsRpm', 'Synchronous Speed', nsRpm, 'rpm', {
			symbolLatex: 'N_s',
			decimals: 2,
			highlight: true,
			group: 'mechanical'
		}),
		makeAnswer('nrRpm', 'Rotor Speed', nrRpm, 'rpm', {
			symbolLatex: 'N_r',
			decimals: 2,
			highlight: true,
			group: 'mechanical'
		}),
		makeAnswer('omegaS', 'Synchronous Angular Speed', omegaS, 'rad/s', {
			symbolLatex: '\\omega_s',
			decimals: 3,
			group: 'mechanical'
		}),
		makeAnswer('omegaR', 'Rotor Angular Speed', omegaR, 'rad/s', {
			symbolLatex: '\\omega_r',
			decimals: 3,
			group: 'mechanical'
		}),
		makeAnswer('slipPercent', 'Slip', slip * 100, '%', {
			symbolLatex: 's',
			decimals: 3,
			group: 'general'
		}),
		makeAnswer('rotorFreqHz', 'Rotor Current Frequency', rotorFreqHz, 'Hz', {
			symbolLatex: 'f_r',
			decimals: 3,
			highlight: true,
			group: 'general'
		})
	];

	const values: Record<string, number> = {
		nsRpm,
		omegaS,
		slip,
		slipPercent: slip * 100,
		nrRpm,
		omegaR,
		slipSpeedRpm,
		rotorFreqHz
	};

	if (isFiniteNonNeg(input.noLoadSlip) && input.noLoadSlip < 1) {
		const nNoLoadRpm = (1 - input.noLoadSlip) * nsRpm;
		values.nNoLoadRpm = nNoLoadRpm;
		answers.push(
			makeAnswer('nNoLoadRpm', 'No-Load Rotor Speed', nNoLoadRpm, 'rpm', {
				symbolLatex: 'N_{nl}',
				decimals: 2,
				group: 'mechanical'
			})
		);
	}

	const pOutW = isFinitePos(input.pOutW)
		? input.pOutW
		: isFinitePos(input.pOutHp)
			? input.pOutHp * HP_TO_WATTS
			: undefined;

	if (pOutW !== undefined && omegaR > 0) {
		const tShaftNm = pOutW / omegaR;
		values.pOutW = pOutW;
		values.tShaftNm = tShaftNm;
		steps.push({
			title: 'Rated Shaft Torque',
			formulaLatex: 'T_{\\text{sh}} = \\frac{P_{\\text{out}}}{\\omega_r} = \\frac{P_{\\text{out}}}{2\\pi N_r / 60}',
			substitutionLatex: `T_{\\text{sh}} = \\frac{${fmt(pOutW, 1)}}{${fmt(omegaR, 3)}}`,
			resultLatex: `T_{\\text{sh}} = ${fmt(tShaftNm, 2)}\\text{ N}\\cdot\\text{m}`
		});
		answers.push(
			makeAnswer('tShaftNm', 'Shaft Torque', tShaftNm, 'N·m', {
				symbolLatex: 'T_{\\text{sh}}',
				decimals: 2,
				highlight: true,
				group: 'mechanical'
			}),
			makeAnswer('pOutW', 'Shaft Output Power', pOutW, 'W', {
				symbolLatex: 'P_{\\text{out}}',
				decimals: 1,
				group: 'power',
				formatted: `${fmt(pOutW / 1000, 3)} kW`
			})
		);
	}

	return { valid: true, questionType: 'QT-IM-1', title: TITLE_IM1, answers, values, steps };
}

// ============================================================================
// QT-IM-2: Induction Motor Power Flow Stage Analysis (Forward & Backward)
// ============================================================================

export function solveInductionMotorPowerFlow(
	input: InductionMotorPowerFlowInput
): MachineSolveResult {
	if (!isFinitePos(input.poles) || input.poles % 2 !== 0) {
		return errorResult('QT-IM-2', TITLE_IM2, 'Number of poles P must be a positive even integer.');
	}
	if (!isFinitePos(input.frequencyHz)) {
		return errorResult('QT-IM-2', TITLE_IM2, 'Supply frequency f_s must be positive.');
	}

	const pStatorCu = input.pStatorCuW ?? 0;
	const pCore = input.pCoreW ?? 0;
	const pMech = input.pMechW ?? 0;
	if (!isFiniteNonNeg(pStatorCu) || !isFiniteNonNeg(pCore) || !isFiniteNonNeg(pMech)) {
		return errorResult('QT-IM-2', TITLE_IM2, 'Loss terms must be >= 0.');
	}

	const nsRpm = (120 * input.frequencyHz) / input.poles;
	const omegaS = (2 * Math.PI * nsRpm) / 60;

	let pInW: number;
	let pAirGapW: number;
	let pRotorCuW: number;
	let pDevW: number;
	let pOutW: number;
	let slip: number;

	const steps: MachineStep[] = [];

	if (input.direction === 'forward') {
		if (isFinitePos(input.pInW)) {
			pInW = input.pInW;
		} else if (isFinitePos(input.vLineV) && isFinitePos(input.iLineA) && isFinitePos(input.pf) && input.pf <= 1) {
			pInW = SQRT3 * input.vLineV * input.iLineA * input.pf;
		} else {
			return errorResult(
				'QT-IM-2',
				TITLE_IM2,
				'Forward mode requires pInW OR (vLineV, iLineA, pf with 0 < pf <= 1).'
			);
		}

		pAirGapW = pInW - pStatorCu - pCore;
		if (pAirGapW <= 0) {
			return errorResult('QT-IM-2', TITLE_IM2, 'Air-gap power P_g <= 0; stator losses exceed input power.');
		}

		if (isFiniteNonNeg(input.pRotorCuW)) {
			pRotorCuW = input.pRotorCuW;
			slip = pRotorCuW / pAirGapW;
		} else if (isFiniteNonNeg(input.slip) && input.slip < 1) {
			slip = input.slip;
			pRotorCuW = slip * pAirGapW;
		} else if (isFinitePos(input.rotorSpeedRpm) && input.rotorSpeedRpm < nsRpm) {
			slip = (nsRpm - input.rotorSpeedRpm) / nsRpm;
			pRotorCuW = slip * pAirGapW;
		} else {
			return errorResult(
				'QT-IM-2',
				TITLE_IM2,
				'Forward mode requires pRotorCuW, slip, or rotorSpeedRpm.'
			);
		}

		if (slip < 0 || slip >= 1) {
			return errorResult('QT-IM-2', TITLE_IM2, 'Computed slip is outside valid motoring range (0 <= s < 1).');
		}

		pDevW = pAirGapW - pRotorCuW;
		pOutW = pDevW - pMech;

		steps.push({
			title: 'Input Power & Air-Gap Power',
			formulaLatex: 'P_{i/p} = \\sqrt{3}\\,V_L I_L \\cos\\phi, \\quad P_g = P_{i/p} - P_{cu,s} - P_{\\text{core}}',
			resultLatex: `P_{i/p} = ${fmt(pInW / 1000, 3)}\\text{ kW}, \\quad P_g = ${fmt(pAirGapW / 1000, 3)}\\text{ kW}`
		});

		steps.push({
			title: 'Rotor Copper Loss, Slip, Developed & Shaft Output Power',
			formulaLatex: 's = \\frac{P_{cu,r}}{P_g}, \\quad P_d = (1 - s) P_g = P_g - P_{cu,r}, \\quad P_{o/p} = P_d - P_{\\text{mech}}',
			resultLatex: `s = ${fmt(slip * 100, 3)}\\%, \\; P_{cu,r} = ${fmt(pRotorCuW, 1)}\\text{ W}, \\; P_d = ${fmt(pDevW / 1000, 3)}\\text{ kW}, \\; P_{o/p} = ${fmt(pOutW / 1000, 3)}\\text{ kW}`
		});
	} else {
		// Backward power flow: P_out -> P_d -> P_g -> P_in
		if (isFinitePos(input.pOutW)) {
			pOutW = input.pOutW;
		} else if (isFinitePos(input.pOutHp)) {
			pOutW = input.pOutHp * HP_TO_WATTS;
		} else {
			return errorResult('QT-IM-2', TITLE_IM2, 'Backward mode requires positive pOutW or pOutHp.');
		}

		if (isFiniteNonNeg(input.slip) && input.slip < 1) {
			slip = input.slip;
		} else if (isFinitePos(input.rotorSpeedRpm) && input.rotorSpeedRpm < nsRpm) {
			slip = (nsRpm - input.rotorSpeedRpm) / nsRpm;
		} else {
			return errorResult('QT-IM-2', TITLE_IM2, 'Backward mode requires valid slip or rotorSpeedRpm.');
		}

		pDevW = pOutW + pMech;
		pAirGapW = pDevW / (1 - slip);
		pRotorCuW = slip * pAirGapW;
		pInW = pAirGapW + pStatorCu + pCore;

		steps.push({
			title: 'Slip & Backward Stage Power Flow (Shaft → Air-Gap → Stator)',
			formulaLatex:
				's = \\frac{N_s - N_r}{N_s}, \\quad P_d = P_{o/p} + P_{\\text{mech}}, \\quad P_g = \\frac{P_d}{1 - s}, \\quad P_{cu,r} = s P_g, \\quad P_{i/p} = P_g + P_{cu,s} + P_{\\text{core}}',
			resultLatex: `s = ${fmt(slip * 100, 3)}\\%, \\; P_d = ${fmt(pDevW / 1000, 3)}\\text{ kW}, \\; P_g = ${fmt(pAirGapW / 1000, 3)}\\text{ kW}, \\; P_{i/p} = ${fmt(pInW / 1000, 3)}\\text{ kW}`
		});
	}

	const nrRpm = (1 - slip) * nsRpm;
	const omegaR = (2 * Math.PI * nrRpm) / 60;
	const tdNm = pAirGapW / omegaS;
	const tShaftNm = omegaR > 0 ? pOutW / omegaR : 0;
	const efficiencyPercent = pInW > 0 ? (pOutW / pInW) * 100 : 0;

	steps.push({
		title: 'Speed, Torques & Efficiency',
		formulaLatex:
			'N_r = (1 - s)N_s, \\quad T_d = \\frac{P_g}{\\omega_s}, \\quad T_{\\text{sh}} = \\frac{P_{o/p}}{\\omega_r}, \\quad \\eta = \\frac{P_{o/p}}{P_{i/p}}\\times 100\\%',
		resultLatex: `N_r = ${fmt(nrRpm, 2)}\\text{ rpm}, \\; T_d = ${fmt(tdNm, 2)}\\text{ N}\\cdot\\text{m}, \\; T_{\\text{sh}} = ${fmt(tShaftNm, 2)}\\text{ N}\\cdot\\text{m}, \\; \\eta = ${fmt(efficiencyPercent, 2)}\\%`
	});

	const answers: MachineAnswerItem[] = [
		// Power & Efficiency
		makeAnswer('pInKW', 'Stator Input Power', pInW / 1000, 'kW', {
			symbolLatex: 'P_{i/p}',
			decimals: 3,
			group: 'power'
		}),
		makeAnswer('pAirGapKW', 'Air-Gap Power', pAirGapW / 1000, 'kW', {
			symbolLatex: 'P_g',
			decimals: 3,
			group: 'power'
		}),
		makeAnswer('pRotorCuW', 'Rotor Copper Loss', pRotorCuW, 'W', {
			symbolLatex: 'P_{cu,r}',
			decimals: 1,
			group: 'power'
		}),
		makeAnswer('pDevKW', 'Developed Mechanical Power', pDevW / 1000, 'kW', {
			symbolLatex: 'P_d',
			decimals: 3,
			group: 'power'
		}),
		makeAnswer('pOutKW', 'Shaft Output Power', pOutW / 1000, 'kW', {
			symbolLatex: 'P_{o/p}',
			decimals: 3,
			highlight: true,
			group: 'power'
		}),
		makeAnswer('efficiencyPercent', 'Efficiency', efficiencyPercent, '%', {
			symbolLatex: '\\eta',
			decimals: 2,
			highlight: true,
			group: 'power'
		}),
		// Mechanical & Torque
		makeAnswer('nsRpm', 'Synchronous Speed', nsRpm, 'rpm', {
			symbolLatex: 'N_s',
			decimals: 2,
			group: 'mechanical'
		}),
		makeAnswer('nrRpm', 'Rotor Speed', nrRpm, 'rpm', {
			symbolLatex: 'N_r',
			decimals: 2,
			group: 'mechanical'
		}),
		makeAnswer('omegaS', 'Synchronous Angular Speed', omegaS, 'rad/s', {
			symbolLatex: '\\omega_s',
			decimals: 3,
			group: 'mechanical'
		}),
		makeAnswer('omegaR', 'Rotor Angular Speed', omegaR, 'rad/s', {
			symbolLatex: '\\omega_r',
			decimals: 3,
			group: 'mechanical'
		}),
		makeAnswer('tdNm', 'Developed Torque', tdNm, 'N·m', {
			symbolLatex: 'T_d',
			decimals: 2,
			group: 'mechanical'
		}),
		makeAnswer('tShaftNm', 'Shaft Torque', tShaftNm, 'N·m', {
			symbolLatex: 'T_{\\text{sh}}',
			decimals: 2,
			highlight: true,
			group: 'mechanical'
		}),
		// General
		makeAnswer('slipPercent', 'Slip', slip * 100, '%', {
			symbolLatex: 's',
			decimals: 3,
			group: 'general'
		})
	];

	return {
		valid: true,
		questionType: 'QT-IM-2',
		title: TITLE_IM2,
		answers,
		values: {
			nsRpm,
			omegaS,
			slip,
			slipPercent: slip * 100,
			nrRpm,
			omegaR,
			pInW,
			pInKW: pInW / 1000,
			pAirGapW,
			pAirGapKW: pAirGapW / 1000,
			pRotorCuW,
			pRotorCuKW: pRotorCuW / 1000,
			pDevW,
			pDevKW: pDevW / 1000,
			pOutW,
			pOutKW: pOutW / 1000,
			pOutHp: pOutW / HP_TO_WATTS,
			tdNm,
			tShaftNm,
			efficiencyPercent
		},
		steps
	};
}

// ============================================================================
// QT-IM-3: Induction Motor Equivalent Circuit (Exact T & Approx. Cantilever)
// ============================================================================

export function solveInductionMotorEquivCircuit(
	input: InductionMotorEquivCircuitInput
): MachineSolveResult {
	if (!isFinitePos(input.vLineV) || !isFinitePos(input.poles) || input.poles % 2 !== 0 || !isFinitePos(input.frequencyHz)) {
		return errorResult('QT-IM-3', TITLE_IM3, 'V_L, frequency must be positive and poles a positive even integer.');
	}
	if (!isFinitePos(input.slip) || input.slip > 1) {
		return errorResult('QT-IM-3', TITLE_IM3, 'Slip s must satisfy 0 < s <= 1.');
	}
	if (
		!isFiniteNonNeg(input.r1) ||
		!isFiniteNonNeg(input.x1) ||
		!isFinitePos(input.r2Prime) ||
		!isFiniteNonNeg(input.x2Prime) ||
		!isFinitePos(input.xm)
	) {
		return errorResult('QT-IM-3', TITLE_IM3, 'Equivalent circuit parameters must be non-negative (R2\', Xm > 0).');
	}

	const pMechW = input.pMechW ?? 0;
	if (!isFiniteNonNeg(pMechW)) {
		return errorResult('QT-IM-3', TITLE_IM3, 'Mechanical loss must be >= 0.');
	}

	const vPh = input.connection === 'Y' ? input.vLineV / SQRT3 : input.vLineV;
	const vPhComplex = c(vPh, 0);
	const nsRpm = (120 * input.frequencyHz) / input.poles;
	const omegaS = (2 * Math.PI * nsRpm) / 60;
	const nrRpm = (1 - input.slip) * nsRpm;
	const omegaR = (2 * Math.PI * nrRpm) / 60;

	const z1 = c(input.r1, input.x1);
	const zRotor = c(input.r2Prime / input.slip, input.x2Prime);
	const zMag = isFinitePos(input.rc)
		? cParallel(c(input.rc, 0), c(0, input.xm))
		: c(0, input.xm);

	let zEq: ReturnType<typeof c>;
	let i1: ReturnType<typeof c>;
	let i2Prime: ReturnType<typeof c>;
	let pStatorCuW: number;
	let pCoreW: number;
	let pAirGapW: number;
	let pInW: number;
	let tStartNm: number;
	let sMaxT: number;
	let tMaxNm: number;

	const steps: MachineStep[] = [];

	if (input.model === 'exact-T') {
		const zPar = cParallel(zRotor, zMag);
		zEq = cAdd(z1, zPar);
		i1 = cDiv(vPhComplex, zEq);
		i2Prime = cMul(i1, cDiv(zMag, cAdd(zRotor, zMag)));

		const i1Mag = cAbs(i1);
		const i2Mag = cAbs(i2Prime);

		pStatorCuW = 3 * i1Mag * i1Mag * input.r1;
		pAirGapW = 3 * i2Mag * i2Mag * (input.r2Prime / input.slip);

		if (isFinitePos(input.rc)) {
			const vCore = cMul(i1, zPar);
			pCoreW = (3 * cAbs(vCore) * cAbs(vCore)) / input.rc;
		} else {
			pCoreW = input.pCoreW ?? 0;
		}
		pInW = pStatorCuW + pAirGapW + pCoreW;

		// Thevenin equivalent for exact breakdown & starting torque
		const vThComplex = cDiv(cMul(vPhComplex, zMag), cAdd(z1, zMag));
		const vTh = cAbs(vThComplex);
		const zTh = cParallel(z1, zMag);
		const rTh = zTh.re;
		const xTh = zTh.im;
		const denomStart = Math.pow(rTh + input.r2Prime, 2) + Math.pow(xTh + input.x2Prime, 2);
		tStartNm = (3 * vTh * vTh * input.r2Prime) / (omegaS * denomStart);
		const zMaxDenom = Math.hypot(rTh, xTh + input.x2Prime);
		sMaxT = input.r2Prime / zMaxDenom;
		tMaxNm = (3 * vTh * vTh) / (2 * omegaS * (rTh + zMaxDenom));

		steps.push({
			title: 'Exact T-Circuit Per-Phase Impedance & Currents',
			formulaLatex:
				'Z_{\\text{eq}} = (R_1 + jX_1) + \\left[\\left(\\frac{R_2\'}{s} + jX_2\'\\right) \\parallel Z_m\\right], \\quad \\bar{I}_1 = \\frac{\\bar{V}_{1,\\text{ph}}}{Z_{\\text{eq}}}',
			substitutionLatex: `V_{1,\\text{ph}} = ${fmt(vPh, 2)}\\text{ V}, \\quad Z_{\\text{eq}} = ${fmtComplex(zEq, '\\Omega', 4)}`,
			resultLatex: `\\bar{I}_1 = ${fmtPolarTex(i1Mag, cArgDeg(i1), 'A')}, \\quad |\\bar{I}_2'| = ${fmt(i2Mag, 2)}\\text{ A}`
		});
	} else {
		// Approximate Cantilever Circuit (Lecture 6 Slide 21)
		const zSer = c(input.r1 + input.r2Prime / input.slip, input.x1 + input.x2Prime);
		i2Prime = cDiv(vPhComplex, zSer);
		const i0 = cDiv(vPhComplex, zMag);
		i1 = cAdd(i0, i2Prime);
		zEq = cDiv(vPhComplex, i1);

		const i2Mag = cAbs(i2Prime);
		pStatorCuW = 3 * i2Mag * i2Mag * input.r1;
		pAirGapW = 3 * i2Mag * i2Mag * (input.r2Prime / input.slip);
		pCoreW = isFinitePos(input.rc) ? (3 * vPh * vPh) / input.rc : (input.pCoreW ?? 0);
		pInW = pStatorCuW + pAirGapW + pCoreW;

		const denomStart = Math.pow(input.r1 + input.r2Prime, 2) + Math.pow(input.x1 + input.x2Prime, 2);
		tStartNm = (3 * vPh * vPh * input.r2Prime) / (omegaS * denomStart);
		const zMaxDenom = Math.hypot(input.r1, input.x1 + input.x2Prime);
		sMaxT = input.r2Prime / zMaxDenom;
		tMaxNm = (3 * vPh * vPh) / (2 * omegaS * (input.r1 + zMaxDenom));

		steps.push({
			title: 'Approximate Cantilever Circuit Rotor Current',
			formulaLatex:
				'I_2\' = \\frac{V_{1,\\text{ph}}}{\\sqrt{(R_1 + R_2\'/s)^2 + (X_1 + X_2\')^2}}',
			substitutionLatex: `V_{1,\\text{ph}} = ${fmt(vPh, 2)}\\text{ V}, \\quad R_1 + R_2'/s = ${fmt(input.r1 + input.r2Prime / input.slip, 3)}\\,\\Omega`,
			resultLatex: `|\\bar{I}_2'| = ${fmt(i2Mag, 2)}\\text{ A}, \\quad \\bar{I}_1 = ${fmtPolarTex(cAbs(i1), cArgDeg(i1), 'A')}`
		});
	}

	const i1Mag = cAbs(i1);
	const i1Deg = cArgDeg(i1);
	const i2Mag = cAbs(i2Prime);
	const pf = Math.cos((i1Deg * Math.PI) / 180);

	const pRotorCuW = input.slip * pAirGapW;
	const pDevW = (1 - input.slip) * pAirGapW;
	const pOutW = pDevW - pMechW;
	const tdNm = pAirGapW / omegaS;
	const tShaftNm = omegaR > 0 ? pOutW / omegaR : 0;
	const efficiencyPercent = pInW > 0 ? (pOutW / pInW) * 100 : 0;

	steps.push({
		title: 'Power Flow Stages & Efficiency',
		formulaLatex:
			'P_{cu,s} = 3 I_s^2 R_1, \\; P_g = 3(I_2\')^2\\frac{R_2\'}{s}, \\; P_d = (1 - s)P_g, \\; P_{o/p} = P_d - P_{\\text{mech}}, \\; \\eta = \\frac{P_{o/p}}{P_{i/p}}\\times 100\\%',
		resultLatex: `P_g = ${fmt(pAirGapW, 1)}\\text{ W}, \\; P_d = ${fmt(pDevW, 1)}\\text{ W}, \\; P_{o/p} = ${fmt(pOutW, 1)}\\text{ W}, \\; \\eta = ${fmt(efficiencyPercent, 2)}\\%`
	});

	steps.push({
		title: 'Developed, Shaft, Starting & Breakdown Torques',
		formulaLatex: 'T_d = \\frac{P_g}{\\omega_s}, \\quad T_{o/p} = \\frac{P_{o/p}}{\\omega_r}, \\quad T_{st} = T_d\\big|_{s=1}',
		resultLatex: `T_d = ${fmt(tdNm, 2)}\\text{ N}\\cdot\\text{m}, \\; T_{o/p} = ${fmt(tShaftNm, 2)}\\text{ N}\\cdot\\text{m}, \\; T_{st} = ${fmt(tStartNm, 2)}\\text{ N}\\cdot\\text{m}, \\; T_{\\max} = ${fmt(tMaxNm, 2)}\\text{ N}\\cdot\\text{m}`
	});

	const answers: MachineAnswerItem[] = [
		// Voltages
		makeAnswer('vPh', 'Stator Phase Voltage', vPh, 'V', {
			symbolLatex: 'V_{1,\\text{ph}}',
			decimals: 2,
			group: 'voltages'
		}),
		// Currents
		makeAnswer('i1Mag', 'Stator Phase Current', i1Mag, 'A', {
			symbolLatex: '\\bar{I}_1',
			decimals: 2,
			highlight: true,
			group: 'currents',
			formatted: fmtPolar(i1Mag, i1Deg, 'A', 2)
		}),
		makeAnswer('i2PrimeMag', 'Referred Rotor Current', i2Mag, 'A', {
			symbolLatex: "|\\bar{I}_2'|",
			decimals: 2,
			highlight: true,
			group: 'currents'
		}),
		// Impedance
		makeAnswer('zEqMag', 'Input Impedance per Phase', cAbs(zEq), 'Ω', {
			symbolLatex: 'Z_{\\text{eq}}',
			decimals: 3,
			group: 'impedance',
			formatted: fmtComplex(zEq, 'Ω', 3)
		}),
		// Power & Efficiency
		makeAnswer('pf', 'Input Power Factor', pf, 'lag', {
			symbolLatex: '\\cos\\phi_1',
			decimals: 4,
			group: 'power'
		}),
		makeAnswer('pInW', 'Stator Input Power', pInW, 'W', {
			symbolLatex: 'P_{i/p}',
			decimals: 1,
			group: 'power'
		}),
		makeAnswer('pStatorCuW', 'Stator Copper Loss', pStatorCuW, 'W', {
			symbolLatex: 'P_{cu,s}',
			decimals: 1,
			group: 'power'
		}),
		makeAnswer('pAirGapW', 'Air-Gap Power', pAirGapW, 'W', {
			symbolLatex: 'P_g',
			decimals: 1,
			group: 'power'
		}),
		makeAnswer('pRotorCuW', 'Rotor Copper Loss', pRotorCuW, 'W', {
			symbolLatex: 'P_{cu,r}',
			decimals: 1,
			group: 'power'
		}),
		makeAnswer('pDevW', 'Developed Power', pDevW, 'W', {
			symbolLatex: 'P_d',
			decimals: 1,
			group: 'power'
		}),
		makeAnswer('pOutW', 'Shaft Output Power', pOutW, 'W', {
			symbolLatex: 'P_{o/p}',
			decimals: 1,
			group: 'power'
		}),
		makeAnswer('efficiencyPercent', 'Efficiency', efficiencyPercent, '%', {
			symbolLatex: '\\eta',
			decimals: 2,
			highlight: true,
			group: 'power'
		}),
		// Mechanical & Torque
		makeAnswer('nsRpm', 'Synchronous Speed', nsRpm, 'rpm', {
			symbolLatex: 'N_s',
			decimals: 2,
			group: 'mechanical'
		}),
		makeAnswer('nrRpm', 'Rotor Speed', nrRpm, 'rpm', {
			symbolLatex: 'N_r',
			decimals: 2,
			group: 'mechanical'
		}),
		makeAnswer('tdNm', 'Developed Torque', tdNm, 'N·m', {
			symbolLatex: 'T_d',
			decimals: 2,
			highlight: true,
			group: 'mechanical'
		}),
		makeAnswer('tShaftNm', 'Shaft Output Torque', tShaftNm, 'N·m', {
			symbolLatex: 'T_{\\text{sh}}',
			decimals: 2,
			highlight: true,
			group: 'mechanical'
		}),
		makeAnswer('tStartNm', 'Starting Torque (s = 1)', tStartNm, 'N·m', {
			symbolLatex: 'T_{st}',
			decimals: 2,
			group: 'mechanical'
		}),
		makeAnswer('tMaxNm', 'Breakdown (Max) Torque', tMaxNm, 'N·m', {
			symbolLatex: 'T_{\\max}',
			decimals: 2,
			group: 'mechanical'
		}),
		makeAnswer('sMaxT', 'Slip at Breakdown Torque', sMaxT * 100, '%', {
			symbolLatex: 's_{\\max T}',
			decimals: 2,
			group: 'mechanical'
		})
	];

	return {
		valid: true,
		questionType: 'QT-IM-3',
		title: TITLE_IM3,
		answers,
		values: {
			vPh,
			nsRpm,
			omegaS,
			nrRpm,
			omegaR,
			zEqRe: zEq.re,
			zEqIm: zEq.im,
			zEqMag: cAbs(zEq),
			i1Mag,
			i1Deg,
			i2PrimeMag: i2Mag,
			pf,
			pStatorCuW,
			pCoreW,
			pAirGapW,
			pRotorCuW,
			pDevW,
			pOutW,
			pInW,
			tdNm,
			tShaftNm,
			tStartNm,
			sMaxT,
			tMaxNm,
			efficiencyPercent
		},
		steps
	};
}
