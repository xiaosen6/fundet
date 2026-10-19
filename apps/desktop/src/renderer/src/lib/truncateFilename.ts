/**
 * 文件名中段截断拆分（CDS 附件卡规格：`head + … + tailStem + tailExt`）——
 * 尾段固定（保住扩展名与末几个词干字符），头段交给 CSS truncate 按可用宽度
 * 收缩。纯函数，node --test 直跑。
 */

/** 尾段长度：扩展名 + 词干保底字符（CDS tailStem≈4~6）。 */
const TAIL_STEM_CHARS = 4;

export function splitFilenameTail(name: string): { head: string; tail: string } {
  if (!name) return { head: '', tail: '' };
  const dot = name.lastIndexOf('.');
  // dotfile（.gitignore）与双扩展（.tar.gz）都按「最后一个非首位的点」取扩展
  const extLen = dot > 0 ? name.length - dot : 0;
  const tailLen = Math.min(name.length - 1, Math.max(TAIL_STEM_CHARS + extLen, extLen || TAIL_STEM_CHARS));
  const tail = name.slice(name.length - tailLen);
  return { head: name.slice(0, name.length - tailLen), tail };
}
