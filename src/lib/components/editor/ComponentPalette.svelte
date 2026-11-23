<script lang="ts">
	import { MousePointer2, Search } from 'lucide-svelte';
	import { CircuitSymbol, PALETTE_ITEMS, type PaletteItem, type SourceMode } from '$lib/components/symbols';
	import { Accordion, AccordionItem, Input } from '$lib/components/ui';
	import type { ComponentKind } from '$lib/engine';
	import { AC_ENABLED } from '$lib/env';
	import { circuit, type EditorTool } from '$lib/stores/circuit.svelte';
	import { cn } from '$lib/utils';

	interface Props {
		variant?: 'rail' | 'sheet';
		onSelectTool?: () => void;
		class?: string;
	}

	let { variant = 'rail', onSelectTool, class: className }: Props = $props();

	const isSheet = $derived(variant === 'sheet');

	let searchQuery = $state('');
	let openGroups = $state<string[]>(['sources', 'dependent', 'passives', 'connections']);

	const filteredItems = $derived.by(() => {
		const q = searchQuery.trim().toLowerCase();
		if (!q) return PALETTE_ITEMS;
		return PALETTE_ITEMS.filter(
			(item) =>
				item.label.toLowerCase().includes(q) ||
				item.name.toLowerCase().includes(q) ||
				item.description.toLowerCase().includes(q) ||
				item.shortcut.toLowerCase().includes(q) ||
				item.category.toLowerCase().includes(q)
		);
	});

	const sourcesList = $derived(filteredItems.filter((i) => i.category === 'sources'));
	const dependentList = $derived(filteredItems.filter((i) => i.category === 'dependent'));
	const passivesList = $derived(filteredItems.filter((i) => i.category === 'passives'));
	const connectionsList = $derived(filteredItems.filter((i) => i.category === 'connections'));

	const showSelectTool = $derived.by(() => {
		const q = searchQuery.trim().toLowerCase();
		if (!q) return true;
		return 'select'.includes(q) || 'pointer'.includes(q) || 'esc'.includes(q);
	});

	function isItemActive(item: PaletteItem): boolean {
		if (item.kind === 'wire' || item.kind === 'probe') {
			return circuit.activeTool === item.kind;
		}
		if (item.kind === 'voltage_source' || item.kind === 'current_source') {
			return (
				circuit.activeTool === item.kind &&
				(item.sourceMode ?? 'dc') === circuit.activeSourceMode
			);
		}
		return circuit.activeTool === item.kind;
	}

	function handleSelectMoveTool() {
		circuit.setActiveTool('select');
		onSelectTool?.();
	}

	function isItemDisabled(item: PaletteItem): boolean {
		return !AC_ENABLED && item.sourceMode === 'ac';
	}

	function handleSelectPaletteItem(item: PaletteItem) {
		if (isItemDisabled(item)) return;
		if (item.kind === 'wire') {
			circuit.setActiveTool('wire');
		} else if (item.kind === 'probe') {
			circuit.setActiveTool('probe');
		} else {
			circuit.setActiveTool(
				item.kind as ComponentKind,
				item.sourceMode as SourceMode | undefined
			);
		}
		onSelectTool?.();
	}

	const activeToolLabel = $derived.by(() => {
		const tool: EditorTool = circuit.activeTool;
		if (tool === 'select') return 'Select / Move';
		if (tool === 'wire') return 'Orthogonal Wire';
		if (tool === 'probe') return 'Node Voltage Probe';
		if (tool === 'voltage_source') {
			return circuit.activeSourceMode === 'ac' ? 'AC Voltage Source' : 'DC Voltage Source';
		}
		return PALETTE_ITEMS.find((i) => i.kind === tool)?.name ?? tool;
	});

	const accordionTriggerClass = $derived(
		isSheet
			? 'min-h-11 px-3 py-2.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground hover:text-foreground'
			: 'px-3 py-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground hover:text-foreground lg:py-2'
	);

	const accordionContentClass = $derived(isSheet ? 'px-2 pt-0.5 pb-2.5' : 'px-2 pt-0.5 pb-2');
</script>

<aside
	aria-label="Component palette"
	class={cn(
		isSheet
			? 'flex w-full flex-col border-r-0 bg-card'
			: 'flex w-56 shrink-0 flex-col border-r border-border bg-surface-rail',
		className
	)}
