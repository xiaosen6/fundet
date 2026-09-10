/**
 * streamingMarkdown —— 流式 markdown 的两个纯函数（对齐 Cindy
 * repairStreamingMarkdown / splitStreamingMarkdownChunks 的思路）：
 *
 * - repairStreamingMarkdown：补齐流式中未闭合的围栏、丢弃 EOF 处半截的
 *   图片/链接标记，消除「半个语法符号引起的结构翻转」。终版渲染不用本函数。
 * - splitStreamingMarkdownChunks：按顶层块 + 围栏状态机把流式全文切块。
 *   配合 memo 后每 tick 只有尾块重进 parse/高亮链，成本与尾块成正比。
 *
 * 切块规则：围栏行（``` / ~~~）翻转进出围栏态；围栏内的空行不切块；
 * 围栏外的空行是候选边界——但当前块与下一块同为列表块时并成一块，
 * 避免有序列表被切开后重新从 1 编号。
 */

/** 是否围栏开/闭行（``` 或 ~~~，允许前导空白；围栏内以不少于开头的同类字符闭合） */
function fenceOf(line: string): string | null {
  const m = /^\s*(`{3,}|~{3,})/.exec(line);
  return m ? m[1] : null;
}

export function repairStreamingMarkdown(text: string): string {
  let out = text;
  // 1) 未闭合围栏：按行扫围栏态，EOF 仍在围栏内则补一个能闭合它的围栏行
  const lines = out.split('\n');
  let openFence: string | null = null;
  for (const line of lines) {
    const f = fenceOf(line);
    if (!f) continue;
    if (openFence === null) {
      openFence = f;
    } else if (f.startsWith(openFence[0]) && f.length >= openFence.length) {
      openFence = null;
    }
  }
  if (openFence !== null) {
    out = `${out.replace(/\s+$/, '')}\n${openFence[0].repeat(openFence.length)}`;
  }
  // 2) EOF 半截图片/链接：`![alt](src` 或 `[text](url` 悬在末尾时先摘掉，
  //    防止渲染成突兀的裸括号；等后续字符到齐自然恢复。
  out = out.replace(/\!?!\[[^\]\n]*\]\([^)\n]*$/, '').replace(/\[[^\]\n]*\]\([^)\n]*$/, '');
  return out;
}

export function splitStreamingMarkdownChunks(text: string): string[] {
  if (!text) return [];
  const lines = text.split('\n');
  const chunks: string[] = [];
  let buf: string[] = [];
  let inFence: string | null = null;
  /** 当前块是否列表块（首非空行是列表标记） */
  let bufIsList = false;

  const flush = (): void => {
    if (buf.length === 0) return;
    chunks.push(buf.join('\n'));
    buf = [];
    bufIsList = false;
  };

  const LIST_MARKER = /^\s*(?:[-*+]|\d{1,9}[.)])\s/;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const f = fenceOf(line);
    if (inFence !== null) {
      buf.push(line);
      // 同字符且长度足够的围栏行才闭合
      if (f && f.startsWith(inFence[0]) && f.length >= inFence.length) inFence = null;
      continue;
    }
    if (f) {
      // 围栏是独立块：先封掉前块（保持围栏前的空行归属不变）
      flush();
      buf.push(line);
      inFence = f;
      continue;
    }
    if (line.trim() === '') {
      // 空行：候选块边界。列表块与下一非空行同为列表 → 不切（保编号连续）
      let nextNonBlank = -1;
      for (let j = i + 1; j < lines.length; j++) {
        if (lines[j].trim() !== '') {
          nextNonBlank = j;
          break;
        }
      }
      const nextIsList = nextNonBlank >= 0 && LIST_MARKER.test(lines[nextNonBlank]);
      if (bufIsList && nextIsList) {
        buf.push(line);
        continue;
      }
      flush();
      continue;
    }
    if (buf.length === 0) bufIsList = LIST_MARKER.test(line);
    buf.push(line);
  }
  flush();
  return chunks;
}
