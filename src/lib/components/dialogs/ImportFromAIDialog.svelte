<script lang="ts">
	import {
		AlertCircle,
		AlertTriangle,
		ArrowRight,
		Check,
		CheckCircle2,
		ChevronDown,
		Copy,
		FlaskConical,
		Sparkles
	} from 'lucide-svelte';
	import { Button, Dialog } from '$lib/components/ui';
	import { AI_CIRCUIT_IMPORT_PROMPT, parseCircuitImport } from '$lib/engine/io';
	import type { CircuitDocument, ConstraintKind } from '$lib/engine/types';
	import { UNIT_SYSTEMS } from '$lib/engine/units';
	import { formatUnknownTermExpr, getUnknownTerms } from '$lib/engine/unknown-solver';
	import { AC_ENABLED } from '$lib/env';
	import { cn } from '$lib/utils';

	type Props = {
		open?: boolean;
		onImportDocument: (doc: CircuitDocument) => void;
	};

	const CONSTRAINT_KIND_LABELS: Record<ConstraintKind, string> = {
		node_voltage: 'V',
		branch_voltage: 'V',
		branch_current: 'I',
		branch_power: 'P'
	};

	const SAMPLE_AI_NETLIST = JSON.stringify(
		{
			schemaVersion: 1,
			name: 'AI Imported Bridge Divider',
			mode: 'dc',
			unitSystem: 'kohm-v-ma',
			elements: [
				{
					id: 'V1',
					kind: 'voltage_source',
					label: 'V1',
					from: 'N1',
					to: '0',
					fromPos: [0, 0],
					toPos: [0, 1],
					value: '18'
				},
				{
					id: 'R1',
					kind: 'resistor',
					label: 'R1',
					from: 'N1',
					to: 'N2',
					fromPos: [0, 0],
					toPos: [1, 0],
					value: '3k'
				},
				{
					id: 'R2',
					kind: 'resistor',
					label: 'R2',
					from: 'N2',
					to: '0',
					fromPos: [1, 0],
					toPos: [1, 1],
					value: '6k'
				},
				{
					id: 'R3',
					kind: 'resistor',
					label: 'R3',
					from: 'N2',
					to: 'N3',
					fromPos: [1, 0],
					toPos: [2, 0],
					value: '2k'
				},
				{
					id: 'R4',
					kind: 'resistor',
					label: 'R4',
					from: 'N3',
					to: '0',
					fromPos: [2, 0],
					toPos: [2, 1],
					value: '4k'
				}
			]
		},
		null,
		2
	);

	let { open = $bindable(false), onImportDocument }: Props = $props();

	let promptExpanded = $state(false);
	let promptCopied = $state(false);
	let aiOutputText = $state('');

	const parseResult = $derived(
		aiOutputText.trim() === '' ? null : parseCircuitImport(aiOutputText)
	);
	const isBlockedAcImport = $derived(
		!AC_ENABLED && Boolean(parseResult?.ok && parseResult.document.mode === 'ac')
	);

	async function copyPrompt() {
		try {
			await navigator.clipboard.writeText(AI_CIRCUIT_IMPORT_PROMPT);
			promptCopied = true;
			setTimeout(() => {
				promptCopied = false;
			}, 2000);
		} catch {
			// Ignore if clipboard API is unavailable
		}
	}

	function loadSampleNetlist() {
		aiOutputText = SAMPLE_AI_NETLIST;
	}

	function handleRenderAndSolve() {
		if (!parseResult || !parseResult.ok || isBlockedAcImport) return;
		onImportDocument(parseResult.document);
		aiOutputText = '';
		open = false;
	}
</script>

<Dialog
	bind:open
	title="Import Circuit from AI"
	description="Convert any textbook schematic or photo into an editable Circuit Lab schematic with layout preservation."
	class="sm:max-w-2xl"
