import {
	RAD_TO_DEG,
	c,
	cAbs,
	cAdd,
	cArgDeg,
	cFromPolar,
	cMul,
	errorResult,
	fmt,
	fmtPolar,
	fmtPolarTex,
	fmtTexSci,
	isFiniteNonNeg,
	isFinitePos,
	makeAnswer
} from './math-helpers';
import type {
	MachineAnswerItem,
	MachineSolveResult,
	MachineStep,
	TransformerEfficiencyInput,
	TransformerEmfCoreLossInput,
	TransformerOcScInput,
	TransformerOnLoadInput
} from './types';

const TITLE_XFMR1 = 'Transformer EMF & Core Loss Analysis';
const TITLE_XFMR2 = 'Transformer Open-Circuit & Short-Circuit Tests';
const TITLE_XFMR3 = 'Transformer On-Load Equivalent Circuit Performance';
const TITLE_XFMR4 = 'Transformer Efficiency & Loss Separation';

// ============================================================================
// QT-XFMR-1: EMF Equation, Core Loss Separation & (V, f) Scaling
// ============================================================================

export function solveTransformerEmfAndCoreLoss(
	input: TransformerEmfCoreLossInput
): MachineSolveResult {
	const steps: MachineStep[] = [];
	const answers: MachineAnswerItem[] = [];

	if (input.mode === 'emf') {
		if (!isFinitePos(input.frequencyHz) || !isFinitePos(input.n1) || !isFinitePos(input.n2)) {
			return errorResult('QT-XFMR-1', TITLE_XFMR1, 'Frequency f and turns N1, N2 must be positive.');
		}
		const a = input.n1 / input.n2;
		let phiM: number;
		let bM: number | undefined;

		if (isFinitePos(input.maxFluxWb)) {
			phiM = input.maxFluxWb;
			if (isFinitePos(input.coreAreaM2)) bM = phiM / input.coreAreaM2;
		} else if (isFinitePos(input.maxFluxDensityT) && isFinitePos(input.coreAreaM2)) {
			bM = input.maxFluxDensityT;
			phiM = bM * input.coreAreaM2;
		} else if (isFinitePos(input.primaryVoltageV)) {
			phiM = input.primaryVoltageV / (4.44 * input.frequencyHz * input.n1);
			if (isFinitePos(input.coreAreaM2)) bM = phiM / input.coreAreaM2;
		} else {
			return errorResult(
				'QT-XFMR-1',
				TITLE_XFMR1,
				'Provide maxFluxWb, (maxFluxDensityT + coreAreaM2), or primaryVoltageV.'
			);
		}

		const e1 = 4.44 * input.frequencyHz * input.n1 * phiM;
		const e2 = 4.44 * input.frequencyHz * input.n2 * phiM;

		steps.push({
			title: 'Turns Ratio & Peak Core Flux',
			formulaLatex: 'a = \\frac{N_1}{N_2}, \\quad \\Phi_m = B_m A',
			resultLatex: `a = ${fmt(a, 4)}, \\quad \\Phi_m = ${fmtTexSci(phiM)}\\text{ Wb}`
		});

		steps.push({
			title: 'RMS Induced EMFs',
			formulaLatex: 'E_1 = 4.44 f N_1 \\Phi_m, \\quad E_2 = 4.44 f N_2 \\Phi_m',
			substitutionLatex: `E_1 = 4.44(${input.frequencyHz})(${input.n1})(${fmtTexSci(phiM)})`,
			resultLatex: `E_1 = ${fmt(e1, 2)}\\text{ V}, \\quad E_2 = ${fmt(e2, 2)}\\text{ V}`
		});

		answers.push(
			makeAnswer('turnsRatio', 'Turns Ratio', a, '', { symbolLatex: 'a = N_1/N_2', decimals: 4 }),
			makeAnswer('maxFluxWb', 'Maximum Core Flux', phiM, 'Wb', {
				symbolLatex: '\\Phi_m',
				decimals: 4,
				formatted: `${fmt(phiM * 1000, 4)} mWb`
			}),
			makeAnswer('e1V', 'Primary Induced EMF', e1, 'V', { symbolLatex: 'E_1', decimals: 2, highlight: true }),
			makeAnswer('e2V', 'Secondary Induced EMF', e2, 'V', { symbolLatex: 'E_2', decimals: 2, highlight: true })
		);

		const values: Record<string, number> = {
			turnsRatio: a,
			maxFluxWb: phiM,
			e1V: e1,
			e2V: e2
		};
		if (bM !== undefined) {
			values.maxFluxDensityT = bM;
			answers.push(
				makeAnswer('maxFluxDensityT', 'Peak Flux Density', bM, 'T', { symbolLatex: 'B_m', decimals: 4 })
			);
		}

		return { valid: true, questionType: 'QT-XFMR-1', title: TITLE_XFMR1, answers, values, steps };
	}

	if (input.mode === 'loss-separation') {
		if (
			!isFinitePos(input.f1Hz) ||
			!isFinitePos(input.pc1W) ||
			!isFinitePos(input.f2Hz) ||
			!isFinitePos(input.pc2W) ||
			!isFinitePos(input.targetFreqHz)
		) {
			return errorResult('QT-XFMR-1', TITLE_XFMR1, 'Frequencies and core losses must be positive.');
		}
		if (input.f1Hz === input.f2Hz) {
			return errorResult('QT-XFMR-1', TITLE_XFMR1, 'Two distinct frequencies f1 and f2 are required.');
		}

		const y1 = input.pc1W / input.f1Hz;
		const y2 = input.pc2W / input.f2Hz;
		const coeffB = (y2 - y1) / (input.f2Hz - input.f1Hz);
		const coeffA = y1 - coeffB * input.f1Hz;

		if (coeffA < 0 || coeffB < 0) {
			return errorResult(
				'QT-XFMR-1',
				TITLE_XFMR1,
				'Non-physical core loss data: separated hysteresis or eddy-current coefficient is negative.'
			);
		}

		const phTarget = coeffA * input.targetFreqHz;
		const peTarget = coeffB * input.targetFreqHz * input.targetFreqHz;
		const pcTarget = phTarget + peTarget;

		steps.push({
			title: 'Linear Core-Loss Separation (Constant Peak Flux Density)',
			formulaLatex: '\\frac{P_c}{f} = A + B f \\implies B = \\frac{P_{c2}/f_2 - P_{c1}/f_1}{f_2 - f_1}, \\quad A = \\frac{P_{c1}}{f_1} - B f_1',
			substitutionLatex: `\\frac{P_{c1}}{f_1} = ${fmt(y1, 4)}, \\; \\frac{P_{c2}}{f_2} = ${fmt(y2, 4)}`,
			resultLatex: `A = ${fmt(coeffA, 4)}\\text{ W/Hz}, \\quad B = ${fmt(coeffB, 5)}\\text{ W/Hz}^2`
		});

		steps.push({
			title: `Evaluate Core Losses at f = ${input.targetFreqHz} Hz`,
			formulaLatex: 'P_h(f) = A f, \\quad P_e(f) = B f^2, \\quad P_c(f) = P_h + P_e',
			substitutionLatex: `P_h = (${fmt(coeffA, 4)})(${input.targetFreqHz}), \\quad P_e = (${fmt(coeffB, 5)})(${input.targetFreqHz})^2`,
			resultLatex: `P_h = ${fmt(phTarget, 2)}\\text{ W}, \\quad P_e = ${fmt(peTarget, 2)}\\text{ W}, \\quad P_c = ${fmt(pcTarget, 2)}\\text{ W}`
		});

		answers.push(
			makeAnswer('coeffA', 'Hysteresis Coefficient A', coeffA, 'W/Hz', { symbolLatex: 'A', decimals: 4 }),
			makeAnswer('coeffB', 'Eddy-Current Coefficient B', coeffB, 'W/Hz²', { symbolLatex: 'B', decimals: 5 }),
			makeAnswer('phTargetW', 'Hysteresis Loss', phTarget, 'W', {
				symbolLatex: 'P_h',
				decimals: 2,
				highlight: true
			}),
			makeAnswer('peTargetW', 'Eddy-Current Loss', peTarget, 'W', {
				symbolLatex: 'P_e',
				decimals: 2,
				highlight: true
			}),
			makeAnswer('pcTargetW', 'Total Core Loss', pcTarget, 'W', {
				symbolLatex: 'P_c',
				decimals: 2,
				highlight: true
			})
		);

		return {
			valid: true,
			questionType: 'QT-XFMR-1',
			title: TITLE_XFMR1,
			answers,
			values: {
				coeffA,
				coeffB,
				phTargetW: phTarget,
				peTargetW: peTarget,
				pcTargetW: pcTarget
			},
			steps
		};
	}

	// (V, f) scaling mode
	if (
		!isFinitePos(input.v1V) ||
		!isFinitePos(input.f1Hz) ||
		!isFinitePos(input.v2V) ||
		!isFinitePos(input.f2Hz) ||
		!isFiniteNonNeg(input.ph1W) ||
		!isFiniteNonNeg(input.pe1W)
	) {
		return errorResult('QT-XFMR-1', TITLE_XFMR1, 'Voltages, frequencies must be positive and losses >= 0.');
	}

	const n = input.steinmetzN ?? 1.6;
	if (!isFinitePos(n)) {
		return errorResult('QT-XFMR-1', TITLE_XFMR1, 'Steinmetz exponent n must be positive.');
	}

	const vRatio = input.v2V / input.v1V;
	const fRatioInv = input.f1Hz / input.f2Hz;
	const ph2 = input.ph1W * Math.pow(vRatio, n) * Math.pow(fRatioInv, n - 1);
	const pe2 = input.pe1W * Math.pow(vRatio, 2);
	const pc1 = input.ph1W + input.pe1W;
	const pc2 = ph2 + pe2;

	steps.push({
		title: 'Hysteresis Loss Scaling with Voltage & Frequency',
		formulaLatex: 'P_{h2} = P_{h1}\\left(\\frac{V_2}{V_1}\\right)^n \\left(\\frac{f_1}{f_2}\\right)^{n-1}',
		substitutionLatex: `P_{h2} = ${input.ph1W}\\left(\\frac{${input.v2V}}{${input.v1V}}\\right)^{${n}}\\left(\\frac{${input.f1Hz}}{${input.f2Hz}}\\right)^{${fmt(n - 1, 2)}}`,
		resultLatex: `P_{h2} = ${fmt(ph2, 2)}\\text{ W}`
	});

	steps.push({
		title: 'Eddy-Current & Total Core Loss Scaling',
		formulaLatex: 'P_{e2} = P_{e1}\\left(\\frac{V_2}{V_1}\\right)^2, \\quad P_{c2} = P_{h2} + P_{e2}',
		substitutionLatex: `P_{e2} = ${input.pe1W}\\left(\\frac{${input.v2V}}{${input.v1V}}\\right)^2`,
		resultLatex: `P_{e2} = ${fmt(pe2, 2)}\\text{ W}, \\quad P_{c2} = ${fmt(pc2, 2)}\\text{ W}`
	});

	answers.push(
		makeAnswer('ph2W', 'New Hysteresis Loss', ph2, 'W', { symbolLatex: 'P_{h2}', decimals: 2, highlight: true }),
		makeAnswer('pe2W', 'New Eddy-Current Loss', pe2, 'W', { symbolLatex: 'P_{e2}', decimals: 2, highlight: true }),
		makeAnswer('pc2W', 'New Total Core Loss', pc2, 'W', { symbolLatex: 'P_{c2}', decimals: 2, highlight: true })
	);

	return {
		valid: true,
		questionType: 'QT-XFMR-1',
		title: TITLE_XFMR1,
		answers,
		values: {
			ph2W: ph2,
			pe2W: pe2,
			pc2W: pc2,
			pc1W: pc1,
			deltaPcPercent: pc1 > 0 ? ((pc2 - pc1) / pc1) * 100 : 0
		},
		steps
	};
}

