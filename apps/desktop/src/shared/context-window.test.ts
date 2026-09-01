import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  asPositiveInt,
  extractDeclaredContextWindow,
  formatTokenCount,
  inferContextWindow,
  preferScannedContextWindow,
  resolveModelContextWindow,
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
