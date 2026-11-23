/**
 * Unified Circuit Solver & Cross-Verification Gate.
 * Runs MNA ground truth, executes all requested pedagogical methods,
 * and aggregates cross-verification discrepancies across every method.
 */

import { solveMNA, type SolveMnaOptions } from './mna';
import { solveKclKvl } from './methods/kcl-kvl';
import { formatLatexValue, latexSub } from './methods/shared';
import { solveMesh } from './methods/mesh';
import { solveNodal } from './methods/nodal';
import { solveSourceTransform } from './methods/source-transform';
import { solveSuperposition } from './methods/superposition';
import { solveTheveninNorton } from './methods/thevenin-norton';
import {
	solveUnknownParameter,
	substituteUnknownTerms,
	substituteUnknownValue
} from './unknown-solver';
import type {
	CircuitDocument,
	FullSolveResult,
	MethodId,
	MethodResult,
	TheveninNortonResult,
	TheveninTarget,
	UnknownSolveResult
} from './types';

export interface SolveCircuitOptions extends SolveMnaOptions {
	theveninTarget?: TheveninTarget;
	methods?: MethodId[];
}

const METHOD_TITLES: Record<MethodId, string> = {
	kcl_kvl: "Kirchhoff's Laws (KCL & KVL)",
	nodal: 'Nodal Analysis',
	mesh: 'Mesh Analysis',
	superposition: 'Superposition Theorem',
	source_transform: 'Source Transformation',
	thevenin_norton: 'Thévenin & Norton Equivalent'
};

/** Methods shown to students by default. KCL/KVL stays available when requested explicitly. */
const ALL_METHODS: MethodId[] = [
	'nodal',
	'mesh',
	'superposition',
	'source_transform',
	'thevenin_norton'
];

/**
 * Solves a CircuitDocument using MNA and all requested pedagogical methods,
 * verifying every applicable method independently against MNA (< 1e-8).
 * If `doc.unknownProblem` is present, solves for the unknown parameter first
 * and substitutes the primary solution into the working circuit.
 */
