import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  MAX_VISIBLE_GENERATED_FILES,
  collectGeneratedFiles,
  foldGeneratedFiles,
  generatedFileOpenAction,
  splitGeneratedFileTurns,
} from './generatedFiles.ts';

type Items = Parameters<typeof splitGeneratedFileTurns>[0];

const user = (id: string): { kind: 'user'; id: string; text: string } => ({ kind: 'user', id, text: 'go' });
const tool = (
  id: string,
  toolName: string,
  input: Record<string, unknown>,
  extra: { done?: boolean; isError?: boolean } = {},
): { kind: 'tool'; id: string; toolName: string; input: Record<string, unknown>; done: boolean; isError?: boolean } => ({
  kind: 'tool',
  id,
  toolName,
  input,
  done: extra.done ?? true,
  ...(extra.isError ? { isError: true } : {}),
});

describe('collectGeneratedFiles', () => {
  it('按 turn 内 write/edit 目标收集；read/bash 不算产出', () => {
    const items = [
      user('u1'),
      tool('t1', 'write', { path: 'report.md' }),
      tool('t2', 'read', { path: 'input.xlsx' }),
      tool('t3', 'bash', { command: 'ls' }),
      tool('t4', 'mcp__memory__edit_file', { file_path: 'C:/w/notes.txt' }),
    ] as unknown as Items;
    assert.deepEqual(
      collectGeneratedFiles(items).map((f) => [f.path, f.doc]),
      [
        ['report.md', null],
        ['C:/w/notes.txt', null],
      ],
    );
  });

  it('失败与仍在跑的写入不算产出', () => {
    const items = [
      user('u1'),
      tool('t1', 'write', { path: 'a.md' }, { isError: true }),
      tool('t2', 'write', { path: 'b.md' }, { done: false }),
      tool('t3', 'write', { path: 'c.md' }),
    ] as unknown as Items;
    assert.deepEqual(
      collectGeneratedFiles(items).map((f) => f.path),
      ['c.md'],
    );
  });

  it('路径归一去重（斜杠/大小写）；目录形态（尾分隔符）不收', () => {
    const items = [
      user('u1'),
      tool('t1', 'write', { path: 'Out\\Report.XLSX' }),
      tool('t2', 'write', { path: 'out/report.xlsx' }),
      tool('t3', 'write', { path: 'outdir/' }),
      tool('t4', 'edit', { target: 'gen.py' }),
    ] as unknown as Items;
    const files = collectGeneratedFiles(items);
    assert.deepEqual(
      files.map((f) => [f.path, f.name, f.doc]),
      [
        ['Out\\Report.XLSX', 'Report.XLSX', 'xlsx'],
        ['gen.py', 'gen.py', null],
      ],
    );
  });

  it('文档卡格式判定：pdf/docx/pptx/xlsx；.doc/.md/.py 是普通 pill', () => {
    const items = [
      user('u1'),
      tool('t1', 'write', { path: 'a.pdf' }),
      tool('t2', 'write', { path: 'b.docx' }),
      tool('t3', 'write', { path: 'c.pptx' }),
      tool('t4', 'write', { path: 'd.xlsx' }),
      tool('t5', 'write', { path: 'e.doc' }),
      tool('t6', 'write', { path: 'f.md' }),
      tool('t7', 'write', { path: 'g.py' }),
    ] as unknown as Items;
    assert.deepEqual(
      collectGeneratedFiles(items).map((f) => f.doc),
      ['pdf', 'docx', 'pptx', 'xlsx', null, null, null],
    );
  });
});

describe('splitGeneratedFileTurns（轮次分组）', () => {
  it('每条 user 消息到下一条 user 消息之间为一个 turn；无产物轮不出条目', () => {
    const items = [
      user('u1'),
      tool('t1', 'write', { path: 'a.md' }),
      { kind: 'assistant', id: 'a1', text: 'ok' },
      user('u2'),
      { kind: 'assistant', id: 'a2', text: 'no files' },
      user('u3'),
      tool('t2', 'write', { path: 'b.pdf' }),
    ] as unknown as Items;
    const turns = splitGeneratedFileTurns(items);
    assert.deepEqual([...turns.keys()], ['u1', 'u3']);
    assert.deepEqual(
      turns.get('u1')?.map((f) => f.path),
      ['a.md'],
    );
    assert.deepEqual(
      turns.get('u3')?.map((f) => [f.path, f.doc]),
      [['b.pdf', 'pdf']],
    );
  });

  it('首条 user 消息之前的条目不属于任何轮（防御）', () => {
    const items = [tool('t0', 'write', { path: 'orphan.md' }), user('u1'), tool('t1', 'write', { path: 'a.md' })] as unknown as Items;
    const turns = splitGeneratedFileTurns(items);
    assert.deepEqual([...turns.keys()], ['u1']);
    assert.deepEqual(
      turns.get('u1')?.map((f) => f.path),
      ['a.md'],
    );
  });
});

describe('foldGeneratedFiles（折叠逻辑）', () => {
  const files = Array.from({ length: 8 }, (_, i) => i);

  it('不超过阈值全展示', () => {
    const six = files.slice(0, MAX_VISIBLE_GENERATED_FILES);
    assert.deepEqual(foldGeneratedFiles(six, false), { visible: six, hiddenCount: 0 });
  });

  it('超过阈值折叠为前 N + 隐藏计数；展开全量', () => {
    assert.deepEqual(foldGeneratedFiles(files, false), {
      visible: files.slice(0, MAX_VISIBLE_GENERATED_FILES),
      hiddenCount: 2,
    });
    assert.deepEqual(foldGeneratedFiles(files, true), { visible: files, hiddenCount: 0 });
  });
});

describe('generatedFileOpenAction（点击路由）', () => {
  it('Canvas 可预览的走 canvas；pdf/docx/pptx/xlsx 及其余走系统打开', () => {
    const canvas = ['a.txt', 'gen.py', 'shot.png', 'site/index.html', 'clip.mp4', 'note.md', 'song.mp3'];
    const system = ['report.pdf', 'doc.docx', 'slides.pptx', 'sheet.xlsx', 'old.doc', 'bundle.zip', 'app.exe'];
    for (const p of canvas) assert.equal(generatedFileOpenAction(p), 'canvas', p);
    for (const p of system) assert.equal(generatedFileOpenAction(p), 'system', p);
  });
});
