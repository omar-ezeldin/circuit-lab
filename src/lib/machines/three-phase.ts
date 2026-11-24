import {
	RAD_TO_DEG,
	SQRT3,
	c,
	cAbs,
	cAdd,
	cArgDeg,
	cConj,
	cDiv,
	cFromPolar,
	cMul,
	errorResult,
	fmt,
	fmtComplex,
	fmtPolar,
	fmtPolarTex,
	isFiniteNonNeg,
	isFiniteNum,
	isFinitePos,
	makeAnswer
} from './math-helpers';
import type { MachineAnswerItem, MachineSolveResult, MachineStep, ThreePhaseInput } from './types';

const TITLE = 'Balanced Three-Phase Circuit Analysis';

export function solveThreePhase(input: ThreePhaseInput): MachineSolveResult {
	if (!isFinitePos(input.voltageV)) {
		return errorResult('QT-3PH-1', TITLE, 'Voltage must be a positive finite number.');
	}

	const lineR = input.lineR ?? 0;
	const lineX = input.lineX ?? 0;
	if (!isFiniteNonNeg(lineR) || !isFiniteNum(lineX)) {
		return errorResult('QT-3PH-1', TITLE, 'Line resistance must be >= 0 and reactance finite.');
	}

	const steps: MachineStep[] = [];
	const answers: MachineAnswerItem[] = [];

	// 1. Determine load line voltage V_L and Y-equivalent phase voltage V_AN
	let vLineLoad: number;
	let vPhaseLoad: number;
	if (input.voltageType === 'line') {
		vLineLoad = input.voltageV;
		vPhaseLoad = input.loadConnection === 'Y' ? vLineLoad / SQRT3 : vLineLoad;
	} else {
		vPhaseLoad = input.voltageV;
		vLineLoad = input.loadConnection === 'Y' ? vPhaseLoad * SQRT3 : vPhaseLoad;
	}

	const vANMag = vLineLoad / SQRT3;
	const vAN = c(vANMag, 0);

	steps.push({
		title: 'Load Line & Y-Equivalent Phase Voltage',
		formulaLatex:
			input.loadConnection === 'Y'
				? 'V_L = \\sqrt{3}\\,V_\\phi, \\quad \\bar{V}_{AN} = V_\\phi\\angle 0^\\circ'
				: 'V_L = V_\\phi, \\quad \\bar{V}_{AN} = \\frac{V_L}{\\sqrt{3}}\\angle 0^\\circ',
		substitutionLatex: `V_L = ${fmt(vLineLoad, 2)}\\text{ V},\\quad \\bar{V}_{AN} = \\frac{${fmt(vLineLoad, 2)}}{\\sqrt{3}}\\angle 0^\\circ`,
		resultLatex: `\\bar{V}_{AN} = ${fmtPolarTex(vANMag, 0, 'V')}`
	});

	// 2. Determine line current I_aA and per-phase load complex power S_phi
	let iLine: ReturnType<typeof c>;
	let sLoadPhase: ReturnType<typeof c>;
	let pfLoad: number;
	let thetaDeg: number;

	if (input.loadMode === 'impedance') {
		if (!isFiniteNonNeg(input.loadR) || !isFiniteNum(input.loadX)) {
			return errorResult(
				'QT-3PH-1',
				TITLE,
				'Load resistance R must be >= 0 and reactance X must be a finite number.'
			);
		}
		if (input.loadR === 0 && input.loadX === 0) {
			return errorResult('QT-3PH-1', TITLE, 'Load impedance cannot be zero.');
		}
		const zLoadGiven = c(input.loadR, input.loadX);
		const zY = input.loadConnection === 'D' ? c(zLoadGiven.re / 3, zLoadGiven.im / 3) : zLoadGiven;

		iLine = cDiv(vAN, zY);
		sLoadPhase = cMul(vAN, cConj(iLine));
		thetaDeg = cArgDeg(zY);
		pfLoad = Math.cos((thetaDeg * Math.PI) / 180);

		steps.push({
			title:
				input.loadConnection === 'D'
					? 'Convert Delta Load to Y-Equivalent & Find Line Current'
					: 'Per-Phase Y Load Current',
			formulaLatex:
				input.loadConnection === 'D'
					? 'Z_Y = \\frac{Z_\\Delta}{3}, \\quad \\bar{I}_{aA} = \\frac{\\bar{V}_{AN}}{Z_Y}'
					: '\\bar{I}_{aA} = \\frac{\\bar{V}_{AN}}{Z_Y}',
			substitutionLatex: `Z_Y = ${fmtComplex(zY)}\\,\\Omega, \\quad \\bar{I}_{aA} = \\frac{${fmt(vANMag, 2)}\\angle 0^\\circ}{${fmtPolarTex(cAbs(zY), cArgDeg(zY), '\\Omega')}}`,
			resultLatex: `\\bar{I}_{aA} = ${fmtPolarTex(cAbs(iLine), cArgDeg(iLine), 'A')}`
		});
	} else {
		const pf = input.pf;
		if (!isFinitePos(pf) || pf > 1) {
			return errorResult('QT-3PH-1', TITLE, 'Power factor must satisfy 0 < pf <= 1.');
		}
		pfLoad = pf;
		const pfType = input.pfType ?? (pf === 1 ? 'unity' : 'lag');
		const angleMagDeg = Math.acos(pf) * RAD_TO_DEG;
		thetaDeg = pfType === 'lead' ? -angleMagDeg : pfType === 'unity' ? 0 : angleMagDeg;

		const scope = input.powerScope ?? 'total';
		let sPhaseMag: number;
		if (isFinitePos(input.powerW)) {
			const pPhase = scope === 'total' ? input.powerW / 3 : input.powerW;
			sPhaseMag = pPhase / pf;
		} else if (isFinitePos(input.apparentVA)) {
			sPhaseMag = scope === 'total' ? input.apparentVA / 3 : input.apparentVA;
		} else {
			return errorResult(
				'QT-3PH-1',
				TITLE,
				'Provide positive active power (powerW) or apparent power (apparentVA).'
			);
		}

		sLoadPhase = cFromPolar(sPhaseMag, thetaDeg);
		iLine = cConj(cDiv(sLoadPhase, vAN));

		steps.push({
			title: 'Per-Phase Complex Power & Line Current',
			formulaLatex:
				'S_\\phi = |S_\\phi|\\angle\\theta_\\phi, \\quad \\bar{I}_{aA} = \\left(\\frac{S_\\phi}{\\bar{V}_{AN}}\\right)^*',
			substitutionLatex: `S_\\phi = ${fmtPolarTex(sPhaseMag / 1000, thetaDeg, 'kVA')},\\quad \\bar{I}_{aA} = \\left(\\frac{${fmtPolarTex(sPhaseMag, thetaDeg)}}{${fmt(vANMag, 2)}\\angle 0^\\circ}\\right)^*`,
			resultLatex: `\\bar{I}_{aA} = ${fmtPolarTex(cAbs(iLine), cArgDeg(iLine), 'A')}`
		});
	}

	const iLineMag = cAbs(iLine);
	const iLineDeg = cArgDeg(iLine);

	// Phase current in load
	const iPhaseMag = input.loadConnection === 'D' ? iLineMag / SQRT3 : iLineMag;
	const iPhaseDeg = input.loadConnection === 'D' ? iLineDeg + 30 : iLineDeg;

	const pTotal = 3 * sLoadPhase.re;
	const qTotal = 3 * sLoadPhase.im;
	const sTotalMag = 3 * cAbs(sLoadPhase);

	steps.push({
		title: 'Total Three-Phase Load Power',
		formulaLatex:
			'P_{\\text{tot}} = 3 P_\\phi = \\sqrt{3}\\,V_L I_L \\cos\\theta_\\phi, \\quad Q_{\\text{tot}} = 3 Q_\\phi, \\quad |S_{\\text{tot}}| = \\sqrt{3}\\,V_L I_L',
		resultLatex: `P_{\\text{tot}} = ${fmt(pTotal / 1000, 3)}\\text{ kW},\\; Q_{\\text{tot}} = ${fmt(qTotal / 1000, 3)}\\text{ kVAR},\\; |S_{\\text{tot}}| = ${fmt(sTotalMag / 1000, 3)}\\text{ kVA}`
	});

	// 3. Optional line impedance & source-side quantities
	const zLine = c(lineR, lineX);
	const hasLine = lineR > 0 || Math.abs(lineX) > 0;
	const vDrop = cMul(iLine, zLine);
	const vSourcePhase = cAdd(vAN, vDrop);
	const vSourcePhaseMag = cAbs(vSourcePhase);
	const vSourcePhaseDeg = cArgDeg(vSourcePhase);
	const vSourceLineMag = SQRT3 * vSourcePhaseMag;

	const sLinePhase = c(iLineMag * iLineMag * lineR, iLineMag * iLineMag * lineX);
	const sSourcePhase = cMul(vSourcePhase, cConj(iLine));
	const sSourcePhaseMag = cAbs(sSourcePhase);
	const sSourcePhaseDeg = cArgDeg(sSourcePhase);
	const sLinePhaseMag = cAbs(sLinePhase);
	const sLinePhaseDeg = hasLine ? cArgDeg(sLinePhase) : 0;

	if (hasLine) {
		steps.push({
			title: 'Source Phase Voltage (with Line Impedance)',
			formulaLatex: '\\bar{V}_{an} = \\bar{V}_{AN} + \\bar{I}_{aA} Z_{\\text{line}}',
			substitutionLatex: `\\bar{V}_{an} = ${fmtPolarTex(vANMag, 0)} + (${fmtPolarTex(iLineMag, iLineDeg)})(${fmtComplex(zLine)})`,
			resultLatex: `\\bar{V}_{an} = ${fmtPolarTex(vSourcePhaseMag, vSourcePhaseDeg, 'V')}, \\quad V_{L,\\text{src}} = ${fmt(vSourceLineMag, 2)}\\text{ V}`
		});

		steps.push({
			title: 'Line Losses & Source Complex Power (Per Phase)',
			formulaLatex:
				'S_{\\text{line},\\phi} = |\\bar{I}_{aA}|^2 Z_{\\text{line}}, \\quad S_{an} = \\bar{V}_{an}\\bar{I}_{aA}^*',
			resultLatex: `S_{\\text{line},\\phi} = ${fmtPolarTex(sLinePhaseMag / 1000, sLinePhaseDeg, 'kVA')}, \\quad S_{an} = ${fmtPolarTex(sSourcePhaseMag / 1000, sSourcePhaseDeg, 'kVA')}`
		});
	}

	answers.push(
		makeAnswer('iLineMag', 'Line Current (RMS)', iLineMag, 'A', {
			symbolLatex: '|\\bar{I}_L|',
			decimals: 2,
			highlight: true,
			formatted: fmtPolar(iLineMag, iLineDeg, 'A', 2)
		}),
		makeAnswer('iPhaseMag', 'Load Phase Current (RMS)', iPhaseMag, 'A', {
			symbolLatex: '|\\bar{I}_\\phi|',
			decimals: 2,
			formatted: fmtPolar(iPhaseMag, iPhaseDeg, 'A', 2)
		}),
		makeAnswer('vLineLoad', 'Load Line Voltage', vLineLoad, 'V', {
			symbolLatex: 'V_L',
			decimals: 2
		}),
		makeAnswer('vPhaseLoad', 'Load Phase Voltage', vPhaseLoad, 'V', {
			symbolLatex: 'V_\\phi',
			decimals: 2
		}),
		makeAnswer('pTotalW', 'Total Active Power', pTotal, 'W', {
			symbolLatex: 'P_{\\text{tot}}',
			decimals: 2,
			highlight: true,
			formatted: `${fmt(pTotal / 1000, 3)} kW`
		}),
		makeAnswer('qTotalVar', 'Total Reactive Power', qTotal, 'VAR', {
			symbolLatex: 'Q_{\\text{tot}}',
			decimals: 2,
			formatted: `${fmt(qTotal / 1000, 3)} kVAR`
		}),
		makeAnswer('sTotalVA', 'Total Apparent Power', sTotalMag, 'VA', {
			symbolLatex: '|S_{\\text{tot}}|',
			decimals: 2,
			formatted: `${fmt(sTotalMag / 1000, 3)} kVA`
		}),
		makeAnswer('pfLoad', 'Load Power Factor', pfLoad, thetaDeg > 1e-6 ? 'lag' : thetaDeg < -1e-6 ? 'lead' : 'unity', {
			symbolLatex: '\\cos\\theta_\\phi',
			decimals: 4
		})
	);

	if (hasLine) {
		answers.push(
			makeAnswer('vSourcePhaseMag', 'Source Phase Voltage', vSourcePhaseMag, 'V', {
				symbolLatex: '\\bar{V}_{an}',
				decimals: 2,
				highlight: true,
				formatted: fmtPolar(vSourcePhaseMag, vSourcePhaseDeg, 'V', 2)
			}),
			makeAnswer('vSourceLineMag', 'Source Line Voltage', vSourceLineMag, 'V', {
				symbolLatex: 'V_{L,\\text{src}}',
				decimals: 2
			}),
			makeAnswer('sSourcePhaseVA', 'Source Apparent Power (Per Phase)', sSourcePhaseMag, 'VA', {
				symbolLatex: 'S_{an}',
				decimals: 2,
				formatted: fmtPolar(sSourcePhaseMag / 1000, sSourcePhaseDeg, 'kVA', 2)
			}),
			makeAnswer('sLinePhaseVA', 'Line Complex Loss (Per Phase)', sLinePhaseMag, 'VA', {
				symbolLatex: 'S_{\\text{line},\\phi}',
				decimals: 2,
				formatted: fmtPolar(sLinePhaseMag / 1000, sLinePhaseDeg, 'kVA', 2)
			})
		);
	}

	return {
		valid: true,
		questionType: 'QT-3PH-1',
		title: TITLE,
		answers,
		values: {
			vLineLoad,
			vPhaseLoad,
			vANMag,
			iLineMag,
			iLineDeg,
			iPhaseMag,
			iPhaseDeg,
			pPhaseW: sLoadPhase.re,
			qPhaseVar: sLoadPhase.im,
			sPhaseVA: cAbs(sLoadPhase),
			pTotalW: pTotal,
			qTotalVar: qTotal,
			sTotalVA: sTotalMag,
			pfLoad,
			thetaDeg,
			vSourcePhaseMag,
			vSourcePhaseDeg,
			vSourceLineMag,
			sSourcePhaseVA: sSourcePhaseMag,
			sSourcePhaseDeg,
			sSourcePhaseKVA: sSourcePhaseMag / 1000,
			pSourceTotalW: 3 * sSourcePhase.re,
			qSourceTotalVar: 3 * sSourcePhase.im,
			sSourceTotalVA: 3 * sSourcePhaseMag,
			sLinePhaseVA: sLinePhaseMag,
			sLinePhaseDeg,
			sLinePhaseKVA: sLinePhaseMag / 1000,
			pLineTotalW: 3 * sLinePhase.re,
			qLineTotalVar: 3 * sLinePhase.im
		},
		steps
	};
}
