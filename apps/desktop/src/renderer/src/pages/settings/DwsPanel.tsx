/**
 * 钉钉工作台面板：dws 官方 CLI 的四步引导（安装 → 登录 → 技能装配 → 就绪）。
 * 状态真源在主进程 host/dws.ts；Agent 侧零改动——技能包落到用户技能根即被会话加载。
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { DwsStatusView } from '../../../../shared/fundet-api.js';
import { cn } from '../../lib/cn';
import { brand } from '../../../../shared/brand.ts';

const SECONDARY_BTN = 'h-8 rounded-full border border-board px-3 text-12 text-primary disabled:opacity-40';
const PRIMARY_BTN = 'h-8 rounded-full bg-accent px-3 text-12 font-medium text-accent-fg disabled:opacity-40';

const DWS_REPO_URL = 'https://github.com/DingTalk-Real-AI/dingtalk-workspace-cli';
const DINGTALK_OPEN_URL = 'https://open-dev.dingtalk.com';

function statusChip(s: DwsStatusView): { label: string; className: string } {
  if (!s.installed) return { label: '未安装', className: 'bg-hover-soft text-muted' };
  if (!s.loggedIn) return { label: '待登录', className: 'bg-hover-soft text-secondary' };
  if (s.skills.length === 0) return { label: '待装技能', className: 'bg-hover-soft text-secondary' };
  return { label: '就绪', className: 'bg-chip text-secondary' };
}

export function DwsPanel(): React.JSX.Element {
  const [status, setStatus] = useState<DwsStatusView | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [output, setOutput] = useState('');
  const busyRef = useRef(false);

  const refresh = useCallback(async (): Promise<void> => {
    setStatus(await window.fundet.dwsStatus());
  }, []);

  useEffect(() => {
    void refresh();
    // 登录发生在独立终端窗：面板开着就轮询，登完自动跳到下一状态
    const timer = setInterval(() => {
      if (!busyRef.current) void refresh();
    }, 5000);
    return () => clearInterval(timer);
  }, [refresh]);

  const run = async (key: string, action: () => Promise<{ ok: boolean; output: string }>): Promise<void> => {
    setBusy(key);
    busyRef.current = true;
    setError('');
    setNotice('');
    try {
      const res = await action();
      setOutput(res.output);
      if (res.ok) setNotice('完成。');
      else setError('没成功，看下方输出定位。');
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      busyRef.current = false;
      setBusy(null);
    }
  };

  if (!status) return <p className="text-13 text-muted">加载钉钉工作台状态…</p>;

  const chip = statusChip(status);
  const identity = status.profiles
    .map((p) => [p.org, p.user].filter(Boolean).join(' · ') || p.id)
    .filter(Boolean)
    .join('；');

  return (
    <div className="flex flex-col gap-[14px]">
      <div>
        <h2 className="text-16 leading-[1.2] font-medium text-primary">钉钉工作台</h2>
        <p className="mt-1 text-13 text-secondary">
          装上钉钉官方 CLI（dws）后，{brand.name} 能用<strong>你本人的钉钉身份</strong>替你干活：订会议室、请假/外出、查通讯录、发消息、写文档、待办、审批……
          都在这台电脑上跑，凭证不出本机。和「IM 机器人」互补：那边是钉钉里指挥 {brand.name}，这边是 {brand.name} 替你操作钉钉。
        </p>
      </div>

      <div className="rounded-xl border border-board bg-card-ivory p-5">
        <div className="flex items-center gap-2">
          <p className="text-14 font-medium text-primary">dws</p>
          <span className={cn('rounded-full px-2 py-0.5 text-11', chip.className)}>{chip.label}</span>
          {status.version && <span className="text-12 text-muted">{status.version}</span>}
        </div>

        {!status.installed ? (
          <>
            <p className="mt-2 text-12 text-secondary">
              还没装。安装走钉钉官方脚本（Apache-2.0 开源），装到本机用户目录，不进系统盘深处。
              国内网络建议用镜像源。
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              <button
                type="button"
                disabled={busy !== null}
                className={PRIMARY_BTN}
                onClick={() => void run('install', () => window.fundet.dwsInstall('gitee'))}
              >
                {busy === 'install' ? '安装中（可能要几分钟）…' : '安装（国内镜像）'}
              </button>
              <button
                type="button"
                disabled={busy !== null}
                className={SECONDARY_BTN}
                onClick={() => void run('install', () => window.fundet.dwsInstall('github'))}
              >
                用 GitHub 源安装
              </button>
              <button
                type="button"
                className="h-8 px-1 text-12 text-secondary underline decoration-board underline-offset-2 hover:text-primary"
                onClick={() => void window.fundet.openExternal(DWS_REPO_URL)}
              >
                官方仓库
              </button>
            </div>
          </>
        ) : !status.loggedIn ? (
          <>
            <p className="mt-2 text-12 text-secondary">
              已安装，还没登录。点下面按钮会弹出一个终端窗口并自动打开浏览器钉钉授权页；
              选企业 → 授权即可。如果提示企业未开启 CLI 访问，需要管理员在
              开放平台「CLI 访问管理」里开通（点右侧链接去找管理员）。
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              <button
                type="button"
                disabled={busy !== null}
                className={PRIMARY_BTN}
                onClick={() => void run('login', () => window.fundet.dwsLogin())}
              >
                打开登录
              </button>
              <button
                type="button"
                className="h-8 px-1 text-12 text-secondary underline decoration-board underline-offset-2 hover:text-primary"
                onClick={() => void window.fundet.openExternal(DINGTALK_OPEN_URL)}
              >
                开放平台·CLI 管理
              </button>
            </div>
          </>
        ) : (
          <>
            {identity && <p className="mt-2 text-12 text-secondary">已登录：{identity}</p>}
            <p className="mt-2 text-12 text-secondary">
              {status.skills.length > 0
                ? `已装配 ${status.skills.length} 个钉钉技能。直接在会话里说人话即可，例如「帮我订明天下午 3 点的会议室，拉上产品组」「请下周一一天年假」「查一下张三的手机号」。写操作（提交审批、发消息等）会先向你确认。`
                : '官方技能包还没装。装完后智能体才认识这些钉钉命令（会议/审批/通讯录/文档等 14 个技能）。'}
            </p>
            {status.skills.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {status.skills.map((name) => (
                  <span key={name} className="rounded-full bg-chip px-2 py-0.5 text-11 text-secondary">
                    {name.replace('dingtalk-', '')}
                  </span>
                ))}
              </div>
            )}
            <div className="mt-3 flex flex-wrap gap-2">
              <button
                type="button"
                disabled={busy !== null}
                className={status.skills.length > 0 ? SECONDARY_BTN : PRIMARY_BTN}
                onClick={() => void run('skills', () => window.fundet.dwsSkillSetup())}
              >
                {status.skills.length > 0 ? '补装 / 修复技能' : '一键装配官方技能'}
              </button>
            </div>
          </>
        )}

        {error && <p className="mt-3 text-12 text-error">{error}</p>}
        {notice && !error && <p className="mt-3 text-12 text-secondary">{notice}</p>}
        {output && (
          <pre className="mt-3 max-h-44 overflow-y-auto rounded-lg bg-hover-soft p-3 text-11 leading-relaxed text-secondary whitespace-pre-wrap">
            {output}
          </pre>
        )}
      </div>

      <p className="text-12 text-muted">
        安全：dws 以你的 OAuth 身份调用钉钉开放平台（全链路可审计）；{brand.name}
        侧执行 dws 命令照常走命令确认闸。退出登录可在终端跑 <code>dws auth logout</code>。
      </p>
    </div>
  );
}
