<script lang="ts">
	import { Plus, RotateCcw, Sparkles, Trash2 } from 'lucide-svelte';
	import type {
		BHPoint,
		DcEmfTorqueInput,
		DcGeneratorInput,
		DcMotorInput,
		InductionMotorBasicInput,
		InductionMotorEquivCircuitInput,
		InductionMotorPowerFlowInput,
		LinearMagneticInput,
		MachineInputMap,
		MachineQuestionTypeId,
		MachineQuestionTypeMeta,
		NonlinearMagneticInput,
		PowerFactorType,
		ThreePhaseConnection,
		ThreePhaseInput,
		TransformerEfficiencyInput,
		TransformerEmfCoreLossInput,
		TransformerOcScInput,
		TransformerOnLoadInput,
		VariableReluctanceInput
	} from '$lib/machines';
	import { cn } from '$lib/utils';

	type Props = {
		questionTypeId: MachineQuestionTypeId;
		meta: MachineQuestionTypeMeta;
		inputState: MachineInputMap[MachineQuestionTypeId];
		activePresetId: string | null;
		onSelectPreset: (presetId: string) => void;
		onResetPreset: () => void;
		onChange: (next: MachineInputMap[MachineQuestionTypeId]) => void;
		class?: string;
	};

	let {
		questionTypeId,
		meta,
		inputState,
		activePresetId,
		onSelectPreset,
		onResetPreset,
		onChange,
		class: className
	}: Props = $props();

	function patch(partial: Record<string, unknown>) {
		onChange({
			...(inputState as unknown as Record<string, unknown>),
			...partial
		} as unknown as MachineInputMap[MachineQuestionTypeId]);
	}

	function parseOptionalNumber(raw: string): number | undefined {
		const trimmed = String(raw ?? '').trim();
		if (trimmed === '') return undefined;
		const parsed = Number(trimmed);
		return Number.isFinite(parsed) ? parsed : undefined;
	}

	function parseRequiredNumber(raw: string): number {
		const trimmed = String(raw ?? '').trim();
		if (trimmed === '') return Number.NaN;
		const parsed = Number(trimmed);
		return Number.isFinite(parsed) ? parsed : Number.NaN;
	}

	function formatNumValue(val: number | undefined): string {
		if (val === undefined || !Number.isFinite(val)) return '';
		return String(val);
	}

	const PF_OPTIONS: Array<{ value: PowerFactorType; label: string }> = [
		{ value: 'lag', label: 'Lagging' },
		{ value: 'unity', label: 'Unity' },
		{ value: 'lead', label: 'Leading' }
	];

	const CONN_OPTIONS: Array<{ value: ThreePhaseConnection; label: string }> = [
		{ value: 'Y', label: 'Star (Y)' },
		{ value: 'D', label: 'Delta (Δ)' }
	];

	function updateBhPoint(index: number, field: 'H' | 'B', raw: string) {
		const state = inputState as NonlinearMagneticInput;
		const current = state.bhTable ? [...state.bhTable] : [];
		const nextVal = parseRequiredNumber(raw);
		if (!current[index]) return;
		current[index] = {
			...current[index],
			[field]: Number.isFinite(nextVal) ? nextVal : 0
		};
		patch({ bhTable: current });
	}

	function addBhPoint() {
		const state = inputState as NonlinearMagneticInput;
		const current: BHPoint[] = state.bhTable ? [...state.bhTable] : [];
		const last = current[current.length - 1];
		current.push({
			H: last ? Math.round(last.H + 500) : 1000,
			B: last ? Number((last.B + 0.05).toFixed(3)) : 1.0
		});
		patch({ bhTable: current });
	}

	function removeBhPoint(index: number) {
		const state = inputState as NonlinearMagneticInput;
		const current = state.bhTable ? state.bhTable.filter((_, i) => i !== index) : [];
		patch({ bhTable: current });
	}

	type TextSegment = { text: string; sub: boolean };

	function parseSubscriptSegments(input: string): TextSegment[] {
		const segments: TextSegment[] = [];
		const regex = /\{([^}]+)\}/g;
		let lastIndex = 0;
		let match: RegExpExecArray | null;
		while ((match = regex.exec(input)) !== null) {
			if (match.index > lastIndex) {
				segments.push({ text: input.slice(lastIndex, match.index), sub: false });
			}
			segments.push({ text: match[1], sub: true });
			lastIndex = regex.lastIndex;
		}
		if (lastIndex < input.length) {
			segments.push({ text: input.slice(lastIndex), sub: false });
		}
		return segments;
	}

	function stripSubBraces(input: string): string {
		return input.replace(/\{([^}]+)\}/g, '$1');
	}
</script>

