<script lang="ts">
	import { formatComponentDisplayValue } from '$lib/components/editor/helpers';
	import { Badge, Select } from '$lib/components/ui';
	import {
		isDependentSourceKind,
		type BranchResult,
		type CircuitComponent,
		type CircuitDocument,
		type FullSolveResult,
		type NodeResult
	} from '$lib/engine/types';
	import { settings } from '$lib/stores/settings.svelte';
	import { cn } from '$lib/utils';
	import {
		formatApparentPower,
		formatComplexParts,
		formatFrequency,
		formatPowerFactor,
		formatReactivePower,
		formatRealPower
	} from './formatters';

	type BranchFilter = 'all' | 'sources' | 'loads';

	type Props = {
		solution: FullSolveResult;
		document: CircuitDocument;
		selectedComponentId?: string | null;
		onSelectComponent?: (id: string) => void;
		onSelectTheveninComponent?: (id: string) => void;
		class?: string;
	};

	let {
		solution,
		document,
		selectedComponentId = null,
		onSelectComponent,
		onSelectTheveninComponent,
		class: className
	}: Props = $props();

	let branchFilter = $state<BranchFilter>('all');
	let highlightedNodeId = $state<string | null>(null);

	const mna = $derived(solution.mna);
	const isAc = $derived(mna.mode === 'ac');
	const formatOpts = $derived({
		angleDisplay: settings.angleDisplay,
		precision: settings.precision,
		showDcFractions: settings.showDcFractions,
		unitSystem: settings.unitSystem
	});

	const componentById = $derived.by(() => {
		const map = new Map<string, CircuitComponent>();
		for (const c of document.components) {
			map.set(c.id, c);
		}
		return map;
	});

	const sortedNodes = $derived.by<NodeResult[]>(() => {
		const nodes = Object.values(mna.nodeVoltages);
		return nodes.sort((a, b) => {
			if (a.isReference) return -1;
			if (b.isReference) return 1;
			return a.nodeId.localeCompare(b.nodeId, undefined, { numeric: true });
		});
	});

	const nonGroundNodes = $derived(sortedNodes.filter((n) => !n.isReference));

	const voltmeterBranches = $derived.by<BranchResult[]>(() => {
		return Object.values(mna.branches)
			.filter((b) => b.kind === 'voltmeter')
			.sort((a, b) => a.label.localeCompare(b.label, undefined, { numeric: true }));
	});

	const activeBranches = $derived.by<BranchResult[]>(() => {
		return Object.values(mna.branches)
			.filter((b) => b.kind !== 'voltmeter')
			.sort((a, b) => a.label.localeCompare(b.label, undefined, { numeric: true }));
	});

	function isSourceBranch(branch: BranchResult): boolean {
		return (
			branch.kind === 'voltage_source' ||
			branch.kind === 'current_source' ||
			isDependentSourceKind(branch.kind)
		);
	}

	const sourceCount = $derived(activeBranches.filter(isSourceBranch).length);
	const loadCount = $derived(activeBranches.length - sourceCount);
	const showBranchFilters = $derived(sourceCount > 0 && loadCount > 0);

	const filteredBranches = $derived.by<BranchResult[]>(() => {
		if (!showBranchFilters || branchFilter === 'all') return activeBranches;
		if (branchFilter === 'sources') return activeBranches.filter(isSourceBranch);
		return activeBranches.filter((b) => !isSourceBranch(b));
	});

	// AC overall load reactive power, apparent power, and power factor
	const acPowerMetrics = $derived.by(() => {
		const pAbs = mna.powerBalance.totalAbsorbedReal;
		const pSup = mna.powerBalance.totalSuppliedReal;
		let qLoad = 0;
		for (const b of activeBranches) {
			if (!isSourceBranch(b)) {
				qLoad += b.reactivePower;
			}
		}
		const sApp = Math.hypot(pAbs, qLoad);
		const pf = sApp > 1e-12 ? Math.min(1, Math.max(0, pAbs / sApp)) : null;
		const pfType: 'lagging' | 'leading' | 'unity' =
			Math.abs(qLoad) < 1e-12 ? 'unity' : qLoad > 0 ? 'lagging' : 'leading';
		return {
			pAbs,
			pSup,
			qLoad,
			sApp,
			pf,
			pfType
		};
	});

	const passiveOptions = $derived(
		document.components
			.filter((c) => c.kind === 'resistor' || c.kind === 'capacitor' || c.kind === 'inductor')
			.map((c) => ({ value: c.id, label: `${c.label} (${c.value})` }))
	);

	const theveninLoadLabel = $derived.by(() => {
		const tn = solution.theveninNorton;
		if (!tn) return '';
		if (tn.loadComponentId) {
			const comp = document.components.find((c) => c.id === tn.loadComponentId);
			return comp
				? `Across ${comp.label} (${tn.terminalA} – ${tn.terminalB})`
				: `Port ${tn.terminalA} – ${tn.terminalB}`;
		}
		return `Terminals ${tn.terminalA} – ${tn.terminalB}`;
	});

	function getComponentValueDisplay(branch: BranchResult): string | null {
		const comp = componentById.get(branch.componentId);
		if (!comp) return null;
		const text = formatComponentDisplayValue(
			comp,
			mna.mode,
			settings.unitSystem,
			document.components
		);
		return text || null;
	}

	function formatNodePinsShort(node: NodeResult): string {
		if (node.componentPins.length === 0) return '—';
		const seen = new Set<string>();
		const labels: string[] = [];
		for (const p of node.componentPins) {
			const lbl = componentById.get(p.componentId)?.label ?? p.componentId;
			if (!seen.has(lbl)) {
				seen.add(lbl);
				labels.push(lbl);
			}
		}
		return labels.join(', ');
	}

	function handleNodeCardClick(node: NodeResult) {
		highlightedNodeId = highlightedNodeId === node.nodeId ? null : node.nodeId;
		const firstCompId = node.componentPins[0]?.componentId;
		if (firstCompId) {
			onSelectComponent?.(firstCompId);
		}
	}
