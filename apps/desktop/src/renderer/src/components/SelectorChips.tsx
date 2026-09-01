/**
 * Composer 工具栏 chip：ModelSelector / PermissionSelector。
 *
 * 复刻 Cindy 的签名交互（DESIGN.md §14.4 容器形变类目）：
 * - chip 静息裸态（border-transparent bg-transparent），hover 才浮现 1px Board 描边
 *   + composer-pill 底；h-[30px] px-2.5 rounded-full。
 * - 弹层不是凭空出现，而是从 chip 原位生长（MorphPopover，220ms），收合缩回 chip。
 * - 选项行契约（三个 composer 菜单统一）：px-3 py-2 rounded-[8px]，hover/选中同一
 *   --model-item-hover 底，选中额外只有 check + font-medium。
 * - 权限危险档只染文字：auto → #417CDD / bypass → #EA6B17（--perm-auto/--perm-bypass）。
 */
import { useState } from 'react';
import {
  Check,
  ChevronDown,
  Cpu,
  Hand,
  Sparkles,
  TriangleAlert,
} from 'lucide-react';
import type { PermissionMode } from '@fundet/agent-core';
import type { ProviderView } from '../../../shared/fundet-api.js';
import { formatTokenCount, preferScannedContextWindow } from '../../../shared/context-window.js';
import { cn } from '../lib/cn';
import { MorphPopover } from './ui/MorphPopover';
import { ProviderLogoMark } from './icons/ProviderLogoMark';

// ---------------------------------------------------------------------------
// 通用 chip 壳（裸态 trigger + MorphPopover 生长面板）
// ---------------------------------------------------------------------------

interface ChipShellProps {
  icon: React.ReactNode;
  label: string;
  /** 危险档文字色（权限选择器用）：只染文字，不改底色 */
  toneClass?: string;
  panelWidth: number;
  panelAriaLabel: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  children: React.ReactNode;
}

function ChipShell({
  icon,
  label,
  toneClass,
  panelWidth,
  panelAriaLabel,
  open,
  onOpenChange,
  children,
}: ChipShellProps): React.JSX.Element {
  const trigger = (
    <button
      type="button"
      onClick={() => onOpenChange(!open)}
      aria-expanded={open}
      aria-haspopup="listbox"
      className={cn(
        'flex h-[30px] max-w-full min-w-[72px] shrink items-center gap-1 overflow-hidden px-2.5',
        'rounded-full border border-transparent bg-transparent',
        'text-primary transition-colors select-none',
        'hover:border-board hover:bg-composer-pill',
        toneClass,
      )}
    >
      {icon}
      <span className="min-w-0 truncate text-13 font-normal text-current">{label}</span>
      <ChevronDown size={14} className="shrink-0 pt-[2px] text-current" />
    </button>
  );

  return (
    <MorphPopover
      open={open}
      onOpenChange={onOpenChange}
      panelWidth={panelWidth}
      panelClassName="p-2"
      panelAriaLabel={panelAriaLabel}
      wrapperClassName="min-w-0 shrink"
      trigger={trigger}
    >
      {children}
    </MorphPopover>
  );
}

/** 选项行（composer 菜单统一契约：px-3 / rounded-[8px] / hover 与选中同底；
    行内只有 icon + label + 选中 check，对齐 cindy-03/04 的面板解剖） */
function OptionRow({
  selected,
  icon,
  label,
  toneClass,
  onSelect,
}: {
  selected: boolean;
  icon?: React.ReactNode;
  label: string;
  toneClass?: string;
  onSelect: () => void;
}): React.JSX.Element {
  return (
    <button
      type="button"
      role="option"
      aria-selected={selected}
      data-morph-autofocus={selected ? '' : undefined}
      onClick={onSelect}
      className={cn(
        'flex w-full items-center gap-3 rounded-inner px-3 py-2',
        'text-left transition-colors select-none',
        'hover:bg-menu-item-hover',
        selected && 'bg-menu-item-hover',
        toneClass,
      )}
    >
      {icon}
      <span
        className={cn(
          'min-w-0 flex-1 truncate text-14',
          selected ? 'font-medium' : 'font-normal',
          toneClass ? 'text-current' : 'text-primary',
        )}
      >
        {label}
      </span>
      {selected && <Check size={13} className={cn('shrink-0', toneClass ? 'text-current' : 'text-primary')} />}
    </button>
  );
}

// ---------------------------------------------------------------------------
// ModelSelector：模型列表来自 providers 配置，按 provider 分组
// ---------------------------------------------------------------------------

