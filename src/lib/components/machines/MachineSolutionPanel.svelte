<script lang="ts">
	import {
		AlertTriangle,
		BookOpen,
		ChevronDown,
		ChevronsDownUp,
		ChevronsUpDown,
		Info,
		XCircle
	} from 'lucide-svelte';
	import { Accordion, AccordionItem, Badge } from '$lib/components/ui';
	import { MathBlock } from '$lib/components/results';
	import type { MachineQuestionTypeMeta, MachineSolveResult } from '$lib/machines';
	import { cn } from '$lib/utils';

	type Props = {
		result: MachineSolveResult;
		meta: MachineQuestionTypeMeta;
		class?: string;
	};

	let { result, meta, class: className }: Props = $props();

	const STEP_SURFACE_BG = 'color-mix(in srgb, var(--surface-rail) 55%, var(--card))';

	let expandedSteps = $state<string[]>([]);
	let formulasOpen = $state(false);
	let lastResetKey = '';

	const stepIds = $derived(
		result.steps.map((_, index) => `machine-step-${result.questionType}-${index}`)
	);

	// Expand all derivation steps when switching question type or step count changes
	$effect(() => {
		const key = `${result.questionType}:${result.steps.length}`;
		if (key !== lastResetKey) {
			lastResetKey = key;
			expandedSteps = [...stepIds];
		}
	});

	const allExpanded = $derived(
		stepIds.length > 0 && stepIds.every((id) => expandedSteps.includes(id))
	);

	function toggleAllSteps() {
		if (allExpanded) {
			expandedSteps = [];
		} else {
			expandedSteps = [...stepIds];
		}
	}
</script>

<section
	aria-label="Live solution and derivation"
	class={cn('flex min-w-0 flex-col bg-card', className)}