</script>

<div class={cn('flex min-w-0 flex-col divide-y divide-border', className)}>
	<!-- Status & Telemetry Strip -->
	<div
		class="flex min-w-0 flex-wrap items-center justify-between gap-x-3 gap-y-1 bg-surface-rail/60 px-4 py-2 text-[11px]"
	>
		<div class="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-0.5">
			<span class="font-engineering font-semibold text-foreground">
				{#if isAc}
					AC · {formatFrequency(mna.frequencyHz)} · {(mna.acMagnitudeMode ?? 'rms').toUpperCase()}
				{:else}
					DC Steady-State
				{/if}
			</span>
			<span class="font-engineering whitespace-nowrap text-muted-foreground">
				· {sortedNodes.length} {sortedNodes.length === 1 ? 'node' : 'nodes'} · {activeBranches.length} {activeBranches.length === 1 ? 'branch' : 'branches'}
			</span>
		</div>

		<div class="font-engineering flex flex-wrap items-center gap-x-2 gap-y-0.5 whitespace-nowrap">
			{#if solution.allVerified}
				<span
					class="inline-flex items-center gap-1.5 text-muted-foreground"
					title="All applicable methods verified against MNA"
				>
					<span class="h-1.5 w-1.5 shrink-0 rounded-full bg-branch-current" aria-hidden="true"></span>
					<span>Verified</span>
				</span>
			{:else}
				<span class="inline-flex items-center gap-1.5 font-medium text-warning">
					<span class="h-1.5 w-1.5 shrink-0 rounded-full bg-warning" aria-hidden="true"></span>
					<span>Δ = {solution.maxDiscrepancy.toExponential(2)}</span>
				</span>
			{/if}
		</div>
	</div>

	<!-- 1. Power Summary & Balance KPI Strip -->
	<section aria-label="Power Summary and Balance" class="px-4 py-3.5">
		<div class="mb-2.5 flex flex-wrap items-center justify-between gap-2">
			<h3 class="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
				Power Summary
			</h3>
			{#if mna.powerBalance.balanced}
				<span
					class="inline-flex items-center gap-1.5 rounded-[4px] border border-branch-current/35 bg-branch-current/10 px-2 py-0.5 font-engineering text-[11px] font-medium text-branch-current"
				>
					<span class="h-1.5 w-1.5 shrink-0 rounded-full bg-branch-current" aria-hidden="true"></span>
					<span>ΣP = 0 · Balanced</span>
				</span>
			{:else}
				<span
					class="inline-flex items-center gap-1.5 rounded-[4px] border border-warning/40 bg-warning/10 px-2 py-0.5 font-engineering text-[11px] font-medium text-warning"
				>
					<span class="h-1.5 w-1.5 shrink-0 rounded-full bg-warning" aria-hidden="true"></span>
					<span>ΣP = {formatRealPower(mna.powerBalance.totalRealPower, formatOpts)}</span>
				</span>
			{/if}
		</div>

		{#if isAc}
			<div class="grid grid-cols-2 gap-2">
				<div class="rounded-[4px] border border-border bg-surface-rail/40 px-3 py-2">
					<div class="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
						Real Power (P)
					</div>
					<div class="mt-0.5 font-engineering text-sm font-semibold tabular-nums text-foreground">
						{formatRealPower(acPowerMetrics.pAbs, formatOpts)}
					</div>
					<div class="mt-0.5 font-engineering text-[10px] text-branch-current">
						Supplied {formatRealPower(acPowerMetrics.pSup, formatOpts)}
					</div>
				</div>

				<div class="rounded-[4px] border border-border bg-surface-rail/40 px-3 py-2">
					<div class="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
						Reactive Power (Q)
					</div>
					<div class="mt-0.5 font-engineering text-sm font-semibold tabular-nums text-foreground">
						{formatReactivePower(acPowerMetrics.qLoad, formatOpts)}
					</div>
					<div class="mt-0.5 text-[10px] text-muted-foreground">
						{Math.abs(acPowerMetrics.qLoad) < 1e-12
							? 'Purely resistive'
							: acPowerMetrics.qLoad > 0
								? 'Net inductive'
								: 'Net capacitive'}
					</div>
				</div>

				<div class="rounded-[4px] border border-border bg-surface-rail/40 px-3 py-2">
					<div class="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
						Apparent Power (|S|)
					</div>
					<div class="mt-0.5 font-engineering text-sm font-semibold tabular-nums text-foreground">
						{formatApparentPower(acPowerMetrics.sApp, formatOpts)}
					</div>
				</div>

				<div class="rounded-[4px] border border-border bg-surface-rail/40 px-3 py-2">
					<div class="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
						Power Factor (cos θ)
					</div>
					<div class="mt-0.5 font-engineering text-sm font-semibold tabular-nums text-voltage">
						{formatPowerFactor(acPowerMetrics.pf, acPowerMetrics.pfType)}
					</div>
				</div>
			</div>
		{:else}
			<div class="grid grid-cols-2 gap-2">
				<div class="rounded-[4px] border border-border bg-surface-rail/40 px-3 py-2">
					<div class="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
						Total Supplied
					</div>
					<div class="mt-0.5 font-engineering text-sm font-semibold tabular-nums text-branch-current">
						{formatRealPower(mna.powerBalance.totalSuppliedReal, formatOpts)}
					</div>
				</div>

				<div class="rounded-[4px] border border-border bg-surface-rail/40 px-3 py-2">
					<div class="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
						Total Absorbed
					</div>
					<div class="mt-0.5 font-engineering text-sm font-semibold tabular-nums text-foreground">
						{formatRealPower(mna.powerBalance.totalAbsorbedReal, formatOpts)}
					</div>
				</div>
			</div>
		{/if}
	</section>

	<!-- 2. Voltmeter Readings -->
	{#if voltmeterBranches.length > 0}
		<section aria-label="Voltmeter Readings" class="px-4 py-3.5">
			<div class="mb-2.5 flex flex-wrap items-baseline justify-between gap-x-2 gap-y-0.5">
				<h3 class="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
					Voltmeter Readings
				</h3>
				<span class="text-[11px] text-muted-foreground">
					V<sub>+</sub> − V<sub>−</sub> · Ideal probe
				</span>
			</div>

			<div class="grid grid-cols-1 gap-2 sm:grid-cols-2">
				{#each voltmeterBranches as vm (vm.componentId)}
					{@const vParts = formatComplexParts(vm.voltage, 'V', mna.mode, formatOpts)}
					{@const isSelected = selectedComponentId === vm.componentId}
					<button
						type="button"
						data-selected={isSelected ? 'true' : undefined}
						onclick={() => onSelectComponent?.(vm.componentId)}
						class={cn(
							'flex min-h-11 w-full flex-col justify-between gap-1 rounded-[4px] border px-3 py-2.5 text-left transition-colors duration-150',
							'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
							onSelectComponent && 'cursor-pointer',
							isSelected
								? 'border-voltage/60 bg-voltage/10'
								: 'border-voltage/30 bg-voltage/5 hover:bg-voltage/10'
						)}
					>
						<div class="flex items-baseline justify-between gap-2">
							<span class="font-engineering text-xs font-semibold text-foreground">
								{vm.label}
							</span>
							<span class="font-engineering text-[10px] text-muted-foreground">
								{vm.nodeA === '0' ? 'GND' : vm.nodeA} (+) → {vm.nodeB === '0' ? 'GND' : vm.nodeB} (−)
							</span>
						</div>
						<div class="font-engineering text-sm font-semibold tabular-nums text-voltage">
							{vParts.primary}
						</div>
						{#if vParts.secondary}
							<div class="font-engineering text-[11px] tabular-nums text-muted-foreground">
								{vParts.secondary}
							</div>
						{/if}
					</button>
				{/each}
			</div>
		</section>
	{/if}

	<!-- 3. Node Voltages Card Grid -->
	<section aria-label="Final Node Voltages" class="px-4 py-3.5">
		<div class="mb-2.5 flex flex-wrap items-center justify-between gap-2">
			<h3 class="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
				Node Voltages
			</h3>
			<span class="inline-flex items-center gap-1 font-engineering text-[10px] text-muted-foreground">
				<Badge variant="secondary" class="px-1.5 py-0 text-[10px]">GND = 0 V</Badge>
			</span>
		</div>

		{#if nonGroundNodes.length === 0}
			<div class="rounded-[4px] border border-border bg-surface-rail/40 px-3 py-2.5 text-xs text-muted-foreground">
				Only reference ground node (0 V) present.
			</div>
		{:else}
			<div class="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-2 xl:grid-cols-3">
				{#each nonGroundNodes as node (node.nodeId)}
					{@const vParts = formatComplexParts(node.voltage, 'V', mna.mode, formatOpts)}
					{@const pinsShort = formatNodePinsShort(node)}
					{@const isHighlighted = highlightedNodeId === node.nodeId}
					<button
						type="button"
						aria-pressed={isHighlighted}
						onclick={() => handleNodeCardClick(node)}
						class={cn(
							'flex min-h-11 flex-col justify-between gap-0.5 rounded-[4px] border px-2.5 py-2 text-left transition-colors duration-150',
							'cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
							isHighlighted
								? 'border-voltage/60 bg-voltage/10'
								: 'border-border bg-card hover:bg-accent/40'
						)}
					>
						<div class="flex items-baseline justify-between gap-1">
							<span class="font-engineering text-xs font-semibold text-foreground">
								V<sub>{node.nodeId}</sub>
							</span>
							<span class="truncate font-engineering text-[10px] text-muted-foreground">
								{pinsShort}
							</span>
						</div>
						<div class="mt-0.5 font-engineering text-xs font-semibold tabular-nums text-voltage break-words">
							{vParts.primary}
						</div>
						{#if vParts.secondary}
							<div class="font-engineering text-[10px] tabular-nums text-muted-foreground break-words">
								{vParts.secondary}
							</div>
						{/if}
					</button>
				{/each}
			</div>
		{/if}
	</section>

	<!-- 4. Branch Voltages, Currents, Impedances & Power -->
	<section aria-label="Final Branch Currents, Voltages, and Power" class="py-3.5">
		<div class="mb-2.5 flex flex-wrap items-center justify-between gap-2 px-4">
			<div>
				<h3 class="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
					Branch Quantities
				</h3>
				<p class="mt-0.5 text-[11px] text-muted-foreground">
					Passive sign (+ absorbed, − supplied)
				</p>
			</div>

			{#if showBranchFilters}
				<div
					role="radiogroup"
					aria-label="Filter branch components"
					class="inline-flex items-center rounded-[4px] border border-border bg-muted/80 p-0.5"
				>
					<button
						type="button"
						role="radio"
						aria-checked={branchFilter === 'all'}
						onclick={() => (branchFilter = 'all')}
						class={cn(
							'inline-flex min-h-11 cursor-pointer items-center justify-center rounded-[3px] border px-2.5 text-xs transition-colors duration-150 sm:min-h-0 sm:h-6 sm:px-2 sm:text-[11px]',
							'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring',
							branchFilter === 'all'
								? 'border-border/80 bg-card font-semibold text-foreground shadow-2xs'
								: 'border-transparent font-medium text-muted-foreground hover:text-foreground'
						)}
					>
						All
					</button>
					<button
						type="button"
						role="radio"
						aria-checked={branchFilter === 'sources'}
						onclick={() => (branchFilter = 'sources')}
						class={cn(
							'inline-flex min-h-11 cursor-pointer items-center justify-center rounded-[3px] border px-2.5 text-xs transition-colors duration-150 sm:min-h-0 sm:h-6 sm:px-2 sm:text-[11px]',
							'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring',
							branchFilter === 'sources'
								? 'border-border/80 bg-card font-semibold text-foreground shadow-2xs'
								: 'border-transparent font-medium text-muted-foreground hover:text-foreground'
						)}
					>
						Sources
					</button>
					<button
						type="button"
						role="radio"
						aria-checked={branchFilter === 'loads'}
						onclick={() => (branchFilter = 'loads')}
						class={cn(
							'inline-flex min-h-11 cursor-pointer items-center justify-center rounded-[3px] border px-2.5 text-xs transition-colors duration-150 sm:min-h-0 sm:h-6 sm:px-2 sm:text-[11px]',
							'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring',
							branchFilter === 'loads'
								? 'border-border/80 bg-card font-semibold text-foreground shadow-2xs'
								: 'border-transparent font-medium text-muted-foreground hover:text-foreground'
						)}
					>
						Loads
					</button>
				</div>
			{/if}
		</div>

		<!-- Unified Compact Branch Result Cards (All Widths: 360px Mobile & 420px Desktop Rail) -->
		<div class="flex flex-col gap-2 px-4">
			{#each filteredBranches as branch (branch.componentId)}
				{@const vParts = formatComplexParts(branch.voltage, 'V', mna.mode, formatOpts)}
				{@const iParts = formatComplexParts(branch.current, 'A', mna.mode, formatOpts)}
				{@const zParts =
					isAc && branch.impedance
						? formatComplexParts(branch.impedance, 'Ω', 'ac', formatOpts)
						: null}
				{@const valDisplay = getComponentValueDisplay(branch)}
				{@const isSupplied = branch.realPower < -1e-12}
				{@const isZeroPower = Math.abs(branch.realPower) < 1e-12}
				{@const isSelected = selectedComponentId === branch.componentId}
				<button
					type="button"
					data-selected={isSelected ? 'true' : undefined}
					aria-pressed={onSelectComponent ? isSelected : undefined}
					onclick={() => onSelectComponent?.(branch.componentId)}
					class={cn(
						'min-h-11 w-full rounded-[4px] border px-3 py-2.5 text-left transition-colors duration-150',
						'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
						onSelectComponent && 'cursor-pointer',
						isSelected
							? 'border-primary/60 bg-primary/8'
							: 'border-border bg-card hover:bg-accent/30'
					)}
				>
					<!-- Card Header: Label + Value + Nodes + AC Impedance Z chip (left); Abs/Sup badge (right) -->
					<div class="flex items-start justify-between gap-2">
						<div class="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-1">
							<span class="font-engineering text-xs font-semibold text-foreground">
								{branch.label}
							</span>
							{#if valDisplay}
								<span class="font-engineering text-[11px] text-muted-foreground">
									{valDisplay}
								</span>
							{/if}
							<span class="font-engineering whitespace-nowrap text-[10px] text-muted-foreground/80">
								({branch.nodeA} → {branch.nodeB})
							</span>
							{#if zParts}
								<span
									title="Impedance"
									class="inline-flex max-w-full items-center gap-1 rounded-[3px] border border-border bg-surface-rail/70 px-1.5 py-0.5 font-engineering text-[10px] tabular-nums text-foreground"
								>
									<span class="text-muted-foreground">Z</span>
									<span class="truncate">{zParts.primary}</span>
								</span>
							{/if}
						</div>

						<span
							class={cn(
								'shrink-0 rounded-[3px] border px-1.5 py-0.5 text-[10px] font-medium',
								isZeroPower
									? 'border-border bg-surface-rail/60 text-muted-foreground'
									: isSupplied
										? 'border-branch-current/40 bg-branch-current/10 text-branch-current'
										: 'border-border bg-surface-rail/60 text-foreground'
							)}
						>
							{isZeroPower ? '0 W' : isSupplied ? 'Sup' : 'Abs'}
						</span>
					</div>

					<!-- 3-Column Metrics Grid: Voltage | Current | Power (+ Q & PF in AC mode) -->
					<div class="mt-2 grid grid-cols-3 gap-x-2.5 gap-y-1 border-t border-border/70 pt-2">
						<div class="min-w-0">
							<div class="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
								Voltage
							</div>
							<div class="mt-0.5 font-engineering text-[11px] font-semibold tabular-nums text-voltage break-words">
								{vParts.primary}
							</div>
							{#if vParts.secondary}
								<div class="font-engineering text-[10px] tabular-nums text-muted-foreground break-words">
									{vParts.secondary}
								</div>
							{/if}
						</div>

						<div class="min-w-0">
							<div class="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
								Current
							</div>
							<div class="mt-0.5 font-engineering text-[11px] font-semibold tabular-nums text-branch-current break-words">
								{iParts.primary}
							</div>
							{#if iParts.secondary}
								<div class="font-engineering text-[10px] tabular-nums text-muted-foreground break-words">
									{iParts.secondary}
								</div>
							{/if}
						</div>

						<div class="min-w-0">
							<div class="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
								Power
							</div>
							<div
								class={cn(
									'mt-0.5 font-engineering text-[11px] font-semibold tabular-nums break-words',
									isSupplied ? 'text-branch-current' : 'text-foreground'
								)}
							>
								{formatRealPower(branch.realPower, formatOpts)}
							</div>
							{#if isAc}
								<div class="font-engineering text-[10px] tabular-nums text-muted-foreground break-words">
									Q: {formatReactivePower(branch.reactivePower, formatOpts)}
								</div>
								<div class="font-engineering text-[10px] tabular-nums text-muted-foreground break-words">
									PF: {formatPowerFactor(branch.powerFactor, branch.powerFactorType)}
								</div>
							{/if}
						</div>
					</div>
				</button>
			{/each}
		</div>
	</section>

	<!-- 5. Thévenin & Norton Equivalent Compact Card (Final Numbers Only) -->
	{#if solution.theveninNorton}
		{@const tn = solution.theveninNorton}
		{@const vthParts = formatComplexParts(tn.vth, 'V', mna.mode, formatOpts)}
		{@const zthParts = tn.zth ? formatComplexParts(tn.zth, 'Ω', mna.mode, formatOpts) : null}
		{@const iscParts = tn.isc ? formatComplexParts(tn.isc, 'A', mna.mode, formatOpts) : null}
		<section aria-label="Thévenin and Norton Equivalent" class="px-4 py-3.5">
			<div class="flex flex-wrap items-center justify-between gap-2">
				<div class="min-w-0">
					<h3 class="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
						Thévenin &amp; Norton Equivalent
					</h3>
					<p class="mt-0.5 text-xs text-foreground">{theveninLoadLabel}</p>
				</div>
				{#if onSelectTheveninComponent && passiveOptions.length > 0}
					<div class="w-full sm:w-44">
						<Select
							aria-label="Select Thévenin load component"
							value={tn.loadComponentId ?? ''}
							options={passiveOptions}
							onchange={(e) => {
								const val = (e.currentTarget as HTMLSelectElement).value;
								if (val) onSelectTheveninComponent(val);
							}}
							class="min-h-11 text-base sm:min-h-0 sm:h-7 sm:text-xs"
						/>
					</div>
				{/if}
			</div>

			<div class="mt-2.5 grid grid-cols-1 gap-2 sm:grid-cols-3">
				<div class="rounded-[4px] border border-border bg-surface-rail/40 px-2.5 py-2">
					<div class="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
						V<sub>th</sub> (Open-Circuit)
					</div>
					<div class="mt-0.5 font-engineering text-xs font-semibold tabular-nums text-voltage break-words">
						{vthParts.primary}
					</div>
					{#if vthParts.secondary}
						<div class="font-engineering text-[10px] tabular-nums text-muted-foreground break-words">
							{vthParts.secondary}
						</div>
					{/if}
				</div>

				<div class="rounded-[4px] border border-border bg-surface-rail/40 px-2.5 py-2">
					<div class="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
						{#if isAc}Z<sub>th</sub> (Impedance){:else}R<sub>th</sub> (Resistance){/if}
					</div>
					<div class="mt-0.5 font-engineering text-xs font-semibold tabular-nums text-foreground break-words">
						{zthParts ? zthParts.primary : 'Open / Dependent'}
					</div>
					{#if zthParts?.secondary}
						<div class="font-engineering text-[10px] tabular-nums text-muted-foreground break-words">
							{zthParts.secondary}
						</div>
					{/if}
				</div>

				<div class="rounded-[4px] border border-border bg-surface-rail/40 px-2.5 py-2">
					<div class="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
						I<sub>N</sub> (Norton)
					</div>
					<div class="mt-0.5 font-engineering text-xs font-semibold tabular-nums text-branch-current break-words">
						{#if iscParts}
							{iscParts.primary}
						{:else}
							Undefined
						{/if}
					</div>
					{#if iscParts?.secondary}
						<div class="font-engineering text-[10px] tabular-nums text-muted-foreground break-words">
							{iscParts.secondary}
						</div>
					{/if}
				</div>
			</div>

			{#if tn.maxPowerTransfer}
				{@const zOptParts = formatComplexParts(
					tn.maxPowerTransfer.optimalLoadImpedance,
					'Ω',
					mna.mode,
					formatOpts
				)}
				<div class="mt-2.5 flex flex-wrap items-center justify-between gap-2 rounded-[4px] border border-border bg-surface-rail/30 px-2.5 py-1.5 text-xs">
					<span class="text-muted-foreground">Max Power Transfer</span>
					<div class="font-engineering flex flex-wrap items-center gap-x-2 gap-y-0.5 text-foreground">
						<span class="whitespace-nowrap">
							{#if isAc}Z<sub>L,opt</sub>{:else}R<sub>L,opt</sub>{/if} = {zOptParts.primary}
						</span>
						<span class="text-muted-foreground" aria-hidden="true">·</span>
						<span class="whitespace-nowrap font-semibold text-branch-current">
							P<sub>max</sub> = {formatRealPower(tn.maxPowerTransfer.maxRealPowerW, formatOpts)}
						</span>
					</div>
				</div>
			{/if}
		</section>
	{/if}
</div>
