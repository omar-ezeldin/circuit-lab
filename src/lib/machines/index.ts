export * from './types';
export { solveThreePhase } from './three-phase';
export {
	solveLinearMagneticCircuit,
	solveNonlinearOrParallelMagnetic,
	solveVariableReluctanceActuator
} from './magnetic';
export {
	solveTransformerEmfAndCoreLoss,
	solveTransformerOcScTests,
	solveTransformerOnLoad,
	solveTransformerEfficiencyLoad
} from './transformer';
export { solveDcEmfAndTorque, solveDcGenerator, solveDcMotor } from './dc-machines';
export {
	solveInductionMotorBasic,
	solveInductionMotorPowerFlow,
	solveInductionMotorEquivCircuit
} from './induction-motor';
export {
	MACHINE_CATEGORIES,
	MACHINE_QUESTION_TYPES,
	getCategoryMeta,
	getQuestionTypeMeta,
	getQuestionTypesByCategory
} from './catalog';
export {
	AI_MACHINES_IMPORT_PROMPT,
	ALL_MACHINE_AI_TOPIC_SLUGS,
	MACHINE_AI_TOPIC_SLUG_MAP,
	MACHINE_QUESTION_TYPE_TO_SLUG,
	parseMachineAiImport,
	resolveMachineQuestionType,
	type MachineAiImportFailure,
	type MachineAiImportResult,
	type MachineAiImportSuccess,
	type MachineAiTopicSlug
} from './ai-import';

import { solveThreePhase } from './three-phase';
import {
	solveLinearMagneticCircuit,
	solveNonlinearOrParallelMagnetic,
	solveVariableReluctanceActuator
} from './magnetic';
import {
	solveTransformerEmfAndCoreLoss,
	solveTransformerOcScTests,
	solveTransformerOnLoad,
	solveTransformerEfficiencyLoad
} from './transformer';
import { solveDcEmfAndTorque, solveDcGenerator, solveDcMotor } from './dc-machines';
import {
	solveInductionMotorBasic,
	solveInductionMotorPowerFlow,
	solveInductionMotorEquivCircuit
} from './induction-motor';
import type { MachineInputMap, MachineQuestionTypeId, MachineSolveResult } from './types';

export function solveMachineQuestion<K extends MachineQuestionTypeId>(
	typeId: K,
	input: MachineInputMap[K]
): MachineSolveResult {
	switch (typeId) {
		case 'QT-3PH-1':
			return solveThreePhase(input as MachineInputMap['QT-3PH-1']);
		case 'QT-MAG-1':
			return solveLinearMagneticCircuit(input as MachineInputMap['QT-MAG-1']);
		case 'QT-MAG-2':
			return solveNonlinearOrParallelMagnetic(input as MachineInputMap['QT-MAG-2']);
		case 'QT-MAG-3':
			return solveVariableReluctanceActuator(input as MachineInputMap['QT-MAG-3']);
		case 'QT-XFMR-1':
			return solveTransformerEmfAndCoreLoss(input as MachineInputMap['QT-XFMR-1']);
		case 'QT-XFMR-2':
			return solveTransformerOcScTests(input as MachineInputMap['QT-XFMR-2']);
		case 'QT-XFMR-3':
			return solveTransformerOnLoad(input as MachineInputMap['QT-XFMR-3']);
		case 'QT-XFMR-4':
			return solveTransformerEfficiencyLoad(input as MachineInputMap['QT-XFMR-4']);
		case 'QT-DC-1':
			return solveDcEmfAndTorque(input as MachineInputMap['QT-DC-1']);
		case 'QT-DC-2':
			return solveDcGenerator(input as MachineInputMap['QT-DC-2']);
		case 'QT-DC-3':
			return solveDcMotor(input as MachineInputMap['QT-DC-3']);
		case 'QT-IM-1':
			return solveInductionMotorBasic(input as MachineInputMap['QT-IM-1']);
		case 'QT-IM-2':
			return solveInductionMotorPowerFlow(input as MachineInputMap['QT-IM-2']);
		case 'QT-IM-3':
			return solveInductionMotorEquivCircuit(input as MachineInputMap['QT-IM-3']);
	}
}
