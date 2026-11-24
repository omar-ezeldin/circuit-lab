import {
	J_PER_KWH,
	MU_0,
	errorResult,
	fmt,
	fmtTexSci,
	isFiniteNonNeg,
	isFinitePos,
	makeAnswer
} from './math-helpers';
import type {
	BHPoint,
	LinearMagneticInput,
	MachineAnswerItem,
	MachineSolveResult,
	MachineStep,
	NonlinearMagneticInput,
	VariableReluctanceInput
} from './types';

const TITLE_MAG1 = 'Linear Series Magnetic Circuit';
const TITLE_MAG2 = 'Nonlinear / Multi-Limb Magnetic Circuit';
const TITLE_MAG3 = 'Variable-Reluctance Actuator & Relay';

// ============================================================================
// QT-MAG-1: Linear Series Magnetic Circuit
// ============================================================================

export function solveLinearMagneticCircuit(input: LinearMagneticInput): MachineSolveResult {
	if (!isFinitePos(input.coreLengthM)) {
		return errorResult('QT-MAG-1', TITLE_MAG1, 'Core mean length l_c must be positive.');
	}
	if (!isFiniteNonNeg(input.gapLengthM)) {
		return errorResult('QT-MAG-1', TITLE_MAG1, 'Air-gap length l_g must be >= 0.');
	}
	if (!isFinitePos(input.turns)) {
		return errorResult('QT-MAG-1', TITLE_MAG1, 'Number of turns N must be positive.');
	}

	const idealCore = input.idealCore === true || input.muR === Infinity;
	if (!idealCore && (!isFinitePos(input.muR) || input.muR < 1)) {
		return errorResult('QT-MAG-1', TITLE_MAG1, 'Relative permeability mu_r must be >= 1 (or idealCore).');
	}
	if (idealCore && input.gapLengthM === 0) {
		return errorResult('QT-MAG-1', TITLE_MAG1, 'Cannot have ideal core (mu_r = inf) with zero air gap.');
	}

	const cf = (input.fringingPercent ?? 0) / 100;
	if (!Number.isFinite(cf) || cf < 0) {
		return errorResult('QT-MAG-1', TITLE_MAG1, 'Fringing percent C_f must be >= 0.');
	}

	const hasArea = isFinitePos(input.coreAreaM2);
	const steps: MachineStep[] = [];
	const answers: MachineAnswerItem[] = [];
	const values: Record<string, number> = {};

	// Case A: Core cross-sectional area A_c is NOT provided (e.g. Fall 2024 Q4a, Spring 2025 Q3b)
	if (!hasArea) {
		if (input.excitationMode === 'flux') {
			return errorResult('QT-MAG-1', TITLE_MAG1, 'Core area A_c is required when excitation is given as flux.');
		}
		const areaRatio = 1 + cf; // A_g / A_c
		// MMF per unit B_g: NI = H_c*l_c + H_g*l_g = (B_c/(mu0*mu_r))*l_c + (B_g/mu0)*l_g
		// Since B_c = (A_g/A_c) B_g = (1+cf) B_g:
		const mmfPerBg =
			(idealCore ? 0 : (areaRatio * input.coreLengthM) / (MU_0 * input.muR)) +
			input.gapLengthM / MU_0;

		let currentA: number;
		let bGap: number;
		if (input.excitationMode === 'current') {
			if (!isFinitePos(input.currentA)) {
				return errorResult('QT-MAG-1', TITLE_MAG1, 'Current I must be positive.');
			}
			currentA = input.currentA;
			bGap = (input.turns * currentA) / mmfPerBg;
		} else {
			if (!isFinitePos(input.gapFluxDensityT)) {
				return errorResult('QT-MAG-1', TITLE_MAG1, 'Gap flux density B_g must be positive.');
			}
			bGap = input.gapFluxDensityT;
			currentA = (bGap * mmfPerBg) / input.turns;
		}

		const bCore = bGap * areaRatio;
		const hGap = bGap / MU_0;
		const hCore = idealCore ? 0 : bCore / (MU_0 * input.muR);
		const magnetization = idealCore ? 0 : (input.muR - 1) * hCore;
		const energyDensityGap = (bGap * bGap) / (2 * MU_0);
		const energyDensityCore = idealCore ? 0 : (bCore * bCore) / (2 * MU_0 * input.muR);

		steps.push({
			title: "Ampère's Law (Area-Independent Formulation)",
			formulaLatex:
				'N I = H_c l_c + H_g l_g = B_g\\left(\\frac{(1+C_f)l_c}{\\mu_0 \\mu_r} + \\frac{l_g}{\\mu_0}\\right)',
			substitutionLatex: `N I = ${fmt(input.turns * currentA, 2)}\\text{ At},\\quad B_g = \\frac{${fmt(input.turns * currentA, 2)}}{${fmtTexSci(mmfPerBg)}}`,
			resultLatex: `B_g = ${fmt(bGap, 4)}\\text{ T}, \\quad H_c = ${fmt(hCore, 2)}\\text{ A/m}`
		});

		if (!idealCore) {
			steps.push({
				title: 'Core Magnetization',
				formulaLatex: 'M = (\\mu_r - 1) H_c',
				substitutionLatex: `M = (${fmt(input.muR, 0)} - 1)(${fmt(hCore, 2)})`,
				resultLatex: `M = ${fmt(magnetization, 2)}\\text{ A/m}`
			});
		}

		answers.push(
			makeAnswer('bGapT', 'Air-Gap Flux Density', bGap, 'T', {
				symbolLatex: 'B_g',
				decimals: 4,
				highlight: true,
				group: 'magnetic'
			}),
			makeAnswer('bCoreT', 'Core Flux Density', bCore, 'T', {
				symbolLatex: 'B_c',
				decimals: 4,
				group: 'magnetic'
			}),
			makeAnswer('hCore', 'Core Field Intensity', hCore, 'A/m', {
				symbolLatex: 'H_c',
				decimals: 2,
				highlight: true,
				group: 'magnetic'
			}),
			makeAnswer('hGap', 'Air-Gap Field Intensity', hGap, 'A/m', {
				symbolLatex: 'H_g',
				decimals: 2,
				group: 'magnetic'
			}),
			makeAnswer('magnetization', 'Core Magnetization', magnetization, 'A/m', {
				symbolLatex: 'M',
				decimals: 2,
				highlight: true,
				group: 'magnetic'
			}),
			makeAnswer('mmfAt', 'Magnetomotive Force', input.turns * currentA, 'At', {
				symbolLatex: '\\mathcal{F}',
				decimals: 2,
				group: 'magnetic'
			}),
			makeAnswer('currentA', 'Coil Current', currentA, 'A', {
				symbolLatex: 'I',
				decimals: 4,
				group: 'currents'
			})
		);

		Object.assign(values, {
			bGapT: bGap,
			bCoreT: bCore,
			hCore,
			hGap,
			magnetization,
			currentA,
			mmfAt: input.turns * currentA,
			energyDensityGap,
			energyDensityCore
		});

		return {
			valid: true,
			questionType: 'QT-MAG-1',
			title: TITLE_MAG1,
			answers,
			values,
			steps
		};
	}

	// Case B: Full geometry with A_c provided
	const aCore = input.coreAreaM2 as number;
	const aGap = isFinitePos(input.gapAreaM2) ? input.gapAreaM2 : aCore * (1 + cf);

	const rCore = idealCore ? 0 : input.coreLengthM / (MU_0 * input.muR * aCore);
	const rGap = input.gapLengthM > 0 ? input.gapLengthM / (MU_0 * aGap) : 0;
	const rEq = rCore + rGap;

	steps.push({
		title: 'Core & Air-Gap Reluctances',
		formulaLatex:
			'\\mathcal{R}_c = \\frac{l_c}{\\mu_0 \\mu_r A_c}, \\quad A_g = (1 + C_f) A_c, \\quad \\mathcal{R}_g = \\frac{l_g}{\\mu_0 A_g}, \\quad \\mathcal{R}_{\\text{eq}} = \\mathcal{R}_c + \\mathcal{R}_g',
		substitutionLatex: `\\mathcal{R}_c = ${fmtTexSci(rCore)}, \\quad \\mathcal{R}_g = ${fmtTexSci(rGap)}`,
		resultLatex: `\\mathcal{R}_{\\text{eq}} = ${fmtTexSci(rEq)}\\text{ At/Wb}`
	});

	let fluxWb: number;
	let currentA: number;
	if (input.excitationMode === 'flux-density') {
		if (!isFinitePos(input.gapFluxDensityT)) {
			return errorResult('QT-MAG-1', TITLE_MAG1, 'Gap flux density B_g must be positive.');
		}
		fluxWb = input.gapFluxDensityT * aGap;
		currentA = (fluxWb * rEq) / input.turns;
	} else if (input.excitationMode === 'flux') {
		if (!isFinitePos(input.fluxWb)) {
			return errorResult('QT-MAG-1', TITLE_MAG1, 'Flux must be positive.');
		}
		fluxWb = input.fluxWb;
		currentA = (fluxWb * rEq) / input.turns;
	} else {
		if (!isFinitePos(input.currentA)) {
			return errorResult('QT-MAG-1', TITLE_MAG1, 'Current I must be positive.');
		}
		currentA = input.currentA;
		fluxWb = (input.turns * currentA) / rEq;
	}

	const mmfAt = input.turns * currentA;
	const bCore = fluxWb / aCore;
	const bGap = input.gapLengthM > 0 ? fluxWb / aGap : bCore;
	const hCore = idealCore ? 0 : bCore / (MU_0 * input.muR);
	const hGap = bGap / MU_0;
	const magnetization = idealCore ? 0 : (input.muR - 1) * hCore;
	const inductanceH = (input.turns * input.turns) / rEq;
	const fluxLinkage = input.turns * fluxWb;
	const storedEnergyJ = 0.5 * inductanceH * currentA * currentA;

	steps.push({
		title: "Hopkinson's Law (MMF, Flux & Current)",
		formulaLatex: '\\mathcal{F} = N I = \\Phi \\mathcal{R}_{\\text{eq}}',
		substitutionLatex: `\\Phi = ${fmtTexSci(fluxWb)}\\text{ Wb}, \\quad \\mathcal{F} = ${fmt(mmfAt, 2)}\\text{ At}`,
		resultLatex: `I = ${fmt(currentA, 4)}\\text{ A}, \\quad B_c = ${fmt(bCore, 4)}\\text{ T}, \\quad B_g = ${fmt(bGap, 4)}\\text{ T}`
	});

	steps.push({
		title: 'Inductance & Stored Magnetic Energy',
		formulaLatex: 'L = \\frac{N^2}{\\mathcal{R}_{\\text{eq}}}, \\quad W_f = \\frac{1}{2} L I^2 = \\frac{1}{2}\\mathcal{R}_{\\text{eq}}\\Phi^2',
		substitutionLatex: `L = \\frac{${input.turns}^2}{${fmtTexSci(rEq)}}, \\quad W_f = \\frac{1}{2}(${fmt(inductanceH, 4)})(${fmt(currentA, 4)})^2`,
		resultLatex: `L = ${fmt(inductanceH, 4)}\\text{ H}, \\quad W_f = ${fmt(storedEnergyJ, 4)}\\text{ J}`
	});

	answers.push(
		makeAnswer('currentA', 'Coil Current', currentA, 'A', {
			symbolLatex: 'I',
			decimals: 4,
			highlight: true,
			group: 'currents'
		}),
		makeAnswer('inductanceH', 'Coil Inductance', inductanceH, 'H', {
			symbolLatex: 'L',
			decimals: 4,
			highlight: true,
			group: 'magnetic'
		}),
		makeAnswer('storedEnergyJ', 'Stored Magnetic Energy', storedEnergyJ, 'J', {
			symbolLatex: 'W_f',
			decimals: 4,
			highlight: true,
			group: 'magnetic'
		}),
		makeAnswer('fluxWb', 'Magnetic Flux', fluxWb, 'Wb', {
			symbolLatex: '\\Phi',
			decimals: 4,
			group: 'magnetic',
			formatted: `${fmt(fluxWb * 1000, 4)} mWb`
		}),
		makeAnswer('bCoreT', 'Core Flux Density', bCore, 'T', {
			symbolLatex: 'B_c',
			decimals: 4,
			group: 'magnetic'
		}),
		makeAnswer('bGapT', 'Air-Gap Flux Density', bGap, 'T', {
			symbolLatex: 'B_g',
			decimals: 4,
			group: 'magnetic'
		}),
		makeAnswer('mmfAt', 'Magnetomotive Force', mmfAt, 'At', {
			symbolLatex: '\\mathcal{F}',
			decimals: 2,
			group: 'magnetic'
		}),
		makeAnswer('rCore', 'Core Reluctance', rCore, 'At/Wb', {
			symbolLatex: '\\mathcal{R}_c',
			decimals: 1,
			group: 'magnetic'
		}),
		makeAnswer('rGap', 'Air-Gap Reluctance', rGap, 'At/Wb', {
			symbolLatex: '\\mathcal{R}_g',
			decimals: 1,
			group: 'magnetic'
		}),
		makeAnswer('rEq', 'Total Reluctance', rEq, 'At/Wb', {
			symbolLatex: '\\mathcal{R}_{\\text{eq}}',
			decimals: 1,
			group: 'magnetic'
		})
	);

	Object.assign(values, {
		rCore,
		rGap,
		rEq,
		mmfAt,
		currentA,
		fluxWb,
		bCoreT: bCore,
		bGapT: bGap,
		hCore,
		hGap,
		magnetization,
		inductanceH,
		fluxLinkage,
		storedEnergyJ
	});

	if (isFinitePos(input.coilResistanceOhm) && isFinitePos(input.frequencyHz)) {
		const qFactor = (2 * Math.PI * input.frequencyHz * inductanceH) / input.coilResistanceOhm;
		values.qualityFactor = qFactor;
		steps.push({
			title: 'Coil Quality Factor',
			formulaLatex: 'Q = \\frac{2\\pi f L}{R_{\\text{coil}}}',
			substitutionLatex: `Q = \\frac{2\\pi(${input.frequencyHz})(${fmt(inductanceH, 4)})}{${input.coilResistanceOhm}}`,
			resultLatex: `Q = ${fmt(qFactor, 2)}`
		});
		answers.push(
			makeAnswer('qualityFactor', 'Quality Factor', qFactor, '', {
				symbolLatex: 'Q',
				decimals: 2,
				group: 'general'
			})
		);
	}

	return {
		valid: true,
		questionType: 'QT-MAG-1',
		title: TITLE_MAG1,
		answers,
		values,
		steps
	};
}

