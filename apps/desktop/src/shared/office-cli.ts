/**
 * 办公 CLI 供应商（企业微信 wecom-cli / 钉钉 dws）的共享常量与纯函数。
 * 无 Node / Electron 依赖：main、preload、renderer 与 node --test 都能直接引用。
 *
 * 历史命名：组件板、面板与 IPC 沿用 dws 前缀（DwsPanel / DwsWidgetsSnapshot /
 * dws:* 通道），它们现在是两家共用的面——改名会连带动存量契约，保持不动。
 */
export type OfficeCliProvider = 'wecom' | 'dingtalk';

/** 主进程 settings 表的键；未设置或脏值 = DEFAULT_OFFICE_PROVIDER */
export const OFFICE_PROVIDER_SETTING = 'officecli.provider';
export const DEFAULT_OFFICE_PROVIDER: OfficeCliProvider = 'wecom';

export function normalizeOfficeProvider(value: unknown): OfficeCliProvider {
  return value === 'dingtalk' ? 'dingtalk' : DEFAULT_OFFICE_PROVIDER;
}

export interface OfficeProviderMeta {
  /** 短名（组件板标题、chip 文案） */
  label: string;
  /** 面板标题 */
  workspace: string;
  /** 命令名 */
  cli: string;
  /** 官方仓库 */
  repoUrl: string;
  /** 官方技能的目录前缀（用户技能根下） */
  skillPrefix: string;
}

export const OFFICE_PROVIDER_META: Record<OfficeCliProvider, OfficeProviderMeta> = {
  wecom: {
    label: '企业微信',
    workspace: '企业微信工作台',
    cli: 'wecom-cli',
    repoUrl: 'https://github.com/WecomTeam/wecom-cli',
    skillPrefix: 'wecomcli-',
  },
  dingtalk: {
    label: '钉钉',
    workspace: '钉钉工作台',
    cli: 'dws',
    repoUrl: 'https://github.com/DingTalk-Real-AI/dingtalk-workspace-cli',
    skillPrefix: 'dingtalk-',
  },
};

/** 快照没带 provider（老版本主进程）时按钉钉解读——那是该字段出现前的唯一行为 */
export const LEGACY_OFFICE_PROVIDER: OfficeCliProvider = 'dingtalk';

export type OfficeWidgetKind = 'calendar' | 'todos' | 'approvals' | 'unread';

const ALL_WIDGETS: readonly OfficeWidgetKind[] = ['calendar', 'todos', 'approvals', 'unread'];
/** wecom-cli 没有审批与未读会话接口（会话服务只按时间范围列群聊与消息） */
const WECOM_WIDGETS: readonly OfficeWidgetKind[] = ['calendar', 'todos'];

/** 该供应商的组件板有哪些卡 */
export function officeSupportedWidgets(provider: OfficeCliProvider): readonly OfficeWidgetKind[] {
  return provider === 'wecom' ? WECOM_WIDGETS : ALL_WIDGETS;
}