// ============================================================================
// QT-XFMR-2: OC & SC Tests -> Equivalent Circuit Parameter Extraction
// ============================================================================

export function solveTransformerOcScTests(input: TransformerOcScInput): MachineSolveResult {
	if (
		!isFinitePos(input.ratedVA) ||
		!isFinitePos(input.v1Rated) ||
		!isFinitePos(input.v2Rated) ||
		!isFinitePos(input.frequencyHz)
	) {
		return errorResult('QT-XFMR-2', TITLE_XFMR2, 'Rated S, V1, V2, and frequency must be positive.');
	}
	if (!isFinitePos(input.vOc) || !isFinitePos(input.iOc) || !isFiniteNonNeg(input.pOc)) {
		return errorResult('QT-XFMR-2', TITLE_XFMR2, 'OC test readings V0, I0 must be positive and W0 >= 0.');
	}
	if (!isFinitePos(input.vSc) || !isFinitePos(input.iSc) || !isFiniteNonNeg(input.pSc)) {
		return errorResult('QT-XFMR-2', TITLE_XFMR2, 'SC test readings Vsc, Isc must be positive and Wsc >= 0.');
	}

	const cosPhi0 = input.pOc / (input.vOc * input.iOc);
	if (cosPhi0 > 1 + 1e-6) {
		return errorResult('QT-XFMR-2', TITLE_XFMR2, 'Invalid OC test: W0 exceeds V0 * I0.');
	}
	const cosPhi0Clamped = Math.min(1, cosPhi0);

	const iwOc = input.pOc / input.vOc;
	const imOc = Math.sqrt(Math.max(0, input.iOc * input.iOc - iwOc * iwOc));
	const rcOcSide = iwOc > 0 ? input.vOc / iwOc : Infinity;
	const xmOcSide = imOc > 0 ? input.vOc / imOc : Infinity;

	const zScSide = input.vSc / input.iSc;
	const rScSide = input.pSc / (input.iSc * input.iSc);
	if (rScSide > zScSide + 1e-6) {
		return errorResult('QT-XFMR-2', TITLE_XFMR2, 'Invalid SC test: R_eq exceeds Z_eq (Wsc > Vsc * Isc).');
	}
	const xScSide = Math.sqrt(Math.max(0, zScSide * zScSide - rScSide * rScSide));

	// Determine which physical side is LV vs HV, and map to primary/secondary
	const primaryIsHV = input.v1Rated >= input.v2Rated;
	const vHV = Math.max(input.v1Rated, input.v2Rated);
	const vLV = Math.min(input.v1Rated, input.v2Rated);
	const a = input.v1Rated / input.v2Rated;

	const ocVoltage = input.ocSide === 'LV' ? vLV : vHV;
	const scVoltage = input.scSide === 'LV' ? vLV : vHV;
	const targetVoltage = input.referTo === 'primary' ? input.v1Rated : input.v2Rated;

	const ocScale = Math.pow(targetVoltage / ocVoltage, 2);
	const scScale = Math.pow(targetVoltage / scVoltage, 2);

	const rcRef = rcOcSide * ocScale;
	const xmRef = xmOcSide * ocScale;
	const reRef = rScSide * scScale;
	const xeRef = xScSide * scScale;
	const zeRef = Math.hypot(reRef, xeRef);

	// Also compute primary-referred values explicitly for on-load performance
	const ocToPrim = Math.pow(input.v1Rated / ocVoltage, 2);
	const scToPrim = Math.pow(input.v1Rated / scVoltage, 2);
	const rc1 = rcOcSide * ocToPrim;
	const xm1 = xmOcSide * ocToPrim;
	const re1 = rScSide * scToPrim;
	const xe1 = xScSide * scToPrim;

	const steps: MachineStep[] = [
		{
			title: `Open-Circuit Test (${input.ocSide} Side) → Shunt Branch`,
			formulaLatex:
				'\\cos\\phi_0 = \\frac{W_0}{V_0 I_0}, \\; I_w = \\frac{W_0}{V_0}, \\; I_m = \\sqrt{I_0^2 - I_w^2}, \\; R_c = \\frac{V_0}{I_w}, \\; X_m = \\frac{V_0}{I_m}',
			substitutionLatex: `I_w = ${fmt(iwOc, 4)}\\text{ A}, \\quad I_m = ${fmt(imOc, 4)}\\text{ A}`,
			resultLatex: `R_{c,\\text{${input.ocSide}}} = ${fmt(rcOcSide, 2)}\\,\\Omega, \\quad X_{m,\\text{${input.ocSide}}} = ${fmt(xmOcSide, 2)}\\,\\Omega`
		},
		{
			title: `Short-Circuit Test (${input.scSide} Side) → Series Branch`,
			formulaLatex:
				'Z_{\\text{eq}} = \\frac{V_{sc}}{I_{sc}}, \\quad R_{\\text{eq}} = \\frac{W_{sc}}{I_{sc}^2}, \\quad X_{\\text{eq}} = \\sqrt{Z_{\\text{eq}}^2 - R_{\\text{eq}}^2}',
			substitutionLatex: `Z_{\\text{eq}} = \\frac{${input.vSc}}{${input.iSc}} = ${fmt(zScSide, 4)}\\,\\Omega, \\quad R_{\\text{eq}} = \\frac{${input.pSc}}{${input.iSc}^2}`,
			resultLatex: `R_{\\text{eq},${input.scSide}} = ${fmt(rScSide, 4)}\\,\\Omega, \\quad X_{\\text{eq},${input.scSide}} = ${fmt(xScSide, 4)}\\,\\Omega`
		},
		{
			title: `Refer All Parameters to ${input.referTo === 'primary' ? 'Primary' : 'Secondary'} Side`,
			formulaLatex:
				'a = \\frac{V_1}{V_2}, \\quad Z_{\\text{ref}} = Z_{\\text{test}}\\left(\\frac{V_{\\text{ref}}}{V_{\\text{test}}}\\right)^2',
			substitutionLatex: `a = ${fmt(a, 4)}\\;(\\text{Primary is ${primaryIsHV ? 'HV' : 'LV'}})`,
			resultLatex: `R_c = ${fmt(rcRef, 2)}\\,\\Omega, \\; X_m = ${fmt(xmRef, 2)}\\,\\Omega, \\; R_{\\text{eq}} = ${fmt(reRef, 4)}\\,\\Omega, \\; X_{\\text{eq}} = ${fmt(xeRef, 4)}\\,\\Omega`
		}
	];

	const answers: MachineAnswerItem[] = [
		makeAnswer('rcRef', `Core-Loss Resistance (ref. ${input.referTo})`, rcRef, 'Ω', {
			symbolLatex: input.referTo === 'primary' ? 'R_{c1}' : 'R_{c2}',
			decimals: 2,
			highlight: true
		}),
		makeAnswer('xmRef', `Magnetizing Reactance (ref. ${input.referTo})`, xmRef, 'Ω', {
			symbolLatex: input.referTo === 'primary' ? 'X_{m1}' : 'X_{m2}',
			decimals: 2,
			highlight: true
		}),
		makeAnswer('reRef', `Equivalent Resistance (ref. ${input.referTo})`, reRef, 'Ω', {
			symbolLatex: input.referTo === 'primary' ? 'R_{e1}' : 'R_{e2}',
			decimals: 4,
			highlight: true
		}),
		makeAnswer('xeRef', `Equivalent Reactance (ref. ${input.referTo})`, xeRef, 'Ω', {
			symbolLatex: input.referTo === 'primary' ? 'X_{e1}' : 'X_{e2}',
			decimals: 4,
			highlight: true
		})
	];

	const values: Record<string, number> = {
		turnsRatio: a,
		cosPhi0: cosPhi0Clamped,
		iwOc,
		imOc,
		rcOcSide,
		xmOcSide,
		rScSide,
		xScSide,
		zScSide,
		rcRef,
		xmRef,
		reRef,
		xeRef,
		zeRef,
		rc1,
		xm1,
		re1,
		xe1
	};

	// Optional on-load evaluation
	if (isFinitePos(input.evalLoadFraction) && isFinitePos(input.evalPf)) {
		const onLoad = solveTransformerOnLoad({
			ratedVA: input.ratedVA,
			v1Rated: input.v1Rated,
			v2Rated: input.v2Rated,
			frequencyHz: input.frequencyHz,
			paramRef: 'primary',
			re: re1,
			xe: xe1,
			rc: rc1,
			xm: xm1,
			loadFraction: input.evalLoadFraction,
			pf: input.evalPf,
			pfType: input.evalPfType ?? 'lag'
		});
		if (onLoad.valid) {
			steps.push(...onLoad.steps);
			answers.push(
				makeAnswer('vrExactPercent', 'Voltage Regulation (Exact)', onLoad.values.vrExactPercent, '%', {
					symbolLatex: '\\%VR',
					decimals: 3,
					highlight: true
				}),
				makeAnswer('efficiencyPercent', 'Efficiency at Load', onLoad.values.efficiencyPercent, '%', {
					symbolLatex: '\\eta',
					decimals: 2,
					highlight: true
				}),
				makeAnswer('i1Mag', 'Primary Current', onLoad.values.i1Mag, 'A', {
					symbolLatex: '\\bar{I}_1',
					decimals: 3,
					formatted: fmtPolar(onLoad.values.i1Mag, onLoad.values.i1Deg, 'A', 3)
				}),
				makeAnswer('sMaxEffKVA', 'Load for Max Efficiency', onLoad.values.sMaxEffKVA, 'kVA', {
					symbolLatex: 'S_{\\max\\eta}',
					decimals: 3
				})
			);
			Object.assign(values, {
				vrExactPercent: onLoad.values.vrExactPercent,
				vrApproxPercent: onLoad.values.vrApproxPercent,
				efficiencyPercent: onLoad.values.efficiencyPercent,
				i1Mag: onLoad.values.i1Mag,
				i1Deg: onLoad.values.i1Deg,
				xMaxEff: onLoad.values.xMaxEff,
				sMaxEffVA: onLoad.values.sMaxEffVA,
				sMaxEffKVA: onLoad.values.sMaxEffKVA,
				pCoreW: onLoad.values.pCoreW,
				pCuW: onLoad.values.pCuW,
				pCuFlW: onLoad.values.pCuFlW
			});
		}
	}

	return {
		valid: true,
		questionType: 'QT-XFMR-2',
		title: TITLE_XFMR2,
		answers,
		values,
		steps
	};
}

