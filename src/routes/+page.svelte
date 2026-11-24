<script lang="ts">
	import { onMount } from 'svelte';
	import { mode, toggleMode } from 'mode-watcher';
	import {
		BarChart3,
		BookOpen,
		Cable,
		Check,
		ChevronDown,
		CircuitBoard,
		Cog,
		Eraser,
		FileCode2,
		Link2,
		Moon,
		MoreVertical,
		PanelLeftClose,
		PanelLeftOpen,
		PanelRightClose,
		PanelRightOpen,
		ScanLine,
		Settings,
		SlidersHorizontal,
		Sun,
		X
	} from 'lucide-svelte';
	import {
		ImportFromAIDialog,
		JsonDialog,
		PresetsDialog,
		SettingsDialog
	} from '$lib/components/dialogs';
	import {
		AC_FREQUENCY_PRESETS,
		ComponentPalette,
		EditableTitle,
		PropertyInspector,
		SchematicCanvas
	} from '$lib/components/editor';
	import { ResultsPanel, formatFrequency } from '$lib/components/results';
	import {
		ImportMachineFromAIDialog,
		MachinesWorkbench,
		type MachineAiImportPayload
	} from '$lib/components/machines';
	import {
		Badge,
		Button,
		Input,
		Separator,
		Sheet,
		Tabs,
		TabsContent,
		TabsList,
		TabsTrigger,
		Tooltip
	} from '$lib/components/ui';
	import type { CircuitPreset } from '$lib/data/presets';
	import {
		buildShareableUrl,
		decodeCircuitFromHash,
		encodeCircuitToHash,
		type CircuitDocument
	} from '$lib/engine';
	import { AC_ENABLED, DEPLOY_COMMIT_SHA, IS_STAGING } from '$lib/env';
	import { circuit } from '$lib/stores/circuit.svelte';
	import { settings } from '$lib/stores/settings.svelte';
	import { cn } from '$lib/utils';

	let workspaceMode = $state<'circuits' | 'machines'>('circuits');
	let leftRailOpen = $state(true);
	let rightRailOpen = $state(true);
	let rightTab = $state<'results' | 'inspector'>('results');
	let mobileTab = $state<'canvas' | 'results' | 'inspector'>('canvas');
	let paletteSheetOpen = $state(false);
	let mobileMenuOpen = $state(false);
	let freqPopoverOpen = $state(false);
	let workspaceMenuOpen = $state(false);

	let presetsOpen = $state(false);
	let jsonOpen = $state(false);
	let aiOpen = $state(false);
	let machineAiImportOpen = $state(false);
	let settingsOpen = $state(false);
	let machinesWorkbenchRef = $state<ReturnType<typeof MachinesWorkbench> | null>(null);
	let linkCopied = $state(false);
	let acComingSoonNotice = $state<string | null>(null);
	let autoWireFeedback = $state<string | null>(null);

	let linkCopiedTimer: ReturnType<typeof setTimeout> | undefined;
	let mobileMenuCloseTimer: ReturnType<typeof setTimeout> | undefined;
	let autoWireFeedbackTimer: ReturnType<typeof setTimeout> | undefined;
	let lastWrittenHash = '';

	let freqDraft = $state(String(circuit.document.frequencyHz));

	$effect(() => {
		freqDraft = String(circuit.document.frequencyHz);
	});

	$effect(() => {
		if (circuit.document.mode !== 'ac') {
			freqPopoverOpen = false;
		}
	});

	const isDark = $derived(mode.current === 'dark');
	const isEmpty = $derived(circuit.document.components.length === 0);
	const errorCount = $derived(
		circuit.solution.mna.diagnostics.filter((d) => d.severity === 'error').length
	);
	const isVerified = $derived(
		circuit.solution.mna.valid &&
			circuit.solution.allVerified &&
			circuit.solution.mna.powerBalance.balanced
	);

	const statusInfo = $derived.by(() => {
		if (isEmpty) {
			return {
				dotClass: 'bg-muted-foreground/50',
				label: 'Circuit is empty'
			};
		}
		if (errorCount > 0 || !circuit.solution.mna.valid) {
			return {
				dotClass: 'bg-destructive',
				label:
					errorCount > 0
						? `${errorCount} ${errorCount === 1 ? 'error' : 'errors'} in circuit`
						: 'Circuit invalid'
			};
		}
		if (isVerified) {
			return {
				dotClass: 'bg-branch-current',
				label: 'Verified · Power balanced (ΣP = 0)'
			};
		}
		return {
			dotClass: 'bg-warning',
			label: 'Solved (MNA)'
		};
	});

	function commitToolbarFrequency() {
		const trimmed = String(freqDraft ?? '').trim();
		const hz = trimmed === '' ? Number.NaN : Number(trimmed);
		if (!Number.isFinite(hz) || hz <= 0) {
			freqDraft = String(circuit.document.frequencyHz);
			return;
		}
		circuit.setFrequency(hz);
	}

	function handleWindowKeydown(e: KeyboardEvent) {
		if (e.key === 'Escape') {
			if (mobileMenuOpen) mobileMenuOpen = false;
			if (freqPopoverOpen) freqPopoverOpen = false;
			if (workspaceMenuOpen) workspaceMenuOpen = false;
		}
	}

	const AC_PRODUCTION_NOTICE =
		'AC Phasor Analysis is coming soon in Production. This AC circuit can be opened on Staging.';

	function handleSelectPreset(preset: CircuitPreset) {
		if (!AC_ENABLED && preset.document.mode === 'ac') {
			acComingSoonNotice = AC_PRODUCTION_NOTICE;
			return;
		}
		acComingSoonNotice = null;
		circuit.loadPreset(preset.id);
		rightTab = 'results';
		rightRailOpen = true;
	}

	function handleImportDocument(doc: CircuitDocument) {
		if (!AC_ENABLED && doc.mode === 'ac') {
			acComingSoonNotice = AC_PRODUCTION_NOTICE;
			return;
		}
		acComingSoonNotice = null;
		if (doc.unitSystem) {
			settings.useUnitSystemForSession(doc.unitSystem);
		}
		circuit.loadDocument(doc);
		rightTab = 'results';
		rightRailOpen = true;
	}

	function handleMachineAiImport(payload: MachineAiImportPayload) {
		machinesWorkbenchRef?.applyImportedProblem(payload.questionTypeId, payload.input);
	}

	function handleCanvasComponentInspect(id: string) {
		circuit.selectComponent(id);
		rightTab = 'inspector';
		rightRailOpen = true;
	}

	function handleAutoWire() {
		const res = circuit.autoWireCircuit();
		if (res.addedWires > 0) {
			autoWireFeedback = `Auto-wired (+${res.addedWires} ${res.addedWires === 1 ? 'wire' : 'wires'})`;
		} else if (res.reason === 'already_connected') {
			autoWireFeedback = 'All pins connected';
		} else if (res.reason === 'too_few_components') {
			autoWireFeedback = 'Place at least 2 components';
		} else {
			autoWireFeedback = 'No valid connections found';
		}
		if (autoWireFeedbackTimer !== undefined) {
			clearTimeout(autoWireFeedbackTimer);
		}
		autoWireFeedbackTimer = setTimeout(() => {
			autoWireFeedback = null;
		}, 2500);
		if (mobileTab !== 'canvas') {
			mobileTab = 'canvas';
		}
	}

	async function loadFromHash(hash: string) {
		if (!hash || !hash.includes('c=')) return;
		const payload = await decodeCircuitFromHash(hash);
		if (!payload) return;
		if (!AC_ENABLED && payload.document.mode === 'ac') {
			acComingSoonNotice = AC_PRODUCTION_NOTICE;
			return;
		}
		acComingSoonNotice = null;
		const effectiveUnitSystem = payload.unitSystem ?? payload.document.unitSystem;
		if (effectiveUnitSystem) {
			settings.useUnitSystemForSession(effectiveUnitSystem);
		}
		circuit.loadDocument(payload.document, payload.theveninTarget);
		rightTab = 'results';
	}

	async function copyTextWithFallback(text: string): Promise<boolean> {
		if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
			try {
				await navigator.clipboard.writeText(text);
				return true;
			} catch {
				// Fall through to execCommand copy fallback
			}
		}
		if (typeof document === 'undefined') return false;
		const textarea = document.createElement('textarea');
		textarea.value = text;
		textarea.setAttribute('readonly', '');
		textarea.style.position = 'fixed';
		textarea.style.top = '-9999px';
		textarea.style.left = '-9999px';
		textarea.style.opacity = '0';
		document.body.appendChild(textarea);
		textarea.focus();
		textarea.select();
		let ok = false;
		try {
			ok = document.execCommand('copy');
		} catch {
			ok = false;
		} finally {
			textarea.remove();
		}
		return ok;
	}

	async function handleCopyShareLink(): Promise<boolean> {
		const hash = await encodeCircuitToHash({
			document: { ...circuit.document, unitSystem: settings.unitSystem },
			theveninTarget: circuit.theveninTarget,
			unitSystem: settings.unitSystem
		});
		const shareUrl = buildShareableUrl(window.location.href, hash);
		lastWrittenHash = hash;
		window.history.replaceState(null, '', hash);

		await copyTextWithFallback(shareUrl);
		linkCopied = true;
		if (linkCopiedTimer !== undefined) {
			clearTimeout(linkCopiedTimer);
		}
		linkCopiedTimer = setTimeout(() => {
			linkCopied = false;
		}, 2000);
		return true;
	}

	onMount(() => {
		void loadFromHash(window.location.hash);

		const onHashChange = () => {
			const currentHash = window.location.hash;
			if (currentHash && currentHash === lastWrittenHash) {
				return;
			}
			void loadFromHash(currentHash);
		};

		window.addEventListener('hashchange', onHashChange);
		return () => {
			window.removeEventListener('hashchange', onHashChange);
			if (linkCopiedTimer !== undefined) {
				clearTimeout(linkCopiedTimer);
			}
			if (mobileMenuCloseTimer !== undefined) {
				clearTimeout(mobileMenuCloseTimer);
			}
			if (autoWireFeedbackTimer !== undefined) {
				clearTimeout(autoWireFeedbackTimer);
			}
		};
	});
