/** 附件落入工作目录时的安全文件名（无 Node API）。 */

export function sanitizeFileName(name: string): string {
  const base = name.replace(/\\/g, '/').split('/').pop() || 'file';
  const cleaned = base.replace(/[<>:"|?*\u0000-\u001f]/g, '_').replace(/^\.+/u, '_') || 'file';
  return cleaned.slice(0, 180);
}

export function splitNameExt(name: string): { stem: string; ext: string } {
  const i = name.lastIndexOf('.');
  if (i <= 0) return { stem: name, ext: '' };
  return { stem: name.slice(0, i), ext: name.slice(i) };
}

/** `existing` 应已是小写文件名集合。 */
export function uniqueDestName(existingLower: Set<string>, originalName: string): string {
  const safe = sanitizeFileName(originalName);
  if (!existingLower.has(safe.toLowerCase())) return safe;
  const { stem, ext } = splitNameExt(safe);
  let n = 2;
  while (existingLower.has(`${stem}-${n}${ext}`.toLowerCase())) n += 1;
  return `${stem}-${n}${ext}`;
}
