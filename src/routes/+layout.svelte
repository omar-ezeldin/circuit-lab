<script lang="ts">
	import '@fontsource-variable/public-sans';
	import '@fontsource-variable/jetbrains-mono';
	import '../app.css';
	import 'katex/dist/katex.min.css';
	import { ModeWatcher } from 'mode-watcher';
	import { onMount } from 'svelte';
	import type { Snippet } from 'svelte';
	import { IS_STAGING } from '$lib/env';
	import { initPwaInstallListener } from '$lib/stores/pwa.svelte';
	import AnalyticsConsent from '$lib/components/consent/AnalyticsConsent.svelte';

	let { children }: { children: Snippet } = $props();

	onMount(() => {
		return initPwaInstallListener();
	});
</script>

<svelte:head>
	{#if IS_STAGING}
		<meta name="robots" content="noindex, nofollow" />
	{/if}
</svelte:head>

<ModeWatcher defaultMode="light" />
{@render children()}
<AnalyticsConsent />
