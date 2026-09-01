import type { ProviderApi } from '../../../shared/fundet-api.js';

export interface ProviderPreset {
  id: string;
  name: string;
  docsUrl?: string;
  regionHint?: "cn" | "global";
  api: ProviderApi;
  baseUrl: string;
  models: Array<{ id: string; contextWindow?: number; maxTokens?: number; input?: Array<'text' | 'image'> }>;
}

/** Cindy catalog/providers.json 的预设，收成 LongMa 单 runtime（Pi BYOK）。 */
export const PROVIDER_PRESETS: ProviderPreset[] = [
  {
    "id": "openai-api",
    "name": "OpenAI",
    "docsUrl": "https://platform.openai.com/api-keys",
    "api": "openai-completions",
    "baseUrl": "https://api.openai.com/v1",
    "models": [
      {
        "id": "gpt-5.4",
        "input": ["text", "image"]
      },
      {
        "id": "gpt-5.4-mini",
        "input": ["text", "image"]
      }
    ]
  },
  {
    "id": "anthropic-api",
    "name": "Anthropic",
    "docsUrl": "https://console.anthropic.com/settings/keys",
    "api": "anthropic-messages",
    "baseUrl": "https://api.anthropic.com",
    "models": [
      {
        "id": "claude-opus-4",
        "input": ["text", "image"],
        "contextWindow": 1000000
      },
      {
        "id": "claude-sonnet-4",
        "input": ["text", "image"],
        "contextWindow": 1000000
      },
      {
        "id": "claude-haiku-4-5",
        "input": ["text", "image"],
        "contextWindow": 200000
      }
    ]
  },
  {
    "id": "xai-api",
    "name": "xAI",
    "docsUrl": "https://console.x.ai",
    "api": "openai-completions",
    "baseUrl": "https://api.x.ai/v1",
    "models": [
      {
        "id": "grok-4.5",
        "input": ["text", "image"]
      },
      {
        "id": "grok-4.3"
      }
    ]
  },
  {
    "id": "openrouter",
    "name": "OpenRouter",
    "docsUrl": "https://openrouter.ai/docs/cookbook/coding-agents/claude-code-integration",
    "regionHint": "global",
    "api": "openai-completions",
    "baseUrl": "https://openrouter.ai/api/v1",
    "models": [
      {
        "id": "z-ai/glm-5.2"
      },
      {
        "id": "moonshotai/kimi-k2.6"
      }
    ]
  },
  {
    "id": "deepseek",
    "name": "DeepSeek",
    "docsUrl": "https://api-docs.deepseek.com/guides/anthropic_api",
    "api": "openai-completions",
    "baseUrl": "https://api.deepseek.com",
    "models": [
      {
        "id": "deepseek-v4-flash",
        "contextWindow": 1000000
      },
      {
        "id": "deepseek-v4-pro",
        "contextWindow": 1000000
      }
    ]
  },
  {
    "id": "zhipu-glm-cn",
    "name": "智谱 GLM（中国大陆）",
    "docsUrl": "https://docs.bigmodel.cn/cn/guide/develop/claude",
    "regionHint": "cn",
    "api": "openai-completions",
    "baseUrl": "https://open.bigmodel.cn/api/paas/v4",
    "models": [
      {
        "id": "glm-4v-flash",
        "input": ["text", "image"],
        "maxTokens": 1024
      },
      {
        "id": "glm-5.3",
        "contextWindow": 1000000
      },
      {
        "id": "glm-5.2",
        "contextWindow": 1000000
      },
      {
        "id": "glm-5.1"
      }
    ]
  },
  {
    "id": "zhipu-glm-global",
    "name": "Z.ai GLM (Global)",
    "docsUrl": "https://docs.z.ai/devpack/tool/claude",
    "regionHint": "global",
    "api": "openai-completions",
    "baseUrl": "https://api.z.ai/api/paas/v4",
    "models": [
      {
        "id": "glm-5.3",
        "contextWindow": 1000000
      },
      {
        "id": "glm-5.2",
        "contextWindow": 1000000
      },
      {
        "id": "glm-5.1"
      }
    ]
  },
  {
    "id": "moonshot-kimi-cn",
    "name": "Kimi (Moonshot 中国大陆)",
    "docsUrl": "https://platform.moonshot.cn/docs/guide/agent-support",
    "regionHint": "cn",
    "api": "openai-completions",
    "baseUrl": "https://api.moonshot.cn/v1",
    "models": [
      {
        "id": "kimi-k3"
      },
      {
        "id": "kimi-k2.7-code"
      },
      {
        "id": "kimi-k2.6"
      }
    ]
  },
  {
    "id": "moonshot-kimi-global",
    "name": "Kimi (Moonshot Global)",
    "docsUrl": "https://platform.moonshot.ai/docs/guide/agent-support",
    "regionHint": "global",
    "api": "openai-completions",
    "baseUrl": "https://api.moonshot.ai/v1",
    "models": [
      {
        "id": "kimi-k3"
      },
      {
        "id": "kimi-k2.7-code"
      },
      {
        "id": "kimi-k2.6"
      }
    ]
  },
  {
    "id": "moonshot-kimi-code",
    "name": "Kimi Code（编程计划包月）",
    "docsUrl": "https://www.kimi.com/zh-cn/help/kimi-code/third-party-agents",
    "api": "openai-completions",
    "baseUrl": "https://api.kimi.com/coding/v1",
    "models": [
      {
        "id": "kimi-for-coding",
        "contextWindow": 262144
      },
      {
        "id": "kimi-for-coding-highspeed",
        "contextWindow": 262144
      },
      {
        "id": "k3",
        "contextWindow": 262144
      }
    ]
  },
  {
    "id": "minimax-cn",
    "name": "MiniMax（中国大陆）",
    "docsUrl": "https://platform.minimaxi.com/docs/api-reference/responses-create",
    "regionHint": "cn",
    "api": "openai-completions",
    "baseUrl": "https://api.minimaxi.com/v1",
    "models": [
      {
        "id": "MiniMax-M3",
        "contextWindow": 1000000
      },
      {
        "id": "MiniMax-M2.5"
      }
    ]
  },
  {
    "id": "minimax-global",
    "name": "MiniMax (Global)",
    "docsUrl": "https://platform.minimax.io/docs/api-reference/responses-create",
    "regionHint": "global",
    "api": "openai-completions",
    "baseUrl": "https://api.minimax.io/v1",
    "models": [
      {
        "id": "MiniMax-M3",
        "contextWindow": 1000000
      },
      {
        "id": "MiniMax-M2.5"
      }
    ]
  },
  {
    "id": "aliyun-bailian-coding",
    "name": "阿里云百炼 Coding Plan（包月）",
    "docsUrl": "https://help.aliyun.com/zh/model-studio/coding-plan",
    "regionHint": "cn",
    "api": "openai-completions",
    "baseUrl": "https://coding.dashscope.aliyuncs.com/v1",
    "models": [
      {
        "id": "qwen3.7-plus"
      },
      {
        "id": "qwen3-coder-next"
      },
      {
        "id": "qwen3-coder-plus"
      }
    ]
  },
  {
    "id": "aliyun-bailian-token-plan-cn",
    "name": "阿里云百炼 Token Plan（个人版）",
    "docsUrl": "https://help.aliyun.com/zh/model-studio/token-plan-personal-overview",
    "regionHint": "cn",
    "api": "openai-completions",
    "baseUrl": "https://token-plan.cn-beijing.maas.aliyuncs.com/compatible-mode/v1",
    "models": [
      {
        "id": "qwen3.8-max-preview",
        "contextWindow": 983616
      },
      {
        "id": "qwen3.7-max",
        "contextWindow": 992000
      },
      {
        "id": "qwen3.7-plus",
        "contextWindow": 1000000
      },
      {
        "id": "qwen3.6-flash",
        "contextWindow": 1000000
      },
      {
        "id": "glm-5.2",
        "contextWindow": 1000000
      },
      {
        "id": "deepseek-v4-pro",
        "contextWindow": 1048576
      }
    ]
  },
  {
    "id": "aliyun-bailian-token-plan-team-cn",
    "name": "阿里云百炼 Token Plan（团队版）",
    "docsUrl": "https://help.aliyun.com/zh/model-studio/token-plan-team-overview",
    "regionHint": "cn",
    "api": "openai-completions",
    "baseUrl": "https://token-plan.cn-beijing.maas.aliyuncs.com/compatible-mode/v1",
    "models": [
      {
        "id": "qwen3.8-max-preview",
        "contextWindow": 983616
      },
      {
        "id": "qwen3.7-max",
        "contextWindow": 992000
      },
      {
        "id": "qwen3.7-plus",
        "contextWindow": 1000000
      },
      {
        "id": "qwen3.6-plus",
        "contextWindow": 1000000
      },
      {
        "id": "qwen3.6-flash",
        "contextWindow": 1000000
      },
      {
        "id": "deepseek-v4-pro",
        "contextWindow": 1048576
      },
      {
        "id": "deepseek-v4-flash",
        "contextWindow": 1048576
      },
      {
        "id": "deepseek-v3.2",
        "contextWindow": 131072
      },
      {
        "id": "kimi-k2.7-code",
        "contextWindow": 262144
      },
      {
        "id": "kimi-k2.6",
        "contextWindow": 262144
      },
      {
        "id": "kimi-k2.5",
        "contextWindow": 262144
      },
      {
        "id": "glm-5.2",
        "contextWindow": 1000000
      },
      {
        "id": "glm-5.1",
        "contextWindow": 202752
      },
      {
        "id": "glm-5",
        "contextWindow": 202752
      },
      {
        "id": "MiniMax-M2.5",
        "contextWindow": 196608
      }
    ]
  },
  {
    "id": "google-gemini-api",
    "name": "Google Gemini API",
    "docsUrl": "https://ai.google.dev/gemini-api/docs/openai",
    "regionHint": "global",
    "api": "openai-completions",
    "baseUrl": "https://generativelanguage.googleapis.com/v1beta/openai",
    "models": [
      {
        "id": "gemini-3.6-flash",
        "input": ["text", "image"],
        "contextWindow": 1000000
      },
      {
        "id": "gemini-3.5-flash",
        "input": ["text", "image"],
        "contextWindow": 1000000
      },
      {
        "id": "gemini-3.5-flash-lite",
        "input": ["text", "image"],
        "contextWindow": 1000000
      }
    ]
  },
  {
    "id": "litellm",
    "name": "LiteLLM Proxy",
    "docsUrl": "https://docs.litellm.ai/docs/proxy/quick_start",
    "api": "openai-completions",
    "baseUrl": "http://127.0.0.1:4000/v1",
    "models": []
  },
  {
    "id": "longcat",
    "name": "LongCat",
    "docsUrl": "https://longcat.chat/platform/docs/zh/",
    "api": "openai-completions",
    "baseUrl": "https://api.longcat.chat/openai/v1",
    "models": [
      {
        "id": "LongCat-2.0",
        "contextWindow": 1000000
      }
    ]
  },
  {
    "id": "zhipu-coding-plan-cn",
    "name": "智谱 GLM Coding Plan（中国大陆）",
    "docsUrl": "https://docs.bigmodel.cn/cn/coding-plan/quick-start",
    "regionHint": "cn",
    "api": "openai-completions",
    "baseUrl": "https://open.bigmodel.cn/api/coding/paas/v4",
    "models": [
      {
        "id": "glm-5.3",
        "contextWindow": 1000000
      },
      {
        "id": "glm-5.2",
        "contextWindow": 1000000
      },
      {
        "id": "glm-5.1"
      }
    ]
  },
  {
    "id": "zai-coding-plan-global",
    "name": "Z.ai GLM Coding Plan (Global)",
    "docsUrl": "https://docs.z.ai/devpack/overview",
    "regionHint": "global",
    "api": "openai-completions",
    "baseUrl": "https://api.z.ai/api/coding/paas/v4",
    "models": [
      {
        "id": "glm-5.3",
        "contextWindow": 1000000
      },
      {
        "id": "glm-5.2",
        "contextWindow": 1000000
      },
      {
        "id": "glm-5.1"
      }
    ]
  },
  {
    "id": "xiaomi-mimo-api-cn",
    "name": "小米 MiMo API（按量）",
    "docsUrl": "https://mimo.mi.com/docs/zh-CN/quick-start/summary/first-api-call",
    "regionHint": "cn",
    "api": "openai-completions",
    "baseUrl": "https://api.xiaomimimo.com/v1",
    "models": [
      {
        "id": "mimo-v2.5-pro",
        "contextWindow": 1000000
      },
      {
        "id": "mimo-v2.5",
        "contextWindow": 1000000
      }
    ]
  },
  {
    "id": "xiaomi-mimo-token-plan-cn",
    "name": "小米 MiMo Token Plan（包月）",
    "docsUrl": "https://mimo.mi.com/docs/zh-CN/quick-start/summary/first-api-call",
    "regionHint": "cn",
    "api": "openai-completions",
    "baseUrl": "https://token-plan-cn.xiaomimimo.com/v1",
    "models": [
      {
        "id": "mimo-v2.5-pro",
        "contextWindow": 1000000
      },
      {
        "id": "mimo-v2.5",
        "contextWindow": 1000000
      }
    ]
  },
  {
    "id": "volcengine-ark",
    "name": "火山方舟（按量，含视觉模型）",
    "docsUrl": "https://www.volcengine.com/docs/82379/1330310",
    "regionHint": "cn",
    "api": "openai-completions",
    "baseUrl": "https://ark.cn-beijing.volces.com/api/v3",
    "models": [
      {
        "id": "doubao-seed-1-6-vision-250815",
        "contextWindow": 131072
      },
      {
        "id": "doubao-1.5-vision-pro-32k",
        "contextWindow": 32768,
        "maxTokens": 12288
      },
      {
        "id": "doubao-seed-1-6-250615",
        "contextWindow": 256000
      },
      {
        "id": "doubao-1-5-pro-32k",
        "contextWindow": 32768
      }
    ]
  },
  {
    "id": "volcengine-agent-plan",
    "name": "火山方舟 Agent Plan",
    "docsUrl": "https://docs.volcengine.com/docs/82379/2373738",
    "regionHint": "cn",
    "api": "openai-completions",
    "baseUrl": "https://ark.cn-beijing.volces.com/api/plan/v3",
    "models": [
      {
        "id": "ark-code-latest"
      }
    ]
  },
  {
    "id": "volcengine-coding-plan",
    "name": "火山方舟 Coding Plan",
    "docsUrl": "https://www.volcengine.com/docs/82379/1925114",
    "regionHint": "cn",
    "api": "openai-completions",
    "baseUrl": "https://ark.cn-beijing.volces.com/api/coding/v3",
    "models": [
      {
        "id": "ark-code-latest"
      }
    ]
  },
  {
    "id": "tencentcloud-coding-plan",
    "name": "腾讯云 Coding Plan",
    "docsUrl": "https://cloud.tencent.com/document/product/1823/130092",
    "regionHint": "cn",
    "api": "openai-completions",
    "baseUrl": "https://api.lkeap.cloud.tencent.com/coding/v3",
    "models": [
      {
        "id": "tc-code-latest"
      },
      {
        "id": "glm-5"
      }
    ]
  },
  {
    "id": "opencode-go",
    "name": "OpenCode Go",
    "docsUrl": "https://opencode.ai/docs/go/",
    "regionHint": "global",
    "api": "openai-completions",
    "baseUrl": "https://opencode.ai/zen/go/v1",
    "models": [
      {
        "id": "grok-4.5"
      },
      {
        "id": "glm-5.2"
      },
      {
        "id": "glm-5.1"
      },
      {
        "id": "kimi-k3"
      },
      {
        "id": "kimi-k2.7-code"
      },
      {
        "id": "kimi-k2.6"
      },
      {
        "id": "mimo-v2.5"
      },
      {
        "id": "mimo-v2.5-pro"
      },
      {
        "id": "deepseek-v4-pro"
      },
      {
        "id": "deepseek-v4-flash"
      },
      {
        "id": "hy3"
      }
    ]
  },
  {
    "id": "vercel-ai-gateway",
    "name": "Vercel AI Gateway",
    "docsUrl": "https://vercel.com/docs/ai-gateway/coding-agents",
    "regionHint": "global",
    "api": "openai-completions",
    "baseUrl": "https://ai-gateway.vercel.sh/v1",
    "models": [
      {
        "id": "anthropic/claude-sonnet-4.6"
      },
      {
        "id": "openai/gpt-5.4"
      },
      {
        "id": "xai/grok-4.5"
      }
    ]
  }
];
