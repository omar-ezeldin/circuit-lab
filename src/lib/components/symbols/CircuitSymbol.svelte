<script lang="ts">
	import type { SVGAttributes } from 'svelte/elements';
	import { settings, type SchematicStandard } from '$lib/stores/settings.svelte';
	import { cn } from '$lib/utils';
	import {
		SYMBOL_PIN_OFFSETS,
		type SourceMode,
		type SymbolKind,
		type SymbolRotation,
		type SymbolVariant
	} from './catalog';

	type Props = {
		kind: SymbolKind;
		variant?: SymbolVariant;
		standard?: SchematicStandard;
		sourceMode?: SourceMode;
		terminalLabel?: string;
		/** Optional schematic rotation so inner instrument letters (e.g. voltmeter "V") stay upright. */
		rotation?: SymbolRotation;
		/**
		 * When true in `variant === 'schematic'`, renders only an inner `<g>` centered at `(0, 0)`
		 * so the symbol can be embedded inside an outer schematic `<svg>` transform group.
		 */
		asGroup?: boolean;
		size?: number | string;
		class?: string;
	} & Omit<SVGAttributes<SVGSVGElement>, 'class' | 'width' | 'height'>;

	let {
		kind,
		variant = 'icon',
		standard,
		sourceMode = 'dc',
		terminalLabel,
		rotation = 0,
		asGroup = false,
		size,
		class: className,
		...restProps
	}: Props = $props();

	const activeStandard = $derived(standard ?? settings.schematicStandard);
	const spec = $derived(SYMBOL_PIN_OFFSETS[kind]);
	const iconSize = $derived(size ?? 20);
</script>

