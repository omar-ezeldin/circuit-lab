import { describe, expect, it } from 'vitest';
import {
	DEFAULT_PRODUCTION_GA_ID,
	getSettingsStorageKey,
	resolveAcEnabled,
	resolveDeployEnv,
	resolveGaMeasurementId,
	resolveMachinesEnabled
} from './env';

describe('resolveDeployEnv', () => {
	it('resolves staging regardless of casing, whitespace, or isProd flag', () => {
		expect(resolveDeployEnv('staging', false)).toBe('staging');
		expect(resolveDeployEnv('staging', true)).toBe('staging');
		expect(resolveDeployEnv('  STAGING  ', true)).toBe('staging');
		expect(resolveDeployEnv('Staging', false)).toBe('staging');
	});

	it('resolves production when raw is production or isProd is true', () => {
		expect(resolveDeployEnv('production', false)).toBe('production');
		expect(resolveDeployEnv('  PRODUCTION ', false)).toBe('production');
		expect(resolveDeployEnv(undefined, true)).toBe('production');
		expect(resolveDeployEnv('', true)).toBe('production');
		expect(resolveDeployEnv('other', true)).toBe('production');
	});

	it('falls back to development when not staging and not production', () => {
		expect(resolveDeployEnv(undefined, false)).toBe('development');
		expect(resolveDeployEnv('', false)).toBe('development');
		expect(resolveDeployEnv('   ', false)).toBe('development');
		expect(resolveDeployEnv('development', false)).toBe('development');
		expect(resolveDeployEnv('unknown', false)).toBe('development');
		expect(resolveDeployEnv()).toBe('development');
	});
});

describe('getSettingsStorageKey', () => {
	it('uses an isolated storage key for staging', () => {
		expect(getSettingsStorageKey('staging')).toBe('circuit-lab:settings:staging:v1');
	});

	it('preserves the canonical storage key for production and development', () => {
		expect(getSettingsStorageKey('production')).toBe('circuit-lab:settings:v1');
		expect(getSettingsStorageKey('development')).toBe('circuit-lab:settings:v1');
	});
});

describe('resolveGaMeasurementId', () => {
	it('never resolves a GA ID on staging or development even when overridden', () => {
		expect(resolveGaMeasurementId('staging')).toBeUndefined();
		expect(resolveGaMeasurementId('staging', 'G-CUSTOM1234')).toBeUndefined();
		expect(resolveGaMeasurementId('development')).toBeUndefined();
		expect(resolveGaMeasurementId('development', 'G-CUSTOM1234')).toBeUndefined();
	});

	it('defaults to DEFAULT_PRODUCTION_GA_ID on production', () => {
		expect(DEFAULT_PRODUCTION_GA_ID).toBe('G-48B7SBXB21');
		expect(resolveGaMeasurementId('production')).toBe('G-48B7SBXB21');
		expect(resolveGaMeasurementId('production', '')).toBe('G-48B7SBXB21');
		expect(resolveGaMeasurementId('production', '   ')).toBe('G-48B7SBXB21');
	});

	it('supports explicit production override or disabling via "none"', () => {
		expect(resolveGaMeasurementId('production', ' G-TEST9999 ')).toBe('G-TEST9999');
		expect(resolveGaMeasurementId('production', 'none')).toBeUndefined();
		expect(resolveGaMeasurementId('production', '  NONE  ')).toBeUndefined();
		expect(resolveGaMeasurementId('production', 'None')).toBeUndefined();
	});
});

describe('resolveAcEnabled', () => {
	it('enables AC by default on production, staging, and development', () => {
		expect(resolveAcEnabled('production')).toBe(true);
		expect(resolveAcEnabled('staging')).toBe(true);
		expect(resolveAcEnabled('development')).toBe(true);
	});

	it('honors explicit true/false overrides regardless of environment', () => {
		expect(resolveAcEnabled('production', 'false')).toBe(false);
		expect(resolveAcEnabled('production', '  FALSE ')).toBe(false);
		expect(resolveAcEnabled('production', 'true')).toBe(true);
		expect(resolveAcEnabled('production', '  TRUE ')).toBe(true);
		expect(resolveAcEnabled('staging', 'false')).toBe(false);
		expect(resolveAcEnabled('development', ' False ')).toBe(false);
	});

	it('ignores empty or unrecognized overrides and falls back to true', () => {
		expect(resolveAcEnabled('production', '')).toBe(true);
		expect(resolveAcEnabled('production', '   ')).toBe(true);
		expect(resolveAcEnabled('production', 'yes')).toBe(true);
		expect(resolveAcEnabled('staging', 'invalid')).toBe(true);
		expect(resolveAcEnabled('development', '0')).toBe(true);
	});
});

describe('resolveMachinesEnabled', () => {
	it('disables Machines by default on production and enables it on staging and development', () => {
		expect(resolveMachinesEnabled('production')).toBe(false);
		expect(resolveMachinesEnabled('staging')).toBe(true);
		expect(resolveMachinesEnabled('development')).toBe(true);
	});

	it('honors explicit true/false overrides regardless of environment', () => {
		expect(resolveMachinesEnabled('production', 'true')).toBe(true);
		expect(resolveMachinesEnabled('production', '  TRUE ')).toBe(true);
		expect(resolveMachinesEnabled('production', 'false')).toBe(false);
		expect(resolveMachinesEnabled('staging', 'false')).toBe(false);
		expect(resolveMachinesEnabled('staging', '  FALSE ')).toBe(false);
		expect(resolveMachinesEnabled('development', ' False ')).toBe(false);
		expect(resolveMachinesEnabled('development', 'true')).toBe(true);
	});

	it('ignores empty or unrecognized overrides and falls back to env default', () => {
		expect(resolveMachinesEnabled('production', '')).toBe(false);
		expect(resolveMachinesEnabled('production', '   ')).toBe(false);
		expect(resolveMachinesEnabled('production', 'yes')).toBe(false);
		expect(resolveMachinesEnabled('staging', '')).toBe(true);
		expect(resolveMachinesEnabled('staging', 'invalid')).toBe(true);
		expect(resolveMachinesEnabled('development', '0')).toBe(true);
	});
});
