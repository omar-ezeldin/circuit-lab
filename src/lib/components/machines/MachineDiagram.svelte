<script lang="ts">
	import type { MachineCategory, MachineQuestionTypeId } from '$lib/machines';
	import { cn } from '$lib/utils';

	type Props = {
		category: MachineCategory;
		questionTypeId?: MachineQuestionTypeId;
		class?: string;
	};

	let { category, questionTypeId, class: className }: Props = $props();

	const diagramMeta = $derived.by(() => {
		switch (category) {
			case 'three-phase':
				return {
					label: 'Balanced three-phase Y/Δ source, line impedance, and load schematic',
					caption: '3-Phase Line & Phase Model'
				};
			case 'magnetic':
				return {
					label: 'Ferromagnetic core with N-turn excitation coil, magnetic flux path, and air gap',
					caption:
						questionTypeId === 'QT-MAG-3'
							? 'Variable-Reluctance Actuator Core'
							: questionTypeId === 'QT-MAG-2'
								? 'Nonlinear / Multi-Limb Core'
								: 'Ferromagnetic Core + Air Gap'
				};
			case 'transformer':
				return {
					label: 'Single-phase transformer equivalent circuit with core branch Rc || jXm and series Re + jXe',
					caption:
						questionTypeId === 'QT-XFMR-2'
							? 'OC / SC Test Equivalent Circuit'
							: 'Referred Equivalent Circuit'
				};
			case 'dc-machines':
				return {
					label: 'DC machine equivalent circuit with armature Ea, Ra, terminal Vt, and field winding Rf',
					caption:
						questionTypeId === 'QT-DC-2'
							? 'DC Generator Equivalent Circuit'
							: 'DC Machine Armature & Field Model'
				};
			case 'induction-motor':
				return {
					label: 'Three-phase induction motor per-phase equivalent circuit with R1, jX1, jXm, jX2 prime, and R2 prime over s',
					caption:
						questionTypeId === 'QT-IM-2'
							? 'Per-Phase Power Flow & Slip Model'
							: 'Per-Phase Equivalent Circuit'
				};
		}
	});
</script>

<figure
	class={cn(
		'flex flex-col overflow-hidden rounded-[4px] border border-border bg-card',
		className
	)}
