/**
 * MarkdownCodeBlock —— 助手消息代码块容器：36px 头部栏（语言标签 + 复制按钮）+ pre 本体。
 * 复制成功 Copy→Check「已复制」，2.5s 后衰减恢复（CDS 代码块规格）。
 */
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Check, Copy } from 'lucide-react';

export function MarkdownCodeBlock({
  language,
  text,
  children,
}: {
  language: string;
  text: string;
  children: ReactNode;
}): React.JSX.Element {
  const [copied, setCopied] = useState(false);
  const timerRef = useRef(0);
  useEffect(() => () => window.clearTimeout(timerRef.current), []);

  const copy = (): void => {
    void window.fundet
      .copyText(text)
      .then(() => {
        setCopied(true);
        window.clearTimeout(timerRef.current);
        timerRef.current = window.setTimeout(() => setCopied(false), 2500);
      })
      .catch(() => {});
  };

  return (
    <div className="md-codeblock">
      <div className="flex h-9 items-center justify-between border-b border-board pr-2 pl-3.5">
        <span className="font-mono text-12 text-muted">{language || 'text'}</span>
        <button
          type="button"
          aria-label="复制代码"
          className="flex h-6 items-center gap-1 rounded-md px-1.5 text-12 text-muted hover:bg-hover hover:text-primary"
          onClick={copy}
        >
          {copied ? <Check size={13} /> : <Copy size={13} />}
          {copied ? '已复制' : '复制'}
        </button>
      </div>
      <pre>{children}</pre>
    </div>
  );
}
