/**
 * streamWordFade —— 流式正文逐词淡入的简化实现（参考 Cindy rehypeStreamWordFade
 * 的思路，DESIGN.md §14.4 第五类 sanctioned motion）。
 *
 * 形态：流式输出时每个新词以 150ms opacity 淡入「浮现」，不是逐字打字机 ——
 * 词整体已渲染就位，只有透明度渐变。CSS 管形态（globals.css .stream-word），
 * 本插件只管时序（写 --wf-delay）。
 *
 * 简化策略（相对 Cindy 全量版）：
 * - 词按「文档内全局序号 + 内容匹配」复用开播时刻：同位置内容相等或互为前缀
 *   （chunk 边界半个词长成整词）→ 复用；否则视为新词分配开播时刻。
 * - 开播时刻是绝对时间戳，每 tick 重发「开播时刻 - now」作为 delay（可为负，
 *   CSS 负 animation-delay 从中途续播）——react-markdown 每 tick 重建 DOM 导致
 *   span remount 时动画不重等，观感无缝。
 * - 已播完的词直接还原为纯文本（不包 span），流式长文档的 DOM 规模不随前文涨。
 * - 流式结束（streaming=false）后组件不再挂本插件，终版渲染零 span 包装。
 * - 跳过 pre / code 子树（代码块保持整体形态）。
 */

/** rehype 插件只依赖 hast 的最小结构，这里声明够用即可 */
interface HastNode {
  type: string;
  value?: string;
  tagName?: string;
  properties?: Record<string, unknown>;
  children?: HastNode[];
}

export interface StreamFadeState {
  /** 上一次渲染的词列表（按文档顺序） */
  prevWords: string[];
  /** 上一次渲染每个词对应的 key */
  prevKeys: string[];
  /** key → 绝对开播时刻（ms） */
  startAt: Map<string, number>;
  /** 队列尾部绝对时间戳（新词排在它后面） */
  nextStartAtMs: number;
  counter: number;
}

/** 每个词的名目步长上限（ms） */
const TICK_STEP_MS = 24;
/** 排队预算：待播 lead 超过它就压缩步长，保证渲染跟得上到达速率 */
const LEAD_BUDGET_MS = 320;
/** 动画时长（= globals.css --motion-fast），播完即还原纯文本 */
const ANIM_MS = 150;

export function createStreamFadeState(): StreamFadeState {
  return { prevWords: [], prevKeys: [], startAt: new Map(), nextStartAtMs: 0, counter: 0 };
}

/** Intl.Segmenter 不可用时回退：按空白与 CJK 边界粗切 */
function segmentWords(text: string): Array<{ segment: string; isWord: boolean }> {
  if (typeof Intl !== 'undefined' && 'Segmenter' in Intl) {
    const seg = new Intl.Segmenter(undefined, { granularity: 'word' });
    return [...seg.segment(text)].map((s) => ({ segment: s.segment, isWord: s.isWordLike === true }));
  }
  // 回退：连续非空白为一个词
  const out: Array<{ segment: string; isWord: boolean }> = [];
  for (const m of text.matchAll(/\S+|\s+/g)) {
    out.push({ segment: m[0], isWord: !/^\s+$/.test(m[0]) });
  }
  return out;
}

/**
 * rehype 插件工厂：state 由调用方持有（跨渲染存活），每次渲染重新构造插件，
 * 内部按 state 记账。仅流式期间挂载。
 */
export function rehypeStreamWordFade(state: StreamFadeState) {
  return () => (tree: HastNode): void => {
    const now = Date.now();
    // 本次渲染按文档顺序收集到的词（先收集再统一记账，保证序号稳定）；
    // wordStart 记录该文本节点的第一个词在 words 里的全局序号（改写时定位用）
    const words: string[] = [];
    const targets: Array<{
      parent: HastNode;
      index: number;
      segments: Array<{ segment: string; isWord: boolean }>;
      wordStart: number;
    }> = [];

    const walk = (node: HastNode, inCode: boolean): void => {
      if (!node.children) return;
      const codeHere = inCode || node.tagName === 'pre' || node.tagName === 'code';
      node.children.forEach((child, index) => {
        if (child.type === 'text' && child.value && !codeHere) {
          const segments = segmentWords(child.value);
          if (segments.some((s) => s.isWord)) {
            const wordStart = words.length;
            for (const s of segments) if (s.isWord) words.push(s.segment);
            targets.push({ parent: node, index, segments, wordStart });
          }
          return;
        }
        walk(child, codeHere);
      });
    };
    walk(tree, false);

    // 记账：同位置内容相等/前缀延续 → 复用 key；否则发新 key 并排入播放队列
    const keys: string[] = words.map((w, i) => {
      const prev = state.prevWords[i];
      if (prev !== undefined && (prev === w || w.startsWith(prev) || prev.startsWith(w))) {
        return state.prevKeys[i];
      }
      const key = `wf${state.counter++}`;
      const startAt = Math.max(state.nextStartAtMs, now);
      state.startAt.set(key, startAt);
      // 背压：队列领先现实超过预算时把尾部压回预算线（步长等效压缩）
      state.nextStartAtMs = Math.min(startAt + TICK_STEP_MS, now + LEAD_BUDGET_MS);
      return key;
    });

    // 重写文本节点：未播完的词包 span.stream-word，其余还原纯文本。
    // splice 会改变同父节点后续文本节点的下标 —— 按 (parent, index) 倒序改写，
    // 每个节点用自己记账时的 wordStart 定位词序号，不受先改写者的位移影响。
    const ordered = [...targets].sort((a, b) =>
      a.parent === b.parent ? b.index - a.index : 0,
    );
    for (const { parent, index, segments, wordStart } of ordered) {
      const out: HastNode[] = [];
      let wordIndex = wordStart;
      for (const s of segments) {
        if (!s.isWord) {
          out.push({ type: 'text', value: s.segment });
          continue;
        }
        const key = keys[wordIndex++];
        const startAt = state.startAt.get(key) ?? now;
        if (startAt + ANIM_MS <= now) {
          // 已播完：纯文本（remount 也免疫，无 span 可重播）
          out.push({ type: 'text', value: s.segment });
        } else {
          out.push({
            type: 'element',
            tagName: 'span',
            properties: {
              className: ['stream-word'],
              style: `--wf-delay:${Math.round(startAt - now)}ms`,
            },
            children: [{ type: 'text', value: s.segment }],
          });
        }
      }
      parent.children!.splice(index, 1, ...out);
    }

    state.prevWords = words;
    state.prevKeys = keys;
  };
}
