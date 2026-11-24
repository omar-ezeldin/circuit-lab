import type {
	MachineCategory,
	MachineCategoryMeta,
	MachineQuestionTypeId,
	MachineQuestionTypeMeta
} from './types';

export const MACHINE_CATEGORIES: MachineCategoryMeta[] = [
	{
		id: 'three-phase',
		title: 'Balanced Three-Phase Circuits',
		shortTitle: '3-Phase',
		chapterLabel: 'Lecture 1',
		description: 'Star (Y) and Delta (Δ) line-phase relations, line impedance drops, and three-phase complex power.',
		questionTypes: ['QT-3PH-1']
	},
	{
		id: 'magnetic',
		title: 'Electromagnetic & Magnetic Circuits',
		shortTitle: 'Magnetic',
		chapterLabel: 'Lecture 2&3',
		description: 'Series & parallel ferromagnetic cores, air gaps, fringing, B–H curves, inductance, energy, and relay actuators.',
		questionTypes: ['QT-MAG-1', 'QT-MAG-2', 'QT-MAG-3']
	},
	{
		id: 'transformer',
		title: 'Single-Phase Transformers',
		shortTitle: 'Transformer',
		chapterLabel: 'Lecture 4',
		description: 'EMF equation, core loss separation/scaling, OC & SC tests, voltage regulation, and maximum efficiency.',
		questionTypes: ['QT-XFMR-1', 'QT-XFMR-2', 'QT-XFMR-3', 'QT-XFMR-4']
	},
	{
		id: 'dc-machines',
		title: 'DC Machines (Generators & Motors)',
		shortTitle: 'DC Machines',
		chapterLabel: 'Lecture 5',
		description: 'Lap/wave winding EMF & torque constants, separately excited & shunt generators, and DC motor speed control.',
		questionTypes: ['QT-DC-1', 'QT-DC-2', 'QT-DC-3']
	},
	{
		id: 'induction-motor',
		title: 'Three-Phase Induction Motors',
		shortTitle: 'Induction Motor',
		chapterLabel: 'Lecture 6',
		description: 'Synchronous speed, slip, forward & backward power flow stages, and exact T / approximate cantilever equivalent circuits.',
		questionTypes: ['QT-IM-1', 'QT-IM-2', 'QT-IM-3']
	}
];

