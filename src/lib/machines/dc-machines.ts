import {
	errorResult,
	fmt,
	isFiniteNonNeg,
	isFinitePos,
	makeAnswer
} from './math-helpers';
import type {
	DcEmfTorqueInput,
	DcGeneratorInput,
	DcMotorInput,
	MachineAnswerItem,
	MachineSolveResult,
	MachineStep
} from './types';

const TITLE_DC1 = 'DC Machine EMF, Winding Constant & Torque';
const TITLE_DC2 = 'DC Generator Steady-State Analysis';
const TITLE_DC3 = 'DC Motor Speed Control & Operating Point';

// ============================================================================
// QT-DC-1: Induced EMF, Lap/Wave Constant, K_e / K_t & Torque Scaling
// ============================================================================

export function solveDcEmfAndTorque(input: DcEmfTorqueInput): MachineSolveResult {
	if (!isFinitePos(input.speedRpm)) {
		return errorResult('QT-DC-1', TITLE_DC1, 'Speed n (rpm) must be positive.');
	}

	const omega = (2 * Math.PI * input.speedRpm) / 60;
	const steps: MachineStep[] = [];
	const answers: MachineAnswerItem[] = [];

	if (input.mode === 'winding-design') {
		if (!isFinitePos(input.poles) || !isFinitePos(input.conductors) || !isFinitePos(input.fluxPerPoleWb)) {
			return errorResult('QT-DC-1', TITLE_DC1, 'Poles P, conductors Z_a, and flux per pole must be positive.');
		}
		const winding = input.winding ?? 'lap';
		const parallelPaths = winding === 'lap' ? input.poles : 2;
		const kg = (input.poles * input.conductors) / (60 * parallelPaths);
		const km = (input.poles * input.conductors) / (2 * Math.PI * parallelPaths);
		const ea = kg * input.speedRpm * input.fluxPerPoleWb;
		const ke = ea / omega; // = kt = km * fluxPerPoleWb

		steps.push({
			title: `Winding Constant (${winding === 'lap' ? 'Lap: a = P' : 'Wave: a = 2'}) & Generated EMF`,
			formulaLatex: 'E_a = \\frac{P Z_a}{60 a}\\,n\\,\\Phi_p, \\quad K_e = K_t = \\frac{E_a}{\\omega} = \\frac{P Z_a}{2\\pi a}\\Phi_p',
			substitutionLatex: `a = ${parallelPaths}, \\quad E_a = \\frac{(${input.poles})(${input.conductors})}{60(${parallelPaths})}(${input.speedRpm})(${fmt(input.fluxPerPoleWb, 5)})`,
			resultLatex: `E_a = ${fmt(ea, 3)}\\text{ V}, \\quad K_e = K_t = ${fmt(ke, 4)}\\text{ V}\\cdot\\text{s/rad}`
		});

		answers.push(
			makeAnswer('eaV', 'Generated EMF', ea, 'V', {
				symbolLatex: 'E_a',
				decimals: 3,
				highlight: true,
				group: 'voltages'
			}),
			makeAnswer('omegaRadS', 'Angular Speed', omega, 'rad/s', {
				symbolLatex: '\\omega_m',
				decimals: 3,
				group: 'mechanical'
			}),
			makeAnswer('ke', 'EMF / Torque Constant', ke, 'N·m/A', {
				symbolLatex: 'K_e = K_t',
				decimals: 4,
				highlight: true,
				group: 'general'
			}),
			makeAnswer('parallelPaths', 'Parallel Paths', parallelPaths, '', {
				symbolLatex: 'a',
				decimals: 0,
				group: 'general'
			})
		);

		const values: Record<string, number> = {
			parallelPaths,
			kg,
			km,
			eaV: ea,
			omegaRadS: omega,
			ke,
			kt: ke
		};

		if (isFinitePos(input.armatureCurrentA)) {
			const pd = ea * input.armatureCurrentA;
			const td = ke * input.armatureCurrentA;
			values.pdW = pd;
			values.tdNm = td;
			steps.push({
				title: 'Developed Power & Electromagnetic Torque',
				formulaLatex: 'P_d = E_a I_a, \\quad T_d = \\frac{P_d}{\\omega} = K_t I_a',
				resultLatex: `P_d = ${fmt(pd, 2)}\\text{ W}, \\quad T_d = ${fmt(td, 3)}\\text{ N}\\cdot\\text{m}`
			});
			answers.push(
				makeAnswer('pdW', 'Developed Power', pd, 'W', {
					symbolLatex: 'P_d',
					decimals: 2,
					group: 'power'
				}),
				makeAnswer('tdNm', 'Developed Torque', td, 'N·m', {
					symbolLatex: 'T_d',
					decimals: 3,
					highlight: true,
					group: 'mechanical'
				})
			);
		}

		return { valid: true, questionType: 'QT-DC-1', title: TITLE_DC1, answers, values, steps };
	}

	// Operating-point mode (ST-16, ST-17)
	if (!isFinitePos(input.vtV) || !isFiniteNonNeg(input.raOhm)) {
		return errorResult('QT-DC-1', TITLE_DC1, 'Terminal voltage V_t must be positive and R_a >= 0.');
	}
	let ia: number;
	if (isFinitePos(input.armatureCurrentA)) {
		ia = input.armatureCurrentA;
	} else if (isFinitePos(input.pInW)) {
		ia = input.pInW / input.vtV;
	} else {
		return errorResult('QT-DC-1', TITLE_DC1, 'Provide positive armatureCurrentA or pInW.');
	}

	const isGen = input.machineMode === 'generator';
	const ea = isGen ? input.vtV + ia * input.raOhm : input.vtV - ia * input.raOhm;
	if (ea <= 0) {
		return errorResult('QT-DC-1', TITLE_DC1, 'Computed back EMF E_a <= 0; check V_t, I_a, and R_a.');
	}

	const ke = ea / omega;
	const keRpm = ea / input.speedRpm;
	const pd = ea * ia;
	const td1 = pd / omega;

	steps.push({
		title: 'Back EMF & Angular Speed',
		formulaLatex: isGen
			? 'E_a = V_t + I_a R_a, \\quad \\omega = \\frac{2\\pi n}{60}'
			: 'E_a = V_t - I_a R_a, \\quad \\omega = \\frac{2\\pi n}{60}',
		substitutionLatex: `E_a = ${input.vtV} ${isGen ? '+' : '-'} (${fmt(ia, 3)})(${input.raOhm}), \\quad \\omega = \\frac{2\\pi(${input.speedRpm})}{60}`,
		resultLatex: `E_a = ${fmt(ea, 3)}\\text{ V}, \\quad \\omega = ${fmt(omega, 3)}\\text{ rad/s}`
	});

	steps.push({
		title: 'Torque / EMF Constant & Developed Torque',
		formulaLatex: 'K_t = K_e = \\frac{E_a}{\\omega}, \\quad P_d = E_a I_a, \\quad T_d = \\frac{P_d}{\\omega} = K_t I_a',
		resultLatex: `K_t = K_e = ${fmt(ke, 4)}\\text{ N}\\cdot\\text{m/A}, \\quad T_d = ${fmt(td1, 3)}\\text{ N}\\cdot\\text{m}`
	});

	answers.push(
		makeAnswer('eaV', 'Induced EMF', ea, 'V', {
			symbolLatex: 'E_a',
			decimals: 3,
			group: 'voltages'
		}),
		makeAnswer('ia1A', 'Armature Current', ia, 'A', {
			symbolLatex: 'I_a',
			decimals: 3,
			group: 'currents'
		}),
		makeAnswer('pdW', 'Developed Power', pd, 'W', {
			symbolLatex: 'P_d',
			decimals: 2,
			group: 'power'
		}),
		makeAnswer('omegaRadS', 'Angular Speed', omega, 'rad/s', {
			symbolLatex: '\\omega_m',
			decimals: 3,
			group: 'mechanical'
		}),
		makeAnswer('td1Nm', 'Developed Torque (Point 1)', td1, 'N·m', {
			symbolLatex: 'T_{d1}',
			decimals: 3,
			highlight: true,
			group: 'mechanical'
		}),
		makeAnswer('kt', 'Torque / EMF Constant', ke, 'N·m/A', {
			symbolLatex: 'K_t = K_e',
			decimals: 4,
			highlight: true,
			group: 'general'
		})
	);

	const values: Record<string, number> = {
		ia1A: ia,
		eaV: ea,
		omegaRadS: omega,
		ke,
		kt: ke,
		keRpm,
		pdW: pd,
		td1Nm: td1
	};

	if (isFinitePos(input.targetArmatureCurrentA)) {
		const td2 = ke * input.targetArmatureCurrentA;
		values.ia2A = input.targetArmatureCurrentA;
		values.td2Nm = td2;
		steps.push({
			title: 'Torque Scaling at Constant Field Flux',
			formulaLatex: 'T_{d2} = T_{d1}\\frac{I_{a2}}{I_{a1}} = K_t I_{a2}',
			substitutionLatex: `T_{d2} = ${fmt(td1, 3)}\\times\\frac{${input.targetArmatureCurrentA}}{${fmt(ia, 3)}}`,
			resultLatex: `T_{d2} = ${fmt(td2, 3)}\\text{ N}\\cdot\\text{m}`
		});
		answers.push(
			makeAnswer('td2Nm', 'Scaled Developed Torque', td2, 'N·m', {
				symbolLatex: 'T_{d2}',
				decimals: 3,
				highlight: true,
				group: 'mechanical'
			})
		);
	}

	return { valid: true, questionType: 'QT-DC-1', title: TITLE_DC1, answers, values, steps };
}

