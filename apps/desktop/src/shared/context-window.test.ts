import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  asPositiveInt,
  extractDeclaredContextWindow,
  formatTokenCount,
  inferContextWindow,
  preferScannedContextWindow,
  resolveModelContextWindow,
  contextTooSmallForTools,
} from './context-window.ts';

describe('asPositiveInt', () => {
  it('accepts integers and k/m strings', () => {
    assert.equal(asPositiveInt(128000), 128000);
    assert.equal(asPositiveInt('128k'), 128000);
    assert.equal(asPositiveInt('1m'), 1_000_000);
    assert.equal(asPositiveInt(0), undefined);
    assert.equal(asPositiveInt(-1), undefined);
  });
});

describe('extractDeclaredContextWindow', () => {
  it('reads common fields and one nested object', () => {
    assert.equal(extractDeclaredContextWindow({ context_length: 200000 }), 200000);
    assert.equal(extractDeclaredContextWindow({ info: { max_model_len: 32768 } }), 32768);
    assert.equal(extractDeclaredContextWindow({ max_tokens: 4096 }), undefined);
  });
});

describe('inferContextWindow', () => {
  it('reads k/m tags in the id', () => {
    assert.equal(inferContextWindow('moonshot-v1-128k'), 128000);
    assert.equal(inferContextWindow('foo-32k-bar'), 32000);
  });

  it('covers common families', () => {
    assert.equal(inferContextWindow('glm-5.2'), 1_000_000);
    assert.equal(inferContextWindow('GLM-5.3'), 1_000_000);
    assert.equal(inferContextWindow('glm-5.2[1m]'), 1_000_000);
    assert.equal(inferContextWindow('glm-5.1'), 256000);
    assert.equal(inferContextWindow('glm-4.7'), 256000);
    assert.equal(inferContextWindow('claude-sonnet-4'), 200000);
    assert.equal(inferContextWindow('qwen-plus'), 256000);
    assert.equal(inferContextWindow('deepseek-chat'), 256000);
    assert.equal(inferContextWindow('totally-unknown-model'), undefined);
  });
});

describe('preferScannedContextWindow', () => {
  it('replaces stale 128k with a better infer', () => {
    assert.equal(preferScannedContextWindow('glm-5.2', 128000), 1_000_000);
    assert.equal(preferScannedContextWindow('glm-5.3', undefined, 128000), 1_000_000);
  });
});

describe('resolveModelContextWindow', () => {
  it('prefers declared over inferred', () => {
    assert.equal(resolveModelContextWindow('glm-5.1', 1_000_000), 1_000_000);
    assert.equal(resolveModelContextWindow('glm-5.1'), 256000);
    assert.equal(resolveModelContextWindow('mystery'), undefined);
  });
});

describe('formatTokenCount', () => {
  it('uses K/M suffixes', () => {
    assert.equal(formatTokenCount(200000), '200K');
    assert.equal(formatTokenCount(1_000_000), '1M');
    assert.equal(formatTokenCount(512), '512');
  });
});

describe('contextTooSmallForTools', () => {
  it('自动操作开：小于 32.7k 基线（含 15% 余量）预警', () => {
    assert.equal(contextTooSmallForTools(32_768, true), true); // fundet-mini 实报场景
    assert.equal(contextTooSmallForTools(37_604, true), true); // 32700*1.15=37605 边界内
    assert.equal(contextTooSmallForTools(37_605, true), false); // 恰好等于阈值不报
    assert.equal(contextTooSmallForTools(131_072, true), false);
  });

  it('自动操作全关：按 8.5k 核心基线判断', () => {
    assert.equal(contextTooSmallForTools(8_192, false), true);
    assert.equal(contextTooSmallForTools(9_775, true), true); // 开关开着仍按高基线
    assert.equal(contextTooSmallForTools(16_384, false), false);
  });

  it('未知上下文 fail-open 不误报', () => {
    assert.equal(contextTooSmallForTools(undefined, true), false);
    assert.equal(contextTooSmallForTools(0, true), false);
    assert.equal(contextTooSmallForTools(Number.NaN, true), false);
  });
});