// ============================================================================
// B-H Table Piecewise-Linear Interpolation Helpers
// ============================================================================

function sortBHTable(table: BHPoint[]): BHPoint[] {
	return [...table].sort((a, b) => a.H - b.H);
}

function interpolateHFromB(sortedTable: BHPoint[], bTarget: number): number {
	if (sortedTable.length < 2) return NaN;
	if (bTarget <= sortedTable[0].B) {
		const p0 = sortedTable[0];
		const p1 = sortedTable[1];
		if (p1.B === p0.B) return p0.H;
		// Linearly scale from origin if below first table point and p0.B > 0
		if (bTarget >= 0 && p0.B > 0 && p0.H > 0) {
			return (bTarget / p0.B) * p0.H;
		}
		return p0.H + ((bTarget - p0.B) / (p1.B - p0.B)) * (p1.H - p0.H);
	}
	for (let i = 0; i < sortedTable.length - 1; i++) {
		const p0 = sortedTable[i];
		const p1 = sortedTable[i + 1];
		if (bTarget >= p0.B && bTarget <= p1.B) {
			if (p1.B === p0.B) return p0.H;
			return p0.H + ((bTarget - p0.B) / (p1.B - p0.B)) * (p1.H - p0.H);
		}
	}
	const pn1 = sortedTable[sortedTable.length - 2];
	const pn = sortedTable[sortedTable.length - 1];
	if (pn.B === pn1.B) return pn.H;
	return pn1.H + ((bTarget - pn1.B) / (pn.B - pn1.B)) * (pn.H - pn1.H);
}

