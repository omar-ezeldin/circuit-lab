import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
	detectIosSafari,
	promptInstall,
	pwa,
	type BeforeInstallPromptEvent
} from './pwa.svelte';

const STATIC_DIR = resolve(process.cwd(), 'static');

function readPngDimensions(filePath: string): { width: number; height: number } {
	const buf = readFileSync(filePath);
	// PNG magic header: 89 50 4E 47 0D 0A 1A 0A
	expect(buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toBe(
		true
	);
	return {
		width: buf.readUInt32BE(16),
		height: buf.readUInt32BE(20)
	};
}

describe('PWA manifest & static icon assets', () => {
	it('provides a valid subpath-safe manifest.webmanifest with standalone display', () => {
		const manifestPath = resolve(STATIC_DIR, 'manifest.webmanifest');
		expect(existsSync(manifestPath)).toBe(true);

		const manifest = JSON.parse(readFileSync(manifestPath, 'utf-8')) as {
			name: string;
			short_name: string;
			description: string;
			start_url: string;
			scope: string;
			display: string;
			icons: Array<{ src: string; sizes: string; type: string; purpose?: string }>;
		};

		expect(manifest.name).toBe('Circuit Lab');
		expect(manifest.short_name).toBe('Circuit Lab');
		expect(manifest.description.length).toBeGreaterThan(20);
		expect(manifest.start_url).toBe('./');
		expect(manifest.scope).toBe('./');
		expect(manifest.display).toBe('standalone');
		expect(Array.isArray(manifest.icons)).toBe(true);
		expect(manifest.icons.length).toBeGreaterThanOrEqual(4);

		for (const icon of manifest.icons) {
			expect(icon.src.startsWith('./')).toBe(true);
			const filePath = resolve(STATIC_DIR, icon.src.replace(/^\.\//, ''));
			expect(existsSync(filePath)).toBe(true);

			if (icon.type === 'image/png' && /^\d+x\d+$/.test(icon.sizes)) {
				const [expectedW, expectedH] = icon.sizes.split('x').map(Number);
				const dims = readPngDimensions(filePath);
				expect(dims.width).toBe(expectedW);
				expect(dims.height).toBe(expectedH);
			}
		}

		expect(manifest.icons.some((i) => i.purpose === 'maskable')).toBe(true);
	});

	it('includes exact-dimension Apple Touch Icon, favicon PNG, and master SVGs', () => {
		const applePath = resolve(STATIC_DIR, 'apple-touch-icon.png');
		const faviconPngPath = resolve(STATIC_DIR, 'favicon-32x32.png');

		expect(existsSync(applePath)).toBe(true);
		expect(readPngDimensions(applePath)).toEqual({ width: 180, height: 180 });

		expect(existsSync(faviconPngPath)).toBe(true);
		expect(readPngDimensions(faviconPngPath)).toEqual({ width: 32, height: 32 });

		expect(existsSync(resolve(STATIC_DIR, 'icon.svg'))).toBe(true);
		expect(existsSync(resolve(STATIC_DIR, 'icon-maskable.svg'))).toBe(true);
		expect(existsSync(resolve(STATIC_DIR, 'favicon.svg'))).toBe(true);
	});
});

describe('detectIosSafari', () => {
	it('detects iPhone and iPad Safari user agents', () => {
		expect(
			detectIosSafari(
				'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1'
			)
		).toBe(true);
		expect(
			detectIosSafari(
				'Mozilla/5.0 (iPad; CPU OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1'
			)
		).toBe(true);
	});

	it('excludes non-Safari iOS browsers and non-iOS devices', () => {
		expect(
			detectIosSafari(
				'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/123.0.6312.52 Mobile/15E148 Safari/604.1'
			)
		).toBe(false);
		expect(
			detectIosSafari(
				'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Mobile Safari/537.36'
			)
		).toBe(false);
		expect(
			detectIosSafari(
				'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15'
			)
		).toBe(false);
	});
});

describe('pwa store state transitions', () => {
	afterEach(() => {
		pwa._setTestState({ deferredPrompt: null, isInstalled: false, isIosSafari: false });
	});

	function createMockPromptEvent(
		outcome: 'accepted' | 'dismissed'
	): BeforeInstallPromptEvent & { prompt: ReturnType<typeof vi.fn> } {
		const event = new Event('beforeinstallprompt') as BeforeInstallPromptEvent & {
			prompt: ReturnType<typeof vi.fn>;
		};
		Object.defineProperty(event, 'platforms', { value: ['web'] });
		event.prompt = vi.fn().mockResolvedValue(undefined);
		Object.defineProperty(event, 'userChoice', {
			value: Promise.resolve({ outcome, platform: 'web' })
		});
		return event;
	}

	it('returns unavailable when no deferred prompt exists', async () => {
		pwa._setTestState({ deferredPrompt: null, isInstalled: false });
		expect(pwa.canInstall).toBe(false);
		await expect(promptInstall()).resolves.toBe('unavailable');
	});

	it('transitions to installed when user accepts the install prompt', async () => {
		const mockEvent = createMockPromptEvent('accepted');
		pwa._setTestState({ deferredPrompt: mockEvent, isInstalled: false });

		expect(pwa.canInstall).toBe(true);
		const outcome = await pwa.promptInstall();

		expect(mockEvent.prompt).toHaveBeenCalledTimes(1);
		expect(outcome).toBe('accepted');
		expect(pwa.isInstalled).toBe(true);
		expect(pwa.canInstall).toBe(false);
		expect(pwa.installing).toBe(false);
	});

	it('clears canInstall without marking installed when user dismisses the prompt', async () => {
		const mockEvent = createMockPromptEvent('dismissed');
		pwa._setTestState({ deferredPrompt: mockEvent, isInstalled: false });

		expect(pwa.canInstall).toBe(true);
		const outcome = await pwa.promptInstall();

		expect(mockEvent.prompt).toHaveBeenCalledTimes(1);
		expect(outcome).toBe('dismissed');
		expect(pwa.isInstalled).toBe(false);
		expect(pwa.canInstall).toBe(false);
		expect(pwa.installing).toBe(false);
	});

	it('never reports canInstall when already running in standalone installed mode', () => {
		const mockEvent = createMockPromptEvent('accepted');
		pwa._setTestState({ deferredPrompt: mockEvent, isInstalled: true });
		expect(pwa.canInstall).toBe(false);
	});
});
