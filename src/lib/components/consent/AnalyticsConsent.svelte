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
		class="fixed inset-x-0 bottom-0 z-50 border-t border-border bg-card px-4 py-3 text-xs text-foreground shadow-sm sm:text-sm"
	>
		<div class="mx-auto flex max-w-3xl flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
			<p class="leading-relaxed">
				Circuit Lab uses Google Analytics to count visits, so we can see how it is used. Your
				circuits are never sent. Allow analytics cookies?
			</p>
			<div class="flex shrink-0 gap-2">
				<Button variant="secondary" size="sm" class="min-h-11 lg:min-h-0" onclick={() => choose('denied')}>
					No thanks
				</Button>
				<Button size="sm" class="min-h-11 lg:min-h-0" onclick={() => choose('granted')}>Allow</Button>
			</div>
		</div>
	</div>
{/if}
