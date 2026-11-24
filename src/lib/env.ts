export type DeployEnv = 'production' | 'staging' | 'development';

export const DEFAULT_PRODUCTION_GA_ID = 'G-48B7SBXB21';

export function resolveDeployEnv(raw?: string, isProd = false): DeployEnv {
	const normalized = raw?.trim().toLowerCase();
	if (normalized === 'staging') return 'staging';
	if (normalized === 'production' || isProd) return 'production';
	return 'development';
}

export function resolveGaMeasurementId(
	env: DeployEnv,
	rawOverride?: string
): string | undefined {
	if (env !== 'production') return undefined;
	const trimmed = rawOverride?.trim();
	if (trimmed?.toLowerCase() === 'none') return undefined;
	return trimmed || DEFAULT_PRODUCTION_GA_ID;
}

export function resolveAcEnabled(_env: DeployEnv, rawOverride?: string): boolean {
	const normalized = rawOverride?.trim().toLowerCase();
	if (normalized === 'true') return true;
	if (normalized === 'false') return false;
	return true;
}

export function resolveMachinesEnabled(env: DeployEnv, rawOverride?: string): boolean {
	const normalized = rawOverride?.trim().toLowerCase();
	if (normalized === 'true') return true;
	if (normalized === 'false') return false;
	return env !== 'production';
}

export function getSettingsStorageKey(env: DeployEnv): string {
	return env === 'staging' ? 'circuit-lab:settings:staging:v1' : 'circuit-lab:settings:v1';
}

export const DEPLOY_ENV: DeployEnv = resolveDeployEnv(
	import.meta.env.VITE_DEPLOY_ENV as string | undefined,
	Boolean(import.meta.env.PROD)
);

export const IS_STAGING: boolean = DEPLOY_ENV === 'staging';

export const IS_PRODUCTION: boolean = DEPLOY_ENV === 'production';

export const GA_MEASUREMENT_ID: string | undefined = resolveGaMeasurementId(
	DEPLOY_ENV,
	import.meta.env.VITE_GA_MEASUREMENT_ID as string | undefined
);

export const AC_ENABLED: boolean = resolveAcEnabled(
	DEPLOY_ENV,
	import.meta.env.VITE_ENABLE_AC as string | undefined
);

export const MACHINES_ENABLED: boolean = resolveMachinesEnabled(
	DEPLOY_ENV,
	import.meta.env.VITE_ENABLE_MACHINES as string | undefined
);

export const DEPLOY_COMMIT_SHA: string | undefined =
	(import.meta.env.VITE_COMMIT_SHA as string | undefined)?.trim() || undefined;
