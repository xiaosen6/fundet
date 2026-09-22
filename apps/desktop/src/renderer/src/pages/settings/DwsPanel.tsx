/**
 * 钉钉工作台面板：dws 官方 CLI 的四步引导（安装 → 登录 → 技能装配 → 就绪）。
 * 状态真源在主进程 host/dws.ts；Agent 侧零改动——技能包落到用户技能根即被会话加载。
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { DwsStatusView, DwsWidgetsSnapshot } from '../../../../shared/fundet-api.js';
import { cn } from '../../lib/cn';
import { brand } from '../../../../shared/brand.ts';
import { confirmDialog } from '../../components/ui/ConfirmDialog';
import { DwsWidgets } from '../../components/dws/DwsWidgets';

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
  const [authUrl, setAuthUrl] = useState('');
  const [widgets, setWidgets] = useState<DwsWidgetsSnapshot | null>(null);
  const busyRef = useRef(false);
  // 安装进度：起始时间（时间型进度条；日志不展示，进度即反馈）
  const [installStartedAt, setInstallStartedAt] = useState<number | null>(null);
  const [nowTick, setNowTick] = useState(Date.now());

  // 安装期间：秒级计时（进度条推进）
  useEffect(() => {
    if (installStartedAt === null) return undefined;
    const t = setInterval(() => setNowTick(Date.now()), 1000);
    return () => clearInterval(t);
  }, [installStartedAt]);

  /** 时间型进度：0-60s 线性到 72%，60s-600s 缓爬到 95%（下载任务无精确百分比，
   *  完成时由 run() 的 finally 跳满；上限 10 分钟 = 超时） */
  const installProgress = (): number => {
    if (installStartedAt === null) return 0;
    const el = (nowTick - installStartedAt) / 1000;
    if (el <= 60) return 5 + (el / 60) * 67;
    if (el <= 600) return 72 + ((el - 60) / 540) * 23;
    return 95;
  };

  const refresh = useCallback(async (): Promise<void> => {
    setStatus(await window.fundet.dwsStatus());
  }, []);

  // 组件板：订阅主进程 push（面板常驻期间跟着刷新）
  useEffect(() => {
    void window.fundet.dwsWidgets().then(setWidgets);
    return window.fundet.onDwsWidgetsChanged(setWidgets);
  }, []);

  useEffect(() => {
    void refresh();
    // 登录在后台进程跑：面板开着就轮询，登完自动跳到下一状态
    const timer = setInterval(() => {
      if (!busyRef.current) void refresh();
    }, 5000);
    return () => clearInterval(timer);
  }, [refresh]);

  const run = async (key: string, action: () => Promise<{ ok: boolean; output: string; url?: string }>): Promise<void> => {
    setBusy(key);
    busyRef.current = true;
    setError('');
    setNotice('');
    if (key === 'install') {
      setInstallStartedAt(Date.now());
      setNowTick(Date.now());
    }
    try {
      const res = await action();
      setAuthUrl(res.url ?? '');
      if (res.ok) setNotice('完成。');
      else setError('操作没成功，请重试；反复失败可先「退出登录」再来。');
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      busyRef.current = false;
      setBusy(null);
      setInstallStartedAt(null);
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
              已安装，还没登录。点「开始登录」会在后台启动钉钉授权——浏览器应自动打开授权页；
              没弹的话点「打开授权页」。选企业 → 授权，完成后这里自动刷新。如果提示企业未开启
              CLI 访问，需要管理员在开放平台「CLI 访问管理」里开通（点右侧链接去找管理员）。
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              <button
                type="button"
                disabled={busy !== null}
                className={PRIMARY_BTN}
                onClick={() => void run('login', () => window.fundet.dwsLogin())}
              >
                {busy === 'login' ? '等待授权链接…' : '开始登录'}
              </button>
              {authUrl && (
                <button
                  type="button"
                  className={SECONDARY_BTN}
                  onClick={() => void window.fundet.openExternal(authUrl)}
                >
                  打开授权页
                </button>
              )}
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
            <div className="mt-3 flex flex-wrap gap-2">
              <button
                type="button"
                disabled={busy !== null}
                className={status.skills.length > 0 ? SECONDARY_BTN : PRIMARY_BTN}
                onClick={() => void run('skills', () => window.fundet.dwsSkillSetup())}
              >
                {status.skills.length > 0 ? '补装 / 修复技能' : '一键装配官方技能'}
              </button>
              <button
                type="button"
                disabled={busy !== null}
                className={SECONDARY_BTN}
                title="重装 dws CLI 到最新版（默认 Gitee 源，通常约 1 分钟，慢网络最长 10 分钟）"
                onClick={() => void run('install', async () => {
                  setNotice('正在下载安装 dws（Gitee 源，通常约 1 分钟，慢网络最长 10 分钟），期间请勿关闭应用…');
                  return window.fundet.dwsInstall('gitee');
                })}
              >
                {busy === 'install' ? '重装中…' : '重装 / 升级 dws'}
              </button>
              <button
                type="button"
                disabled={busy !== null}
                className="h-8 px-3 text-12 text-secondary underline decoration-board underline-offset-2 hover:text-error"
                onClick={() => void run('logout', async () => {
                  const ok = await confirmDialog({
                    title: '退出钉钉登录？',
                    description: '清除本机钉钉登录态（dws auth logout）。升级 dws 后组件报「刷新失败」时，退出后重新登录即可恢复。',
                    confirmText: '退出登录',
                    danger: true,
                  });
                  if (!ok) return { ok: true, output: '' };
                  return window.fundet.dwsLogout();
                })}
              >
                {busy === 'logout' ? '退出中…' : '退出登录'}
              </button>
            </div>
          </>
        )}

        {/* 安装进度（时间型进度条；日志不展示——进度即反馈） */}
        {busy === 'install' && installStartedAt !== null && (
          <div className="mt-3 flex flex-col gap-2 rounded-lg border border-board bg-card px-3.5 py-3">
            <div className="flex items-center justify-between text-11 text-muted">
              <span>正在下载安装…已进行 {Math.floor((nowTick - installStartedAt) / 60000)} 分 {Math.floor(((nowTick - installStartedAt) / 1000) % 60)} 秒（通常约 1 分钟）</span>
              <span className="tabular-nums">{Math.round(installProgress())}%</span>
            </div>
            <div className="h-1.5 overflow-hidden rounded-full bg-chip">
              <div
                data-install-progress
                className="h-full rounded-full bg-accent transition-[width] duration-1000 ease-linear"
                style={{ width: `${installProgress()}%` }}
              />
            </div>
          </div>
        )}

        {error && <p className="mt-3 text-12 text-error">{error}</p>}
        {notice && !error && <p className="mt-3 text-12 text-secondary">{notice}</p>}
      </div>

      <DwsWidgets
        snapshot={widgets}
        onRefresh={async () => {
          const s = await window.fundet.dwsWidgets(true);
          setWidgets(s);
          // 刷新结果摘要（用户要求：刷新完要看到刷新了什么）
          const now = Date.now();
          const overdue = s.todos.filter((t) => t.dueMs && t.dueMs < now).length;
          const time = `${String(new Date(s.fetchedAt).getHours()).padStart(2, '0')}:${String(new Date(s.fetchedAt).getMinutes()).padStart(2, '0')}`;
          const parts = [
            `日程 ${s.calendar.length} 条`,
            `待办 ${s.todos.length} 条${overdue > 0 ? `（${overdue} 逾期）` : ''}`,
            `待审批 ${s.approvals.length} 条`,
            `未读 ${s.unreadTotal} 条`,
          ];
          const errs = Object.entries(s.errors).map(([k]) => ({ calendar: '日程', todos: '待办', approvals: '审批', unread: '未读' }[k] ?? k));
          setNotice(`已刷新（${time}）：${parts.join(' · ')}${errs.length > 0 ? `；失败：${errs.join('/')}` : ''}`);
        }}
      />

      <p className="text-12 text-muted">
        安全：dws 以你的 OAuth 身份调用钉钉开放平台（全链路可审计）；{brand.name}
        侧执行 dws 命令照常走命令确认闸。升级 dws 后组件异常时：先「重装 / 升级
        dws」，仍失败再「退出登录」重新登录。
      </p>
    </div>
  );
}
