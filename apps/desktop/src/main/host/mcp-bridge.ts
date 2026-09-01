/**
 * Fundet MCP 桥：把用户配置的外部 MCP server 注入 pi 会话。
 *
 * 机制（pi 无内置 MCP，只能走 cindy-bridge 扩展）：
 *  - PiAgent.startSession 调 deps.preparePiExtraSpawnConfig（本文件实现），拿到
 *    { mcpBridge: {token, servers}, mcpEnv, disposeSessionCtx }；
 *  - servers 描述符经 CINDY_PI_MCP_BRIDGE env 传给 pi 内的 cindy-bridge 扩展，
 *    它用 streamable-HTTP 连每个 server（initialize → tools/list → 注册成
 *    mcp__<server>__<tool> 工具，execute 转发 tools/call）。
 *
 * 两类 server：
 *  - http：描述符直通（remote.headerEnvVars 指 header 名 → env 变量名，真值经
 *    mcpEnv 只进 pi 父进程 env，不落描述符）。host 零转发。
 *  - stdio：bridge 只会说 streamable-HTTP，host 必须自己当中间人 —— spawn 子进程
 *    （MCP stdio = NDJSON），再用 localhost http 代理按 Bearer token 鉴权转发。
 *    代理在 prepare 阶段先完成 initialize 握手并缓存结果（npx 冷启动可能远超
 *    bridge 扩展 10s 启动预算），bridge 的 initialize 直接回缓存。
 *
 * 生命周期：每次 startSession 重建（stdio 子进程随会话拉起），disposeSessionCtx
 * 在会话 close 时由 PiAgent 调用（幂等），关闭 http 代理 + 杀子进程。
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { createInterface } from 'node:readline';
import { createServer, type Server } from 'node:http';
import { randomBytes } from 'node:crypto';
import type {
  Logger,
  McpProvider,
  PiExtraSpawnConfig,
  PiExtraSpawnConfigContext,
  PiMcpServerRef,
} from '@fundet/agent-core';
import { SEARCH_MCP_SERVER_NAME } from '../../shared/search-engines.ts';
import { BROWSER_ENABLED_SETTING, BROWSER_MCP_SERVER_NAME } from '../../shared/browser-settings.ts';
import { COMPUTER_ENABLED_SETTING, COMPUTER_MCP_SERVER_NAME } from '../../shared/computer-settings.ts';
import { resolveCuaDriverCommand } from '../computer/driver.ts';
import { listMcpServers, type McpServerView } from '../db/mcp-servers.js';
import { getBoolSetting } from '../db/settings.js';
import { startSearchMcpServer } from '../search/mcp-server.ts';
import { handleWebSearch } from '../search/tool.ts';
import { ensureBrowserRuntime } from '../browser/host.js';
import { startBrowserMcpServer } from '../browser/mcp-http.js';

/** 单次请求兜底超时（bridge 侧另有 startup/request 预算，这只是防永久挂起） */
const PROXY_REQUEST_TIMEOUT_MS = 600_000;
/** http body 上限：MCP 工具结果可能带大文本，给到 32MB */
const PROXY_MAX_BODY_BYTES = 32 * 1024 * 1024;

/**
 * stdio MCP server 的 localhost streamable-HTTP 代理。
 * 协议透明转发（NDJSON 逐行、id 相关），唯二特判：
 *  - initialize 回 host 预热时的缓存结果（避免 bridge 二次 initialize 打到 server）；
 *  - 无 id 的 notification 直接 202。
 */
class StdioMcpHttpProxy {
  private child: ChildProcess | null = null;
  private server: Server | null = null;
  private readonly pending = new Map<number, {
    resolve: (msg: unknown) => void;
    reject: (err: Error) => void;
    timer: NodeJS.Timeout;
  }>();
  private initializeResult: unknown = null;

  constructor(
    private readonly config: McpServerView,
    private readonly token: string,
    private readonly logger: Logger,
    private readonly spawnOpts?: { cwd?: string; env?: NodeJS.ProcessEnv },
  ) {}

