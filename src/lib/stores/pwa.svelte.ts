export interface BeforeInstallPromptEvent extends Event {
	readonly platforms: string[];
	readonly userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
	prompt(): Promise<void>;
}

interface NavigatorWithStandalone extends Navigator {
	standalone?: boolean;
}

export function detectStandaloneMode(): boolean {
	if (typeof window === 'undefined') return false;
	try {
		if (window.matchMedia?.('(display-mode: standalone)').matches) {
			return true;
		}
	} catch {
		// Ignore matchMedia errors in restricted environments
	}
	try {
		return Boolean((window.navigator as NavigatorWithStandalone)?.standalone);
	} catch {
		return false;
	}
}

export function detectIosSafari(userAgent?: string): boolean {
	const ua =
		userAgent ??
		(typeof navigator !== 'undefined' && typeof navigator.userAgent === 'string'
			? navigator.userAgent
			: '');
	if (!ua) return false;
	const isIos = /iPad|iPhone|iPod/i.test(ua);
	const isWebKit = /WebKit/i.test(ua);
	const isOtherBrowser = /CriOS|FxiOS|OPiOS|EdgiOS/i.test(ua);
	return isIos && isWebKit && !isOtherBrowser;
}

class PwaInstallStore {
	private deferredPrompt = $state<BeforeInstallPromptEvent | null>(null);
	isInstalled = $state(false);
	isIosSafari = $state(false);
	installing = $state(false);
	private initialized = false;

	readonly canInstall = $derived(!this.isInstalled && this.deferredPrompt !== null);

	init(): () => void {
		if (typeof window === 'undefined') return () => {};

		this.isInstalled = detectStandaloneMode();
		this.isIosSafari = detectIosSafari();

		if (this.initialized) {
			return () => {};
		}
		this.initialized = true;

		const handleBeforeInstallPrompt = (event: Event) => {
			if (this.isInstalled) return;
			event.preventDefault();
			this.deferredPrompt = event as BeforeInstallPromptEvent;
		};

		const handleAppInstalled = () => {
			this.isInstalled = true;
			this.deferredPrompt = null;
			this.installing = false;
		};

		const mediaQuery = window.matchMedia?.('(display-mode: standalone)');
		const handleDisplayModeChange = (event: MediaQueryListEvent) => {
			if (event.matches) {
				this.isInstalled = true;
				this.deferredPrompt = null;
			}
		};

		window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
		window.addEventListener('appinstalled', handleAppInstalled);
		mediaQuery?.addEventListener?.('change', handleDisplayModeChange);

		return () => {
			window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
			window.removeEventListener('appinstalled', handleAppInstalled);
			mediaQuery?.removeEventListener?.('change', handleDisplayModeChange);
			this.initialized = false;
		};
	}

	async promptInstall(): Promise<'accepted' | 'dismissed' | 'unavailable'> {
		if (!this.deferredPrompt || this.isInstalled) {
			return 'unavailable';
		}

		const promptEvent = this.deferredPrompt;
		this.installing = true;
		try {
			await promptEvent.prompt();
			const choice = await promptEvent.userChoice;
			if (choice.outcome === 'accepted') {
				this.isInstalled = true;
			}
			this.deferredPrompt = null;
			return choice.outcome;
		} catch {
			return 'dismissed';
		} finally {
			this.installing = false;
		}
	}

	/** Internal helper for unit testing store transitions. */
	_setTestState(next: {
		deferredPrompt?: BeforeInstallPromptEvent | null;
		isInstalled?: boolean;
		isIosSafari?: boolean;
	}): void {
		if ('deferredPrompt' in next) {
			this.deferredPrompt = next.deferredPrompt ?? null;
		}
		if ('isInstalled' in next && typeof next.isInstalled === 'boolean') {
			this.isInstalled = next.isInstalled;
		}
		if ('isIosSafari' in next && typeof next.isIosSafari === 'boolean') {
			this.isIosSafari = next.isIosSafari;
		}
		this.installing = false;
	}
}

export const pwa = new PwaInstallStore();

export function initPwaInstallListener(): () => void {
	return pwa.init();
}

export function promptInstall(): Promise<'accepted' | 'dismissed' | 'unavailable'> {
	return pwa.promptInstall();
}
