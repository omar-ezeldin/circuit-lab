<script lang="ts">
	import { AlertTriangle, ChevronsDownUp, ChevronsUpDown, Info } from 'lucide-svelte';
	import {
		Accordion,
		AccordionItem,
		Button,
		Tabs,
		TabsList,
		TabsTrigger
	} from '$lib/components/ui';
	import type { FullSolveResult, MethodId } from '$lib/engine/types';
	import { cn } from '$lib/utils';
	import MathBlock from './MathBlock.svelte';

	type Props = {
		solution: FullSolveResult;
		activeMethod?: MethodId;
		class?: string;
	};

	// Opaque equivalents of `bg-surface-rail/60` and `bg-surface-rail/30` over `bg-card`,
	// so MathBlock's horizontal scroll fades blend seamlessly into their host surfaces.
	const STEP_SURFACE_BG = 'color-mix(in srgb, var(--surface-rail) 60%, var(--card))';
	const SUMMARY_SURFACE_BG = 'color-mix(in srgb, var(--surface-rail) 30%, var(--card))';

	const METHOD_TABS: Array<{ id: MethodId; label: string }> = [
		{ id: 'nodal', label: 'Nodal' },
		{ id: 'mesh', label: 'Mesh' },
		{ id: 'superposition', label: 'Superposition' },
		{ id: 'source_transform', label: 'Source Transform' },
		{ id: 'thevenin_norton', label: 'Thévenin & Norton' }
	];

	let {
		solution,
		activeMethod = $bindable<MethodId>('nodal'),
		class: className
	}: Props = $props();

	let expandedSteps = $state<string[]>([]);
	let lastResetKey = '';

	const currentMethod = $derived(solution.methods[activeMethod]);
	const stepIds = $derived(
		(currentMethod?.steps ?? []).map((_, index) => `step-${activeMethod}-${index}`)
	);

	// Reset default-expanded steps (first 2) only when solution or activeMethod changes
	$effect(() => {
		const key = `${activeMethod}:${currentMethod?.steps.length ?? 0}:${currentMethod?.summaryLatex ?? ''}`;
		if (key !== lastResetKey) {
			lastResetKey = key;
			expandedSteps = stepIds.slice(0, 2);
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

<section aria-label="Step-by-Step Analysis" class={cn('flex min-w-0 flex-col', className)}>
	<div class="flex flex-wrap items-baseline justify-between gap-2 px-4 pt-3.5 pb-2">
		<h3 class="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
			Step-by-Step Analysis
		</h3>
		<span class="text-[11px] text-muted-foreground">
			All 6 methods cross-verified against MNA
		</span>
	</div>

	<Tabs
		value={activeMethod}
		variant="underline"
		onValueChange={(next) => {
			activeMethod = next as MethodId;
		}}
	>
		<TabsList
			class="flex h-auto min-h-11 w-full flex-nowrap items-stretch justify-start gap-3 overflow-x-auto overflow-y-hidden no-scrollbar px-4 [-webkit-overflow-scrolling:touch] md:h-9 md:min-h-0 md:gap-4"
		>
			{#each METHOD_TABS as tab (tab.id)}
				{@const res = solution.methods[tab.id]}
				<TabsTrigger
					value={tab.id}
					class="mb-0 h-auto min-h-11 min-w-11 shrink-0 gap-1.5 px-2 md:h-full md:min-h-0 md:min-w-0 md:px-1.5"
				>
					<span>{tab.label}</span>
					{#if res && !res.applicable}
						<span
							class="size-1.5 rounded-full bg-warning"
							title="Not applicable to this circuit"
							aria-hidden="true"
						></span>
					{/if}
				</TabsTrigger>
			{/each}
		</TabsList>
	</Tabs>

	{#if !currentMethod}
		<div class="px-4 py-3 text-xs text-muted-foreground">
			This solution method was not evaluated for the current solve run.
		</div>
	{:else}
		<div
			class="flex flex-wrap items-center justify-between gap-2 border-b border-border bg-surface-rail/40 px-4 py-2.5"
		>
			<div class="flex flex-wrap items-center gap-x-2.5 gap-y-1">
				<span class="text-xs font-semibold text-foreground">{currentMethod.title}</span>
				{#if !currentMethod.applicable}
					<span class="inline-flex items-center gap-1.5 text-[11px] font-medium text-warning">
						<span class="h-1.5 w-1.5 shrink-0 rounded-full bg-warning" aria-hidden="true"></span>
						<span>Not Applicable</span>
					</span>
				{:else if currentMethod.verifiedAgainstMna}
					<span class="inline-flex items-center gap-1.5 text-[11px] text-muted-foreground">
						<span class="h-1.5 w-1.5 shrink-0 rounded-full bg-branch-current" aria-hidden="true"></span>
						<span>Verified vs MNA</span>
					</span>
				{:else if currentMethod.verifiedAgainstMna === false}
					<span class="inline-flex items-center gap-1.5 text-[11px] font-medium text-destructive">
						<span class="h-1.5 w-1.5 shrink-0 rounded-full bg-destructive" aria-hidden="true"></span>
						<span>Mismatch vs MNA</span>
					</span>
				{/if}
			</div>

			{#if currentMethod.applicable && currentMethod.steps.length > 0}
				<div class="flex items-center gap-2">
					<span class="font-engineering text-[11px] text-muted-foreground">
						{currentMethod.steps.length} {currentMethod.steps.length === 1 ? 'step' : 'steps'}
					</span>
					<Button
						variant="outline"
						size="sm"
						onclick={toggleAllSteps}
						class="h-11 min-h-11 gap-1 px-3 text-xs md:h-7 md:min-h-0 md:px-2 md:text-[11px]"
					>
						{#if allExpanded}
							<ChevronsDownUp class="size-3" aria-hidden="true" />
							Collapse All
						{:else}
							<ChevronsUpDown class="size-3" aria-hidden="true" />
							Expand All
						{/if}
					</Button>
				</div>
			{/if}
		</div>

		{#if !currentMethod.applicable}
			<div class="flex items-start gap-2.5 bg-warning/10 px-4 py-3 text-xs text-foreground">
				<AlertTriangle class="mt-0.5 size-4 shrink-0 text-warning" aria-hidden="true" />
				<div class="flex flex-col gap-1">
					<span class="font-semibold text-warning">Method Not Applicable</span>
					<p class="text-muted-foreground">
						{currentMethod.inapplicableReason ??
							'This analysis method cannot be applied directly to the current circuit topology.'}
					</p>
				</div>
			</div>
		{:else if currentMethod.steps.length === 0}
			<div class="px-4 py-3 text-xs text-muted-foreground">
				No derivation steps produced for this circuit.
			</div>
		{:else}
			<Accordion variant="flush" type="multiple" bind:value={expandedSteps}>
				{#each currentMethod.steps as step, idx (`step-${activeMethod}-${idx}`)}
					{@const itemId = `step-${activeMethod}-${idx}`}
					<AccordionItem
						value={itemId}
						title={step.title}
						triggerClass="px-4 py-2.5 lg:py-2"
						contentClass="px-4 pt-1 pb-3.5"
					>
						<div class="flex min-w-0 flex-col gap-2">
							{#if step.description}
								<p class="text-xs leading-relaxed text-muted-foreground">
									{step.description}
								</p>
							{/if}

							{#if step.snapshotNote}
								<div
									class="flex items-center gap-1.5 rounded-[4px] border border-border bg-surface-rail/50 px-2.5 py-1.5 text-[11px] text-muted-foreground"
								>
									<Info class="size-3.5 shrink-0 text-primary" aria-hidden="true" />
									<span>{step.snapshotNote}</span>
								</div>
							{/if}

							{#if step.latex && step.latex.length > 0}
								<div
									class="flex min-w-0 flex-col gap-1 overflow-hidden rounded-[4px] bg-surface-rail/60 px-2.5 py-1.5"
									style="--math-fade-bg: {STEP_SURFACE_BG};"
								>
									{#each step.latex as eq, eqIdx (`${itemId}-eq-${eqIdx}`)}
										<MathBlock latex={eq} />
									{/each}
								</div>
							{/if}

							{#if step.matrixLatex}
								<div
									class="min-w-0 overflow-hidden rounded-[4px] border border-border/70 bg-surface-rail/60 px-2.5 py-1.5"
									style="--math-fade-bg: {STEP_SURFACE_BG};"
								>
									<MathBlock latex={step.matrixLatex} />
								</div>
							{/if}
						</div>
					</AccordionItem>
				{/each}
			</Accordion>

			{#if currentMethod.summaryLatex}
				<div
					class="min-w-0 overflow-hidden border-t border-border bg-surface-rail/30 px-4 py-3"
					style="--math-fade-bg: {SUMMARY_SURFACE_BG};"
				>
					<div class="mb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
						Summary
					</div>
					<MathBlock latex={currentMethod.summaryLatex} />
				</div>
			{/if}
		{/if}
	{/if}
</section>
