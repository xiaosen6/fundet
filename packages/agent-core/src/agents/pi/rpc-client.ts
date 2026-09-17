/**
 * pi RPC 子进程客户端 —— spawn `pi --mode rpc` + JSONL 协议(stdin 命令 / stdout 响应+事件)。
 *
 * 协议要点(pi docs/rpc.md):
 *  - 严格 JSONL,仅以 LF 分帧;输入允许 \r\n(strip 尾部 \r)。不能用 readline
 *    (它会按 U+2028/U+2029 切行,而这些字符在 JSON 字符串里合法)。
 *  - 命令可带 id 做请求/响应关联;响应 type='response' 且回带同 id。
 *  - 其余 stdout 行都是事件(含 extension_ui_request 子协议)。
 */

import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { StringDecoder } from 'node:string_decoder';

import type { Logger } from '../../interfaces/logger.js';
import { redactSensitiveText } from '@fundet/shared/error-redaction';

/** pi RPC 响应帧。 */
export interface PiRpcResponse {
  type: 'response';
  id?: string;
  command: string;
  success: boolean;
  data?: unknown;
  error?: string;
}

/** pi RPC 事件帧(response 之外的一切;具体形状 translator 侧收窄)。 */
export interface PiRpcEvent {
  type: string;
  [key: string]: unknown;
}

export interface PiRpcSpawnOptions {
  binaryPath: string;
  args: string[];
  cwd: string;
  env: Record<string, string | undefined>;
  logger: Logger;
  /** 事件帧回调(response 之外的所有行)。 */
  onEvent: (event: PiRpcEvent) => void;
  /** 进程退出回调(exit code / signal;正常 close() 也会触发)。 */
  onExit: (info: { code: number | null; signal: NodeJS.Signals | null }) => void;
  onStderrLine?: (line: string) => void;
  /** 本地进程生命周期观察器；返回值在该 spawn 的 error/close 时幂等调用。 */
  onProcessSpawned?: (pid: number) => void | (() => void);
}

const DEFAULT_REQUEST_TIMEOUT_MS = 30_000;
const KILL_GRACE_MS = 3_000;
/** exit 确认后等尾帧的排水窗(上游 #4182 同值)。 */
const EXIT_DRAIN_MS = 250;
/** JSONL 单行字节上限(上游 #4518 同值)：超限行丢弃并按帧超限处理，防无限缓冲。 */
const MAX_LINE_BYTES = 16 * 1024 * 1024;

export const PI_RPC_OVERSIZED_FRAME_ERROR =
  'RPC response exceeded 16 MiB and was discarded.';

/**
 * 帧诊断日志的标签白名单:pi 协议的事件类型 / role / stopReason / 块类型都是短
 * 标识符。扩展或畸形事件可能把任意正文塞进这些字段——不符合标识符形态的
 * 一律归一为 '(other)',正文不进日志(白名单方向,不靠脱敏兜底)。
 */
const FRAME_LABEL_RE = /^[A-Za-z0-9_.:-]{1,64}$/;

function sanitizeFrameLabel(value: unknown): string {
  if (typeof value !== 'string' || value.length === 0) return '(untyped)';
  return FRAME_LABEL_RE.test(value) ? value : '(other)';
}