export const MACHINE_QUESTION_TYPES: {
	[K in MachineQuestionTypeId]: MachineQuestionTypeMeta<K>;
} = {
	'QT-3PH-1': {
		id: 'QT-3PH-1',
		category: 'three-phase',
		title: 'Balanced Y/Δ Load, Line Impedance & Complex Power',
		shortLabel: 'Balanced 3-Phase',
		description:
			'Solve balanced Y or Δ loads from per-phase impedance or active/apparent power and power factor, with optional line impedance drop.',
		keyFormulasLatex: [
			'V_L = \\sqrt{3}\\,V_\\phi\\;(\\text{Y}), \\quad I_L = \\sqrt{3}\\,I_\\phi\\;(\\Delta), \\quad Z_Y = Z_\\Delta / 3',
			'P_{\\text{tot}} = \\sqrt{3}\\,V_L I_L \\cos\\theta_\\phi, \\quad \\bar{V}_{an} = \\bar{V}_{AN} + \\bar{I}_{aA} Z_{\\text{line}}'
		],
		presets: [
			{
				id: 'ST-01',
				label: 'Y-Load with Line Impedance (600 V, 160 kW/ph)',
				source: 'Lecture 1 Slides 18–19',
				description: 'Balanced Y load at V_AN = 600/√3 V, 160 kW/phase at 0.8 lag, line Z = 0.005 + j0.025 Ω.',
				input: {
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
				}
			}
		]
	},

	'QT-MAG-1': {
		id: 'QT-MAG-1',
		category: 'magnetic',
		title: 'Linear Series Magnetic Circuit (Core + Air Gap)',
		shortLabel: 'Linear Core + Gap',
		description:
			'Compute reluctance, MMF, flux/current, inductance L, stored energy W_f, magnetization M, and coil Q-factor with optional fringing.',
		keyFormulasLatex: [
			'\\mathcal{R}_c = \\frac{l_c}{\\mu_0 \\mu_r A_c}, \\quad \\mathcal{R}_g = \\frac{l_g}{\\mu_0 (1+C_f) A_c}, \\quad N I = \\Phi\\mathcal{R}_{\\text{eq}}',
			'L = \\frac{N^2}{\\mathcal{R}_{\\text{eq}}}, \\quad W_f = \\frac{1}{2} L I^2, \\quad M = (\\mu_r - 1)H_c'
		],
		presets: [
			{
				id: 'ST-02',
				label: 'Series Core with 5% Fringing (B_g = 0.5 T)',
				source: 'Summer 2023 Final Q4d / Lecture 2&3 Ex. 1',
				description: 'l_c = 40 cm, A_c = 12 cm², μ_r = 4000, l_g = 0.05 cm, N = 400, B_g = 0.5 T, C_f = 5%.',
				input: {
					coreLengthM: 0.4,
					coreAreaM2: 12e-4,
					muR: 4000,
					gapLengthM: 0.0005,
					fringingPercent: 5,
					turns: 400,
					excitationMode: 'flux-density',
					gapFluxDensityT: 0.5
				}
			},
			{
				id: 'ST-03',
				label: 'Iron Ring with Air Gap (Find B_g, H_c, M)',
				source: 'Fall 2024 Final Q4a / Spring 2025 Final Q3b',
				description: 'l_c = 50 cm, l_g = 0.1 cm, N = 300, μ_r = 400, I = 1 A (area-independent).',
				input: {
					coreLengthM: 0.5,
					muR: 400,
					gapLengthM: 0.001,
					turns: 300,
					excitationMode: 'current',
					currentA: 1
				}
			}
		]
	},

	'QT-MAG-2': {
		id: 'QT-MAG-2',
		category: 'magnetic',
		title: 'Nonlinear B–H Curve & Parallel 3-Limb Core',
		shortLabel: 'Nonlinear / 3-Limb',
		description:
			'Interpolate core field intensity H_c from a B–H magnetization table or solve a 3-limb parallel magnetic circuit using magnetic KCL/KVL.',
		keyFormulasLatex: [
			'N I = H_c(B_c)\\,l_c + \\frac{B_g}{\\mu_0} l_g, \\quad \\Phi_T = \\Phi_{\\text{center}} + \\Phi_{\\text{right}}'
		],
		presets: [
			{
				id: 'ST-05',
				label: 'Nonlinear Ferromagnetic Core with 1 mm Gap',
				source: 'Lecture 2&3 Example 3c',
				description: 'l_c = 30 cm, A_c = π cm², l_g = 1 mm, N = 600, Φ = 0.5 mWb with nonlinear B–H table.',
				input: {
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
				}
			}
		]
	},

	'QT-MAG-3': {
		id: 'QT-MAG-3',
		category: 'magnetic',
		title: 'Variable-Reluctance Relay / Movable-Core Actuator',
		shortLabel: 'Relay / Actuator',
		description:
			'Evaluate reluctance R(x), inductance L(x), magnetic closing force F_fld, and mechanical work W_m for slow (constant I) or fast (constant Φ) closure.',
		keyFormulasLatex: [
			'\\mathcal{R}_{\\text{eq}}(g) = \\mathcal{R}_c + \\frac{n_g g}{\\mu_0 A_c}, \\quad F_{\\text{fld}} = -\\frac{1}{2}\\Phi^2\\frac{d\\mathcal{R}_{\\text{eq}}}{dg}',
			'W_{m,\\text{slow}} = W_{f2} - W_{f1}\\;(I=\\text{const}), \\quad W_{m,\\text{fast}} = W_{f1} - W_{f2}\\;(\\Phi=\\text{const})'
		],
		presets: [
			{
				id: 'ST-06',
				label: '2-Gap Relay Slow Closure (Constant I)',
				source: 'Spring 2026 Final Q3b',
				description: 'l_c = 50 cm, μ_r = 400, A_c = 0.003 m², N = 300, two 4 mm gaps closing slowly from B_g = 1.1 T.',
				input: {
					coreLengthM: 0.5,
					coreAreaM2: 0.003,
					muR: 400,
					turns: 300,
					numGaps: 2,
					initialGapM: 0.004,
					finalGapM: 0,
					constraint: 'constant-current',
					initialFluxDensityT: 1.1
				}
			},
			{
				id: 'ST-07',
				label: 'Ideal Core Single-Gap Fast Closure (Constant Φ)',
				source: 'Summer 2024 Final Q4b',
				description: 'A = 15 cm², μ_r = ∞, N = 100, Φ = 0.1 Wb, gap closing from 4 cm to 0.',
				input: {
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
				}
			}
		]
	},

	'QT-XFMR-1': {
		id: 'QT-XFMR-1',
		category: 'transformer',
		title: 'Transformer EMF Equation & Core Loss Separation / Scaling',
		shortLabel: 'EMF & Core Loss',
		description:
			'Compute RMS induced EMF E = 4.44 f N Φ_m, separate hysteresis & eddy-current losses at constant B_m, or scale core losses with (V, f).',
		keyFormulasLatex: [
			'E = 4.44 f N \\Phi_m, \\quad \\frac{P_c}{f} = A + B f',
			'P_{h2} = P_{h1}\\left(\\frac{V_2}{V_1}\\right)^n\\left(\\frac{f_1}{f_2}\\right)^{n-1}, \\quad P_{e2} = P_{e1}\\left(\\frac{V_2}{V_1}\\right)^2'
		],
		presets: [
			{
				id: 'ST-08',
				label: 'Core Loss Separation (40 Hz & 60 Hz → 50 Hz)',
				source: 'Spring 2026 Final Q4b / Summer 2023 Q3c',
				description: 'P_c = 52 W at 40 Hz and 90 W at 60 Hz (constant B_m); find P_h, P_e at 50 Hz.',
				input: {
					mode: 'loss-separation',
					f1Hz: 40,
					pc1W: 52,
					f2Hz: 60,
					pc2W: 90,
					targetFreqHz: 50
				}
			},
			{
				id: 'ST-09',
				label: 'Core Loss Scaling (220 V 60 Hz → 230 V 50 Hz)',
				source: 'Fall 2023 Final Q3b / Spring 2025 Q4.6',
				description: 'P_h1 = 340 W, P_e1 = 120 W at 220 V, 60 Hz (n = 1.6); evaluate at 230 V, 50 Hz.',
				input: {
					mode: 'vf-scaling',
					v1V: 220,
					f1Hz: 60,
					ph1W: 340,
					pe1W: 120,
					v2V: 230,
					f2Hz: 50,
					steinmetzN: 1.6
				}
			}
		]
	},

	'QT-XFMR-2': {
		id: 'QT-XFMR-2',
		category: 'transformer',
		title: 'Open-Circuit & Short-Circuit Tests → Equivalent Circuit',
		shortLabel: 'OC & SC Tests',
		description:
			'Extract R_c, X_m from OC test and R_eq, X_eq from SC test, automatically referring parameters to primary or secondary for step-down or step-up units.',
		keyFormulasLatex: [
			'R_c = \\frac{V_0^2}{W_0}, \\quad X_m = \\frac{V_0}{\\sqrt{I_0^2 - (W_0/V_0)^2}}, \\quad R_{\\text{eq}} = \\frac{W_{sc}}{I_{sc}^2}, \\quad X_{\\text{eq}} = \\sqrt{(V_{sc}/I_{sc})^2 - R_{\\text{eq}}^2}'
		],
		presets: [
			{
				id: 'ST-10',
				label: '20 kVA 2000/200 V OC/SC Tests (Step-Down)',
				source: 'Spring 2024 Final Q3a',
				description: 'OC (LV): 200 V, 4 A, 120 W; SC (HV): 60 V, 10 A, 300 W; evaluate FL at 0.8 lag.',
				input: {
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
				}
			},
			{
				id: 'ST-11',
				label: '4 kVA 200/400 V OC/SC Tests (Step-Up)',
				source: 'Fall 2024 Final Q3c',
				description: 'OC (LV=primary): 200 V, 0.8 A, 70 W; SC (HV=secondary): 20 V, 10 A, 60 W; FL 0.8 lag.',
				input: {
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
				}
			}
		]
	},

	'QT-XFMR-3': {
		id: 'QT-XFMR-3',
		category: 'transformer',
		title: 'Transformer On-Load Performance (VR, Efficiency, Max η)',
		shortLabel: 'On-Load Performance',
		description:
			'Analyze the approximate cantilever equivalent circuit for lagging, unity, or leading power factors: exact & approximate %VR, I_1, η, and S_maxη.',
		keyFormulasLatex: [
			'\\bar{V}_1 = \\bar{V}_2\' + \\bar{I}_2\'(R_{e1} + jX_{e1}), \\quad \\%VR = \\frac{|\\bar{V}_1| - |\\bar{V}_2\'|}{|\\bar{V}_2\'|}\\times 100\\%',
			'\\eta = \\frac{P_{\\text{out}}}{P_{\\text{out}} + P_i + x^2 P_{cu,\\text{FL}}}\\times 100\\%, \\quad S_{\\max\\eta} = S_{\\text{rated}}\\sqrt{\\frac{P_i}{P_{cu,\\text{FL}}}}'
		],
		presets: [
			{
				id: 'ST-12',
				label: '2.2 kVA 440/220 V at FL, 0.707 Lag',
				source: 'Spring 2026 Final Q4a / Summer 2024 Q3c',
				description: 'R_e1 = 3 Ω, X_e1 = 4 Ω, R_c1 = 2.5 kΩ, X_m1 = 2 kΩ at full load 0.707 lagging.',
				input: {
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
				}
			},
			{
				id: 'ST-13',
				label: '10 kVA 2000/200 V at 8 kW, 0.8 Lag',
				source: 'Fall 2025 Final Q3b / Summer 2025 Q3b',
				description: 'P_i = 125 W at 0.15 lag, Z_e,HV = 2 + j4 Ω; evaluate max η and VR at 8 kW, 0.8 lag.',
				input: {
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
				}
			}
		]
	},

	'QT-XFMR-4': {
		id: 'QT-XFMR-4',
		category: 'transformer',
		title: 'Efficiency vs. Load Fraction & Two-Point Loss Separation',
		shortLabel: 'Efficiency & Losses',
		description:
			'Compute efficiency at any load fraction x and PF from known losses, or separate P_i and P_cu,FL from two known (x, PF, η) operating points.',
		keyFormulasLatex: [
			'P_i + x_k^2 P_{cu,\\text{FL}} = x_k S_{\\text{rated}}\\cos\\phi_k\\left(\\frac{1}{\\eta_k} - 1\\right), \\quad x_{\\max\\eta} = \\sqrt{\\frac{P_i}{P_{cu,\\text{FL}}}}'
		],
		presets: [
			{
				id: 'ST-14',
				label: '500 kVA Loss Separation (95% at FL & 60% FL)',
				source: 'Sheet 3 Q11',
				description: '500 kVA unit has η = 95% at 100% and 60% FL (UPF); find P_i, P_cu,FL, and η at 75% FL.',
				input: {
					mode: 'two-point-separation',
					ratedVA: 500_000,
					point1: { loadFraction: 1, pf: 1, efficiencyPercent: 95 },
					point2: { loadFraction: 0.6, pf: 1, efficiencyPercent: 95 },
					targetLoadFraction: 0.75,
					targetPf: 1
				}
			},
			{
				id: 'ST-15',
				label: '30 kVA Known Losses (P_i = 360 W, P_cu,FL = 480 W)',
				source: 'Summer 2024 Q3b / Fall 2023 Q3a / Sheet 3 Q9',
				description: 'Find half-load efficiency, full-load efficiency, and kVA for maximum efficiency.',
				input: {
					mode: 'known-losses',
					ratedVA: 30_000,
					pCoreW: 360,
					pCuFlW: 480,
					loadFraction: 0.5,
					pf: 1,
					maxEffPf: 1
				}
			}
		]
	},

	'QT-DC-1': {
		id: 'QT-DC-1',
		category: 'dc-machines',
		title: 'DC Machine EMF, Winding Constant & Torque Scaling',
		shortLabel: 'DC EMF & Torque',
		description:
			'Compute generated EMF from lap/wave winding geometry or extract K_e = K_t from a terminal operating point and scale torque at constant flux.',
		keyFormulasLatex: [
			'E_a = \\frac{P Z_a}{60 a}\\,n\\,\\Phi_p, \\quad K_e = K_t = \\frac{E_a}{\\omega}, \\quad T_d = K_t I_a'
		],
		presets: [
			{
				id: 'ST-16',
				label: 'Torque Constant K_t of 25 HP DC Motor',
				source: 'Summer 2024 Final Q4a',
				description: 'n = 250 rpm, V_t = 120 V, I_a = 5.6 A, R_a = 0.473 Ω; find K_t = K_e.',
				input: {
					mode: 'operating-point',
					machineMode: 'motor',
					vtV: 120,
					raOhm: 0.473,
					speedRpm: 250,
					armatureCurrentA: 5.6
				}
			},
			{
				id: 'ST-17',
				label: 'Torque Scaling at Constant Field (20 A → 10 A)',
				source: 'Sheet 4 Q2',
				description: 'V_t = 250 V, R_a = 0.5 Ω, I_a1 = 20 A at 1500 rpm; find T_d at I_a2 = 10 A.',
				input: {
					mode: 'operating-point',
					machineMode: 'motor',
					vtV: 250,
					raOhm: 0.5,
					speedRpm: 1500,
					armatureCurrentA: 20,
					targetArmatureCurrentA: 10
				}
			}
		]
	},

	'QT-DC-2': {
		id: 'QT-DC-2',
		category: 'dc-machines',
		title: 'DC Generator Steady-State (Separately Excited & Shunt)',
		shortLabel: 'DC Generator',
		description:
			'Solve armature current, field current, load current, generated EMF, voltage regulation, and efficiency for separately excited or shunt DC generators.',
		keyFormulasLatex: [
			'E_a = V_t + I_a R_a, \\quad I_f = \\frac{V_t}{R_f + R_{rh}}, \\quad I_a = I_L + I_f\\;(\\text{shunt})',
			'\\%VR = \\frac{V_{nl} - V_{fl}}{V_{fl}}\\times 100\\%'
		],
		presets: [
			{
				id: 'ST-18',
				label: 'DC Shunt Generator Load Current (E_a = 254 V, V_t = 240 V)',
				source: 'Summer 2024 Final Q4c / Summer 2023 Q4c',
				description: 'R_a = 0.04 Ω, R_f = 24 Ω, E_a = 254 V, V_t = 240 V; find I_a, I_f, I_L.',
				input: {
					generatorType: 'shunt',
					solveFor: 'load-from-emf',
					eaV: 254,
					vtV: 240,
					raOhm: 0.04,
					rfOhm: 24
				}
			}
		]
	},

	'QT-DC-3': {
		id: 'QT-DC-3',
		category: 'dc-machines',
		title: 'DC Motor Speed Control (R_add, V_t, Field Flux)',
		shortLabel: 'DC Motor Speed Control',
		description:
			'Re-evaluate DC motor speed, back EMF, current, and torque after adding armature resistance, changing terminal voltage, or weakening field flux.',
		keyFormulasLatex: [
			'E_a = V_t - I_a(R_a + R_{\\text{add}}), \\quad \\frac{n_2}{n_1} = \\frac{E_{a2}}{E_{a1}}\\cdot\\frac{\\Phi_1}{\\Phi_2}'
		],
		presets: [
			{
				id: 'ST-19',
				label: 'Voltage Reduced by 20% at Constant P_in',
				source: 'Fall 2025 Q3c / Summer 2025 Q3c / Spring 2025 Q3d',
				description: '240 V sep. excited DC motor at 1000 rpm, P_in = 7800 W, R_a = 0.221 Ω; V_t reduced to 192 V.',
				input: {
					motorType: 'separately-excited',
					vt1V: 240,
					n1Rpm: 1000,
					raOhm: 0.221,
					pIn1W: 7800,
					controlMode: 'terminal-voltage',
					vt2V: 192,
					loadConstraint: 'constant-power'
				}
			},
			{
				id: 'ST-20',
				label: 'Armature Series Resistance R_add = 1.0 Ω (FL Torque)',
				source: 'Spring 2024 Final Q3c / Fall 2024 Final Q4b',
				description: '240 V DC shunt motor, R_a = 0.4 Ω, n_1 = 600 rpm, I_a1 = 25 A; add R_add = 1.0 Ω at FL torque.',
				input: {
					motorType: 'shunt',
					vt1V: 240,
					n1Rpm: 600,
					raOhm: 0.4,
					ia1A: 25,
					controlMode: 'armature-resistance',
					rAddOhm: 1.0,
					torqueRatio: 1
				}
			}
		]
	},

	'QT-IM-1': {
		id: 'QT-IM-1',
		category: 'induction-motor',
		title: 'Induction Motor Speed, Slip, Rotor Frequency & Rated Torque',
		shortLabel: 'Speed, Slip & Torque',
		description:
			'Calculate synchronous speed N_s, rotor speed N_r, slip speed, rotor current frequency f_r = s f_s, and rated shaft torque.',
		keyFormulasLatex: [
			'N_s = \\frac{120 f_s}{P}, \\quad N_r = (1-s)N_s, \\quad f_r = s f_s, \\quad T_{\\text{sh}} = \\frac{P_{\\text{out}}}{\\omega_r}'
		],
		presets: [
			{
				id: 'ST-21',
				label: '4-Pole, 50 Hz, 10 HP IM (s_nl = 1%, s_fl = 4%)',
				source: 'Fall 2023 Final Q4a',
				description: '400 V, 4-pole, 50 Hz, 10 HP Y-connected induction motor with 1% no-load slip and 4% full-load slip.',
				input: {
					poles: 4,
					frequencyHz: 50,
					slip: 0.04,
					noLoadSlip: 0.01,
					pOutHp: 10
				}
			}
		]
	},

	'QT-IM-2': {
		id: 'QT-IM-2',
		category: 'induction-motor',
		title: 'Induction Motor Power Flow Stages (Forward & Backward)',
		shortLabel: 'Power Flow Stages',
		description:
			'Trace electrical-to-mechanical power conversion forward (P_in → P_g → P_d → P_out) or backward (P_out → P_d → P_g → P_in) with slip, torque, and efficiency.',
		keyFormulasLatex: [
			'P_g = P_{i/p} - P_{cu,s} - P_{\\text{core}}, \\quad P_{cu,r} = s P_g, \\quad P_d = (1 - s) P_g, \\quad P_{o/p} = P_d - P_{\\text{mech}}'
		],
		presets: [
			{
				id: 'ST-22',
				label: '480 V, 50 HP Forward Power Flow (60 Hz)',
				source: 'Spring 2026 Q3c / Fall 2025 Q4b / Lecture 6 Example',
				description: '480 V, 4-pole, 60 Hz, I_L = 60 A at 0.85 lag, P_cu,s = 2 kW, P_cu,r = 700 W, P_core = 1800 W, P_mech = 600 W.',
				input: {
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
				}
			},
			{
				id: 'ST-23B',
				label: '100 HP, 4-Pole, 60 Hz Backward Power Flow',
				source: 'Sheet 5 Q8',
				description: '100 HP at 1732 rpm, P_mech = 900 W, P_core = 4200 W, P_cu,s = 2700 W; find P_in and η.',
				input: {
					direction: 'backward',
					connection: 'Y',
					poles: 4,
					frequencyHz: 60,
					pOutHp: 100,
					rotorSpeedRpm: 1732,
					pMechW: 900,
					pCoreW: 4200,
					pStatorCuW: 2700
				}
			}
		]
	},

	'QT-IM-3': {
		id: 'QT-IM-3',
		category: 'induction-motor',
		title: 'Induction Motor Equivalent Circuit (Exact T & Cantilever)',
		shortLabel: 'Equivalent Circuit',
		description:
			'Solve per-phase stator & rotor currents, power stages, developed/shaft/starting/max torques, and efficiency using Exact T or Approximate Cantilever circuit.',
		keyFormulasLatex: [
			'Z_{\\text{eq}} = (R_1 + jX_1) + \\left[\\left(\\frac{R_2\'}{s} + jX_2\'\\right) \\parallel jX_m\\right]',
			'T_d = \\frac{3(I_2\')^2 R_2\'}{s\\,\\omega_s}, \\quad T_{st} = T_d\\big|_{s=1}'
		],
		presets: [
			{
				id: 'ST-24-EXACT',
				label: '208 V, 30 HP Y-Connected IM (Exact T-Circuit)',
				source: 'Sheet 5 Q7 (TA Worked Solution)',
				description: 'R1=0.1, X1=0.21, R2\'=0.07, X2\'=0.21, Xm=10 Ω, s=0.05, P_mech=500 W, P_core=400 W.',
				input: {
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
				}
			},
			{
				id: 'ST-24-APPROX',
				label: '208 V, 30 HP Y-Connected IM (Approx. Cantilever)',
				source: 'Sheet 5 Q7 / Lecture 6 Slide 21 Model',
				description: 'Same motor evaluated using the Doctor\'s Approximate Cantilever circuit.',
				input: {
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
				}
			}
		]
	}
};

export function getCategoryMeta(category: MachineCategory): MachineCategoryMeta {
	const found = MACHINE_CATEGORIES.find((c) => c.id === category);
	if (!found) {
		throw new Error(`Unknown machine category: ${category}`);
	}
	return found;
}

export function getQuestionTypeMeta<K extends MachineQuestionTypeId>(
	id: K
): MachineQuestionTypeMeta<K> {
	return MACHINE_QUESTION_TYPES[id];
}

export function getQuestionTypesByCategory(
	category: MachineCategory
): MachineQuestionTypeMeta[] {
	const meta = getCategoryMeta(category);
	return meta.questionTypes.map((id) => MACHINE_QUESTION_TYPES[id] as MachineQuestionTypeMeta);
}