  /** spawn 子进程 + 起 http 监听 + initialize 预热；返回分配给 bridge 的 URL */
  async start(): Promise<string> {
    const command = this.config.command!;
    this.child = spawn(command, this.config.args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: this.spawnOpts?.env ?? process.env,
      ...(this.spawnOpts?.cwd ? { cwd: this.spawnOpts.cwd } : {}),
    });
    this.child.on('error', (err) => {
      this.logger.warn('mcp stdio 子进程启动失败', { name: this.config.name, error: String(err) });
      this.failAllPending(new Error(`MCP server "${this.config.name}" spawn failed: ${err.message}`));
    });
    this.child.on('exit', (code, signal) => {
      this.logger.warn('mcp stdio 子进程退出', { name: this.config.name, code, signal });
      this.failAllPending(new Error(`MCP server "${this.config.name}" exited (code=${code})`));
    });
    this.child.stderr?.on('data', (chunk: Buffer) => {
      // server 自己的日志，截断防刷屏
      this.logger.debug('mcp stdio stderr', {
        name: this.config.name,
        line: chunk.toString('utf8').slice(0, 500).trim(),
      });
    });

    // NDJSON：每行一个 JSON-RPC 消息；有 id 且有人在等 → 结算，否则是 server 主动 notification
    const rl = createInterface({ input: this.child.stdout! });
    rl.on('line', (line) => {
      let msg: { id?: unknown };
      try {
        msg = JSON.parse(line) as { id?: unknown };
      } catch {
        this.logger.warn('mcp stdio 输出非 JSON 行（忽略）', { name: this.config.name, line: line.slice(0, 200) });
        return;
      }
      const id = typeof msg.id === 'number' ? msg.id : null;
      const entry = id !== null ? this.pending.get(id) : undefined;
      if (id === null || !entry) return;
      this.pending.delete(id);
      clearTimeout(entry.timer);
      entry.resolve(msg);
    });

    this.server = createServer((req, res) => void this.handleHttp(req, res));
    await new Promise<void>((resolve, reject) => {
      this.server!.once('error', reject);
      this.server!.listen(0, '127.0.0.1', () => resolve());
    });
    const address = this.server.address();
    if (!address || typeof address === 'string') throw new Error('mcp proxy listen failed');
    const url = `http://127.0.0.1:${address.port}/mcp`;