{#snippet richText(text: string)}
	{#each parseSubscriptSegments(text) as seg, idx (idx)}{#if seg.sub}<sub
				class="text-[0.72em] leading-none">{seg.text}</sub
			>{:else}{seg.text}{/if}{/each}
{/snippet}

{#snippet numField(
	id: string,
	label: string,
	unit: string,
	value: number | undefined,
	onUpdate: (raw: string) => void,
	optional = false,
	placeholder = ''
)}
	<div class="flex min-w-0 flex-col gap-1">
		<label
			for={id}
			class="flex items-baseline justify-between gap-1 text-xs font-medium text-foreground"
		>
			<span class="truncate">{@render richText(label)}</span>
			{#if optional}
				<span class="shrink-0 text-[10px] font-normal text-muted-foreground">opt.</span>
			{/if}
		</label>
		<div class="relative flex items-center">
			<input
				{id}
				type="number"
				inputmode="decimal"
				step="any"
				placeholder={placeholder || (optional ? '—' : '0')}
				value={formatNumValue(value)}
				oninput={(e) => onUpdate(e.currentTarget.value)}
				class={cn(
					'font-engineering min-h-10 w-full rounded-[4px] border border-input bg-card px-2.5 text-base text-foreground transition-colors duration-150 placeholder:text-muted-foreground/60 hover:border-foreground/30 focus-visible:border-ring focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30 lg:min-h-8 lg:text-sm',
					unit ? 'pr-11' : 'pr-2.5'
				)}
			/>
			{#if unit}
				<span
					class="font-engineering pointer-events-none absolute right-2 text-[11px] text-muted-foreground"
				>
					{unit}
				</span>
			{/if}
		</div>
	</div>
{/snippet}

{#snippet segToggle(
	label: string,
	options: Array<{ value: string; label: string }>,
	currentValue: string,
	onSelect: (val: string) => void,
	spanClass = 'col-span-2 sm:col-span-1'
)}
	<div class={cn('flex min-w-0 flex-col gap-1', spanClass)}>
		<span class="text-xs font-medium text-foreground">{@render richText(label)}</span>
		<div
			role="radiogroup"
			aria-label={stripSubBraces(label)}
			class="grid gap-1 rounded-[4px] border border-border bg-muted/80 p-0.5"
			style="grid-template-columns: repeat({options.length}, minmax(0, 1fr));"
		>
			{#each options as opt (opt.value)}
				{@const active = currentValue === opt.value}
				<button
					type="button"
					role="radio"
					aria-checked={active}
					onclick={() => onSelect(opt.value)}
					class={cn(
						'inline-flex min-h-10 cursor-pointer items-center justify-center rounded-[3px] border px-2 text-xs transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring lg:min-h-8',
						active
							? 'border-border/90 bg-card font-semibold text-foreground'
							: 'border-transparent font-medium text-muted-foreground hover:text-foreground'
					)}
				>
					<span class="truncate">{@render richText(opt.label)}</span>
				</button>
			{/each}
		</div>
	</div>
{/snippet}

<div class={cn('flex min-w-0 flex-col gap-3 sm:gap-4', className)}>
	<!-- Course Example Presets Bar -->
	<div class="rounded-[4px] border border-border bg-surface-rail/45 p-2.5 sm:p-3">
		<div class="mb-2 flex items-center justify-between gap-2">
			<div class="flex items-center gap-1.5">
				<Sparkles class="size-3.5 shrink-0 text-primary" aria-hidden="true" />
				<span class="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
					Course Examples
				</span>
			</div>
			<button
				type="button"
				onclick={onResetPreset}
				class="inline-flex min-h-9 shrink-0 cursor-pointer items-center gap-1 rounded-[4px] border border-border bg-card px-2.5 text-xs font-medium text-foreground transition-colors duration-150 hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring lg:min-h-7 lg:px-2 lg:text-[11px]"
			>
				<RotateCcw class="size-3" aria-hidden="true" />
				<span>Reset</span>
			</button>
		</div>

		<div class="flex flex-wrap gap-1.5">
			{#each meta.presets as preset (preset.id)}
				{@const active = activePresetId === preset.id}
				<button
					type="button"
					aria-pressed={active}
					onclick={() => onSelectPreset(preset.id)}
					class={cn(
						'flex min-h-10 cursor-pointer flex-col items-start justify-center rounded-[4px] border px-2.5 py-1.5 text-left transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring lg:min-h-8',
						active
							? 'border-primary/60 bg-primary/8 text-foreground'
							: 'border-border bg-card text-foreground/85 hover:bg-accent'
					)}
				>
					<span class="text-xs font-medium leading-tight">{preset.label}</span>
					<span class="font-engineering mt-0.5 text-[10px] text-muted-foreground">
						{preset.source}
					</span>
				</button>
			{/each}
		</div>
	</div>

	<!-- Parameter Inputs per Topic -->
	<div class="flex flex-col gap-3 rounded-[4px] border border-border bg-card p-3 sm:gap-4 sm:p-4">
		{#if questionTypeId === 'QT-3PH-1'}
			{@const s = inputState as ThreePhaseInput}
			<div class="grid grid-cols-2 gap-2.5 sm:gap-3">
				{@render segToggle('Load Connection', CONN_OPTIONS, s.loadConnection, (v) =>
					patch({ loadConnection: v as ThreePhaseConnection })
				)}
				{@render segToggle(
					'Voltage Given',
					[
						{ value: 'line', label: 'Line (V{L})' },
						{ value: 'phase', label: 'Phase (V{φ})' }
					],
					s.voltageType,
					(v) => patch({ voltageType: v })
				)}
				{@render numField('3ph-v', 'Voltage Magnitude', 'V', s.voltageV, (raw) =>
					patch({ voltageV: parseRequiredNumber(raw) })
				)}
				{@render segToggle(
					'Load Specification',
					[
						{ value: 'impedance', label: 'Impedance (Z)' },
						{ value: 'power', label: 'Power & PF' }
					],
					s.loadMode,
					(v) => patch({ loadMode: v })
				)}
			</div>

			{#if s.loadMode === 'impedance'}
				<div class="grid grid-cols-2 gap-2.5 border-t border-border pt-3 sm:gap-3">
					{@render numField('3ph-r', 'Load Resistance R{φ}', 'Ω', s.loadR, (raw) =>
						patch({ loadR: parseRequiredNumber(raw) })
					)}
					{@render numField('3ph-x', 'Load Reactance X{φ}', 'Ω', s.loadX, (raw) =>
						patch({ loadX: parseRequiredNumber(raw) })
					)}
				</div>
			{:else}
				<div class="grid grid-cols-2 gap-2.5 border-t border-border pt-3 sm:gap-3">
					{@render segToggle(
						'Power Scope',
						[
							{ value: 'total', label: 'Total 3-Ph' },
							{ value: 'per-phase', label: 'Per-Phase' }
						],
						s.powerScope ?? 'total',
						(v) => patch({ powerScope: v })
					)}
					{@render segToggle('Power Factor Type', PF_OPTIONS, s.pfType ?? 'lag', (v) =>
						patch({ pfType: v as PowerFactorType })
					)}
					{@render numField(
						'3ph-p',
						'Active Power P',
						'W',
						s.powerW,
						(raw) => patch({ powerW: parseOptionalNumber(raw) }),
						true
					)}
					{@render numField(
						'3ph-s',
						'Apparent Power S',
						'VA',
						s.apparentVA,
						(raw) => patch({ apparentVA: parseOptionalNumber(raw) }),
						true
					)}
					{@render numField('3ph-pf', 'Power Factor (cos θ)', '', s.pf, (raw) =>
						patch({ pf: parseOptionalNumber(raw) })
					)}
				</div>
			{/if}

			<div class="grid grid-cols-2 gap-2.5 border-t border-border pt-3 sm:gap-3">
				{@render numField(
					'3ph-lr',
					'Line Resistance R{line}',
					'Ω',
					s.lineR,
					(raw) => patch({ lineR: parseOptionalNumber(raw) }),
					true
				)}
				{@render numField(
					'3ph-lx',
					'Line Reactance X{line}',
					'Ω',
					s.lineX,
					(raw) => patch({ lineX: parseOptionalNumber(raw) }),
					true
				)}
			</div>
		{:else if questionTypeId === 'QT-MAG-1'}
			{@const s = inputState as LinearMagneticInput}
			<div class="grid grid-cols-2 gap-2.5 sm:gap-3">
				{@render numField('mag1-lc', 'Mean Core Length ℓ{c}', 'm', s.coreLengthM, (raw) =>
					patch({ coreLengthM: parseRequiredNumber(raw) })
				)}
				{@render numField(
					'mag1-ac',
					'Core Area A{c}',
					'm²',
					s.coreAreaM2,
					(raw) => patch({ coreAreaM2: parseOptionalNumber(raw) }),
					true
				)}
				{@render segToggle(
					'Core Permeability',
					[
						{ value: 'finite', label: 'Finite μ{r}' },
						{ value: 'ideal', label: 'Ideal (μ{r} = ∞)' }
					],
					s.idealCore ? 'ideal' : 'finite',
					(v) => patch({ idealCore: v === 'ideal', muR: v === 'ideal' ? Infinity : 1000 })
				)}
				{#if !s.idealCore}
					{@render numField('mag1-mur', 'Relative Permeability μ{r}', '', s.muR, (raw) =>
						patch({ muR: parseRequiredNumber(raw) })
					)}
				{/if}
				{@render numField('mag1-lg', 'Air-Gap Length ℓ{g}', 'm', s.gapLengthM, (raw) =>
					patch({ gapLengthM: parseRequiredNumber(raw) })
				)}
				{@render numField(
					'mag1-cf',
					'Fringing Factor C{f}',
					'%',
					s.fringingPercent,
					(raw) => patch({ fringingPercent: parseOptionalNumber(raw) }),
					true
				)}
				{@render numField('mag1-n', 'Coil Turns N', 'turns', s.turns, (raw) =>
					patch({ turns: parseRequiredNumber(raw) })
				)}
			</div>

			<div class="grid grid-cols-2 gap-2.5 border-t border-border pt-3 sm:gap-3">
				{@render segToggle(
					'Known Excitation',
					[
						{ value: 'current', label: 'Current I' },
						{ value: 'flux', label: 'Flux Φ' },
						{ value: 'flux-density', label: 'Gap B{g}' }
					],
					s.excitationMode,
					(v) => patch({ excitationMode: v })
				)}
				{#if s.excitationMode === 'current'}
					{@render numField('mag1-i', 'Coil Current I', 'A', s.currentA, (raw) =>
						patch({ currentA: parseRequiredNumber(raw) })
					)}
				{:else if s.excitationMode === 'flux'}
					{@render numField('mag1-phi', 'Magnetic Flux Φ', 'Wb', s.fluxWb, (raw) =>
						patch({ fluxWb: parseRequiredNumber(raw) })
					)}
				{:else}
					{@render numField('mag1-bg', 'Gap Flux Density B{g}', 'T', s.gapFluxDensityT, (raw) =>
						patch({ gapFluxDensityT: parseRequiredNumber(raw) })
					)}
				{/if}
			</div>

			<div class="grid grid-cols-2 gap-2.5 border-t border-border pt-3 sm:gap-3">
				{@render numField(
					'mag1-rcoil',
					'Coil Resistance R{coil}',
					'Ω',
					s.coilResistanceOhm,
					(raw) => patch({ coilResistanceOhm: parseOptionalNumber(raw) }),
					true
				)}
				{@render numField(
					'mag1-freq',
					'Frequency f (for Q)',
					'Hz',
					s.frequencyHz,
					(raw) => patch({ frequencyHz: parseOptionalNumber(raw) }),
					true
				)}
			</div>
		{:else if questionTypeId === 'QT-MAG-2'}
			{@const s = inputState as NonlinearMagneticInput}
			<div class="grid grid-cols-2 gap-2.5 sm:gap-3">
				{@render segToggle(
					'Core Topology',
					[
						{ value: 'series-nonlinear', label: 'Series Nonlinear' },
						{ value: 'parallel-3limb', label: 'Parallel 3-Limb' }
					],
					s.topology,
					(v) => patch({ topology: v })
				)}
				{@render numField('mag2-n', 'Coil Turns N', 'turns', s.turns, (raw) =>
					patch({ turns: parseRequiredNumber(raw) })
				)}
			</div>

			{#if s.topology === 'series-nonlinear'}
				<div class="grid grid-cols-2 gap-2.5 border-t border-border pt-3 sm:gap-3">
					{@render numField('mag2-lc', 'Core Length ℓ{c}', 'm', s.coreLengthM, (raw) =>
						patch({ coreLengthM: parseRequiredNumber(raw) })
					)}
					{@render numField('mag2-ac', 'Core Area A{c}', 'm²', s.coreAreaM2, (raw) =>
						patch({ coreAreaM2: parseRequiredNumber(raw) })
					)}
					{@render numField(
						'mag2-lg',
						'Air-Gap Length ℓ{g}',
						'm',
						s.gapLengthM,
						(raw) => patch({ gapLengthM: parseOptionalNumber(raw) }),
						true
					)}
					{@render numField(
						'mag2-cf',
						'Fringing Factor C{f}',
						'%',
						s.fringingPercent,
						(raw) => patch({ fringingPercent: parseOptionalNumber(raw) }),
						true
					)}
					{@render segToggle(
						'Solve For',
						[
							{ value: 'current', label: 'Find Current I' },
							{ value: 'flux', label: 'Find Flux Φ' }
						],
						s.solveFor ?? 'current',
						(v) => patch({ solveFor: v })
					)}
					{#if (s.solveFor ?? 'current') === 'current'}
						{@render numField(
							'mag2-phi',
							'Target Flux Φ',
							'Wb',
							s.fluxWb,
							(raw) => patch({ fluxWb: parseOptionalNumber(raw) }),
							true
						)}
						{@render numField(
							'mag2-b',
							'Or Flux Density B',
							'T',
							s.fluxDensityT,
							(raw) => patch({ fluxDensityT: parseOptionalNumber(raw) }),
							true
						)}
					{:else}
						{@render numField('mag2-i', 'Excitation Current I', 'A', s.currentA, (raw) =>
							patch({ currentA: parseRequiredNumber(raw) })
						)}
					{/if}
				</div>
			{:else}
				<div class="grid grid-cols-2 gap-2.5 border-t border-border pt-3 sm:gap-3">
					{@render numField(
						'mag2-mur',
						'Constant μ{r} (if linear)',
						'',
						s.muR,
						(raw) => patch({ muR: parseOptionalNumber(raw) }),
						true
					)}
					{@render numField('mag2-rphi', 'Right-Limb Flux Φ{R}', 'Wb', s.rightFluxWb, (raw) =>
						patch({ rightFluxWb: parseRequiredNumber(raw) })
					)}
					{@render numField('mag2-ll', 'Left Limb Length', 'm', s.leftLengthM, (raw) =>
						patch({ leftLengthM: parseRequiredNumber(raw) })
					)}
					{@render numField('mag2-la', 'Left Limb Area', 'm²', s.leftAreaM2, (raw) =>
						patch({ leftAreaM2: parseRequiredNumber(raw) })
					)}
					{@render numField('mag2-cl', 'Center Limb Length', 'm', s.centerLengthM, (raw) =>
						patch({ centerLengthM: parseRequiredNumber(raw) })
					)}
					{@render numField('mag2-ca', 'Center Limb Area', 'm²', s.centerAreaM2, (raw) =>
						patch({ centerAreaM2: parseRequiredNumber(raw) })
					)}
					{@render numField(
						'mag2-cg',
						'Center Air Gap',
						'm',
						s.centerGapLengthM,
						(raw) => patch({ centerGapLengthM: parseOptionalNumber(raw) }),
						true
					)}
					{@render numField('mag2-rl', 'Right Limb Length', 'm', s.rightLengthM, (raw) =>
						patch({ rightLengthM: parseRequiredNumber(raw) })
					)}
					{@render numField('mag2-ra', 'Right Limb Area', 'm²', s.rightAreaM2, (raw) =>
						patch({ rightAreaM2: parseRequiredNumber(raw) })
					)}
					{@render numField(
						'mag2-rg',
						'Right Air Gap',
						'm',
						s.rightGapLengthM,
						(raw) => patch({ rightGapLengthM: parseOptionalNumber(raw) }),
						true
					)}
				</div>
			{/if}

			<!-- B-H Magnetization Table Editor -->
			<div class="flex flex-col gap-2 border-t border-border pt-3">
				<div class="flex items-center justify-between gap-2">
					<span class="text-xs font-semibold text-foreground">B–H Curve Points</span>
					<button
						type="button"
						onclick={addBhPoint}
						class="inline-flex min-h-10 cursor-pointer items-center gap-1 rounded-[4px] border border-border bg-surface-rail px-2.5 text-xs font-medium text-foreground transition-colors duration-150 hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring lg:min-h-8"
					>
						<Plus class="size-3.5" aria-hidden="true" />
						<span>Add Point</span>
					</button>
				</div>

				{#if s.bhTable && s.bhTable.length > 0}
					<div class="overflow-x-auto rounded-[4px] border border-border">
						<table class="w-full border-collapse text-xs">
							<thead>
								<tr class="border-b border-border bg-surface-rail/60 text-left text-[11px] text-muted-foreground">
									<th class="px-2.5 py-1.5 font-medium">H (A·t/m)</th>
									<th class="px-2.5 py-1.5 font-medium">B (T)</th>
									<th class="relative w-12 px-2 py-1.5 text-right font-medium">
										<span class="sr-only">Actions</span>
									</th>
								</tr>
							</thead>
							<tbody>
								{#each s.bhTable as pt, idx (idx)}
									<tr class="border-b border-border/70 last:border-b-0">
										<td class="p-1.5">
											<input
												type="number"
												step="any"
												inputmode="decimal"
												aria-label={`H value for point ${idx + 1}`}
												value={formatNumValue(pt.H)}
												oninput={(e) => updateBhPoint(idx, 'H', e.currentTarget.value)}
												class="font-engineering min-h-10 w-full rounded-[3px] border border-input bg-card px-2 text-base text-foreground focus-visible:border-ring focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30 lg:min-h-8 lg:text-sm"
											/>
										</td>
										<td class="p-1.5">
											<input
												type="number"
												step="any"
												inputmode="decimal"
												aria-label={`B value for point ${idx + 1}`}
												value={formatNumValue(pt.B)}
												oninput={(e) => updateBhPoint(idx, 'B', e.currentTarget.value)}
												class="font-engineering min-h-10 w-full rounded-[3px] border border-input bg-card px-2 text-base text-foreground focus-visible:border-ring focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30 lg:min-h-8 lg:text-sm"
											/>
										</td>
										<td class="p-1.5 text-right">
											<button
												type="button"
												aria-label={`Remove point ${idx + 1}`}
												onclick={() => removeBhPoint(idx)}
												class="inline-flex min-h-10 min-w-10 cursor-pointer items-center justify-center rounded-[3px] text-muted-foreground transition-colors duration-150 hover:bg-destructive/10 hover:text-destructive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring lg:min-h-8 lg:min-w-8"
											>
												<Trash2 class="size-3.5" aria-hidden="true" />
											</button>
										</td>
									</tr>
								{/each}
							</tbody>
						</table>
					</div>
				{:else}
					<p class="text-xs text-muted-foreground">
						No B–H points entered. Add at least 2 points for nonlinear interpolation.
					</p>
				{/if}
			</div>
		{:else if questionTypeId === 'QT-MAG-3'}
			{@const s = inputState as VariableReluctanceInput}
			<div class="grid grid-cols-2 gap-2.5 sm:gap-3">
				{@render segToggle(
					'Closure Constraint',
					[
						{ value: 'constant-current', label: 'Slow (Const. I)' },
						{ value: 'constant-flux', label: 'Fast (Const. Φ)' }
					],
					s.constraint,
					(v) => patch({ constraint: v })
				)}
				{@render segToggle(
					'Core Permeability',
					[
						{ value: 'finite', label: 'Finite μ{r}' },
						{ value: 'ideal', label: 'Ideal (μ{r} = ∞)' }
					],
					s.idealCore ? 'ideal' : 'finite',
					(v) => patch({ idealCore: v === 'ideal', muR: v === 'ideal' ? Infinity : 400 })
				)}
				{@render numField('mag3-lc', 'Core Length ℓ{c}', 'm', s.coreLengthM, (raw) =>
					patch({ coreLengthM: parseRequiredNumber(raw) })
				)}
				{@render numField('mag3-ac', 'Core Area A{c}', 'm²', s.coreAreaM2, (raw) =>
					patch({ coreAreaM2: parseRequiredNumber(raw) })
				)}
				{#if !s.idealCore}
					{@render numField('mag3-mur', 'Relative Permeability μ{r}', '', s.muR, (raw) =>
						patch({ muR: parseRequiredNumber(raw) })
					)}
				{/if}
				{@render numField('mag3-n', 'Coil Turns N', 'turns', s.turns, (raw) =>
					patch({ turns: parseRequiredNumber(raw) })
				)}
				{@render numField('mag3-ng', 'Number of Gaps n{g}', '', s.numGaps, (raw) =>
					patch({ numGaps: parseRequiredNumber(raw) })
				)}
				{@render numField('mag3-g1', 'Initial Gap g{1}', 'm', s.initialGapM, (raw) =>
					patch({ initialGapM: parseRequiredNumber(raw) })
				)}
				{@render numField('mag3-g2', 'Final Gap g{2}', 'm', s.finalGapM, (raw) =>
					patch({ finalGapM: parseRequiredNumber(raw) })
				)}
			</div>

			<div class="grid grid-cols-2 gap-2.5 border-t border-border pt-3 sm:grid-cols-3 sm:gap-3">
				{@render numField(
					'mag3-bg',
					'Initial B{g}',
					'T',
					s.initialFluxDensityT,
					(raw) => patch({ initialFluxDensityT: parseOptionalNumber(raw) }),
					true
				)}
				{@render numField(
					'mag3-phi',
					'Initial Flux Φ',
					'Wb',
					s.initialFluxWb,
					(raw) => patch({ initialFluxWb: parseOptionalNumber(raw) }),
					true
				)}
				{@render numField(
					'mag3-i',
					'Initial Current I',
					'A',
					s.initialCurrentA,
					(raw) => patch({ initialCurrentA: parseOptionalNumber(raw) }),
					true
				)}
			</div>
		{:else if questionTypeId === 'QT-XFMR-1'}
			{@const s = inputState as TransformerEmfCoreLossInput}
			{@render segToggle(
				'Analysis Mode',
				[
					{ value: 'emf', label: 'EMF Equation' },
					{ value: 'loss-separation', label: 'Loss Separation' },
					{ value: 'vf-scaling', label: '(V, f) Scaling' }
				],
				s.mode,
				(v) => patch({ mode: v }),
				''
			)}

			{#if s.mode === 'emf'}
				<div class="grid grid-cols-2 gap-2.5 border-t border-border pt-3 sm:gap-3">
					{@render numField('xf1-f', 'Frequency f', 'Hz', s.frequencyHz, (raw) =>
						patch({ frequencyHz: parseOptionalNumber(raw) })
					)}
					{@render numField('xf1-n1', 'Primary Turns N{1}', 'turns', s.n1, (raw) =>
						patch({ n1: parseOptionalNumber(raw) })
					)}
					{@render numField(
						'xf1-n2',
						'Secondary Turns N{2}',
						'turns',
						s.n2,
						(raw) => patch({ n2: parseOptionalNumber(raw) }),
						true
					)}
					{@render numField(
						'xf1-phim',
						'Max Flux Φ{m}',
						'Wb',
						s.maxFluxWb,
						(raw) => patch({ maxFluxWb: parseOptionalNumber(raw) }),
						true
					)}
					{@render numField(
						'xf1-bm',
						'Max Flux Density B{m}',
						'T',
						s.maxFluxDensityT,
						(raw) => patch({ maxFluxDensityT: parseOptionalNumber(raw) }),
						true
					)}
					{@render numField(
						'xf1-ac',
						'Core Area A{c}',
						'm²',
						s.coreAreaM2,
						(raw) => patch({ coreAreaM2: parseOptionalNumber(raw) }),
						true
					)}
					{@render numField(
						'xf1-v1',
						'Primary Voltage V{1}',
						'V',
						s.primaryVoltageV,
						(raw) => patch({ primaryVoltageV: parseOptionalNumber(raw) }),
						true
					)}
				</div>
			{:else if s.mode === 'loss-separation'}
				<div class="grid grid-cols-2 gap-2.5 border-t border-border pt-3 sm:gap-3">
					{@render numField('xf1-f1', 'Frequency f{1}', 'Hz', s.f1Hz, (raw) =>
						patch({ f1Hz: parseOptionalNumber(raw) })
					)}
					{@render numField('xf1-pc1', 'Core Loss P{c1}', 'W', s.pc1W, (raw) =>
						patch({ pc1W: parseOptionalNumber(raw) })
					)}
					{@render numField('xf1-f2', 'Frequency f{2}', 'Hz', s.f2Hz, (raw) =>
						patch({ f2Hz: parseOptionalNumber(raw) })
					)}
					{@render numField('xf1-pc2', 'Core Loss P{c2}', 'W', s.pc2W, (raw) =>
						patch({ pc2W: parseOptionalNumber(raw) })
					)}
					{@render numField(
						'xf1-ft',
						'Target Frequency f{target}',
						'Hz',
						s.targetFreqHz,
						(raw) => patch({ targetFreqHz: parseOptionalNumber(raw) }),
						true
					)}
				</div>
			{:else}
				<div class="grid grid-cols-2 gap-2.5 border-t border-border pt-3 sm:gap-3">
					{@render numField('xf1-sv1', 'Initial Voltage V{1}', 'V', s.v1V, (raw) =>
						patch({ v1V: parseOptionalNumber(raw) })
					)}
					{@render numField('xf1-sf1', 'Initial Frequency f{1}', 'Hz', s.f1Hz, (raw) =>
						patch({ f1Hz: parseOptionalNumber(raw) })
					)}
					{@render numField('xf1-ph1', 'Hysteresis Loss P{h1}', 'W', s.ph1W, (raw) =>
						patch({ ph1W: parseOptionalNumber(raw) })
					)}
					{@render numField('xf1-pe1', 'Eddy-Current Loss P{e1}', 'W', s.pe1W, (raw) =>
						patch({ pe1W: parseOptionalNumber(raw) })
					)}
					{@render numField('xf1-sv2', 'New Voltage V{2}', 'V', s.v2V, (raw) =>
						patch({ v2V: parseOptionalNumber(raw) })
					)}
					{@render numField('xf1-sf2', 'New Frequency f{2}', 'Hz', s.f2Hz, (raw) =>
						patch({ f2Hz: parseOptionalNumber(raw) })
					)}
					{@render numField(
						'xf1-n',
						'Steinmetz Exponent n',
						'',
						s.steinmetzN,
						(raw) => patch({ steinmetzN: parseOptionalNumber(raw) }),
						true,
						'1.6'
					)}
				</div>
			{/if}
		{:else if questionTypeId === 'QT-XFMR-2'}
			{@const s = inputState as TransformerOcScInput}
			<div class="grid grid-cols-2 gap-2.5 sm:gap-3">
				{@render numField('xf2-va', 'Rated Power S', 'VA', s.ratedVA, (raw) =>
					patch({ ratedVA: parseRequiredNumber(raw) })
				)}
				{@render numField('xf2-f', 'Frequency f', 'Hz', s.frequencyHz, (raw) =>
					patch({ frequencyHz: parseRequiredNumber(raw) })
				)}
				{@render numField('xf2-v1', 'Primary Rated V{1}', 'V', s.v1Rated, (raw) =>
					patch({ v1Rated: parseRequiredNumber(raw) })
				)}
				{@render numField('xf2-v2', 'Secondary Rated V{2}', 'V', s.v2Rated, (raw) =>
					patch({ v2Rated: parseRequiredNumber(raw) })
				)}
				{@render segToggle(
					'Refer Parameters To',
					[
						{ value: 'primary', label: 'Primary (1)' },
						{ value: 'secondary', label: 'Secondary (2)' }
					],
					s.referTo,
					(v) => patch({ referTo: v })
				)}
			</div>

			<div class="grid grid-cols-2 gap-2.5 border-t border-border pt-3 sm:gap-3">
				{@render segToggle(
					'OC Test Side',
					[
						{ value: 'LV', label: 'LV Side' },
						{ value: 'HV', label: 'HV Side' }
					],
					s.ocSide,
					(v) => patch({ ocSide: v })
				)}
				{@render numField('xf2-voc', 'V{oc} (Open Circuit)', 'V', s.vOc, (raw) =>
					patch({ vOc: parseRequiredNumber(raw) })
				)}
				{@render numField('xf2-ioc', 'I{oc} (Open Circuit)', 'A', s.iOc, (raw) =>
					patch({ iOc: parseRequiredNumber(raw) })
				)}
				{@render numField('xf2-poc', 'P{oc} (Core Loss W{0})', 'W', s.pOc, (raw) =>
					patch({ pOc: parseRequiredNumber(raw) })
				)}
			</div>

			<div class="grid grid-cols-2 gap-2.5 border-t border-border pt-3 sm:gap-3">
				{@render segToggle(
					'SC Test Side',
					[
						{ value: 'HV', label: 'HV Side' },
						{ value: 'LV', label: 'LV Side' }
					],
					s.scSide,
					(v) => patch({ scSide: v })
				)}
				{@render numField('xf2-vsc', 'V{sc} (Short Circuit)', 'V', s.vSc, (raw) =>
					patch({ vSc: parseRequiredNumber(raw) })
				)}
				{@render numField('xf2-isc', 'I{sc} (Short Circuit)', 'A', s.iSc, (raw) =>
					patch({ iSc: parseRequiredNumber(raw) })
				)}
				{@render numField('xf2-psc', 'P{sc} (Copper Loss W{sc})', 'W', s.pSc, (raw) =>
					patch({ pSc: parseRequiredNumber(raw) })
				)}
			</div>

			<div class="grid grid-cols-2 gap-2.5 border-t border-border pt-3 sm:grid-cols-3 sm:gap-3">
				{@render numField(
					'xf2-x',
					'Eval Load Fraction x',
					'pu',
					s.evalLoadFraction,
					(raw) => patch({ evalLoadFraction: parseOptionalNumber(raw) }),
					true
				)}
				{@render numField(
					'xf2-pf',
					'Eval Power Factor',
					'',
					s.evalPf,
					(raw) => patch({ evalPf: parseOptionalNumber(raw) }),
					true
				)}
				{@render segToggle('Eval PF Type', PF_OPTIONS, s.evalPfType ?? 'lag', (v) =>
					patch({ evalPfType: v as PowerFactorType })
				)}
			</div>
		{:else if questionTypeId === 'QT-XFMR-3'}
			{@const s = inputState as TransformerOnLoadInput}
			<div class="grid grid-cols-2 gap-2.5 sm:gap-3">
				{@render numField('xf3-va', 'Rated Power S', 'VA', s.ratedVA, (raw) =>
					patch({ ratedVA: parseRequiredNumber(raw) })
				)}
				{@render numField(
					'xf3-f',
					'Frequency f',
					'Hz',
					s.frequencyHz,
					(raw) => patch({ frequencyHz: parseOptionalNumber(raw) }),
					true
				)}
				{@render numField('xf3-v1', 'Primary Rated V{1}', 'V', s.v1Rated, (raw) =>
					patch({ v1Rated: parseRequiredNumber(raw) })
				)}
				{@render numField('xf3-v2', 'Secondary Rated V{2}', 'V', s.v2Rated, (raw) =>
					patch({ v2Rated: parseRequiredNumber(raw) })
				)}
			</div>

			<div class="flex flex-col gap-3 border-t border-border pt-3">
				{@render segToggle(
					'Equivalent Parameters Reference',
					[
						{ value: 'primary', label: 'Primary' },
						{ value: 'secondary', label: 'Secondary' },
						{ value: 'separate', label: 'Separate' }
					],
					s.paramRef ?? 'primary',
					(v) => patch({ paramRef: v }),
					''
				)}

				{#if s.paramRef === 'separate'}
					<div class="grid grid-cols-2 gap-2.5 sm:gap-3">
						{@render numField('xf3-r1', 'R{1}', 'Ω', s.r1, (raw) =>
							patch({ r1: parseOptionalNumber(raw) })
						)}
						{@render numField('xf3-x1', 'X{1}', 'Ω', s.x1, (raw) =>
							patch({ x1: parseOptionalNumber(raw) })
						)}
						{@render numField('xf3-r2', 'R{2}', 'Ω', s.r2, (raw) =>
							patch({ r2: parseOptionalNumber(raw) })
						)}
						{@render numField('xf3-x2', 'X{2}', 'Ω', s.x2, (raw) =>
							patch({ x2: parseOptionalNumber(raw) })
						)}
					</div>
				{:else}
					<div class="grid grid-cols-2 gap-2.5 sm:gap-3">
						{@render numField('xf3-re', 'Equivalent R{e}', 'Ω', s.re, (raw) =>
							patch({ re: parseOptionalNumber(raw) })
						)}
						{@render numField('xf3-xe', 'Equivalent X{e}', 'Ω', s.xe, (raw) =>
							patch({ xe: parseOptionalNumber(raw) })
						)}
					</div>
				{/if}

				<div class="grid grid-cols-2 gap-2.5 sm:gap-3">
					{@render numField(
						'xf3-rc',
						'Core Resistance R{c}',
						'Ω',
						s.rc,
						(raw) => patch({ rc: parseOptionalNumber(raw) }),
						true
					)}
					{@render numField(
						'xf3-xm',
						'Magnetizing X{m}',
						'Ω',
						s.xm,
						(raw) => patch({ xm: parseOptionalNumber(raw) }),
						true
					)}
					{@render numField(
						'xf3-pc',
						'Or Core Loss P{i}',
						'W',
						s.pCoreW,
						(raw) => patch({ pCoreW: parseOptionalNumber(raw) }),
						true
					)}
					{@render numField(
						'xf3-pfnl',
						'No-Load PF',
						'',
						s.pfNoLoad,
						(raw) => patch({ pfNoLoad: parseOptionalNumber(raw) }),
						true
					)}
				</div>
			</div>

			<div class="grid grid-cols-2 gap-2.5 border-t border-border pt-3 sm:gap-3">
				{@render numField(
					'xf3-x',
					'Load Fraction x',
					'pu',
					s.loadFraction,
					(raw) => patch({ loadFraction: parseOptionalNumber(raw) }),
					true
				)}
				{@render numField(
					'xf3-lw',
					'Or Load Power P{out}',
					'W',
					s.loadWatts,
					(raw) => patch({ loadWatts: parseOptionalNumber(raw) }),
					true
				)}
				{@render numField('xf3-pf', 'Load Power Factor', '', s.pf, (raw) =>
					patch({ pf: parseRequiredNumber(raw) })
				)}
				{@render segToggle('PF Type', PF_OPTIONS, s.pfType, (v) =>
					patch({ pfType: v as PowerFactorType })
				)}
			</div>
		{:else if questionTypeId === 'QT-XFMR-4'}
			{@const s = inputState as TransformerEfficiencyInput}
			<div class="grid grid-cols-2 gap-2.5 sm:gap-3">
				{@render segToggle(
					'Efficiency Mode',
					[
						{ value: 'known-losses', label: 'Known Losses' },
						{ value: 'two-point-separation', label: '2-Point Separation' }
					],
					s.mode,
					(v) => patch({ mode: v })
				)}
				{@render numField('xf4-va', 'Rated Power S', 'VA', s.ratedVA, (raw) =>
					patch({ ratedVA: parseRequiredNumber(raw) })
				)}
			</div>

			{#if s.mode === 'known-losses'}
				<div class="grid grid-cols-2 gap-2.5 border-t border-border pt-3 sm:gap-3">
					{@render numField('xf4-pi', 'Core Loss P{i}', 'W', s.pCoreW, (raw) =>
						patch({ pCoreW: parseOptionalNumber(raw) })
					)}
					{@render numField('xf4-pcu', 'Full-Load Copper Loss P{cu,FL}', 'W', s.pCuFlW, (raw) =>
						patch({ pCuFlW: parseOptionalNumber(raw) })
					)}
					{@render numField('xf4-x', 'Load Fraction x', 'pu', s.loadFraction, (raw) =>
						patch({ loadFraction: parseOptionalNumber(raw) })
					)}
					{@render numField('xf4-pf', 'Load Power Factor', '', s.pf, (raw) =>
						patch({ pf: parseOptionalNumber(raw) })
					)}
					{@render numField(
						'xf4-mpf',
						'PF for Max η',
						'',
						s.maxEffPf,
						(raw) => patch({ maxEffPf: parseOptionalNumber(raw) }),
						true
					)}
				</div>
			{:else}
				<div class="grid grid-cols-2 gap-2.5 border-t border-border pt-3 sm:grid-cols-3 sm:gap-3">
					{@render numField(
						'xf4-p1x',
						'Point 1 Load x{1}',
						'pu',
						s.point1?.loadFraction,
						(raw) =>
							patch({
								point1: {
									loadFraction: parseRequiredNumber(raw),
									pf: s.point1?.pf ?? 1,
									efficiencyPercent: s.point1?.efficiencyPercent ?? 95
								}
							})
					)}
					{@render numField('xf4-p1pf', 'Point 1 PF', '', s.point1?.pf, (raw) =>
						patch({
							point1: {
								loadFraction: s.point1?.loadFraction ?? 1,
								pf: parseRequiredNumber(raw),
								efficiencyPercent: s.point1?.efficiencyPercent ?? 95
							}
						})
					)}
					{@render numField(
						'xf4-p1eta',
						'Point 1 η{1}',
						'%',
						s.point1?.efficiencyPercent,
						(raw) =>
							patch({
								point1: {
									loadFraction: s.point1?.loadFraction ?? 1,
									pf: s.point1?.pf ?? 1,
									efficiencyPercent: parseRequiredNumber(raw)
								}
							})
					)}
					{@render numField(
						'xf4-p2x',
						'Point 2 Load x{2}',
						'pu',
						s.point2?.loadFraction,
						(raw) =>
							patch({
								point2: {
									loadFraction: parseRequiredNumber(raw),
									pf: s.point2?.pf ?? 1,
									efficiencyPercent: s.point2?.efficiencyPercent ?? 95
								}
							})
					)}
					{@render numField('xf4-p2pf', 'Point 2 PF', '', s.point2?.pf, (raw) =>
						patch({
							point2: {
								loadFraction: s.point2?.loadFraction ?? 0.5,
								pf: parseRequiredNumber(raw),
								efficiencyPercent: s.point2?.efficiencyPercent ?? 95
							}
						})
					)}
					{@render numField(
						'xf4-p2eta',
						'Point 2 η{2}',
						'%',
						s.point2?.efficiencyPercent,
						(raw) =>
							patch({
								point2: {
									loadFraction: s.point2?.loadFraction ?? 0.5,
									pf: s.point2?.pf ?? 1,
									efficiencyPercent: parseRequiredNumber(raw)
								}
							})
					)}
				</div>
				<div class="grid grid-cols-2 gap-2.5 border-t border-border pt-3 sm:gap-3">
					{@render numField(
						'xf4-tx',
						'Target Load x',
						'pu',
						s.targetLoadFraction,
						(raw) => patch({ targetLoadFraction: parseOptionalNumber(raw) }),
						true
					)}
					{@render numField(
						'xf4-tpf',
						'Target PF',
						'',
						s.targetPf,
						(raw) => patch({ targetPf: parseOptionalNumber(raw) }),
						true
					)}
				</div>
			{/if}
		{:else if questionTypeId === 'QT-DC-1'}
			{@const s = inputState as DcEmfTorqueInput}
			{@render segToggle(
				'Calculation Mode',
				[
					{ value: 'operating-point', label: 'Operating Point' },
					{ value: 'winding-design', label: 'Winding Design' }
				],
				s.mode,
				(v) => patch({ mode: v }),
				''
			)}

			{#if s.mode === 'winding-design'}
				<div class="grid grid-cols-2 gap-2.5 border-t border-border pt-3 sm:gap-3">
					{@render numField('dc1-p', 'Poles P', '', s.poles, (raw) =>
						patch({ poles: parseOptionalNumber(raw) })
					)}
					{@render numField('dc1-z', 'Conductors Z{a}', '', s.conductors, (raw) =>
						patch({ conductors: parseOptionalNumber(raw) })
					)}
					{@render segToggle(
						'Armature Winding',
						[
							{ value: 'lap', label: 'Lap (a = P)' },
							{ value: 'wave', label: 'Wave (a = 2)' }
						],
						s.winding ?? 'lap',
						(v) => patch({ winding: v })
					)}
					{@render numField('dc1-phi', 'Flux per Pole Φ{p}', 'Wb', s.fluxPerPoleWb, (raw) =>
						patch({ fluxPerPoleWb: parseOptionalNumber(raw) })
					)}
				</div>
			{:else}
				<div class="grid grid-cols-2 gap-2.5 border-t border-border pt-3 sm:gap-3">
					{@render segToggle(
						'Machine Mode',
						[
							{ value: 'motor', label: 'Motor' },
							{ value: 'generator', label: 'Generator' }
						],
						s.machineMode ?? 'motor',
						(v) => patch({ machineMode: v })
					)}
					{@render numField('dc1-vt', 'Terminal Voltage V{t}', 'V', s.vtV, (raw) =>
						patch({ vtV: parseOptionalNumber(raw) })
					)}
					{@render numField('dc1-ra', 'Armature Resistance R{a}', 'Ω', s.raOhm, (raw) =>
						patch({ raOhm: parseOptionalNumber(raw) })
					)}
					{@render numField(
						'dc1-pin',
						'Input Power P{in}',
						'W',
						s.pInW,
						(raw) => patch({ pInW: parseOptionalNumber(raw) }),
						true
					)}
				</div>
			{/if}

			<div class="grid grid-cols-2 gap-2.5 border-t border-border pt-3 sm:grid-cols-3 sm:gap-3">
				{@render numField('dc1-n', 'Speed n', 'rpm', s.speedRpm, (raw) =>
					patch({ speedRpm: parseRequiredNumber(raw) })
				)}
				{@render numField(
					'dc1-ia',
					'Armature Current I{a}',
					'A',
					s.armatureCurrentA,
					(raw) => patch({ armatureCurrentA: parseOptionalNumber(raw) }),
					true
				)}
				{@render numField(
					'dc1-ia2',
					'Target I{a2} (Scale T{d})',
					'A',
					s.targetArmatureCurrentA,
					(raw) => patch({ targetArmatureCurrentA: parseOptionalNumber(raw) }),
					true
				)}
			</div>
		{:else if questionTypeId === 'QT-DC-2'}
			{@const s = inputState as DcGeneratorInput}
			<div class="grid grid-cols-2 gap-2.5 sm:gap-3">
				{@render segToggle(
					'Generator Excitation',
					[
						{ value: 'separately-excited', label: 'Sep. Excited' },
						{ value: 'shunt', label: 'Shunt' }
					],
					s.generatorType,
					(v) => patch({ generatorType: v })
				)}
				{@render segToggle(
					'Solve Direction',
					[
						{ value: 'emf-from-load', label: 'Find E{a} from Load' },
						{ value: 'load-from-emf', label: 'Find I{L} from E{a}' }
					],
					s.solveFor,
					(v) => patch({ solveFor: v })
				)}
				{@render numField('dc2-vt', 'Terminal Voltage V{t}', 'V', s.vtV, (raw) =>
					patch({ vtV: parseRequiredNumber(raw) })
				)}
				{@render numField('dc2-ra', 'Armature Resistance R{a}', 'Ω', s.raOhm, (raw) =>
					patch({ raOhm: parseRequiredNumber(raw) })
				)}
				{#if s.generatorType === 'shunt'}
					{@render numField('dc2-rf', 'Shunt Field R{f}', 'Ω', s.rfOhm, (raw) =>
						patch({ rfOhm: parseOptionalNumber(raw) })
					)}
					{@render numField(
						'dc2-rrh',
						'Field Rheostat R{rh}',
						'Ω',
						s.rrhOhm,
						(raw) => patch({ rrhOhm: parseOptionalNumber(raw) }),
						true
					)}
				{/if}
				{#if s.solveFor === 'load-from-emf'}
					{@render numField('dc2-ea', 'Generated EMF E{a}', 'V', s.eaV, (raw) =>
						patch({ eaV: parseOptionalNumber(raw) })
					)}
				{:else}
					{@render numField(
						'dc2-il',
						'Load Current I{L}',
						'A',
						s.iLoadA,
						(raw) => patch({ iLoadA: parseOptionalNumber(raw) }),
						true
					)}
					{@render numField(
						'dc2-pout',
						'Or Output Power P{out}',
						'W',
						s.pOutW,
						(raw) => patch({ pOutW: parseOptionalNumber(raw) }),
						true
					)}
				{/if}
			</div>

			<div class="grid grid-cols-2 gap-2.5 border-t border-border pt-3 sm:gap-3">
				{@render numField(
					'dc2-vb',
					'Brush Drop V{brush}',
					'V',
					s.vBrushV,
					(raw) => patch({ vBrushV: parseOptionalNumber(raw) }),
					true
				)}
				{@render numField(
					'dc2-vnl',
					'No-Load Voltage V{nl}',
					'V',
					s.vNoLoadV,
					(raw) => patch({ vNoLoadV: parseOptionalNumber(raw) }),
					true
				)}
				{@render numField(
					'dc2-prot',
					'Rotational Losses P{rot}',
					'W',
					s.pRotW,
					(raw) => patch({ pRotW: parseOptionalNumber(raw) }),
					true
				)}
			</div>
		{:else if questionTypeId === 'QT-DC-3'}
			{@const s = inputState as DcMotorInput}
			<div class="grid grid-cols-2 gap-2.5 sm:gap-3">
				{@render segToggle(
					'Motor Type',
					[
						{ value: 'separately-excited', label: 'Sep. Excited' },
						{ value: 'shunt', label: 'Shunt' }
					],
					s.motorType,
					(v) => patch({ motorType: v })
				)}
				<div class="col-span-2 flex min-w-0 flex-col gap-1 sm:col-span-1">
					<label for="dc3-ctrl" class="text-xs font-medium text-foreground">
						Control Method
					</label>
					<select
						id="dc3-ctrl"
						value={s.controlMode}
						onchange={(e) => patch({ controlMode: e.currentTarget.value })}
						class="min-h-10 w-full rounded-[4px] border border-input bg-card px-2.5 text-base text-foreground focus-visible:border-ring focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30 lg:min-h-8 lg:text-sm"
					>
						<option value="armature-resistance">Armature Series Resistance</option>
						<option value="terminal-voltage">Terminal Voltage (Vₜ₂)</option>
						<option value="field-flux">Field Flux Weakening (Φ₂/Φ₁)</option>
						<option value="starting">Starting Resistance</option>
					</select>
				</div>
				{@render numField('dc3-vt1', 'Initial Voltage V{t1}', 'V', s.vt1V, (raw) =>
					patch({ vt1V: parseRequiredNumber(raw) })
				)}
				{@render numField('dc3-n1', 'Initial Speed n{1}', 'rpm', s.n1Rpm, (raw) =>
					patch({ n1Rpm: parseRequiredNumber(raw) })
				)}
				{@render numField('dc3-ra', 'Armature Resistance R{a}', 'Ω', s.raOhm, (raw) =>
					patch({ raOhm: parseRequiredNumber(raw) })
				)}
				{@render numField(
					'dc3-ia1',
					'Initial Current I{a1}',
					'A',
					s.ia1A,
					(raw) => patch({ ia1A: parseOptionalNumber(raw) }),
					true
				)}
				{@render numField(
					'dc3-pin1',
					'Or Initial Input Power P{in1}',
					'W',
					s.pIn1W,
					(raw) => patch({ pIn1W: parseOptionalNumber(raw) }),
					true
				)}
				{#if s.motorType === 'shunt'}
					{@render numField(
						'dc3-rf',
						'Shunt Field R{f}',
						'Ω',
						s.rfOhm,
						(raw) => patch({ rfOhm: parseOptionalNumber(raw) }),
						true
					)}
				{/if}
			</div>

			<div class="grid grid-cols-2 gap-2.5 border-t border-border pt-3 sm:gap-3">
				{#if s.controlMode === 'armature-resistance'}
					{@render numField('dc3-radd', 'Added Series R{add}', 'Ω', s.rAddOhm, (raw) =>
						patch({ rAddOhm: parseOptionalNumber(raw) })
					)}
					{@render numField(
						'dc3-tr',
						'Torque Ratio T{d2} / T{d1}',
						'',
						s.torqueRatio,
						(raw) => patch({ torqueRatio: parseOptionalNumber(raw) }),
						true,
						'1'
					)}
				{:else if s.controlMode === 'terminal-voltage'}
					{@render numField('dc3-vt2', 'New Voltage V{t2}', 'V', s.vt2V, (raw) =>
						patch({ vt2V: parseOptionalNumber(raw) })
					)}
					{@render segToggle(
						'Load Constraint',
						[
							{ value: 'constant-torque', label: 'Const. T' },
							{ value: 'constant-power', label: 'Const. P' },
							{ value: 'constant-current', label: 'Const. I' }
						],
						s.loadConstraint ?? 'constant-torque',
						(v) => patch({ loadConstraint: v })
					)}
				{:else if s.controlMode === 'field-flux'}
					{@render numField('dc3-fr', 'Flux Ratio Φ{2} / Φ{1}', '', s.fluxRatio, (raw) =>
						patch({ fluxRatio: parseOptionalNumber(raw) })
					)}
					{@render segToggle(
						'Load Constraint',
						[
							{ value: 'constant-torque', label: 'Const. T' },
							{ value: 'constant-power', label: 'Const. P' },
							{ value: 'constant-current', label: 'Const. I' }
						],
						s.loadConstraint ?? 'constant-torque',
						(v) => patch({ loadConstraint: v })
					)}
				{:else}
					{@render numField(
						'dc3-imax',
						'Max Starting Current I{st,max}',
						'A',
						s.maxStartCurrentA,
						(raw) => patch({ maxStartCurrentA: parseOptionalNumber(raw) })
					)}
				{/if}
			</div>
		{:else if questionTypeId === 'QT-IM-1'}
			{@const s = inputState as InductionMotorBasicInput}
			<div class="grid grid-cols-2 gap-2.5 sm:gap-3">
				{@render numField('im1-p', 'Number of Poles P', '', s.poles, (raw) =>
					patch({ poles: parseRequiredNumber(raw) })
				)}
				{@render numField('im1-f', 'Stator Frequency f{s}', 'Hz', s.frequencyHz, (raw) =>
					patch({ frequencyHz: parseRequiredNumber(raw) })
				)}
				{@render numField(
					'im1-s',
					'Slip s (decimal)',
					'pu',
					s.slip,
					(raw) => patch({ slip: parseOptionalNumber(raw) }),
					true
				)}
				{@render numField(
					'im1-nr',
					'Or Rotor Speed N{r}',
					'rpm',
					s.rotorSpeedRpm,
					(raw) => patch({ rotorSpeedRpm: parseOptionalNumber(raw) }),
					true
				)}
				{@render numField(
					'im1-snl',
					'No-Load Slip s{nl}',
					'pu',
					s.noLoadSlip,
					(raw) => patch({ noLoadSlip: parseOptionalNumber(raw) }),
					true
				)}
				{@render numField(
					'im1-hp',
					'Output Power (HP)',
					'HP',
					s.pOutHp,
					(raw) => patch({ pOutHp: parseOptionalNumber(raw) }),
					true
				)}
				{@render numField(
					'im1-w',
					'Or Output Power (W)',
					'W',
					s.pOutW,
					(raw) => patch({ pOutW: parseOptionalNumber(raw) }),
					true
				)}
			</div>
		{:else if questionTypeId === 'QT-IM-2'}
			{@const s = inputState as InductionMotorPowerFlowInput}
			<div class="grid grid-cols-2 gap-2.5 sm:gap-3">
				{@render segToggle(
					'Power Flow Direction',
					[
						{ value: 'forward', label: 'Forward (P{in} → P{out})' },
						{ value: 'backward', label: 'Backward (P{out} → P{in})' }
					],
					s.direction,
					(v) => patch({ direction: v })
				)}
				{@render segToggle('Stator Connection', CONN_OPTIONS, s.connection, (v) =>
					patch({ connection: v as ThreePhaseConnection })
				)}
				{@render numField('im2-p', 'Poles P', '', s.poles, (raw) =>
					patch({ poles: parseRequiredNumber(raw) })
				)}
				{@render numField('im2-f', 'Frequency f{s}', 'Hz', s.frequencyHz, (raw) =>
					patch({ frequencyHz: parseRequiredNumber(raw) })
				)}
			</div>

			{#if s.direction === 'forward'}
				<div class="grid grid-cols-2 gap-2.5 border-t border-border pt-3 sm:gap-3">
					{@render numField(
						'im2-vl',
						'Line Voltage V{L}',
						'V',
						s.vLineV,
						(raw) => patch({ vLineV: parseOptionalNumber(raw) }),
						true
					)}
					{@render numField(
						'im2-il',
						'Line Current I{L}',
						'A',
						s.iLineA,
						(raw) => patch({ iLineA: parseOptionalNumber(raw) }),
						true
					)}
					{@render numField(
						'im2-pf',
						'Input Power Factor',
						'',
						s.pf,
						(raw) => patch({ pf: parseOptionalNumber(raw) }),
						true
					)}
					{@render numField(
						'im2-pin',
						'Or Direct P{in}',
						'W',
						s.pInW,
						(raw) => patch({ pInW: parseOptionalNumber(raw) }),
						true
					)}
				</div>
			{:else}
				<div class="grid grid-cols-2 gap-2.5 border-t border-border pt-3 sm:gap-3">
					{@render numField(
						'im2-hp',
						'Shaft Power (HP)',
						'HP',
						s.pOutHp,
						(raw) => patch({ pOutHp: parseOptionalNumber(raw) }),
						true
					)}
					{@render numField(
						'im2-w',
						'Or Shaft Power (W)',
						'W',
						s.pOutW,
						(raw) => patch({ pOutW: parseOptionalNumber(raw) }),
						true
					)}
				</div>
			{/if}

			<div class="grid grid-cols-2 gap-2.5 border-t border-border pt-3 sm:grid-cols-3 sm:gap-3">
				{@render numField(
					'im2-s',
					'Slip s',
					'pu',
					s.slip,
					(raw) => patch({ slip: parseOptionalNumber(raw) }),
					true
				)}
				{@render numField(
					'im2-nr',
					'Or Speed N{r}',
					'rpm',
					s.rotorSpeedRpm,
					(raw) => patch({ rotorSpeedRpm: parseOptionalNumber(raw) }),
					true
				)}
				{@render numField(
					'im2-prcu',
					'Rotor Cu Loss P{cu,r}',
					'W',
					s.pRotorCuW,
					(raw) => patch({ pRotorCuW: parseOptionalNumber(raw) }),
					true
				)}
			</div>

			<div class="grid grid-cols-2 gap-2.5 border-t border-border pt-3 sm:grid-cols-3 sm:gap-3">
				{@render numField(
					'im2-pscu',
					'Stator Cu Loss P{cu,s}',
					'W',
					s.pStatorCuW,
					(raw) => patch({ pStatorCuW: parseOptionalNumber(raw) }),
					true
				)}
				{@render numField(
					'im2-pcore',
					'Core Loss P{core}',
					'W',
					s.pCoreW,
					(raw) => patch({ pCoreW: parseOptionalNumber(raw) }),
					true
				)}
				{@render numField(
					'im2-pmech',
					'Mech. Loss P{mech}',
					'W',
					s.pMechW,
					(raw) => patch({ pMechW: parseOptionalNumber(raw) }),
					true
				)}
			</div>
		{:else if questionTypeId === 'QT-IM-3'}
			{@const s = inputState as InductionMotorEquivCircuitInput}
			<div class="grid grid-cols-2 gap-2.5 sm:gap-3">
				{@render segToggle(
					'Equivalent Circuit Model',
					[
						{ value: 'exact-T', label: 'Exact T' },
						{ value: 'approx-cantilever', label: 'Approx. Cantilever' }
					],
					s.model,
					(v) => patch({ model: v })
				)}
				{@render segToggle('Stator Connection', CONN_OPTIONS, s.connection, (v) =>
					patch({ connection: v as ThreePhaseConnection })
				)}
				{@render numField('im3-vl', 'Line Voltage V{L}', 'V', s.vLineV, (raw) =>
					patch({ vLineV: parseRequiredNumber(raw) })
				)}
				{@render numField('im3-p', 'Poles P', '', s.poles, (raw) =>
					patch({ poles: parseRequiredNumber(raw) })
				)}
				{@render numField('im3-f', 'Frequency f{s}', 'Hz', s.frequencyHz, (raw) =>
					patch({ frequencyHz: parseRequiredNumber(raw) })
				)}
				{@render numField('im3-s', 'Operating Slip s', 'pu', s.slip, (raw) =>
					patch({ slip: parseRequiredNumber(raw) })
				)}
			</div>

			<div class="grid grid-cols-2 gap-2.5 border-t border-border pt-3 sm:grid-cols-3 sm:gap-3">
				{@render numField('im3-r1', 'Stator R{1}', 'Ω', s.r1, (raw) =>
					patch({ r1: parseRequiredNumber(raw) })
				)}
				{@render numField('im3-x1', 'Stator X{1}', 'Ω', s.x1, (raw) =>
					patch({ x1: parseRequiredNumber(raw) })
				)}
				{@render numField('im3-r2', 'Rotor R{2}′', 'Ω', s.r2Prime, (raw) =>
					patch({ r2Prime: parseRequiredNumber(raw) })
				)}
				{@render numField('im3-x2', 'Rotor X{2}′', 'Ω', s.x2Prime, (raw) =>
					patch({ x2Prime: parseRequiredNumber(raw) })
				)}
				{@render numField('im3-xm', 'Magnetizing X{m}', 'Ω', s.xm, (raw) =>
					patch({ xm: parseRequiredNumber(raw) })
				)}
				{@render numField(
					'im3-rc',
					'Core Branch R{c}',
					'Ω',
					s.rc,
					(raw) => patch({ rc: parseOptionalNumber(raw) }),
					true
				)}
			</div>

			<div class="grid grid-cols-2 gap-2.5 border-t border-border pt-3 sm:gap-3">
				{@render numField(
					'im3-pc',
					'Lumped Core Loss P{core}',
					'W',
					s.pCoreW,
					(raw) => patch({ pCoreW: parseOptionalNumber(raw) }),
					true
				)}
				{@render numField(
					'im3-pm',
					'Rotational Loss P{mech}',
					'W',
					s.pMechW,
					(raw) => patch({ pMechW: parseOptionalNumber(raw) }),
					true
				)}
			</div>
		{/if}
	</div>
</div>
