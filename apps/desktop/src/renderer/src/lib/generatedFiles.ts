/**
 * generatedFiles — 按轮次从 DisplayItem[] 派生「本轮 agent 产出的文件」。
 * ---------------------------------------------------------------------------
 * 两个来源合并（用户实报：写 gen_docx.js 再 node 跑出 docx，卡上只有脚本
 * 没有文档——write/edit 工具面收不到脚本运行产物）：
 * 1. kind:'turnArtifacts' 条目——主进程轮末 mtime 扫描（turn:artifacts push
 *    落库），bash/python 等脚本生成的 docx/pptx/pdf/图片，绝对路径、mtime
 *    倒序（交付文档最后落盘排最前，卡上文档先出）；
 * 2. tool 条目的 write/edit 目标——与 lib/artifacts.ts 的 collectArtifacts
 *    同口径（read/bash 不算产出）。
 * 脚本/源码类扩展（.js/.py/…）一律不展示——卡上只留交付物（用户口径）。
 * 两者都落库并随历史回放，历史轮同样能重建。按轮次分组（每条 user 消息到
 * 下一条 user 消息之间为一个 turn），供消息流每轮末尾的产出文件卡
 * （components/chat/GeneratedFilesCard.tsx）消费。
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

/**
 * 中间脚本/源码扩展：不算「产出」，产出卡不展示（用户口径：.js 这种文件
 * 不需要展示——真正要看得用 Canvas/编辑器，卡上只留交付物）。Canvas 产物
 * 列表不受此影响（工作预览面照常收）。
 */
const SCRIPT_EXTS = new Set([
  '.js', '.mjs', '.cjs', '.ts', '.tsx', '.py', '.pyw', '.sh', '.ps1', '.bat', '.cmd',
  '.rb', '.go', '.rs', '.java', '.c', '.cpp', '.h', '.hpp', '.cs', '.php', '.pl',
  '.lua', '.swift', '.kt', '.scala', '.r',
]);

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

/** 绝对路径形态（Windows 盘符 / UNC / POSIX 根）；相对路径走 basename 去重 */
function isAbsoluteish(p: string): boolean {
  return /^[a-zA-Z]:[\\/]/.test(p) || p.startsWith('/') || p.startsWith('\\\\');
}

/**
 * 单个 turn 的条目 → 本轮产出文件（有序去重）。
 * 扫描产物（绝对路径）在前、write/edit 目标在后；失败（isError）与仍在跑
 * （!done）的写入不算产出；目录形态（尾分隔符）不收。
 * 去重：绝对路径按归一全路径；相对路径只按 basename（跨来源时 write 给相对
 * 路径、扫描给绝对路径，同 basename 视为同一文件，先到的绝对路径胜出——
 * 点击路由用它更稳，不会拼错 workDir）。
 */
export function collectGeneratedFiles(items: readonly DisplayItem[]): GeneratedFileRef[] {
  const seenKeys = new Set<string>();
  const seenNames = new Set<string>();
  const out: GeneratedFileRef[] = [];
  const push = (p: string): void => {
    if (!p || /[\\/]$/.test(p)) return;
    if (SCRIPT_EXTS.has(extOf(p))) return;
    const name = p.replace(/\\/g, '/').split('/').pop() ?? p;
    const nameKey = name.toLowerCase();
    if (isAbsoluteish(p)) {
      const key = pathKey(p);
      if (seenKeys.has(key)) return;
      seenKeys.add(key);
    } else {
      if (seenNames.has(nameKey)) return;
    }
    seenNames.add(nameKey);
    out.push({ path: p, name, doc: DOC_FORMAT_BY_EXT[extOf(p)] ?? null });
  };
  for (const it of items) {
    if (it.kind === 'turnArtifacts') for (const p of it.paths) push(p);
  }
  for (const it of items) {
    if (it.kind !== 'tool' || !it.done || it.isError) continue;
    if (!isWriteTool(it.toolName)) continue;
    push(pathFromInput(it.input) ?? '');
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
 * 点击路由：Canvas 可内嵌预览的（PDF 原生 iframe、文本/代码/图片/网页/音视频/
 * Markdown）开 Canvas 侧栏；docx/pptx/xlsx（Canvas 渲染不了）及其余（zip 等）
 * 用系统默认应用打开（FS_OPEN_PATH）。
 */
export function generatedFileOpenAction(path: string): 'canvas' | 'system' {
  if (extOf(path) === '.pdf') return 'canvas';
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