// ============================================================================
// QT-DC-2: DC Generator Steady-State Analysis
// ============================================================================

export function solveDcGenerator(input: DcGeneratorInput): MachineSolveResult {
	if (!isFinitePos(input.vtV) || !isFinitePos(input.raOhm)) {
		return errorResult('QT-DC-2', TITLE_DC2, 'Terminal voltage V_t and armature resistance R_a must be positive.');
	}

	const vBrush = input.vBrushV ?? 0;
	const pRot = input.pRotW ?? 0;
	if (!isFiniteNonNeg(vBrush) || !isFiniteNonNeg(pRot)) {
		return errorResult('QT-DC-2', TITLE_DC2, 'Brush drop and rotational losses must be >= 0.');
	}

	let iField = 0;
	const rFieldTotal = (input.rfOhm ?? 0) + (input.rrhOhm ?? 0);
	if (input.generatorType === 'shunt') {
		if (!isFinitePos(rFieldTotal)) {
			return errorResult('QT-DC-2', TITLE_DC2, 'Shunt generator requires positive field resistance R_f.');
		}
		iField = input.vtV / rFieldTotal;
	}

	let iLoad: number;
	let iArm: number;
	let ea: number;

	const steps: MachineStep[] = [];
	const answers: MachineAnswerItem[] = [];

	if (input.solveFor === 'load-from-emf') {
		if (!isFinitePos(input.eaV)) {
			return errorResult('QT-DC-2', TITLE_DC2, 'Generated EMF E_a must be positive.');
		}
		ea = input.eaV;
		iArm = (ea - input.vtV - vBrush) / input.raOhm;
		if (iArm < 0) {
			return errorResult('QT-DC-2', TITLE_DC2, 'E_a must exceed V_t + V_brush for generator operation.');
		}
		iLoad = input.generatorType === 'shunt' ? iArm - iField : iArm;
		if (iLoad < 0) {
			return errorResult('QT-DC-2', TITLE_DC2, 'Field current exceeds armature current (negative load current).');
		}

		steps.push({
			title: 'Armature & Field Currents',
			formulaLatex:
				input.generatorType === 'shunt'
					? 'I_a = \\frac{E_a - V_t}{R_a}, \\quad I_f = \\frac{V_t}{R_f + R_{rh}}, \\quad I_L = I_a - I_f'
					: 'I_a = I_L = \\frac{E_a - V_t}{R_a}',
			substitutionLatex: `I_a = \\frac{${ea} - ${input.vtV}}{${input.raOhm}} = ${fmt(iArm, 2)}\\text{ A}` +
				(input.generatorType === 'shunt' ? `, \\quad I_f = \\frac{${input.vtV}}{${rFieldTotal}} = ${fmt(iField, 2)}\\text{ A}` : ''),
			resultLatex: `I_L = ${fmt(iLoad, 2)}\\text{ A}`
		});
	} else {
		if (isFiniteNonNeg(input.iLoadA)) {
			iLoad = input.iLoadA;
		} else if (isFiniteNonNeg(input.pOutW)) {
			iLoad = input.pOutW / input.vtV;
		} else {
			return errorResult('QT-DC-2', TITLE_DC2, 'Provide iLoadA or pOutW for emf-from-load mode.');
		}
		iArm = input.generatorType === 'shunt' ? iLoad + iField : iLoad;
		ea = input.vtV + iArm * input.raOhm + vBrush;

		steps.push({
			title: 'Armature Current & Generated EMF',
			formulaLatex:
				input.generatorType === 'shunt'
					? 'I_f = \\frac{V_t}{R_f + R_{rh}}, \\quad I_a = I_L + I_f, \\quad E_a = V_t + I_a R_a'
					: 'I_a = I_L, \\quad E_a = V_t + I_a R_a',
			substitutionLatex: `I_a = ${fmt(iArm, 2)}\\text{ A}, \\quad E_a = ${input.vtV} + (${fmt(iArm, 2)})(${input.raOhm})`,
			resultLatex: `E_a = ${fmt(ea, 2)}\\text{ V}`
		});
	}

	const pOutW = input.vtV * iLoad;
	const pDevW = ea * iArm;
	const pCuArmW = iArm * iArm * input.raOhm;
	const pCuFieldW = input.generatorType === 'shunt' ? iField * iField * rFieldTotal : 0;
	const pInW = pDevW + pRot;
	const efficiencyPercent = pInW > 0 ? (pOutW / pInW) * 100 : 0;

	const vNl = isFinitePos(input.vNoLoadV) ? input.vNoLoadV : ea;
	const vrPercent = ((vNl - input.vtV) / input.vtV) * 100;

	steps.push({
		title: 'Power Balance & Voltage Regulation',
		formulaLatex:
			'P_d = E_a I_a, \\quad P_{\\text{out}} = V_t I_L, \\quad \\%VR = \\frac{V_{nl} - V_t}{V_t}\\times 100\\%',
		resultLatex: `P_{\\text{out}} = ${fmt(pOutW / 1000, 3)}\\text{ kW}, \\quad \\eta = ${fmt(efficiencyPercent, 2)}\\%, \\quad \\%VR = ${fmt(vrPercent, 2)}\\%`
	});

	const values: Record<string, number> = {
		iaA: iArm,
		ifA: iField,
		iLoadA: iLoad,
		eaV: ea,
		pDevW,
		pOutW,
		pCuArmW,
		pCuFieldW,
		pInW,
		efficiencyPercent,
		vrPercent
	};

	answers.push(
		makeAnswer('eaV', 'Generated EMF', ea, 'V', {
			symbolLatex: 'E_a',
			decimals: 2,
			highlight: input.solveFor === 'emf-from-load',
			group: 'voltages'
		}),
		makeAnswer('vrPercent', 'Voltage Regulation', vrPercent, '%', {
			symbolLatex: '\\%VR',
			decimals: 2,
			group: 'voltages'
		}),
		makeAnswer('iLoadA', 'Load Current', iLoad, 'A', {
			symbolLatex: 'I_L',
			decimals: 2,
			highlight: input.solveFor === 'load-from-emf',
			group: 'currents'
		}),
		makeAnswer('iaA', 'Armature Current', iArm, 'A', {
			symbolLatex: 'I_a',
			decimals: 2,
			group: 'currents'
		}),
		makeAnswer('ifA', 'Field Current', iField, 'A', {
			symbolLatex: 'I_f',
			decimals: 2,
			group: 'currents'
		}),
		makeAnswer('pOutW', 'Output Power', pOutW, 'W', {
			symbolLatex: 'P_{\\text{out}}',
			decimals: 2,
			highlight: true,
			group: 'power',
			formatted: `${fmt(pOutW / 1000, 3)} kW`
		}),
		makeAnswer('pDevW', 'Developed Power', pDevW, 'W', {
			symbolLatex: 'P_d',
			decimals: 2,
			group: 'power',
			formatted: `${fmt(pDevW / 1000, 3)} kW`
		}),
		makeAnswer('pCuArmW', 'Armature Copper Loss', pCuArmW, 'W', {
			symbolLatex: 'P_{cu,a}',
			decimals: 2,
			group: 'power'
		}),
		makeAnswer('pCuFieldW', 'Field Copper Loss', pCuFieldW, 'W', {
			symbolLatex: 'P_{cu,f}',
			decimals: 2,
			group: 'power'
		}),
		makeAnswer('efficiencyPercent', 'Efficiency', efficiencyPercent, '%', {
			symbolLatex: '\\eta',
			decimals: 2,
			group: 'power'
		})
	);

	if (isFinitePos(input.speed1Rpm) && isFinitePos(input.speed2Rpm)) {
		const eaScaled = ea * (input.speed2Rpm / input.speed1Rpm);
		values.eaScaledV = eaScaled;
		steps.push({
			title: 'EMF Speed Scaling (Constant Flux)',
			formulaLatex: 'E_{a2} = E_{a1}\\frac{n_2}{n_1}',
			resultLatex: `E_{a2} = ${fmt(eaScaled, 2)}\\text{ V}`
		});
		answers.push(
			makeAnswer('eaScaledV', 'Scaled Generated EMF', eaScaled, 'V', {
				symbolLatex: 'E_{a2}',
				decimals: 2,
				group: 'voltages'
			})
		);
	}

	return { valid: true, questionType: 'QT-DC-2', title: TITLE_DC2, answers, values, steps };
}