</script>

<svelte:window onkeydown={handleWindowKeydown} />

<svelte:head>
	<title>{`${IS_STAGING ? '[Staging] ' : ''}${workspaceMode === 'machines' ? 'Electrical Machines — Circuit Lab' : circuit.document.name?.trim() ? `${circuit.document.name.trim()} — Circuit Lab` : 'Circuit Lab'}`}</title>
</svelte:head>

<div class="relative flex h-dvh w-full flex-col overflow-hidden bg-background text-foreground">
	<!-- Top Toolbar -->
	<header class="flex h-12 shrink-0 items-center justify-between gap-1 border-b border-border bg-surface-rail px-2 sm:gap-1.5 sm:px-3 lg:h-11 lg:gap-2">
		<!-- Left: Rail Toggle, Brand, Workspace Switcher, Mode & Telemetry -->
		<div class="flex min-w-0 items-center gap-1 sm:gap-1.5 lg:gap-2">
			{#if workspaceMode === 'circuits'}
				<Tooltip
					content={leftRailOpen ? 'Collapse component palette' : 'Expand component palette'}
					side="bottom"
					class="hidden lg:inline-flex"
				>
					<Button
						variant="ghost"
						size="icon"
						class="h-7 w-7"
						aria-label={leftRailOpen ? 'Collapse component palette' : 'Expand component palette'}
						onclick={() => (leftRailOpen = !leftRailOpen)}
					>
						{#if leftRailOpen}
							<PanelLeftClose />
						{:else}
							<PanelLeftOpen />
						{/if}
					</Button>
				</Tooltip>
			{/if}

			<div class="flex shrink-0 items-center gap-1 sm:gap-1.5 lg:gap-2 xl:min-w-0">
				<svg
					width="18"
					height="18"
					viewBox="0 0 24 24"
					fill="none"
					stroke="currentColor"
					stroke-width="1.85"
					stroke-linecap="round"
					stroke-linejoin="round"
					aria-hidden="true"
					class="size-[18px] shrink-0 text-foreground"
				>
					<path d="M3 12h3.5l1.75-4.5 2.5 9 2.5-9 2.5 9L17.5 12H21" />
					<circle cx="3" cy="12" r="1.4" fill="currentColor" stroke="none" />
					<circle cx="21" cy="12" r="1.4" fill="currentColor" stroke="none" />
				</svg>
				<span class="hidden shrink-0 whitespace-nowrap text-[13px] font-semibold tracking-tight text-foreground sm:inline">
					Circuit Lab
				</span>
				{#if IS_STAGING}
					<span
						title={DEPLOY_COMMIT_SHA ? `Staging deployment (${DEPLOY_COMMIT_SHA})` : 'Staging deployment'}
						class="shrink-0 rounded-[3px] border border-warning/45 bg-warning/10 px-1 py-0.5 font-engineering text-[9px] font-semibold uppercase tracking-wide text-warning lg:px-1.5 lg:text-[10px]"
					>
						<span class="lg:hidden">STG</span><span class="hidden lg:inline">STAGING</span>
					</span>
				{/if}
				{#if workspaceMode === 'circuits'}
					<div class="hidden min-w-0 items-center gap-0.5 xl:flex">
						<span aria-hidden="true" class="text-xs text-muted-foreground/70">/</span>
						<EditableTitle
							value={circuit.document.name ?? ''}
							onCommit={(next) => circuit.setDocumentName(next)}
						/>
					</div>
				{/if}
			</div>

			<!-- Compact Mobile Workspace Switcher (< sm) right inside the single 48px header -->
			<button
				type="button"
				aria-label="Switch workspace mode"
				aria-haspopup="menu"
				aria-expanded={workspaceMenuOpen}
				onclick={() => {
					mobileMenuOpen = false;
					freqPopoverOpen = false;
					workspaceMenuOpen = !workspaceMenuOpen;
				}}
				class="relative inline-flex h-8 shrink-0 cursor-pointer items-center gap-1 rounded-[4px] border border-border bg-card px-2 text-xs font-semibold text-foreground transition-colors duration-150 hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring after:absolute after:-inset-y-2 after:inset-x-0 sm:hidden"
			>
				<span>{workspaceMode === 'machines' ? 'Machines' : 'Circuits'}</span>
				<ChevronDown
					class={cn(
						'size-3 shrink-0 text-muted-foreground transition-transform duration-150',
						workspaceMenuOpen && 'rotate-180'
					)}
					aria-hidden="true"
				/>
			</button>

			<Separator orientation="vertical" class="mx-0.5 hidden h-4 lg:block" />

			<!-- Top-Level Workspace Switcher: Circuits | Machines (sm+) -->
			<div
				role="radiogroup"
				aria-label="Workspace mode"
				class="hidden h-8 shrink-0 items-center rounded-[4px] border border-border bg-muted/80 p-0.5 sm:inline-flex lg:h-7"
			>
				<button
					type="button"
					role="radio"
					aria-checked={workspaceMode === 'circuits'}
					onclick={() => (workspaceMode = 'circuits')}
					class={cn(
						'relative inline-flex h-full cursor-pointer items-center justify-center rounded-[3px] border px-2 text-xs transition-colors duration-150 after:absolute after:-inset-y-3 after:inset-x-0 lg:px-2.5 lg:after:hidden',
						'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring',
						workspaceMode === 'circuits'
							? 'border-border/80 bg-card font-semibold text-foreground shadow-2xs'
							: 'border-transparent font-medium text-muted-foreground hover:text-foreground'
					)}
				>
					Circuits
				</button>
				<button
					type="button"
					role="radio"
					aria-checked={workspaceMode === 'machines'}
					onclick={() => {
						workspaceMode = 'machines';
						mobileMenuOpen = false;
						freqPopoverOpen = false;
					}}
					class={cn(
						'relative inline-flex h-full cursor-pointer items-center justify-center rounded-[3px] border px-2 text-xs transition-colors duration-150 after:absolute after:-inset-y-3 after:inset-x-0 lg:px-2.5 lg:after:hidden',
						'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring',
						workspaceMode === 'machines'
							? 'border-border/80 bg-card font-semibold text-foreground shadow-2xs'
							: 'border-transparent font-medium text-muted-foreground hover:text-foreground'
					)}
				>
					Machines
				</button>
			</div>

			{#if workspaceMode === 'circuits'}
				<!-- Compact Live Status Dot (< sm, hidden in AC mode where mobile canvas telemetry strip shows status) -->
				{#if circuit.document.mode !== 'ac'}
					<span
						role="status"
						aria-label={statusInfo.label}
						title={statusInfo.label}
						class={cn('h-2 w-2 shrink-0 rounded-full sm:hidden', statusInfo.dotClass)}
					></span>
				{/if}

				<Separator orientation="vertical" class="mx-0.5 hidden h-4 lg:block" />

				<!-- DC / AC Segmented Mode Control -->
				<div
					role="radiogroup"
					aria-label="Analysis mode"
					class="inline-flex h-8 shrink-0 items-center rounded-[4px] border border-border bg-muted/80 p-0.5 lg:h-7"
				>
					<button
						type="button"
						role="radio"
						aria-checked={circuit.document.mode === 'dc'}
						onclick={() => circuit.setMode('dc')}
						class={cn(
							'relative inline-flex h-full cursor-pointer items-center justify-center rounded-[3px] border px-1.5 text-xs transition-colors duration-150 after:absolute after:-inset-y-3 after:inset-x-0 lg:px-2.5 lg:after:hidden',
							'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring',
							circuit.document.mode === 'dc'
								? 'border-border/80 bg-card font-semibold text-foreground shadow-2xs'
								: 'border-transparent font-medium text-muted-foreground hover:text-foreground'
						)}
					>
						DC
					</button>
					<button
						type="button"
						role="radio"
						aria-checked={circuit.document.mode === 'ac'}
						disabled={!AC_ENABLED}
						aria-disabled={!AC_ENABLED ? 'true' : undefined}
						title={!AC_ENABLED ? 'AC Phasor Analysis — Coming Soon' : undefined}
						aria-label={!AC_ENABLED ? 'AC mode coming soon' : undefined}
						onclick={() => {
							if (!AC_ENABLED) return;
							circuit.setMode('ac');
						}}
						class={cn(
							'relative inline-flex h-full items-center justify-center rounded-[3px] border px-1.5 text-xs transition-colors duration-150 after:absolute after:-inset-y-3 after:inset-x-0 lg:px-2.5 lg:after:hidden',
							'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring',
							!AC_ENABLED
								? 'cursor-not-allowed border-transparent font-medium text-muted-foreground opacity-60'
								: circuit.document.mode === 'ac'
									? 'cursor-pointer border-border/80 bg-card font-semibold text-foreground shadow-2xs'
									: 'cursor-pointer border-transparent font-medium text-muted-foreground hover:text-foreground'
						)}
					>
						<span>AC</span>
						{#if !AC_ENABLED}
							<span class="hidden sm:inline ml-1 text-[9px] font-engineering uppercase text-muted-foreground">
								Soon
							</span>
						{/if}
					</button>
				</div>

				{#if circuit.document.mode === 'ac'}
					<!-- Compact Mobile & Tablet AC Frequency Trigger (< lg) -->
					<button
						type="button"
						aria-label="Edit AC frequency"
						aria-expanded={freqPopoverOpen}
						aria-haspopup="dialog"
						onclick={() => {
							mobileMenuOpen = false;
							workspaceMenuOpen = false;
							freqPopoverOpen = !freqPopoverOpen;
						}}
						class="relative inline-flex h-8 shrink-0 cursor-pointer items-center gap-0.5 rounded-[4px] border border-input bg-card px-1.5 font-engineering text-[11px] text-foreground transition-colors duration-150 hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring after:absolute after:-inset-y-2 after:inset-x-0 sm:gap-1 sm:px-2 sm:text-xs lg:hidden"
					>
						<span class="md:hidden">{formatFrequency(circuit.document.frequencyHz).replace(/\s+/g, '')}</span>
						<span class="hidden md:inline">{formatFrequency(circuit.document.frequencyHz)}</span>
						<ChevronDown class="size-3 shrink-0 text-muted-foreground" aria-hidden="true" />
					</button>

					<!-- Inline AC Frequency Input (lg+) -->
					<div class="relative hidden items-center lg:flex">
						<Input
							type="number"
							inputmode="decimal"
							min="0.001"
							step="any"
							tabular
							aria-label="AC frequency in Hertz"
							bind:value={freqDraft}
							onblur={commitToolbarFrequency}
							onkeydown={(e) => {
								if (e.key === 'Enter') (e.currentTarget as HTMLInputElement).blur();
							}}
							class="h-8 w-24 pr-7 text-sm lg:h-7 lg:w-24 lg:text-xs"
						/>
						<span class="pointer-events-none absolute right-2 font-engineering text-[11px] text-muted-foreground">
							Hz
						</span>
					</div>
				{/if}

				<Separator orientation="vertical" class="mx-0.5 hidden h-4 lg:block" />

				<!-- Inline Hairline Telemetry Indicator (sm+; dot-only on md to preserve breathing room) -->
				<span
					role="status"
					aria-label={statusInfo.label}
					title={statusInfo.label}
					class="hidden shrink-0 items-center gap-1.5 font-engineering text-[11px] sm:inline-flex"
				>
					<span
						class={cn('h-1.5 w-1.5 shrink-0 rounded-full', statusInfo.dotClass)}
						aria-hidden="true"
					></span>
					{#if isEmpty}
						<span class="text-muted-foreground md:hidden lg:inline">Empty</span>
					{:else if errorCount > 0 || !circuit.solution.mna.valid}
						<span class="font-medium text-destructive md:hidden lg:inline">
							{errorCount > 0
								? `${errorCount} ${errorCount === 1 ? 'Error' : 'Errors'}`
								: 'Invalid'}
						</span>
					{:else if isVerified}
						<span class="text-foreground md:hidden lg:inline">
							Verified<span class="hidden text-muted-foreground lg:inline">{' · ΣP = 0'}</span>
						</span>
					{:else}
						<span class="text-foreground md:hidden lg:inline">Solved (MNA)</span>
					{/if}
				</span>
			{/if}
		</div>

		<!-- Right: Dialog Launchers, Theme Toggle, Overflow Menu & Inspector Toggle -->
		<div class="flex shrink-0 items-center gap-0.5 sm:gap-1">
			{#if workspaceMode === 'circuits'}
				<div class="hidden items-center gap-0.5 md:flex">
					<Tooltip
						content={AC_ENABLED
							? 'Browse curated DC & AC circuit presets'
							: 'Browse curated DC circuit presets'}
						side="bottom"
					>
						<Button
							variant="ghost"
							size="sm"
							class="relative h-9 w-9 px-0 text-xs font-medium text-foreground/85 after:absolute after:-inset-1 hover:bg-accent hover:text-foreground lg:h-7 lg:w-auto lg:px-2 lg:after:hidden"
							aria-label="Browse circuit presets"
							onclick={() => (presetsOpen = true)}
						>
							<BookOpen />
							<span class="hidden lg:inline">Presets</span>
						</Button>
					</Tooltip>
					<Tooltip content="Import or export Circuit Lab JSON" side="bottom">
						<Button
							variant="ghost"
							size="sm"
							class="relative h-9 w-9 px-0 text-xs font-medium text-foreground/85 after:absolute after:-inset-1 hover:bg-accent hover:text-foreground lg:h-7 lg:w-auto lg:px-2 lg:after:hidden"
							aria-label="Import or export Circuit Lab JSON"
							onclick={() => (jsonOpen = true)}
						>
							<FileCode2 />
							<span class="hidden lg:inline">JSON</span>
						</Button>
					</Tooltip>
					<Tooltip content="Convert circuit image or textbook netlist via AI" side="bottom">
						<Button
							variant="ghost"
							size="sm"
							class="relative h-9 w-9 px-0 text-xs font-medium text-foreground/85 after:absolute after:-inset-1 hover:bg-accent hover:text-foreground lg:h-7 lg:w-auto lg:px-2 lg:after:hidden"
							aria-label="AI Import"
							onclick={() => (aiOpen = true)}
						>
							<ScanLine />
							<span class="hidden lg:inline">AI Import</span>
						</Button>
					</Tooltip>
					<Tooltip
						content="Copy shareable link (includes circuit, units & unknown problem)"
						side="bottom"
					>
						<Button
							variant="ghost"
							size="sm"
							class="relative h-9 w-9 px-0 text-xs font-medium text-foreground/85 after:absolute after:-inset-1 hover:bg-accent hover:text-foreground lg:h-7 lg:w-auto lg:px-2 lg:after:hidden"
							aria-label="Copy shareable circuit link"
							onclick={handleCopyShareLink}
						>
							{#if linkCopied}
								<Check class="text-success" />
								<span class="hidden lg:inline">Copied</span>
							{:else}
								<Link2 />
								<span class="hidden xl:inline">Copy Link</span>
								<span class="hidden lg:inline xl:hidden">Link</span>
							{/if}
						</Button>
					</Tooltip>

					<Separator orientation="vertical" class="mx-0.5 h-4 lg:mx-1" />

					<Tooltip content="Workbench preferences & IEEE/IEC standard" side="bottom">
						<Button
							variant="ghost"
							size="icon"
							class="relative h-9 w-9 after:absolute after:-inset-1 lg:h-7 lg:w-7 lg:after:hidden"
							aria-label="Workbench settings"
							onclick={() => (settingsOpen = true)}
						>
							<Settings />
						</Button>
					</Tooltip>
				</div>
			{:else}
				<Tooltip content="Import an Electrical Machines problem via AI" side="bottom">
					<Button
						variant="outline"
						size="sm"
						class="relative h-8 gap-1 px-2 text-xs font-medium text-foreground after:absolute after:-inset-1 hover:bg-accent hover:text-foreground sm:px-2.5 lg:h-7 lg:after:hidden"
						aria-label="AI Import"
						onclick={() => (machineAiImportOpen = true)}
					>
						<ScanLine class="size-3.5 shrink-0" aria-hidden="true" />
						<span class="sm:hidden">AI</span>
						<span class="hidden sm:inline">AI Import</span>
					</Button>
				</Tooltip>
				<Tooltip content="Workbench preferences & IEEE/IEC standard" side="bottom">
					<Button
						variant="ghost"
						size="icon"
						class="relative h-9 w-9 after:absolute after:-inset-1 sm:h-10 sm:w-10 md:h-9 md:w-9 lg:h-7 lg:w-7 lg:after:hidden"
						aria-label="Workbench settings"
						onclick={() => (settingsOpen = true)}
					>
						<Settings />
					</Button>
				</Tooltip>
			{/if}

			<Tooltip content={isDark ? 'Switch to light mode' : 'Switch to dark mode'} side="bottom">
				<Button
					variant="ghost"
					size="icon"
					class="relative h-9 w-9 after:absolute after:-inset-1 sm:h-10 sm:w-10 md:h-9 md:w-9 lg:h-7 lg:w-7 lg:after:hidden"
					aria-label={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
					onclick={toggleMode}
				>
					{#if isDark}
						<Sun />
					{:else}
						<Moon />
					{/if}
				</Button>
			</Tooltip>

			{#if workspaceMode === 'circuits'}
				<!-- Mobile Overflow Actions Trigger (< md) -->
				<Button
					variant="ghost"
					size="icon"
					class="relative h-9 w-9 after:absolute after:-inset-1 sm:h-10 sm:w-10 md:hidden"
					aria-label="More actions"
					aria-haspopup="menu"
					aria-expanded={mobileMenuOpen}
					onclick={() => {
						freqPopoverOpen = false;
						workspaceMenuOpen = false;
						mobileMenuOpen = !mobileMenuOpen;
					}}
				>
					<MoreVertical />
				</Button>

				<Tooltip
					content={rightRailOpen ? 'Collapse results & inspector' : 'Expand results & inspector'}
					side="bottom"
					class="hidden lg:inline-flex"
				>
					<Button
						variant="ghost"
						size="icon"
						class="h-7 w-7"
						aria-label={rightRailOpen
							? 'Collapse results and inspector'
							: 'Expand results and inspector'}
						onclick={() => (rightRailOpen = !rightRailOpen)}
					>
						{#if rightRailOpen}
							<PanelRightClose />
						{:else}
							<PanelRightOpen />
						{/if}
					</Button>
				</Tooltip>
			{/if}
		</div>
	</header>

	<!-- Mobile Workspace Switcher Popover (< sm) -->
	{#if workspaceMenuOpen}
		<button
			type="button"
			tabindex="-1"
			aria-label="Close workspace switcher"
			onclick={() => (workspaceMenuOpen = false)}
			class="fixed inset-0 z-40 cursor-default bg-transparent sm:hidden"
		></button>
		<div
			role="menu"
			aria-label="Workspace mode"
			class="fixed top-[52px] left-2 z-50 flex w-48 flex-col gap-0.5 rounded-[4px] border border-border bg-popover p-1.5 text-popover-foreground shadow-lg sm:hidden"
		>
			<button
				type="button"
				role="menuitemradio"
				aria-checked={workspaceMode === 'circuits'}
				onclick={() => {
					workspaceMode = 'circuits';
					workspaceMenuOpen = false;
				}}
				class={cn(
					'flex min-h-11 w-full cursor-pointer items-center justify-between gap-2 rounded-[4px] px-3 py-2 text-left text-sm transition-colors duration-150 hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
					workspaceMode === 'circuits'
						? 'bg-accent/60 font-semibold text-foreground'
						: 'font-medium text-foreground/85'
				)}
			>
				<span class="flex items-center gap-2">
					<CircuitBoard class="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
					<span>Circuits</span>
				</span>
				{#if workspaceMode === 'circuits'}
					<Check class="size-4 shrink-0 text-primary" aria-hidden="true" />
				{/if}
			</button>
			<button
				type="button"
				role="menuitemradio"
				aria-checked={workspaceMode === 'machines'}
				onclick={() => {
					workspaceMode = 'machines';
					workspaceMenuOpen = false;
					mobileMenuOpen = false;
					freqPopoverOpen = false;
				}}
				class={cn(
					'flex min-h-11 w-full cursor-pointer items-center justify-between gap-2 rounded-[4px] px-3 py-2 text-left text-sm transition-colors duration-150 hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
					workspaceMode === 'machines'
						? 'bg-accent/60 font-semibold text-foreground'
						: 'font-medium text-foreground/85'
				)}
			>
				<span class="flex items-center gap-2">
					<Cog class="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
					<span>Machines</span>
				</span>
				{#if workspaceMode === 'machines'}
					<Check class="size-4 shrink-0 text-primary" aria-hidden="true" />
				{/if}
			</button>
		</div>
	{/if}

	{#if workspaceMode === 'machines'}
		<MachinesWorkbench bind:this={machinesWorkbenchRef} />
	{:else}

	{#if acComingSoonNotice}
		<div
			role="status"
			aria-live="polite"
			class="flex shrink-0 items-center justify-between gap-2 border-b border-warning/35 bg-warning/10 px-3 py-1.5 text-xs text-foreground"
		>
			<div class="flex min-w-0 items-center gap-2">
				<span class="h-1.5 w-1.5 shrink-0 rounded-full bg-warning" aria-hidden="true"></span>
				<span class="leading-snug">{acComingSoonNotice}</span>
			</div>
			<button
				type="button"
				aria-label="Dismiss notice"
				onclick={() => (acComingSoonNotice = null)}
				class="relative inline-flex h-7 w-7 shrink-0 cursor-pointer items-center justify-center rounded-[4px] text-muted-foreground transition-colors duration-150 hover:bg-warning/15 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring after:absolute after:-inset-2 lg:after:hidden"
			>
				<X class="size-3.5" aria-hidden="true" />
			</button>
		</div>
	{/if}

	{#if autoWireFeedback}
		<div
			role="status"
			aria-live="polite"
			class="flex shrink-0 items-center justify-between gap-2 border-b border-border bg-card px-3 py-1.5 text-xs text-foreground lg:hidden"
		>
			<div class="flex min-w-0 items-center gap-2">
				<Cable class="size-3.5 shrink-0 text-primary" aria-hidden="true" />
				<span class="truncate font-engineering leading-snug">{autoWireFeedback}</span>
			</div>
			<button
				type="button"
				aria-label="Dismiss auto-wire status"
				onclick={() => {
					autoWireFeedback = null;
					if (autoWireFeedbackTimer !== undefined) {
						clearTimeout(autoWireFeedbackTimer);
					}
				}}
				class="relative inline-flex h-7 w-7 shrink-0 cursor-pointer items-center justify-center rounded-[4px] text-muted-foreground transition-colors duration-150 hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring after:absolute after:-inset-2"
			>
				<X class="size-3.5" aria-hidden="true" />
			</button>
		</div>
	{/if}

	<!-- Mobile & Tablet AC Frequency Popover (< lg) -->
	{#if freqPopoverOpen && circuit.document.mode === 'ac'}
		<button
			type="button"
			tabindex="-1"
			aria-label="Close frequency editor"
			onclick={() => (freqPopoverOpen = false)}
			class="fixed inset-0 z-40 cursor-default bg-transparent lg:hidden"
		></button>
		<div
			role="dialog"
			aria-label="AC frequency settings"
			class="fixed top-[52px] right-2 left-2 z-50 rounded-[4px] border border-border bg-popover p-3 text-popover-foreground shadow-lg sm:right-auto sm:left-3 sm:w-80 lg:hidden"
		>
			<div class="mb-2.5 flex items-center justify-between gap-2">
				<span class="text-xs font-semibold text-foreground">AC Drive Frequency</span>
				<span class="font-engineering text-xs text-muted-foreground">
					{formatFrequency(circuit.document.frequencyHz)}
				</span>
			</div>

			<div class="mb-2.5 grid grid-cols-4 gap-1.5" role="group" aria-label="Standard lab frequencies">
				{#each AC_FREQUENCY_PRESETS as preset (preset.hz)}
					{@const isActive = Math.abs(circuit.document.frequencyHz - preset.hz) < 1e-6}
					<button
						type="button"
						aria-pressed={isActive}
						onclick={() => {
							circuit.setFrequency(preset.hz);
							freqPopoverOpen = false;
						}}
						class={cn(
							'inline-flex h-11 min-h-11 cursor-pointer items-center justify-center rounded-[4px] border font-engineering text-xs transition-colors duration-150',
							'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
							isActive
								? 'border-primary/60 bg-primary/8 font-semibold text-foreground'
								: 'border-border bg-card font-medium text-muted-foreground hover:bg-accent hover:text-foreground'
						)}
					>
						{preset.label}
					</button>
				{/each}
			</div>

			<div class="flex items-center gap-2">
				<div class="relative flex-1">
					<Input
						type="number"
						inputmode="decimal"
						min="0.001"
						step="any"
						tabular
						aria-label="AC frequency in Hertz"
						bind:value={freqDraft}
						onkeydown={(e) => {
							if (e.key === 'Enter') {
								commitToolbarFrequency();
								freqPopoverOpen = false;
							} else if (e.key === 'Escape') {
								freqPopoverOpen = false;
							}
						}}
						class="h-11 pr-9 text-base sm:text-base"
					/>
					<span class="pointer-events-none absolute top-1/2 right-2.5 -translate-y-1/2 font-engineering text-xs text-muted-foreground">
						Hz
					</span>
				</div>
				<button
					type="button"
					onclick={() => {
						commitToolbarFrequency();
						freqPopoverOpen = false;
					}}
					class="inline-flex h-11 shrink-0 cursor-pointer items-center justify-center rounded-[4px] bg-foreground px-4 text-xs font-medium text-background transition-colors duration-150 hover:bg-foreground/90 active:translate-y-px focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
				>
					Apply
				</button>
			</div>
		</div>
	{/if}

	<!-- Mobile Overflow Actions Menu (< md) -->
	{#if mobileMenuOpen}
		<button
			type="button"
			tabindex="-1"
			aria-label="Close actions menu"
			onclick={() => (mobileMenuOpen = false)}
			class="fixed inset-0 z-40 cursor-default bg-transparent md:hidden"
		></button>
		<div
			role="menu"
			aria-label="More actions"
			class="fixed top-[52px] right-2 z-50 flex w-56 flex-col gap-0.5 rounded-[4px] border border-border bg-popover p-1.5 text-popover-foreground shadow-lg md:hidden"
		>
			<button
				type="button"
				role="menuitem"
				onclick={() => {
					mobileMenuOpen = false;
					presetsOpen = true;
				}}
				class="flex min-h-11 w-full cursor-pointer items-center gap-2.5 rounded-md px-3 py-2 text-left text-sm font-medium text-foreground transition-colors duration-150 hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
			>
				<BookOpen class="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
				<span>Presets</span>
			</button>
			<button
				type="button"
				role="menuitem"
				onclick={() => {
					mobileMenuOpen = false;
					jsonOpen = true;
				}}
				class="flex min-h-11 w-full cursor-pointer items-center gap-2.5 rounded-md px-3 py-2 text-left text-sm font-medium text-foreground transition-colors duration-150 hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
			>
				<FileCode2 class="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
				<span>JSON Import / Export</span>
			</button>
			<button
				type="button"
				role="menuitem"
				onclick={() => {
					mobileMenuOpen = false;
					aiOpen = true;
				}}
				class="flex min-h-11 w-full cursor-pointer items-center gap-2.5 rounded-md px-3 py-2 text-left text-sm font-medium text-foreground transition-colors duration-150 hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
			>
				<ScanLine class="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
				<span>AI Import</span>
			</button>
			<button
				type="button"
				role="menuitem"
				onclick={async () => {
					await handleCopyShareLink();
					if (mobileMenuCloseTimer !== undefined) {
						clearTimeout(mobileMenuCloseTimer);
					}
					mobileMenuCloseTimer = setTimeout(() => {
						mobileMenuOpen = false;
					}, 600);
				}}
				class="flex min-h-11 w-full cursor-pointer items-center gap-2.5 rounded-md px-3 py-2 text-left text-sm font-medium text-foreground transition-colors duration-150 hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
			>
				{#if linkCopied}
					<Check class="size-4 shrink-0 text-success" aria-hidden="true" />
					<span>Link Copied!</span>
				{:else}
					<Link2 class="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
					<span>Copy Share Link</span>
				{/if}
			</button>
			<Separator class="my-1" />
			<button
				type="button"
				role="menuitem"
				onclick={() => {
					mobileMenuOpen = false;
					settingsOpen = true;
				}}
				class="flex min-h-11 w-full cursor-pointer items-center gap-2.5 rounded-md px-3 py-2 text-left text-sm font-medium text-foreground transition-colors duration-150 hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
			>
				<Settings class="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
				<span>Settings</span>
			</button>
			<Separator class="my-1" />
			<button
				type="button"
				role="menuitem"
				disabled={circuit.document.components.length < 2}
				onclick={() => {
					mobileMenuOpen = false;
					handleAutoWire();
				}}
				class="flex min-h-11 w-full cursor-pointer items-center gap-2.5 rounded-[4px] px-3 py-2 text-left text-sm font-medium text-foreground transition-colors duration-150 hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-40"
			>
				<Cable class="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
				<span>Auto-Wire Circuit</span>
			</button>
			<button
				type="button"
				role="menuitem"
				disabled={circuit.document.components.length === 0 && circuit.document.wires.length === 0}
				onclick={() => {
					circuit.clearCircuit();
					mobileMenuOpen = false;
					mobileTab = 'canvas';
				}}
				class="flex min-h-11 w-full cursor-pointer items-center gap-2.5 rounded-md px-3 py-2 text-left text-sm font-medium text-destructive transition-colors duration-150 hover:bg-destructive/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-40"
			>
				<Eraser class="size-4 shrink-0" aria-hidden="true" />
				<span>Clear Canvas</span>
			</button>
		</div>
	{/if}

	<!-- Main 3-Pane Responsive Workbench -->
	<div class="flex min-h-0 w-full min-w-0 flex-1 overflow-hidden">
		<!-- Left Component Palette Rail (Desktop lg+) -->
		{#if leftRailOpen}
			<ComponentPalette class="hidden lg:flex" />
		{/if}

		<!-- Center Interactive Schematic Canvas -->
		<main
			class={cn(
				'relative min-w-0 flex-1 flex-col overflow-hidden',
				mobileTab === 'canvas' ? 'flex' : 'hidden lg:flex'
			)}
		>
			<SchematicCanvas
				onOpenPresets={() => (presetsOpen = true)}
				onOpenImport={() => (jsonOpen = true)}
				onOpenAiImport={() => (aiOpen = true)}
				onComponentInspect={handleCanvasComponentInspect}
				onOpenPalette={() => (paletteSheetOpen = true)}
				onMobileInspect={(id) => {
					if (id) circuit.selectComponent(id);
					mobileTab = 'inspector';
				}}
				onAutoWire={handleAutoWire}
				{autoWireFeedback}
			/>
		</main>

		<!-- Mobile & Tablet Full-Pane Results / Inspector Views (< lg) -->
		{#if mobileTab === 'results'}
			<section
				aria-label="Circuit analysis results"
				class="flex min-h-0 flex-1 flex-col overflow-y-auto bg-card p-0 lg:hidden"
			>
				{#if circuit.selectedComponent}
					<div class="sticky top-0 z-10 flex items-center justify-between gap-2 border-b border-border bg-surface-rail/90 px-4 py-1.5 text-xs backdrop-blur-xs">
						<div class="flex min-w-0 items-center gap-1.5">
							<span class="text-muted-foreground">Selected:</span>
							<span class="font-engineering truncate font-semibold text-warning">
								{circuit.selectedComponent.label}
							</span>
						</div>
						<div class="flex shrink-0 items-center gap-1">
							<Button
								variant="ghost"
								size="sm"
								class="min-h-11 px-2.5 text-xs"
								onclick={() => (mobileTab = 'inspector')}
							>
								<SlidersHorizontal class="size-3.5" aria-hidden="true" />
								<span>Inspect</span>
							</Button>
							<Button
								variant="outline"
								size="sm"
								class="min-h-11 px-2.5 text-xs"
								onclick={() => (mobileTab = 'canvas')}
							>
								<span>Canvas</span>
							</Button>
						</div>
					</div>
				{/if}

				<div class="min-w-0 flex-1">
					<ResultsPanel
						solution={circuit.solution}
						document={circuit.document}
						selectedComponentId={circuit.selectedComponentId}
						bind:activeMethod={circuit.activeMethod}
						onSelectComponent={(id) => circuit.selectComponent(id)}
						onSelectTheveninComponent={(id) => circuit.setTheveninComponent(id)}
						onApplyUnknownSolution={(idx) => circuit.applySolvedUnknown(idx)}
					/>
				</div>
			</section>
		{:else if mobileTab === 'inspector'}
			<section
				aria-label="Element property inspector"
				class="flex min-h-0 flex-1 flex-col overflow-y-auto bg-card p-0 lg:hidden"
			>
				<PropertyInspector onAutoWire={handleAutoWire} />
			</section>
		{/if}

		<!-- Right Results & Inspector Panel (Desktop lg+) -->
		{#if rightRailOpen}
			<aside
				aria-label="Results and element inspector"
				class="hidden w-[360px] shrink-0 flex-col border-l border-border bg-card lg:flex lg:w-[380px] xl:w-[440px] 2xl:w-[460px]"
			>
				<Tabs
					value={rightTab}
					variant="underline"
					onValueChange={(next) => {
						if (next === 'results' || next === 'inspector') {
							rightTab = next;
						}
					}}
					class="flex min-h-0 flex-1 flex-col"
				>
					<TabsList class="grid h-9 w-full shrink-0 grid-cols-2 gap-0 px-4">
						<TabsTrigger value="results" class="w-full">Results</TabsTrigger>
						<TabsTrigger value="inspector" class="w-full gap-1.5">
							<span>Inspector</span>
							{#if circuit.selectedComponent}
								<Badge variant="warning" class="font-engineering px-1 py-0 text-[10px]">
									{circuit.selectedComponent.label}
								</Badge>
							{:else if circuit.selectedWire}
								<Badge variant="warning" class="font-engineering px-1 py-0 text-[10px]">
									{circuit.selectedWire.id}
								</Badge>
							{/if}
						</TabsTrigger>
					</TabsList>

					{#if rightTab === 'results' && circuit.selectedComponent}
						<div class="flex items-center justify-between gap-2 border-b border-border bg-surface-rail/70 px-4 py-1.5 text-xs">
							<div class="flex min-w-0 items-center gap-1.5">
								<span class="text-muted-foreground">Selected:</span>
								<span class="font-engineering font-semibold text-warning">
									{circuit.selectedComponent.label}
								</span>
							</div>
							<Button
								variant="ghost"
								size="sm"
								class="h-6 px-2 text-[11px]"
								onclick={() => (rightTab = 'inspector')}
							>
								<SlidersHorizontal class="size-3" aria-hidden="true" />
								Edit Properties
							</Button>
						</div>
					{/if}

					<div class="flex-1 overflow-y-auto p-0">
						<TabsContent value="results">
							<ResultsPanel
								solution={circuit.solution}
								document={circuit.document}
								selectedComponentId={circuit.selectedComponentId}
								bind:activeMethod={circuit.activeMethod}
								onSelectComponent={(id) => circuit.selectComponent(id)}
								onSelectTheveninComponent={(id) => circuit.setTheveninComponent(id)}
								onApplyUnknownSolution={(idx) => circuit.applySolvedUnknown(idx)}
							/>
						</TabsContent>

						<TabsContent value="inspector">
							<PropertyInspector onAutoWire={handleAutoWire} />
						</TabsContent>
					</div>
				</Tabs>
			</aside>
		{/if}
	</div>

	<!-- Mobile & Tablet Bottom Navigation Bar (< lg) -->
	<nav
		aria-label="Workspace navigation"
		class="flex shrink-0 border-t border-border bg-surface-rail pb-safe lg:hidden"
	>
		<button
			type="button"
			aria-current={mobileTab === 'canvas' ? 'page' : undefined}
			onclick={() => (mobileTab = 'canvas')}
			class={cn(
				'relative flex min-h-[52px] flex-1 cursor-pointer flex-col items-center justify-center gap-0.5 px-2 py-1.5 text-[11px] transition-colors duration-150',
				'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring',
				mobileTab === 'canvas'
					? 'font-semibold text-foreground'
					: 'font-medium text-muted-foreground hover:text-foreground'
			)}
		>
			{#if mobileTab === 'canvas'}
				<span
					class="absolute top-0 right-3 left-3 h-0.5 bg-primary"
					aria-hidden="true"
				></span>
			{/if}
			<CircuitBoard class="size-4" aria-hidden="true" />
			<span>Canvas</span>
		</button>

		<button
			type="button"
			aria-current={mobileTab === 'results' ? 'page' : undefined}
			onclick={() => (mobileTab = 'results')}
			class={cn(
				'relative flex min-h-[52px] flex-1 cursor-pointer flex-col items-center justify-center gap-0.5 px-2 py-1.5 text-[11px] transition-colors duration-150',
				'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring',
				mobileTab === 'results'
					? 'font-semibold text-foreground'
					: 'font-medium text-muted-foreground hover:text-foreground'
			)}
		>
			{#if mobileTab === 'results'}
				<span
					class="absolute top-0 right-3 left-3 h-0.5 bg-primary"
					aria-hidden="true"
				></span>
			{/if}
			<span class="relative inline-flex items-center justify-center">
				<BarChart3 class="size-4" aria-hidden="true" />
				{#if !isEmpty && (errorCount > 0 || !circuit.solution.mna.valid)}
					<span
						class="absolute -top-0.5 -right-1.5 h-2 w-2 rounded-full bg-destructive ring-1 ring-surface-rail"
						aria-hidden="true"
					></span>
				{:else if !isEmpty && circuit.solution.mna.valid}
					<span
						class="absolute -top-0.5 -right-1.5 h-2 w-2 rounded-full bg-branch-current ring-1 ring-surface-rail"
						aria-hidden="true"
					></span>
				{/if}
			</span>
			<span>Results</span>
		</button>

		<button
			type="button"
			aria-current={mobileTab === 'inspector' ? 'page' : undefined}
			onclick={() => (mobileTab = 'inspector')}
			class={cn(
				'relative flex min-h-[52px] flex-1 cursor-pointer flex-col items-center justify-center gap-0.5 px-2 py-1.5 text-[11px] transition-colors duration-150',
				'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring',
				mobileTab === 'inspector'
					? 'font-semibold text-foreground'
					: 'font-medium text-muted-foreground hover:text-foreground'
			)}
		>
			{#if mobileTab === 'inspector'}
				<span
					class="absolute top-0 right-3 left-3 h-0.5 bg-primary"
					aria-hidden="true"
				></span>
			{/if}
			<SlidersHorizontal class="size-4" aria-hidden="true" />
			<span class="inline-flex max-w-full items-center gap-1">
				<span>Inspector</span>
				{#if circuit.selectedComponent}
					<Badge
						variant="warning"
						class="font-engineering max-w-14 truncate px-1 py-0 text-[10px] leading-tight"
					>
						{circuit.selectedComponent.label}
					</Badge>
				{:else if circuit.selectedWire}
					<Badge
						variant="warning"
						class="font-engineering max-w-14 truncate px-1 py-0 text-[10px] leading-tight"
					>
						{circuit.selectedWire.id}
					</Badge>
				{/if}
			</span>
		</button>
	</nav>
	{/if}
</div>

<!-- Mobile Component Palette Sheet -->
<Sheet
	bind:open={paletteSheetOpen}
	title="Component Palette"
	description="Tap a component or tool to arm placement on the canvas."
>
	{#if paletteSheetOpen}
		<ComponentPalette
			variant="sheet"
			onSelectTool={() => {
				paletteSheetOpen = false;
				mobileTab = 'canvas';
			}}
		/>
	{/if}
</Sheet>

<!-- Real Workbench Dialogs -->
<PresetsDialog bind:open={presetsOpen} onSelectPreset={handleSelectPreset} />
<JsonDialog
	bind:open={jsonOpen}
	document={circuit.document}
	onImportDocument={handleImportDocument}
	onCopyShareLink={handleCopyShareLink}
	{linkCopied}
/>
<ImportFromAIDialog bind:open={aiOpen} onImportDocument={handleImportDocument} />
<ImportMachineFromAIDialog
	bind:open={machineAiImportOpen}
	onImportMachine={handleMachineAiImport}
/>
<SettingsDialog bind:open={settingsOpen} />
