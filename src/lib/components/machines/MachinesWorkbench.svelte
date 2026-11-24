<script lang="ts">
	import { untrack } from 'svelte';
	import { Calculator, Check, ChevronDown, FileText, ListFilter, Search, X } from 'lucide-svelte';
	import { Badge, Sheet } from '$lib/components/ui';
	import {
		MACHINE_CATEGORIES,
		MACHINE_QUESTION_TYPES,
		getCategoryMeta,
		getQuestionTypeMeta,
		getQuestionTypesByCategory,
		solveMachineQuestion,
		type MachineCategory,
		type MachineInputMap,
		type MachineQuestionTypeId
	} from '$lib/machines';
	import { cn } from '$lib/utils';
	import MachineDiagram from './MachineDiagram.svelte';
	import MachineInputForm from './MachineInputForm.svelte';
	import MachineSolutionPanel from './MachineSolutionPanel.svelte';

	type Props = {
		initialQuestionTypeId?: MachineQuestionTypeId;
		class?: string;
	};

	let { initialQuestionTypeId = 'QT-XFMR-2', class: className }: Props = $props();

	function cloneInput<T>(value: T): T {
		return structuredClone(value);
	}

	const startId = untrack(() => initialQuestionTypeId);
	const initialMeta = getQuestionTypeMeta(startId);
	const initialPreset = initialMeta.presets[0];

	let selectedCategory = $state<MachineCategory>(initialMeta.category);
	let selectedTypeId = $state<MachineQuestionTypeId>(startId);
	let activePresetId = $state<string | null>(initialPreset?.id ?? null);
	let inputState = $state<MachineInputMap[MachineQuestionTypeId]>(
		cloneInput(initialPreset.input)
	);
	let searchQuery = $state('');
	let mobilePane = $state<'inputs' | 'solution'>('inputs');
	let topicsSheetOpen = $state(false);

	const activeMeta = $derived(getQuestionTypeMeta(selectedTypeId));
	const activeCategoryMeta = $derived(getCategoryMeta(selectedCategory));

	const filteredCategories = $derived.by(() => {
		const q = searchQuery.trim().toLowerCase();
		if (!q) {
			return MACHINE_CATEGORIES.map((cat) => ({
				category: cat,
				items: getQuestionTypesByCategory(cat.id)
			}));
		}
		return MACHINE_CATEGORIES.map((cat) => ({
			category: cat,
			items: getQuestionTypesByCategory(cat.id).filter(
				(item) =>
					item.title.toLowerCase().includes(q) ||
					item.shortLabel.toLowerCase().includes(q) ||
					cat.title.toLowerCase().includes(q) ||
					cat.shortTitle.toLowerCase().includes(q) ||
					cat.chapterLabel.toLowerCase().includes(q)
			)
		})).filter((group) => group.items.length > 0);
	});

	const solveResult = $derived(
		solveMachineQuestion(
			selectedTypeId,
			inputState as never
		)
	);

	function selectQuestionType(typeId: MachineQuestionTypeId) {
		const meta = MACHINE_QUESTION_TYPES[typeId];
		selectedTypeId = typeId;
		selectedCategory = meta.category;
		const firstPreset = meta.presets[0];
		if (firstPreset) {
			activePresetId = firstPreset.id;
			inputState = cloneInput(firstPreset.input);
		}
	}

	function handleSelectPreset(presetId: string) {
		const preset = activeMeta.presets.find((p) => p.id === presetId);
		if (!preset) return;
		activePresetId = preset.id;
		inputState = cloneInput(preset.input);
	}

	function handleResetPreset() {
		const preset =
			activeMeta.presets.find((p) => p.id === activePresetId) ?? activeMeta.presets[0];
		if (!preset) return;
		activePresetId = preset.id;
		inputState = cloneInput(preset.input);
	}

	function handleInputChange(next: MachineInputMap[MachineQuestionTypeId]) {
		inputState = next;
	}

	export function applyImportedProblem(
		questionTypeId: MachineQuestionTypeId,
		input: MachineInputMap[MachineQuestionTypeId]
	) {
		const meta = MACHINE_QUESTION_TYPES[questionTypeId];
		selectedCategory = meta.category;
		selectedTypeId = questionTypeId;
		activePresetId = null;
		inputState = cloneInput(input);
		topicsSheetOpen = false;
		mobilePane = 'solution';
	}
