/**
 * pi 宿主装配（单例）：providers 表 → PiNativeProviderSpec[] → new PiAgent → new Maker。
 *
 * 只保留 Cindy pi-host.ts 的 BYOM 主链（binaryPath → auth → runtimeConfig → PiAgent →
 * Maker），不搬网关/订阅/turn 录制。MCP 只走本机 preparePiExtraSpawnConfig（内置搜索 + 用户表）。
 */
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { app } from 'electron';
import {
  Maker,
  PiAgent,
  createConsoleLogger,
  type AgentRuntimeConfig,
  type Logger,
  type MakerMemoryManager,
  type PiNativeProviderSpec,
  type PiNativeProvidersResult,
} from '@fundet/agent-core';
import { createSessionStorage } from '../db/session-storage.js';
import { listProviders } from '../db/providers.js';
import { createByokAuthAdapter, isLoopbackBaseUrl, piNativeKeyEnvVar } from './auth-adapter.js';
import { readProviderKey } from './secrets.js';
import { resolvePiBinaryPath, resolveRipgrepPath } from './pi-binary.js';
import { createFundetMemoryManager } from './memory.js';
import { lookupKnownModel } from './pi-model-catalog.ts';
import { SEARCH_MCP_SERVER_NAME } from '../../shared/search-engines.ts';
import { createPreparePiExtraSpawnConfig } from './mcp-bridge.js';
import systemPromptRaw from './system-prompt.md?raw';
import { brand } from '../../shared/brand.js';

// 品牌化自我介绍：system-prompt.md 原文即 Fundet 终稿；下面两个 replace 是上游底座机制（对 Fundet 均为 no-op）
const systemPrompt = (() => {
  let prompt = systemPromptRaw
    .replace('你是 LongMa', `你是 ${brand.name}`)
    .replace('一个运行在本地的 AI 编程助手', brand.assistantRole);
  // Fundet 品牌不预装技能——去掉技能列表段
  if (!brand.bundledSkills) {
    const skillStart = prompt.indexOf('本机预装了这些技能：');
    const skillEnd = prompt.indexOf('需要打开搜索结果');
    if (skillStart >= 0 && skillEnd > skillStart) {
      prompt = prompt.slice(0, skillStart) + prompt.slice(skillEnd);
    }
  }
  return prompt;
})();

export interface FundetHost {
  maker: Maker;
  logger: Logger;
  /** Maker Memory 顶层单例（记忆开关的 runtime 状态源） */
  memoryManager: MakerMemoryManager;
}

let host: FundetHost | null = null;

/**
 * providers 表 → pi 原生 provider 清单 + 需注入子进程的 env（api keys）。
 * 参照 Cindy buildPiNativeProvidersFromConfigs 的 BYOM 分支；差异：
 * - headers 不支持（本阶段配置面没有 headers 字段）；
 * - env 撞名去重省略（id 是 uuid，清洗后不会撞）；
 * - keyless 按 baseUrl loopback 推导（而非配置侧 auth.method）。
 */