// ============================================================================
// QT-XFMR-3: Transformer On-Load Equivalent Circuit Performance
// ============================================================================

export function solveTransformerOnLoad(input: TransformerOnLoadInput): MachineSolveResult {
	if (!isFinitePos(input.ratedVA) || !isFinitePos(input.v1Rated) || !isFinitePos(input.v2Rated)) {
		return errorResult('QT-XFMR-3', TITLE_XFMR3, 'Rated VA, V1, and V2 must be positive.');
	}
	if (!isFinitePos(input.pf) || input.pf > 1) {
		return errorResult('QT-XFMR-3', TITLE_XFMR3, 'Power factor must satisfy 0 < pf <= 1.');
	}

	const a = input.v1Rated / input.v2Rated;
	const paramRef = input.paramRef ?? 'primary';

	let re1: number;
	let xe1: number;
	let rc1: number | undefined;
	let xm1: number | undefined;

	if (paramRef === 'separate') {
		if (
			!isFiniteNonNeg(input.r1) ||
			!isFiniteNonNeg(input.x1) ||
			!isFiniteNonNeg(input.r2) ||
			!isFiniteNonNeg(input.x2)
		) {
			return errorResult('QT-XFMR-3', TITLE_XFMR3, 'Separate winding R1, X1, R2, X2 must be >= 0.');
		}
		re1 = input.r1 + a * a * input.r2;
		xe1 = input.x1 + a * a * input.x2;
		rc1 = isFinitePos(input.rc) ? input.rc : isFinitePos(input.gc) ? 1 / input.gc : undefined;
		xm1 = isFinitePos(input.xm) ? input.xm : isFinitePos(input.bm) ? 1 / input.bm : undefined;
	} else {
		if (!isFiniteNonNeg(input.re) || !isFiniteNonNeg(input.xe)) {
			return errorResult('QT-XFMR-3', TITLE_XFMR3, 'Equivalent R_e and X_e must be >= 0.');
		}
		const scale = paramRef === 'secondary' ? a * a : 1;
		re1 = input.re * scale;
		xe1 = input.xe * scale;
		const rcRaw = isFinitePos(input.rc) ? input.rc : isFinitePos(input.gc) ? 1 / input.gc : undefined;
		const xmRaw = isFinitePos(input.xm) ? input.xm : isFinitePos(input.bm) ? 1 / input.bm : undefined;
		rc1 = rcRaw !== undefined ? rcRaw * scale : undefined;
		xm1 = xmRaw !== undefined ? xmRaw * scale : undefined;
	}

	// Determine core loss P_i and no-load current components I_w, I_m
	let pCoreW = 0;
	let iw1 = 0;
	let im1 = 0;
	if (rc1 !== undefined && Number.isFinite(rc1)) {
		pCoreW = (input.v1Rated * input.v1Rated) / rc1;
		iw1 = input.v1Rated / rc1;
	} else if (isFiniteNonNeg(input.pCoreW)) {
		pCoreW = input.pCoreW;
		iw1 = pCoreW / input.v1Rated;
		if (isFinitePos(input.pfNoLoad) && input.pfNoLoad < 1) {
			const i0Mag = iw1 / input.pfNoLoad;
			im1 = Math.sqrt(Math.max(0, i0Mag * i0Mag - iw1 * iw1));
		}
	}
	if (xm1 !== undefined && Number.isFinite(xm1)) {
		im1 = input.v1Rated / xm1;
	}

	// Determine load fraction x and load apparent power S_load
	let xLoad: number;
	if (isFinitePos(input.loadVA)) {
		xLoad = input.loadVA / input.ratedVA;
	} else if (isFinitePos(input.loadWatts)) {
		xLoad = input.loadWatts / (input.pf * input.ratedVA);
	} else {
		xLoad = input.loadFraction ?? 1;
	}
	if (!isFiniteNonNeg(xLoad)) {
		return errorResult('QT-XFMR-3', TITLE_XFMR3, 'Load fraction must be >= 0.');
	}

	const i1Fl = input.ratedVA / input.v1Rated;
	const i2PrimeMag = xLoad * i1Fl;
	const phiRad = Math.acos(input.pf);
	const phiDeg = phiRad * RAD_TO_DEG;
	const sinPhi = Math.sin(phiRad);
	const angleSign = input.pfType === 'lead' ? 1 : input.pfType === 'unity' ? 0 : -1;
	const i2PrimeDeg = angleSign * phiDeg;

	const v2Prime = c(input.v1Rated, 0);
	const i2Prime = cFromPolar(i2PrimeMag, i2PrimeDeg);
	const zEq1 = c(re1, xe1);
	const v1Phasor = cAdd(v2Prime, cMul(i2Prime, zEq1));
	const v1Mag = cAbs(v1Phasor);
	const v1Deg = cArgDeg(v1Phasor);

	const vrExactPercent = ((v1Mag - input.v1Rated) / input.v1Rated) * 100;
	const approxDrop =
		i2PrimeMag *
		(re1 * input.pf + (input.pfType === 'lead' ? -1 : input.pfType === 'unity' ? 0 : 1) * xe1 * sinPhi);
	const vrApproxPercent = (approxDrop / input.v1Rated) * 100;

	const i0Phasor = c(iw1, -im1);
	const i1Phasor = cAdd(i0Phasor, i2Prime);
	const i1Mag = cAbs(i1Phasor);
	const i1Deg = cArgDeg(i1Phasor);

	const pOutW = xLoad * input.ratedVA * input.pf;
	const pCuFlW = i1Fl * i1Fl * re1;
	const pCuW = xLoad * xLoad * pCuFlW;
	const pInW = pOutW + pCoreW + pCuW;
	const efficiencyPercent = pInW > 0 ? (pOutW / pInW) * 100 : 0;

	const xMaxEff = pCuFlW > 0 && pCoreW > 0 ? Math.sqrt(pCoreW / pCuFlW) : 0;
	const sMaxEffVA = xMaxEff * input.ratedVA;
	const etaMaxAtPf =
		sMaxEffVA > 0 ? ((sMaxEffVA * input.pf) / (sMaxEffVA * input.pf + 2 * pCoreW)) * 100 : 0;
	const etaMaxAtUpf = sMaxEffVA > 0 ? (sMaxEffVA / (sMaxEffVA + 2 * pCoreW)) * 100 : 0;

	const steps: MachineStep[] = [
		{
			title: 'Referred Load Current & Exact Primary Voltage Phasor',
			formulaLatex:
				'\\bar{I}_2\' = x \\frac{S_{\\text{rated}}}{V_1}\\angle(\\mp\\phi_2), \\quad \\bar{V}_1 = \\bar{V}_2\' + \\bar{I}_2\'(R_{e1} + jX_{e1})',
			substitutionLatex: `\\bar{I}_2' = ${fmtPolarTex(i2PrimeMag, i2PrimeDeg, 'A')}, \\quad \\bar{V}_1 = ${fmt(input.v1Rated, 1)}\\angle 0^\\circ + (${fmtPolarTex(i2PrimeMag, i2PrimeDeg)})(${fmt(re1, 3)} + j${fmt(xe1, 3)})`,
			resultLatex: `\\bar{V}_1 = ${fmtPolarTex(v1Mag, v1Deg, 'V')}`
		},
		{
			title: 'Voltage Regulation (Exact Phasor & Approximate Projection)',
			formulaLatex:
				'\\%VR_{\\text{exact}} = \\frac{|\\bar{V}_1| - |\\bar{V}_2\'|}{|\\bar{V}_2\'|}\\times 100\\%, \\quad \\%VR_{\\text{approx}} = \\frac{I_2\'(R_{e1}\\cos\\phi_2 \\pm X_{e1}\\sin\\phi_2)}{V_2\'}\\times 100\\%',
			resultLatex: `\\%VR_{\\text{exact}} = ${fmt(vrExactPercent, 3)}\\%, \\quad \\%VR_{\\text{approx}} = ${fmt(vrApproxPercent, 3)}\\%`
		},
		{
			title: 'Losses, Efficiency & Maximum Efficiency Point',
			formulaLatex:
				'P_{cu} = x^2 I_{1,\\text{FL}}^2 R_{e1}, \\quad \\eta = \\frac{P_{\\text{out}}}{P_{\\text{out}} + P_i + P_{cu}}\\times 100\\%, \\quad x_{\\max\\eta} = \\sqrt{\\frac{P_i}{P_{cu,\\text{FL}}}}',
			substitutionLatex: `P_{\\text{out}} = ${fmt(pOutW, 1)}\\text{ W}, \\; P_i = ${fmt(pCoreW, 2)}\\text{ W}, \\; P_{cu} = ${fmt(pCuW, 2)}\\text{ W}`,
			resultLatex: `\\eta = ${fmt(efficiencyPercent, 2)}\\%, \\quad S_{\\max\\eta} = ${fmt(sMaxEffVA / 1000, 3)}\\text{ kVA}`
		}
	];

	const answers: MachineAnswerItem[] = [
		makeAnswer('vrExactPercent', 'Voltage Regulation (Exact)', vrExactPercent, '%', {
			symbolLatex: '\\%VR',
			decimals: 3,
			highlight: true
		}),
		makeAnswer('vrApproxPercent', 'Voltage Regulation (Approx)', vrApproxPercent, '%', {
			symbolLatex: '\\%VR_{\\text{approx}}',
			decimals: 3
		}),
		makeAnswer('v1Mag', 'Primary Voltage Magnitude', v1Mag, 'V', {
			symbolLatex: '|\\bar{V}_1|',
			decimals: 2,
			formatted: fmtPolar(v1Mag, v1Deg, 'V', 2)
		}),
		makeAnswer('i1Mag', 'Primary Input Current', i1Mag, 'A', {
			symbolLatex: '\\bar{I}_1',
			decimals: 3,
			formatted: fmtPolar(i1Mag, i1Deg, 'A', 3)
		}),
		makeAnswer('pCoreW', 'Core (Iron) Loss', pCoreW, 'W', { symbolLatex: 'P_i', decimals: 2 }),
		makeAnswer('pCuW', 'Copper Loss at Load', pCuW, 'W', { symbolLatex: 'P_{cu}', decimals: 2 }),
		makeAnswer('efficiencyPercent', 'Efficiency', efficiencyPercent, '%', {
			symbolLatex: '\\eta',
			decimals: 2,
			highlight: true
		}),
		makeAnswer('sMaxEffKVA', 'Load for Max Efficiency', sMaxEffVA / 1000, 'kVA', {
			symbolLatex: 'S_{\\max\\eta}',
			decimals: 3,
			highlight: true
		}),
		makeAnswer('etaMaxAtUpf', 'Max Efficiency (UPF)', etaMaxAtUpf, '%', {
			symbolLatex: '\\eta_{\\max,\\text{UPF}}',
			decimals: 2
		})
	];

	return {
		valid: true,
		questionType: 'QT-XFMR-3',
		title: TITLE_XFMR3,
		answers,
		values: {
			turnsRatio: a,
			re1,
			xe1,
			xLoad,
			i2PrimeMag,
			i2PrimeDeg,
			v1Mag,
			v1Deg,
			vrExactPercent,
			vrApproxPercent,
			i1Mag,
			i1Deg,
			pOutW,
			pCoreW,
			pCuFlW,
			pCuW,
			pInW,
			efficiencyPercent,
			xMaxEff,
			sMaxEffVA,
			sMaxEffKVA: sMaxEffVA / 1000,
			etaMaxAtPf,
			etaMaxAtUpf
		},
		steps
	};
}