>
	<div class="flex items-center justify-between border-b border-border bg-surface-rail/60 px-3 py-1.5">
		<span class="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
			Reference Schematic
		</span>
		<span class="font-engineering text-[11px] text-muted-foreground">
			{diagramMeta.caption}
		</span>
	</div>

	<div class="flex items-center justify-center px-3 py-2.5">
		<svg
			viewBox="0 0 360 136"
			role="img"
			aria-label={diagramMeta.label}
			class="h-auto max-h-36 w-full max-w-[380px] select-none text-foreground"
			fill="none"
			stroke="currentColor"
			stroke-width="1.5"
			stroke-linecap="round"
			stroke-linejoin="round"
		>
			{#if category === 'three-phase'}
				<!-- 3-Phase Source (Y) -->
				<circle cx="54" cy="30" r="10" stroke="var(--voltage)" />
				<circle cx="54" cy="68" r="10" stroke="var(--voltage)" />
				<circle cx="54" cy="106" r="10" stroke="var(--voltage)" />
				<path d="M49 30 q2.5 -4 5 0 t5 0" stroke="var(--voltage)" stroke-width="1.2" />
				<path d="M49 68 q2.5 -4 5 0 t5 0" stroke="var(--voltage)" stroke-width="1.2" />
				<path d="M49 106 q2.5 -4 5 0 t5 0" stroke="var(--voltage)" stroke-width="1.2" />

				<!-- Neutral Bus -->
				<path d="M44 30 H26 V106 H44 M26 68 H44" stroke="var(--muted-foreground)" />
				<circle cx="26" cy="68" r="2.2" fill="var(--muted-foreground)" stroke="none" />
				<text x="14" y="72" class="diagram-label-muted" text-anchor="middle">n</text>

				<!-- Lines a, b, c with Z_line boxes -->
				<path d="M64 30 H124" />
				<path d="M64 68 H124" />
				<path d="M64 106 H124" />

				<!-- Current arrow I_L on line a -->
				<path d="M84 22 H104 M100 19 L105 22 L100 25" stroke="var(--current)" stroke-width="1.35" />
				<text x="94" y="16" class="diagram-label-current" text-anchor="middle">I_L</text>

				<!-- Line Impedances -->
				<rect x="124" y="23" width="44" height="14" rx="2" fill="var(--card)" />
				<rect x="124" y="61" width="44" height="14" rx="2" fill="var(--card)" />
				<rect x="124" y="99" width="44" height="14" rx="2" fill="var(--card)" />
				<text x="146" y="33" class="diagram-label-sm" text-anchor="middle">Z_line</text>
				<text x="146" y="71" class="diagram-label-sm" text-anchor="middle">Z_line</text>
				<text x="146" y="109" class="diagram-label-sm" text-anchor="middle">Z_line</text>

				<!-- Lines to Load -->
				<path d="M168 30 H238" />
				<path d="M168 68 H238" />
				<path d="M168 106 H238" />

				<!-- V_L annotation -->
				<path d="M204 34 V64" stroke="var(--voltage)" stroke-dasharray="2.5 2.5" stroke-width="1.2" />
				<text x="216" y="53" class="diagram-label-voltage" text-anchor="start">V_L</text>

				<!-- Balanced Load Box (Y / Δ) -->
				<rect
					x="238"
					y="18"
					width="96"
					height="100"
					rx="3"
					fill="var(--surface-rail)"
					stroke="var(--border)"
				/>
				<rect x="252" y="26" width="42" height="14" rx="2" fill="var(--card)" />
				<rect x="252" y="61" width="42" height="14" rx="2" fill="var(--card)" />
				<rect x="252" y="96" width="42" height="14" rx="2" fill="var(--card)" />
				<text x="273" y="36" class="diagram-label-sm" text-anchor="middle">Z_φ</text>
				<text x="273" y="71" class="diagram-label-sm" text-anchor="middle">Z_φ</text>
				<text x="273" y="106" class="diagram-label-sm" text-anchor="middle">Z_φ</text>
				<path d="M238 33 H252 M238 68 H252 M238 103 H252" />
				<path d="M294 33 H314 V103 H294 M294 68 H314" stroke="var(--muted-foreground)" />
				<circle cx="314" cy="68" r="2.2" fill="var(--muted-foreground)" stroke="none" />
				<text x="324" y="72" class="diagram-label-muted" text-anchor="middle">N</text>
				<text x="286" y="131" class="diagram-label-muted" text-anchor="middle">Balanced Y / Δ Load</text>
				<text x="54" y="131" class="diagram-label-muted" text-anchor="middle">Source</text>
			{:else if category === 'magnetic'}
				<!-- Ferromagnetic Core with Air Gap on Right Limb -->
				<path
					d="M84 22 H268 V54 H238 V44 H114 V92 H238 V82 H268 V114 H84 Z"
					fill="var(--surface-rail)"
					stroke="currentColor"
				/>

				<!-- Mean Flux Path (dashed) -->
				<path
					d="M99 68 V33 H253 V103 H99 Z"
					stroke="var(--primary)"
					stroke-dasharray="4 3"
					stroke-width="1.25"
				/>
				<!-- Flux direction arrow -->
				<path d="M174 30 L182 33 L174 36" stroke="var(--primary)" stroke-width="1.35" />
				<text x="178" y="20" class="diagram-label-voltage" text-anchor="middle">Φ, B_c, H_c</text>

				<!-- Excitation Coil (N turns) on Left Limb -->
				<path d="M68 46 C76 42 122 42 130 46" stroke="var(--current)" stroke-width="1.6" />
				<path d="M68 58 C76 54 122 54 130 58" stroke="var(--current)" stroke-width="1.6" />
				<path d="M68 70 C76 66 122 66 130 70" stroke="var(--current)" stroke-width="1.6" />
				<path d="M68 82 C76 78 122 78 130 82" stroke="var(--current)" stroke-width="1.6" />
				<!-- Coil leads -->
				<path d="M40 46 H68 M40 82 H68" stroke="var(--current)" />
				<circle cx="40" cy="46" r="2.2" fill="var(--current)" stroke="none" />
				<circle cx="40" cy="82" r="2.2" fill="var(--current)" stroke="none" />
				<path d="M46 40 H58 M54 37 L59 40 L54 43" stroke="var(--current)" stroke-width="1.25" />
				<text x="34" y="67" class="diagram-label-current" text-anchor="end">N, I</text>

				<!-- Air Gap & Fringing Indicators -->
				<path d="M236 54 Q231 68 236 82" stroke="var(--warning)" stroke-dasharray="2 2" stroke-width="1.2" />
				<path d="M270 54 Q275 68 270 82" stroke="var(--warning)" stroke-dasharray="2 2" stroke-width="1.2" />
				<path d="M284 54 H296 M284 82 H296 M290 54 V82" stroke="var(--muted-foreground)" stroke-width="1.15" />
				<text x="300" y="71" class="diagram-label-sm" text-anchor="start">l_g (B_g)</text>

				<!-- Core labels -->
				<text x="176" y="72" class="diagram-label-muted" text-anchor="middle">l_c, A_c, μ_r</text>
				<text x="176" y="129" class="diagram-label-muted" text-anchor="middle">
					MMF = N·I = Φ(R_c + R_g)
				</text>
			{:else if category === 'transformer'}
				<!-- Cantilever Equivalent Circuit Referred to Primary -->
				<!-- Input Terminals -->
				<circle cx="28" cy="36" r="2.5" fill="var(--voltage)" stroke="none" />
				<circle cx="28" cy="106" r="2.5" fill="var(--voltage)" stroke="none" />
				<text x="20" y="74" class="diagram-label-voltage" text-anchor="end">V_1</text>
				<path d="M28 36 H166" />
				<path d="M28 106 H322" />

				<!-- I_1 arrow -->
				<path d="M42 28 H60 M56 25 L61 28 L56 31" stroke="var(--current)" stroke-width="1.25" />
				<text x="51" y="21" class="diagram-label-current" text-anchor="middle">I_1</text>

				<!-- Shunt Excitation Branch (R_c || jX_m) -->
				<circle cx="88" cy="36" r="2" fill="currentColor" stroke="none" />
				<circle cx="88" cy="106" r="2" fill="currentColor" stroke="none" />
				<path d="M88 36 V46 H68 V54 M88 46 H108 V54" />
				<path d="M68 88 V96 H108 V88 M88 96 V106" />

				<!-- R_c zigzag -->
				<path d="M68 54 l-4 4 8 5 -8 5 8 5 -8 5 4 4 v6" />
				<text x="55" y="74" class="diagram-label-sm" text-anchor="end">R_c</text>

				<!-- jX_m coils -->
				<path d="M108 54 c5 0 5 8 0 8 c5 0 5 8 0 8 c5 0 5 8 0 8 c5 0 5 8 0 8 v2" />
				<text x="122" y="74" class="diagram-label-sm" text-anchor="start">jX_m</text>

				<!-- Series R_e + jX_e -->
				<path d="M166 36 l4 -5 6 10 6 -10 6 10 6 -10 6 10 4 -5 h14" />
				<text x="186" y="21" class="diagram-label-sm" text-anchor="middle">R_e</text>

				<path d="M218 36 c0 -6 8 -6 8 0 c0 -6 8 -6 8 0 c0 -6 8 -6 8 0 c0 -6 8 -6 8 0 h72" />
				<text x="234" y="21" class="diagram-label-sm" text-anchor="middle">jX_e</text>

				<!-- I_2' arrow -->
				<path d="M276 28 H294 M290 25 L295 28 L290 31" stroke="var(--current)" stroke-width="1.25" />
				<text x="285" y="21" class="diagram-label-current" text-anchor="middle">I_2'</text>

				<!-- Load Terminals V_2' -->
				<circle cx="322" cy="36" r="2.5" fill="var(--voltage)" stroke="none" />
				<circle cx="322" cy="106" r="2.5" fill="var(--voltage)" stroke="none" />
				<rect
					x="312"
					y="50"
					width="20"
					height="42"
					rx="2"
					fill="var(--surface-rail)"
					stroke="var(--border)"
				/>
				<path d="M322 36 V50 M322 92 V106" />
				<text x="342" y="74" class="diagram-label-voltage" text-anchor="start">V_2'</text>

				<text x="180" y="128" class="diagram-label-muted" text-anchor="middle">
					a = V_1 / V_2 · Shunt Core Branch + Series Leakage
				</text>
			{:else if category === 'dc-machines'}
				<!-- DC Machine Armature + Shunt/Separate Field -->
				<!-- Armature Circle -->
				<circle cx="96" cy="70" r="22" fill="var(--surface-rail)" stroke="currentColor" />
				<!-- Brushes -->
				<rect x="91" y="44" width="10" height="4" fill="currentColor" stroke="none" />
				<rect x="91" y="92" width="10" height="4" fill="currentColor" stroke="none" />
				<text x="96" y="74" class="diagram-label-voltage" text-anchor="middle">E_a</text>

				<!-- Armature circuit + R_a -->
				<path d="M96 44 V28 H134" />
				<path d="M134 28 l4 -5 6 10 6 -10 6 10 6 -10 6 10 4 -5 H306" />
				<text x="154" y="16" class="diagram-label-sm" text-anchor="middle">R_a (+ R_add)</text>
				<path d="M96 96 V112 H306" />

				<!-- Armature current arrow -->
				<path d="M194 20 H212 M208 17 L213 20 L208 23" stroke="var(--current)" stroke-width="1.25" />
				<text x="203" y="13" class="diagram-label-current" text-anchor="middle">I_a</text>

				<!-- Shunt Field Branch -->
				<circle cx="236" cy="28" r="2" fill="currentColor" stroke="none" />
				<circle cx="236" cy="112" r="2" fill="currentColor" stroke="none" />
				<path d="M236 28 V46" />
				<path d="M236 46 c6 0 6 8 0 8 c6 0 6 8 0 8 c6 0 6 8 0 8 c6 0 6 8 0 8 V112" />
				<text x="252" y="73" class="diagram-label-sm" text-anchor="start">R_f (I_f)</text>

				<!-- Terminals V_t -->
				<circle cx="306" cy="28" r="2.5" fill="var(--voltage)" stroke="none" />
				<circle cx="306" cy="112" r="2.5" fill="var(--voltage)" stroke="none" />
				<text x="316" y="34" class="diagram-label-voltage" text-anchor="start">+</text>
				<text x="316" y="114" class="diagram-label-voltage" text-anchor="start">−</text>
				<text x="322" y="74" class="diagram-label-voltage" text-anchor="start">V_t</text>

				<!-- Shaft speed / torque indicator -->
				<path d="M40 70 H74" stroke="var(--muted-foreground)" stroke-width="2" />
				<path d="M52 58 A12 12 0 0 1 52 82" stroke="var(--warning)" stroke-width="1.25" />
				<path d="M49 55 L53 58 L49 61" stroke="var(--warning)" stroke-width="1.2" />
				<text x="36" y="54" class="diagram-label-muted" text-anchor="middle">n, T_d</text>

				<text x="180" y="130" class="diagram-label-muted" text-anchor="middle">
					E_a = K_e ω · Motor: V_t − I_a R_a · Gen: V_t + I_a R_a
				</text>
			{:else}
				<!-- Induction Motor Per-Phase Exact T Equivalent Circuit -->
				<circle cx="24" cy="36" r="2.5" fill="var(--voltage)" stroke="none" />
				<circle cx="24" cy="106" r="2.5" fill="var(--voltage)" stroke="none" />
				<text x="18" y="74" class="diagram-label-voltage" text-anchor="end">V_φ</text>

				<!-- Stator R_1 + jX_1 -->
				<path d="M24 36 H50 l4 -5 6 10 6 -10 6 10 6 -10 4 5 H94" />
				<text x="66" y="21" class="diagram-label-sm" text-anchor="middle">R_1</text>

				<path d="M94 36 c0 -6 8 -6 8 0 c0 -6 8 -6 8 0 c0 -6 8 -6 8 0 c0 -6 8 -6 8 0 H194" />
				<text x="110" y="21" class="diagram-label-sm" text-anchor="middle">jX_1</text>

				<!-- Bottom return bus -->
				<path d="M24 106 H322" />

				<!-- Magnetizing Branch jX_m -->
				<circle cx="158" cy="36" r="2" fill="currentColor" stroke="none" />
				<circle cx="158" cy="106" r="2" fill="currentColor" stroke="none" />
				<path d="M158 36 V52" />
				<path d="M158 52 c6 0 6 8 0 8 c6 0 6 8 0 8 c6 0 6 8 0 8 c6 0 6 8 0 8 V106" />
				<text x="172" y="74" class="diagram-label-sm" text-anchor="start">jX_m</text>

				<!-- Air-Gap Power Line -->
				<path d="M188 18 V114" stroke="var(--primary)" stroke-dasharray="3 3" stroke-width="1.15" />
				<text x="193" y="114" class="diagram-label-voltage" text-anchor="start">P_g</text>

				<!-- Rotor jX_2' -->
				<path d="M194 36 H210 c0 -6 8 -6 8 0 c0 -6 8 -6 8 0 c0 -6 8 -6 8 0 c0 -6 8 -6 8 0 H322" />
				<text x="226" y="21" class="diagram-label-sm" text-anchor="middle">jX_2'</text>

				<!-- I_2' arrow -->
				<path d="M262 28 H280 M276 25 L281 28 L276 31" stroke="var(--current)" stroke-width="1.25" />
				<text x="271" y="21" class="diagram-label-current" text-anchor="middle">I_2'</text>

				<!-- Rotor Resistance R_2'/s -->
				<path d="M322 36 V50 l-4 4 8 5 -8 5 8 5 -8 5 8 5 -4 4 V106" />
				<text x="308" y="75" class="diagram-label-sm" text-anchor="end">R_2'/s</text>

				<text x="180" y="130" class="diagram-label-muted" text-anchor="middle">
					N_s = 120f/P · P_cu,r = s P_g · P_d = (1−s) P_g
				</text>
			{/if}
		</svg>
	</div>
</figure>

<style>
	.diagram-label-sm {
		font-family: var(--font-mono);
		font-size: 9px;
		fill: var(--foreground);
		stroke: none;
	}
	.diagram-label-muted {
		font-family: var(--font-mono);
		font-size: 8.5px;
		fill: var(--muted-foreground);
		stroke: none;
	}
	.diagram-label-voltage {
		font-family: var(--font-mono);
		font-size: 9.5px;
		font-weight: 600;
		fill: var(--voltage);
		stroke: none;
	}
	.diagram-label-current {
		font-family: var(--font-mono);
		font-size: 9.5px;
		font-weight: 600;
		fill: var(--current);
		stroke: none;
	}
</style>
