/**
 * 已知模型补全：输入模态优先级（Cindy #5d5e7470d 优先级规格）。
 * node --test 直跑（纯数据模块，无 Electron 依赖）。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveModelInputModality } from './pi-model-catalog.ts';

test('显式 text-only 覆盖目录的视觉标注（取消视觉勾选必须生效）', () => {
  // glm-4.6v 在目录里是视觉模型；用户取消勾选后 DB 写 ['text']——
  // 改前会落回目录的 ['text','image']，端到端把发图重新放行。
  const known = { input: ['text', 'image'] as Array<'text' | 'image'> };
  assert.deepEqual(resolveModelInputModality(['text'], known), ['text']);
});

test('显式视觉开启保持（未知/文本目录模型勾选视觉照常放行）', () => {
  const knownTextOnly = { input: ['text'] as Array<'text' | 'image'> };
  const knownUnknown = {};
  assert.deepEqual(resolveModelInputModality(['text', 'image'], knownTextOnly), ['text', 'image']);
  assert.deepEqual(resolveModelInputModality(['text', 'image'], knownUnknown), ['text', 'image']);
});

test('未声明时目录补视觉；目录无视觉则不带字段（pi 侧按 text-only 收口）', () => {
  const knownVision = { input: ['text', 'image'] as Array<'text' | 'image'> };
  const knownText = { input: ['text'] as Array<'text' | 'image'> };
  assert.deepEqual(resolveModelInputModality(undefined, knownVision), ['text', 'image']);
  assert.equal(resolveModelInputModality(undefined, knownText), undefined);
  assert.equal(resolveModelInputModality(undefined, undefined), undefined);
});
