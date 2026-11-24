<script lang="ts">
	import { untrack } from 'svelte';
	import {
		Complex,
		formatEngineering,
		parseDirectImpedance,
		parseEngineeringNumber
	} from '$lib/engine';
	import { settings } from '$lib/stores/settings.svelte';
	import { formatImpedanceDisplay } from './helpers';

	type ImpedanceForm = 'pure' | 'lossy';

	type Props = {
		kind: 'inductor' | 'capacitor';
		value: string;
		isAcMode: boolean;
		disabled?: boolean;
		idPrefix?: string;
		onCommit: (nextValue: string) => void;
	};

	let {
		kind,
		value,
		isAcMode,
		disabled = false,
		idPrefix = 'comp-impedance',
		onCommit
	}: Props = $props();

	function formatEditableEngineering(n: number, prec = 6): string {
		const cleaned = Math.abs(n) < 1e-12 ? 0 : n;
		if (cleaned === 0) return '0';
		return formatEngineering(cleaned, '', prec).replace(/\s+/g, '').replace(/µ/g, 'u');
	}

	function resolveIncomingZ(compKind: 'inductor' | 'capacitor', rawValue: string): Complex {
		const parsed = parseDirectImpedance({
			kind: compKind,
			value: rawValue,
			unit: 'Ω',
			valueMode: 'impedance'
		});
		if (parsed) return parsed;
		return Complex.from(0, compKind === 'inductor' ? 1 : -1);
	}

	function detectInitialForm(compKind: 'inductor' | 'capacitor', z: Complex): ImpedanceForm {
		if (Math.abs(z.re) >= 1e-12) return 'lossy';
		if (compKind === 'inductor' && z.im <= 0) return 'lossy';
		if (compKind === 'capacitor' && z.im >= 0) return 'lossy';
		return 'pure';
	}

	function draftsFromZ(z: Complex) {
		const pureMag = Math.abs(z.im) > 1e-12 ? Math.abs(z.im) : 1;
		return {
			pureMagDraft: formatEditableEngineering(pureMag, 6),
			rDraft: formatEditableEngineering(Math.max(0, z.re), 6),
			xDraft: formatEditableEngineering(z.im, 6)
		};
	}

	const initialSnapshot = untrack(() => {
		const z = resolveIncomingZ(kind, value);
		return {
			form: detectInitialForm(kind, z),
			drafts: draftsFromZ(z),
			key: `${kind}|${value}`
		};
	});

	let formMode = $state<ImpedanceForm>(initialSnapshot.form);
	let pureMagDraft = $state(initialSnapshot.drafts.pureMagDraft);
	let rDraft = $state(initialSnapshot.drafts.rDraft);
	let xDraft = $state(initialSnapshot.drafts.xDraft);

	let focusedField = $state<string | null>(null);
	let lastSyncedKey = $state(initialSnapshot.key);

	$effect(() => {
		const key = `${kind}|${value}`;
		if (!focusedField && key !== lastSyncedKey) {
			const z = resolveIncomingZ(kind, value);
			const next = draftsFromZ(z);
			pureMagDraft = next.pureMagDraft;
			rDraft = next.rDraft;
			xDraft = next.xDraft;
			formMode = detectInitialForm(kind, z);
			lastSyncedKey = key;
		}
	});

	type Evaluation =
		| {
				valid: true;
				mode: 'pure';
				z: Complex;
				mag: number;
		  }
		| {
				valid: true;
				mode: 'lossy';
				z: Complex;
				r: number;
				x: number;
		  }
		| {
				valid: false;
				error: string;
		  };

	const evaluation = $derived.by<Evaluation>(() => {
		if (formMode === 'pure') {
			const trimmed = pureMagDraft.trim();
			if (!trimmed) {
				return { valid: false, error: 'Reactance magnitude is required' };
			}
			const mag = parseEngineeringNumber(trimmed);
			if (mag === null || !Number.isFinite(mag) || mag <= 0) {
				return {
					valid: false,
					error: 'Enter a positive reactance magnitude (e.g. 1, 50, 2k, 500m)'
				};
			}
			const signedX = kind === 'inductor' ? mag : -mag;
			return {
				valid: true,
				mode: 'pure',
				z: Complex.from(0, signedX),
				mag
			};
		}

		const rTrim = rDraft.trim();
		const xTrim = xDraft.trim();
		if (!rTrim || !xTrim) {
			return { valid: false, error: 'Resistance (R) and reactance (X) are required' };
		}
		const r = parseEngineeringNumber(rTrim);
		const x = parseEngineeringNumber(xTrim);
		if (r === null || !Number.isFinite(r) || r < 0) {
			return { valid: false, error: 'Resistance R must be ≥ 0 (e.g. 0, 2, 100m, 1k)' };
		}
		if (x === null || !Number.isFinite(x)) {
			return { valid: false, error: 'Enter a valid reactance X (e.g. 1, -2, 50, -20)' };
		}
		if (Math.abs(r) < 1e-12 && Math.abs(x) < 1e-12) {
			return { valid: false, error: 'Impedance cannot be zero' };
		}
		return {
			valid: true,
			mode: 'lossy',
			z: Complex.from(r, x),
			r,
			x
		};
	});

	const formattedReadout = $derived.by(() => {
		if (!evaluation.valid) return '';
		return formatImpedanceDisplay(evaluation.z, settings.unitSystem, settings.precision);
	});

	function buildCanonicalPure(compKind: 'inductor' | 'capacitor', mag: number): string {
		const magStr = formatEditableEngineering(mag, 6);
		return compKind === 'inductor' ? `j${magStr}` : `-j${magStr}`;
	}

	function buildCanonicalLossy(r: number, x: number): string {
		const rClean = Math.abs(r) < 1e-12 ? 0 : r;
		const xClean = Math.abs(x) < 1e-12 ? 0 : x;
		const rStr = formatEditableEngineering(rClean, 6);
		const xAbsStr = formatEditableEngineering(Math.abs(xClean), 6);

		if (rClean === 0) {
			return xClean >= 0 ? `j${xAbsStr}` : `-j${xAbsStr}`;
		}
		if (xClean === 0) {
			return `${rStr}+j0`;
		}
		return xClean > 0 ? `${rStr}+j${xAbsStr}` : `${rStr}-j${xAbsStr}`;
	}

	function revertDrafts() {
		const z = resolveIncomingZ(kind, value);
		const next = draftsFromZ(z);
		pureMagDraft = next.pureMagDraft;
		rDraft = next.rDraft;
		xDraft = next.xDraft;
	}

	function commitIfValid() {
		if (disabled) return;
		if (!evaluation.valid) {
			revertDrafts();
			return;
		}

		if (evaluation.mode === 'pure') {
			const nextVal = buildCanonicalPure(kind, evaluation.mag);
			pureMagDraft = formatEditableEngineering(evaluation.mag, 6);
			if (nextVal !== value.trim()) {
				lastSyncedKey = `${kind}|${nextVal}`;
				onCommit(nextVal);
			}
			return;
		}

		const nextVal = buildCanonicalLossy(evaluation.r, evaluation.x);
		rDraft = formatEditableEngineering(Math.abs(evaluation.r) < 1e-12 ? 0 : evaluation.r, 6);
		xDraft = formatEditableEngineering(Math.abs(evaluation.x) < 1e-12 ? 0 : evaluation.x, 6);
		if (nextVal !== value.trim()) {
			lastSyncedKey = `${kind}|${nextVal}`;
			onCommit(nextVal);
		}
	}

	function switchForm(nextForm: ImpedanceForm) {
		if (nextForm === formMode || disabled) return;
		const currentZ = evaluation.valid ? evaluation.z : resolveIncomingZ(kind, value);

		if (nextForm === 'lossy') {
			rDraft = formatEditableEngineering(Math.max(0, currentZ.re), 6);
			xDraft = formatEditableEngineering(currentZ.im, 6);
			formMode = 'lossy';
			return;
		}

		const mag = Math.abs(currentZ.im) > 1e-12 ? Math.abs(currentZ.im) : 1;
		pureMagDraft = formatEditableEngineering(mag, 6);
		formMode = 'pure';

		const nextVal = buildCanonicalPure(kind, mag);
		if (nextVal !== value.trim()) {
			lastSyncedKey = `${kind}|${nextVal}`;
			onCommit(nextVal);
		}
	}

	function handleFocus(field: string) {
		focusedField = field;
	}

	function handleBlur(field: string) {
		if (focusedField === field) {
			focusedField = null;
		}
		commitIfValid();
	}

	function handleKeyDown(e: KeyboardEvent) {
		if (e.key === 'Enter') {
			e.preventDefault();
			commitIfValid();
			(e.currentTarget as HTMLInputElement).blur();
		} else if (e.key === 'Escape') {
			e.preventDefault();
			revertDrafts();
			(e.currentTarget as HTMLInputElement).blur();
		}
	}

	const inputBaseClass =
		'font-engineering flex h-11 min-h-11 w-full rounded-[4px] border bg-card px-2.5 py-1 text-base text-foreground transition-colors duration-150 placeholder:text-muted-foreground/80 hover:border-muted-foreground/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-1 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:bg-muted disabled:opacity-50 lg:h-8 lg:min-h-0 lg:px-2 lg:text-xs';
