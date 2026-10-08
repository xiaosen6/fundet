import { describe, expect, it } from 'vitest';

import {
  PI_RELOAD_MODELS_COMMAND,
  availablePiModelKeys,
  encodeReloadModelsPayload,
  parseReloadModelsPayload,
  piCatalogOffers,
} from '../model-catalog.js';

describe('encode/parseReloadModelsPayload', () => {
  it('round-trips env maps', () => {
    const payload = encodeReloadModelsPayload({ CINDY_PI_KEY_ABC123: 'sk-secret' });
    expect(parseReloadModelsPayload(payload)).toEqual({ CINDY_PI_KEY_ABC123: 'sk-secret' });
  });

  it('keeps only whitelisted names with sane values', () => {
    const payload = encodeReloadModelsPayload({
      CINDY_PI_KEY_OK: 'v',
      CINDY_PI_KEY_lower: 'v',
      'CINDY_PI_KEY_DASH-ED': 'v',
      OTHER_VAR: 'v',
      CINDY_PI_KEY_X: '',
      CINDY_PI_KEY_LONG: 'x'.repeat(4097),
    } as unknown as Record<string, string>);
    expect(parseReloadModelsPayload(payload)).toEqual({ CINDY_PI_KEY_OK: 'v' });
  });

  it('returns empty env on malformed payload', () => {
    expect(parseReloadModelsPayload('not-json')).toEqual({});
    expect(parseReloadModelsPayload(undefined)).toEqual({});
    expect(parseReloadModelsPayload(encodeURIComponent(JSON.stringify({ env: 'nope' })))).toEqual({});
  });
});

describe('availablePiModelKeys / piCatalogOffers', () => {
  it('indexes provider+model pairs and answers membership', () => {
    const keys = availablePiModelKeys({
      models: [
        { provider: 'prov-1', id: 'm a' },
        { provider: 'prov-1', id: 'mb' },
        { provider: 'prov-2', id: 'mb' },
      ],
    });
    expect(piCatalogOffers(keys, 'prov-1', 'm a')).toBe(true);
    expect(piCatalogOffers(keys, 'prov-2', 'mb')).toBe(true);
    // provider 与 model 分别存在但组合不存在 → 不算可用
    expect(piCatalogOffers(keys, 'prov-2', 'm a')).toBe(false);
    expect(piCatalogOffers(keys, 'prov-1', 'mb')).toBe(true);
  });

  it('treats malformed shapes as empty (caller fails closed)', () => {
    expect(availablePiModelKeys(undefined).size).toBe(0);
    expect(availablePiModelKeys({ models: 'nope' }).size).toBe(0);
    expect(availablePiModelKeys({ models: [null, 42, { provider: 1, id: 'x' }] }).size).toBe(0);
  });
});

describe('PI_RELOAD_MODELS_COMMAND', () => {
  it('matches the command registered by cindy-bridge', async () => {
    const { CINDY_BRIDGE_EXTENSION_SOURCE } = await import('../cindy-bridge-source.js');
    expect(PI_RELOAD_MODELS_COMMAND).toBe('cindy-reload-models');
    expect(CINDY_BRIDGE_EXTENSION_SOURCE).toContain(
      `pi.registerCommand('${PI_RELOAD_MODELS_COMMAND}'`,
    );
  });
});
