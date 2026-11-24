<script lang="ts">
	import { untrack } from 'svelte';
	import { Calculator, FileText, Search, X } from 'lucide-svelte';
	import { Badge } from '$lib/components/ui';
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

	const activeMeta = $derived(getQuestionTypeMeta(selectedTypeId));
	const activeCategoryMeta = $derived(getCategoryMeta(selectedCategory));
	const categoryQuestionTypes = $derived(getQuestionTypesByCategory(selectedCategory));

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
					item.id.toLowerCase().includes(q) ||
					item.title.toLowerCase().includes(q) ||
					item.shortLabel.toLowerCase().includes(q) ||
					cat.title.toLowerCase().includes(q) ||
					cat.shortTitle.toLowerCase().includes(q)
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

	function selectCategory(cat: MachineCategory) {
		selectedCategory = cat;
		const types = getQuestionTypesByCategory(cat);
		if (types.length > 0 && !types.some((t) => t.id === selectedTypeId)) {
			selectQuestionType(types[0].id);
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
</script>

<div class={cn('flex min-h-0 w-full min-w-0 flex-1 flex-col overflow-hidden bg-background lg:flex-row', className)}>
	<!-- Mobile & Tablet Compact Picker + Inputs/Solution Tabs (< lg) -->
	<div class="flex shrink-0 flex-col border-b border-border bg-surface-rail lg:hidden">
		<!-- Horizontal Category Pills -->
		<div
			role="tablist"
			aria-label="Electrical machines topics"
			class="no-scrollbar flex items-center gap-1.5 overflow-x-auto px-2.5 py-2 [-webkit-overflow-scrolling:touch]"
		>
			{#each MACHINE_CATEGORIES as cat (cat.id)}
				{@const active = selectedCategory === cat.id}
				<button
					type="button"
					role="tab"
					aria-selected={active}
					onclick={() => selectCategory(cat.id)}
					class={cn(
						'inline-flex min-h-11 shrink-0 cursor-pointer items-center gap-1.5 rounded-[4px] border px-3 text-xs transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
						active
							? 'border-primary/60 bg-primary/10 font-semibold text-foreground'
							: 'border-border bg-card font-medium text-muted-foreground hover:text-foreground'
					)}
				>
					<span>{cat.shortTitle}</span>
				</button>
			{/each}
		</div>

		<!-- Question Type Picker & Inputs/Solution Switcher -->
		<div class="flex flex-col gap-2 border-t border-border/70 px-2.5 py-2 sm:flex-row sm:items-center">
			<div class="min-w-0 flex-1">
				<label for="mobile-machine-qt-select" class="sr-only">Select question type</label>
				<select
					id="mobile-machine-qt-select"
					value={selectedTypeId}
					onchange={(e) => selectQuestionType(e.currentTarget.value as MachineQuestionTypeId)}
					class="min-h-11 w-full rounded-[4px] border border-input bg-card px-2.5 text-base font-medium text-foreground focus-visible:border-ring focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30"
				>
					{#each categoryQuestionTypes as qt (qt.id)}
						<option value={qt.id}>{qt.id}: {qt.shortLabel}</option>
					{/each}
				</select>
			</div>

			<div
				role="tablist"
				aria-label="Workbench view"
				class="grid shrink-0 grid-cols-2 gap-1 rounded-[4px] border border-border bg-muted/80 p-0.5 sm:w-52"
			>
				<button
					type="button"
					role="tab"
					aria-selected={mobilePane === 'inputs'}
					onclick={() => (mobilePane = 'inputs')}
					class={cn(
						'inline-flex min-h-11 cursor-pointer items-center justify-center gap-1.5 rounded-[3px] border px-3 text-xs transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
						mobilePane === 'inputs'
							? 'border-border/90 bg-card font-semibold text-foreground'
							: 'border-transparent font-medium text-muted-foreground hover:text-foreground'
					)}
				>
					<FileText class="size-3.5" aria-hidden="true" />
					<span>Inputs</span>
				</button>
				<button
					type="button"
					role="tab"
					aria-selected={mobilePane === 'solution'}
					onclick={() => (mobilePane = 'solution')}
					class={cn(
						'inline-flex min-h-11 cursor-pointer items-center justify-center gap-1.5 rounded-[3px] border px-3 text-xs transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
						mobilePane === 'solution'
							? 'border-border/90 bg-card font-semibold text-foreground'
							: 'border-transparent font-medium text-muted-foreground hover:text-foreground'
					)}
				>
					<Calculator class="size-3.5" aria-hidden="true" />
					<span>Solution</span>
					<span
						class={cn(
							'h-1.5 w-1.5 rounded-full',
							solveResult.valid ? 'bg-branch-current' : 'bg-destructive'
						)}
						aria-hidden="true"
					></span>
				</button>
			</div>
		</div>
	</div>

	<!-- Left Question-Type Navigator (Desktop lg+) -->
	<aside
		aria-label="Electrical machines question types"
		class="hidden w-64 shrink-0 flex-col border-r border-border bg-surface-rail lg:flex xl:w-72"
	>
		<div class="border-b border-border p-2.5">
			<div class="relative flex items-center">
				<Search
					class="pointer-events-none absolute left-2.5 size-3.5 text-muted-foreground"
					aria-hidden="true"
				/>
				<input
					type="search"
					aria-label="Filter machine question types"
					placeholder="Filter topics or QT code..."
					value={searchQuery}
					oninput={(e) => (searchQuery = e.currentTarget.value)}
					class="min-h-8 w-full rounded-[4px] border border-input bg-card pr-7 pl-8 text-sm text-foreground placeholder:text-muted-foreground/70 focus-visible:border-ring focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30"
				/>
				{#if searchQuery}
					<button
						type="button"
						aria-label="Clear filter"
						onclick={() => (searchQuery = '')}
						class="absolute right-1.5 inline-flex h-6 w-6 cursor-pointer items-center justify-center rounded-[3px] text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
					>
						<X class="size-3" aria-hidden="true" />
					</button>
				{/if}
			</div>
		</div>

		<nav aria-label="Question type catalog" class="flex-1 overflow-y-auto p-2">
			{#if filteredCategories.length === 0}
				<p class="px-2 py-4 text-center text-xs text-muted-foreground">
					No matching machine question types.
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
										'flex w-full cursor-pointer flex-col items-start gap-0.5 rounded-[4px] border px-2.5 py-2 text-left transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
										active
											? 'border-primary/50 bg-card text-foreground'
											: 'border-transparent text-foreground/80 hover:bg-accent/70 hover:text-foreground'
									)}
								>
									<div class="flex w-full items-center justify-between gap-1.5">
										<span class="truncate text-xs font-semibold leading-tight">
											{qt.shortLabel}
										</span>
										<span
											class={cn(
												'font-engineering shrink-0 rounded-[3px] px-1 py-0.5 text-[9px] font-medium',
												active
													? 'bg-primary/12 text-primary'
													: 'bg-muted text-muted-foreground'
											)}
										>
											{qt.id}
										</span>
									</div>
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
			'min-h-0 min-w-0 flex-1 flex-col overflow-y-auto bg-background',
			mobilePane === 'inputs' ? 'flex' : 'hidden lg:flex'
		)}
	>
		<div class="mx-auto flex w-full max-w-3xl flex-col gap-4 p-3 sm:p-4 lg:p-5">
			<!-- Question Type Header -->
			<div class="flex flex-col gap-1 border-b border-border pb-3">
				<div class="flex flex-wrap items-center gap-2">
					<Badge variant="outline" class="font-engineering text-[10px]">
						{activeCategoryMeta.chapterLabel}
					</Badge>
					<Badge variant="secondary" class="font-engineering text-[10px]">
						{activeMeta.id}
					</Badge>
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
			'min-h-0 min-w-0 flex-1 flex-col overflow-y-auto bg-card lg:w-[420px] lg:flex-none lg:shrink-0 lg:border-l lg:border-border xl:w-[460px]',
			mobilePane === 'solution' ? 'flex' : 'hidden lg:flex'
		)}
	>
		<MachineSolutionPanel result={solveResult} meta={activeMeta} />
	</aside>
</div>
