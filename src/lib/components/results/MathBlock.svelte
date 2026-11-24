<script lang="ts">
	import katex from 'katex';
	import { cn } from '$lib/utils';

	type Props = {
		latex: string;
		display?: boolean;
		class?: string;
	};

	let { latex, display = true, class: className }: Props = $props();

	const renderedHtml = $derived(
		katex.renderToString(latex, {
			displayMode: display,
			throwOnError: false,
			strict: false
		})
	);

	let containerEl = $state<HTMLDivElement | undefined>(undefined);
	let canScrollRight = $state(false);
	let canScrollLeft = $state(false);
	// Vertical extent of the scroll viewport (excludes margins and the horizontal scrollbar),
	// so the edge fades never paint over the scrollbar.
	let cueTop = $state(0);
	let cueHeight = $state(0);

	$effect(() => {
		if (!display || !containerEl) {
			canScrollRight = false;
			canScrollLeft = false;
			return;
		}
		void renderedHtml;

		const root = containerEl;
		// KaTeX parse errors render a bare .katex-error with no .katex-display; it wraps instead
		// of scrolling (see styles), so there is nothing to cue.
		const scroller = root.querySelector<HTMLElement>('.katex-display');
		if (!scroller) {
			canScrollRight = false;
			canScrollLeft = false;
			return;
		}

		const updateScrollCue = () => {
			const maxScroll = scroller.scrollWidth - scroller.clientWidth;
			canScrollRight = maxScroll > 2 && scroller.scrollLeft < maxScroll - 2;
			canScrollLeft = maxScroll > 2 && scroller.scrollLeft > 2;
			cueTop = scroller.offsetTop;
			cueHeight = scroller.clientHeight;
		};

		updateScrollCue();
		const rafId = requestAnimationFrame(updateScrollCue);

		scroller.addEventListener('scroll', updateScrollCue, { passive: true });

		let ro: ResizeObserver | undefined;
		if (typeof ResizeObserver !== 'undefined') {
			ro = new ResizeObserver(updateScrollCue);
			ro.observe(root);
			ro.observe(scroller);
			// The inner .katex box changes width when content width changes (e.g. a late
			// webfont swap) even though the scroller's own box does not.
			if (scroller.firstElementChild) {
				ro.observe(scroller.firstElementChild);
			}
		}

		let disposed = false;
		const fonts = typeof document !== 'undefined' ? document.fonts : undefined;
		fonts?.ready.then(() => {
			if (!disposed) updateScrollCue();
		});
		fonts?.addEventListener?.('loadingdone', updateScrollCue);

		return () => {
			disposed = true;
			cancelAnimationFrame(rafId);
			scroller.removeEventListener('scroll', updateScrollCue);
			fonts?.removeEventListener?.('loadingdone', updateScrollCue);
			ro?.disconnect();
		};
	});
</script>

{#if display}
	<div
		bind:this={containerEl}
		class={cn(
			'math-block relative min-w-0 max-w-full py-0.5 text-[0.78rem] text-foreground sm:text-[0.82rem]',
			className
		)}
	>
		{@html renderedHtml}
		{#if canScrollLeft}
			<div
				aria-hidden="true"
				class="math-fade-left pointer-events-none absolute left-0 w-5"
				style="top: {cueTop}px; height: {cueHeight}px;"
			></div>
		{/if}
		{#if canScrollRight}
			<div
				aria-hidden="true"
				class="math-fade-right pointer-events-none absolute right-0 w-7"
				style="top: {cueTop}px; height: {cueHeight}px;"
			></div>
		{/if}
	</div>
{:else}
	<span
		class={cn(
			'math-block math-inline inline-flex max-w-full items-center align-middle leading-none text-[0.78rem] text-foreground sm:text-[0.82rem]',
			className
		)}
	>
		{@html renderedHtml}
	</span>
{/if}

<style>
	.math-block :global(.katex) {
		font-size: 0.92em;
	}

	@media (min-width: 640px) {
		.math-block :global(.katex) {
			font-size: 0.98em;
		}
	}

	.math-inline {
		overflow: visible;
		padding-inline: 1px;
	}

	.math-block.math-inline :global(.katex) {
		font-size: 1em;
		line-height: 1.15;
		white-space: nowrap;
	}

	.math-block :global(.katex-display) {
		margin: 0.25rem 0;
		overflow-x: auto;
		overflow-y: hidden;
		-webkit-overflow-scrolling: touch;
		padding-bottom: 0.25rem;
		padding-inline: 0.125rem;
		/* Box-level start alignment so overflowing equations scroll from their left edge */
		text-align: left;
	}

	.math-block :global(.katex-display > .katex) {
		display: inline-block;
		min-width: 100%;
		/* Equations that fit stay centered (KaTeX default); overflowing ones fill and scroll */
		text-align: center;
		white-space: nowrap;
	}

	/* Parse errors have no scroll wrapper; wrap long tokens instead of clipping them */
	.math-block :global(.katex-error) {
		display: inline-block;
		max-width: 100%;
		white-space: pre-wrap;
		overflow-wrap: anywhere;
	}

	/* Fade color follows the surface the block sits on; containers can override --math-fade-bg */
	.math-fade-left {
		background: linear-gradient(
			to right,
			var(--math-fade-bg, var(--card)),
			color-mix(in srgb, var(--math-fade-bg, var(--card)) 70%, transparent),
			transparent
		);
	}

	.math-fade-right {
		background: linear-gradient(
			to left,
			var(--math-fade-bg, var(--card)),
			color-mix(in srgb, var(--math-fade-bg, var(--card)) 75%, transparent),
			transparent
		);
	}
</style>