>
	<div class="flex flex-col divide-y divide-border">
		<!-- Step 01 — Copy Prompt -->
		<section class="py-3.5 first:pt-0">
			<div class="flex flex-wrap items-center justify-between gap-2">
				<div class="flex items-center gap-2">
					<span class="font-engineering text-[11px] font-semibold text-muted-foreground">01</span>
					<h3 class="text-xs font-semibold text-foreground">Copy the AI Netlist Prompt</h3>
				</div>

				<div class="flex flex-wrap items-center gap-2">
					<button
						type="button"
						onclick={() => (promptExpanded = !promptExpanded)}
						aria-expanded={promptExpanded}
						class="inline-flex min-h-11 cursor-pointer items-center gap-1 rounded-[4px] px-2.5 py-1 text-xs font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:min-h-0 sm:px-2 sm:text-[11px]"
					>
						{promptExpanded ? 'Hide Prompt' : 'Preview Prompt'}
						<ChevronDown
							class={cn(
								'size-3.5 transition-transform duration-150',
								promptExpanded && 'rotate-180'
							)}
							aria-hidden="true"
						/>
					</button>
					<Button variant="default" size="sm" onclick={copyPrompt} class="min-h-11 sm:min-h-0">
						{#if promptCopied}
							<Check class="size-3.5" aria-hidden="true" />
							Copied!
						{:else}
							<Copy class="size-3.5" aria-hidden="true" />
							Copy AI Prompt
						{/if}
					</Button>
				</div>
			</div>

			{#if promptExpanded}
				<pre
					class="font-engineering mt-2.5 max-h-48 overflow-y-auto whitespace-pre-wrap rounded-[4px] border border-border bg-surface-rail/60 p-2.5 text-[11px] leading-relaxed text-muted-foreground"
				>{AI_CIRCUIT_IMPORT_PROMPT}</pre>
			{/if}
		</section>

		<!-- Step 02 — Ask Any AI -->
		<section class="py-3.5">
			<div class="flex items-start gap-2">
				<span class="font-engineering mt-0.5 shrink-0 text-[11px] font-semibold text-muted-foreground">
					02
				</span>
				<Sparkles class="mt-0.5 size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
				<p class="text-xs leading-relaxed text-foreground">
					Attach your circuit photo or textbook screenshot along with this prompt in ChatGPT,
					Claude, or Gemini.
				</p>
			</div>
		</section>

		<!-- Step 03 — Paste AI JSON & Render -->
		<section class="flex flex-col gap-2.5 py-3.5 last:pb-0">
			<div class="flex flex-wrap items-center justify-between gap-2">
				<div class="flex items-center gap-2">
					<span class="font-engineering text-[11px] font-semibold text-muted-foreground">03</span>
					<h3 class="text-xs font-semibold text-foreground">Paste AI JSON &amp; Render</h3>
				</div>

				<Button variant="outline" size="sm" onclick={loadSampleNetlist} class="min-h-11 sm:min-h-0">
					<FlaskConical class="size-3.5" aria-hidden="true" />
					Try Sample AI Netlist
				</Button>
			</div>

			<p class="text-[11px] text-muted-foreground">
				Paste the raw AI response below — markdown code fences and surrounding commentary are
				stripped automatically.
			</p>

			<textarea
				bind:value={aiOutputText}
				aria-label="Paste AI JSON output"
				placeholder={'```json\n{\n  "schemaVersion": 1,\n  "name": "My Circuit",\n  "mode": "dc",\n  "elements": [...]\n}\n```'}
				rows={8}
				class="font-engineering w-full resize-y rounded-[4px] border border-input bg-background p-3 text-base leading-relaxed text-foreground placeholder:text-muted-foreground/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:text-xs"
			></textarea>

			{#if parseResult}
				{#if parseResult.ok}
					{#if isBlockedAcImport}
						<div
							role="alert"
							class="flex flex-col gap-1 rounded-[4px] border border-warning/40 bg-warning/10 px-3 py-2 text-xs text-warning"
						>
							<div class="flex items-center gap-1.5 font-semibold">
								<AlertTriangle class="size-4 shrink-0" aria-hidden="true" />
								AC Phasor Analysis — Coming Soon
							</div>
							<p class="pl-5.5 text-[11px] leading-relaxed text-foreground">
								AC steady-state circuits are coming soon in Production. Open this circuit on Staging
								or change mode to DC.
							</p>
						</div>
					{:else}
						{@const elementCount = parseResult.document.components.filter(
							(c) => c.kind !== 'ground' && c.kind !== 'terminal'
						).length}
						{@const detectedUnitSystem = parseResult.document.unitSystem}
						{@const detectedUnknown = parseResult.document.unknownProblem}
						<div
							class="flex flex-col gap-1.5 rounded-[4px] border border-success/40 bg-success/10 px-3 py-2 text-xs"
						>
							<div class="flex flex-wrap items-center gap-x-2 gap-y-0.5 font-semibold text-success">
								<CheckCircle2 class="size-4 shrink-0" aria-hidden="true" />
								<span>
									{#if parseResult.sourceFormat === 'ai-netlist'}
										{parseResult.layoutMode === 'visual-grid'
											? 'AI Netlist → Exact Visual Layout'
											: 'AI Netlist → Auto-Layout'}
									{:else}
										Circuit Document
									{/if}
								</span>
								<span class="font-engineering text-[11px]">
									· {elementCount} elements ({parseResult.document.mode.toUpperCase()})
								</span>
							</div>
							{#if detectedUnitSystem || detectedUnknown}
								<div class="flex flex-wrap items-center gap-x-3 gap-y-1 pl-6 font-engineering text-[11px] text-foreground/85">
									{#if detectedUnitSystem}
										<span>Units: {UNIT_SYSTEMS[detectedUnitSystem].shortLabel}</span>
									{/if}
									{#if detectedUnknown}
										{@const sym = detectedUnknown.symbol || detectedUnknown.componentId}
										{@const detectedTerms = getUnknownTerms(detectedUnknown)}
										{@const termsSummary =
											detectedTerms.length >= 2
												? detectedTerms
														.map((t) => {
															const compLabel =
																parseResult.document.components.find(
																	(c) => c.id === t.componentId
																)?.label ?? t.componentId;
															return `${compLabel} = ${formatUnknownTermExpr(t.multiplier, sym)}`;
														})
														.join(', ')
												: ''}
										{@const cLabel =
											detectedUnknown.constraint.label ||
											`${CONSTRAINT_KIND_LABELS[detectedUnknown.constraint.kind]}(${detectedUnknown.constraint.targetId})`}
										<span>
											{#if termsSummary}
												Unknown: Find {sym} ({termsSummary}; given {cLabel} = {detectedUnknown.constraint.value})
											{:else}
												Unknown: Find {sym} (given {cLabel} = {detectedUnknown.constraint.value})
											{/if}
										</span>
									{/if}
								</div>
							{/if}
							{#if parseResult.warnings.length > 0}
								<ul class="list-disc pl-5 text-[11px] text-muted-foreground">
									{#each parseResult.warnings as warning, idx (idx)}
										<li>{warning}</li>
									{/each}
								</ul>
							{/if}
						</div>
					{/if}
				{:else}
					<div
						role="alert"
						class="flex flex-col gap-1 rounded-[4px] border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive"
					>
						<div class="flex items-center gap-1.5 font-semibold">
							<AlertCircle class="size-4 shrink-0" aria-hidden="true" />
							Could not parse circuit JSON
						</div>
						<ul class="list-disc pl-5 text-[11px]">
							{#each parseResult.errors as err, idx (idx)}
								<li>{err}</li>
							{/each}
						</ul>
					</div>
				{/if}
			{/if}
		</section>
	</div>

	{#snippet footer()}
		<Button variant="outline" size="sm" onclick={() => (open = false)} class="min-h-11 sm:min-h-0">
			Cancel
		</Button>
		<Button
			variant="default"
			size="sm"
			disabled={!parseResult?.ok || isBlockedAcImport}
			onclick={handleRenderAndSolve}
			class="min-h-11 sm:min-h-0"
		>
			Render &amp; Solve Circuit
			<ArrowRight class="size-3.5" aria-hidden="true" />
		</Button>
	{/snippet}
</Dialog>