</script>

<div class="flex flex-col gap-1.5" role="group" aria-label="Impedance (Z)">
	<div class="flex flex-wrap items-center justify-between gap-1.5">
		<span class="text-xs font-medium text-foreground">Impedance (Z)</span>
		<div
			role="radiogroup"
			aria-label="Impedance form"
			class="grid h-auto min-h-11 grid-cols-2 gap-0.5 rounded-[4px] border border-border bg-surface-rail p-0.5 lg:h-7 lg:min-h-0"
		>
			<button
				type="button"
				role="radio"
				aria-checked={formMode === 'pure'}
				{disabled}
				onclick={() => switchForm('pure')}
				class={`font-engineering min-h-11 cursor-pointer rounded-[3px] border px-2 text-xs font-medium transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 lg:h-full lg:min-h-0 lg:text-[11px] ${
					formMode === 'pure'
						? 'border-border bg-card text-foreground'
						: 'border-transparent text-muted-foreground hover:text-foreground'
				}`}
			>
				Pure jX
			</button>
			<button
				type="button"
				role="radio"
				aria-checked={formMode === 'lossy'}
				{disabled}
				onclick={() => switchForm('lossy')}
				class={`font-engineering min-h-11 cursor-pointer rounded-[3px] border px-2 text-xs font-medium transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 lg:h-full lg:min-h-0 lg:text-[11px] ${
					formMode === 'lossy'
						? 'border-border bg-card text-foreground'
						: 'border-transparent text-muted-foreground hover:text-foreground'
				}`}
			>
				R + jX
			</button>
		</div>
	</div>

	{#if formMode === 'pure'}
		<div class="relative flex flex-col gap-1">
			<label for={`${idPrefix}-pure`} class="sr-only">
				{kind === 'inductor' ? 'Inductive reactance magnitude' : 'Capacitive reactance magnitude'}
			</label>
			<div
				class={`flex h-auto min-h-11 w-full items-stretch overflow-hidden rounded-[4px] border bg-card transition-colors duration-150 focus-within:ring-2 focus-within:ring-offset-1 focus-within:ring-offset-background lg:h-8 lg:min-h-0 ${
					!evaluation.valid
						? 'border-destructive focus-within:ring-destructive'
						: 'border-input hover:border-muted-foreground/50 focus-within:ring-ring'
				}`}
			>
				<span
					aria-hidden="true"
					class="flex shrink-0 items-center justify-center border-r border-input bg-surface-rail px-2.5 font-engineering text-sm font-semibold text-foreground select-none lg:px-2 lg:text-xs"
				>
					{kind === 'inductor' ? '+j' : '−j'}
				</span>
				<input
					id={`${idPrefix}-pure`}
					type="text"
					autocomplete="off"
					autocapitalize="off"
					autocorrect="off"
					spellcheck={false}
					placeholder="e.g. 1, 50, 2k"
					{disabled}
					bind:value={pureMagDraft}
					aria-invalid={!evaluation.valid ? 'true' : undefined}
					onfocus={() => handleFocus('pure')}
					onblur={() => handleBlur('pure')}
					onkeydown={handleKeyDown}
					class="font-engineering min-h-11 min-w-0 flex-1 bg-transparent px-2.5 py-1 text-base text-foreground placeholder:text-muted-foreground/80 focus:outline-none disabled:cursor-not-allowed disabled:opacity-50 lg:h-full lg:min-h-0 lg:px-2 lg:text-xs"
				/>
				<span
					aria-hidden="true"
					class="flex shrink-0 items-center pr-3 font-engineering text-xs text-muted-foreground select-none lg:pr-2.5 lg:text-[11px]"
				>
					Ω
				</span>
			</div>
		</div>
	{:else}
		<div class="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-end gap-1.5">
			<div class="flex min-w-0 flex-col gap-1">
				<label for={`${idPrefix}-r`} class="text-[11px] font-medium text-muted-foreground">
					R (≥ 0)
				</label>
				<input
					id={`${idPrefix}-r`}
					type="text"
					autocomplete="off"
					autocapitalize="off"
					autocorrect="off"
					spellcheck={false}
					placeholder="e.g. 2"
					{disabled}
					bind:value={rDraft}
					aria-invalid={!evaluation.valid ? 'true' : undefined}
					onfocus={() => handleFocus('r')}
					onblur={() => handleBlur('r')}
					onkeydown={handleKeyDown}
					class={`${inputBaseClass} ${
						!evaluation.valid
							? 'border-destructive focus-visible:ring-destructive'
							: 'border-input focus-visible:ring-ring'
					}`}
				/>
			</div>

			<span
				aria-hidden="true"
				class="flex h-11 items-center justify-center px-0.5 font-engineering text-xs font-semibold text-muted-foreground select-none lg:h-8"
			>
				+ j
			</span>

			<div class="flex min-w-0 flex-col gap-1">
				<label for={`${idPrefix}-x`} class="text-[11px] font-medium text-muted-foreground">
					X
				</label>
				<div class="relative flex items-center">
					<input
						id={`${idPrefix}-x`}
						type="text"
						autocomplete="off"
						autocapitalize="off"
						autocorrect="off"
						spellcheck={false}
						placeholder={kind === 'inductor' ? 'e.g. 1, 50' : 'e.g. -1, -20'}
						{disabled}
						bind:value={xDraft}
						aria-invalid={!evaluation.valid ? 'true' : undefined}
						onfocus={() => handleFocus('x')}
						onblur={() => handleBlur('x')}
						onkeydown={handleKeyDown}
						class={`${inputBaseClass} pr-8 lg:pr-7 ${
							!evaluation.valid
								? 'border-destructive focus-visible:ring-destructive'
								: 'border-input focus-visible:ring-ring'
						}`}
					/>
					<span
						aria-hidden="true"
						class="pointer-events-none absolute right-2.5 font-engineering text-xs text-muted-foreground select-none lg:right-2 lg:text-[11px]"
					>
						Ω
					</span>
				</div>
			</div>
		</div>
	{/if}

	{#if !evaluation.valid}
		<p class="text-[11px] leading-tight text-destructive" role="alert">
			{evaluation.error}
		</p>
	{:else if !isAcMode}
		<p class="text-[11px] leading-tight text-muted-foreground">
			DC steady state: {kind === 'capacitor'
				? 'open circuit (I = 0 A)'
				: 'short circuit (V = 0 V)'}
		</p>
	{:else if formattedReadout}
		<p class="font-engineering text-[11px] leading-tight text-muted-foreground">
			= {formattedReadout}
		</p>
	{/if}
</div>
