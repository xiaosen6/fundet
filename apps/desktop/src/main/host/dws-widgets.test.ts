/**
 * dws 组件解析器单测 —— fixture 全部真机登录态实捕（__fixtures__/dws-*.json）。
 * 时钟可注入（parseCalendarEvents/parseTodos 的 nowMs）：fixture 是 2026-09-18 的
 * 数据，固定 now 才能跨日期稳定断言「已结束过滤 / 逾期排序」。
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  errOf,
  parseApprovalsPending,
  parseCalendarEvents,
  parseChatMessages,
  parseTodos,
  parseUnread,
} from './dws-widgets.ts';

const FIXTURE_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '__fixtures__');
/** fixture 数据日（2026-09-18 中午，两场会都在未来） */
const FIXTURE_NOW = Date.parse('2026-09-18T12:00:00+08:00');

function load(name: string): string {
  return fs.readFileSync(path.join(FIXTURE_DIR, name), 'utf-8');
}

describe('parseCalendarEvents（真机 fixture：今日两会）', () => {
  it('归一化 + 会议室名 + 组织者 + 按开始时间排序', () => {
    const events = parseCalendarEvents(load('dws-calendar-full.json'), FIXTURE_NOW);
    assert.equal(events.length, 2);
    assert.equal(events[0].title, 'AI小组工作同步');
    assert.equal(events[0].roomName, '508（小会议室）');
    assert.equal(events[0].organizer, '张章');
    assert.equal(events[1].title, 'AI交流');
    assert.equal(events[1].organizer, '孙记森');
    assert.ok(events[0].startMs !== null && events[0].startMs < (events[1].startMs ?? 0));
    // dateTime 带时区正确解析为 ms
    assert.equal(events[0].startMs, Date.parse('2026-09-18T14:30:00+08:00'));
  });

  it('参会人提取且不含自己（点开详情用）', () => {
    const events = parseCalendarEvents(load('dws-calendar-full.json'), FIXTURE_NOW);
    // fixture：第一场 attendees = 张章/孙记森(self)/刘成旭 → 去掉自己剩 张章、刘成旭
    assert.deepEqual(events[0].attendees, ['张章', '刘成旭']);
    // 第二场组织者是孙记森本人：fixture 中 self 标记在其自己条目上
    assert.ok(Array.isArray(events[1].attendees));
  });

  it('已结束超 1 小时的事件被过滤（时钟后移到晚上）', () => {
    const evening = Date.parse('2026-09-18T18:00:00+08:00');
    assert.equal(parseCalendarEvents(load('dws-calendar-full.json'), evening).length, 0);
  });

  it('垃圾输入返回空数组', () => {
    assert.deepEqual(parseCalendarEvents('not json', FIXTURE_NOW), []);
    assert.deepEqual(parseCalendarEvents('{"result": {}}', FIXTURE_NOW), []);
  });
});

describe('parseTodos（真机 fixture：20 卡、6 条有截止）', () => {
  it('归一化 + 截止升序、无截止垫底、最多 6 条', () => {
    const todos = parseTodos(load('dws-todo.json'), FIXTURE_NOW);
    assert.equal(todos.length, 6);
    // fixture 里 6 条有 dueTime 的全部排在前面且升序
    const withDue = todos.filter((t) => t.dueMs !== null);
    assert.equal(withDue.length, 6);
    for (let i = 1; i < withDue.length; i++) {
      assert.ok((withDue[i - 1].dueMs ?? 0) <= (withDue[i].dueMs ?? Infinity));
    }
    assert.ok(todos.every((t) => t.taskId && t.subject));
  });

  it('逾期项排最前（时钟拨到 far future）', () => {
    const later = Date.parse('2027-01-01T00:00:00+08:00');
    const todos = parseTodos(load('dws-todo.json'), later);
    assert.equal(todos.length, 6);
    assert.ok(todos[0].dueMs !== null);
  });

  it('垃圾输入返回空数组', () => {
    assert.deepEqual(parseTodos('', FIXTURE_NOW), []);
  });
});

describe('parseApprovalsPending（真机 fixture：恰好为空）', () => {
  it('空 values 返回空数组', () => {
    assert.deepEqual(parseApprovalsPending(load('dws-oa-pending.json')), []);
  });

  it('非空形状宽容提取（无真实样本，字段名容错）', () => {
    const raw = JSON.stringify({
      result: {
        values: [
          { taskId: 't1', title: '采购申请', originatorUserName: '张三', createTime: 1789700000000 },
          { processInstanceId: 'p2', templateName: '出差', creatorUserName: '李四' },
        ],
      },
    });
    assert.deepEqual(parseApprovalsPending(raw), [
      { id: 't1', title: '采购申请', initiator: '张三', createTimeMs: 1789700000000 },
      { id: 'p2', title: '出差', initiator: '李四', createTimeMs: undefined },
    ]);
  });
});

describe('parseUnread（真机 fixture）', () => {
  it('归一化 + 按最后消息时间倒序 + 未读总数求和', () => {
    const { conversations, total } = parseUnread(load('dws-unread.json'));
    assert.ok(conversations.length >= 1);
    assert.equal(conversations[0].title, '魔搭ModelScope开发者联盟群 ①');
    assert.equal(conversations[0].unread, 942);
    assert.equal(conversations[0].singleChat, false);
    assert.equal(total, conversations.reduce((s, c) => s + c.unread, 0));
    for (let i = 1; i < conversations.length; i++) {
      assert.ok((conversations[i - 1].lastMsgMs ?? 0) >= (conversations[i].lastMsgMs ?? 0));
    }
  });

  it('垃圾输入返回空', () => {
    assert.deepEqual(parseUnread('{"result": {}}'), { conversations: [], total: 0 });
  });
});

describe('parseChatMessages（真机 fixture：会话最近消息）', () => {
  it('归一化 sender/text 摘要/createTime；正文压空白并截断', () => {
    const msgs = parseChatMessages(load('dws-chat-messages.json'));
    assert.ok(msgs.length >= 2);
    assert.equal(msgs[0].sender, '张倪');
    assert.ok(msgs[0].text.length <= 140);
    assert.ok(!msgs[0].text.includes('\n'));
    // createTime '2026-09-18 17:43:42' 无时区 → Date.parse 按本地时区，非空即可
    assert.ok(msgs[0].timeMs === null || Number.isFinite(msgs[0].timeMs));
    assert.ok(msgs.every((m) => m.id && m.text));
  });

  it('垃圾输入返回空', () => {
    assert.deepEqual(parseChatMessages('{"foo": 1}'), []);
  });
});

describe('errOf（失败原因人话化）', () => {
  it('stdout 带 dws error.message 时优先取业务错（doskey 噪声免疫）', () => {
    const out = 'doskey 宏回显行\r\n{"error":{"message":"操作人无花名册管理权限","reason":"business_error"}}';
    assert.equal(errOf({ code: 1, stdout: out, stderr: '' }), '操作人无花名册管理权限');
  });

  it('stdout 无 JSON 时退 stderr 尾行', () => {
    const r = { code: 1, stdout: '', stderr: 'line1\nfetch failed: ETIMEDOUT 10.7.0.95:443\n' };
    assert.equal(errOf(r), 'fetch failed: ETIMEDOUT 10.7.0.95:443');
  });

  it('超长信息截 120，最后兜底退出码', () => {
    const long = 'x'.repeat(300);
    assert.equal(errOf({ code: 1, stdout: `{"error":{"message":"${long}"}}`, stderr: '' }).length, 120);
    assert.equal(errOf({ code: 3, stdout: '', stderr: '' }), '退出码 3');
  });
});
