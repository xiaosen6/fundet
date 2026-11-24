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
  parseWecomCalendar,
  parseWecomTodos,
  wecomTimeMs,
  wecomTodayWindow,
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

  it('已取消的会议被过滤（钉钉仍返回 status:cancelled，不过滤会持续显示为进行中）', () => {
    const raw = load('dws-calendar-full.json').replace(
      '"summary": "AI小组工作同步"',
      '"status": "cancelled", "summary": "AI小组工作同步"',
    );
    const events = parseCalendarEvents(raw, FIXTURE_NOW);
    assert.equal(events.length, 1);
    assert.equal(events[0].title, 'AI交流');
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

  it('stderr 里的 dws 错误 JSON 也能解析出业务错（不再把尾行 } 当文案）', () => {
    const stderr = JSON.stringify({
      error: { category: 'internal', code: 5, message: '操作人无花名册管理权限' },
    }, null, 2);
    assert.equal(errOf({ code: 5, stdout: '', stderr }), '操作人无花名册管理权限');
  });

  it('旧登录态刷新失败（authCode.notFound）映射为固定重新登录指引（2026-10-20 实报形状）', () => {
    const stderr = JSON.stringify({
      error: {
        category: 'internal',
        code: 5,
        message: '[UNCLASSIFIED] resolve access token: 旧版登录态已无法由当前认证服务刷新；本地 profile 已保留，请重新运行 dws auth login 完成一次重新授权；为保留原身份，请把 --profile 参数设置为下方 profile 标识:\nprofile: "ding…:175…": MCP token exchange failed: invalidParameter.authCode.notFound - 不合法的临时授权码',
      },
    }, null, 2);
    assert.equal(
      errOf({ code: 5, stdout: '', stderr }),
      '钉钉登录态已失效，请重新登录（钉钉工作台面板点「开始登录」）',
    );
  });

  it('stdout 无 JSON 时退 stderr 尾行', () => {
    const r = { code: 1, stdout: '', stderr: 'line1\nfetch failed: ETIMEDOUT 10.7.0.95:443\n' };
    assert.equal(errOf(r), 'fetch failed: ETIMEDOUT 10.7.0.95:443');
  });

  it('超长信息截 220，最后兜底退出码', () => {
    const long = 'x'.repeat(300);
    assert.equal(errOf({ code: 1, stdout: `{"error":{"message":"${long}"}}`, stderr: '' }).length, 220);
    assert.equal(errOf({ code: 3, stdout: '', stderr: '' }), '退出码 3');
  });
});

/* ---------------- 企业微信（wecom-cli）----------------
 * 注意：这里的样例**不是真机实捕**——是按官方 `wecom-cli <方法> --schema` 的返回
 * 结构拼的（2026-11-24 取自 1.3.4：calendar.schedules.list / todo.list）。登录态
 * 实测输出待用户首次授权后补抓替换。时钟注入，断言与运行日无关。 */

/** 样例数据日：2026-11-24 中午（本地时间） */
const WECOM_NOW = new Date(2026, 10, 24, 12, 0, 0).getTime();

const WECOM_CALENDAR = JSON.stringify({
  schedule_list: [
    {
      schedule_id: 'sched-1',
      subject: '周例会',
      begin_time: '2026-11-24 10:00:00',
      end_time: '2026-11-24 11:00:00',
      is_all_day: false,
      location: '3F 会议室',
      creator_name: '张三',
      attendees: [
        { userid: 'u1', name: '张三' },
        { userid: 'u2', name: '李四' },
      ],
      meeting_room: { meeting_room_id: 'r1', meeting_room_name: '301' },
      description: '同步本周进展',
    },
    { schedule_id: 'sched-2', subject: '全天外出', begin_time: '2026-11-24 00:00:00', end_time: '2026-11-24 00:00:00', is_all_day: true },
    { schedule_id: 'sched-3', subject: '早上的会', begin_time: '2026-11-24 07:00:00', end_time: '2026-11-24 07:30:00' },
    { schedule_id: 'sched-4', subject: '下午的会', begin_time: '2026-11-24 15:00:00', end_time: '2026-11-24 15:30:00' },
  ],
  schedule_list_count: 4,
});

const WECOM_TODOS = JSON.stringify({
  items: [
    { todo_id: 't1', title: '写周报', deadline: { type: 'date', value: '2026-11-20' }, status: 'proceed', creator: { user_name: '我', userid: 'u1' } },
    { todo_id: 't2', title: '准备评审材料', deadline: { type: 'datetime', value: '2026-11-24 18:00:00' }, status: 'proceed' },
    { todo_id: 't3', title: '回复邮件', status: 'proceed' },
    { todo_id: 't4', title: '今天到期', deadline: { type: 'date', value: '2026-11-24' }, status: 'proceed' },
  ],
  items_count: 4,
  has_more: false,
});

describe('wecomTimeMs（wecom-cli 时间串）', () => {
  it('不带时区 = 本地时间；日期型 = 当天 0 点', () => {
    assert.equal(wecomTimeMs('2026-11-24 10:30:00'), new Date(2026, 10, 24, 10, 30, 0).getTime());
    assert.equal(wecomTimeMs('2026-11-24'), new Date(2026, 10, 24).getTime());
  });

  it('带时区（Z / ±hh:mm）按绝对时刻', () => {
    assert.equal(wecomTimeMs('2026-11-24T02:00:00Z'), Date.parse('2026-11-24T02:00:00Z'));
    assert.equal(wecomTimeMs('2026-11-24 10:00:00+08:00'), Date.parse('2026-11-24T10:00:00+08:00'));
  });

  it('非字符串 / 空 / 认不出 → null', () => {
    assert.equal(wecomTimeMs(12345), null);
    assert.equal(wecomTimeMs(''), null);
    assert.equal(wecomTimeMs('   '), null);
    assert.equal(wecomTimeMs('明天下午'), null);
  });
});