</script>

<div
	class={cn(
		'relative flex min-h-0 w-full min-w-0 flex-1 flex-col overflow-hidden bg-background lg:flex-row',
		className
	)}
>
	<!-- Compact Single-Row Mobile & Tablet Topic Trigger (< lg, 48px height) -->
	<div class="flex h-12 shrink-0 items-center border-b border-border bg-surface-rail px-2.5 lg:hidden">
		<button
			type="button"
			aria-label="Choose electrical machines topic"
			aria-haspopup="dialog"
			aria-expanded={topicsSheetOpen}
			onclick={() => (topicsSheetOpen = true)}
			class="flex min-h-10 w-full min-w-0 cursor-pointer items-center justify-between gap-2 rounded-[4px] border border-border bg-card px-2.5 text-left transition-colors duration-150 hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
		>
			<div class="flex min-w-0 items-center gap-1.5">
				<span class="shrink-0 text-[11px] font-semibold uppercase tracking-wide text-primary">
					{activeCategoryMeta.shortTitle}
				</span>
				<span aria-hidden="true" class="shrink-0 text-muted-foreground/60">·</span>
				<span class="truncate text-xs font-semibold text-foreground">
					{activeMeta.shortLabel}
				</span>
				<span
					class="shrink-0 rounded-[3px] border border-warning/40 bg-warning/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-warning"
				>
					Beta
				</span>
			</div>
			<span class="inline-flex shrink-0 items-center gap-1 text-[11px] font-medium text-muted-foreground">
				<ListFilter class="size-3.5" aria-hidden="true" />
				<span>Topics</span>
				<ChevronDown class="size-3.5" aria-hidden="true" />
			</span>
		</button>
	</div>

	<!-- Left Topic Navigator (Desktop lg+) -->
	<aside
		aria-label="Electrical machines topics"
		class="relative hidden w-64 shrink-0 flex-col border-r border-border bg-surface-rail lg:flex xl:w-72"
	>
		<div class="border-b border-border p-2.5">
			<div class="relative flex items-center">
				<Search
					class="pointer-events-none absolute left-2.5 size-3.5 text-muted-foreground"
					aria-hidden="true"
				/>
				<input
					type="search"
					aria-label="Search machines topics"
					placeholder="Search machines topics..."
					value={searchQuery}
					oninput={(e) => (searchQuery = e.currentTarget.value)}
					class="min-h-8 w-full rounded-[4px] border border-input bg-card pr-7 pl-8 text-sm text-foreground placeholder:text-muted-foreground/70 focus-visible:border-ring focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30"
				/>
				{#if searchQuery}
					<button
						type="button"
						aria-label="Clear search"
						onclick={() => (searchQuery = '')}
						class="absolute right-1.5 inline-flex h-6 w-6 cursor-pointer items-center justify-center rounded-[3px] text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
					>
						<X class="size-3" aria-hidden="true" />
					</button>
				{/if}
			</div>
		</div>

		<nav aria-label="Machines topic catalog" class="flex-1 overflow-y-auto p-2">
			{#if filteredCategories.length === 0}
				<p class="px-2 py-4 text-center text-xs text-muted-foreground">
					No matching machine topics.
				</p>
			{:else}
				<div class="flex flex-col gap-3">
					{#each filteredCategories as group (group.category.id)}
						<div class="flex flex-col gap-1">
							<div class="flex items-center justify-between gap-2 px-2 py-0.5">
								<span class="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
									{group.category.shortTitle}
								</span>
								<span class="font-engineering text-[10px] text-muted-foreground/80">
									{group.category.chapterLabel}
								</span>
							</div>
							{#each group.items as qt (qt.id)}
								{@const active = selectedTypeId === qt.id}
								<button
									type="button"
									aria-current={active ? 'page' : undefined}
									onclick={() => selectQuestionType(qt.id)}
									class={cn(
										'flex w-full cursor-pointer items-center justify-between gap-2 rounded-[4px] border px-2.5 py-2 text-left transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
										active
											? 'border-primary/50 bg-card text-foreground'
											: 'border-transparent text-foreground/80 hover:bg-accent/70 hover:text-foreground'
									)}
								>
									<span class="truncate text-xs font-semibold leading-tight">
										{qt.shortLabel}
									</span>
									<span class="flex shrink-0 items-center gap-1.5">
										<span
											class="rounded-[3px] border border-warning/40 bg-warning/10 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-warning"
										>
											Beta
										</span>
										{#if active}
											<span
												class="h-1.5 w-1.5 shrink-0 rounded-full bg-primary"
												aria-hidden="true"
											></span>
										{/if}
									</span>
								</button>
							{/each}
						</div>
					{/each}
				</div>
			{/if}
		</nav>
	</aside>

	<!-- Center Schematic + Input Form -->
	<main
		class={cn(
			'relative min-h-0 min-w-0 flex-1 flex-col overflow-y-auto bg-background',
			mobilePane === 'inputs' ? 'flex' : 'hidden lg:flex'
		)}
	>
		<div class="mx-auto flex w-full max-w-3xl flex-col gap-3 p-3 sm:gap-4 sm:p-4 lg:p-5">
			<!-- Topic Header -->
			<div class="flex flex-col gap-1 border-b border-border pb-2.5 sm:pb-3">
				<div class="flex flex-wrap items-center gap-1.5">
					<Badge variant="outline" class="font-engineering text-[10px]">
						{activeCategoryMeta.chapterLabel}
					</Badge>
					<Badge variant="secondary" class="text-[10px]">
						{activeCategoryMeta.shortTitle}
					</Badge>
					<span
						class="rounded-[3px] border border-warning/40 bg-warning/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-warning"
					>
						Beta
					</span>
				</div>
				<h1 class="text-base font-semibold tracking-tight text-foreground sm:text-lg">
					{activeMeta.title}
				</h1>
				<p class="text-xs leading-relaxed text-muted-foreground">
					{activeMeta.description}
				</p>
			</div>

			<MachineDiagram category={selectedCategory} questionTypeId={selectedTypeId} />

			<MachineInputForm
				questionTypeId={selectedTypeId}
				meta={activeMeta}
				{inputState}
				{activePresetId}
				onSelectPreset={handleSelectPreset}
				onResetPreset={handleResetPreset}
				onChange={handleInputChange}
			/>
		</div>
	</main>

	<!-- Right Live Answers & KaTeX Derivation -->
	<aside
		aria-label="Machine solution panel"
		class={cn(
			'relative min-h-0 min-w-0 flex-1 flex-col overflow-y-auto bg-card lg:w-[420px] lg:flex-none lg:shrink-0 lg:border-l lg:border-border xl:w-[460px]',
			mobilePane === 'solution' ? 'flex' : 'hidden lg:flex'
		)}
	>
		<MachineSolutionPanel result={solveResult} meta={activeMeta} />
	</aside>

	<!-- Slim Mobile & Tablet Bottom Navigation Bar (< lg, 52px) -->
	<nav
		aria-label="Machines workspace navigation"
		class="flex shrink-0 border-t border-border bg-surface-rail pb-safe lg:hidden"
	>
		<button
			type="button"
			aria-current={mobilePane === 'inputs' ? 'page' : undefined}
			onclick={() => (mobilePane = 'inputs')}
			class={cn(
				'relative flex min-h-[52px] flex-1 cursor-pointer flex-col items-center justify-center gap-0.5 px-2 py-1.5 text-[11px] transition-colors duration-150',
				'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring',
				mobilePane === 'inputs'
					? 'font-semibold text-foreground'
					: 'font-medium text-muted-foreground hover:text-foreground'
			)}
		>
			{#if mobilePane === 'inputs'}
				<span
					class="absolute top-0 right-4 left-4 h-0.5 bg-primary"
					aria-hidden="true"
				></span>
			{/if}
			<FileText class="size-4" aria-hidden="true" />
			<span>Inputs</span>
		</button>

		<button
			type="button"
			aria-current={mobilePane === 'solution' ? 'page' : undefined}
			onclick={() => (mobilePane = 'solution')}
			class={cn(
				'relative flex min-h-[52px] flex-1 cursor-pointer flex-col items-center justify-center gap-0.5 px-2 py-1.5 text-[11px] transition-colors duration-150',
				'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring',
				mobilePane === 'solution'
					? 'font-semibold text-foreground'
					: 'font-medium text-muted-foreground hover:text-foreground'
			)}
		>
			{#if mobilePane === 'solution'}
				<span
					class="absolute top-0 right-4 left-4 h-0.5 bg-primary"
					aria-hidden="true"
				></span>
			{/if}
			<span class="relative inline-flex items-center justify-center">
				<Calculator class="size-4" aria-hidden="true" />
				<span
					class={cn(
						'absolute -top-0.5 -right-1.5 h-2 w-2 rounded-full ring-1 ring-surface-rail',
						solveResult.valid ? 'bg-branch-current' : 'bg-destructive'
					)}
					aria-hidden="true"
				></span>
			</span>
			<span>Solution</span>
		</button>
	</nav>
</div>

<!-- Mobile & Tablet Topics Picker Sheet -->
<Sheet
	bind:open={topicsSheetOpen}
	side="bottom"
	title="Electrical Machines Topics"
	description="Select a chapter and problem type."
>
	<div class="flex flex-col gap-3 p-3">
		<div class="relative flex items-center">
			<Search
				class="pointer-events-none absolute left-2.5 size-4 text-muted-foreground"
				aria-hidden="true"
			/>
			<input
				type="search"
				aria-label="Search machines topics"
				placeholder="Search machines topics..."
				value={searchQuery}
				oninput={(e) => (searchQuery = e.currentTarget.value)}
				class="min-h-11 w-full rounded-[4px] border border-input bg-card pr-8 pl-9 text-base text-foreground placeholder:text-muted-foreground/70 focus-visible:border-ring focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30"
			/>
			{#if searchQuery}
				<button
					type="button"
					aria-label="Clear search"
					onclick={() => (searchQuery = '')}
					class="absolute right-1.5 inline-flex h-8 w-8 cursor-pointer items-center justify-center rounded-[3px] text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
				>
					<X class="size-4" aria-hidden="true" />
				</button>
			{/if}
		</div>

		{#if filteredCategories.length === 0}
			<p class="px-2 py-6 text-center text-xs text-muted-foreground">
				No matching machine topics.
			</p>
		{:else}
			<div class="flex flex-col gap-3.5 pb-2">
				{#each filteredCategories as group (group.category.id)}
					<div class="flex flex-col gap-1">
						<div class="flex items-center justify-between gap-2 px-1.5 py-0.5">
							<span class="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
								{group.category.shortTitle}
							</span>
							<span class="font-engineering text-[11px] text-muted-foreground/80">
								{group.category.chapterLabel}
							</span>
						</div>
						<div class="flex flex-col gap-1">
							{#each group.items as qt (qt.id)}
								{@const active = selectedTypeId === qt.id}
								<button
									type="button"
									aria-current={active ? 'page' : undefined}
									onclick={() => {
										selectQuestionType(qt.id);
										topicsSheetOpen = false;
									}}
									class={cn(
										'flex min-h-11 w-full cursor-pointer items-center justify-between gap-2 rounded-[4px] border px-3 py-2 text-left transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
										active
											? 'border-primary/50 bg-primary/8 text-foreground'
											: 'border-border/70 bg-card text-foreground/85 hover:bg-accent/70 hover:text-foreground'
									)}
								>
									<span class="truncate text-sm font-medium leading-tight">
										{qt.shortLabel}
									</span>
									<span class="flex shrink-0 items-center gap-2">
										<span
											class="rounded-[3px] border border-warning/40 bg-warning/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-warning"
										>
											Beta
										</span>
										{#if active}
											<Check class="size-4 shrink-0 text-primary" aria-hidden="true" />
										{/if}
									</span>
								</button>
							{/each}
						</div>
					</div>
				{/each}
			</div>
		{/if}
	</div>
</Sheet>
