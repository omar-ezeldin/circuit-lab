<script lang="ts">
	import { untrack } from 'svelte';
	import {
		AlertCircle,
		ArrowRight,
		Check,
		CheckCircle2,
		ChevronDown,
		Copy,
		FlaskConical,
		ScanLine
	} from 'lucide-svelte';
	import { Button, Dialog } from '$lib/components/ui';
	import {
		AI_MACHINES_IMPORT_PROMPT,
		getCategoryMeta,
		getQuestionTypeMeta,
		parseMachineAiImport,
		type MachineInputMap,
		type MachineQuestionTypeId
	} from '$lib/machines';
	import { cn } from '$lib/utils';

	export type MachineAiImportPayload = {
		questionTypeId: MachineQuestionTypeId;
		input: MachineInputMap[MachineQuestionTypeId];
		title?: string;
	};

	type Props = {
		open?: boolean;
		initialJson?: string;
		onImportMachine: (payload: MachineAiImportPayload) => void;
	};

	const SAMPLE_MACHINE_JSON = JSON.stringify(
		{
			type: 'transformer_oc_sc',
			title: '20 kVA 2000/200 V OC & SC Test Problem',
			input: {
				ratedVA: 20000,
				v1Rated: 2000,
				v2Rated: 200,
				frequencyHz: 50,
				ocSide: 'LV',
				vOc: 200,
				iOc: 4,
				pOc: 120,
				scSide: 'HV',
				vSc: 60,
				iSc: 10,
				pSc: 300,
				referTo: 'primary',
				evalLoadFraction: 1,
				evalPf: 0.8,
				evalPfType: 'lag'
			}
		},
		null,
		2
	);

	let { open = $bindable(false), initialJson = '', onImportMachine }: Props = $props();

	let promptExpanded = $state(false);
	let promptCopied = $state(false);
	let aiOutputText = $state(untrack(() => initialJson));

	const parseResult = $derived(
		aiOutputText.trim() === '' ? null : parseMachineAiImport(aiOutputText)
	);

	const previewMeta = $derived.by(() => {
		if (!parseResult || !parseResult.ok) return null;
		const qtMeta = getQuestionTypeMeta(parseResult.questionTypeId);
		const catMeta = getCategoryMeta(qtMeta.category);
		const highlighted = parseResult.previewResult.answers.filter((a) => a.highlight);
		const topAnswers = (
			highlighted.length >= 2 ? highlighted : parseResult.previewResult.answers
		).slice(0, 3);
		return {
			categoryLabel: catMeta.shortTitle,
			topicLabel: qtMeta.shortLabel,
			topAnswers
		};
	});

	async function copyPrompt() {
		try {
			await navigator.clipboard.writeText(AI_MACHINES_IMPORT_PROMPT);
			promptCopied = true;
			setTimeout(() => {
				promptCopied = false;
			}, 2000);
		} catch {
			// Ignore if clipboard API is unavailable
		}
	}

	function loadSampleProblem() {
		aiOutputText = SAMPLE_MACHINE_JSON;
	}

	function handleLoadAndSolve() {
		if (!parseResult || !parseResult.ok) return;
		onImportMachine({
			questionTypeId: parseResult.questionTypeId,
			input: parseResult.input,
			title: parseResult.title
		});
		aiOutputText = '';
		open = false;
	}
</script>

<Dialog
	bind:open
	title="Import Machines Problem from AI"
	description="Turn any Electrical Machines exam photo or textbook problem into a solved worksheet."
	class="sm:max-w-2xl"
