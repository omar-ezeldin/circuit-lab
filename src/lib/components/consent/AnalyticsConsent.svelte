<script lang="ts">
	import { onMount } from 'svelte';
	import { Button } from '$lib/components/ui';
	import {
		applyConsent,
		getGtag,
		readConsent,
		writeConsent,
		type ConsentChoice
	} from '$lib/analytics-consent';

	// Only shown where GA is actually loaded (production), and only until the visitor chooses.
	let visible = $state(false);

	onMount(() => {
		if (!getGtag()) return;
		const stored = readConsent();
		if (stored) {
			applyConsent(stored);
		} else {
			visible = true;
		}
	});

	function choose(choice: ConsentChoice) {
		writeConsent(choice);
		applyConsent(choice);
		visible = false;
	}
</script>

{#if visible}
	<div
		role="region"
		aria-label="Analytics cookies"
		class="fixed right-3 bottom-[calc(7rem+env(safe-area-inset-bottom))] left-3 z-50 rounded-[4px] border border-border bg-popover px-3.5 py-2.5 text-xs text-popover-foreground shadow-lg sm:right-3 sm:left-auto sm:max-w-sm lg:bottom-12"
	>
		<div class="flex flex-col gap-2">
			<p class="leading-relaxed">
				Circuit Lab uses Google Analytics to count visits, so we can see how it is used. Your
				circuits are never sent. Allow analytics cookies?
			</p>
			<div class="flex shrink-0 items-center justify-end gap-2">
				<Button
					variant="secondary"
					size="sm"
					class="min-h-11 lg:min-h-0"
					onclick={() => choose('denied')}
				>
					No thanks
				</Button>
				<Button size="sm" class="min-h-11 lg:min-h-0" onclick={() => choose('granted')}>Allow</Button>
			</div>
		</div>
	</div>
{/if}
