<script lang="ts">
	import { AlertTriangle, BookOpen, ChevronDown, Compass, XCircle } from 'lucide-svelte';
	import { MathBlock } from '$lib/components/results';
	import PhasorDiagram from '$lib/components/results/PhasorDiagram.svelte';
	import type {
		MachineAnswerGroup,
		MachineAnswerItem,
		MachineQuestionTypeMeta,
		MachineSolveResult
	} from '$lib/machines';
	import { cn } from '$lib/utils';

	type Props = {
		result: MachineSolveResult;
		meta: MachineQuestionTypeMeta;
		class?: string;
	};

	let { result, meta, class: className }: Props = $props();

	let phasorOpen = $state(true);
	let formulasOpen = $state(false);

	const GROUP_ORDER: Array<{ id: MachineAnswerGroup; title: string }> = [
		{ id: 'voltages', title: 'Voltages' },
		{ id: 'currents', title: 'Currents' },
		{ id: 'power', title: 'Power & Efficiency' },
		{ id: 'impedance', title: 'Impedances & Parameters' },
		{ id: 'mechanical', title: 'Mechanical & Torque' },
		{ id: 'magnetic', title: 'Magnetic Quantities' },
		{ id: 'general', title: 'General Quantities' }
	];

	const highlightedAnswers = $derived(result.answers.filter((a) => a.highlight));

	const groupedAnswers = $derived.by(() => {
		const buckets = new Map<MachineAnswerGroup, MachineAnswerItem[]>();
		for (const answer of result.answers) {
			const group: MachineAnswerGroup = answer.group ?? 'general';
			const list = buckets.get(group);
			if (list) {
				list.push(answer);
			} else {
				buckets.set(group, [answer]);
			}
		}
		return GROUP_ORDER.map((g) => ({
			id: g.id,
			title: g.title,
			items: buckets.get(g.id) ?? []
		})).filter((g) => g.items.length > 0);
	});

	function valueColorClass(group?: MachineAnswerGroup): string {
		if (group === 'voltages') return 'text-voltage';
		if (group === 'currents') return 'text-branch-current';
		return 'text-foreground';
	}

	function highlightAccentClass(group?: MachineAnswerGroup): string {
		if (group === 'voltages') return 'border-voltage/35 bg-voltage/5';
		if (group === 'currents') return 'border-branch-current/35 bg-branch-current/5';
		return 'border-border bg-surface-rail/45';
	}

	/**
	 * Splits multi-formula LaTeX strings joined at top-level by `, \quad`, `; \quad`, or `\qquad`
	 * into stacked lines so long multi-equation formulas fit cleanly on narrow phone viewports.
	 */
	function splitLatexLines(latex: string): string[] {
		const parts: string[] = [];
		let braceDepth = 0;
		let envDepth = 0;
		let start = 0;

		for (let i = 0; i < latex.length; i++) {
			const ch = latex[i];
			if (ch === '{') {
				braceDepth++;
			} else if (ch === '}') {
				braceDepth = Math.max(0, braceDepth - 1);
			} else if (ch === '\\') {
				if (latex.startsWith('\\begin{', i)) {
					envDepth++;
				} else if (latex.startsWith('\\end{', i)) {
					envDepth = Math.max(0, envDepth - 1);
				}
			}

			if (braceDepth === 0 && envDepth === 0) {
				const rest = latex.slice(i);
				const match = rest.match(/^(?:[,;]\s*\\quad\b|\\qquad\b)/);
				if (match) {
					const segment = latex.slice(start, i).trim();
					if (segment) parts.push(segment);
					i += match[0].length - 1;
					start = i + 1;
				}
			}
		}

		const tail = latex.slice(start).trim();
		if (tail) parts.push(tail);
		return parts.length > 0 ? parts : [latex];
	}
</script>

<section
	aria-label="Live results"
	class={cn('flex min-w-0 flex-col bg-card', className)}