function interpolateBFromH(sortedTable: BHPoint[], hTarget: number): number {
	if (sortedTable.length < 2) return NaN;
	if (hTarget <= sortedTable[0].H) {
		const p0 = sortedTable[0];
		if (hTarget >= 0 && p0.H > 0) return (hTarget / p0.H) * p0.B;
		const p1 = sortedTable[1];
		return p0.B + ((hTarget - p0.H) / (p1.H - p0.H)) * (p1.B - p0.B);
	}
	for (let i = 0; i < sortedTable.length - 1; i++) {
		const p0 = sortedTable[i];
		const p1 = sortedTable[i + 1];
		if (hTarget >= p0.H && hTarget <= p1.H) {
			if (p1.H === p0.H) return p0.B;
			return p0.B + ((hTarget - p0.H) / (p1.H - p0.H)) * (p1.B - p0.B);
		}
	}
	const pn1 = sortedTable[sortedTable.length - 2];
	const pn = sortedTable[sortedTable.length - 1];
	return pn1.B + ((hTarget - pn1.H) / (pn.H - pn1.H)) * (pn.B - pn1.B);
}

// ============================================================================
// QT-MAG-2: Nonlinear B-H Curve & Multi-Limb Parallel Magnetic Circuits
// ============================================================================

export function solveNonlinearOrParallelMagnetic(input: NonlinearMagneticInput): MachineSolveResult {
	if (!isFinitePos(input.turns)) {
		return errorResult('QT-MAG-2', TITLE_MAG2, 'Number of turns N must be positive.');
	}

	const steps: MachineStep[] = [];
	const answers: MachineAnswerItem[] = [];

	if (input.topology === 'series-nonlinear') {
		if (!input.bhTable || input.bhTable.length < 2) {
			return errorResult('QT-MAG-2', TITLE_MAG2, 'Provide at least 2 (H, B) points in bhTable.');
		}
		if (!isFinitePos(input.coreLengthM) || !isFinitePos(input.coreAreaM2)) {
			return errorResult('QT-MAG-2', TITLE_MAG2, 'Core length l_c and area A_c must be positive.');
		}
		const lGap = input.gapLengthM ?? 0;
		if (!isFiniteNonNeg(lGap)) {
			return errorResult('QT-MAG-2', TITLE_MAG2, 'Air-gap length l_g must be >= 0.');
		}

		const cf = (input.fringingPercent ?? 0) / 100;
		const aCore = input.coreAreaM2;
		const aGap = aCore * (1 + cf);
		const sorted = sortBHTable(input.bhTable);
		const solveFor = input.solveFor ?? 'current';

		if (solveFor === 'current') {
			let fluxWb: number;
			if (isFinitePos(input.fluxWb)) {
				fluxWb = input.fluxWb;
			} else if (isFinitePos(input.fluxDensityT)) {
				fluxWb = input.fluxDensityT * aCore;
			} else {
				return errorResult('QT-MAG-2', TITLE_MAG2, 'Provide positive fluxWb or fluxDensityT.');
			}

			const bCore = fluxWb / aCore;
			const bGap = lGap > 0 ? fluxWb / aGap : bCore;
			const hCore = interpolateHFromB(sorted, bCore);
			const hGap = lGap > 0 ? bGap / MU_0 : 0;
			const mmfCore = hCore * input.coreLengthM;
			const mmfGap = hGap * lGap;
			const mmfTotal = mmfCore + mmfGap;
			const currentA = mmfTotal / input.turns;
			const muR = hCore > 0 ? bCore / (MU_0 * hCore) : 0;
			const rCore = mmfCore / fluxWb;
			const rGap = lGap > 0 ? mmfGap / fluxWb : 0;

			steps.push({
				title: 'Core & Air-Gap Flux Density',
				formulaLatex: 'B_c = \\frac{\\Phi}{A_c}, \\quad B_g = \\frac{\\Phi}{A_g}',
				substitutionLatex: `B_c = \\frac{${fmtTexSci(fluxWb)}}{${fmtTexSci(aCore)}}`,
				resultLatex: `B_c = ${fmt(bCore, 4)}\\text{ T}, \\quad B_g = ${fmt(bGap, 4)}\\text{ T}`
			});

			steps.push({
				title: 'B–H Table Lookup & Air-Gap Field Intensity',
				formulaLatex: 'H_c = f_{\\text{B-H}}^{-1}(B_c), \\quad H_g = \\frac{B_g}{\\mu_0}',
				resultLatex: `H_c = ${fmt(hCore, 2)}\\text{ At/m}, \\quad H_g = ${fmtTexSci(hGap)}\\text{ At/m}`
			});

			steps.push({
				title: 'Total MMF & Required Current',
				formulaLatex: '\\mathcal{F} = N I = H_c l_c + H_g l_g \\implies I = \\frac{H_c l_c + H_g l_g}{N}',
				substitutionLatex: `I = \\frac{(${fmt(hCore, 2)})(${input.coreLengthM}) + (${fmtTexSci(hGap)})(${lGap})}{${input.turns}}`,
				resultLatex: `I = ${fmt(currentA, 4)}\\text{ A}`
			});

			answers.push(
				makeAnswer('currentA', 'Required Current', currentA, 'A', {
					symbolLatex: 'I',
					decimals: 4,
					highlight: true,
					group: 'currents'
				}),
				makeAnswer('mmfTotal', 'Total MMF', mmfTotal, 'At', {
					symbolLatex: '\\mathcal{F}',
					decimals: 2,
					group: 'magnetic'
				}),
				makeAnswer('bCoreT', 'Core Flux Density', bCore, 'T', {
					symbolLatex: 'B_c',
					decimals: 4,
					group: 'magnetic'
				}),
				makeAnswer('hCore', 'Core Field Intensity', hCore, 'At/m', {
					symbolLatex: 'H_c',
					decimals: 2,
					group: 'magnetic'
				}),
				makeAnswer('hGap', 'Air-Gap Field Intensity', hGap, 'At/m', {
					symbolLatex: 'H_g',
					decimals: 2,
					group: 'magnetic'
				}),
				makeAnswer('muR', 'Operating Relative Permeability', muR, '', {
					symbolLatex: '\\mu_r',
					decimals: 1,
					group: 'magnetic'
				}),
				makeAnswer('rCore', 'Core Reluctance', rCore, 'At/Wb', {
					symbolLatex: '\\mathcal{R}_c',
					decimals: 1,
					group: 'magnetic'
				})
			);

			return {
				valid: true,
				questionType: 'QT-MAG-2',
				title: TITLE_MAG2,
				answers,
				values: {
					fluxWb,
					bCoreT: bCore,
					bGapT: bGap,
					hCore,
					hGap,
					mmfCore,
					mmfGap,
					mmfTotal,
					currentA,
					muR,
					rCore,
					rGap
				},
				steps
			};
		} else {
			// Solve for flux given currentA using load-line intersection
			if (!isFinitePos(input.currentA)) {
				return errorResult('QT-MAG-2', TITLE_MAG2, 'Current I must be positive.');
			}
			const ni = input.turns * input.currentA;
			let hCore: number;
			let bCore: number;

			const lCore = input.coreLengthM;
			if (lGap === 0) {
				hCore = ni / lCore;
				bCore = interpolateBFromH(sorted, hCore);
			} else {
				// Load line: B_load(H) = (mu0 * A_g / (A_c * l_g)) * (NI - H * l_c)
				const kLoad = (MU_0 * aGap) / (aCore * lGap);
				const f = (h: number) => interpolateBFromH(sorted, h) - kLoad * (ni - h * lCore);
				let lo = 0;
				let hi = ni / lCore;
				for (let iter = 0; iter < 80; iter++) {
					const mid = 0.5 * (lo + hi);
					if (f(mid) < 0) lo = mid;
					else hi = mid;
				}
				hCore = 0.5 * (lo + hi);
				bCore = interpolateBFromH(sorted, hCore);
			}

			const fluxWb = bCore * aCore;
			const bGap = fluxWb / aGap;
			const hGap = lGap > 0 ? bGap / MU_0 : 0;
			const muR = hCore > 0 ? bCore / (MU_0 * hCore) : 0;

			steps.push({
				title: 'Load-Line Intersection on B–H Curve',
				formulaLatex:
					lGap > 0
						? 'B_c = \\frac{\\mu_0 A_g}{A_c l_g}(N I - H_c l_c) \\cap B_{\\text{core}}(H_c)'
						: 'H_c = \\frac{N I}{l_c}, \\quad B_c = B_{\\text{core}}(H_c)',
				resultLatex: `H_c = ${fmt(hCore, 2)}\\text{ At/m}, \\quad B_c = ${fmt(bCore, 4)}\\text{ T}`
			});

			steps.push({
				title: 'Resulting Magnetic Flux',
				formulaLatex: '\\Phi = B_c A_c',
				resultLatex: `\\Phi = ${fmt(fluxWb * 1000, 4)}\\text{ mWb}`
			});

			answers.push(
				makeAnswer('fluxWb', 'Magnetic Flux', fluxWb, 'Wb', {
					symbolLatex: '\\Phi',
					decimals: 4,
					highlight: true,
					group: 'magnetic',
					formatted: `${fmt(fluxWb * 1000, 4)} mWb`
				}),
				makeAnswer('bCoreT', 'Core Flux Density', bCore, 'T', {
					symbolLatex: 'B_c',
					decimals: 4,
					group: 'magnetic'
				}),
				makeAnswer('hCore', 'Core Field Intensity', hCore, 'At/m', {
					symbolLatex: 'H_c',
					decimals: 2,
					group: 'magnetic'
				}),
				makeAnswer('muR', 'Operating Relative Permeability', muR, '', {
					symbolLatex: '\\mu_r',
					decimals: 1,
					group: 'magnetic'
				})
			);

			return {
				valid: true,
				questionType: 'QT-MAG-2',
				title: TITLE_MAG2,
				answers,
				values: { fluxWb, bCoreT: bCore, bGapT: bGap, hCore, hGap, muR, currentA: input.currentA },
				steps
			};
		}
	}

	// Parallel 3-limb magnetic circuit (Sheet 2 Q12 pattern)
	if (
		!isFinitePos(input.leftLengthM) ||
		!isFinitePos(input.leftAreaM2) ||
		!isFinitePos(input.centerLengthM) ||
		!isFinitePos(input.centerAreaM2) ||
		!isFinitePos(input.rightLengthM) ||
		!isFinitePos(input.rightAreaM2)
	) {
		return errorResult(
			'QT-MAG-2',
			TITLE_MAG2,
			'All three limb lengths and areas must be positive for parallel-3limb topology.'
		);
	}

	const useBH = Array.isArray(input.bhTable) && input.bhTable.length >= 2;
	if (!useBH && !isFinitePos(input.muR)) {
		return errorResult('QT-MAG-2', TITLE_MAG2, 'Provide either bhTable or positive constant muR.');
	}

	const sorted = useBH ? sortBHTable(input.bhTable as BHPoint[]) : [];
	const muRConst = input.muR ?? 1;
	const gCenter = input.centerGapLengthM ?? 0;
	const gRight = input.rightGapLengthM ?? 0;

	const hFromB = (b: number) => (useBH ? interpolateHFromB(sorted, b) : b / (MU_0 * muRConst));
	const bFromH = (h: number) => (useBH ? interpolateBFromH(sorted, h) : MU_0 * muRConst * h);

	if (!isFinitePos(input.rightFluxWb)) {
		return errorResult('QT-MAG-2', TITLE_MAG2, 'Provide positive rightFluxWb for parallel-3limb analysis.');
	}

	const phiRight = input.rightFluxWb;
	const bRight = phiRight / input.rightAreaM2;
	const hRight = hFromB(bRight);
	const fCenter = hRight * input.rightLengthM + (gRight > 0 ? (bRight / MU_0) * gRight : 0);

	// Center limb flux from MMF fCenter
	let bCenter: number;
	let hCenter: number;
	if (gCenter === 0) {
		hCenter = fCenter / input.centerLengthM;
		bCenter = bFromH(hCenter);
	} else {
		// Solve hFromB(B)*l_c + (B/mu0)*g_c = fCenter via bisection
		let lo = 0;
		let hi = (fCenter * MU_0) / gCenter;
		for (let i = 0; i < 80; i++) {
			const mid = 0.5 * (lo + hi);
			const lhs = hFromB(mid) * input.centerLengthM + (mid / MU_0) * gCenter;
			if (lhs < fCenter) lo = mid;
			else hi = mid;
		}
		bCenter = 0.5 * (lo + hi);
		hCenter = hFromB(bCenter);
	}

	const phiCenter = bCenter * input.centerAreaM2;
	const phiTotal = phiCenter + phiRight;
	const bLeft = phiTotal / input.leftAreaM2;
	const hLeft = hFromB(bLeft);
	const mmfTotal = hLeft * input.leftLengthM + fCenter;
	const currentA = mmfTotal / input.turns;

	steps.push({
		title: 'Right Limb & Center Window MMF',
		formulaLatex: 'B_r = \\frac{\\Phi_r}{A_r}, \\quad \\mathcal{F}_{\\text{center}} = H_r l_r + H_{gr} l_{gr}',
		resultLatex: `B_r = ${fmt(bRight, 4)}\\text{ T}, \\quad \\mathcal{F}_{\\text{center}} = ${fmt(fCenter, 2)}\\text{ At}`
	});

	steps.push({
		title: 'Center Limb Flux & Total Flux (Magnetic KCL)',
		formulaLatex: '\\Phi_c = B_c A_c, \\quad \\Phi_T = \\Phi_c + \\Phi_r',
		resultLatex: `\\Phi_c = ${fmt(phiCenter * 1000, 4)}\\text{ mWb}, \\quad \\Phi_T = ${fmt(phiTotal * 1000, 4)}\\text{ mWb}`
	});

	steps.push({
		title: 'Left Limb MMF & Required Coil Current',
		formulaLatex: 'N I = H_l l_l + \\mathcal{F}_{\\text{center}} \\implies I = \\frac{N I}{N}',
		resultLatex: `N I = ${fmt(mmfTotal, 2)}\\text{ At}, \\quad I = ${fmt(currentA, 4)}\\text{ A}`
	});

	answers.push(
		makeAnswer('currentA', 'Required Coil Current', currentA, 'A', {
			symbolLatex: 'I',
			decimals: 4,
			highlight: true,
			group: 'currents'
		}),
		makeAnswer('phiTotalWb', 'Total Flux (Excited Limb)', phiTotal, 'Wb', {
			symbolLatex: '\\Phi_T',
			decimals: 4,
			highlight: true,
			group: 'magnetic',
			formatted: `${fmt(phiTotal * 1000, 4)} mWb`
		}),
		makeAnswer('phiCenterWb', 'Center Limb Flux', phiCenter, 'Wb', {
			symbolLatex: '\\Phi_c',
			decimals: 4,
			group: 'magnetic',
			formatted: `${fmt(phiCenter * 1000, 4)} mWb`
		}),
		makeAnswer('mmfTotal', 'Required MMF', mmfTotal, 'At', {
			symbolLatex: '\\mathcal{F}',
			decimals: 2,
			group: 'magnetic'
		})
	);

	return {
		valid: true,
		questionType: 'QT-MAG-2',
		title: TITLE_MAG2,
		answers,
		values: {
			phiRightWb: phiRight,
			phiCenterWb: phiCenter,
			phiTotalWb: phiTotal,
			bRightT: bRight,
			bCenterT: bCenter,
			bLeftT: bLeft,
			fCenter,
			mmfTotal,
			currentA
		},
		steps
	};
}