interface ModelSelectorProps {
  providers: ProviderView[];
  currentModel: string;
  disabled?: boolean;
  onSelect: (providerId: string, modelId: string) => void;
}

export function ModelSelector({
  providers,
  currentModel,
  disabled,
  onSelect,
}: ModelSelectorProps): React.JSX.Element {
  const [open, setOpen] = useState(false);

  const currentProvider = providers.find((p) => p.models.some((m) => m.id === currentModel));

  if (disabled || providers.length === 0) {
    return (
      <span className="flex h-[30px] items-center gap-1 rounded-full px-2.5 text-13 text-muted select-none">
        <Cpu size={14} />
        {currentModel || '无模型'}
      </span>
    );
  }
  return (
    <ChipShell
      icon={
        <ProviderLogoMark
          providerId={currentProvider?.id}
          name={currentProvider?.name}
          baseUrl={currentProvider?.baseUrl}
          modelId={currentModel}
          size={14}
          className="shrink-0 text-current"
        />
      }
      label={currentModel || '选模型'}
      panelWidth={320}
      panelAriaLabel="选择模型"
      open={open}
      onOpenChange={setOpen}
    >
      <div role="listbox" aria-label="选择模型" className="flex flex-col gap-0.5">
        {providers.map((p) => {
          const visible = p.models.filter((m) => m.enabled !== false);
          if (visible.length === 0) return null;
          return (
          <div key={p.id}>
            <div className="flex items-center gap-1.5 px-3 pt-2 pb-1 text-12 text-secondary select-none">
              <ProviderLogoMark
                providerId={p.id}
                name={p.name}
                baseUrl={p.baseUrl}
                modelId={p.models[0]?.id}
                size={12}
                className="shrink-0 text-current"
              />
              {p.name}
            </div>
            {visible.map((m) => (
              <OptionRow
                key={m.id}
                selected={m.id === currentModel}
                icon={
                  <ProviderLogoMark
                    providerId={p.id}
                    name={p.name}
                    baseUrl={p.baseUrl}
                    modelId={m.id}
                    size={13}
                    className="shrink-0 text-primary"
                  />
                }
                label={(() => {
                  const win = preferScannedContextWindow(m.id, m.contextWindow);
                  return win ? `${m.id} · ${formatTokenCount(win)}` : m.id;
                })()}
                onSelect={() => {
                  onSelect(p.id, m.id);
                  setOpen(false);
                }}
              />
            ))}
          </div>
          );
        })}
      </div>
    </ChipShell>
  );
}

// ---------------------------------------------------------------------------
// PermissionSelector：pi 支持的三档（ask / auto / bypassPermissions）
// ---------------------------------------------------------------------------

const PERMISSION_OPTIONS: Array<{
  mode: PermissionMode;
  label: string;
  icon: typeof Hand;
}> = [
  { mode: 'ask', label: '每次询问', icon: Hand },
  { mode: 'auto', label: '自动审批', icon: Sparkles },
  { mode: 'bypassPermissions', label: '完全放行', icon: TriangleAlert },
];

/** 危险档文字色（Cindy：Auto Approval 蓝 / Full Access 橙，只染文字不染底） */
function toneOf(mode: PermissionMode): string | undefined {
  if (mode === 'auto') return 'text-perm-auto';
  if (mode === 'bypassPermissions') return 'text-perm-bypass';
  return undefined;
}

interface PermissionSelectorProps {
  current: PermissionMode;
  onSelect: (mode: PermissionMode) => void;
}

export function PermissionSelector({
  current,
  onSelect,
}: PermissionSelectorProps): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const active = PERMISSION_OPTIONS.find((o) => o.mode === current) ?? PERMISSION_OPTIONS[0];
  const TriggerIcon = active.icon;
  return (
    <ChipShell
      icon={<TriggerIcon size={14} className="shrink-0 text-current" />}
      label={active.label}
      toneClass={toneOf(active.mode)}
      panelWidth={300}
      panelAriaLabel="选择权限模式"
      open={open}
      onOpenChange={setOpen}
    >
      <div role="listbox" aria-label="选择权限模式" className="flex flex-col gap-0.5">
        {PERMISSION_OPTIONS.map((o) => (
          <OptionRow
            key={o.mode}
            selected={o.mode === active.mode}
            icon={<o.icon size={17} className={cn('shrink-0', toneOf(o.mode) ? 'text-current' : 'text-primary')} />}
            label={o.label}
            toneClass={o.mode === active.mode ? toneOf(o.mode) : undefined}
            onSelect={() => {
              onSelect(o.mode);
              setOpen(false);
            }}
          />
        ))}
      </div>
    </ChipShell>
  );
}