// ============================================================================
// QT-DC-3: DC Motor Speed Control & Operating-Point Re-evaluation
// ============================================================================

export function solveDcMotor(input: DcMotorInput): MachineSolveResult {
	if (!isFinitePos(input.vt1V) || !isFinitePos(input.n1Rpm) || !isFiniteNonNeg(input.raOhm)) {
		return errorResult('QT-DC-3', TITLE_DC3, 'V_t1, n1 must be positive and R_a >= 0.');
	}

	const vBrush = input.vBrushV ?? 0;
	let if1 = 0;
	if (input.motorType === 'shunt' && isFinitePos(input.rfOhm)) {
		if1 = input.vt1V / input.rfOhm;
	}

	let ia1: number;
	if (isFinitePos(input.ia1A)) {
		ia1 = input.ia1A;
	} else if (isFinitePos(input.pIn1W)) {
		const iLine1 = input.pIn1W / input.vt1V;
		ia1 = input.motorType === 'shunt' ? iLine1 - if1 : iLine1;
	} else {
		return errorResult('QT-DC-3', TITLE_DC3, 'Provide positive ia1A or pIn1W.');
	}

	if (ia1 <= 0) {
		return errorResult('QT-DC-3', TITLE_DC3, 'Armature current I_a1 must be positive.');
	}

	const ea1 = input.vt1V - ia1 * input.raOhm - vBrush;
	if (ea1 <= 0) {
		return errorResult('QT-DC-3', TITLE_DC3, 'Initial back EMF E_a1 <= 0; check V_t1, I_a1, R_a.');
	}

	const omega1 = (2 * Math.PI * input.n1Rpm) / 60;
	const ke = ea1 / omega1;
	const keRpm = ea1 / input.n1Rpm;
	const pd1 = ea1 * ia1;
	const td1 = pd1 / omega1;

	const steps: MachineStep[] = [
		{
			title: 'Base Operating Point (State 1)',
			formulaLatex: 'E_{a1} = V_{t1} - I_{a1} R_a, \\quad K_e = \\frac{E_{a1}}{\\omega_1}, \\quad T_{d1} = \\frac{E_{a1} I_{a1}}{\\omega_1}',
			substitutionLatex: `E_{a1} = ${input.vt1V} - (${fmt(ia1, 3)})(${input.raOhm}) = ${fmt(ea1, 3)}\\text{ V}`,
			resultLatex: `K_e = ${fmt(ke, 4)}\\text{ V}\\cdot\\text{s/rad}\\;(${fmt(keRpm, 5)}\\text{ V/rpm}), \\quad T_{d1} = ${fmt(td1, 3)}\\text{ N}\\cdot\\text{m}`
		}
	];

	const answers: MachineAnswerItem[] = [
		makeAnswer('ea1V', 'Base Back EMF', ea1, 'V', {
			symbolLatex: 'E_{a1}',
			decimals: 3,
			group: 'voltages'
		}),
		makeAnswer('ia1A', 'Base Armature Current', ia1, 'A', {
			symbolLatex: 'I_{a1}',
			decimals: 3,
			group: 'currents'
		}),
		makeAnswer('omega1RadS', 'Base Angular Speed', omega1, 'rad/s', {
			symbolLatex: '\\omega_{m1}',
			decimals: 3,
			group: 'mechanical'
		}),
		makeAnswer('td1Nm', 'Base Developed Torque', td1, 'N·m', {
			symbolLatex: 'T_{d1}',
			decimals: 3,
			group: 'mechanical'
		}),
		makeAnswer('pd1W', 'Base Developed Power', pd1, 'W', {
			symbolLatex: 'P_{d1}',
			decimals: 2,
			group: 'power'
		}),
		makeAnswer('ke', 'EMF / Torque Constant', ke, 'V·s/rad', {
			symbolLatex: 'K_e',
			decimals: 4,
			highlight: true,
			group: 'general'
		})
	];

	if (input.motorType === 'shunt' && if1 > 0) {
		answers.push(
			makeAnswer('if1A', 'Shunt Field Current', if1, 'A', {
				symbolLatex: 'I_f',
				decimals: 3,
				group: 'currents'
			})
		);
	}

	const values: Record<string, number> = {
		ia1A: ia1,
		if1A: if1,
		ea1V: ea1,
		omega1RadS: omega1,
		ke,
		keRpm,
		pd1W: pd1,
		td1Nm: td1
	};

	if (input.controlMode === 'starting') {
		if (!isFinitePos(input.maxStartCurrentA)) {
			return errorResult('QT-DC-3', TITLE_DC3, 'Provide positive maxStartCurrentA for starting mode.');
		}
		const rStart = Math.max(0, (input.vt1V - vBrush) / input.maxStartCurrentA - input.raOhm);
		values.rStartOhm = rStart;
		steps.push({
			title: 'Armature Starting Resistance',
			formulaLatex: 'R_{\\text{start}} = \\frac{V_t}{I_{\\text{start,max}}} - R_a',
			resultLatex: `R_{\\text{start}} = ${fmt(rStart, 4)}\\,\\Omega`
		});
		answers.push(
			makeAnswer('rStartOhm', 'Required Starting Resistance', rStart, 'Ω', {
				symbolLatex: 'R_{\\text{start}}',
				decimals: 4,
				highlight: true,
				group: 'impedance'
			})
		);
		return { valid: true, questionType: 'QT-DC-3', title: TITLE_DC3, answers, values, steps };
	}

	let vt2 = input.vt1V;
	let rArm2 = input.raOhm;
	let fluxRatio = 1; // Phi_2 / Phi_1
	let ia2 = ia1;

	if (input.controlMode === 'armature-resistance') {
		const rAdd = input.rAddOhm ?? 0;
		const torqueRatio = input.torqueRatio ?? 1;
		if (!isFiniteNonNeg(rAdd) || !isFinitePos(torqueRatio)) {
			return errorResult('QT-DC-3', TITLE_DC3, 'R_add must be >= 0 and torqueRatio > 0.');
		}
		rArm2 = input.raOhm + rAdd;
		ia2 = ia1 * torqueRatio; // Constant flux => T_d proportional to I_a
	} else if (input.controlMode === 'terminal-voltage') {
		if (!isFinitePos(input.vt2V)) {
			return errorResult('QT-DC-3', TITLE_DC3, 'New terminal voltage V_t2 must be positive.');
		}
		vt2 = input.vt2V;
		const constraint = input.loadConstraint ?? 'constant-torque';
		if (constraint === 'constant-power') {
			const pArm1 = input.pIn1W ?? input.vt1V * ia1;
			ia2 = pArm1 / vt2;
		} else {
			ia2 = ia1;
		}
	} else if (input.controlMode === 'field-flux') {
		if (!isFinitePos(input.fluxRatio)) {
			return errorResult('QT-DC-3', TITLE_DC3, 'Flux ratio Phi_2/Phi_1 must be positive.');
		}
		fluxRatio = input.fluxRatio;
		const constraint = input.loadConstraint ?? 'constant-torque';
		ia2 = constraint === 'constant-torque' ? ia1 / fluxRatio : ia1;
	}

	const ea2 = vt2 - ia2 * rArm2 - vBrush;
	const n2Rpm = input.n1Rpm * (ea2 / ea1) * (1 / fluxRatio);
	const omega2 = (2 * Math.PI * n2Rpm) / 60;
	const pd2 = ea2 * ia2;
	const td2 = ke * fluxRatio * ia2;

	steps.push({
		title: 'New Operating Point (State 2)',
		formulaLatex:
			'E_{a2} = V_{t2} - I_{a2}(R_a + R_{\\text{add}}), \\quad n_2 = n_1 \\frac{E_{a2}}{E_{a1}}\\frac{\\Phi_1}{\\Phi_2}',
		substitutionLatex: `I_{a2} = ${fmt(ia2, 3)}\\text{ A}, \\quad E_{a2} = ${fmt(vt2, 2)} - (${fmt(ia2, 3)})(${fmt(rArm2, 3)}) = ${fmt(ea2, 3)}\\text{ V}`,
		resultLatex: `n_2 = ${fmt(n2Rpm, 2)}\\text{ rpm}, \\quad T_{d2} = ${fmt(td2, 3)}\\text{ N}\\cdot\\text{m}`
	});

	answers.push(
		makeAnswer('ea2V', 'New Back EMF', ea2, 'V', {
			symbolLatex: 'E_{a2}',
			decimals: 3,
			group: 'voltages'
		}),
		makeAnswer('ia2A', 'New Armature Current', ia2, 'A', {
			symbolLatex: 'I_{a2}',
			decimals: 3,
			group: 'currents'
		}),
		makeAnswer('n2Rpm', 'New Speed', n2Rpm, 'rpm', {
			symbolLatex: 'n_2',
			decimals: 2,
			highlight: true,
			group: 'mechanical'
		}),
		makeAnswer('omega2RadS', 'New Angular Speed', omega2, 'rad/s', {
			symbolLatex: '\\omega_{m2}',
			decimals: 3,
			group: 'mechanical'
		}),
		makeAnswer('td2Nm', 'New Developed Torque', td2, 'N·m', {
			symbolLatex: 'T_{d2}',
			decimals: 3,
			group: 'mechanical'
		}),
		makeAnswer('pd2W', 'New Developed Power', pd2, 'W', {
			symbolLatex: 'P_{d2}',
			decimals: 2,
			group: 'power'
		})
	);

	Object.assign(values, {
		vt2V: vt2,
		ia2A: ia2,
		ea2V: ea2,
		n2Rpm,
		omega2RadS: omega2,
		pd2W: pd2,
		td2Nm: td2
	});

	return { valid: true, questionType: 'QT-DC-3', title: TITLE_DC3, answers, values, steps };
}