// ============================================================================
// QT-XFMR-4: Efficiency vs Load Fraction & Two-Point Loss Separation
// ============================================================================

export function solveTransformerEfficiencyLoad(
	input: TransformerEfficiencyInput
): MachineSolveResult {
	if (!isFinitePos(input.ratedVA)) {
		return errorResult('QT-XFMR-4', TITLE_XFMR4, 'Rated apparent power must be positive.');
	}

	const steps: MachineStep[] = [];
	const answers: MachineAnswerItem[] = [];

	let pCoreW: number;
	let pCuFlW: number;
	let evalX: number;
	let evalPf: number;

	if (input.mode === 'known-losses') {
		if (!isFinitePos(input.pCoreW) || !isFinitePos(input.pCuFlW)) {
			return errorResult('QT-XFMR-4', TITLE_XFMR4, 'Core loss P_i and full-load copper loss P_cu,FL must be positive.');
		}
		pCoreW = input.pCoreW;
		pCuFlW = input.pCuFlW;
		evalX = input.loadFraction ?? 1;
		evalPf = input.pf ?? 1;
		if (!isFinitePos(evalX) || !isFinitePos(evalPf) || evalPf > 1) {
			return errorResult('QT-XFMR-4', TITLE_XFMR4, 'Load fraction must be > 0 and 0 < pf <= 1.');
		}
	} else {
		const p1 = input.point1;
		const p2 = input.point2;
		if (!p1 || !p2) {
			return errorResult('QT-XFMR-4', TITLE_XFMR4, 'Provide both point1 and point2 for two-point loss separation.');
		}
		if (
			!isFinitePos(p1.loadFraction) ||
			!isFinitePos(p2.loadFraction) ||
			p1.loadFraction === p2.loadFraction ||
			!isFinitePos(p1.pf) ||
			p1.pf > 1 ||
			!isFinitePos(p2.pf) ||
			p2.pf > 1 ||
			!isFinitePos(p1.efficiencyPercent) ||
			p1.efficiencyPercent >= 100 ||
			!isFinitePos(p2.efficiencyPercent) ||
			p2.efficiencyPercent >= 100
		) {
			return errorResult(
				'QT-XFMR-4',
				TITLE_XFMR4,
				'Provide two distinct load fractions with valid PF (0..1) and efficiency (0..100%).'
			);
		}

		const eta1 = p1.efficiencyPercent / 100;
		const eta2 = p2.efficiencyPercent / 100;
		const loss1 = p1.loadFraction * input.ratedVA * p1.pf * (1 / eta1 - 1);
		const loss2 = p2.loadFraction * input.ratedVA * p2.pf * (1 / eta2 - 1);

		const x1Sq = p1.loadFraction * p1.loadFraction;
		const x2Sq = p2.loadFraction * p2.loadFraction;
		pCuFlW = (loss1 - loss2) / (x1Sq - x2Sq);
		pCoreW = loss1 - x1Sq * pCuFlW;

		if (pCoreW <= 0 || pCuFlW <= 0) {
			return errorResult(
				'QT-XFMR-4',
				TITLE_XFMR4,
				'Non-physical efficiency points: separated core or copper loss is <= 0.'
			);
		}

		evalX = input.targetLoadFraction ?? 0.75;
		evalPf = input.targetPf ?? 1;

		steps.push({
			title: 'Separate Core & Full-Load Copper Losses from Two Operating Points',
			formulaLatex:
				'P_i + x_k^2 P_{cu,\\text{FL}} = x_k S_{\\text{rated}}\\cos\\phi_k\\left(\\frac{1}{\\eta_k} - 1\\right)',
			substitutionLatex: `P_{\\text{loss},1} = ${fmt(loss1, 1)}\\text{ W}, \\quad P_{\\text{loss},2} = ${fmt(loss2, 1)}\\text{ W}`,
			resultLatex: `P_i = ${fmt(pCoreW / 1000, 3)}\\text{ kW}, \\quad P_{cu,\\text{FL}} = ${fmt(pCuFlW / 1000, 3)}\\text{ kW}`
		});
	}

	const pOutW = evalX * input.ratedVA * evalPf;
	const pCuLoadW = evalX * evalX * pCuFlW;
	const efficiencyPercent = (pOutW / (pOutW + pCoreW + pCuLoadW)) * 100;

	const xMaxEff = Math.sqrt(pCoreW / pCuFlW);
	const sMaxEffVA = xMaxEff * input.ratedVA;
	const maxEffPf = input.maxEffPf ?? evalPf;
	const etaMaxPercent = ((sMaxEffVA * maxEffPf) / (sMaxEffVA * maxEffPf + 2 * pCoreW)) * 100;

	steps.push({
		title: `Efficiency at x = ${fmt(evalX, 3)} & PF = ${fmt(evalPf, 3)}`,
		formulaLatex:
			'\\eta(x) = \\frac{x S_{\\text{rated}}\\cos\\phi}{x S_{\\text{rated}}\\cos\\phi + P_i + x^2 P_{cu,\\text{FL}}}\\times 100\\%',
		substitutionLatex: `\\eta = \\frac{${fmt(pOutW, 1)}}{${fmt(pOutW, 1)} + ${fmt(pCoreW, 1)} + ${fmt(pCuLoadW, 1)}}\\times 100\\%`,
		resultLatex: `\\eta = ${fmt(efficiencyPercent, 2)}\\%`
	});

	steps.push({
		title: 'Maximum Efficiency Condition',
		formulaLatex:
			'x_{\\max\\eta} = \\sqrt{\\frac{P_i}{P_{cu,\\text{FL}}}}, \\quad S_{\\max\\eta} = x_{\\max\\eta} S_{\\text{rated}}, \\quad \\eta_{\\max} = \\frac{S_{\\max\\eta}\\cos\\phi}{S_{\\max\\eta}\\cos\\phi + 2 P_i}\\times 100\\%',
		resultLatex: `x_{\\max\\eta} = ${fmt(xMaxEff, 4)}, \\quad S_{\\max\\eta} = ${fmt(sMaxEffVA / 1000, 3)}\\text{ kVA}, \\quad \\eta_{\\max} = ${fmt(etaMaxPercent, 2)}\\%`
	});

	answers.push(
		makeAnswer('pCoreW', 'Core (Iron) Loss', pCoreW, 'W', { symbolLatex: 'P_i', decimals: 2 }),
		makeAnswer('pCuFlW', 'Full-Load Copper Loss', pCuFlW, 'W', { symbolLatex: 'P_{cu,\\text{FL}}', decimals: 2 }),
		makeAnswer('efficiencyPercent', 'Efficiency at Target Load', efficiencyPercent, '%', {
			symbolLatex: '\\eta',
			decimals: 2,
			highlight: true
		}),
		makeAnswer('xMaxEff', 'Load Fraction for Max Efficiency', xMaxEff, '', {
			symbolLatex: 'x_{\\max\\eta}',
			decimals: 4
		}),
		makeAnswer('sMaxEffKVA', 'kVA for Max Efficiency', sMaxEffVA / 1000, 'kVA', {
			symbolLatex: 'S_{\\max\\eta}',
			decimals: 3,
			highlight: true
		}),
		makeAnswer('etaMaxPercent', 'Maximum Efficiency', etaMaxPercent, '%', {
			symbolLatex: '\\eta_{\\max}',
			decimals: 2,
			highlight: true
		})
	);

	return {
		valid: true,
		questionType: 'QT-XFMR-4',
		title: TITLE_XFMR4,
		answers,
		values: {
			pCoreW,
			pCoreKW: pCoreW / 1000,
			pCuFlW,
			pCuFlKW: pCuFlW / 1000,
			pCuLoadW,
			pOutW,
			efficiencyPercent,
			xMaxEff,
			sMaxEffVA,
			sMaxEffKVA: sMaxEffVA / 1000,
			etaMaxPercent
		},
		steps
	};
}
