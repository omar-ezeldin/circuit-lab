<script lang="ts">
	import { Activity, AlertCircle, AlertTriangle, ChevronDown, Info } from 'lucide-svelte';
	import type {
		CircuitDocument,
		FullSolveResult,
		MethodId,
		ValidationDiagnostic
	} from '$lib/engine/types';
	import { cn } from '$lib/utils';
	import FinalAnswersCard from './FinalAnswersCard.svelte';
	import MethodStepsPanel from './MethodStepsPanel.svelte';
	import PhasorDiagram from './PhasorDiagram.svelte';
	import UnknownSolutionCard from './UnknownSolutionCard.svelte';

	type Props = {
		solution: FullSolveResult | null;
		document: CircuitDocument;
		selectedComponentId?: string | null;
		activeMethod?: MethodId;
		onSelectComponent?: (id: string) => void;
		onSelectTheveninComponent?: (id: string) => void;
		onApplyUnknownSolution?: (solutionIndex: number) => void;
		class?: string;
	};

	let {
		solution,
		document,
		selectedComponentId = null,
		activeMethod = $bindable<MethodId>('nodal'),
		onSelectComponent,
		onSelectTheveninComponent,
		onApplyUnknownSolution,
		class: className
	}: Props = $props();

	let phasorExpanded = $state(true);

	const diagnostics = $derived(solution?.mna.diagnostics ?? []);
	const errorDiags = $derived(diagnostics.filter((d) => d.severity === 'error'));
	const warningDiags = $derived(diagnostics.filter((d) => d.severity === 'warning'));
	const infoDiags = $derived(diagnostics.filter((d) => d.severity === 'info'));

	function handleDiagnosticClick(diag: ValidationDiagnostic) {
		const targetId = diag.componentIds?.[0];
		if (targetId) {
			onSelectComponent?.(targetId);
		}
	}
</script>

<div class={cn('flex min-w-0 flex-col divide-y divide-border', className)}>
	{#if !solution}
		<div class="flex flex-col items-center justify-center gap-2 px-6 py-12 text-center">
			<Activity class="size-5 text-muted-foreground" aria-hidden="true" />
			<div class="text-sm font-semibold text-foreground">Ready to Solve</div>
			<p class="max-w-sm text-xs leading-relaxed text-muted-foreground">
				Build a circuit on the schematic canvas or load a preset to compute node voltages, branch
				currents, power conservation, and 6-method KaTeX derivations.
			</p>
		</div>
	{:else}
		<!-- 0. Unknown Parameter Solution (at very top when active) -->
		{#if solution.unknownSolution}
			<UnknownSolutionCard
				unknownSolution={solution.unknownSolution}
				{document}
				mode={solution.mna.mode}
				onApplySolution={onApplyUnknownSolution}
			/>
		{/if}

		<!-- Validation Diagnostics Banner -->
		{#if errorDiags.length > 0 || warningDiags.length > 0 || infoDiags.length > 0}
			<div class="flex flex-col divide-y divide-border" aria-label="Circuit Diagnostics">
				{#if errorDiags.length > 0}
					<div
						role="alert"
						class="bg-destructive/10 px-4 py-3 text-xs text-destructive"
					>
						<div class="mb-1 flex items-center gap-1.5 font-semibold">
							<AlertCircle class="size-3.5 shrink-0" aria-hidden="true" />
							Circuit Validation {errorDiags.length === 1 ? 'Error' : 'Errors'}
						</div>
						<ul class="flex list-disc flex-col gap-1 pl-5">
							{#each errorDiags as diag, i (`err-${diag.code}-${i}`)}
								<li>
									{#if diag.componentIds?.length && onSelectComponent}
										<button
											type="button"
											onclick={() => handleDiagnosticClick(diag)}
											class="cursor-pointer text-left underline decoration-destructive/60 underline-offset-2 hover:text-destructive/80"
										>
											{diag.message}
										</button>
									{:else}
										{diag.message}
									{/if}
								</li>
							{/each}
						</ul>
					</div>
				{/if}

				{#if warningDiags.length > 0}
					<div class="bg-warning/10 px-4 py-3 text-xs text-warning">
						<div class="mb-1 flex items-center gap-1.5 font-semibold">
							<AlertTriangle class="size-3.5 shrink-0" aria-hidden="true" />
							{warningDiags.length === 1 ? 'Warning' : 'Warnings'}
						</div>
						<ul class="flex list-disc flex-col gap-1 pl-5 text-foreground/90">
							{#each warningDiags as diag, i (`warn-${diag.code}-${i}`)}
								<li>{diag.message}</li>
							{/each}
						</ul>
					</div>
				{/if}

				{#if infoDiags.length > 0}
					<div class="bg-surface-rail/60 px-4 py-2.5 text-xs text-muted-foreground">
						<div class="flex items-start gap-2">
							<Info class="mt-0.5 size-3.5 shrink-0 text-primary" aria-hidden="true" />
							<ul class="flex flex-col gap-0.5">
								{#each infoDiags as diag, i (`info-${diag.code}-${i}`)}
									<li>{diag.message}</li>
								{/each}
							</ul>
						</div>
					</div>
				{/if}
			</div>
		{/if}

		{#if solution.mna.valid}
			{#if !solution.mna.multiFrequencyHz}
			<!-- 1. Direct Final Answers First -->
			<FinalAnswersCard
				{solution}
				{document}
				{selectedComponentId}
				{onSelectComponent}
				{onSelectTheveninComponent}
			/>

			<!-- 2. Interactive AC Polar Phasor Diagram (Collapsible in AC Mode) -->
			{#if solution.mna.mode === 'ac'}
				<section class="bg-transparent">
					<button
						type="button"
						aria-expanded={phasorExpanded}
						onclick={() => (phasorExpanded = !phasorExpanded)}
						class="flex min-h-11 w-full cursor-pointer items-center justify-between gap-2 px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-wider text-muted-foreground transition-colors duration-150 hover:bg-accent/40 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring lg:min-h-0"
					>
						<span>AC Polar Phasor Diagram</span>
						<ChevronDown
							class={cn(
								'size-3.5 text-muted-foreground transition-transform duration-150',
								phasorExpanded && 'rotate-180'
							)}
							aria-hidden="true"
						/>
					</button>
					{#if phasorExpanded}
						<div class="px-4 pb-4">
							<PhasorDiagram
								{solution}
								{selectedComponentId}
								{onSelectComponent}
							/>
						</div>
					{/if}
				</section>
			{/if}
			{/if}

			<!-- 3. Step-by-Step Review Below (Superposition is the valid method for mixed frequencies) -->
			<MethodStepsPanel {solution} bind:activeMethod />
		{/if}
	{/if}
</div>
