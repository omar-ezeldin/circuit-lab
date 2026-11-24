<script lang="ts">
	import { Check, Download, RotateCcw, Share } from 'lucide-svelte';
	import { CircuitSymbol } from '$lib/components/symbols';
	import { Badge, Button, Dialog, Label, Separator, Switch } from '$lib/components/ui';
	import { UNIT_SYSTEMS } from '$lib/engine';
	import { AC_ENABLED } from '$lib/env';
	import { pwa } from '$lib/stores/pwa.svelte';
	import {
		settings,
		type AcMagnitudeMode,
		type AngleDisplay,
		type DisplayPrecision,
		type SchematicStandard,
		type UnitSystemId
	} from '$lib/stores/settings.svelte';
	import { cn } from '$lib/utils';

	type Props = {
		open?: boolean;
	};

	let { open = $bindable(false) }: Props = $props();

	const SYMBOL_OPTIONS: Array<{ value: SchematicStandard; title: string; subtitle: string }> = [
		{ value: 'ieee', title: 'IEEE / ANSI', subtitle: 'Zigzag resistor (Default)' },
		{ value: 'iec', title: 'IEC 60617', subtitle: 'Rectangular resistor' }
	];

	const UNIT_SYSTEM_OPTIONS: Array<{ value: UnitSystemId; title: string; subtitle: string }> = [
		{ value: 'auto', title: 'Auto SI', subtitle: 'Best-fit prefixes' },
		{ value: 'ohm-v-a', title: 'Ω · V · A', subtitle: 'Base SI (W)' },
		{ value: 'kohm-v-ma', title: 'kΩ · V · mA', subtitle: 'Electronics (mW)' },
		{ value: 'mohm-v-ua', title: 'MΩ · V · µA', subtitle: 'High-Z (µW)' }
	];

	const ANGLE_OPTIONS: Array<{ value: AngleDisplay; label: string; example: string }> = [
		{ value: 'polar', label: 'Polar', example: '12.4∠-36.9° V' },
		{ value: 'rectangular', label: 'Rectangular', example: '9.92 - j7.45 V' },
		{ value: 'both', label: 'Both', example: 'Polar + Rect' }
	];

	const PRECISION_OPTIONS: DisplayPrecision[] = [2, 3, 4];

	const AC_MAG_OPTIONS: Array<{ value: AcMagnitudeMode; label: string; detail: string }> = [
		{ value: 'rms', label: 'RMS', detail: 'Effective value (Default)' },
		{ value: 'peak', label: 'Peak', detail: 'Amplitude V_m / I_m' }
	];
</script>

<Dialog
	bind:open
	title="Preferences &amp; Engineering Standards"
	description="Configure schematic symbols, phasor notation, numerical precision, and canvas overlays."
	class="sm:max-w-xl"