>
	<!-- Header Strip (unified with Circuits FinalAnswersCard telemetry strip) -->
	<div
		class="flex flex-wrap items-center justify-between gap-2 border-b border-border bg-surface-rail/60 px-3 py-2 sm:px-4"
	>
		<div class="flex min-w-0 items-center gap-1.5">
			<h2 class="truncate text-xs font-semibold text-foreground">
				{meta.shortLabel}
			</h2>
			<span
				class="shrink-0 rounded-[3px] border border-warning/40 bg-warning/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-warning"
			>
				Beta
			</span>
		</div>

		{#if result.valid}
			<span
				class="inline-flex shrink-0 items-center gap-1.5 rounded-[4px] border border-branch-current/35 bg-branch-current/10 px-2 py-0.5 font-engineering text-[11px] font-medium text-branch-current"
			>
				<span class="h-1.5 w-1.5 shrink-0 rounded-full bg-branch-current" aria-hidden="true"></span>
				<span>Solved</span>
			</span>
		{:else}
			<span
				class="inline-flex shrink-0 items-center gap-1.5 rounded-[4px] border border-destructive/40 bg-destructive/10 px-2 py-0.5 font-engineering text-[11px] font-medium text-destructive"
			>
				<span class="h-1.5 w-1.5 shrink-0 rounded-full bg-destructive" aria-hidden="true"></span>
				<span>Invalid</span>
			</span>
		{/if}
	</div>

	{#if !result.valid}
		<!-- Validation Error State -->
		<div class="p-3 sm:p-4">
			<div
				role="alert"
				class="flex items-start gap-2.5 rounded-[4px] border border-destructive/40 bg-destructive/8 p-3 text-xs text-foreground"
			>
				<XCircle class="mt-0.5 size-4 shrink-0 text-destructive" aria-hidden="true" />
				<div class="min-w-0 space-y-1">
					<p class="font-semibold text-destructive">Invalid Parameter Combination</p>
					<p class="leading-relaxed text-foreground/90">
						{result.error ??
							'Check the input values and ensure all required parameters are positive and finite.'}
					</p>
				</div>
			</div>
		</div>
	{:else}
		<div class="flex min-w-0 flex-col divide-y divide-border">
			<!-- Optional Solver Warnings -->
			{#if result.warnings && result.warnings.length > 0}
				<div class="bg-warning/8 px-3 py-2.5 sm:px-4">
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

			<!-- 1. Primary Highlights KPI Strip -->
			{#if highlightedAnswers.length > 0}
				<section aria-label="Key Results Summary" class="px-3 py-3 sm:px-4 sm:py-3.5">
					<div class="mb-2.5 flex items-baseline justify-between gap-2">
						<h3 class="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
							Final Answers
						</h3>
						<span class="font-engineering text-[11px] text-muted-foreground">
							{result.answers.length} {result.answers.length === 1 ? 'quantity' : 'quantities'}
						</span>
					</div>

					<div class="grid grid-cols-1 gap-2 sm:grid-cols-2">
						{#each highlightedAnswers as answer (answer.key)}
							<div
								class={cn(
									'flex min-w-0 flex-col justify-between gap-1 rounded-[4px] border px-3 py-2',
									highlightAccentClass(answer.group)
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
											'font-engineering text-sm font-semibold tabular-nums tracking-tight break-words',
											valueColorClass(answer.group)
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
				</section>
			{/if}

			<!-- 2. Shared Phasor Diagram (3-Phase & On-Load Transformer) -->
			{#if result.phasors && result.phasors.length > 0}
				<section aria-label="Phasor Diagram" class="min-w-0">
					<button
						type="button"
						aria-expanded={phasorOpen}
						onclick={() => (phasorOpen = !phasorOpen)}
						class="flex min-h-11 w-full cursor-pointer items-center justify-between gap-2 px-3 py-2.5 text-left transition-colors duration-150 hover:bg-accent/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring sm:px-4 lg:min-h-9"
					>
						<span class="inline-flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wider text-foreground">
							<Compass class="size-3.5 text-voltage" aria-hidden="true" />
							<span>Phasor Diagram</span>
							<span class="font-engineering font-normal text-muted-foreground">
								({result.phasors.length})
							</span>
						</span>
						<ChevronDown
							class={cn(
								'size-4 text-muted-foreground transition-transform duration-150',
								phasorOpen && 'rotate-180'
							)}
							aria-hidden="true"
						/>
					</button>

					{#if phasorOpen}
						<div class="border-t border-border/60 px-3 py-3 sm:px-4">
							<PhasorDiagram customPhasors={result.phasors} />
						</div>
					{/if}
				</section>
			{/if}

			<!-- 3. Exhaustive Grouped Results Sections -->
			{#each groupedAnswers as group (group.id)}
				<section aria-label={group.title} class="px-3 py-3 sm:px-4 sm:py-3.5">
					<div class="mb-2 flex items-baseline justify-between gap-2">
						<h3 class="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
							{group.title}
						</h3>
						<span class="font-engineering text-[10px] text-muted-foreground">
							{group.items.length}
						</span>
					</div>

					<div class="grid grid-cols-1 gap-2 sm:grid-cols-2">
						{#each group.items as answer (answer.key)}
							<div
								class="flex min-w-0 flex-col justify-between gap-1 rounded-[4px] border border-border bg-surface-rail/35 px-3 py-2"
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
											'font-engineering text-xs font-semibold tabular-nums tracking-tight break-words sm:text-sm',
											valueColorClass(answer.group)
										)}
									>
										{answer.formatted}
									</span>
									{#if answer.unit && !answer.formatted.endsWith(answer.unit)}
										<span class="font-engineering shrink-0 text-[10px] text-muted-foreground">
											{answer.unit}
										</span>
									{/if}
								</div>
							</div>
						{/each}
					</div>
				</section>
			{/each}
		</div>
	{/if}

	<!-- Collapsible Key Formulas Reference -->
	<div class="border-t border-border bg-surface-rail/30">
		<button
			type="button"
			aria-expanded={formulasOpen}
			onclick={() => (formulasOpen = !formulasOpen)}
			class="flex min-h-11 w-full cursor-pointer items-center justify-between gap-2 px-3 py-2.5 text-left transition-colors duration-150 hover:bg-accent/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring sm:px-4 lg:min-h-9"
		>
			<span class="inline-flex items-center gap-2 text-xs font-semibold text-foreground">
				<BookOpen class="size-3.5 text-primary" aria-hidden="true" />
				<span>Key Formulas</span>
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
				class="space-y-2 border-t border-border bg-card px-3 py-3 sm:px-4"
				style="--math-fade-bg: var(--card);"
			>
				{#each meta.keyFormulasLatex as formula, idx (idx)}
					<div class="flex min-w-0 flex-col gap-0.5 rounded-[4px] border border-border/70 bg-surface-rail/40 px-2.5 py-1.5">
						{#each splitLatexLines(formula) as line, lineIdx (lineIdx)}
							<MathBlock latex={line} />
						{/each}
					</div>
				{/each}
			</div>
		{/if}
	</div>
</section>