>
	<!-- Header Strip -->
	<div
		class="flex items-center justify-between gap-2 border-b border-border bg-surface-rail/60 px-4 py-2"
	>
		<div class="flex min-w-0 items-center gap-2">
			<span
				class={cn(
					'h-2 w-2 shrink-0 rounded-full',
					result.valid ? 'bg-branch-current' : 'bg-destructive'
				)}
				aria-hidden="true"
			></span>
			<h2 class="truncate text-xs font-semibold uppercase tracking-wider text-foreground">
				Live Solution
			</h2>
		</div>
		<Badge variant="outline" class="font-engineering shrink-0 text-[10px]">
			{meta.id}
		</Badge>
	</div>

	{#if !result.valid}
		<!-- Validation Error State -->
		<div class="p-4">
			<div
				role="alert"
				class="flex items-start gap-2.5 rounded-[4px] border border-destructive/40 bg-destructive/8 p-3 text-xs text-foreground"
			>
				<XCircle class="mt-0.5 size-4 shrink-0 text-destructive" aria-hidden="true" />
				<div class="min-w-0 space-y-1">
					<p class="font-semibold text-destructive">Invalid Parameter Combination</p>
					<p class="leading-relaxed text-foreground/90">
						{result.error ?? 'Check the input values and ensure all required parameters are positive and finite.'}
					</p>
				</div>
			</div>
		</div>
	{:else}
		<!-- Optional Solver Warnings -->
		{#if result.warnings && result.warnings.length > 0}
			<div class="border-b border-warning/30 bg-warning/8 px-4 py-2.5">
				<div class="flex items-start gap-2 text-xs text-foreground">
					<AlertTriangle class="mt-0.5 size-3.5 shrink-0 text-warning" aria-hidden="true" />
					<ul class="min-w-0 space-y-1">
						{#each result.warnings as warning, i (i)}
							<li class="leading-snug">{warning}</li>
						{/each}
					</ul>
				</div>
			</div>
		{/if}

		<!-- Final Answers Grid -->
		<div class="border-b border-border px-4 py-3.5">
			<div class="mb-2.5 flex items-baseline justify-between gap-2">
				<h3 class="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
					Final Answers
				</h3>
				<span class="font-engineering text-[11px] text-muted-foreground">
					{result.answers.length} {result.answers.length === 1 ? 'quantity' : 'quantities'}
				</span>
			</div>

			<div class="grid grid-cols-1 gap-2 sm:grid-cols-2">
				{#each result.answers as answer (answer.key)}
					<div
						class={cn(
							'flex flex-col justify-between gap-1 rounded-[4px] border px-3 py-2',
							answer.highlight
								? 'border-primary/45 bg-primary/6'
								: 'border-border bg-surface-rail/35'
						)}
					>
						<div class="flex items-center justify-between gap-1.5">
							<span
								class="truncate text-[11px] font-medium text-muted-foreground"
								title={answer.label}
							>
								{answer.label}
							</span>
							{#if answer.symbolLatex}
								<MathBlock
									latex={answer.symbolLatex}
									display={false}
									class="shrink-0 text-[11px] text-foreground/85"
								/>
							{/if}
						</div>
						<div class="flex items-baseline justify-between gap-1.5">
							<span
								class={cn(
									'font-engineering text-sm font-semibold tracking-tight break-all',
									answer.highlight ? 'text-primary' : 'text-foreground'
								)}
							>
								{answer.formatted}
							</span>
							{#if answer.unit && !answer.formatted.endsWith(answer.unit)}
								<span class="font-engineering shrink-0 text-[11px] text-muted-foreground">
									{answer.unit}
								</span>
							{/if}
						</div>
					</div>
				{/each}
			</div>
		</div>

		<!-- Step-by-Step Derivation -->
		<div class="flex min-w-0 flex-col border-b border-border">
			<div class="flex items-center justify-between gap-2 px-4 pt-3 pb-2">
				<div class="min-w-0">
					<h3 class="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
						Step-by-Step Derivation
					</h3>
					<p class="text-[11px] text-muted-foreground">
						Doctor's slides formulas &amp; numerical substitution
					</p>
				</div>
				{#if result.steps.length > 0}
					<button
						type="button"
						onclick={toggleAllSteps}
						class="inline-flex min-h-11 shrink-0 cursor-pointer items-center gap-1.5 rounded-[4px] border border-border bg-card px-2.5 text-xs font-medium text-foreground transition-colors duration-150 hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring lg:min-h-7 lg:px-2 lg:text-[11px]"
					>
						{#if allExpanded}
							<ChevronsDownUp class="size-3.5" aria-hidden="true" />
							<span>Collapse</span>
						{:else}
							<ChevronsUpDown class="size-3.5" aria-hidden="true" />
							<span>Expand All</span>
						{/if}
					</button>
				{/if}
			</div>

			{#if result.steps.length > 0}
				<Accordion variant="flush" type="multiple" bind:value={expandedSteps}>
					{#each result.steps as step, index (stepIds[index])}
						<AccordionItem value={stepIds[index]} title={`${index + 1}. ${step.title}`}>
							<div
								class="space-y-1.5 rounded-[4px] border border-border/80 bg-surface-rail/55 px-3 py-2"
								style="--math-fade-bg: {STEP_SURFACE_BG};"
							>
								<MathBlock latex={step.formulaLatex} />
								{#if step.substitutionLatex}
									<div class="border-t border-border/60 pt-1">
										<MathBlock latex={step.substitutionLatex} />
									</div>
								{/if}
								{#if step.resultLatex}
									<div class="border-t border-border/60 pt-1">
										<MathBlock latex={step.resultLatex} class="text-primary" />
									</div>
								{/if}
								{#if step.note}
									<div class="flex items-start gap-1.5 border-t border-border/60 pt-1.5 text-[11px] text-muted-foreground">
										<Info class="mt-0.5 size-3 shrink-0 text-primary" aria-hidden="true" />
										<span class="leading-snug">{step.note}</span>
									</div>
								{/if}
							</div>
						</AccordionItem>
					{/each}
				</Accordion>
			{/if}
		</div>
	{/if}

	<!-- Collapsible Key Formulas Reference -->
	<div class="bg-surface-rail/30">
		<button
			type="button"
			aria-expanded={formulasOpen}
			onclick={() => (formulasOpen = !formulasOpen)}
			class="flex min-h-11 w-full cursor-pointer items-center justify-between gap-2 px-4 py-2.5 text-left transition-colors duration-150 hover:bg-accent/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring lg:min-h-9"
		>
			<span class="inline-flex items-center gap-2 text-xs font-semibold text-foreground">
				<BookOpen class="size-3.5 text-primary" aria-hidden="true" />
				<span>Key Formulas (Doctor's Slides)</span>
			</span>
			<ChevronDown
				class={cn(
					'size-4 text-muted-foreground transition-transform duration-150',
					formulasOpen && 'rotate-180'
				)}
				aria-hidden="true"
			/>
		</button>

		{#if formulasOpen}
			<div
				class="space-y-2 border-t border-border bg-card px-4 py-3"
				style="--math-fade-bg: var(--card);"
			>
				{#each meta.keyFormulasLatex as formula, idx (idx)}
					<div class="rounded-[4px] border border-border/70 bg-surface-rail/40 px-2.5 py-1.5">
						<MathBlock latex={formula} />
					</div>
				{/each}
			</div>
		{/if}
	</div>
</section>
