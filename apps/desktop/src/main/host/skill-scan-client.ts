/**
 * SkillScanClient —— 技能目录扫描的 utilityProcess 客户端（Cindy #5858 同构）。
 *
 * 为什么隔离：扫描器是同步原生 fs（scandir/open/realpath），网络盘/OneDrive/
 * 杀软文件审批可让单次调用无限期挂起——跑在主进程就是整机卡死。隔离后主进程
 * 只持计时器：15s 超时即 kill 子进程返回错误（原生 I/O 取消不了但进程杀得掉）。
 *
 * 纯逻辑零 Electron 依赖（fork 由构造器注入，node --test 用假子进程直测）。
 * 机制照抄 Cindy customizationScanClient：UUID 配对（迟到/串台消息丢弃）、
 * 同参数去重（各拿 structuredClone 独立副本）、并发上限 6（kill 只请求终止，
 * 槽位等 exit 事件才回收——挂死子进程不会绕过上限）、dispose 幂等。
 */
import { randomUUID } from 'node:crypto';
import type { ListCustomizationsOptions, ListCustomizationsResult } from '@fundet/agent-core';
import type { SkillScanRequest, SkillScanResponse } from './skill-scan-protocol.js';

export interface SkillScanChild {
  postMessage(message: SkillScanRequest): void;
  on(event: 'message', listener: (message: unknown) => void): void;
  on(event: 'exit', listener: (code: number) => void): void;
  on(event: 'error', listener: (type: string) => void): void;
  kill(): boolean;
}

interface ScanJob {
  result: Promise<ListCustomizationsResult>;
  stop: () => void;
}

function isResult(value: unknown): value is ListCustomizationsResult {
  if (!value || typeof value !== 'object') return false;
  const result = value as Partial<ListCustomizationsResult>;
  return (
    Array.isArray(result.items) &&
    result.items.every(
      (item) =>
        item &&
        item.engine === 'pi' &&
        typeof item.name === 'string' &&
        typeof item.kind === 'string' &&
        typeof item.scope === 'string' &&
        typeof item.absolutePath === 'string',
    ) &&
    Array.isArray(result.errors) &&
    result.errors.every(
      (error) => error && typeof error.message === 'string' && (error.path === undefined || typeof error.path === 'string'),
    )
  );
}

/** 只有发现（discovery）在子进程跑；托管技能与一切写操作仍在主进程。 */
export class SkillScanClient {
  private readonly options: {
    fork: () => SkillScanChild;
    timeoutMs?: number;
    maxConcurrent?: number;
  };
  private readonly jobs = new Map<string, ScanJob>();
  private disposed = false;
  // kill() 只是请求终止：原生 I/O 可延迟真实退出，槽位等 exit 事件回收
  private readonly children = new Set<SkillScanChild>();
  private readonly killRequested = new Set<SkillScanChild>();

  constructor(options: {
    fork: () => SkillScanChild;
    timeoutMs?: number;
    maxConcurrent?: number;
  }) {
    this.options = options;
  }

  async scan(options: ListCustomizationsOptions): Promise<ListCustomizationsResult> {
    const failure = (message: string): ListCustomizationsResult => ({
      items: [],
      errors: [{ message: `[pi] ${message}` }],
    });
    if (this.disposed) return failure('Skill scanner stopped');
    let key: string;
    try {
      key = JSON.stringify(options);
    } catch {
      key = randomUUID();
    }
    const existing = this.jobs.get(key);
    // 共享 job 但各拿独立副本：调用方可能在结果数组上追加托管技能
    if (existing) return structuredClone(await existing.result);
    if (this.children.size >= (this.options.maxConcurrent ?? 6)) {
      return failure('Skill scanner busy; retry after the pending scan');
    }

    let resolve!: (result: ListCustomizationsResult) => void;
    const result = new Promise<ListCustomizationsResult>((complete) => {
      resolve = complete;
    });
    let child: SkillScanChild | undefined;
    let settled = false;
    let exited = false;
    const finish = (value: ListCustomizationsResult): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      this.jobs.delete(key);
      if (child && !exited) this.killChild(child);
      resolve(value);
    };
    // 文件审批可在原生 scandir/open 内无限等待——主进程持计时器击杀隔离进程，
    // 不在主进程事件循环/共享 libuv 池上赛跑不可取消的 I/O。
    const timer = setTimeout(() => finish(failure('Skill scan timed out')), this.options.timeoutMs ?? 15_000);
    timer.unref?.();
    this.jobs.set(key, { result, stop: () => finish(failure('Skill scanner stopped')) });
    const id = randomUUID();
    try {
      child = this.options.fork();
      this.children.add(child);
      child.on('message', (value) => {
        if (!value || typeof value !== 'object') return;
        const response = value as Partial<SkillScanResponse>;
        if (response.kind !== 'result' || response.id !== id) return;
        finish(isResult(response.result) ? response.result : failure('Skill scanner returned an invalid result'));
      });
      child.on('exit', () => {
        exited = true;
        this.children.delete(child!);
        this.killRequested.delete(child!);
        finish(failure('Skill scanner exited before completing'));
      });
      child.on('error', () => finish(failure('Skill scanner failed')));
      child.postMessage({ kind: 'scan', id, options });
    } catch {
      finish(failure('Could not start skill scanner'));
    }
    return structuredClone(await result);
  }

  private killChild(child: SkillScanChild): void {
    if (this.killRequested.has(child)) return;
    this.killRequested.add(child);
    try {
      child.kill();
    } catch {
      /* kill 失败时槽位保留到 exit 事件，防绕过并发上限 */
    }
  }

  dispose(): void {
    this.disposed = true;
    for (const job of this.jobs.values()) job.stop();
    for (const child of this.children) this.killChild(child);
  }
}
