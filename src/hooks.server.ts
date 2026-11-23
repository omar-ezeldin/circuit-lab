import type { Handle } from '@sveltejs/kit';
import { GA_MEASUREMENT_ID, IS_STAGING } from '$lib/env';

const SAFE_GA_ID_PATTERN = /^[A-Za-z0-9_-]+$/;

function buildGtagSnippet(measurementId: string): string {
	if (!SAFE_GA_ID_PATTERN.test(measurementId)) return '';
	return [
		'\t\t<!-- Google tag (gtag.js) -->',
		`\t\t<script async src="https://www.googletagmanager.com/gtag/js?id=${measurementId}"></script>`,
		'\t\t<script>',
		'\t\t  window.dataLayer = window.dataLayer || [];',
		'\t\t  function gtag(){dataLayer.push(arguments);}',
		// Storage starts denied (cookieless). AnalyticsConsent grants analytics_storage if the visitor
		// allows it; ads storage always stays denied. Never send the circuit name (page title) or the
		// #c=... share payload.
		"\t\t  gtag('consent', 'default', { analytics_storage: 'denied', ad_storage: 'denied', ad_user_data: 'denied', ad_personalization: 'denied' });",
		"\t\t  gtag('js', new Date());",
		`\t\t  gtag('config', '${measurementId}', { page_title: 'Circuit Lab', page_location: location.origin + location.pathname, allow_google_signals: false, allow_ad_personalization_signals: false });`,
		'\t\t</script>'
	].join('\n');
}

export const handle: Handle = ({ event, resolve }) =>
	resolve(event, {
		transformPageChunk: ({ html }) => {
			let transformed = html;

			if (IS_STAGING) {
				transformed = transformed
					.replace('<title>', '<title>[Staging] ')
					.replace(
						'</head>',
						'\t\t<meta name="robots" content="noindex, nofollow" />\n\t</head>'
					);
			}

			if (GA_MEASUREMENT_ID) {
				const snippet = buildGtagSnippet(GA_MEASUREMENT_ID);
				if (snippet) {
					transformed = transformed.replace('</head>', `${snippet}\n\t</head>`);
				}
			}

			return transformed;
		}
	});