>
	<!-- Header & Filter -->
	{#if isSheet}
		<div class="sticky top-0 z-10 border-b border-border bg-card p-3">
			<div class="relative">
				<Search
					class="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
					aria-hidden="true"
				/>
				<Input
					type="search"
					placeholder="Filter parts..."
					bind:value={searchQuery}
					aria-label="Filter components"
					class="h-11 pl-9 text-base sm:text-base"
				/>
			</div>
		</div>
	{:else}
		<div class="flex flex-col gap-2 border-b border-border px-3 py-2.5">
			<span class="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
				Component Palette
			</span>
			<div class="relative">
				<Search
					class="pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-muted-foreground"
					aria-hidden="true"
				/>
				<Input
					type="search"
					placeholder="Filter parts or key..."
					bind:value={searchQuery}
					aria-label="Filter components"
					class="h-7 pl-7 text-xs sm:h-7 sm:text-xs"
				/>
			</div>
		</div>
	{/if}

	<!-- Tool & Component List -->
	<div class={isSheet ? 'pb-4' : 'flex-1 overflow-y-auto'}>
		{#if showSelectTool}
			<div class={cn('border-b border-border', isSheet ? 'p-2' : 'px-2 py-1.5')}>
				<button
					type="button"
					onclick={handleSelectMoveTool}
					class={cn(
						'flex w-full cursor-pointer items-center justify-between gap-2 rounded-[4px] border text-left transition-colors duration-150',
						isSheet ? 'min-h-11 px-3 py-2 text-sm' : 'px-2 py-1.5 text-xs',
						'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
						circuit.activeTool === 'select'
							? 'border-primary/45 bg-card font-medium text-foreground'
							: 'border-transparent text-foreground/90 hover:bg-accent/70 hover:text-foreground'
					)}
				>
					<span class={cn('flex min-w-0 items-center', isSheet ? 'gap-2.5' : 'gap-2')}>
						<MousePointer2
							class={cn(
								'size-3.5 shrink-0',
								circuit.activeTool === 'select' ? 'text-primary' : 'text-foreground'
							)}
							aria-hidden="true"
						/>
						<span class="truncate">Select / Move</span>
					</span>
					{#if !isSheet}
						<span class="font-engineering shrink-0 text-[10px] text-muted-foreground/80">
							Esc
						</span>
					{/if}
				</button>
			</div>
		{/if}

		<Accordion variant="flush" type="multiple" bind:value={openGroups}>
			{#if sourcesList.length > 0}
				<AccordionItem
					value="sources"
					title="Sources"
					triggerClass={accordionTriggerClass}
					contentClass={accordionContentClass}
				>
					<div class="flex flex-col gap-0.5">
						{#each sourcesList as item (item.id)}
							{@const disabled = isItemDisabled(item)}
							{@const active = !disabled && isItemActive(item)}
							<button
								type="button"
								{disabled}
								aria-disabled={disabled ? 'true' : undefined}
								title={disabled ? 'AC Phasor Analysis — Coming Soon' : item.description}
								onclick={() => handleSelectPaletteItem(item)}
								class={cn(
									'flex w-full items-center justify-between rounded-[4px] border text-left transition-colors duration-150',
									isSheet ? 'min-h-11 gap-2 px-3 py-2 text-sm' : 'gap-1.5 px-2 py-1.5 text-xs',
									'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
									disabled
										? 'cursor-not-allowed border-transparent text-muted-foreground opacity-60'
										: active
											? 'cursor-pointer border-primary/45 bg-card font-medium text-foreground'
											: 'cursor-pointer border-transparent text-foreground/90 hover:bg-accent/70 hover:text-foreground'
								)}
							>
								<span class={cn('flex min-w-0 items-center', isSheet ? 'gap-2.5' : 'gap-1.5')}>
									<CircuitSymbol
										kind={item.kind}
										variant="icon"
										sourceMode={item.sourceMode ?? 'dc'}
										size={isSheet ? 22 : 18}
										class={cn(
											'shrink-0',
											disabled
												? 'text-muted-foreground'
												: active
													? 'text-primary'
													: 'text-foreground'
										)}
									/>
									<span class="truncate">{item.name}</span>
								</span>
								{#if disabled}
									<span class="font-engineering shrink-0 rounded-[3px] border border-border px-1 py-0.5 text-[9px] uppercase text-muted-foreground">
										Soon
									</span>
								{:else if !isSheet}
									<span class="font-engineering shrink-0 text-[10px] text-muted-foreground/80">
										{item.shortcut}
									</span>
								{/if}
							</button>
						{/each}
					</div>
				</AccordionItem>
			{/if}

			{#if dependentList.length > 0}
				<AccordionItem
					value="dependent"
					title="Dependent Sources"
					triggerClass={accordionTriggerClass}
					contentClass={accordionContentClass}
				>
					<div class="flex flex-col gap-0.5">
						{#each dependentList as item (item.id)}
							{@const active = isItemActive(item)}
							<button
								type="button"
								title={item.description}
								onclick={() => handleSelectPaletteItem(item)}
								class={cn(
									'flex w-full cursor-pointer items-center justify-between rounded-[4px] border text-left transition-colors duration-150',
									isSheet ? 'min-h-11 gap-2 px-3 py-2 text-sm' : 'gap-1.5 px-2 py-1.5 text-xs',
									'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
									active
										? 'border-primary/45 bg-card font-medium text-foreground'
										: 'border-transparent text-foreground/90 hover:bg-accent/70 hover:text-foreground'
								)}
							>
								<span class={cn('flex min-w-0 items-center', isSheet ? 'gap-2.5' : 'gap-1.5')}>
									<CircuitSymbol
										kind={item.kind}
										variant="icon"
										size={isSheet ? 22 : 18}
										class={cn('shrink-0', active ? 'text-primary' : 'text-foreground')}
									/>
									<span class="truncate">{item.name}</span>
								</span>
								{#if !isSheet && item.shortcut}
									<span class="font-engineering shrink-0 text-[10px] text-muted-foreground/80">
										{item.shortcut}
									</span>
								{/if}
							</button>
						{/each}
					</div>
				</AccordionItem>
			{/if}

			{#if passivesList.length > 0}
				<AccordionItem
					value="passives"
					title="Passives"
					triggerClass={accordionTriggerClass}
					contentClass={accordionContentClass}
				>
					<div class="flex flex-col gap-0.5">
						{#each passivesList as item (item.id)}
							{@const active = isItemActive(item)}
							<button
								type="button"
								title={item.description}
								onclick={() => handleSelectPaletteItem(item)}
								class={cn(
									'flex w-full cursor-pointer items-center justify-between rounded-[4px] border text-left transition-colors duration-150',
									isSheet ? 'min-h-11 gap-2 px-3 py-2 text-sm' : 'gap-1.5 px-2 py-1.5 text-xs',
									'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
									active
										? 'border-primary/45 bg-card font-medium text-foreground'
										: 'border-transparent text-foreground/90 hover:bg-accent/70 hover:text-foreground'
								)}
							>
								<span class={cn('flex min-w-0 items-center', isSheet ? 'gap-2.5' : 'gap-1.5')}>
									<CircuitSymbol
										kind={item.kind}
										variant="icon"
										size={isSheet ? 22 : 18}
										class={cn('shrink-0', active ? 'text-primary' : 'text-foreground')}
									/>
									<span class="truncate">{item.name}</span>
								</span>
								{#if !isSheet}
									<span class="font-engineering shrink-0 text-[10px] text-muted-foreground/80">
										{item.shortcut}
									</span>
								{/if}
							</button>
						{/each}
					</div>
				</AccordionItem>
			{/if}

			{#if connectionsList.length > 0}
				<AccordionItem
					value="connections"
					title="Wiring & Probes"
					triggerClass={accordionTriggerClass}
					contentClass={accordionContentClass}
				>
					<div class="flex flex-col gap-0.5">
						{#each connectionsList as item (item.id)}
							{@const active = isItemActive(item)}
							<button
								type="button"
								title={item.description}
								onclick={() => handleSelectPaletteItem(item)}
								class={cn(
									'flex w-full cursor-pointer items-center justify-between rounded-[4px] border text-left transition-colors duration-150',
									isSheet ? 'min-h-11 gap-2 px-3 py-2 text-sm' : 'gap-1.5 px-2 py-1.5 text-xs',
									'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
									active
										? 'border-primary/45 bg-card font-medium text-foreground'
										: 'border-transparent text-foreground/90 hover:bg-accent/70 hover:text-foreground'
								)}
							>
								<span class={cn('flex min-w-0 items-center', isSheet ? 'gap-2.5' : 'gap-1.5')}>
									<CircuitSymbol
										kind={item.kind}
										variant="icon"
										size={isSheet ? 22 : 18}
										terminalLabel={item.kind === 'terminal' ? 'A' : undefined}
										class={cn('shrink-0', active ? 'text-primary' : 'text-foreground')}
									/>
									<span class="truncate">{item.name}</span>
								</span>
								{#if !isSheet}
									<span class="font-engineering shrink-0 text-[10px] text-muted-foreground/80">
										{item.shortcut}
									</span>
								{/if}
							</button>
						{/each}
					</div>
				</AccordionItem>
			{/if}
		</Accordion>

		{#if !showSelectTool && filteredItems.length === 0}
			<p class="px-3 py-4 text-center text-xs text-muted-foreground">
				No parts matching "{searchQuery}"
			</p>
		{/if}
	</div>

	<!-- Docked Bottom Footer (h-8 aligned with canvas status bar) -->
	{#if !isSheet}
		<div class="flex h-8 shrink-0 items-center justify-between gap-2 border-t border-border px-3 text-[11px] text-muted-foreground">
			<span class="truncate font-medium text-foreground">{activeToolLabel}</span>
			<span
				class="font-engineering shrink-0 text-[10px] text-muted-foreground/80"
				title="R / ]: Rotate · Del: Remove · Esc: Select"
			>
				R: Rotate
			</span>
		</div>
	{/if}
</aside>