export function solveCircuit(
	doc: CircuitDocument,
	options?: SolveCircuitOptions
): FullSolveResult {
	const mnaOpts: SolveMnaOptions = {
		frequencyHz: options?.frequencyHz,
		acMagnitudeMode: options?.acMagnitudeMode
	};

	let workingDoc = doc;
	let unknownSolution: UnknownSolveResult | undefined;

	if (doc.unknownProblem) {
		unknownSolution = solveUnknownParameter(doc, doc.unknownProblem, mnaOpts);
		if (unknownSolution.valid && unknownSolution.solutions.length > 0) {
			const primary = unknownSolution.solutions[0];
			if (primary.termValues && primary.termValues.length > 0) {
				workingDoc = substituteUnknownTerms(
					doc,
					primary.termValues.map((tv) => ({
						componentId: tv.componentId,
						valueString: tv.valueString
					}))
				);
			} else {
				workingDoc = substituteUnknownValue(
					doc,
					doc.unknownProblem.componentId,
					primary.valueString
				);
			}
		}
	}

	const mna = solveMNA(workingDoc, mnaOpts);

	if (!mna.valid) {
		return {
			mna,
			methods: {},
			unknownSolution,
			allVerified: false,
			maxDiscrepancy: 0
		};
	}

	const hasVoltmeter = workingDoc.components.some((c) => c.kind === 'voltmeter');
	const electricalDoc: CircuitDocument = hasVoltmeter
		? {
				...workingDoc,
				components: workingDoc.components.filter((c) => c.kind !== 'voltmeter')
			}
		: workingDoc;

	const rawTarget = options?.theveninTarget;
	const safeTheveninTarget: TheveninTarget | undefined =
		rawTarget?.kind === 'component' &&
		workingDoc.components.some((c) => c.id === rawTarget.componentId && c.kind === 'voltmeter')
			? undefined
			: rawTarget;

	const requested = options?.methods ?? ALL_METHODS;
	const methods: Partial<Record<MethodId, MethodResult>> = {};
	let theveninNorton: TheveninNortonResult | undefined;

	for (const methodId of requested) {
		// Mixed source frequencies: every single-phasor method would be "verified" against a
		// meaningless mixed-frequency MNA answer. Only Superposition handles this correctly.
		if (mna.multiFrequencyHz && methodId !== 'superposition') {
			methods[methodId] = {
				methodId,
				title: METHOD_TITLES[methodId],
				applicable: false,
				inapplicableReason:
					'Sources run at different frequencies, so one phasor per node is not meaningful. Use Superposition: it solves each frequency separately and combines them in the time domain.',
				steps: []
			};
			continue;
		}
		switch (methodId) {
			case 'kcl_kvl':
				methods.kcl_kvl = solveKclKvl(electricalDoc, mna);
				break;
			case 'nodal':
				methods.nodal = solveNodal(electricalDoc, mna);
				break;
			case 'mesh':
				methods.mesh = solveMesh(electricalDoc, mna);
				break;
			case 'superposition':
				methods.superposition = solveSuperposition(electricalDoc, mna, {
					targetComponentId:
						safeTheveninTarget?.kind === 'component' ? safeTheveninTarget.componentId : undefined
				});
				break;
			case 'source_transform':
				methods.source_transform = solveSourceTransform(electricalDoc, mna, {
					targetComponentId:
						safeTheveninTarget?.kind === 'component' ? safeTheveninTarget.componentId : undefined
				});
				break;
			case 'thevenin_norton': {
				const res = solveTheveninNorton(electricalDoc, mna, safeTheveninTarget);
				methods.thevenin_norton = res.methodResult;
				theveninNorton = res.theveninNorton;
				break;
			}
		}
	}

	// Final "Ans." line for the requested component (Thévenin/Norton has its own answer).
	if (safeTheveninTarget?.kind === 'component') {
		const br = mna.branches[safeTheveninTarget.componentId];
		if (br) {
			const lab = latexSub(br.label);
			const ans = [
				`\\text{Ans. } I_{${lab}} = ${formatLatexValue(br.current, mna.mode)}\\text{ A}`,
				`\\text{Ans. } V_{${lab}} = ${formatLatexValue(br.voltage, mna.mode)}\\text{ V}`
			];
			for (const [id, res] of Object.entries(methods)) {
				if (id === 'thevenin_norton' || !res?.applicable) continue;
				res.steps.push({ title: 'Ans.', description: 'Requested quantity', latex: ans });
			}
		}
	}

	let allVerified = true;
	let maxDiscrepancy = 0;

	// Verify ideal voltmeter differential voltage and zero-disturbance invariants
	for (const br of Object.values(mna.branches)) {
		if (br.kind !== 'voltmeter') continue;
		const vA = mna.nodeVoltages[br.nodeA]?.voltage;
		const vB = mna.nodeVoltages[br.nodeB]?.voltage;
		if (!vA || !vB) {
			allVerified = false;
			continue;
		}
		const expectedV = vA.sub(vB);
		const vDiff = br.voltage.sub(expectedV).abs();
		const iDiff = br.current.abs();
		const pDiff = Math.abs(br.realPower) + Math.abs(br.reactivePower);
		const vmDiff = Math.max(vDiff, iDiff, pDiff);
		if (vmDiff > maxDiscrepancy) maxDiscrepancy = vmDiff;
		if (vmDiff >= 1e-8) {
			allVerified = false;
		}
	}

	if (unknownSolution) {
		if (!unknownSolution.valid) {
			allVerified = false;
		} else {
			for (const cand of unknownSolution.solutions) {
				if (!cand.verified) {
					allVerified = false;
				}
				if (Number.isFinite(cand.discrepancy) && cand.discrepancy > maxDiscrepancy) {
					maxDiscrepancy = cand.discrepancy;
				}
			}
		}
	}

	for (const res of Object.values(methods)) {
		if (!res || !res.applicable) continue;
		if (!res.verifiedAgainstMna) {
			allVerified = false;
		}
		if (res.maxDiscrepancy !== undefined && res.maxDiscrepancy > maxDiscrepancy) {
			maxDiscrepancy = res.maxDiscrepancy;
		}
	}

	return {
		mna,
		methods,
		theveninNorton,
		unknownSolution,
		allVerified,
		maxDiscrepancy
	};
}