describe('wecomTodayWindow（日程查询窗口）', () => {
  it('本地时间当天 00:00:00 – 23:59:59', () => {
    assert.deepEqual(wecomTodayWindow(new Date(2026, 10, 24, 10, 0, 0).getTime()), {
      begin_time: '2026-11-24 00:00:00',
      end_time: '2026-11-24 23:59:59',
    });
    // 跨年末的日期补零
    assert.equal(wecomTodayWindow(new Date(2026, 0, 5, 23, 0, 0).getTime()).begin_time, '2026-01-05 00:00:00');
  });
});

describe('parseWecomCalendar（官方 schema 形状）', () => {
  it('归一化 + 会议室 + 创建者 + 参会人 + 按开始时间排序', () => {
    const events = parseWecomCalendar(WECOM_CALENDAR, WECOM_NOW);
    assert.deepEqual(
      events.map((e) => e.title),
      ['全天外出', '周例会', '下午的会'],
    );
    const meeting = events[1]!;
    assert.equal(meeting.id, 'sched-1');
    assert.equal(meeting.startMs, new Date(2026, 10, 24, 10, 0, 0).getTime());
    assert.equal(meeting.endMs, new Date(2026, 10, 24, 11, 0, 0).getTime());
    assert.equal(meeting.roomName, '301');
    assert.equal(meeting.location, '3F 会议室');
    assert.equal(meeting.organizer, '张三');
    assert.deepEqual(meeting.attendees, ['张三', '李四']);
    assert.equal(meeting.description, '同步本周进展');
  });

  it('已结束超过 1 小时的不占版面；进行中的保留', () => {
    // 07:00–07:30 的会被过滤；10:00–11:00 结束刚 1 小时（12:00 − 11:00 = 1h，边界含）保留
    assert.equal(parseWecomCalendar(WECOM_CALENDAR, WECOM_NOW).length, 3);
    const later = new Date(2026, 10, 24, 12, 0, 1).getTime();
    assert.deepEqual(
      parseWecomCalendar(WECOM_CALENDAR, later).map((e) => e.title),
      ['全天外出', '下午的会'],
    );
  });

  it('全天日程算到当天最后一秒，不会被当成「已结束」', () => {
    const [allDay] = parseWecomCalendar(WECOM_CALENDAR, WECOM_NOW);
    assert.equal(allDay!.isAllDay, true);
    assert.equal(allDay!.endMs, new Date(2026, 10, 24, 23, 59, 59).getTime() + 999);
    assert.ok(allDay!.endMs! >= WECOM_NOW);
  });

  it('垃圾输入 / 缺字段返回空数组或安全默认值', () => {
    assert.deepEqual(parseWecomCalendar('not json', WECOM_NOW), []);
    assert.deepEqual(parseWecomCalendar('{"schedule_list":{}}', WECOM_NOW), []);
    assert.deepEqual(parseWecomCalendar('{}', WECOM_NOW), []);
    const [bare] = parseWecomCalendar('{"schedule_list":[{"schedule_id":"x"}]}', WECOM_NOW);
    assert.equal(bare!.title, '（无标题）');
    assert.equal(bare!.startMs, null);
    assert.deepEqual(bare!.attendees, []);
  });
});

describe('parseWecomTodos（官方 schema 形状）', () => {
  it('逾期在前，其余按截止升序、无截止垫底', () => {
    // t1 截止 11-20（逾期）；t2 今天 18:00；t4 截止日 = 今天（到当天结束，不算逾期）；t3 无截止
    assert.deepEqual(
      parseWecomTodos(WECOM_TODOS, WECOM_NOW).map((t) => t.taskId),
      ['t1', 't2', 't4', 't3'],
    );
  });

  it('date 型截止算到当天结束；datetime 型按时刻；没有优先级给默认档', () => {
    const todos = parseWecomTodos(WECOM_TODOS, WECOM_NOW);
    const byId = Object.fromEntries(todos.map((t) => [t.taskId, t]));
    assert.equal(byId.t4!.dueMs, new Date(2026, 10, 24, 23, 59, 59).getTime() + 999);
    assert.equal(byId.t2!.dueMs, new Date(2026, 10, 24, 18, 0, 0).getTime());
    assert.equal(byId.t3!.dueMs, null);
    assert.equal(byId.t1!.subject, '写周报');
    assert.equal(byId.t1!.priority, 50);
  });

  it('最多 6 条；垃圾输入返回空数组', () => {
    assert.deepEqual(parseWecomTodos('nope', WECOM_NOW), []);
    assert.deepEqual(parseWecomTodos('{"items":"x"}', WECOM_NOW), []);
    const many = JSON.stringify({
      items: Array.from({ length: 9 }, (_, i) => ({ todo_id: `t${i}`, title: `任务 ${i}` })),
    });
    assert.equal(parseWecomTodos(many, WECOM_NOW).length, 6);
  });
});
