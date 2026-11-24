<script lang="ts">
	import { AlertCircle, Check } from 'lucide-svelte';
	import { Button } from '$lib/components/ui';
	import {
		formatUnknownTermExpr,
		isImpedanceSpecified,
		parseComplexValue,
		parseEngineeringNumber,
		type AnalysisMode,
		type CircuitDocument,
		type ComponentKind,
		type UnknownSolutionCandidate,
		type UnknownSolveResult,
		type UnknownTermSolvedValue
	} from '$lib/engine';
	import { settings } from '$lib/stores/settings.svelte';
	import { cn } from '$lib/utils';
	import {
		formatComplexParts,
		formatDcQuantity,
		formatRealPower,
		type FormattedValueParts
	} from './formatters';

	type Props = {
		unknownSolution: UnknownSolveResult;
		document: CircuitDocument;
		mode: AnalysisMode;
		onApplySolution?: (solutionIndex: number) => void;
		class?: string;
	};

	const UNIT_BY_KIND: Partial<Record<ComponentKind, string>> = {
		voltage_source: 'V',
		current_source: 'A',
		resistor: 'Ω',
		capacitor: 'F',
		inductor: 'H'
	};

	let {
		unknownSolution,
		document,
		mode,
		onApplySolution,
		class: className
	}: Props = $props();

	const formatOpts = $derived({
		angleDisplay: settings.angleDisplay,
		precision: settings.precision,
		showDcFractions: settings.showDcFractions,
		unitSystem: settings.unitSystem
	});

	const isSource = $derived(
		unknownSolution.componentKind === 'voltage_source' ||
			unknownSolution.componentKind === 'current_source'
	);

	const primaryUnknownComp = $derived(
		document.components.find((c) => c.id === unknownSolution.componentId) ?? null
	);

	const isImpedancePassive = $derived(
		mode === 'ac' && primaryUnknownComp !== null && isImpedanceSpecified(primaryUnknownComp)
	);

	const answerUnit = $derived(
		isImpedancePassive ? 'Ω' : (UNIT_BY_KIND[unknownSolution.componentKind] ?? '')
	);

	const isMultiTerm = $derived((unknownSolution.terms?.length ?? 0) >= 2);

	const showComponentLabel = $derived(
		!isMultiTerm && unknownSolution.componentLabel.trim() !== unknownSolution.symbol.trim()
	);

	const answerColorClass = $derived(
		unknownSolution.componentKind === 'voltage_source'
			? 'text-voltage'
			: unknownSolution.componentKind === 'current_source'
				? 'text-branch-current'
				: 'text-foreground'
	);

	const allCandidatesVerified = $derived(
		unknownSolution.valid &&
			unknownSolution.solutions.length > 0 &&
			unknownSolution.solutions.every((s) => s.verified)
	);

	const maxDiscrepancy = $derived.by(() => {
		let max = 0;
		for (const s of unknownSolution.solutions) {
			if (Number.isFinite(s.discrepancy) && s.discrepancy > max) {
				max = s.discrepancy;
			}
		}
		return max;
	});

	function formatCandidate(cand: UnknownSolutionCandidate): FormattedValueParts {
		if (isSource) {
			return formatComplexParts(cand.value, answerUnit, mode, formatOpts);
		}
		return {
			primary: formatDcQuantity(cand.value.re, answerUnit, formatOpts)
		};
	}

	function formatTermSolvedValue(tv: UnknownTermSolvedValue): string {
		if (isSource) {
			return formatComplexParts(tv.value, tv.unit, mode, formatOpts).primary;
		}
		return formatDcQuantity(tv.value.re, tv.unit, formatOpts);
	}

	const constraintSummary = $derived.by(() => {
		const c = unknownSolution.constraint;
		const targetComp =
			c.kind === 'node_voltage'
				? undefined
				: document.components.find((comp) => comp.id === c.targetId);
		const targetLabel =
			c.kind === 'node_voltage' ? c.targetId : (targetComp?.label ?? c.targetId);

		const lhs =
			c.label?.trim() ||
			(c.kind === 'node_voltage'
				? `V(${targetLabel})`
				: c.kind === 'branch_voltage'
					? `V(${targetLabel})`
					: c.kind === 'branch_current'
						? `I(${targetLabel})`
						: `P(${targetLabel})`);

		let rhs = c.value;
		if (c.kind === 'branch_power') {
			const p = parseEngineeringNumber(c.value);
			if (p !== null) rhs = formatRealPower(p, formatOpts);
		} else {
			const parsed = parseComplexValue(c.value);
			if (parsed) {
				const unit = c.kind === 'branch_current' ? 'A' : 'V';
				rhs = formatComplexParts(parsed, unit, mode, formatOpts).primary;
			}
		}

		return `${lhs} = ${rhs}`;
	});
</script>

<section
	aria-label="Unknown Parameter Solution"
	class={cn('flex min-w-0 flex-col divide-y divide-border bg-card', className)}
