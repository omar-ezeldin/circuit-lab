import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { applyConsent, readConsent, writeConsent, CONSENT_STORAGE_KEY } from './analytics-consent';

function memoryStorage(): Storage {
	const m = new Map<string, string>();
	return {
		getItem: (k) => m.get(k) ?? null,
		setItem: (k, v) => void m.set(k, v),
		removeItem: (k) => void m.delete(k),
		clear: () => m.clear(),
		key: () => null,
		length: 0
	} as Storage;
}

describe('analytics consent', () => {
	it('remembers the choice and tells GA only about analytics storage', () => {
		const s = memoryStorage();
		expect(readConsent(s)).toBeNull();
		writeConsent('granted', s);
		expect(readConsent(s)).toBe('granted');
		s.setItem(CONSENT_STORAGE_KEY, 'garbage');
		expect(readConsent(s)).toBeNull();

		const calls: unknown[][] = [];
		applyConsent('granted', (...a) => calls.push(a));
		expect(calls).toEqual([['consent', 'update', { analytics_storage: 'granted' }]]);
	});

	it('survives blocked storage', () => {
		const blocked = {
			getItem: () => {
				throw new Error('SecurityError');
			},
			setItem: () => {
				throw new Error('SecurityError');
			}
		} as unknown as Storage;
		expect(readConsent(blocked)).toBeNull();
		expect(() => writeConsent('denied', blocked)).not.toThrow();
	});

	it('positions AnalyticsConsent as a non-occluding floating card above mobile and desktop bottom chrome', () => {
		const source = readFileSync(
			resolve(process.cwd(), 'src/lib/components/consent/AnalyticsConsent.svelte'),
			'utf8'
		);
		expect(source).not.toMatch(/\bbottom-0\b/);
		expect(source).not.toMatch(/\binset-x-0\b/);
		expect(source).toContain('bottom-[calc(7rem+env(safe-area-inset-bottom))]');
		expect(source).toContain('lg:bottom-12');
		expect(source).toContain('sm:max-w-sm');
		expect(source).toContain('role="region"');
		expect(source).toContain('aria-label="Analytics cookies"');
		expect(source).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
	});
});
