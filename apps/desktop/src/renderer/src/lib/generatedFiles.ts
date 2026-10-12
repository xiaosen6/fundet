/**
 * generatedFiles — 按轮次从 DisplayItem[] 派生「本轮 agent 写入的文件」。
 * ---------------------------------------------------------------------------
 * 纯派生、不新增持久化：tool 条目本身已落库并随历史回放，历史轮同样能重建。
 * 工具名判定与 lib/artifacts.ts 的 collectArtifacts 同口径（write/edit 族，
 * read/bash 不算产出）；差异是按轮次分组（每条 user 消息到下一条 user 消息
 * 之间为一个 turn），供消息流每轮末尾的产出文件卡（components/chat/
 * GeneratedFilesCard.tsx，Cindy GeneratedFilesCard 移植）消费。
 */
import type { DisplayItem } from '../stores/sessionStore';
import { extOf, fileKind } from '../../../shared/file-kind.ts';

/** 文档卡形态（Cindy DocumentArtifactFormat；扩展名判定，v1 无工具元数据）。 */
export type GeneratedDocFormat = 'pdf' | 'docx' | 'pptx' | 'xlsx';

export interface GeneratedFileRef {
  /** 工具入参原样路径（相对路径由消费方按 workDir 解析） */
  path: string;
  /** 展示用文件名（basename） */
  name: string;
  /** 非 null 时渲染为文档卡；null 渲染为普通 pill */
  doc: GeneratedDocFormat | null;
}

export const FORMAT_LABELS: Record<GeneratedDocFormat, string> = {
  pdf: 'PDF',
  docx: 'Word',
  pptx: 'PPT',
  xlsx: 'Excel',
};

const DOC_FORMAT_BY_EXT: Record<string, GeneratedDocFormat> = {
  '.pdf': 'pdf',
  '.docx': 'docx',
  '.pptx': 'pptx',
  '.xlsx': 'xlsx',
};

/** 与 collectArtifacts 同口径的写入类工具集 */
const WRITE_TOOLS = new Set(['write', 'edit', 'create', 'write_file', 'edit_file']);

function isWriteTool(name: string): boolean {
  const n = name.toLowerCase();
  const short = n.includes('__') ? (n.split('__').pop() ?? n) : n;
  return WRITE_TOOLS.has(n) || WRITE_TOOLS.has(short) || n.includes('write') || n.includes('edit');
}

function pathFromInput(input: Record<string, unknown>): string | null {
  for (const key of ['path', 'file_path', 'filePath', 'target']) {
    const v = input[key];
    if (typeof v === 'string' && v.trim()) return v.trim();
  }
  return null;
}

function pathKey(p: string): string {
  return p.replace(/\\/g, '/').toLowerCase();
}

/**
 * 单个 turn 的条目 → 本轮写入文件（有序去重）。
 * 失败（isError）与仍在跑（!done）的写入不算产出；目录形态（尾分隔符）不收。
 */
export function collectGeneratedFiles(items: readonly DisplayItem[]): GeneratedFileRef[] {
  const seen = new Set<string>();
  const out: GeneratedFileRef[] = [];
  for (const it of items) {
    if (it.kind !== 'tool' || !it.done || it.isError) continue;
    if (!isWriteTool(it.toolName)) continue;
    const p = pathFromInput(it.input);
    if (!p || /[\\/]$/.test(p)) continue;
    const key = pathKey(p);
    if (seen.has(key)) continue;
    seen.add(key);
    const name = p.replace(/\\/g, '/').split('/').pop() ?? p;
    out.push({ path: p, name, doc: DOC_FORMAT_BY_EXT[extOf(p)] ?? null });
  }
  return out;
}

/**
 * 全量条目按 user 消息切轮，产出「user 消息 id → 本轮非空产物列表」。
 * 首条 user 消息之前的条目不属于任何轮（防御，正常会话不会出现）。
 */
export function splitGeneratedFileTurns(items: readonly DisplayItem[]): Map<string, GeneratedFileRef[]> {
  const out = new Map<string, GeneratedFileRef[]>();
  let key: string | null = null;
  let bucket: DisplayItem[] | null = null;
  const flush = (): void => {
    if (key === null || bucket === null) return;
    const files = collectGeneratedFiles(bucket);
    if (files.length > 0) out.set(key, files);
  };
  for (const it of items) {
    if (it.kind === 'user') {
      flush();
      key = it.id;
      bucket = [];
    }
    bucket?.push(it);
  }
  flush();
  return out;
}

/** 折叠阈值：超过则收起为「前 6 个 + 显示另外 N 个」（Cindy 同值） */
export const MAX_VISIBLE_GENERATED_FILES = 6;

export function foldGeneratedFiles<T>(
  files: readonly T[],
  expanded: boolean,
  maxVisible: number = MAX_VISIBLE_GENERATED_FILES,
): { visible: T[]; hiddenCount: number } {
  const visible = expanded ? [...files] : files.slice(0, maxVisible);
  return { visible, hiddenCount: files.length - visible.length };
}

/**
 * 点击路由：Canvas 可内嵌预览的（文本/代码/图片/网页/音视频/Markdown）开 Canvas
 * 侧栏；pdf/docx/pptx/xlsx 及其余（zip 等）用系统默认应用打开（FS_OPEN_PATH）。
 */
export function generatedFileOpenAction(path: string): 'canvas' | 'system' {
  if (DOC_FORMAT_BY_EXT[extOf(path)]) return 'system';
  const kind = fileKind(path);
  if (
    kind === 'image' ||
    kind === 'html' ||
    kind === 'markdown' ||
    kind === 'text' ||
    kind === 'video' ||
    kind === 'audio'
  ) {
    return 'canvas';
  }
  return 'system';
}