>
	<!-- Flush Header Strip -->
	<div class="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 bg-surface-rail/60 px-4 py-2.5">
		<div class="flex min-w-0 flex-col gap-0.5">
			<h2 class="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
				Unknown Parameter Solution
			</h2>
			<span class="truncate text-xs font-medium text-foreground">
				{unknownSolution.methodName}
			</span>
		</div>

		<div class="font-engineering flex shrink-0 items-center gap-1.5 text-[11px]">
			{#if allCandidatesVerified}
				<span class="h-1.5 w-1.5 shrink-0 rounded-full bg-branch-current" aria-hidden="true"></span>
				<span class="text-foreground">
					Verified<span class="text-muted-foreground">
						{' · '}Δ {maxDiscrepancy < 1e-8 ? '< 1e-8' : `= ${maxDiscrepancy.toExponential(2)}`}
					</span>
				</span>
			{:else if unknownSolution.valid}
				<span class="h-1.5 w-1.5 shrink-0 rounded-full bg-warning" aria-hidden="true"></span>
				<span class="text-warning">Δ = {maxDiscrepancy.toExponential(2)}</span>
			{:else}
				<span class="h-1.5 w-1.5 shrink-0 rounded-full bg-destructive" aria-hidden="true"></span>
				<span class="font-medium text-destructive">No Solution</span>
			{/if}
		</div>
	</div>

	{#if !unknownSolution.valid}
		<!-- Crimson Diagnostic Callout -->
		<div role="alert" class="bg-destructive/10 px-4 py-3 text-xs text-destructive">
			<div class="mb-1 flex items-center gap-1.5 font-semibold">
				<AlertCircle class="size-3.5 shrink-0" aria-hidden="true" />
				<span>
					Cannot Solve for {unknownSolution.symbol}{#if showComponentLabel} ({unknownSolution.componentLabel}){/if}
				</span>
			</div>
			<p class="leading-relaxed text-destructive/90">
				{unknownSolution.error ?? 'No physical value satisfies the specified measurement constraint.'}
			</p>
			<div class="mt-2 font-engineering text-[11px] text-muted-foreground">
				Constraint: {constraintSummary}
			</div>
		</div>
	{:else}
		<!-- Solved Tabular Answer Rows -->
		<div class="flex flex-col divide-y divide-border">
			{#each unknownSolution.solutions as cand, idx (`unknown-sol-${idx}`)}
				{@const formatted = formatCandidate(cand)}
				{@const isMulti = unknownSolution.solutions.length > 1}
				<div class="flex flex-wrap items-center justify-between gap-2.5 px-4 py-3">
					<div class="min-w-0 flex-1">
						<div class="flex flex-wrap items-baseline gap-x-1.5 gap-y-0.5 font-engineering">
							<span class="text-xs font-semibold text-foreground">
								{unknownSolution.symbol}{#if isMulti}<sub>{idx + 1}</sub>{/if}
							</span>
							{#if showComponentLabel}
								<span class="text-[11px] text-muted-foreground">
									({unknownSolution.componentLabel})
								</span>
							{/if}
							<span class="text-xs text-muted-foreground">=</span>
							<span class={cn('text-sm font-semibold whitespace-nowrap', answerColorClass)}>
								{formatted.primary}
							</span>
							{#if isMulti && idx === 0}
								<span class="font-sans text-[10px] text-muted-foreground">
									· Active preview
								</span>
							{/if}
						</div>
						{#if formatted.secondary}
							<div class="mt-0.5 font-engineering text-[11px] text-muted-foreground">
								{formatted.secondary}
							</div>
						{/if}
						{#if isMultiTerm && cand.termValues && cand.termValues.length >= 2}
							<div
								class="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 border-t border-border/80 pt-1.5 font-engineering text-[11px] text-muted-foreground"
							>
								{#each cand.termValues as tv, tvIdx (tv.componentId)}
									{#if tvIdx > 0}
										<span aria-hidden="true" class="text-border">·</span>
									{/if}
									<span class="whitespace-nowrap">
										<span class="font-medium text-foreground">{tv.componentLabel}</span>
										<span> = {formatUnknownTermExpr(tv.multiplier, unknownSolution.symbol)} = </span>
										<span class="font-medium text-foreground">{formatTermSolvedValue(tv)}</span>
									</span>
								{/each}
							</div>
						{/if}
					</div>

					{#if onApplySolution && isMulti}
						<Button
							variant="outline"
							size="sm"
							class="min-h-11 shrink-0 px-3 text-xs sm:h-7 sm:min-h-0 sm:px-2.5 sm:text-[11px]"
							onclick={() => onApplySolution(idx)}
						>
							<Check class="size-3.5" aria-hidden="true" />
							<span>Apply</span>
						</Button>
					{/if}
				</div>
			{/each}

			<!-- Constraint Verification & Single-Solution Apply Strip -->
			<div class="flex flex-wrap items-center justify-between gap-2.5 px-4 py-2.5">
				<div class="font-engineering flex min-w-0 flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
					<span>Given <span class="font-medium text-foreground">{constraintSummary}</span></span>
					<span aria-hidden="true">→</span>
					<span class="inline-flex items-center gap-1 font-sans font-medium text-branch-current">
						<Check class="size-3 shrink-0" aria-hidden="true" />
						<span>Verified</span>
					</span>
				</div>

				{#if onApplySolution && unknownSolution.solutions.length === 1}
					<Button
						variant="outline"
						size="sm"
						class="min-h-11 w-full shrink-0 text-xs sm:h-7 sm:min-h-0 sm:w-auto sm:text-[11px]"
						onclick={() => onApplySolution(0)}
					>
						<Check class="size-3.5" aria-hidden="true" />
						<span>{isMultiTerm ? 'Apply Solved Values to Circuit' : 'Apply Solved Value to Circuit'}</span>
					</Button>
				{/if}
			</div>
		</div>
	{/if}
</section>
