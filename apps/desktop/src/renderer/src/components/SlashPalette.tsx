import { cn } from '../lib/cn';

export interface SlashItem {
  id: string;
  label: string;
  hint: string;
  insert: string;
  kind: 'skill';
}

interface SlashPaletteProps {
  items: SlashItem[];
  activeIndex: number;
  onHover: (index: number) => void;
  onPick: (item: SlashItem) => void;
}

export function SlashPalette({
  items,
  activeIndex,
  onHover,
  onPick,
}: SlashPaletteProps): React.JSX.Element | null {
  if (items.length === 0) return null;
  return (
    <div className="absolute inset-x-0 bottom-full z-20 mb-1 max-h-[220px] overflow-y-auto rounded-container border border-board bg-card py-1">
      {items.map((item, i) => (
        <button
          key={item.id}
          type="button"
          onMouseEnter={() => onHover(i)}
          onMouseDown={(e) => {
            e.preventDefault();
            onPick(item);
          }}
          className={cn(
            'flex w-full items-start gap-2 px-3 py-1.5 text-left',
            i === activeIndex ? 'bg-hover' : 'hover:bg-hover-soft',
          )}
        >
          <span className="mt-px w-10 shrink-0 font-mono text-11 text-muted">
            /skill
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-13 font-medium text-primary">{item.label}</span>
            {item.hint && (
              <span className="block truncate text-11 text-muted">{item.hint}</span>
            )}
          </span>
        </button>
      ))}
    </div>
  );
}
