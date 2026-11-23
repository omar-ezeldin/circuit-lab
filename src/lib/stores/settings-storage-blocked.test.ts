import { afterEach, describe, expect, it, vi } from 'vitest';

describe('settings store with blocked site data', () => {
	afterEach(() => {
		vi.unstubAllGlobals();
		vi.resetModules();
	});

	it('loads defaults instead of throwing when reading localStorage throws', async () => {
		const blockedWindow = {};
		Object.defineProperty(blockedWindow, 'localStorage', {
			get() {
				throw new DOMException('The operation is insecure.', 'SecurityError');
			}
		});
		vi.stubGlobal('window', blockedWindow);
		vi.resetModules();
		const { settings } = await import('./settings.svelte');
		expect(settings.unitSystem).toBeDefined();
		expect(() => {
			settings.unitSystem = 'kohm-v-ma';
		}).not.toThrow();
	});
});

describe('unit system from a file or share link', () => {
	afterEach(() => {
		vi.unstubAllGlobals();
		vi.resetModules();
	});

	it('applies for the session without overwriting the saved preference', async () => {
		const store = new Map<string, string>();
		vi.stubGlobal('window', {
			localStorage: {
				getItem: (k: string) => store.get(k) ?? null,
				setItem: (k: string, v: string) => void store.set(k, v)
			}
		});
		vi.resetModules();
		const { settings } = await import('./settings.svelte');
		settings.unitSystem = 'ohm-v-a';
		settings.useUnitSystemForSession('kohm-v-ma');
		expect(settings.unitSystem).toBe('kohm-v-ma');
		settings.precision = settings.precision; // any other setting change persists the state
		const saved = JSON.parse([...store.values()][0]);
		expect(saved.unitSystem).toBe('ohm-v-a');
		settings.unitSystem = 'auto'; // the user's own choice wins and is saved
		expect(settings.unitSystem).toBe('auto');
	});
});
