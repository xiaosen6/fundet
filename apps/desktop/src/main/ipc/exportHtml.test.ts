import test from 'node:test';
import assert from 'node:assert/strict';
import type { BrowserWindow } from 'electron';
import {
  buildSessionHtmlFileName,
  makeSessionHtmlExporter,
  SESSION_NOT_ALIVE_MESSAGE,
  type SessionHtmlExportDeps,
} from './exportHtml.ts';

/** 固定时刻：2026-10-09 09:05（本地时区）→ 20261009-0905 */
const FIXED = new Date(2026, 9, 9, 9, 5);

interface Harness {
  export: (sessionId: string, parent?: BrowserWindow) => Promise<{ path: string } | null>;
  dialogs: Array<{ parent: BrowserWindow | undefined; options: { title: string; defaultPath: string; filters: unknown[] } }>;
  reveals: string[];
  exported: Array<string | undefined>;
  canceled: boolean;
  pickPath: string;
  writtenPath: string;
  exportImpl?: (outputPath?: string) => Promise<string>;
}

/** 注入 dialog/shell/会话 mock，记录调用轨迹 */
function makeHarness(live = true): Harness {
  const h = {} as Harness;
  h.dialogs = [];
  h.reveals = [];
  h.exported = [];
  h.canceled = false;
  h.pickPath = 'C:\\temp\\out.html';
  h.writtenPath = 'C:\\temp\\out.html';
  const deps: SessionHtmlExportDeps = {
    showSaveDialog: async (parent, options) => {
      h.dialogs.push({ parent, options });
      return h.canceled ? { canceled: true } : { canceled: false, filePath: h.pickPath };
    },
    showItemInFolder: (fullPath) => {
      h.reveals.push(fullPath);
    },
    getLiveSession: (id) =>
      live && id === '01234567-abcd' ? { exportSessionHtml: (p?: string) => {
        h.exported.push(p);
        return h.exportImpl ? h.exportImpl(p) : Promise.resolve(h.writtenPath);
      } } : undefined,
  };
  h.export = makeSessionHtmlExporter(deps);
  return h;
}

test('buildSessionHtmlFileName：格式 / 前 8 位 / 非法字符 / 空值兜底', async (t) => {
  await t.test('标准 UUID → Fundet-会话-前8位-yyyyMMdd-HHmm.html', () => {
    assert.equal(
      buildSessionHtmlFileName('01234567-abcd-4efd-9876-deadbeefcafe', FIXED),
      'Fundet-会话-01234567-20261009-0905.html',
    );
  });

  await t.test('短 id 取整体（不足 8 位不填充）', () => {
    assert.equal(buildSessionHtmlFileName('abc12', FIXED), 'Fundet-会话-abc12-20261009-0905.html');
  });

  await t.test('含 Windows 非法字符/空白 → 剔除后截取', () => {
    assert.equal(
      buildSessionHtmlFileName('a"b<c>d:e/f\\g|h?i*j k', FIXED),
      'Fundet-会话-abcdefgh-20261009-0905.html',
    );
  });

  await t.test('空串 / 剔除后为空 → session 兜底', () => {
    assert.equal(buildSessionHtmlFileName('', FIXED), 'Fundet-会话-session-20261009-0905.html');
    assert.equal(buildSessionHtmlFileName('???', FIXED), 'Fundet-会话-session-20261009-0905.html');
  });

  await t.test('月/日/时/分单位数补零', () => {
    assert.equal(
      buildSessionHtmlFileName('01234567', new Date(2026, 0, 2, 3, 4)),
      'Fundet-会话-01234567-20260102-0304.html',
    );
  });
});

test('SESSION_EXPORT_HTML：入参校验 + 会话活检查', async (t) => {
  await t.test('sessionId 缺失 / 空串 / 非字符串 → 参数缺失且不弹窗', async () => {
    const h = makeHarness();
    await assert.rejects(() => h.export(undefined as unknown as string), /参数缺失/);
    await assert.rejects(() => h.export(''), /参数缺失/);
    await assert.rejects(() => h.export('   '), /参数缺失/);
    await assert.rejects(() => h.export(123 as unknown as string), /参数缺失/);
    assert.equal(h.dialogs.length, 0);
  });

  await t.test('会话不在内存 → 友好文案且不弹窗', async () => {
    const h = makeHarness(false);
    await assert.rejects(() => h.export('01234567-abcd'), new RegExp(SESSION_NOT_ALIVE_MESSAGE));
    assert.equal(h.dialogs.length, 0);
    assert.equal(h.reveals.length, 0);
  });
});

test('SESSION_EXPORT_HTML：导出主流程（mock 注入）', async (t) => {
  await t.test('对话框入参：标题 + 默认文件名（.html）+ html filters；parent 透传', async () => {
    const h = makeHarness();
    const parent = { id: 1 } as unknown as BrowserWindow;
    await h.export('01234567-abcd', parent);
    assert.equal(h.dialogs.length, 1);
    assert.equal(h.dialogs[0].parent, parent);
    assert.equal(h.dialogs[0].options.title, '导出会话为网页');
    assert.ok(h.dialogs[0].options.defaultPath.startsWith('Fundet-会话-01234567-'));
    assert.ok(h.dialogs[0].options.defaultPath.endsWith('.html'));
    assert.deepEqual(h.dialogs[0].options.filters, [{ name: 'HTML 网页', extensions: ['html'] }]);
  });

  await t.test('确认保存 → 引擎拿到所选路径，reveal 用引擎返回的实际路径', async () => {
    const h = makeHarness();
    h.writtenPath = 'C:\\temp\\out (规范化).html';
    const result = await h.export('01234567-abcd');
    assert.deepEqual(result, { path: 'C:\\temp\\out (规范化).html' });
    assert.deepEqual(h.exported, ['C:\\temp\\out.html']);
    assert.deepEqual(h.reveals, ['C:\\temp\\out (规范化).html']);
  });

  await t.test('用户取消 → 返回 null，不调引擎、不 reveal', async () => {
    const h = makeHarness();
    h.canceled = true;
    assert.equal(await h.export('01234567-abcd'), null);
    assert.equal(h.exported.length, 0);
    assert.equal(h.reveals.length, 0);
  });

  await t.test('canceled=false 但 filePath 缺失 → 同取消处理', async () => {
    const h = makeHarness();
    h.pickPath = '';
    assert.equal(await h.export('01234567-abcd'), null);
    assert.equal(h.exported.length, 0);
  });

  await t.test('引擎导出抛错 → 原样上抛且不 reveal', async () => {
    const h = makeHarness();
    h.exportImpl = async () => {
      throw new Error('pi export_html failed: boom');
    };
    await assert.rejects(() => h.export('01234567-abcd'), /pi export_html failed: boom/);
    assert.equal(h.reveals.length, 0);
  });
});
