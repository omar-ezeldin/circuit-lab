import { describe, expect, it } from 'vitest';
import { render } from 'svelte/server';
import Page from './+page.svelte';

describe('Workbench Header Bar (+page.svelte)', () => {
	it('renders unified More actions trigger on all viewports, Sparkles AI Import button, and zero header Verified telemetry badge', () => {
		const { body } = render(Page);

		const headerMatch = body.match(/<header\b[^>]*>[\s\S]*?<\/header>/);
		expect(headerMatch, 'should render a <header> element').not.toBeNull();
		const headerHtml = headerMatch![0];

		// 1. No inconsistent "Verified · ΣP = 0" / status dot telemetry badge in header
		expect(headerHtml).not.toContain('Verified');
		expect(headerHtml).not.toContain('ΣP = 0');
		expect(headerHtml).not.toContain('Solved (MNA)');
		expect(headerHtml).not.toContain('Circuit is empty');
		expect(headerHtml).not.toContain('role="status"');

		// 2. Unified More actions trigger available on ALL viewports (no md:hidden)
		const moreBtnMatch = headerHtml.match(/<button\b[^>]*aria-label="More actions"[^>]*>/);
		expect(moreBtnMatch, 'should render More actions trigger in header').not.toBeNull();
		expect(moreBtnMatch![0]).not.toContain('md:hidden');
		expect(moreBtnMatch![0]).toContain('aria-haspopup="menu"');

		// 3. Unified AI Import button uses Sparkles icon (never ScanLine)
		const aiBtnMatch = headerHtml.match(/<button\b[^>]*aria-label="AI Import"[^>]*>[\s\S]*?<\/button>/);
		expect(aiBtnMatch, 'should render AI Import button in header').not.toBeNull();
		expect(aiBtnMatch![0]).toContain('lucide-sparkles');
		expect(body).not.toContain('lucide-scan-line');

		// 4. Secondary actions (Presets, JSON, Copy Link, Settings) are moved out of the header bar into More menu
		expect(headerHtml).not.toContain('aria-label="Browse circuit presets"');
		expect(headerHtml).not.toContain('aria-label="Import or export Circuit Lab JSON"');
		expect(headerHtml).not.toContain('aria-label="Copy shareable circuit link"');
		expect(headerHtml).not.toContain('aria-label="Workbench settings"');

		// 5. Uniform control geometry & heights (h-8 / lg:h-7, rounded-[4px])
		expect(headerHtml).toContain('h-12');
		expect(headerHtml).toContain('lg:h-11');
		expect(aiBtnMatch![0]).toContain('h-8');
		expect(aiBtnMatch![0]).toContain('lg:h-7');
		expect(aiBtnMatch![0]).toContain('rounded-[4px]');
		expect(moreBtnMatch![0]).toContain('h-8');
		expect(moreBtnMatch![0]).toContain('lg:h-7');
		expect(moreBtnMatch![0]).toContain('rounded-[4px]');
	});
});