/** 启动期 stderr 摘要上限（只留尾部；上游 #4626 同值） */
const MAX_STARTUP_STDERR_CHARS = 2000;
/** 错误面只要失败模块名，不要机器路径/堆栈（上游 #4626 sanitizeStartupDiagnostic） */
function sanitizeStartupDiagnostic(line: string): string {
  if (/^\s*at(?:\s|$)/.test(line)) return '';
  const pathLabel = (value: string): string => {
    const name = value.split(/[\\/]/).filter(Boolean).pop() ?? '';
    return `<path:${name}>`;
  };
  return line
    .replace(/(["'])((?:file:\/\/\/|[A-Za-z]:[\\/]|\/|\\)[^"'\r\n]*)\1/g,
      (_match, quote: string, value: string) => `${quote}${pathLabel(value)}${quote}`)
    .replace(/(?<![\w:/\\])(?:file:\/\/\/|[A-Za-z]:[\\/]|\/|\\)[^\r\n"'<>]+?(?=:\s|["'<>\r\n]|$)/g,
      (value) => pathLabel(value));
}

export class PiRpcProcess {
  private child: ChildProcessWithoutNullStreams;
  private nextRequestId = 1;
  private pending = new Map<string, {
    resolve: (resp: PiRpcResponse) => void;
    reject: (err: Error) => void;
    timer: NodeJS.Timeout;
    /** 命令 type（超限帧只结束可确定归属的 get_entries，见 failOversizedPending） */
    commandType: string;
  }>();
  private closed = false;
  private readonly logger: Logger;
  // 启动期（首个 RPC 响应前）的脱敏 stderr 尾部；RPC 通了就清（不存运行期输出）
  private startupStderr = '';
  private receivedRpcResponse = false;
  private exitError: Error | null = null;
  private disposeProcessRegistration: (() => void) | undefined;
  /** #3696 帧诊断:本轮按事件类型计数,agent_settled 落直方图(只记元数据)。 */
  private readonly eventFrameCounts = new Map<string, number>();
  /** #4182 exit 已确认但尾帧未排完:close 事件可能被握管道的后代无限期拖住。 */
  private exitInfo: { code: number | null; signal: NodeJS.Signals | null } | null = null;
  private exitDrainTimer: NodeJS.Timeout | undefined;
  private exitNotified = false;
  private exitWaiters: Array<() => void> = [];

  constructor(private readonly opts: PiRpcSpawnOptions) {
    this.logger = opts.logger;
    this.child = spawn(opts.binaryPath, opts.args, {
      cwd: opts.cwd,
      env: opts.env as NodeJS.ProcessEnv,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    if (this.child.pid != null && this.child.pid > 0) {
      try {
        const dispose = opts.onProcessSpawned?.(this.child.pid);
        if (typeof dispose === 'function') this.disposeProcessRegistration = dispose;
      } catch {
        // Observation failures must not block Pi startup. The process simply remains
        // non-terminable in the resource usage panel.
      }
    }

    attachJsonlReader(this.child.stdout, (line) => this.handleStdoutLine(line), {
      maxLineBytes: MAX_LINE_BYTES,
      onOversizedLine: (bytes) => {
        this.logger.warn('pi rpc: discarded oversized JSONL line', { bytes });
        this.failOversizedPending();
      },
    });
    attachJsonlReader(this.child.stderr, (line) => {
      if (line.trim().length === 0) return;
      // stderr 可能含 env 凭证（崩溃 dump/依赖 debug 输出），进日志前先脱敏。
      // 顺序：先遮蔽绝对路径（redactSensitiveText 会吃反斜杠，Windows 路径
      // 先被搅碎就认不出了），再做敏感值脱敏。
      const redacted = redactSensitiveText(sanitizeStartupDiagnostic(line));
      this.logger.warn('pi stderr', { line: redacted.slice(0, 2000) });
      if (!this.receivedRpcResponse && !this.closed) {
        if (redacted) {
          this.startupStderr = `${this.startupStderr}${this.startupStderr ? '\n' : ''}${redacted}`
            .slice(-MAX_STARTUP_STDERR_CHARS);
        }
      }
      opts.onStderrLine?.(redacted);
    });

    this.child.on('error', (err) => {
      this.disposeRegistration();
      this.logger.error('pi process error', { message: err.message });
      this.failAllPending(new Error(`pi process error: ${err.message}`));
    });
    this.child.on('exit', (code, signal) => {
      // shell/build 后代可能继承管道:pi 自己退出后 Node 的 close 事件要等后代
      // 释放,可能无限期不触发 → 会话悬挂。exit 是执行器死亡的权威证据——等
      // 250ms 让已写入的 RPC 尾帧排走,再销毁自端管道并上报(不做进程树击杀)。
      if (this.exitNotified) return;
      const info = { code, signal };
      this.exitInfo = info;
      this.exitDrainTimer = setTimeout(() => {
        this.exitDrainTimer = undefined;
        this.finishExit(info);
      }, EXIT_DRAIN_MS);
      this.exitDrainTimer.unref?.();
    });
    this.child.on('close', (code, signal) => {
      if (this.exitDrainTimer) {
        clearTimeout(this.exitDrainTimer);
        this.exitDrainTimer = undefined;
      }
      this.finishExit({ code, signal });
    });
  }

  /** exit/close 收口:幂等。销毁自端管道后通知,后代握着的另一端从此与我们无关。 */
  private finishExit(info: { code: number | null; signal: NodeJS.Signals | null }): void {
    if (this.exitNotified) return;
    this.exitNotified = true;
    this.exitInfo = info;
    this.disposeRegistration();
    this.closed = true;
    try { this.child.stdout.destroy(); } catch { /* already gone */ }
    try { this.child.stderr.destroy(); } catch { /* already gone */ }
    try { this.child.stdin.destroy(); } catch { /* already gone */ }
    this.exitError = this.createExitError(`pi process exited (code=${info.code}, signal=${info.signal})`);
    this.startupStderr = '';
    this.failAllPending(this.exitError);
    this.opts.onExit({ code: info.code, signal: info.signal });
    for (const waiter of this.exitWaiters.splice(0)) waiter();
  }

  /** exit 错误带上启动期 stderr 摘要（脱敏+路径遮蔽）：code=1 的崩溃从此可排查 */
  private createExitError(message: string): Error {
    return new Error(this.startupStderr
      ? `${message}\nPi startup stderr:\n${this.startupStderr}`
      : message);
  }

  private disposeRegistration(): void {
    const dispose = this.disposeProcessRegistration;
    this.disposeProcessRegistration = undefined;
    try { dispose?.(); } catch { /* best-effort diagnostic cleanup */ }
  }

  get pid(): number | undefined {
    return this.child.pid ?? undefined;
  }

  get isClosed(): boolean {
    return this.closed;
  }

  /** 发送命令并等待同 id 响应。success:false 时同样 resolve(由调用方看 success/error)。 */
  async request(
    command: Record<string, unknown>,
    { timeoutMs = DEFAULT_REQUEST_TIMEOUT_MS }: { timeoutMs?: number } = {},
  ): Promise<PiRpcResponse> {
    if (this.closed) throw this.exitError ?? this.createExitError('pi process already exited');
    const id = `c${this.nextRequestId++}`;
    const payload = JSON.stringify({ ...command, id });

    return new Promise<PiRpcResponse>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`pi rpc timeout after ${timeoutMs}ms: ${String(command.type)}`));
      }, timeoutMs);
      this.pending.set(id, {
        resolve,
        reject,
        timer,
        commandType: typeof command.type === 'string' ? command.type : '',
      });
      this.child.stdin.write(payload + '\n', (err) => {
        if (err) {
          const entry = this.pending.get(id);
          if (entry) {
            clearTimeout(entry.timer);
            this.pending.delete(id);
            reject(new Error(`pi rpc write failed: ${err.message}`));
          }
        }
      });
    });
  }

  /** fire-and-forget 写入(extension_ui_response 等不产生 response 的帧)。 */
  send(frame: Record<string, unknown>): void {
    if (this.closed) return;
    this.child.stdin.write(JSON.stringify(frame) + '\n');
  }

  /** 优雅关闭:SIGTERM → 宽限期 → SIGKILL。幂等。以 exit 确认为收口(见 finishExit)。 */
  async close(): Promise<void> {
    if (this.exitNotified) return;
    const child = this.child;
    await new Promise<void>((resolve) => {
      this.exitWaiters.push(resolve);
      let killTimer: NodeJS.Timeout | undefined;
      const escalate = () => {
        if (killTimer) { clearTimeout(killTimer); killTimer = undefined; }
        // exit 已确认(正在排水尾帧)时不再击杀,finishExit 会唤醒等待方
        if (this.exitInfo) return;
        try { child.kill('SIGKILL'); } catch { /* already gone */ }
      };
      killTimer = setTimeout(escalate, KILL_GRACE_MS);
      try {
        child.kill('SIGTERM');
      } catch {
        escalate();
      }
    });
  }

  private handleStdoutLine(line: string): void {
    if (line.trim().length === 0) return;
    let frame: unknown;
    try {
      frame = JSON.parse(line);
    } catch {
      this.logger.warn('pi rpc: non-JSON stdout line dropped', { line: line.slice(0, 500) });
      return;
    }
    if (typeof frame !== 'object' || frame === null) return;
    const obj = frame as Record<string, unknown>;

    if (obj.type === 'response') {
      const resp = obj as unknown as PiRpcResponse;
      const id = typeof resp.id === 'string' ? resp.id : undefined;
      if (id && this.pending.has(id)) {
        const entry = this.pending.get(id)!;
        clearTimeout(entry.timer);
        this.pending.delete(id);
        this.receivedRpcResponse = true;
        this.startupStderr = '';
        entry.resolve(resp);
      } else {
        // 无 id 的响应(如 parse error)或迟到响应 —— 记日志不丢语义。
        this.logger.warn('pi rpc: unmatched response', {
          command: resp.command,
          success: resp.success,
          error: resp.error,
        });
      }
      return;
    }

    const event = obj as PiRpcEvent;
    this.recordEventFrameDiagnostics(event);
    this.opts.onEvent(event);
  }

  /**
   * #3696 定界诊断:成功轮的正文可能整帧消失(pi 侧 jsonl 有正文、DB/UI 均无),
   * 离线无法复现。按事件类型计数,message_end / agent_settled 各落一行元数据
   * 日志(块类型与字符数,绝不含消息正文),下次复现即可区分「pi 未发该帧」与
   * 「宿主收到后下游丢失」。abort/进程异常的轮收不到 agent_settled,计数留到
   * 下一轮 agent_start 先冲刷再清零——证据不丢,直方图不跨轮污染。
   */
  private recordEventFrameDiagnostics(event: PiRpcEvent): void {
    const type = sanitizeFrameLabel(event.type);
    if (type === 'agent_start' && this.eventFrameCounts.size > 0) {
      this.logger.info('pi rpc turn frame histogram (no agent_settled)', {
        frames: Object.fromEntries(this.eventFrameCounts),
      });
      this.eventFrameCounts.clear();
    }
    this.eventFrameCounts.set(type, (this.eventFrameCounts.get(type) ?? 0) + 1);
    if (type === 'message_end') {
      const message = event.message as
        | { role?: unknown; stopReason?: unknown; content?: unknown }
        | undefined;
      const blocks = Array.isArray(message?.content) ? (message?.content as unknown[]) : [];
      const blockTypes: string[] = [];
      let textChars = 0;
      let thinkingChars = 0;
      for (const block of blocks) {
        if (!block || typeof block !== 'object') {
          blockTypes.push('(invalid)');
          continue;
        }
        const rec = block as Record<string, unknown>;
        const blockType = sanitizeFrameLabel(rec['type']);
        blockTypes.push(blockType);
        if (rec['type'] === 'text' && typeof rec['text'] === 'string') textChars += rec['text'].length;
        if (rec['type'] === 'thinking' && typeof rec['thinking'] === 'string') {
          thinkingChars += rec['thinking'].length;
        }
      }
      this.logger.info('pi rpc message_end frame', {
        role: sanitizeFrameLabel(message?.role),
        stopReason:
          message?.stopReason === undefined || message?.stopReason === null
            ? null
            : sanitizeFrameLabel(message.stopReason),
        blockTypes,
        textChars,
        thinkingChars,
      });
      return;
    }
    if (type === 'agent_settled') {
      this.logger.info('pi rpc turn frame histogram', {
        frames: Object.fromEntries(this.eventFrameCounts),
      });
      this.eventFrameCounts.clear();
    }
  }

  /**
   * 超限帧处理(上游 #4518)：超限通知不带帧 type / 响应 id；事件帧(如
   * message_end)也可能超限。只能结束可确定归属的 get_entries(大响应只可能
   * 是它)，不能把唯一 pending 的 steer/abort 猜成受害者。
   */
  private failOversizedPending(): void {
    const victims = [...this.pending.entries()].filter(([, entry]) => entry.commandType === 'get_entries');
    if (victims.length === 0) return;
    for (const [id, entry] of victims) {
      clearTimeout(entry.timer);
      this.pending.delete(id);
      entry.resolve({
        type: 'response',
        id,
        command: entry.commandType,
        success: false,
        error: PI_RPC_OVERSIZED_FRAME_ERROR,
      });
    }
  }

  private failAllPending(err: Error): void {
    for (const [, entry] of this.pending) {
      clearTimeout(entry.timer);
      entry.reject(err);
    }
    this.pending.clear();
  }
}

