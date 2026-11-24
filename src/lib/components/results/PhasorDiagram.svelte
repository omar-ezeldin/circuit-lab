<script module lang="ts">
	export interface CustomPhasor {
		id: string;
		label: string;
		kind: 'voltage' | 'current';
		magnitude: number;
		angleDeg: number;
		unit: string;
		formatted?: string;
	}
</script>

<script lang="ts">
	import { Complex } from '$lib/engine/complex';
	import type { FullSolveResult } from '$lib/engine/types';
	import { formatEngineeringWithSystem } from '$lib/engine/units';
	import { settings } from '$lib/stores/settings.svelte';
	import { cn } from '$lib/utils';
	import {
		formatComplexValue,
		formatPolarQuantity,
		formatRectangularQuantity
	} from './formatters';

	type FilterMode = 'all' | 'voltages' | 'currents';

	type Props = {
		solution?: FullSolveResult | null;
		customPhasors?: CustomPhasor[];
		selectedComponentId?: string | null;
		onSelectComponent?: (id: string) => void;
		class?: string;
	};

	interface PhasorEntry {
		key: string;
		label: string;
		category: 'voltage' | 'current';
		componentId?: string;
		magnitude: number;
		angleDeg: number;
		normalizedRadius: number;
		x2: number;
		y2: number;
		labelX: number;
		labelY: number;
		formatted: string;
		formattedPolar: string;
		magnitudeDisplay: string;
		angleDisplay: string;
		rectDisplay: string;
	}

	let {
		solution = null,
		customPhasors,
		selectedComponentId = null,
		onSelectComponent,
		class: className
	}: Props = $props();

	let filterMode = $state<FilterMode>('all');
	let hoveredKey = $state<string | null>(null);

	const CX = 160;
	const CY = 160;
	const MAX_R = 96;
	const ARROW_LEN = 16;
	const ARROW_HALF_W = 6;
	const LABEL_HALO_COLOR = 'var(--background)';
	const LABEL_BOX_H = 12;

	// Guide ray angles in degrees (30°, 45°, 60°, 120°, 135°, 150°)
	const GUIDE_ANGLES_30 = [30, 60, 120, 150];
	const GUIDE_ANGLES_45 = [45, 135];

	function splitSubscriptLabel(label: string): { base: string; sub: string | null } {
		const idx = label.indexOf('_');
		if (idx <= 0 || idx === label.length - 1) {
			return { base: label, sub: null };
		}
		return {
			base: label.slice(0, idx),
			sub: label.slice(idx + 1).replaceAll('_', '')
		};
	}

	function labelBoxWidth(label: string): number {
		const { base, sub } = splitSubscriptLabel(label);
		return base.length * 5.8 + (sub ? sub.length * 4.4 : 0) + 4;
	}

	function normalizeDeg(deg: number): number {
		let d = deg % 360;
		if (d > 180) d -= 360;
		if (d <= -180) d += 360;
		return d;
	}

	function angleDiffDeg(a: number, b: number): number {
		return Math.abs(normalizeDeg(a - b));
	}

	function formatAngleStr(deg: number, prec: number): string {
		const normalized = normalizeDeg(deg);
		const cleaned = Math.abs(normalized) < 1e-9 ? 0 : normalized;
		if (cleaned === 0) return '0°';
		const rounded = Number(cleaned.toPrecision(prec));
		return `${rounded}°`;
	}

	interface SvgRect {
		x1: number;
		y1: number;
		x2: number;
		y2: number;
	}

	function svgRectsOverlap(a: SvgRect, b: SvgRect, pad = 3): boolean {
		return !(
			a.x2 + pad <= b.x1 ||
			b.x2 + pad <= a.x1 ||
			a.y2 + pad <= b.y1 ||
			b.y2 + pad <= a.y1
		);
	}

	function segmentIntersectsRect(
		x1: number,
		y1: number,
		x2: number,
		y2: number,
		rect: SvgRect,
		pad = 2.5
	): boolean {
		const minX = rect.x1 - pad;
		const maxX = rect.x2 + pad;
		const minY = rect.y1 - pad;
		const maxY = rect.y2 + pad;
		const dx = x2 - x1;
		const dy = y2 - y1;
		let t0 = 0;
		let t1 = 1;
		const checks: Array<[number, number]> = [
			[-dx, x1 - minX],
			[dx, maxX - x1],
			[-dy, y1 - minY],
			[dy, maxY - y1]
		];
		for (const [p, q] of checks) {
			if (Math.abs(p) < 1e-9) {
				if (q < 0) return false;
			} else {
				const t = q / p;
				if (p < 0) {
					if (t > t1) return false;
					if (t > t0) t0 = t;
				} else {
					if (t < t0) return false;
					if (t < t1) t1 = t;
				}
			}
		}
		return t0 <= t1;
	}

	const showVoltages = $derived(filterMode === 'all' || filterMode === 'voltages');
	const showCurrents = $derived(filterMode === 'all' || filterMode === 'currents');

	const phasorData = $derived.by(() => {
		const prec = settings.precision;
		const angleDisplay = settings.angleDisplay;
		const unitSystem = settings.unitSystem;

		interface SourceVector {
			key: string;
			label: string;
			category: 'voltage' | 'current';
			componentId?: string;
			complex: Complex;
			unit: string;
			magnitude: number;
			angleDeg: number;
			rad: number;
			customFormatted?: string;
		}

		const voltageSources: SourceVector[] = [];
		const currentSources: SourceVector[] = [];

		if (customPhasors) {
			for (const p of customPhasors) {
				if (!Number.isFinite(p.magnitude) || p.magnitude <= 1e-12) continue;
				const rad = (p.angleDeg * Math.PI) / 180;
				const c = Complex.fromPolar(p.magnitude, p.angleDeg);
				const vec: SourceVector = {
					key: `${p.kind === 'voltage' ? 'V' : 'I'}:${p.id}`,
					label: p.label,
					category: p.kind,
					complex: c,
					unit: p.unit,
					magnitude: p.magnitude,
					angleDeg: normalizeDeg(p.angleDeg),
					rad,
					customFormatted: p.formatted
				};
				if (p.kind === 'voltage') {
					voltageSources.push(vec);
				} else {
					currentSources.push(vec);
				}
			}
		} else if (solution) {
			const mna = solution.mna;
			const rawVoltages = Object.values(mna.nodeVoltages)
				.filter((n) => !n.isReference && n.voltage.abs() > 1e-12)
				.sort((a, b) => a.nodeId.localeCompare(b.nodeId, undefined, { numeric: true }));

			for (const node of rawVoltages) {
				voltageSources.push({
					key: `V:${node.nodeId}`,
					label: `V_${node.nodeId}`,
					category: 'voltage',
					complex: node.voltage,
					unit: 'V',
					magnitude: node.voltage.abs(),
					angleDeg: node.voltage.argDeg(),
					rad: node.voltage.argRad()
				});
			}

			const rawCurrents = Object.values(mna.branches)
				.filter((b) => b.current.abs() > 1e-12)
				.sort((a, b) => a.label.localeCompare(b.label, undefined, { numeric: true }));

			for (const branch of rawCurrents) {
				currentSources.push({
					key: `I:${branch.componentId}`,
					label: `I_${branch.label}`,
					category: 'current',
					componentId: branch.componentId,
					complex: branch.current,
					unit: 'A',
					magnitude: branch.current.abs(),
					angleDeg: branch.current.argDeg(),
					rad: branch.current.argRad()
				});
			}
		}

		const maxV = voltageSources.reduce((m, v) => Math.max(m, v.magnitude), 0);
		const maxI = currentSources.reduce((m, i) => Math.max(m, i.magnitude), 0);

		interface RawVectorItem {
			key: string;
			label: string;
			category: 'voltage' | 'current';
			componentId?: string;
			magnitude: number;
			angleDeg: number;
			rad: number;
			normalizedRadius: number;
			r: number;
			x2: number;
			y2: number;
			formatted: string;
			formattedPolar: string;
			magnitudeDisplay: string;
			angleDisplay: string;
			rectDisplay: string;
		}

		const rawItems: RawVectorItem[] = [];

		function pushVector(src: SourceVector, maxMag: number) {
			const norm = Math.max(0.18, src.magnitude / maxMag);
			const r = norm * MAX_R;
			const formattedPolar =
				src.customFormatted ?? formatPolarQuantity(src.complex, src.unit, prec, unitSystem);
			const formatted =
				src.customFormatted ??
				formatComplexValue(src.complex, src.unit, 'ac', {
					precision: prec,
					angleDisplay,
					unitSystem
				});
			const magnitudeDisplay = formatEngineeringWithSystem(
				src.magnitude,
				src.unit,
				prec,
				unitSystem
			);
			const angleStr = formatAngleStr(src.angleDeg, prec);
			const rectDisplay = formatRectangularQuantity(src.complex, src.unit, prec, unitSystem);

			rawItems.push({
				key: src.key,
				label: src.label,
				category: src.category,
				componentId: src.componentId,
				magnitude: src.magnitude,
				angleDeg: src.angleDeg,
				rad: src.rad,
				normalizedRadius: norm,
				r,
				x2: CX + r * Math.cos(src.rad),
				y2: CY - r * Math.sin(src.rad),
				formatted,
				formattedPolar,
				magnitudeDisplay,
				angleDisplay: angleStr,
				rectDisplay
			});
		}

		if (showVoltages && maxV > 0) {
			for (const v of voltageSources) pushVector(v, maxV);
		}
		if (showCurrents && maxI > 0) {
			for (const i of currentSources) pushVector(i, maxI);
		}

		const placedLabels: SvgRect[] = [
			// Axis labels (0°, 90°, 180°, 270°) + origin dot
			{ x1: CX + MAX_R + 10, y1: CY - 8, x2: CX + MAX_R + 30, y2: CY + 8 },
			{ x1: CX - 14, y1: CY - MAX_R - 24, x2: CX + 14, y2: CY - MAX_R - 6 },
			{ x1: CX - MAX_R - 36, y1: CY - 8, x2: CX - MAX_R - 10, y2: CY + 8 },
			{ x1: CX - 16, y1: CY + MAX_R + 8, x2: CX + 16, y2: CY + MAX_R + 25 },
			{ x1: CX - 8, y1: CY - 8, x2: CX + 8, y2: CY + 8 }
		];

		function placeVectorLabel(item: RawVectorItem): { lx: number; ly: number } {
			const labelW = labelBoxWidth(item.label);
			const labelH = LABEL_BOX_H;
			const nearCardinal = [0, 90, 180, -180, -90].some((c) => angleDiffDeg(item.angleDeg, c) < 14);
			const hasCollinearOther = rawItems.some(
				(other) => other.key !== item.key && angleDiffDeg(other.angleDeg, item.angleDeg) <= 6
			);

			const offsets: Array<{ dr: number; dDeg: number; bias: number }> = [
				{ dr: 16, dDeg: nearCardinal ? 14 : 0, bias: 0 },
				{ dr: 16, dDeg: -14, bias: 1 },
				{ dr: 16, dDeg: 18, bias: 2 },
				{ dr: 4, dDeg: 20, bias: 3 },
				{ dr: 4, dDeg: -20, bias: 3.5 },
				{ dr: 27, dDeg: nearCardinal ? 12 : 0, bias: 4 },
				{ dr: 14, dDeg: -24, bias: 5 },
				{ dr: 14, dDeg: 24, bias: 6 },
				{ dr: 8, dDeg: 28, bias: 7 },
				{ dr: 8, dDeg: -28, bias: 7.5 },
				{ dr: -14, dDeg: 16, bias: 8 },
				{ dr: -14, dDeg: -16, bias: 9 },
				{ dr: 30, dDeg: -16, bias: 11 },
				{ dr: 30, dDeg: 16, bias: 12 },
				{ dr: 16, dDeg: 36, bias: 14 },
				{ dr: 16, dDeg: -36, bias: 15 }
			];

			let bestX = CX + (item.r + 16) * Math.cos(item.rad);
			let bestY = CY - (item.r + 16) * Math.sin(item.rad);
			let bestScore = Infinity;

			for (const off of offsets) {
				const candR = Math.max(22, Math.min(MAX_R + 28, item.r + off.dr));
				const candRad = item.rad + (off.dDeg * Math.PI) / 180;
				const lx = CX + candR * Math.cos(candRad);
				const ly = CY - candR * Math.sin(candRad);
				const rect: SvgRect = {
					x1: lx - labelW / 2,
					y1: ly - labelH / 2,
					x2: lx + labelW / 2,
					y2: ly + labelH / 2
				};

				let score = off.bias;
				if (rect.x1 < 6 || rect.x2 > 314 || rect.y1 < 6 || rect.y2 > 314) {
					score += 5000;
				}
				for (const other of placedLabels) {
					if (svgRectsOverlap(rect, other, 3)) {
						score += 1000;
					}
				}
				if (hasCollinearOther && Math.abs(off.dDeg) < 10) {
					score += 25;
				}
				for (const seg of rawItems) {
					if (seg.key === item.key) {
						if (segmentIntersectsRect(CX, CY, seg.x2, seg.y2, rect, 1.5)) {
							score += 40;
						}
					} else if (segmentIntersectsRect(CX, CY, seg.x2, seg.y2, rect, 3)) {
						score += 180;
					}
					if (seg.key !== item.key) {
						const tipBackX = seg.x2 - ARROW_LEN * Math.cos(seg.rad);
						const tipBackY = seg.y2 + ARROW_LEN * Math.sin(seg.rad);
						if (segmentIntersectsRect(tipBackX, tipBackY, seg.x2, seg.y2, rect, ARROW_HALF_W)) {
							score += 600;
						}
					}
				}
				if (score < bestScore) {
					bestScore = score;
					bestX = lx;
					bestY = ly;
				}
			}

			placedLabels.push({
				x1: bestX - labelW / 2,
				y1: bestY - labelH / 2,
				x2: bestX + labelW / 2,
				y2: bestY + labelH / 2
			});
			return { lx: bestX, ly: bestY };
		}

		const entries: PhasorEntry[] = rawItems.map((item) => {
			const { lx, ly } = placeVectorLabel(item);
			return {
				key: item.key,
				label: item.label,
				category: item.category,
				componentId: item.componentId,
				magnitude: item.magnitude,
				angleDeg: item.angleDeg,
				normalizedRadius: item.normalizedRadius,
				x2: item.x2,
				y2: item.y2,
				labelX: lx,
				labelY: ly,
				formatted: item.formatted,
				formattedPolar: item.formattedPolar,
				magnitudeDisplay: item.magnitudeDisplay,
				angleDisplay: item.angleDisplay,
				rectDisplay: item.rectDisplay
			};
		});

		return {
			entries,
			voltageCount: voltageSources.length,
			currentCount: currentSources.length
		};
	});

	const activeEntry = $derived.by(() => {
		if (hoveredKey) {
			return phasorData.entries.find((e) => e.key === hoveredKey) ?? null;
		}
		if (selectedComponentId) {
			return phasorData.entries.find((e) => e.componentId === selectedComponentId) ?? null;
		}
		return null;
	});

	const uid = $props.id();
	const arrowVoltageId = `${uid}-arrow-v`;
	const arrowCurrentId = `${uid}-arrow-i`;
