/**
 * Analytics consent. GA (production only, injected in hooks.server.ts) starts with all storage
 * denied, so it runs cookieless. If the visitor allows analytics, analytics_storage is granted.
 * The choice is remembered in localStorage; with storage blocked the banner simply shows again.
 */

export type ConsentChoice = 'granted' | 'denied';

export const CONSENT_STORAGE_KEY = 'circuit-lab:analytics-consent:v1';

type Gtag = (...args: unknown[]) => void;

function safeStorage(): Storage | null {
	try {
		return typeof window !== 'undefined' ? window.localStorage : null;
	} catch {
		return null;
	}
}

export function getGtag(): Gtag | null {
	if (typeof window === 'undefined') return null;
	const g = (window as unknown as { gtag?: unknown }).gtag;
	return typeof g === 'function' ? (g as Gtag) : null;
}

export function readConsent(storage: Storage | null = safeStorage()): ConsentChoice | null {
	try {
		const v = storage?.getItem(CONSENT_STORAGE_KEY);
		return v === 'granted' || v === 'denied' ? v : null;
	} catch {
		return null;
	}
}

export function writeConsent(choice: ConsentChoice, storage: Storage | null = safeStorage()): void {
	try {
		storage?.setItem(CONSENT_STORAGE_KEY, choice);
	} catch {
		// storage blocked: the choice applies to this visit only
	}
}

/** Tell GA about the choice. Ads storage always stays denied. */
export function applyConsent(choice: ConsentChoice, gtag: Gtag | null = getGtag()): void {
	gtag?.('consent', 'update', { analytics_storage: choice });
}