>
	<div class="flex flex-col divide-y divide-border">
		<!-- Step 01 — Copy Prompt -->
		<section class="flex flex-col gap-2 py-3.5 first:pt-0">
			<div class="flex flex-wrap items-center justify-between gap-2">
				<div class="flex items-center gap-2">
					<span class="font-engineering text-[11px] font-semibold text-muted-foreground">01</span>
					<h3 class="text-xs font-semibold text-foreground">Copy Prompt &amp; Ask Any AI</h3>
				</div>

				<div class="flex flex-wrap items-center gap-2">
					<button
						type="button"
						onclick={() => (promptExpanded = !promptExpanded)}
						aria-expanded={promptExpanded}
						class="inline-flex min-h-11 cursor-pointer items-center gap-1 rounded-[4px] px-2.5 py-1 text-xs font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring lg:min-h-0 lg:px-2 lg:text-[11px]"
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
					<Button variant="default" size="sm" onclick={copyPrompt} class="min-h-11 lg:min-h-0">
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

			<div class="flex items-start gap-2 text-[11px] leading-relaxed text-muted-foreground">
				<ScanLine class="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
				<p>
					Paste the prompt with your exam photo or problem text in ChatGPT, Claude, or Gemini to
					extract structured parameters.
				</p>
			</div>

			{#if promptExpanded}
				<pre
					class="font-engineering mt-1 max-h-48 overflow-y-auto whitespace-pre-wrap rounded-[4px] border border-border bg-surface-rail/60 p-2.5 text-[11px] leading-relaxed text-muted-foreground"
				>{AI_MACHINES_IMPORT_PROMPT}</pre>
			{/if}
		</section>

		<!-- Step 02 — Paste AI JSON & Solve -->
		<section class="flex flex-col gap-2.5 py-3.5 last:pb-0">
			<div class="flex flex-wrap items-center justify-between gap-2">
				<div class="flex items-center gap-2">
					<span class="font-engineering text-[11px] font-semibold text-muted-foreground">02</span>
					<h3 class="text-xs font-semibold text-foreground">Paste AI JSON &amp; Validate</h3>
				</div>

				<Button variant="outline" size="sm" onclick={loadSampleProblem} class="min-h-11 lg:min-h-0">
					<FlaskConical class="size-3.5" aria-hidden="true" />
					Load Sample
				</Button>
			</div>

			<p class="text-[11px] text-muted-foreground">
				Paste the raw AI response below — markdown code fences and surrounding notes are stripped
				automatically.
			</p>

			<textarea
				bind:value={aiOutputText}
				aria-label="Paste AI machines JSON output"
				placeholder={'```json\n{\n  "type": "transformer_oc_sc",\n  "title": "20 kVA OC & SC Test",\n  "input": { ... }\n}\n```'}
				rows={8}
				class="font-engineering w-full resize-y rounded-[4px] border border-input bg-background p-3 text-base leading-relaxed text-foreground placeholder:text-muted-foreground/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring lg:text-xs"
			></textarea>

			{#if parseResult}
				{#if parseResult.ok && previewMeta}
					<div
						class="flex flex-col gap-2 rounded-[4px] border border-success/40 bg-success/10 px-3 py-2.5 text-xs"
					>
						<div class="flex flex-wrap items-center gap-x-2 gap-y-0.5 font-semibold text-success">
							<CheckCircle2 class="size-4 shrink-0" aria-hidden="true" />
							<span>{previewMeta.categoryLabel} · {previewMeta.topicLabel}</span>
						</div>

						{#if parseResult.title}
							<p class="pl-6 text-xs font-medium text-foreground">
								{parseResult.title}
							</p>
						{/if}

						{#if previewMeta.topAnswers.length > 0}
							<div class="grid grid-cols-1 gap-1.5 pl-6 sm:grid-cols-3">
								{#each previewMeta.topAnswers as ans (ans.key)}
									<div
										class="flex flex-col rounded-[4px] border border-border/70 bg-card/80 px-2 py-1"
									>
										<span class="truncate text-[10px] text-muted-foreground">{ans.label}</span>
										<span class="font-engineering text-xs font-semibold tabular-nums text-foreground">
											{ans.formatted}
										</span>
									</div>
								{/each}
							</div>
						{/if}

						{#if parseResult.warnings.length > 0}
							<ul class="list-disc pl-10 text-[11px] text-muted-foreground">
								{#each parseResult.warnings as warning, idx (idx)}
									<li>{warning}</li>
								{/each}
							</ul>
						{/if}
					</div>
				{:else if !parseResult.ok}
					<div
						role="alert"
						class="flex flex-col gap-1 rounded-[4px] border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive"
					>
						<div class="flex items-center gap-1.5 font-semibold">
							<AlertCircle class="size-4 shrink-0" aria-hidden="true" />
							Could not validate machines JSON
						</div>
						<p class="pl-5.5 text-[11px] leading-relaxed">{parseResult.error}</p>
					</div>
				{/if}
			{/if}
		</section>
	</div>

	{#snippet footer()}
		<Button variant="outline" size="sm" onclick={() => (open = false)} class="min-h-11 lg:min-h-0">
			Cancel
		</Button>
		<Button
			variant="default"
			size="sm"
			disabled={!parseResult?.ok}
			onclick={handleLoadAndSolve}
			class="min-h-11 lg:min-h-0"
		>
			Load &amp; Solve
			<ArrowRight class="size-3.5" aria-hidden="true" />
		</Button>
	{/snippet}
</Dialog>
