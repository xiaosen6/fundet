/** 撤销基线缺口防线：失败/未知的轮前基线不得复用旧 HEAD。 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('./register.ts', import.meta.url), 'utf8');

test('captureAndPushTurnChanges 在读取 HEAD 前拒绝失败/未知基线', () => {
  const start = source.indexOf('async function captureAndPushTurnChanges');
  const end = source.indexOf('async function captureAndPushTurnArtifacts', start);
  const body = source.slice(start, end);
  assert.match(body, /if \(!baselineRun \|\| !\(await baselineRun\)\) return;/);
  assert.ok(body.indexOf('!(await baselineRun)') < body.indexOf('currentCheckpointHead(sessionId)'));
});

test('每轮 prepare 都保存该轮 enqueue 结果，会话关闭时清理', () => {
  assert.match(source, /turnBaselineRuns\.set\(sessionId, enqueueSnapshot\(sessionId, workDir, text\)\)/);
  assert.match(source, /turnBaselineRuns\.delete\(session\.id\)/);
});
