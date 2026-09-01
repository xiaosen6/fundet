import { useState } from 'react';
import { Check, ChevronDown, RotateCcw } from 'lucide-react';
import { cn } from '../../lib/cn';

export function FontFamilyPicker({
  label,
  description,
  value,
  presets,
  preview,
  onChange,
  onReset,
}: {
  label: string;
  description: string;
  value: string;
  presets: Array<{ id: string; label: string; family: string }>;
  preview: string;
  onChange: (family: string) => void;
  onReset: () => void;
}): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const [custom, setCustom] = useState(value);
  const selected = presets.find((p) => p.family === value.trim());
  const shown = selected?.label ?? (value.trim() || presets[0]?.label || '默认');
  const previewFamily = value.trim() || 'inherit';

  return (
    <div className="rounded-xl border border-board bg-card-ivory p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-13 font-medium text-secondary">{label}</p>
          <p className="mt-1 text-12 leading-[1.4] text-muted">{description}</p>
        </div>
        <button
          type="button"
          title="重置"
          disabled={!value.trim()}
          onClick={onReset}
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl border border-board text-primary disabled:opacity-40"
        >
          <RotateCcw size={14} />
        </button>
      </div>
      <div className="relative mt-3">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="flex h-10 w-full items-center justify-between rounded-xl border border-board bg-card px-3 text-left"
        >
          <span className="truncate text-13 font-medium text-primary">{shown}</span>
          <ChevronDown size={14} className="shrink-0 text-muted" />
        </button>
        {open && (
          <div className="absolute z-20 mt-1 w-full rounded-xl border border-board bg-card p-2 shadow-[var(--shadow-menu)]">
            <div
              className="mb-2 rounded-xl border border-board bg-card-ivory px-3 py-2 text-13 text-primary"
              style={{ fontFamily: previewFamily }}
            >
              {preview}
            </div>
            <div className="flex flex-col gap-0.5">
              {presets.map((p) => {
                const on = p.family === value.trim();
                return (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => {
                      onChange(p.family);
                      setOpen(false);
                    }}
                    className={cn(
                      'flex h-[34px] items-center justify-between rounded-inner px-3 text-13 hover:bg-menu-item-hover',
                      on && 'bg-menu-item-hover font-medium',
                    )}
                    style={{ fontFamily: p.family || 'inherit' }}
                  >
                    <span>{p.label}</span>
                    {on && <Check size={14} />}
                  </button>
                );
              })}
            </div>
            <div className="mt-2 flex gap-2 border-t border-board pt-2">
              <input
                value={custom}
                onChange={(e) => setCustom(e.target.value)}
                placeholder='自定义，如 "PingFang SC"'
                className="h-9 min-w-0 flex-1 rounded-xl border border-board bg-card px-3 font-mono text-12 outline-none"
              />
              <button
                type="button"
                disabled={!custom.trim()}
                onClick={() => {
                  onChange(custom.trim());
                  setOpen(false);
                }}
                className="h-9 rounded-full bg-accent px-3 text-12 text-accent-fg disabled:opacity-40"
              >
                应用
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
