import type { UnitSystemId } from '$lib/engine/types';
import { DEPLOY_ENV, getSettingsStorageKey } from '$lib/env';

export type SchematicStandard = 'ieee' | 'iec';
export type AngleDisplay = 'polar' | 'rectangular' | 'both';
export type DisplayPrecision = 2 | 3 | 4;
export type AcMagnitudeMode = 'rms' | 'peak';
export type { UnitSystemId };

export interface CircuitLabSettings {
	schematicStandard: SchematicStandard;
	unitSystem: UnitSystemId;
	angleDisplay: AngleDisplay;
	precision: DisplayPrecision;
	showDcFractions: boolean;
	acMagnitudeMode: AcMagnitudeMode;
	showGrid: boolean;
	snapToGrid: boolean;
	showLiveOverlays: boolean;
}

export const SETTINGS_STORAGE_KEY = getSettingsStorageKey(DEPLOY_ENV);

export const DEFAULT_SETTINGS: Readonly<CircuitLabSettings> = Object.freeze({
	schematicStandard: 'ieee',
	unitSystem: 'auto',
	angleDisplay: 'polar',
	precision: 3,
	showDcFractions: false,
	acMagnitudeMode: 'rms',
	showGrid: true,
	snapToGrid: true,
	showLiveOverlays: true
});

function sanitizeSettings(raw: unknown): CircuitLabSettings {
	if (!raw || typeof raw !== 'object') {
		return { ...DEFAULT_SETTINGS };
	}

	const input = raw as Record<string, unknown>;

	return {
		schematicStandard:
			input.schematicStandard === 'ieee' || input.schematicStandard === 'iec'
				? input.schematicStandard
				: DEFAULT_SETTINGS.schematicStandard,
		unitSystem:
			input.unitSystem === 'auto' ||
			input.unitSystem === 'ohm-v-a' ||
			input.unitSystem === 'kohm-v-ma' ||
			input.unitSystem === 'mohm-v-ua'
				? input.unitSystem
				: DEFAULT_SETTINGS.unitSystem,
		angleDisplay:
			input.angleDisplay === 'polar' ||
			input.angleDisplay === 'rectangular' ||
			input.angleDisplay === 'both'
				? input.angleDisplay
				: DEFAULT_SETTINGS.angleDisplay,
		precision:
			input.precision === 2 || input.precision === 3 || input.precision === 4
				? input.precision
				: DEFAULT_SETTINGS.precision,
		showDcFractions:
			typeof input.showDcFractions === 'boolean'
				? input.showDcFractions
				: DEFAULT_SETTINGS.showDcFractions,
		acMagnitudeMode:
			input.acMagnitudeMode === 'rms' || input.acMagnitudeMode === 'peak'
				? input.acMagnitudeMode
				: DEFAULT_SETTINGS.acMagnitudeMode,
		showGrid:
			typeof input.showGrid === 'boolean' ? input.showGrid : DEFAULT_SETTINGS.showGrid,
		snapToGrid:
			typeof input.snapToGrid === 'boolean' ? input.snapToGrid : DEFAULT_SETTINGS.snapToGrid,
		showLiveOverlays:
			typeof input.showLiveOverlays === 'boolean'
				? input.showLiveOverlays
				: DEFAULT_SETTINGS.showLiveOverlays
	};
}

function canUseLocalStorage(): boolean {
	// Reading window.localStorage itself throws a SecurityError when site data is blocked
	// (or in sandboxed iframes); that must not white-screen the app at module load.
	try {
		return typeof window !== 'undefined' && typeof window.localStorage !== 'undefined';
	} catch {
		return false;
	}
}

function loadPersistedSettings(): CircuitLabSettings {
	if (!canUseLocalStorage()) {
		return { ...DEFAULT_SETTINGS };
	}

	try {
		const raw = window.localStorage.getItem(SETTINGS_STORAGE_KEY);
		if (!raw) {
			return { ...DEFAULT_SETTINGS };
		}
		return sanitizeSettings(JSON.parse(raw));
	} catch {
		return { ...DEFAULT_SETTINGS };
	}
}

function persistSettings(state: CircuitLabSettings): void {
	if (!canUseLocalStorage()) {
		return;
	}

	try {
		window.localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(state));
	} catch {
		// Ignore storage quota / privacy mode errors
	}
}

/**
 * Persisted Svelte 5 rune store for Circuit Lab workbench & solver preferences.
 */
class SettingsStore {
	private state = $state<CircuitLabSettings>(loadPersistedSettings());

	get schematicStandard(): SchematicStandard {
		return this.state.schematicStandard;
	}
	set schematicStandard(value: SchematicStandard) {
		this.state.schematicStandard = value;
		persistSettings(this.state);
	}

	/** Unit system carried by an opened file or share link: used for this session, never saved. */
	private sessionUnitSystem = $state<UnitSystemId | null>(null);

	get unitSystem(): UnitSystemId {
		return this.sessionUnitSystem ?? this.state.unitSystem;
	}
	/** The user's own choice: saved, and replaces any file/link unit system. */
	set unitSystem(value: UnitSystemId) {
		this.sessionUnitSystem = null;
		this.state.unitSystem = value;
		persistSettings(this.state);
	}
	/** Show a file/share link in its own unit system without overwriting the saved preference. */
	useUnitSystemForSession(value: UnitSystemId): void {
		this.sessionUnitSystem = value;
	}

	get angleDisplay(): AngleDisplay {
		return this.state.angleDisplay;
	}
	set angleDisplay(value: AngleDisplay) {
		this.state.angleDisplay = value;
		persistSettings(this.state);
	}

	get precision(): DisplayPrecision {
		return this.state.precision;
	}
	set precision(value: DisplayPrecision) {
		this.state.precision = value;
		persistSettings(this.state);
	}

	get showDcFractions(): boolean {
		return this.state.showDcFractions;
	}
	set showDcFractions(value: boolean) {
		this.state.showDcFractions = value;
		persistSettings(this.state);
	}

	get acMagnitudeMode(): AcMagnitudeMode {
		return this.state.acMagnitudeMode;
	}
	set acMagnitudeMode(value: AcMagnitudeMode) {
		this.state.acMagnitudeMode = value;
		persistSettings(this.state);
	}

	get showGrid(): boolean {
		return this.state.showGrid;
	}
	set showGrid(value: boolean) {
		this.state.showGrid = value;
		persistSettings(this.state);
	}

	get snapToGrid(): boolean {
		return this.state.snapToGrid;
	}
	set snapToGrid(value: boolean) {
		this.state.snapToGrid = value;
		persistSettings(this.state);
	}

	get showLiveOverlays(): boolean {
		return this.state.showLiveOverlays;
	}
	set showLiveOverlays(value: boolean) {
		this.state.showLiveOverlays = value;
		persistSettings(this.state);
	}

	/** Returns a plain snapshot of all current settings. */
	snapshot(): CircuitLabSettings {
		return { ...this.state };
	}

	/** Batch-updates one or more settings and persists once. */
	update(patch: Partial<CircuitLabSettings>): void {
		this.state = sanitizeSettings({ ...this.state, ...patch });
		persistSettings(this.state);
	}

	/** Restores all settings to their canonical defaults and persists. */
	reset(): void {
		this.sessionUnitSystem = null;
		this.state = { ...DEFAULT_SETTINGS };
		persistSettings(this.state);
	}

	/** Reloads settings from localStorage (useful after external storage updates or in tests). */
	reload(): void {
		this.state = loadPersistedSettings();
	}
}

export const settings = new SettingsStore();
