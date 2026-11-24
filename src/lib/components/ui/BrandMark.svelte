<script lang="ts">
	import { cn } from '$lib/utils';

	type Props = {
		size?: number;
		class?: string;
	};

	let { size = 20, class: className }: Props = $props();
</script>

<svg
	width={size}
	height={size}
	viewBox="0 0 32 32"
	fill="none"
	aria-hidden="true"
	class={cn('shrink-0', className)}
>
	<rect
		x="1"
		y="1"
		width="30"
		height="30"
		rx="7"
		fill="#0F141D"
		stroke="#263042"
		stroke-width="1.25"
	/>
	<path
		d="M 6.5 16 H 9 L 10.75 11.25 L 13.5 20.75 L 16.25 11.25 L 19 20.75 L 21.75 11.25 L 23.5 16 H 25.5"
		stroke="#3B82F6"
		stroke-width="2.4"
		stroke-linecap="round"
		stroke-linejoin="round"
	/>
	<circle cx="5.75" cy="16" r="2" fill="#F8FAFC" />
	<circle cx="26.25" cy="16" r="2" fill="#F8FAFC" />
</svg>
