<script lang="ts">
	import type { MachineCategory, MachineQuestionTypeId } from '$lib/machines';
	import { cn } from '$lib/utils';

	type Props = {
		category: MachineCategory;
		questionTypeId?: MachineQuestionTypeId;
		class?: string;
	};

	let { category, questionTypeId, class: className }: Props = $props();

	const isGenerator = $derived(questionTypeId === 'QT-DC-2');

	const diagramMeta = $derived.by(() => {
		switch (category) {
			case 'three-phase':
				return {
					label: 'Balanced three-phase Y/Δ source, line impedance, and Y-star load schematic',
					caption: '3-Phase Y / Δ System'
				};
			case 'magnetic':
				return {
					label:
						questionTypeId === 'QT-MAG-3'
							? 'Variable-reluctance actuator C-core with helical coil, movable armature, air gaps, and magnetic force'
							: questionTypeId === 'QT-MAG-2'
								? 'Three-limb ferromagnetic E-core with helical excitation coil and center-limb air gap'
								: 'Ferromagnetic C-core with helical excitation coil, magnetic flux path, and air gap',
					caption:
						questionTypeId === 'QT-MAG-3'
							? 'Variable-Reluctance Actuator'
							: questionTypeId === 'QT-MAG-2'
								? '3-Limb E-Core Circuit'
								: 'Ferromagnetic Core & Air Gap'
				};
			case 'transformer':
				return {
					label: 'Single-phase transformer referred equivalent circuit with shunt Rc || jXm and series Re + jXe',
					caption:
						questionTypeId === 'QT-XFMR-2'
							? 'OC / SC Test Equivalent'
							: 'Referred Equivalent Circuit'
				};
			case 'dc-machines':
				return {
					label: 'DC machine equivalent circuit with armature Ea, Ra, shunt field Rf and Lf, and terminal voltage Vt',
					caption:
						questionTypeId === 'QT-DC-2'
							? 'DC Generator Equivalent'
							: questionTypeId === 'QT-DC-3'
								? 'DC Motor Speed Control'
								: 'DC Armature & Field Model'
				};
			case 'induction-motor':
				return {
					label: 'Three-phase induction motor per-phase equivalent circuit with R1, jX1, jXm, air-gap power Pg, jX2 prime, and variable R2 prime over s',
					caption:
						questionTypeId === 'QT-IM-2'
							? 'Per-Phase Power Flow'
							: 'Per-Phase Equivalent Circuit'
				};
		}
	});

	function resistorHPath(x: number, y: number, len: number, amp = 6.5): string {
		const lead = Math.min(4, len * 0.1);
		const dx = (len - 2 * lead) / 12;
		const x0 = x + lead;
		return [
			`M${x} ${y}`,
			`H${x0}`,
			`L${x0 + dx} ${y - amp}`,
			`L${x0 + 3 * dx} ${y + amp}`,
			`L${x0 + 5 * dx} ${y - amp}`,
			`L${x0 + 7 * dx} ${y + amp}`,
			`L${x0 + 9 * dx} ${y - amp}`,
			`L${x0 + 11 * dx} ${y + amp}`,
			`L${x0 + 12 * dx} ${y}`,
			`H${x + len}`
		].join(' ');
	}

	function resistorVPath(x: number, y: number, len: number, amp = 6.5): string {
		const lead = Math.min(4, len * 0.1);
		const dy = (len - 2 * lead) / 12;
		const y0 = y + lead;
		return [
			`M${x} ${y}`,
			`V${y0}`,
			`L${x - amp} ${y0 + dy}`,
			`L${x + amp} ${y0 + 3 * dy}`,
			`L${x - amp} ${y0 + 5 * dy}`,
			`L${x + amp} ${y0 + 7 * dy}`,
			`L${x - amp} ${y0 + 9 * dy}`,
			`L${x + amp} ${y0 + 11 * dy}`,
			`L${x} ${y0 + 12 * dy}`,
			`V${y + len}`
		].join(' ');
	}

	function inductorHPath(x: number, y: number, len: number): string {
		const lead = Math.min(2, len * 0.06);
		const r = (len - 2 * lead) / 8;
		const d = 2 * r;
		return `M${x} ${y} H${x + lead} a${r} ${r} 0 0 1 ${d} 0 a${r} ${r} 0 0 1 ${d} 0 a${r} ${r} 0 0 1 ${d} 0 a${r} ${r} 0 0 1 ${d} 0 H${x + len}`;
	}

	function inductorVPath(
		x: number,
		y: number,
		len: number,
		dir: 'right' | 'left' = 'right'
	): string {
		const lead = Math.min(2, len * 0.06);
		const r = (len - 2 * lead) / 8;
		const d = 2 * r;
		const sweep = dir === 'right' ? 1 : 0;
		return `M${x} ${y} V${y + lead} a${r} ${r} 0 0 ${sweep} 0 ${d} a${r} ${r} 0 0 ${sweep} 0 ${d} a${r} ${r} 0 0 ${sweep} 0 ${d} a${r} ${r} 0 0 ${sweep} 0 ${d} V${y + len}`;
	}