/**
 * 协议合规的 JSONL 读取:只按 \n 切,strip 尾部 \r,跨 chunk 维护缓冲。
 * (pi docs/rpc.md 明确警告 Node readline 不合规。)
 * maxLineBytes:单行超限时整行丢弃(吃到下一个换行为止)并回调 onOversizedLine，
 * 防超长帧把缓冲撑爆(上游 #4518)。
 */
export function attachJsonlReader(
  stream: NodeJS.ReadableStream,
  onLine: (line: string) => void,
  opts: { maxLineBytes?: number; onOversizedLine?: (bytes: number) => void } = {},
): void {
  const decoder = new StringDecoder('utf8');
  let buffer = '';
  let discarding = false;
  let discardedBytes = 0;

  const handleCompleteLine = (line: string): void => {
    if (line.endsWith('\r')) line = line.slice(0, -1);
    onLine(line);
  };

  stream.on('data', (chunk: Buffer | string) => {
    const text = typeof chunk === 'string' ? chunk : decoder.write(chunk);
    // 字符数近似字节上限（JSON 主体是 ASCII，1 char ≈ 1 byte；CJK 行最坏 3x
    // 余量）——目的是有界内存，不是精确计量。
    const maxChars = opts.maxLineBytes ?? Infinity;
    buffer += text;
    while (true) {
      const newlineIndex = buffer.indexOf('\n');
      if (newlineIndex === -1) {
        // 无换行的部分行超限 → 进丢弃模式，等行尾
        if (!discarding && buffer.length > maxChars) {
          discarding = true;
          discardedBytes = buffer.length;
          buffer = '';
        }
        break;
      }
      const line = buffer.slice(0, newlineIndex);
      buffer = buffer.slice(newlineIndex + 1);
      if (discarding) {
        discarding = false;
        opts.onOversizedLine?.(discardedBytes + line.length);
        continue;
      }
      // 单 chunk 内完整到达的超限行同样丢弃
      if (line.length > maxChars) {
        opts.onOversizedLine?.(line.length);
        continue;
      }
      handleCompleteLine(line);
    }
  });

  stream.on('end', () => {
    buffer += decoder.end();
    if (buffer.length > 0) {
      if (discarding) {
        opts.onOversizedLine?.(discardedBytes + buffer.length);
        return;
      }
      handleCompleteLine(buffer.endsWith('\r') ? buffer.slice(0, -1) : buffer);
    }
  });
}