// ============================================================================
// QT-MAG-3: Variable-Reluctance Relay / Movable-Core Actuator
// ============================================================================

export function solveVariableReluctanceActuator(input: VariableReluctanceInput): MachineSolveResult {
	if (!isFinitePos(input.coreAreaM2) || !isFinitePos(input.turns)) {
		return errorResult('QT-MAG-3', TITLE_MAG3, 'Core area A_c and turns N must be positive.');
	}
	if (!isFinitePos(input.numGaps) || !Number.isInteger(input.numGaps)) {
		return errorResult('QT-MAG-3', TITLE_MAG3, 'Number of series air gaps n_g must be a positive integer.');
	}
	if (!isFiniteNonNeg(input.initialGapM) || !isFiniteNonNeg(input.finalGapM)) {
		return errorResult('QT-MAG-3', TITLE_MAG3, 'Initial and final air-gap lengths must be >= 0.');
	}

	const idealCore = input.idealCore === true || input.muR === Infinity;
	if (!idealCore && (!isFinitePos(input.coreLengthM) || !isFinitePos(input.muR))) {
		return errorResult('QT-MAG-3', TITLE_MAG3, 'Finite core requires positive coreLengthM and muR.');
	}

	const rCore = idealCore ? 0 : input.coreLengthM / (MU_0 * input.muR * input.coreAreaM2);
	const dRdg = input.numGaps / (MU_0 * input.coreAreaM2);
	const rGap1 = dRdg * input.initialGapM;
	const rEq1 = rCore + rGap1;
	const rGap2 = dRdg * input.finalGapM;
	const rEq2 = rCore + rGap2;

	if (rEq1 <= 0) {
		return errorResult('QT-MAG-3', TITLE_MAG3, 'Initial total reluctance must be positive.');
	}

	const l1 = (input.turns * input.turns) / rEq1;
	const l2 = rEq2 > 0 ? (input.turns * input.turns) / rEq2 : Infinity;

	let phi1: number;
	let i1: number;
	if (isFinitePos(input.initialFluxDensityT)) {
		phi1 = input.initialFluxDensityT * input.coreAreaM2;
		i1 = (phi1 * rEq1) / input.turns;
	} else if (isFinitePos(input.initialFluxWb)) {
		phi1 = input.initialFluxWb;
		i1 = (phi1 * rEq1) / input.turns;
	} else if (isFinitePos(input.initialCurrentA)) {
		i1 = input.initialCurrentA;
		phi1 = (input.turns * i1) / rEq1;
	} else {
		return errorResult(
			'QT-MAG-3',
			TITLE_MAG3,
			'Provide initialFluxDensityT, initialFluxWb, or initialCurrentA.'
		);
	}

	const lambda1 = input.turns * phi1;
	const wf1 = 0.5 * rEq1 * phi1 * phi1;
	const force1N = -0.5 * phi1 * phi1 * dRdg; // negative = pulls to close gap

	let phi2: number;
	let i2: number;
	let lambda2: number;
	let wf2: number;
	let wmJ: number;
	let force2N: number;

	if (input.constraint === 'constant-current') {
		if (rEq2 <= 0) {
			return errorResult(
				'QT-MAG-3',
				TITLE_MAG3,
				'Constant-current closure with zero final reluctance (ideal core, g2=0) yields infinite flux.'
			);
		}
		i2 = i1;
		phi2 = (input.turns * i2) / rEq2;
		lambda2 = input.turns * phi2;
		wf2 = 0.5 * l2 * i2 * i2;
		wmJ = wf2 - wf1; // Quasi-static (slow): W_m = Delta W_f' = W_f2 - W_f1
		force2N = -0.5 * phi2 * phi2 * dRdg;
	} else {
		// Constant flux / flux linkage (very fast movement)
		phi2 = phi1;
		lambda2 = lambda1;
		i2 = (phi2 * rEq2) / input.turns;
		wf2 = 0.5 * rEq2 * phi2 * phi2;
		wmJ = wf1 - wf2; // Fast: W_m = -Delta W_f = W_f1 - W_f2
		force2N = -0.5 * phi2 * phi2 * dRdg;
	}

	const wmKwh = wmJ / J_PER_KWH;

	const steps: MachineStep[] = [
		{
			title: 'Reluctances & Inductances at Initial & Final Positions',
			formulaLatex:
				'\\mathcal{R}_{\\text{eq}}(g) = \\mathcal{R}_c + \\frac{n_g g}{\\mu_0 A_c}, \\quad L(g) = \\frac{N^2}{\\mathcal{R}_{\\text{eq}}(g)}',
			substitutionLatex: `\\mathcal{R}_c = ${fmtTexSci(rCore)}, \\quad \\mathcal{R}_{g1} = ${fmtTexSci(rGap1)}, \\quad \\mathcal{R}_{\\text{eq},1} = ${fmtTexSci(rEq1)}`,
			resultLatex: `L_1 = ${fmt(l1 * 1000, 3)}\\text{ mH}, \\quad L_2 = ${Number.isFinite(l2) ? `${fmt(l2 * 1000, 3)}\\text{ mH}` : '\\infty'}`
		},
		{
			title: 'Initial Operating Point & Magnetic Force',
			formulaLatex:
				'I_1 = \\frac{\\Phi_1 \\mathcal{R}_{\\text{eq},1}}{N}, \\quad \\lambda_1 = N\\Phi_1, \\quad W_{f1} = \\frac{1}{2}\\mathcal{R}_{\\text{eq},1}\\Phi_1^2, \\quad F_{\\text{fld}} = -\\frac{1}{2}\\Phi^2\\frac{d\\mathcal{R}_{\\text{eq}}}{dg}',
			resultLatex: `I_1 = ${fmt(i1, 3)}\\text{ A}, \\; \\lambda_1 = ${fmt(lambda1, 4)}\\text{ Wb-t}, \\; W_{f1} = ${fmt(wf1, 3)}\\text{ J}, \\; |F_1| = ${fmt(Math.abs(force1N), 2)}\\text{ N}`
		},
		{
			title:
				input.constraint === 'constant-current'
					? 'Final Position & Mechanical Work (Slow / Constant Current)'
					: 'Final Position & Mechanical Work (Fast / Constant Flux)',
			formulaLatex:
				input.constraint === 'constant-current'
					? '\\lambda_2 = L_2 I_1, \\quad W_{f2} = \\frac{1}{2} L_2 I_1^2, \\quad W_m = \\Delta W_f\' = W_{f2} - W_{f1}'
					: 'I_2 = \\frac{\\Phi_1 \\mathcal{R}_{\\text{eq},2}}{N}, \\quad W_{f2} = \\frac{1}{2}\\mathcal{R}_{\\text{eq},2}\\Phi_1^2, \\quad W_m = -\\Delta W_f = W_{f1} - W_{f2}',
			resultLatex: `W_{f2} = ${fmt(wf2, 3)}\\text{ J}, \\quad W_m = ${fmt(wmJ, 3)}\\text{ J} = ${fmtTexSci(wmKwh)}\\text{ kWh}`
		}
	];

	const answers: MachineAnswerItem[] = [
		makeAnswer('i1A', 'Initial Current', i1, 'A', {
			symbolLatex: 'I_1',
			decimals: 3,
			highlight: true,
			group: 'currents'
		}),
		makeAnswer('i2A', 'Final Current', i2, 'A', {
			symbolLatex: 'I_2',
			decimals: 3,
			group: 'currents'
		}),
		makeAnswer('rEq1', 'Initial Total Reluctance', rEq1, 'At/Wb', {
			symbolLatex: '\\mathcal{R}_{\\text{eq},1}',
			decimals: 1,
			group: 'magnetic'
		}),
		makeAnswer('l1H', 'Initial Inductance', l1, 'H', {
			symbolLatex: 'L_1',
			decimals: 4,
			group: 'magnetic',
			formatted: `${fmt(l1 * 1000, 3)} mH`
		}),
		makeAnswer('wf1J', 'Initial Stored Energy', wf1, 'J', {
			symbolLatex: 'W_{f1}',
			decimals: 3,
			group: 'magnetic'
		}),
		makeAnswer('wf2J', 'Final Stored Energy', wf2, 'J', {
			symbolLatex: 'W_{f2}',
			decimals: 3,
			group: 'magnetic'
		}),
		makeAnswer('force1N', 'Initial Closing Force', Math.abs(force1N), 'N', {
			symbolLatex: '|F_{\\text{fld},1}|',
			decimals: 2,
			group: 'mechanical'
		}),
		makeAnswer('wmJ', 'Mechanical Work Done', wmJ, 'J', {
			symbolLatex: 'W_m',
			decimals: 3,
			highlight: true,
			group: 'mechanical'
		}),
		makeAnswer('wmKwh', 'Mechanical Work (kWh)', wmKwh, 'kWh', {
			symbolLatex: 'W_{m,\\text{kWh}}',
			decimals: 4,
			highlight: true,
			group: 'mechanical'
		})
	];

	const values: Record<string, number> = {
		rCore,
		rGap1,
		rEq1,
		rGap2,
		rEq2,
		l1H: l1,
		l1mH: l1 * 1000,
		i1A: i1,
		phi1Wb: phi1,
		lambda1,
		wf1J: wf1,
		force1N,
		force1MagN: Math.abs(force1N),
		i2A: i2,
		phi2Wb: phi2,
		lambda2,
		wf2J: wf2,
		force2N,
		force2MagN: Math.abs(force2N),
		wmJ,
		wmKwh
	};
	if (Number.isFinite(l2)) {
		values.l2H = l2;
		values.l2mH = l2 * 1000;
	}

	return {
		valid: true,
		questionType: 'QT-MAG-3',
		title: TITLE_MAG3,
		answers,
		values,
		steps
	};
}
