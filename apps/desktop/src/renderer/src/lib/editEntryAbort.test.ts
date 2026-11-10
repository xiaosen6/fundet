/** 编辑入口的中断边界：查看/取消零副作用，提交才中断（Cindy 0e45b610 同语义）。 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const chatPage = readFileSync(new URL('../pages/ChatPage.tsx', import.meta.url), 'utf8');
const messageStream = readFileSync(new URL('../components/MessageStream.tsx', import.meta.url), 'utf8');

test('进入编辑不再存在 onEditStart/handleEditStart 立即中断通道', () => {
  assert.equal(chatPage.includes('handleEditStart'), false);
  assert.equal(chatPage.includes('onEditStart'), false);
  assert.equal(messageStream.includes('onEditStart'), false);
});

test('提交编辑仍在运行中先 await abortSession，再截断重发', () => {
  assert.match(chatPage, /if \(slice\.isRunning\) await abortSession\(activeId\)/);
  assert.match(chatPage, /truncateItemsFrom\(activeId, createdAt\)/);
});