function buildPiNativeProviders(logger: Logger): PiNativeProvidersResult {
  const providers: PiNativeProviderSpec[] = [];
  const env: Record<string, string> = {};

  for (const p of listProviders()) {
    const models = p.models
      .filter((m) => m.enabled !== false)
      .map((m) => {
        // 已知模型补全（pi 0.84.4 内置目录）：BYOM 裸定义缺 reasoning/thinkingLevelMap
        // 时，zai 系推理端点（open.bigmodel.cn）收不到 thinking 参数直接 1210。
        // 用户显式配置优先，目录只补缺失字段。
        const known = lookupKnownModel(m.id);
        return {
          id: m.id,
          ...(m.reasoning !== undefined
            ? { reasoning: m.reasoning }
            : known.reasoning !== undefined
              ? { reasoning: known.reasoning }
              : {}),
          ...(m.thinkingLevelMap !== undefined
            ? { thinkingLevelMap: m.thinkingLevelMap }
            : known.thinkingLevelMap !== undefined
              ? { thinkingLevelMap: known.thinkingLevelMap }
              : {}),
          ...(m.contextWindow !== undefined
            ? { contextWindow: m.contextWindow }
            : known.contextWindow !== undefined
              ? { contextWindow: known.contextWindow }
              : {}),
          ...(m.maxTokens !== undefined
            ? { maxTokens: m.maxTokens }
            : known.maxTokens !== undefined
              ? { maxTokens: known.maxTokens }
              : {}),
          // 输入模态：只信库值（预设标注 / 编辑对话框勾选，对齐 Cindy 方案）。
          // 没有该标记发图会被 PiAgent 拒发（PiImageInputUnsupportedError）
          ...(m.input && m.input.includes('image')
            ? { input: m.input }
            : known.input && known.input.includes('image')
              ? { input: known.input }
              : {}),
          // 未知自定义 Chat Completions 端点保守回落（上游 #3832）：pi 的
          // detectCompat 对陌生端点默认 supportsDeveloperRole=true，火山引擎等
          // OpenAI 兼容网关只收 system/assistant/user/tool，role=developer 直接
          // InvalidParameter，模型整体不可用。system role 在所有 OpenAI 兼容端点
          // 均可用，故无已知目录元数据时默认收敛；已知模型维持 pi 原生判定。
          ...(p.api === 'openai-completions' && Object.keys(known).length === 0
            ? { compat: { supportsDeveloperRole: false } }
            : {}),
        };
      });
    if (models.length === 0) {
      logger.warn(`provider "${p.name}" 没有模型，跳过`, { providerId: p.id });
      continue;
    }
    const spec: PiNativeProviderSpec = {
      id: p.id,
      name: p.name,
      baseUrl: p.baseUrl,
      api: p.api,
      models,
    };
    if (!isLoopbackBaseUrl(p.baseUrl)) {
      const key = readProviderKey(p.id);
      if (key) {
        const envVar = piNativeKeyEnvVar(p.id);
        env[envVar] = key;
        spec.apiKeyEnvVar = envVar;
      }
      // 无 key：不设 apiKeyEnvVar（dummy key 兜底）；auth.getState 会先拦住启动
    }
    providers.push(spec);
  }
  return { providers, env };
}

function buildRuntimeConfig(): AgentRuntimeConfig {
  return {
    // 无网关：endpoint 留空，所有会话走显式 BYOM providerId（pi 侧 fail-closed 保证不回落）
    systemPrompt: systemPrompt.trim(),
    managedExecutablePaths: { ripgrep: resolveRipgrepPath() },
    memoryEnabled: false,
    // 产品面已去掉记忆：固定关闭。内核仍装配 manager，避免改 agent-core。
    get makerMemoryEnabled() {
      return false;
    },
  };
}

/** 每会话隔离的 pi 配置目录（PI_CODING_AGENT_DIR 的宿主侧根） */
function resolvePiAgentHome(): string {
  const dir = path.join(app.getPath('userData'), 'agent-home', randomBytes(8).toString('hex'));
  return dir;
}

export function getHost(): FundetHost {
  if (host) return host;

  const logger = createConsoleLogger('fundet');
  const binaryPath = resolvePiBinaryPath();
  logger.info(`pi binary: ${binaryPath}`);

  // 记忆单例先建（agents={} 占位），PiAgent 拿到引用后再 setAgents 挂回 —— 解决
  // "manager 要 agents、agents 要 manager" 的装配时序（同 Cindy maker-memory-host）。
  const memoryManager = createFundetMemoryManager(logger);

  const pi = new PiAgent({
    auth: createByokAuthAdapter(),
    runtimeConfig: buildRuntimeConfig(),
    binaryPath,
    logger: logger.child('pi'),
    resolvePiAgentHome,
    resolvePiNativeProviders: async () => buildPiNativeProviders(logger),
    // 记忆：压缩摘要沉淀 digest 的写入路径（gate 另看 runtimeConfig.makerMemoryEnabled）
    makerMemory: memoryManager,
    // MCP：内置搜索 + 用户表里的外部 server，经 CINDY_PI_MCP_BRIDGE 注入 cindy-bridge
    preparePiExtraSpawnConfig: createPreparePiExtraSpawnConfig(logger.child('mcp')),
    // 默认会话是 ask：内置搜索只打用户自己配的引擎、无本机副作用，免每次弹窗。
    // 其它 MCP 仍要确认（设置里已去掉 MCP 页，这条主要防库里残留的外部 server）。
    getMcpToolApprovalPolicy: ({ serverName }) =>
      serverName === SEARCH_MCP_SERVER_NAME ? 'auto-approve' : 'prompt',
  });
  memoryManager.setAgents({ pi });

  const maker = new Maker({
    agents: { pi },
    storage: createSessionStorage(),
    logger: logger.child('maker'),
    makerMemory: memoryManager,
  });

  host = { maker, logger, memoryManager };
  logger.info('host assembled');
  return host;
}

/** app 退出前调用：关闭所有活跃会话（回收 pi 子进程） */
export async function shutdownHost(): Promise<void> {
  if (!host) return;
  await host.maker.shutdown();
  host = null;
}