</script>

<div class={cn('flex min-w-0 flex-col gap-3', className)}>
	<!-- Filter Pills: All | Voltages | Currents -->
	<div class="flex flex-wrap items-center justify-between gap-2">
		<div
			role="radiogroup"
			aria-label="Filter phasor vectors"
			class="inline-flex w-full shrink-0 items-center rounded-[4px] border border-border bg-muted/80 p-0.5 sm:w-auto"
		>
			<button
				type="button"
				role="radio"
				aria-checked={filterMode === 'all'}
				onclick={() => (filterMode = 'all')}
				class={cn(
					'inline-flex min-h-11 flex-1 cursor-pointer items-center justify-center gap-1 rounded-[3px] border px-2.5 text-xs transition-colors duration-150 sm:flex-initial lg:min-h-0 lg:h-6 lg:px-2 lg:text-[11px]',
					'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring',
					filterMode === 'all'
						? 'border-border/80 bg-card font-semibold text-foreground shadow-2xs'
						: 'border-transparent font-medium text-muted-foreground hover:text-foreground'
				)}
			>
				<span>All</span>
			</button>
			<button
				type="button"
				role="radio"
				aria-checked={filterMode === 'voltages'}
				onclick={() => (filterMode = 'voltages')}
				class={cn(
					'inline-flex min-h-11 flex-1 cursor-pointer items-center justify-center gap-1.5 rounded-[3px] border px-2.5 text-xs transition-colors duration-150 sm:flex-initial lg:min-h-0 lg:h-6 lg:px-2 lg:text-[11px]',
					'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring',
					filterMode === 'voltages'
						? 'border-voltage/40 bg-card font-semibold text-voltage shadow-2xs'
						: 'border-transparent font-medium text-muted-foreground hover:text-foreground'
				)}
			>
				<span class="size-1.5 shrink-0 rounded-full bg-voltage" aria-hidden="true"></span>
				<span>Voltages</span>
			</button>
			<button
				type="button"
				role="radio"
				aria-checked={filterMode === 'currents'}
				onclick={() => (filterMode = 'currents')}
				class={cn(
					'inline-flex min-h-11 flex-1 cursor-pointer items-center justify-center gap-1.5 rounded-[3px] border px-2.5 text-xs transition-colors duration-150 sm:flex-initial lg:min-h-0 lg:h-6 lg:px-2 lg:text-[11px]',
					'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring',
					filterMode === 'currents'
						? 'border-branch-current/40 bg-card font-semibold text-branch-current shadow-2xs'
						: 'border-transparent font-medium text-muted-foreground hover:text-foreground'
				)}
			>
				<span class="size-1.5 shrink-0 rounded-full bg-branch-current" aria-hidden="true"></span>
				<span>Currents</span>
			</button>
		</div>

		{#if activeEntry}
			{@const activeParts = splitSubscriptLabel(activeEntry.label)}
			<div
				class="font-engineering flex w-full min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5 rounded-[4px] border border-border bg-surface-rail/60 px-2.5 py-1 text-[11px] text-foreground sm:w-auto sm:px-2 sm:py-0.5"
			>
				<span
					class={cn(
						'shrink-0 font-semibold',
						activeEntry.category === 'voltage' ? 'text-voltage' : 'text-branch-current'
					)}
				>
					{activeParts.base}{#if activeParts.sub}<sub>{activeParts.sub}</sub>{/if}
				</span>
				<span class="min-w-0 break-words">{activeEntry.formatted}</span>
			</div>
		{:else}
			<span class="text-[11px] text-muted-foreground">
				Normalized per group · Hover or tap vector
			</span>
		{/if}
	</div>

	<div class="flex flex-col gap-3">
		<!-- Crisp Polar Plot -->
		<div class="mx-auto w-full max-w-[300px] sm:max-w-[280px]">
			<svg
				viewBox="0 0 320 320"
				role="img"
				aria-label="AC Polar Phasor Diagram showing voltage and current phasors"
				class="h-auto w-full rounded-[4px] border border-border bg-background select-none"
			>
				<title>AC Polar Phasor Diagram</title>
				<desc>
					Concentric polar reference rings with 0, 90, 180, and 270 degree axes and 30/45 degree
					guides. Voltage phasors are drawn in cobalt blue and current phasors in emerald green.
				</desc>

				<defs>
					<marker
						id={arrowVoltageId}
						viewBox="0 0 10 10"
						refX="8"
						refY="5"
						markerWidth="6"
						markerHeight="6"
						orient="auto-start-reverse"
					>
						<path d="M 0 1.5 L 9 5 L 0 8.5 z" fill="var(--voltage)" />
					</marker>
					<marker
						id={arrowCurrentId}
						viewBox="0 0 10 10"
						refX="8"
						refY="5"
						markerWidth="6"
						markerHeight="6"
						orient="auto-start-reverse"
					>
						<path d="M 0 1.5 L 9 5 L 0 8.5 z" fill="var(--current)" />
					</marker>
				</defs>

				<!-- Concentric reference circles -->
				{#each [0.33, 0.66, 1] as frac (frac)}
					<circle
						cx={CX}
						cy={CY}
						r={MAX_R * frac}
						fill="none"
						stroke="var(--border)"
						stroke-width={frac === 1 ? 1.25 : 1}
						stroke-dasharray={frac === 1 ? undefined : '3 3'}
					/>
				{/each}

				<!-- Subtle 30° / 60° / 120° / 150° guides (aligns with 3-phase ±120° vectors) -->
				{#each GUIDE_ANGLES_30 as deg (deg)}
					{@const rad = (deg * Math.PI) / 180}
					<line
						x1={CX - MAX_R * Math.cos(rad)}
						y1={CY + MAX_R * Math.sin(rad)}
						x2={CX + MAX_R * Math.cos(rad)}
						y2={CY - MAX_R * Math.sin(rad)}
						stroke="var(--border)"
						stroke-opacity="0.65"
						stroke-width="0.65"
						stroke-dasharray="2 4"
					/>
				{/each}

				<!-- Diagonal 45° / 135° guides -->
				{#each GUIDE_ANGLES_45 as deg (deg)}
					{@const rad = (deg * Math.PI) / 180}
					<line
						x1={CX - MAX_R * Math.cos(rad)}
						y1={CY + MAX_R * Math.sin(rad)}
						x2={CX + MAX_R * Math.cos(rad)}
						y2={CY - MAX_R * Math.sin(rad)}
						stroke="var(--border)"
						stroke-width="0.75"
						stroke-dasharray="2 3"
					/>
				{/each}

				<!-- Primary 0° / 90° / 180° / 270° axes -->
				<line
					x1={CX - MAX_R - 10}
					y1={CY}
					x2={CX + MAX_R + 10}
					y2={CY}
					stroke="var(--muted-foreground)"
					stroke-opacity="0.45"
					stroke-width="1"
				/>
				<line
					x1={CX}
					y1={CY - MAX_R - 10}
					x2={CX}
					y2={CY + MAX_R + 10}
					stroke="var(--muted-foreground)"
					stroke-opacity="0.45"
					stroke-width="1"
				/>

				<!-- Axis angle labels -->
				<g
					fill="var(--muted-foreground)"
					font-family="var(--font-mono)"
					font-size="10"
					font-weight="500"
				>
					<text x={CX + MAX_R + 14} y={CY + 3} text-anchor="start">0°</text>
					<text x={CX} y={CY - MAX_R - 14} text-anchor="middle">90°</text>
					<text x={CX - MAX_R - 14} y={CY + 3} text-anchor="end">180°</text>
					<text x={CX} y={CY + MAX_R + 20} text-anchor="middle">270°</text>
				</g>

				<!-- Label hit targets beneath vector shafts -->
				<g aria-hidden="true">
					{#each phasorData.entries as entry (entry.key)}
						{@const boxW = labelBoxWidth(entry.label)}
						<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
						<rect
							x={entry.labelX - boxW / 2}
							y={entry.labelY - LABEL_BOX_H / 2}
							width={boxW}
							height={LABEL_BOX_H}
							fill="transparent"
							class={entry.componentId ? 'cursor-pointer' : undefined}
							onmouseenter={() => (hoveredKey = entry.key)}
							onmouseleave={() => (hoveredKey = null)}
							onclick={() => {
								if (entry.componentId) onSelectComponent?.(entry.componentId);
							}}
						/>
					{/each}
				</g>

				<!-- Phasor vectors -->
				{#each phasorData.entries as entry (entry.key)}
					{@const isHovered = hoveredKey === entry.key}
					{@const isSelected = Boolean(entry.componentId && selectedComponentId === entry.componentId)}
					{@const isDimmed = hoveredKey !== null && !isHovered}
					{@const strokeColor = entry.category === 'voltage' ? 'var(--voltage)' : 'var(--current)'}
					{@const markerUrl =
						entry.category === 'voltage' ? `url(#${arrowVoltageId})` : `url(#${arrowCurrentId})`}

					{@const labelParts = splitSubscriptLabel(entry.label)}
					<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
					<g
						role={entry.componentId ? 'button' : undefined}
						tabindex={entry.componentId ? 0 : undefined}
						aria-label={`${labelParts.base}${labelParts.sub ?? ''}: ${entry.formattedPolar}`}
						class={cn(
							'transition-opacity duration-150',
							entry.componentId && 'cursor-pointer',
							isDimmed ? 'opacity-25' : 'opacity-100'
						)}
						onmouseenter={() => (hoveredKey = entry.key)}
						onmouseleave={() => (hoveredKey = null)}
						onfocus={() => (hoveredKey = entry.key)}
						onblur={() => (hoveredKey = null)}
						onclick={() => {
							if (entry.componentId) onSelectComponent?.(entry.componentId);
						}}
						onkeydown={(e) => {
							if (entry.componentId && (e.key === 'Enter' || e.key === ' ')) {
								e.preventDefault();
								onSelectComponent?.(entry.componentId);
							}
						}}
					>
						<line
							x1={CX}
							y1={CY}
							x2={entry.x2}
							y2={entry.y2}
							stroke="transparent"
							stroke-width="12"
						/>
						<line
							x1={CX}
							y1={CY}
							x2={entry.x2}
							y2={entry.y2}
							stroke={strokeColor}
							stroke-width={isHovered || isSelected ? 2.75 : 1.85}
							stroke-dasharray={entry.category === 'current' ? '5 2.5' : undefined}
							marker-end={markerUrl}
						/>
					</g>
				{/each}

				<circle cx={CX} cy={CY} r="2.75" fill="var(--foreground)" />

				<!-- Collision-avoided vector labels -->
				<g pointer-events="none">
					{#each phasorData.entries as entry (entry.key)}
						{@const isHovered = hoveredKey === entry.key}
						{@const isSelected = Boolean(entry.componentId && selectedComponentId === entry.componentId)}
						{@const isDimmed = hoveredKey !== null && !isHovered}
						{@const strokeColor = entry.category === 'voltage' ? 'var(--voltage)' : 'var(--current)'}
						{@const parts = splitSubscriptLabel(entry.label)}
						<text
							x={entry.labelX}
							y={entry.labelY}
							text-anchor="middle"
							dominant-baseline="central"
							fill={strokeColor}
							style="stroke: {LABEL_HALO_COLOR};"
							stroke-width="3.5"
							stroke-linejoin="round"
							paint-order="stroke"
							font-family="var(--font-mono)"
							font-size="9.5"
							font-weight={isHovered || isSelected ? '700' : '600'}
							class={cn('transition-opacity duration-150', isDimmed ? 'opacity-25' : 'opacity-100')}
						>
							{parts.base}{#if parts.sub}<tspan dy="2.5" font-size="75%">{parts.sub}</tspan>{/if}
						</text>
					{/each}
				</g>
			</svg>
		</div>

		<!-- Phasor Legend Table (Symbol | Magnitude | Angle ° | Rect a + jb) -->
		<div class="flex flex-col">
			{#if phasorData.entries.length === 0}
				<p class="rounded-[4px] border border-border bg-surface-rail/40 px-3 py-2.5 text-xs text-muted-foreground">
					No non-zero phasors visible for the selected filter.
				</p>
			{:else}
				<div class="max-h-[260px] overflow-x-auto overflow-y-auto rounded-[4px] border border-border">
					<table class="w-full border-collapse text-left text-[11px]">
						<thead class="sticky top-0 z-10 border-b border-border bg-surface-rail text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
							<tr>
								<th class="py-1.5 pl-2.5 pr-1.5">Symbol</th>
								<th class="px-1.5 py-1.5 text-right">Magnitude</th>
								<th class="px-1.5 py-1.5 text-right">Angle</th>
								<th class="py-1.5 pl-1.5 pr-2.5 text-right">Rect (a + jb)</th>
							</tr>
						</thead>
						<tbody class="divide-y divide-border font-engineering">
							{#each phasorData.entries as entry (entry.key)}
								{@const isSelected = Boolean(entry.componentId && selectedComponentId === entry.componentId)}
								{@const isHovered = hoveredKey === entry.key}
								{@const parts = splitSubscriptLabel(entry.label)}
								<tr
									tabindex={entry.componentId ? 0 : undefined}
									onmouseenter={() => (hoveredKey = entry.key)}
									onmouseleave={() => (hoveredKey = null)}
									onclick={() => {
										if (entry.componentId) {
											onSelectComponent?.(entry.componentId);
										} else {
											hoveredKey = hoveredKey === entry.key ? null : entry.key;
										}
									}}
									onkeydown={(e) => {
										if (entry.componentId && (e.key === 'Enter' || e.key === ' ')) {
											e.preventDefault();
											onSelectComponent?.(entry.componentId);
										}
									}}
									class={cn(
										'cursor-pointer transition-colors duration-150',
										isSelected || isHovered
											? 'bg-primary/10'
											: 'bg-transparent hover:bg-accent/40'
									)}
								>
									<td class="whitespace-nowrap py-2 pl-2.5 pr-1.5 lg:py-1.5">
										<span class="inline-flex items-center gap-1.5">
											<span
												class={cn(
													'h-2 w-2 shrink-0 rounded-full',
													entry.category === 'voltage' ? 'bg-voltage' : 'bg-branch-current'
												)}
												aria-hidden="true"
											></span>
											<span class="font-semibold text-foreground">{parts.base}{#if parts.sub}<sub>{parts.sub}</sub>{/if}</span>
										</span>
									</td>
									<td
										class={cn(
											'whitespace-nowrap px-1.5 py-2 text-right font-medium tabular-nums lg:py-1.5',
											entry.category === 'voltage' ? 'text-voltage' : 'text-branch-current'
										)}
									>
										{entry.magnitudeDisplay}
									</td>
									<td class="whitespace-nowrap px-1.5 py-2 text-right tabular-nums text-foreground lg:py-1.5">
										{entry.angleDisplay}
									</td>
									<td class="whitespace-nowrap py-2 pl-1.5 pr-2.5 text-right tabular-nums text-muted-foreground lg:py-1.5">
										{entry.rectDisplay}
									</td>
								</tr>
							{/each}
						</tbody>
					</table>
				</div>
			{/if}
		</div>
	</div>
</div>