    // 预热：host 侧先跑 initialize 握手，npx 冷启动的等待发生在这里（pi 还没 spawn），
    // bridge 扩展启动时的 initialize 直接回这份缓存，不占它的 10s 启动预算。
    const initMsg = await this.forward({
      jsonrpc: '2.0',
      id: this.allocHostId(),
      method: 'initialize',
      params: {
        protocolVersion: '2025-03-26',
        capabilities: {},
        clientInfo: { name: 'fundet-mcp-proxy', version: '1.0.0' },
      },
    });
    const initErr = (initMsg as { error?: { message?: string } }).error;
    if (initErr) throw new Error(`MCP server "${this.config.name}" initialize failed: ${initErr.message ?? 'unknown'}`);
    this.initializeResult = (initMsg as { result?: unknown }).result ?? {};
    this.notify({ jsonrpc: '2.0', method: 'notifications/initialized' });
    this.logger.info('mcp stdio server 就绪', { name: this.config.name, url });
    return url;
  }

  /** host 侧预热用的 id 段：负数，不与 bridge 转发的正数 id 冲突 */
  private nextHostId = -1;
  private allocHostId(): number {
    return this.nextHostId--;
  }

  /** 转发一条带 id 的请求，按 id 等响应（超时兜底 reject） */
  private forward(message: { id: number } & Record<string, unknown>): Promise<unknown> {
    if (!this.child?.stdin?.writable) {
      return Promise.reject(new Error(`MCP server "${this.config.name}" 不可用`));
    }
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(message.id);
        reject(new Error(`MCP server "${this.config.name}" 请求超时`));
      }, PROXY_REQUEST_TIMEOUT_MS);
      this.pending.set(message.id, { resolve, reject, timer });
      this.child!.stdin!.write(JSON.stringify(message) + '\n');
    });
  }

  /** 无 id 的 notification：只发不等 */
  private notify(message: Record<string, unknown>): void {
    if (this.child?.stdin?.writable) this.child.stdin.write(JSON.stringify(message) + '\n');
  }

  private failAllPending(err: Error): void {
    for (const [id, entry] of this.pending) {
      clearTimeout(entry.timer);
      entry.reject(err);
      this.pending.delete(id);
    }
  }

  private async handleHttp(
    req: import('node:http').IncomingMessage,
    res: import('node:http').ServerResponse,
  ): Promise<void> {
    const reply = (status: number, body?: unknown): void => {
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(body === undefined ? undefined : JSON.stringify(body));
    };
    try {
      if (req.method !== 'POST') return reply(405, { error: 'method not allowed' });
      if (req.headers.authorization !== `Bearer ${this.token}`) return reply(401, { error: 'unauthorized' });

      const body = await new Promise<string>((resolve, reject) => {
        let data = '';
        req.on('data', (chunk: Buffer) => {
          data += chunk.toString('utf8');
          if (data.length > PROXY_MAX_BODY_BYTES) {
            reject(new Error('body too large'));
            req.destroy();
          }
        });
        req.on('end', () => resolve(data));
        req.on('error', reject);
      });
      const msg = JSON.parse(body) as { id?: unknown; method?: string; params?: unknown };

      // notification（无 id）：转发后 202 空体（bridge 的 notify 接受任意响应）
      if (msg.id === undefined || msg.id === null) {
        this.notify(msg as Record<string, unknown>);
        return reply(202);
      }
      // bridge 的 initialize 回预热缓存（server 只见一次 initialize）
      if (msg.method === 'initialize') {
        return reply(200, { jsonrpc: '2.0', id: msg.id, result: this.initializeResult });
      }
      const result = await this.forward(msg as { id: number } & Record<string, unknown>);
      reply(200, result);
    } catch (err) {
      this.logger.warn('mcp proxy 请求失败', { name: this.config.name, error: String(err) });
      reply(500, { error: err instanceof Error ? err.message : String(err) });
    }
  }

  /** 会话关闭：关 http + 杀子进程 + 拒掉在途请求。幂等。 */
  dispose(): void {
    this.failAllPending(new Error(`MCP server "${this.config.name}" 已随会话关闭`));
    if (this.server) {
      this.server.close();
      this.server = null;
    }
    if (this.child) {
      this.child.kill();
      this.child = null;
    }
  }
}

/** http server 的 header 名 → pi 父进程 env 变量名（真值经 mcpEnv 注入，不落描述符） */
function headerEnvVarName(serverName: string, headerName: string): string {
  const sanitize = (s: string): string => s.toUpperCase().replace(/[^A-Z0-9]/g, '_');
  return `FUNDET_MCP_HDR_${sanitize(serverName)}_${sanitize(headerName)}`;
}

/**
 * AgentDeps.preparePiExtraSpawnConfig 的 Fundet 实现。
 * 始终注入内置搜索 MCP（设置里的 Tavily/Brave/博查/智谱）；再叠加用户表里的外部 server。
 */