{#snippet symbolPaths()}
	{#if variant === 'icon'}
		{#if kind === 'resistor'}
			{#if activeStandard === 'ieee'}
				<path
					d="M 2 12 L 4.5 12 L 5.75 8 L 8.25 16 L 10.75 8 L 13.25 16 L 15.75 8 L 18.25 16 L 19.5 12 L 22 12"
				/>
			{:else}
				<path d="M 2 12 L 6 12" />
				<rect x="6" y="8.5" width="12" height="7" />
				<path d="M 18 12 L 22 12" />
			{/if}
		{:else if kind === 'capacitor'}
			<path d="M 2 12 L 10 12" />
			<path d="M 10 5.5 L 10 18.5" />
			<path d="M 14 5.5 L 14 18.5" />
			<path d="M 14 12 L 22 12" />
		{:else if kind === 'inductor'}
			<path
				d="M 2 12 L 4 12 A 2 3.2 0 0 1 8 12 A 2 3.2 0 0 1 12 12 A 2 3.2 0 0 1 16 12 A 2 3.2 0 0 1 20 12 L 22 12"
			/>
		{:else if kind === 'voltage_source'}
			<path d="M 2 12 L 4.5 12" />
			<circle cx="12" cy="12" r="7.5" />
			<path d="M 19.5 12 L 22 12" />
			{#if sourceMode === 'dc'}
				<path d="M 7.5 12 L 10.5 12 M 9 10.5 L 9 13.5" />
				<path d="M 13.5 12 L 16.5 12" />
			{:else}
				<path d="M 7.5 12 C 8.7 8.8, 10.8 8.8, 12 12 C 13.2 15.2, 15.3 15.2, 16.5 12" />
				<circle cx="3.2" cy="8.2" r="1" fill="currentColor" stroke="none" />
			{/if}
		{:else if kind === 'current_source'}
			<path d="M 2 12 L 4.5 12" />
			<circle cx="12" cy="12" r="7.5" />
			<path d="M 19.5 12 L 22 12" />
			<path d="M 7.5 12 L 16.5 12" />
			<path d="M 13.5 9 L 16.5 12 L 13.5 15" />
		{:else if kind === 'vcvs' || kind === 'ccvs'}
			<path d="M 2 12 L 4.5 12" />
			<path d="M 12 4.5 L 19.5 12 L 12 19.5 L 4.5 12 Z" />
			<path d="M 19.5 12 L 22 12" />
			<path d="M 7.5 12 L 10.5 12 M 9 10.5 L 9 13.5" />
			<path d="M 13.5 12 L 16.5 12" />
		{:else if kind === 'vccs' || kind === 'cccs'}
			<path d="M 2 12 L 4.5 12" />
			<path d="M 12 4.5 L 19.5 12 L 12 19.5 L 4.5 12 Z" />
			<path d="M 19.5 12 L 22 12" />
			<path d="M 8 12 L 16 12" />
			<path d="M 13 9.5 L 16 12 L 13 14.5" />
		{:else if kind === 'ground'}
			<path d="M 12 4 L 12 11" />
			<path d="M 5.5 11 L 18.5 11" />
			<path d="M 8 15 L 16 15" />
			<path d="M 10.5 19 L 13.5 19" />
		{:else if kind === 'terminal'}
			<path d="M 3 12 L 8 12" />
			<circle cx="12.5" cy="12" r="4.5" />
			{#if terminalLabel}
				<text
					x="19"
					y="8.5"
					text-anchor="middle"
					fill="currentColor"
					stroke="none"
					font-family="var(--font-mono, ui-monospace, monospace)"
					font-size="7"
					font-weight="600"
				>
					{terminalLabel}
				</text>
			{/if}
		{:else if kind === 'voltmeter'}
			<path d="M 2 12 L 4.5 12" />
			<circle cx="12" cy="12" r="7.5" />
			<path d="M 19.5 12 L 22 12" />
			<path d="M 9.2 8.7 L 12 15.6 L 14.8 8.7" />
		{:else if kind === 'wire'}
			<circle cx="4.5" cy="16.5" r="2" />
			<path d="M 6.5 16.5 L 12 16.5 L 12 7.5 L 17.5 7.5" />
			<circle cx="19.5" cy="7.5" r="2" />
		{:else if kind === 'probe'}
			<path d="M 4 20 L 9.5 14.5" />
			<path d="M 7.8 12.8 L 11.2 16.2" />
			<path d="M 9.5 14.5 L 15.5 8.5" />
			<circle cx="17.25" cy="6.75" r="2.25" />
		{/if}
	{:else}
		<!-- Precision schematic geometry: 2-terminal pins at (-40, 0) & (+40, 0); 1-terminal pin at (0, 0) -->
		{#if kind === 'resistor'}
			{#if activeStandard === 'ieee'}
				<path
					d="M -40 0 L -21 0 L -17.5 -7 L -10.5 7 L -3.5 -7 L 3.5 7 L 10.5 -7 L 17.5 7 L 21 0 L 40 0"
				/>
			{:else}
				<path d="M -40 0 L -18 0" />
				<rect x="-18" y="-7" width="36" height="14" />
				<path d="M 18 0 L 40 0" />
			{/if}
		{:else if kind === 'capacitor'}
			<path d="M -40 0 L -4 0" />
			<path d="M -4 -12 L -4 12" />
			<path d="M 4 -12 L 4 12" />
			<path d="M 4 0 L 40 0" />
		{:else if kind === 'inductor'}
			<path
				d="M -40 0 L -20 0 A 5 6 0 0 1 -10 0 A 5 6 0 0 1 0 0 A 5 6 0 0 1 10 0 A 5 6 0 0 1 20 0 L 40 0"
			/>
		{:else if kind === 'voltage_source'}
			<path d="M -40 0 L -15 0" />
			<circle cx="0" cy="0" r="15" />
			<path d="M 15 0 L 40 0" />
			{#if sourceMode === 'dc'}
				<path d="M -10 0 L -4 0 M -7 -3 L -7 3" />
				<path d="M 4 0 L 10 0" />
			{:else}
				<path d="M -8 0 C -6 -6, -2 -6, 0 0 C 2 6, 6 6, 8 0" />
				<circle cx="-18.5" cy="-6.5" r="1.5" fill="currentColor" stroke="none" />
			{/if}
		{:else if kind === 'current_source'}
			<path d="M -40 0 L -15 0" />
			<circle cx="0" cy="0" r="15" />
			<path d="M 15 0 L 40 0" />
			<path d="M -9 0 L 9 0" />
			<path d="M 4 -4.5 L 9 0 L 4 4.5" />
		{:else if kind === 'vcvs' || kind === 'ccvs'}
			<path d="M -40 0 L -16 0" />
			<path d="M 0 -16 L 16 0 L 0 16 L -16 0 Z" />
			<path d="M 16 0 L 40 0" />
			<path d="M -10 0 L -4 0 M -7 -3 L -7 3" />
			<path d="M 4 0 L 10 0" />
		{:else if kind === 'vccs' || kind === 'cccs'}
			<path d="M -40 0 L -16 0" />
			<path d="M 0 -16 L 16 0 L 0 16 L -16 0 Z" />
			<path d="M 16 0 L 40 0" />
			<path d="M -9 0 L 9 0" />
			<path d="M 4 -4.5 L 9 0 L 4 4.5" />
		{:else if kind === 'ground'}
			<path d="M 0 0 L 0 8" />
			<path d="M -11 8 L 11 8" />
			<path d="M -7 12.5 L 7 12.5" />
			<path d="M -3 17 L 3 17" />
		{:else if kind === 'terminal'}
			<circle cx="0" cy="0" r="4.5" />
			{#if terminalLabel}
				<text
					x="10.5"
					y="-7"
					text-anchor="middle"
					fill="currentColor"
					stroke="none"
					font-family="var(--font-mono, ui-monospace, monospace)"
					font-size="9"
					font-weight="600"
				>
					{terminalLabel}
				</text>
			{/if}
		{:else if kind === 'voltmeter'}
			<path d="M -40 0 L -16 0" />
			<circle cx="0" cy="0" r="16" />
			<path d="M 16 0 L 40 0" />
			<g transform={rotation ? `rotate(${-rotation})` : undefined}>
				<path d="M -5.5 -6 L 0 6.5 L 5.5 -6" />
			</g>
			<!-- Polarity markers near pin 0 (+) and pin 1 (−) -->
			<g transform="translate(-23, -9) {rotation ? `rotate(${-rotation})` : ''}" stroke-width="1.5">
				<path d="M -3 0 L 3 0 M 0 -3 L 0 3" />
			</g>
			<g transform="translate(23, -9) {rotation ? `rotate(${-rotation})` : ''}" stroke-width="1.5">
				<path d="M -3 0 L 3 0" />
			</g>
		{:else if kind === 'wire'}
			<path d="M -40 0 L 40 0" />
		{:else if kind === 'probe'}
			<path d="M 0 0 L 5 -5" />
			<path d="M 3.5 -6.5 L 6.5 -3.5" />
			<path d="M 5 -5 L 11.5 -11.5" />
			<circle cx="13.5" cy="-13.5" r="2.25" />
		{/if}
	{/if}
{/snippet}

{#if variant === 'schematic' && asGroup}
	<g
		data-symbol-kind={kind}
		data-symbol-standard={activeStandard}
		fill="none"
		stroke="currentColor"
		stroke-width="1.75"
		stroke-linecap="round"
		stroke-linejoin="round"
		class={className}
	>
		{@render symbolPaths()}
	</g>
{:else}
	<svg
		viewBox={variant === 'icon' ? '0 0 24 24' : spec.viewBox}
		width={variant === 'icon' ? iconSize : spec.width}
		height={variant === 'icon' ? iconSize : spec.height}
		fill="none"
		stroke="currentColor"
		stroke-width="1.75"
		stroke-linecap="round"
		stroke-linejoin="round"
		data-symbol-kind={kind}
		data-symbol-variant={variant}
		data-symbol-standard={activeStandard}
		class={cn('shrink-0', className)}
		{...restProps}
	>
		{@render symbolPaths()}
	</svg>
{/if}
