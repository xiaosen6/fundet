import { brand } from './brand.ts';
/** 个人 IM 机器人渠道（借鉴 Cindy 设置 → IM 机器人 → 个人）。 */

export const IM_CHANNEL_IDS = ['wechat', 'wecom', 'feishu', 'dingtalk'] as const;
export type ImChannelId = (typeof IM_CHANNEL_IDS)[number];

export function isImChannelId(value: unknown): value is ImChannelId {
  return typeof value === 'string' && (IM_CHANNEL_IDS as readonly string[]).includes(value);
}

export type ImConnKind = 'idle' | 'connecting' | 'connected' | 'error';

export interface ImChannelMeta {
  id: ImChannelId;
  name: string;
  hint: string;
  signupUrl: string;
  fields: Array<{ key: string; label: string; password?: boolean }>;
  qr?: boolean;
}

export const IM_CHANNELS: readonly ImChannelMeta[] = [
  {
    id: 'wechat',
    name: '个人微信',
    hint: `扫码连接个人微信，在微信私聊里把活派给 ${brand.name}。`,
    signupUrl: 'https://ilinkai.weixin.qq.com',
    fields: [],
    qr: true,
  },
  {
    id: 'wecom',
    name: '企业微信智能机器人',
    hint: '开放平台创建智能机器人，填 Bot ID 和 Secret。',
    signupUrl: 'https://developer.work.weixin.qq.com/document/path/99464',
    fields: [
      { key: 'botId', label: 'Bot ID' },
      { key: 'secret', label: 'Secret', password: true },
    ],
  },
  {
    id: 'feishu',
    name: '飞书 / Lark 机器人',
    hint: '开放平台创建企业自建应用，开通机器人能力，填 App ID 和 App Secret。',
    signupUrl: 'https://open.feishu.cn/app',
    fields: [
      { key: 'appId', label: 'App ID' },
      { key: 'appSecret', label: 'App Secret', password: true },
    ],
  },
  {
    id: 'dingtalk',
    name: '钉钉机器人',
    hint: '开放平台创建应用，用 Stream 模式，填 AppKey 和 AppSecret。',
    signupUrl: 'https://open-dev.dingtalk.com/',
    fields: [
      { key: 'appKey', label: 'AppKey' },
      { key: 'appSecret', label: 'AppSecret', password: true },
    ],
  },
];

export interface ImChannelStatus {
  id: ImChannelId;
  name: string;
  hint: string;
  signupUrl: string;
  fields: ImChannelMeta['fields'];
  qr?: boolean;
  configured: boolean;
  kind: ImConnKind;
  detail?: string;
  qrUrl?: string;
}

export interface ImBotsStatus {
  channels: ImChannelStatus[];
  workDir: string;
  providerId: string;
  model: string;
}

export interface ImSaveInput {
  id: ImChannelId;
  fields: Record<string, string>;
}