export function createPreparePiExtraSpawnConfig(logger: Logger) {
  return async (
    _providers: McpProvider[],
    _ctx?: PiExtraSpawnConfigContext,
  ): Promise<PiExtraSpawnConfig | null> => {
    const configs = listMcpServers().filter((s) => s.enabled);
    const token = randomBytes(32).toString('base64url');
    const servers: PiMcpServerRef[] = [];
    const mcpEnv: Record<string, string> = {};
    // 单个 server 失败不拖垮整次会话（其余 server 照常注入）——与 pi 侧
    // "MCP bridge prep failed, continuing without cindy tools" 的容错口径一致。
    const disposers: Array<() => void> = [];

    try {
      const search = await startSearchMcpServer(token, logger.child('search-mcp'), handleWebSearch);
      disposers.push(search.dispose);
      servers.push({ name: SEARCH_MCP_SERVER_NAME, url: search.url });
    } catch (err) {
      logger.error('内置搜索 MCP 启动失败', {
        error: err instanceof Error ? err.message : String(err),
      });
    }

    // 浏览器自动化（设置 → 通用，默认关）：runtime 是进程级单例，这里只挂
    // 每会话一份 MCP server。审批不进白名单——跟会话权限三档走（ask 每次问）。
    try {
      if (getBoolSetting(BROWSER_ENABLED_SETTING, false)) {
        const runtime = await ensureBrowserRuntime(logger);
        if (runtime) {
          const browser = await startBrowserMcpServer(token, logger.child('browser-mcp'), runtime);
          disposers.push(browser.dispose);
          servers.push({
            name: BROWSER_MCP_SERVER_NAME,
            url: browser.url,
            remote: {
              headerEnvVars: {},
              // navigate/act 可能跑几十秒，给满 bridge 硬边界
              startupTimeoutMs: 30_000,
              requestTimeoutMs: 600_000,
            },
          });
        }
      }
    } catch (err) {
      logger.error('浏览器 MCP 启动失败（跳过，其余 server 照常）', {
        error: err instanceof Error ? err.message : String(err),
      });
    }

    // 电脑操作（设置 → 通用，默认关）：cua-driver 是外部 Rust 二进制（stdio
    // MCP server，子命令 mcp），直接经 StdioMcpHttpProxy 挂载——截屏/输入
    // 能力全在 driver 内。审批不进白名单，跟会话权限三档走。
    try {
      if (getBoolSetting(COMPUTER_ENABLED_SETTING, false)) {
        const command = resolveCuaDriverCommand();
        if (!command) {
          logger.warn('电脑操作已开启但 cua-driver 二进制缺失（tools/cua-driver/update.mjs 下载 / 重装应用）');
        } else {
          const proxy = new StdioMcpHttpProxy(
            {
              id: 'builtin-computer',
              name: COMPUTER_MCP_SERVER_NAME,
              type: 'stdio',
              enabled: true,
              command,
              args: ['mcp'],
              url: null,
              headers: {},
              createdAt: 0,
            },
            token,
            logger.child(`mcp:${COMPUTER_MCP_SERVER_NAME}`),
          );
          const url = await proxy.start();
          disposers.push(() => proxy.dispose());
          servers.push({ name: COMPUTER_MCP_SERVER_NAME, url });
        }
      }
    } catch (err) {
      logger.error('电脑操作 MCP 启动失败（跳过，其余 server 照常）', {
        error: err instanceof Error ? err.message : String(err),
      });
    }

    for (const config of configs) {
      try {
        if (config.type === 'http') {
          const headerEnvVars: Record<string, string> = {};
          for (const [headerName, value] of Object.entries(config.headers)) {
            const envName = headerEnvVarName(config.name, headerName);
            headerEnvVars[headerName] = envName;
            mcpEnv[envName] = value;
          }
          servers.push({
            name: config.name,
            url: config.url!,
            remote: {
              headerEnvVars,
              // 须在 bridge 的硬边界内（startup < 30s / request <= 600s，超出会被 clamp）
              startupTimeoutMs: 10_000,
              requestTimeoutMs: 600_000,
            },
          });
        } else {
          const proxy = new StdioMcpHttpProxy(config, token, logger.child(`mcp:${config.name}`));
          const url = await proxy.start();
          disposers.push(() => proxy.dispose());
          servers.push({ name: config.name, url });
        }
      } catch (err) {
        logger.error('MCP server 装配失败（跳过该 server）', {
          name: config.name,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    if (servers.length === 0) {
      for (const dispose of disposers) dispose();
      return null;
    }

    let disposed = false;
    return {
      mcpBridge: { token, servers },
      mcpEnv,
      disposeSessionCtx: () => {
        if (disposed) return;
        disposed = true;
        for (const dispose of disposers) dispose();
      },
    };
  };
}