>
	<div class="flex flex-col gap-5">
		<!-- Schematic Symbol Standard -->
		<section class="flex flex-col gap-2">
			<Label>Schematic Symbol Standard</Label>
			<div class="grid grid-cols-1 gap-2 sm:grid-cols-2">
				{#each SYMBOL_OPTIONS as opt (opt.value)}
					{@const active = settings.schematicStandard === opt.value}
					<button
						type="button"
						onclick={() => (settings.schematicStandard = opt.value)}
						aria-pressed={active}
						class={cn(
							'flex min-h-11 cursor-pointer items-center justify-between gap-3 rounded-[4px] border p-3 text-left transition-colors duration-150 sm:min-h-0',
							'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
							active
								? 'border-primary bg-primary/8'
								: 'border-border bg-background/50 hover:border-foreground/25 hover:bg-accent/40'
						)}
					>
						<div class="flex flex-col gap-0.5">
							<span class="text-xs font-semibold text-foreground">{opt.title}</span>
							<span class="text-[11px] text-muted-foreground">{opt.subtitle}</span>
						</div>
						<CircuitSymbol
							kind="resistor"
							variant="schematic"
							standard={opt.value}
							class="h-6 w-14 shrink-0 text-foreground"
						/>
					</button>
				{/each}
			</div>
		</section>

		<Separator />

		<!-- Unit System -->
		<section class="flex flex-col gap-2">
			<Label>Unit System</Label>
			<div class="grid grid-cols-2 gap-2 sm:grid-cols-4">
				{#each UNIT_SYSTEM_OPTIONS as opt (opt.value)}
					{@const active = settings.unitSystem === opt.value}
					<button
						type="button"
						onclick={() => (settings.unitSystem = opt.value)}
						aria-pressed={active}
						title={UNIT_SYSTEMS[opt.value].description}
						class={cn(
							'flex min-h-11 cursor-pointer flex-col justify-center gap-0.5 rounded-[4px] border px-2.5 py-2 text-left transition-colors duration-150 sm:min-h-0',
							'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
							active
								? 'border-primary bg-primary/8 text-foreground'
								: 'border-border bg-background/50 text-muted-foreground hover:border-foreground/25 hover:bg-accent/40 hover:text-foreground'
						)}
					>
						<span class="font-engineering text-xs font-semibold text-foreground">{opt.title}</span>
						<span class="text-[11px] text-muted-foreground">{opt.subtitle}</span>
					</button>
				{/each}
			</div>
		</section>

		<Separator />

		<!-- Complex Number Display (AC) -->
		<section class="flex flex-col gap-2">
			<div class="flex items-center gap-2">
				<Label class={cn(!AC_ENABLED && 'text-muted-foreground')}>Complex Number Display (AC)</Label>
				{#if !AC_ENABLED}
					<span class="rounded-[3px] border border-border bg-surface-rail px-1.5 py-0.5 font-engineering text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
						Coming Soon
					</span>
				{/if}
			</div>
			<div class="grid grid-cols-1 gap-2 sm:grid-cols-3">
				{#each ANGLE_OPTIONS as opt (opt.value)}
					{@const active = settings.angleDisplay === opt.value}
					<button
						type="button"
						disabled={!AC_ENABLED}
						aria-disabled={!AC_ENABLED ? 'true' : undefined}
						title={!AC_ENABLED ? 'AC Phasor Analysis — Coming Soon' : undefined}
						onclick={() => {
							if (!AC_ENABLED) return;
							settings.angleDisplay = opt.value;
						}}
						aria-pressed={active}
						class={cn(
							'flex min-h-11 flex-col justify-center gap-0.5 rounded-[4px] border px-3 py-2 text-left transition-colors duration-150 sm:min-h-0',
							'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
							!AC_ENABLED
								? 'cursor-not-allowed border-border bg-background/40 text-muted-foreground opacity-55'
								: active
									? 'cursor-pointer border-primary bg-primary/8 text-foreground'
									: 'cursor-pointer border-border bg-background/50 text-muted-foreground hover:border-foreground/25 hover:bg-accent/40 hover:text-foreground'
						)}
					>
						<span
							class={cn(
								'text-xs font-semibold',
								!AC_ENABLED ? 'text-muted-foreground' : 'text-foreground'
							)}
						>
							{opt.label}
						</span>
						<span class="font-engineering text-[11px] text-muted-foreground">{opt.example}</span>
					</button>
				{/each}
			</div>
		</section>

		<!-- Decimal Precision & AC Magnitude Convention -->
		<div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
			<section class="flex flex-col gap-2">
				<Label>Significant Digits</Label>
				<div class="grid grid-cols-3 gap-1.5">
					{#each PRECISION_OPTIONS as prec (prec)}
						{@const active = settings.precision === prec}
						<button
							type="button"
							onclick={() => (settings.precision = prec)}
							aria-pressed={active}
							class={cn(
								'font-engineering min-h-11 cursor-pointer rounded-[4px] border px-2.5 py-1.5 text-center text-xs font-medium transition-colors duration-150 sm:min-h-0',
								'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
								active
									? 'border-primary bg-primary/8 text-primary'
									: 'border-border bg-background/50 text-foreground hover:border-foreground/25 hover:bg-accent/40'
							)}
						>
							{prec} digits
						</button>
					{/each}
				</div>
			</section>

			<section class="flex flex-col gap-2">
				<div class="flex items-center gap-2">
					<Label class={cn(!AC_ENABLED && 'text-muted-foreground')}>AC Magnitude Convention</Label>
					{#if !AC_ENABLED}
						<span class="rounded-[3px] border border-border bg-surface-rail px-1.5 py-0.5 font-engineering text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
							Coming Soon
						</span>
					{/if}
				</div>
				<div class="grid grid-cols-2 gap-1.5">
					{#each AC_MAG_OPTIONS as opt (opt.value)}
						{@const active = settings.acMagnitudeMode === opt.value}
						<button
							type="button"
							disabled={!AC_ENABLED}
							aria-disabled={!AC_ENABLED ? 'true' : undefined}
							onclick={() => {
								if (!AC_ENABLED) return;
								settings.acMagnitudeMode = opt.value;
							}}
							aria-pressed={active}
							title={!AC_ENABLED ? 'AC Phasor Analysis — Coming Soon' : opt.detail}
							class={cn(
								'min-h-11 rounded-[4px] border px-2.5 py-1.5 text-center text-xs font-medium transition-colors duration-150 sm:min-h-0',
								'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
								!AC_ENABLED
									? 'cursor-not-allowed border-border bg-background/40 text-muted-foreground opacity-55'
									: active
										? 'cursor-pointer border-primary bg-primary/8 text-primary'
										: 'cursor-pointer border-border bg-background/50 text-foreground hover:border-foreground/25 hover:bg-accent/40'
							)}
						>
							{opt.label}
						</button>
					{/each}
				</div>
			</section>
		</div>

		<Separator />

		<!-- Switches -->
		<section class="flex flex-col gap-3">
			<div class="flex min-h-11 items-center justify-between gap-4 py-1 sm:min-h-0 sm:py-0">
				<div class="flex flex-col gap-0.5">
					<Label for="setting-dc-fractions">Show Exact DC Fractions</Label>
					<span class="text-[11px] text-muted-foreground">
						Display rational values alongside decimals (e.g. <code class="font-engineering">10/3 V = 3.33 V</code>)
					</span>
				</div>
				<Switch
					id="setting-dc-fractions"
					checked={settings.showDcFractions}
					onCheckedChange={(v) => (settings.showDcFractions = v)}
				/>
			</div>

			<div class="flex min-h-11 items-center justify-between gap-4 py-1 sm:min-h-0 sm:py-0">
				<div class="flex flex-col gap-0.5">
					<Label for="setting-show-grid">Canvas Engineering Grid</Label>
					<span class="text-[11px] text-muted-foreground">
						Show 20 px dot/major grid lines on the schematic workspace
					</span>
				</div>
				<Switch
					id="setting-show-grid"
					checked={settings.showGrid}
					onCheckedChange={(v) => (settings.showGrid = v)}
				/>
			</div>

			<div class="flex min-h-11 items-center justify-between gap-4 py-1 sm:min-h-0 sm:py-0">
				<div class="flex flex-col gap-0.5">
					<Label for="setting-snap-grid">Snap to 20 px Grid</Label>
					<span class="text-[11px] text-muted-foreground">
						Align component pins and orthogonal wire bends to grid coordinates
					</span>
				</div>
				<Switch
					id="setting-snap-grid"
					checked={settings.snapToGrid}
					onCheckedChange={(v) => (settings.snapToGrid = v)}
				/>
			</div>

			<div class="flex min-h-11 items-center justify-between gap-4 py-1 sm:min-h-0 sm:py-0">
				<div class="flex flex-col gap-0.5">
					<Label for="setting-live-overlays">Live Voltage &amp; Current Overlays</Label>
					<span class="text-[11px] text-muted-foreground">
						Render solved node voltages and branch current badges directly on the schematic
					</span>
				</div>
				<Switch
					id="setting-live-overlays"
					checked={settings.showLiveOverlays}
					onCheckedChange={(v) => (settings.showLiveOverlays = v)}
				/>
			</div>
		</section>

		<Separator />

		<!-- Install App (PWA) -->
		<section class="flex flex-col gap-2">
			<Label>Install App</Label>
			<div class="flex min-h-11 flex-wrap items-center justify-between gap-3 rounded-[4px] border border-border bg-background/50 px-3 py-2.5">
				<div class="flex min-w-0 flex-col gap-0.5">
					<span class="text-xs font-semibold text-foreground">Circuit Lab Offline Workbench</span>
					{#if pwa.isInstalled}
						<span class="text-[11px] text-muted-foreground">
							Running as an installed standalone application with offline support.
						</span>
					{:else if pwa.canInstall}
						<span class="text-[11px] text-muted-foreground">
							Install on your device for instant launch and full offline solving.
						</span>
					{:else if pwa.isIosSafari}
						<span class="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
							<Share class="size-3 shrink-0" aria-hidden="true" />
							<span>Tap Share → Add to Home Screen</span>
						</span>
					{:else}
						<span class="text-[11px] text-muted-foreground">
							Offline-ready. Use your browser menu to install on supported devices.
						</span>
					{/if}
				</div>

				{#if pwa.isInstalled}
					<Badge variant="success" class="shrink-0 gap-1">
						<Check class="size-3" aria-hidden="true" />
						<span>Installed</span>
					</Badge>
				{:else if pwa.canInstall}
					<Button
						variant="default"
						size="sm"
						disabled={pwa.installing}
						onclick={() => void pwa.promptInstall()}
						class="min-h-11 shrink-0 sm:min-h-0"
					>
						<Download class="size-3.5" aria-hidden="true" />
						<span>{pwa.installing ? 'Installing…' : 'Install Circuit Lab'}</span>
					</Button>
				{/if}
			</div>
		</section>
	</div>

	{#snippet footer()}
		<div class="flex w-full flex-wrap items-center justify-between gap-2">
			<Button variant="ghost" size="sm" onclick={() => settings.reset()} class="min-h-11 sm:min-h-0">
				<RotateCcw class="size-3.5" aria-hidden="true" />
				Reset to Defaults
			</Button>
			<Button variant="default" size="sm" onclick={() => (open = false)} class="min-h-11 sm:min-h-0">
				Done
			</Button>
		</div>
	{/snippet}
</Dialog>
