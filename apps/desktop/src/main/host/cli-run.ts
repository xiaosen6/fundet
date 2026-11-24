/**
 * 外部 CLI 子进程执行内核（办公 CLI 桥共用）：超时击杀、输出采集、退出码。
 * 不依赖 Electron / 数据库。
 */
import { spawn, spawnSync } from 'node:child_process';

export interface CliRunResult {
  code: number;
  stdout: string;
  stderr: string;
}

export type CliSpawnOptions = {
  /** 缺省隐藏窗口（pi.exe 同款教训：控制台子系统二进制不隐藏会伴生 conhost） */
  windowsHide?: boolean;
  env?: NodeJS.ProcessEnv;
};

/**
 * 终止子进程及其后代。Windows 上命令常经 `cmd.exe /c <cli>` 转发，child.kill()
 * 只杀得掉 cmd.exe，CLI 本体变孤儿继续跑（扫码进程会一直轮询到超时）——
 * 所以用 taskkill /T 杀整棵树；非 Windows 直接 SIGTERM。
 */
export function killProcessTree(child: ReturnType<typeof spawn>): void {
  if (child.exitCode !== null || child.pid === undefined) return;
  if (process.platform === 'win32') {
    spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
    return;
  }
  try {
    child.kill('SIGTERM');
  } catch {
    /* ignore */
  }
}

export function runCliCommand(
  command: string,
  args: string[],
  timeoutMs: number,
  opts: CliSpawnOptions = {},
): Promise<CliRunResult> {
  return new Promise((resolve) => {
    let child: ReturnType<typeof spawn>;
    try {
      child = spawn(command, args, { windowsHide: opts.windowsHide !== false, env: opts.env });
    } catch {
      resolve({ code: -1, stdout: '', stderr: 'spawn 失败' });
      return;
    }
    let stdout = '';
    let stderr = '';
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      killProcessTree(child);
      resolve({ code: -1, stdout, stderr: `${stderr}\n超时（${Math.round(timeoutMs / 1000)}s）` });
    }, timeoutMs);
    child.stdout?.on('data', (d: Buffer) => {
      stdout += d.toString();
    });
    child.stderr?.on('data', (d: Buffer) => {
      stderr += d.toString();
    });
    child.on('error', (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ code: -1, stdout, stderr: err.message });
    });
    // close（而非 exit）：stdio 流已排干，输出齐全
    child.on('close', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ code: code ?? -1, stdout, stderr });
    });
  });
}

/** 只留尾部给面板展示（安装/装配日志可能很长） */
export function tailOf(text: string, max = 3000): string {
  const t = text.trim();
  return t.length <= max ? t : `…${t.slice(-max)}`;
}
