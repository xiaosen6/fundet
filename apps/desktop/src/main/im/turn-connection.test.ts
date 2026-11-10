import test from 'node:test';
import assert from 'node:assert/strict';
import { captureImTurnConnection, sendImTextChunks } from './turn-connection.ts';

test('同一代次的所有文本分块都使用入站时捕获的 client', async () => {
  let generation = 7;
  const oldClient = { name: 'old' };
  const connection = captureImTurnConnection(oldClient, generation, () => generation);
  const sent: string[] = [];
  const done = await sendImTextChunks(connection, ['一', '二'], async (client, chunk) => {
    assert.equal(client, oldClient);
    sent.push(chunk);
  });
  assert.equal(done, true);
  assert.deepEqual(sent, ['一', '二']);
});

test('等待期间换代：旧回合剩余分块全部丢弃，不借用新 client', async () => {
  let generation = 7;
  const oldClient = { name: 'old' };
  const newClient = { name: 'new' };
  const connection = captureImTurnConnection(oldClient, generation, () => generation);
  const sent: string[] = [];
  const done = await sendImTextChunks(connection, ['一', '二'], async (client, chunk) => {
    sent.push(chunk);
    generation += 1; // 第一块发送后 stop/start，后续不得继续发旧回合
    assert.notEqual(client, newClient);
  });
  assert.equal(done, false);
  assert.deepEqual(sent, ['一']);
});

test('回合开始前已换代：一块都不发', async () => {
  const connection = captureImTurnConnection({ name: 'old' }, 3, () => 4);
  let calls = 0;
  const done = await sendImTextChunks(connection, ['不得发送'], async () => { calls++; });
  assert.equal(done, false);
  assert.equal(calls, 0);
});