</script>

{#snippet resistorH(x: number, y: number, len: number, amp = 6.5)}
	<path d={resistorHPath(x, y, len, amp)} />
{/snippet}

{#snippet resistorV(x: number, y: number, len: number, amp = 6.5)}
	<path d={resistorVPath(x, y, len, amp)} />
{/snippet}

{#snippet inductorH(x: number, y: number, len: number)}
	<path d={inductorHPath(x, y, len)} />
{/snippet}

{#snippet inductorV(x: number, y: number, len: number, dir: 'right' | 'left' = 'right')}
	<path d={inductorVPath(x, y, len, dir)} />
{/snippet}

{#snippet terminal(cx: number, cy: number)}
	<circle cx={cx} cy={cy} r="3.2" fill="var(--card)" stroke="var(--voltage)" stroke-width="1.6" />
{/snippet}

{#snippet junction(cx: number, cy: number)}
	<circle cx={cx} cy={cy} r="2.8" fill="currentColor" stroke="none" />
{/snippet}

{#snippet helicalCoil(
	xLeft: number,
	xRight: number,
	yTop: number,
	turns: number,
	pitch: number,
	leadX: number
)}
	{@const pad = 5}
	{@const xl = xLeft - pad}
	{@const xr = xRight + pad}
	{@const xm = (xl + xr) / 2}
	{@const yBottom = yTop + turns * pitch}
	{@const indices = Array.from({ length: turns }, (_, i) => i)}

	<!-- Back half-turns (subtle dashed) seamlessly connecting each front turn to the next -->
	{#each indices as i (i)}
		{@const yA = yTop + i * pitch}
		{@const yB = yA + pitch * 0.52}
		{@const yNext = yA + pitch}
		<path
			d="M{xr} {yB} Q{xm} {yNext - pitch * 0.14} {xl} {yNext}"
			stroke="var(--current)"
			stroke-opacity="0.42"
			stroke-dasharray="3 2.5"
			stroke-width="1.4"
		/>
	{/each}

	<!-- Coil top & bottom leads -->
	<path d="M{leadX} {yTop} H{xl} M{leadX} {yBottom} H{xl}" stroke="var(--current)" stroke-width="1.7" />

	<!-- Front half-turns (solid continuous helix) -->
	{#each indices as i (i)}
		{@const yA = yTop + i * pitch}
		{@const yB = yA + pitch * 0.52}
		<path
			d="M{xl} {yA} Q{xm} {yA + pitch * 0.16} {xr} {yB}"
			stroke="var(--current)"
			stroke-width="2"
		/>
	{/each}

	<!-- Open coil terminals -->
	<circle cx={leadX} cy={yTop} r="3.2" fill="var(--card)" stroke="var(--current)" stroke-width="1.6" />
	<circle cx={leadX} cy={yBottom} r="3.2" fill="var(--card)" stroke="var(--current)" stroke-width="1.6" />

	<!-- Polarity & excitation current arrow -->
	<text x={leadX - 10} y={yTop + 4} class="diagram-label-current" text-anchor="end">+</text>
	<text x={leadX - 10} y={yBottom + 4} class="diagram-label-current" text-anchor="end">−</text>
	<path
		d="M{leadX + 8} {yTop - 10} H{xl - 6}"
		stroke="var(--current)"
		stroke-width="1.45"
		marker-end="url(#md-arrow-current)"
	/>
	<text x={(leadX + xl) / 2} y={yTop - 18} class="diagram-label-current" text-anchor="middle">I</text>
	<text x={(leadX + xl) / 2} y={(yTop + yBottom) / 2 + 5} class="diagram-label-current" text-anchor="middle">
		N
	</text>
{/snippet}

<figure
	class={cn(
		'flex flex-col overflow-hidden rounded-[4px] border border-border bg-card',
		className
	)}
>
	<div class="flex items-center justify-between gap-2 border-b border-border bg-surface-rail/60 px-3 py-1.5">
		<span class="shrink-0 whitespace-nowrap text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
			Schematic
		</span>
		<span class="min-w-0 truncate text-right font-engineering text-[11px] text-muted-foreground">
			{diagramMeta.caption}
		</span>
	</div>

	<div class="flex items-center justify-center px-3 py-2.5 sm:px-4 sm:py-3">
		<svg
			viewBox="0 0 460 192"
			role="img"
			aria-label={diagramMeta.label}
			class="mx-auto block h-auto w-full max-w-[540px] select-none text-foreground"
			fill="none"
			stroke="currentColor"
			stroke-width="1.6"
			stroke-linecap="round"
			stroke-linejoin="round"
		>
			<defs>
				<marker
					id="md-arrow-current"
					viewBox="0 0 10 8"
					refX="8.5"
					refY="4"
					markerWidth="7"
					markerHeight="5.6"
					orient="auto-start-reverse"
				>
					<path d="M1 1 L9 4 L1 7 Z" fill="var(--current)" stroke="none" />
				</marker>
				<marker
					id="md-arrow-voltage"
					viewBox="0 0 10 8"
					refX="8.5"
					refY="4"
					markerWidth="6.5"
					markerHeight="5.2"
					orient="auto-start-reverse"
				>
					<path d="M1 1 L9 4 L1 7 Z" fill="var(--voltage)" stroke="none" />
				</marker>
				<marker
					id="md-arrow-flux"
					viewBox="0 0 10 8"
					refX="8.5"
					refY="4"
					markerWidth="7"
					markerHeight="5.6"
					orient="auto-start-reverse"
				>
					<path d="M1 1 L9 4 L1 7 Z" fill="var(--voltage)" stroke="none" />
				</marker>
				<marker
					id="md-arrow-warning"
					viewBox="0 0 10 8"
					refX="8.5"
					refY="4"
					markerWidth="6.8"
					markerHeight="5.4"
					orient="auto-start-reverse"
				>
					<path d="M1 1 L9 4 L1 7 Z" fill="var(--warning)" stroke="none" />
				</marker>
				<marker
					id="md-arrow-muted"
					viewBox="0 0 10 8"
					refX="8.5"
					refY="4"
					markerWidth="6"
					markerHeight="4.8"
					orient="auto-start-reverse"
				>
					<path d="M1 1 L9 4 L1 7 Z" fill="var(--muted-foreground)" stroke="none" />
				</marker>
				<marker
					id="md-arrow-fg"
					viewBox="0 0 10 8"
					refX="8.5"
					refY="4"
					markerWidth="6.5"
					markerHeight="5.2"
					orient="auto-start-reverse"
				>
					<path d="M1 1 L9 4 L1 7 Z" fill="currentColor" stroke="none" />
				</marker>
				<pattern
					id="md-core-hatch"
					width="8"
					height="8"
					patternUnits="userSpaceOnUse"
					patternTransform="rotate(45)"
				>
					<rect width="8" height="8" fill="var(--surface-rail)" stroke="none" />
					<line x1="0" y1="0" x2="0" y2="8" stroke="var(--border)" stroke-width="1.35" />
				</pattern>
			</defs>

			{#if category === 'three-phase'}
				<!-- Neutral bus (left Y-source) -->
				<path d="M58 42 H34 V154 H58 M34 98 H58" stroke="var(--muted-foreground)" />
				{@render junction(34, 98)}
				<text x="23" y="102" class="diagram-label-muted" text-anchor="end">n</text>

				<!-- 3-Phase Y Source circles -->
				<circle cx="72" cy="42" r="14" fill="var(--card)" stroke="var(--voltage)" />
				<circle cx="72" cy="98" r="14" fill="var(--card)" stroke="var(--voltage)" />
				<circle cx="72" cy="154" r="14" fill="var(--card)" stroke="var(--voltage)" />
				<path d="M65 42 q3.5 -6 7 0 t7 0" stroke="var(--voltage)" stroke-width="1.35" />
				<path d="M65 98 q3.5 -6 7 0 t7 0" stroke="var(--voltage)" stroke-width="1.35" />
				<path d="M65 154 q3.5 -6 7 0 t7 0" stroke="var(--voltage)" stroke-width="1.35" />

				<!-- Phase identifiers a, b, c -->
				<text x="97" y="36" class="diagram-label-muted" text-anchor="middle">a</text>
				<text x="97" y="92" class="diagram-label-muted" text-anchor="middle">b</text>
				<text x="97" y="148" class="diagram-label-muted" text-anchor="middle">c</text>

				<!-- Horizontal conductors to Z_line -->
				<path d="M86 42 H148" />
				<path d="M86 98 H148" />
				<path d="M86 154 H148" />

				<!-- Line current I_L arrow on phase a -->
				<path
					d="M108 29 H138"
					stroke="var(--current)"
					stroke-width="1.5"
					marker-end="url(#md-arrow-current)"
				/>
				<text x="123" y="21" class="diagram-label-current" text-anchor="middle">
					I<tspan dy="3.5" font-size="72%">L</tspan>
				</text>

				<!-- IEEE Line Impedances Z_line (R + jX) on phases a, b, c -->
				{@render resistorH(148, 42, 38, 5)}
				{@render inductorH(186, 42, 36)}
				{@render resistorH(148, 98, 38, 5)}
				{@render inductorH(186, 98, 36)}
				{@render resistorH(148, 154, 38, 5)}
				{@render inductorH(186, 154, 36)}
				<text x="185" y="25" class="diagram-label-sm" text-anchor="middle">
					Z<tspan dy="3.5" font-size="72%">line</tspan>
				</text>

				<!-- Horizontal conductors from Z_line to load boundary (exact y=42, 98, 154) -->
				<path d="M222 42 H296" />
				<path d="M222 98 H296" />
				<path d="M222 154 H296" />

				<!-- Double-headed V_L dimension line between phases a and b -->
				<text x="247" y="55" class="diagram-label-voltage" text-anchor="end">+</text>
				<text x="247" y="92" class="diagram-label-voltage" text-anchor="end">−</text>
				<path
					d="M256 50 V90"
					stroke="var(--voltage)"
					stroke-width="1.35"
					marker-start="url(#md-arrow-voltage)"
					marker-end="url(#md-arrow-voltage)"
				/>
				<text x="265" y="75" class="diagram-label-voltage" text-anchor="start">
					V<tspan dy="3.5" font-size="72%">L</tspan>
				</text>

				<!-- Balanced Y-Star Load Container -->
				<rect
					x="296"
					y="16"
					width="150"
					height="162"
					rx="4"
					fill="var(--surface-rail)"
					fill-opacity="0.45"
					stroke="var(--border)"
					stroke-dasharray="4 3"
					stroke-width="1.2"
				/>

				<!-- Subtle Y / Δ badge -->
				<rect x="398" y="22" width="42" height="20" rx="3" fill="var(--card)" stroke="var(--border)" stroke-width="1.15" />
				<text x="419" y="36" class="diagram-label-muted" text-anchor="middle">Y / Δ</text>

				<!-- Load entry wires (exact horizontal alignment at y=42, 98, 154) -->
				<path d="M296 42 H314 M296 98 H314 M296 154 H314" />
				{@render terminal(296, 42)}
				{@render terminal(296, 98)}
				{@render terminal(296, 154)}

				<!-- Phase load impedance blocks Z_φ -->
				<rect x="314" y="32" width="46" height="20" rx="2.5" fill="var(--card)" stroke="currentColor" />
				<rect x="314" y="88" width="46" height="20" rx="2.5" fill="var(--card)" stroke="currentColor" />
				<rect x="314" y="144" width="46" height="20" rx="2.5" fill="var(--card)" stroke="currentColor" />
				<text x="337" y="46" class="diagram-label-sm" text-anchor="middle">
					Z<tspan dy="3" font-size="72%">φ</tspan>
				</text>
				<text x="337" y="102" class="diagram-label-sm" text-anchor="middle">
					Z<tspan dy="3" font-size="72%">φ</tspan>
				</text>
				<text x="337" y="158" class="diagram-label-sm" text-anchor="middle">
					Z<tspan dy="3" font-size="72%">φ</tspan>
				</text>

				<!-- Y-star neutral legs converging to star point N -->
				<path d="M360 42 H374 L414 98" />
				<path d="M360 98 H414" />
				<path d="M360 154 H374 L414 98" />
				{@render junction(414, 98)}
				<text x="424" y="102" class="diagram-label-muted" text-anchor="start">N</text>

				<!-- Subtle bottom section labels -->
				<text x="72" y="185" class="diagram-label-muted" text-anchor="middle">3φ Source</text>
			{:else if category === 'magnetic'}
				{#if questionTypeId === 'QT-MAG-2'}
					<!-- 3-Limb E-Core with Center Limb Air Gap & Ferromagnetic Hatching -->
					<path
						d="M104 26 H394 V166 H104 Z M130 52 H236 V84 H262 V52 H368 V140 H262 V108 H236 V140 H130 Z"
						fill="url(#md-core-hatch)"
						fill-rule="evenodd"
						stroke="currentColor"
						stroke-width="1.6"
					/>

					<!-- Mean Flux Paths: Φ₁ (left), Φ_c (center gap), Φ₂ (right) -->
					<path
						d="M117 153 V39 H381 V153 H117 M249 39 V153"
						stroke="var(--voltage)"
						stroke-dasharray="5 3.5"
						stroke-width="1.35"
					/>
					<path d="M174 39 H192" stroke="var(--voltage)" stroke-width="1.5" marker-end="url(#md-arrow-flux)" />
					<path d="M308 39 H326" stroke="var(--voltage)" stroke-width="1.5" marker-end="url(#md-arrow-flux)" />
					<path d="M249 58 V74" stroke="var(--voltage)" stroke-width="1.5" marker-end="url(#md-arrow-flux)" />

					<text x="183" y="18" class="diagram-label-voltage" text-anchor="middle">
						Φ<tspan dy="3.5" font-size="72%">1</tspan>
					</text>
					<text x="317" y="18" class="diagram-label-voltage" text-anchor="middle">
						Φ<tspan dy="3.5" font-size="72%">2</tspan>
					</text>
					<text x="226" y="72" class="diagram-label-voltage" text-anchor="end">
						Φ<tspan dy="3.5" font-size="72%">c</tspan>
					</text>

					<!-- Center air-gap dimension l_g -->
					<path d="M266 84 H282 M266 108 H282" stroke="var(--muted-foreground)" stroke-width="1.15" />
					<path
						d="M276 86 V106"
						stroke="var(--muted-foreground)"
						stroke-width="1.2"
						marker-start="url(#md-arrow-muted)"
						marker-end="url(#md-arrow-muted)"
					/>
					<text x="287" y="100" class="diagram-label-sm" text-anchor="start">
						l<tspan dy="3.5" font-size="72%">g</tspan>
					</text>

					<!-- Continuous Helical Coil on Left Outer Limb -->
					{@render helicalCoil(104, 130, 62, 5, 13.5, 60)}
				{:else if questionTypeId === 'QT-MAG-3'}
					<!-- Variable-Reluctance Actuator: Stationary C-Core + Movable Armature -->
					<path
						d="M116 26 H276 V56 H146 V136 H276 V166 H116 Z"
						fill="url(#md-core-hatch)"
						stroke="currentColor"
						stroke-width="1.6"
					/>
					<rect
						x="304"
						y="26"
						width="32"
						height="140"
						fill="url(#md-core-hatch)"
						stroke="currentColor"
						stroke-width="1.6"
					/>

					<!-- Mean Flux Path -->
					<path
						d="M131 151 V41 H320 V151 Z"
						stroke="var(--voltage)"
						stroke-dasharray="5 3.5"
						stroke-width="1.35"
					/>
					<path d="M204 41 H222" stroke="var(--voltage)" stroke-width="1.5" marker-end="url(#md-arrow-flux)" />
					<text x="213" y="18" class="diagram-label-voltage" text-anchor="middle">Φ</text>

					<!-- Air-gap dimension l_g -->
					<path d="M276 59 V76 M304 59 V76" stroke="var(--muted-foreground)" stroke-width="1.15" />
					<path
						d="M279 69 H301"
						stroke="var(--muted-foreground)"
						stroke-width="1.2"
						marker-start="url(#md-arrow-muted)"
						marker-end="url(#md-arrow-muted)"
					/>
					<text x="290" y="90" class="diagram-label-sm" text-anchor="middle">
						l<tspan dy="3.5" font-size="72%">g</tspan>
					</text>

					<!-- Core geometry label inside window -->
					<text x="210" y="102" class="diagram-label-muted" text-anchor="middle">
						l<tspan dy="3.5" font-size="72%">c</tspan><tspan dy="-3.5">, A</tspan><tspan dy="3.5" font-size="72%">c</tspan><tspan dy="-3.5">, μ</tspan><tspan dy="3.5" font-size="72%">r</tspan>
					</text>

					<!-- Magnetic force arrow F_fld pulling armature left -->
					<path
						d="M402 96 H348"
						stroke="var(--warning)"
						stroke-width="2"
						marker-end="url(#md-arrow-warning)"
					/>
					<text x="378" y="84" class="diagram-label-warning" text-anchor="middle">
						F<tspan dy="3.5" font-size="72%">fld</tspan>
					</text>
					<text x="380" y="118" class="diagram-label-muted" text-anchor="middle">Armature</text>

					<!-- Continuous Helical Coil on Left Limb -->
					{@render helicalCoil(116, 146, 62, 5, 13.5, 70)}
				{:else}
					<!-- C-Core with Right-Hand Air Gap & Ferromagnetic Hatching (QT-MAG-1) -->
					<path
						d="M122 24 H338 V82 H306 V56 H154 V136 H306 V110 H338 V168 H122 Z"
						fill="url(#md-core-hatch)"
						stroke="currentColor"
						stroke-width="1.6"
					/>

					<!-- Mean Flux Path -->
					<path
						d="M138 152 V40 H322 V152 Z"
						stroke="var(--voltage)"
						stroke-dasharray="5 3.5"
						stroke-width="1.35"
					/>
					<path d="M222 40 H240" stroke="var(--voltage)" stroke-width="1.5" marker-end="url(#md-arrow-flux)" />
					<text x="230" y="17" class="diagram-label-voltage" text-anchor="middle">Φ</text>

					<!-- Air-gap fringing indicators -->
					<path d="M306 82 Q299 96 306 110" stroke="var(--warning)" stroke-dasharray="2.5 2.5" stroke-width="1.25" />
					<path d="M338 82 Q345 96 338 110" stroke="var(--warning)" stroke-dasharray="2.5 2.5" stroke-width="1.25" />

					<!-- Air-gap dimension arrows l_g (B_g) -->
					<path d="M343 82 H364 M343 110 H364" stroke="var(--muted-foreground)" stroke-width="1.15" />
					<path
						d="M357 84 V108"
						stroke="var(--muted-foreground)"
						stroke-width="1.2"
						marker-start="url(#md-arrow-muted)"
						marker-end="url(#md-arrow-muted)"
					/>
					<text x="369" y="100" class="diagram-label-sm" text-anchor="start">
						l<tspan dy="3.5" font-size="72%">g</tspan><tspan dy="-3.5"> (B</tspan><tspan dy="3.5" font-size="72%">g</tspan><tspan dy="-3.5">)</tspan>
					</text>

					<!-- Core geometry label cleanly centered inside window -->
					<text x="230" y="101" class="diagram-label-muted" text-anchor="middle">
						l<tspan dy="3.5" font-size="72%">c</tspan><tspan dy="-3.5">, A</tspan><tspan dy="3.5" font-size="72%">c</tspan><tspan dy="-3.5">, μ</tspan><tspan dy="3.5" font-size="72%">r</tspan>
					</text>

					<!-- Continuous Helical Coil on Left Limb -->
					{@render helicalCoil(122, 154, 62, 5, 13.5, 74)}
				{/if}
			{:else if category === 'transformer'}
				<!-- Cantilever Equivalent Circuit Referred to Primary -->
				<!-- Primary wires & bottom return rail -->
				<path d="M46 48 H206" />
				<path d="M46 156 H378" />

				<!-- Primary open terminals V_1 -->
				{@render terminal(46, 48)}
				{@render terminal(46, 156)}
				<text x="34" y="53" class="diagram-label-voltage" text-anchor="end">+</text>
				<text x="34" y="160" class="diagram-label-voltage" text-anchor="end">−</text>
				<text x="32" y="107" class="diagram-label-voltage" text-anchor="end">
					V<tspan dy="3.5" font-size="72%">1</tspan>
				</text>

				<!-- Primary current arrow I_1 -->
				<path
					d="M60 36 H92"
					stroke="var(--current)"
					stroke-width="1.5"
					marker-end="url(#md-arrow-current)"
				/>
				<text x="76" y="26" class="diagram-label-current" text-anchor="middle">
					I<tspan dy="3.5" font-size="72%">1</tspan>
				</text>

				<!-- Shunt Core Branch (R_c || jX_m) -->
				{@render junction(132, 48)}
				{@render junction(132, 156)}
				<path d="M132 48 V64 M104 64 H160 M104 64 V76 M160 64 V76" />
				<path d="M104 128 V140 H160 V128 M132 140 V156" />

				{@render resistorV(104, 76, 52, 6)}
				<text x="91" y="107" class="diagram-label-sm" text-anchor="end">
					R<tspan dy="3.5" font-size="72%">c</tspan>
				</text>

				{@render inductorV(160, 76, 52, 'right')}
				<text x="174" y="107" class="diagram-label-sm" text-anchor="start">
					jX<tspan dy="3.5" font-size="72%">m</tspan>
				</text>

				<!-- Series Leakage Branch (R_e + jX_e) -->
				{@render resistorH(206, 48, 52, 6.5)}
				<text x="232" y="32" class="diagram-label-sm" text-anchor="middle">
					R<tspan dy="3.5" font-size="72%">e</tspan>
				</text>

				<path d="M258 48 H272" />
				{@render inductorH(272, 48, 48)}
				<text x="296" y="32" class="diagram-label-sm" text-anchor="middle">
					jX<tspan dy="3.5" font-size="72%">e</tspan>
				</text>
				<path d="M320 48 H378" />

				<!-- Referred secondary current I_2' -->
				<path
					d="M330 36 H362"
					stroke="var(--current)"
					stroke-width="1.5"
					marker-end="url(#md-arrow-current)"
				/>
				<text x="346" y="26" class="diagram-label-current" text-anchor="middle">
					I<tspan dy="3.5" font-size="72%">2</tspan><tspan dy="-3.5">′</tspan>
				</text>

				<!-- Secondary Load Z_L' & Open Terminals V_2' (with >= 28px right margin) -->
				<path d="M378 51.2 V76 M378 128 V152.8" />
				<rect
					x="360"
					y="76"
					width="36"
					height="52"
					rx="3"
					fill="var(--surface-rail)"
					stroke="currentColor"
					stroke-width="1.5"
				/>
				<text x="378" y="107" class="diagram-label-sm" text-anchor="middle">
					Z<tspan dy="3" font-size="72%">L</tspan><tspan dy="-3">′</tspan>
				</text>

				{@render terminal(378, 48)}
				{@render terminal(378, 156)}
				<text x="392" y="53" class="diagram-label-voltage" text-anchor="start">+</text>
				<text x="392" y="160" class="diagram-label-voltage" text-anchor="start">−</text>
				<text x="408" y="107" class="diagram-label-voltage" text-anchor="start">
					V<tspan dy="3.5" font-size="72%">2</tspan><tspan dy="-3.5">′</tspan>
				</text>
			{:else if category === 'dc-machines'}
				<!-- Shaft & Rotation Indicator (with >= 16px clearance from n, T_d) -->
				<path d="M64 101 H106" stroke="var(--muted-foreground)" stroke-width="3" stroke-linecap="butt" />
				<path
					d="M86 83 A18 18 0 0 0 86 119"
					stroke="var(--warning)"
					stroke-width="1.5"
					marker-start="url(#md-arrow-warning)"
				/>
				<text x="48" y="96" class="diagram-label-muted" text-anchor="end">n</text>
				<text x="48" y="114" class="diagram-label-muted" text-anchor="end">
					T<tspan dy="3.5" font-size="72%">d</tspan>
				</text>

				<!-- Armature Circle & Commutator Brushes -->
				<circle cx="134" cy="101" r="28" fill="var(--surface-rail)" stroke="currentColor" stroke-width="1.7" />
				<rect x="126" y="67" width="16" height="6" rx="1" fill="currentColor" stroke="none" />
				<rect x="126" y="129" width="16" height="6" rx="1" fill="currentColor" stroke="none" />
				<text x="134" y="86" class="diagram-label-voltage" text-anchor="middle">+</text>
				<text x="134" y="106" class="diagram-label-voltage" text-anchor="middle">
					E<tspan dy="3.5" font-size="72%">a</tspan>
				</text>
				<text x="134" y="125" class="diagram-label-voltage" text-anchor="middle">−</text>

				<!-- Armature Rails & Series Resistance R_a -->
				<path d="M134 67 V44 H178" />
				{@render resistorH(178, 44, 52, 6.5)}
				<path d="M230 44 H396" />
				<path d="M134 135 V158 H396" />

				{#if questionTypeId === 'QT-DC-3'}
					<text x="204" y="28" class="diagram-label-sm" text-anchor="middle">
						R<tspan dy="3.5" font-size="72%">a</tspan><tspan dy="-3.5"> + R</tspan><tspan dy="3.5" font-size="72%">add</tspan>
					</text>
				{:else}
					<text x="204" y="28" class="diagram-label-sm" text-anchor="middle">
						R<tspan dy="3.5" font-size="72%">a</tspan>
					</text>
				{/if}

				<!-- Armature Current I_a (right for generator QT-DC-2, left for motor) -->
				{#if isGenerator}
					<path
						d="M244 32 H276"
						stroke="var(--current)"
						stroke-width="1.5"
						marker-end="url(#md-arrow-current)"
					/>
				{:else}
					<path
						d="M276 32 H244"
						stroke="var(--current)"
						stroke-width="1.5"
						marker-end="url(#md-arrow-current)"
					/>
				{/if}
				<text x="260" y="22" class="diagram-label-current" text-anchor="middle">
					I<tspan dy="3.5" font-size="72%">a</tspan>
				</text>

				<!-- Shunt / Field Winding Branch (R_f + L_f in series) -->
				{@render junction(304, 44)}
				{@render junction(304, 158)}
				<path d="M304 44 V56" />
				{@render resistorV(304, 56, 42, 5.5)}
				<text x="318" y="81" class="diagram-label-sm" text-anchor="start">
					R<tspan dy="3.5" font-size="72%">f</tspan>
				</text>
				<path d="M304 98 V106" />
				{@render inductorV(304, 106, 40, 'right')}
				<text x="318" y="130" class="diagram-label-sm" text-anchor="start">
					L<tspan dy="3.5" font-size="72%">f</tspan>
				</text>
				<path d="M304 146 V158" />

				<!-- Field current arrow I_f -->
				<path
					d="M290 64 V90"
					stroke="var(--current)"
					stroke-width="1.45"
					marker-end="url(#md-arrow-current)"
				/>
				<text x="282" y="81" class="diagram-label-current" text-anchor="end">
					I<tspan dy="3.5" font-size="72%">f</tspan>
				</text>

				<!-- Line Current I_L -->
				{#if isGenerator}
					<path
						d="M342 32 H374"
						stroke="var(--current)"
						stroke-width="1.5"
						marker-end="url(#md-arrow-current)"
					/>
				{:else}
					<path
						d="M374 32 H342"
						stroke="var(--current)"
						stroke-width="1.5"
						marker-end="url(#md-arrow-current)"
					/>
				{/if}
				<text x="358" y="22" class="diagram-label-current" text-anchor="middle">
					I<tspan dy="3.5" font-size="72%">L</tspan>
				</text>

				<!-- Output Terminals V_t -->
				{@render terminal(396, 44)}
				{@render terminal(396, 158)}
				<text x="408" y="49" class="diagram-label-voltage" text-anchor="start">+</text>
				<text x="408" y="162" class="diagram-label-voltage" text-anchor="start">−</text>
				<text x="412" y="106" class="diagram-label-voltage" text-anchor="start">
					V<tspan dy="3.5" font-size="72%">t</tspan>
				</text>
			{:else}
				<!-- Induction Motor Per-Phase Exact T Equivalent Circuit -->
				<!-- Stator Input Terminals V_φ -->
				{@render terminal(44, 48)}
				{@render terminal(44, 158)}
				<text x="32" y="53" class="diagram-label-voltage" text-anchor="end">+</text>
				<text x="32" y="162" class="diagram-label-voltage" text-anchor="end">−</text>
				<text x="30" y="108" class="diagram-label-voltage" text-anchor="end">
					V<tspan dy="3.5" font-size="72%">φ</tspan>
				</text>

				<!-- Stator Current I_1 -->
				<path
					d="M52 36 H76"
					stroke="var(--current)"
					stroke-width="1.5"
					marker-end="url(#md-arrow-current)"
				/>
				<text x="64" y="26" class="diagram-label-current" text-anchor="middle">
					I<tspan dy="3.5" font-size="72%">1</tspan>
				</text>

				<!-- Stator Series Branch: R_1 + jX_1 -->
				<path d="M47.2 48 H82" />
				{@render resistorH(82, 48, 46, 6)}
				<text x="105" y="32" class="diagram-label-sm" text-anchor="middle">
					R<tspan dy="3.5" font-size="72%">1</tspan>
				</text>

				<path d="M128 48 H138" />
				{@render inductorH(138, 48, 44)}
				<text x="160" y="32" class="diagram-label-sm" text-anchor="middle">
					jX<tspan dy="3.5" font-size="72%">1</tspan>
				</text>

				<path d="M182 48 H314" />
				<path d="M47.2 158 H396" />

				<!-- Magnetizing Shunt Branch jX_m (label on LEFT for >= 24px gap before air-gap line) -->
				{@render junction(208, 48)}
				{@render junction(208, 158)}
				<path d="M208 48 V76 M208 128 V158" />
				{@render inductorV(208, 76, 52, 'right')}
				<text x="196" y="107" class="diagram-label-sm" text-anchor="end">
					jX<tspan dy="3.5" font-size="72%">m</tspan>
				</text>

				<!-- Air-Gap Boundary (vertical dashed blue line + horizontal P_g arrow) -->
				<path
					d="M248 22 V172"
					stroke="var(--voltage)"
					stroke-dasharray="5 3.5"
					stroke-width="1.35"
				/>
				<path
					d="M234 104 H270"
					stroke="var(--voltage)"
					stroke-width="1.6"
					marker-end="url(#md-arrow-flux)"
				/>
				<text x="260" y="95" class="diagram-label-voltage" text-anchor="start">
					P<tspan dy="3.5" font-size="72%">g</tspan>
				</text>
				<text x="248" y="186" class="diagram-label-muted" text-anchor="middle">Air Gap</text>

				<!-- Rotor Current I_2' -->
				<path
					d="M264 36 H296"
					stroke="var(--current)"
					stroke-width="1.5"
					marker-end="url(#md-arrow-current)"
				/>
				<text x="280" y="26" class="diagram-label-current" text-anchor="middle">
					I<tspan dy="3.5" font-size="72%">2</tspan><tspan dy="-3.5">′</tspan>
				</text>

				<!-- Rotor Series Reactance jX_2' -->
				{@render inductorH(314, 48, 46)}
				<text x="337" y="32" class="diagram-label-sm" text-anchor="middle">
					jX<tspan dy="3.5" font-size="72%">2</tspan><tspan dy="-3.5">′</tspan>
				</text>

				<!-- Rotor Variable Resistance R_2'/s -->
				<path d="M360 48 H396 V74 M396 132 V158" />
				{@render resistorV(396, 74, 58, 6.5)}
				<path
					d="M380 122 L412 84"
					stroke="currentColor"
					stroke-width="1.35"
					marker-end="url(#md-arrow-fg)"
				/>
				<text x="374" y="108" class="diagram-label-sm" text-anchor="end">
					R<tspan dy="3.5" font-size="72%">2</tspan><tspan dy="-3.5">′/s</tspan>
				</text>
			{/if}
		</svg>
	</div>
</figure>

<style>
	.diagram-label-sm {
		font-family: var(--font-mono);
		font-size: 12px;
		font-weight: 500;
		fill: var(--foreground);
		stroke: none;
	}
	.diagram-label-muted {
		font-family: var(--font-mono);
		font-size: 12px;
		fill: var(--muted-foreground);
		stroke: none;
	}
	.diagram-label-voltage {
		font-family: var(--font-mono);
		font-size: 13.5px;
		font-weight: 600;
		fill: var(--voltage);
		stroke: none;
	}
	.diagram-label-current {
		font-family: var(--font-mono);
		font-size: 13.5px;
		font-weight: 600;
		fill: var(--current);
		stroke: none;
	}
	.diagram-label-warning {
		font-family: var(--font-mono);
		font-size: 12.5px;
		font-weight: 600;
		fill: var(--warning);
		stroke: none;
	}
</style>
