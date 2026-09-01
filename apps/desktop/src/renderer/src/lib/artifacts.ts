import type { DisplayItem } from '../stores/sessionStore';
import { fileKind, isImagePath as isImageFile, type FileKind } from '../../../shared/file-kind.ts';

export type ArtifactKind = FileKind;

export interface Artifact {
  path: string;
  kind: ArtifactKind;
  toolName: string;
}

export { isImageFile as isImagePath };

function extBasename(p: string): string {
  const n = p.replace(/\\/g, '/');
  const i = n.lastIndexOf('/');
  return i >= 0 ? n.slice(i + 1) : n;
}

export function basename(p: string): string {
  return extBasename(p);
}

function pathFromInput(input: Record<string, unknown>): string | null {
  for (const key of ['path', 'file_path', 'filePath', 'target']) {
    const v = input[key];
    if (typeof v === 'string' && v.trim()) return v.trim();
  }
  return null;
}

const WRITE_TOOLS = new Set(['write', 'edit', 'create', 'write_file', 'edit_file']);
const READ_TOOLS = new Set(['read', 'read_file']);

export function collectArtifacts(items: DisplayItem[]): Artifact[] {
  const seen = new Set<string>();
  const out: Artifact[] = [];
  const add = (path: string, toolName: string): void => {
    const p = path.trim();
    if (!p || seen.has(p)) return;
    seen.add(p);
    out.push({ path: p, kind: fileKind(p), toolName });
  };
  for (const it of items) {
    if (it.kind === 'user') {
      for (const a of it.attachments ?? []) add(a.path, 'attach');
      continue;
    }
    if (it.kind !== 'tool') continue;
    const name = it.toolName.toLowerCase();
    const short = name.includes('__') ? (name.split('__').pop() ?? name) : name;
    const p = pathFromInput(it.input);
    if (!p) continue;
    const isWrite =
      WRITE_TOOLS.has(name) || WRITE_TOOLS.has(short) || name.includes('write') || name.includes('edit');
    const isRead = READ_TOOLS.has(name) || READ_TOOLS.has(short) || name.includes('read');
    if (!isWrite && !isRead) continue;
    add(p, it.toolName);
  }
  return out;
}
