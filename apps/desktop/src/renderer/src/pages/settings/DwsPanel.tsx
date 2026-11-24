/**
 * 办公工作台面板：官方 CLI 的四步引导（安装 → 登录 → 技能装配 → 就绪）。
 * 办公平台可选企业微信（wecom-cli，缺省）或钉钉（dws），状态真源在主进程
 * （host/wecom-cli.ts / host/dws.ts）；Agent 侧零改动——技能包落到用户技能根即被会话加载。
 * 外壳（平台切换 / 总开关 / 进度 / 提示 / 组件板）两家共用，引导段按供应商渲染。
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { DwsActionResult, DwsStatusView, DwsWidgetsSnapshot } from '../../../../shared/fundet-api.js';
import {
  DEFAULT_OFFICE_PROVIDER,
  OFFICE_PROVIDER_META,
  officeSupportedWidgets,
  type OfficeCliProvider,
} from '../../../../shared/office-cli.js';
import { cn } from '../../lib/cn';
import { brand } from '../../../../shared/brand.ts';
import { confirmDialog } from '../../components/ui/ConfirmDialog';
import { DwsWidgets } from '../../components/dws/DwsWidgets';
import { WecomSetup, type OfficeRunAction } from './WecomSetup';

const SECONDARY_BTN = 'h-8 rounded-full border border-board px-3 text-12 text-primary disabled:opacity-40';
const PRIMARY_BTN = 'h-8 rounded-full bg-accent px-3 text-12 font-medium text-accent-fg disabled:opacity-40';

const DWS_REPO_URL = 'https://github.com/DingTalk-Real-AI/dingtalk-workspace-cli';
const DINGTALK_OPEN_URL = 'https://open-dev.dingtalk.com';

/** 平台切换的选项顺序：缺省项在前 */
const PROVIDER_ORDER: readonly OfficeCliProvider[] = ['wecom', 'dingtalk'];

/** 有 profile 但 dws 标了 expired：access token 过期，旧登录态服务端不再自动刷新。
 *  企微状态没有 profiles（主进程已归一为空数组）——恒 false，走扫码引导。 */
function loginExpired(s: DwsStatusView): boolean {
  if (!s.installed || !s.profiles || s.profiles.length === 0) return false;
  const current = s.profiles.find((p) => p.isCurrent) ?? s.profiles[0];
  return current?.status === 'expired';
}

function statusChip(s: DwsStatusView, provider: OfficeCliProvider): { label: string; className: string } {
  if (!s.installed) return { label: '未安装', className: 'bg-hover-soft text-muted' };
  if (loginExpired(s)) return { label: '登录已过期', className: 'bg-hover-soft text-secondary' };
  // 企业微信是扫码授权，文案对上动作
  if (!s.loggedIn) return { label: provider === 'wecom' ? '待扫码' : '待登录', className: 'bg-hover-soft text-secondary' };
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

  // 状态还没到时按缺省供应商渲染外壳（缺省企业微信）
  const provider: OfficeCliProvider = status?.provider ?? DEFAULT_OFFICE_PROVIDER;
  const meta = OFFICE_PROVIDER_META[provider];
  const isWecom = provider === 'wecom';

  // 安装期间：秒级计时（进度条推进）
  useEffect(() => {
    if (installStartedAt === null) return undefined;
    const t = setInterval(() => setNowTick(Date.now()), 1000);
    return () => clearInterval(t);
  }, [installStartedAt]);

  // 扫码等待期间：同一个秒级时钟驱动二维码有效期倒计时
  const waitingScan = status?.login?.state === 'waiting';
  useEffect(() => {
    if (!waitingScan) return undefined;
    const t = setInterval(() => setNowTick(Date.now()), 1000);
    return () => clearInterval(t);
  }, [waitingScan]);

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

  const run: OfficeRunAction = useCallback(
    async (key, action, opts = {}): Promise<void> => {
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
        if (!res.ok) {
          // 企业微信的失败输出是主进程给的一句原因（下载超时/校验不符…），直接给用户看
          setError(isWecom && res.output ? res.output : '操作没成功，请重试；反复失败可先「退出登录」再来。');
        } else if (!opts.silent) {
          // 企业微信的成功输出同样是一句短话；钉钉的输出是安装日志尾巴，维持「完成。」
          setNotice(isWecom && res.output && res.output.length <= 160 ? res.output : '完成。');
        }
        await refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        busyRef.current = false;
        setBusy(null);
        setInstallStartedAt(null);
      }
    },
    [refresh, isWecom],
  );

  const toggleEnabled = useCallback(async (): Promise<void> => {
    if (!status || busy !== null) return;
    setBusy('toggle');
    try {
      await window.fundet.dwsSetEnabled(!status.enabled);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  }, [status, busy, refresh]);

  const switchProvider = useCallback(
    async (next: OfficeCliProvider): Promise<void> => {
      if (!status || busy !== null || next === provider) return;
      setBusy('provider');
      setError('');
      setNotice('');
      setAuthUrl('');
      try {
        await window.fundet.officeCliSetProvider(next);
        // 新供应商的状态重新拉（主进程会同时刷新组件板）
        setStatus(null);
        await refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setBusy(null);
      }
    },
    [status, busy, provider, refresh],
  );

  if (!status) return <p className="text-13 text-muted">加载{meta.workspace}状态…</p>;

  const chip = statusChip(status, provider);
  const identity = (status.profiles ?? [])
    .map((p) => [p.org, p.user].filter(Boolean).join(' · ') || p.id)
    .filter(Boolean)
    .join('；');

  return (
    <div className="flex flex-col gap-[14px]">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h2 className="text-16 leading-[1.2] font-medium text-primary">{meta.workspace}</h2>
          <p className="mt-1 text-13 text-secondary">
            {isWecom ? (
              <>
                装上企业微信官方 CLI（wecom-cli）后，{brand.name} 可以用
                <strong>你扫码绑定的机器人身份</strong>查日程、待办、邮件、文档和通讯录，并在你确认后处理写操作。
                命令都在本机执行，凭据由官方 CLI 加密保存在本机。与「IM 机器人」的区别：那边是在企业微信里指挥{' '}
                {brand.name}，这边是 {brand.name} 替你操作企业微信。
              </>
            ) : (
              <>
                装上钉钉官方 CLI（dws）后，{brand.name} 可以用<strong>你本人的钉钉身份</strong>查日程、待办、审批和通讯录，并在你确认后处理写操作。命令都在本机执行，凭证不出本机。
                与「IM 机器人」的区别：那边是在钉钉里指挥 {brand.name}，这边是 {brand.name} 替你操作钉钉。
              </>
            )}
          </p>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={status.enabled}
          aria-label="办公集成总开关"
          disabled={busy !== null}
          onClick={() => void toggleEnabled()}
          className={cn(
            'relative h-6 w-11 shrink-0 rounded-full transition-colors disabled:opacity-40',
            status.enabled ? 'bg-accent' : 'bg-[var(--input-focus-border)]',
          )}
        >
          <span
            className={cn(
              'absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all',
              status.enabled ? 'left-[22px]' : 'left-0.5',
            )}
          />
        </button>
      </div>

      {/* 平台切换：只换当前用哪家 CLI；另一家的安装、登录、技能都留着，切回即恢复 */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-12 text-secondary">办公平台</span>
        <div
          role="radiogroup"
          aria-label="办公平台"
          className="inline-flex rounded-full border border-board bg-chip p-0.5"
        >
          {PROVIDER_ORDER.map((id) => {
            const active = id === provider;
            return (
              <button
                key={id}
                type="button"
                role="radio"
                aria-checked={active}
                disabled={busy !== null}
                onClick={() => void switchProvider(id)}
                className={cn(
                  'h-7 rounded-full px-3 text-12 transition-colors disabled:opacity-40',
                  active ? 'bg-card font-medium text-primary shadow-sm' : 'text-secondary hover:text-primary',
                )}
              >
                {OFFICE_PROVIDER_META[id].label}
              </button>
            );
          })}
        </div>
        <span className="text-11 text-muted">两家可以都装；切换后新对话按所选平台执行命令</span>
      </div>
      {!status.enabled && (
        <p className="rounded-xl border border-board bg-card-ivory px-4 py-3 text-12 text-secondary">
          {meta.label}集成已关闭：工作台与灵动岛已隐藏，新对话不再注入{meta.label}命令速查（已登录的凭证与技能不受影响，重新打开即恢复）。
        </p>
      )}

      <div className="rounded-xl border border-board bg-card-ivory p-5">
        {isWecom ? (
          <WecomSetup status={status} busy={busy} chip={chip} nowTick={nowTick} run={run} />
        ) : (
          <>
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
                  {loginExpired(status)
                    ? '登录已过期：钉钉旧登录态已无法自动刷新，重新授权一次即可（工作台四个卡片也会同步提示）。点「开始登录」会在后台启动钉钉授权——浏览器应自动打开授权页；'
                    : '已安装，还没登录。点「开始登录」会在后台启动钉钉授权——浏览器应自动打开授权页；'}
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
          </>
        )}

        {/* 安装进度（时间型进度条；日志不展示——进度即反馈） */}
        {busy === 'install' && installStartedAt !== null && (
          <div className="mt-3 flex flex-col gap-2 rounded-lg border border-board bg-card px-3.5 py-3">
            <div className="flex items-center justify-between text-11 text-muted">
              <span>
                正在下载安装…已进行 {Math.floor((nowTick - installStartedAt) / 60000)} 分{' '}
                {Math.floor(((nowTick - installStartedAt) / 1000) % 60)} 秒
                {isWecom ? '（通常十几秒到 1 分钟）' : '（通常约 1 分钟）'}
              </span>
              <span className="tabular-nums">{Math.round(installProgress(installStartedAt, nowTick))}%</span>
            </div>
            <div className="h-1.5 overflow-hidden rounded-full bg-chip">
              <div
                data-install-progress
                className="h-full rounded-full bg-accent transition-[width] duration-1000 ease-linear"
                style={{ width: `${installProgress(installStartedAt, nowTick)}%` }}
              />
            </div>
          </div>
        )}

        {error && <p className="mt-3 text-12 text-error">{error}</p>}
        {notice && !error && <p className="mt-3 text-12 text-secondary">{notice}</p>}
      </div>

      {/* 未就绪时整块不挂：这里是工作台本体，上面四步引导已经把「为什么」说全了，
          再摆一张「去工作台」占位卡纯属自指 */}
      {widgets?.state === 'ready' && (
      <DwsWidgets
        snapshot={widgets}
        onRefresh={async () => {
          const s = await window.fundet.dwsWidgets(true);
          setWidgets(s);
          // 刷新结果摘要（用户要求：刷新完要看到刷新了什么）
          const now = Date.now();
          const overdue = s.todos.filter((t) => t.dueMs && t.dueMs < now).length;
          const time = `${String(new Date(s.fetchedAt).getHours()).padStart(2, '0')}:${String(new Date(s.fetchedAt).getMinutes()).padStart(2, '0')}`;
          const errs = Object.entries(s.errors).map(([k]) => ({ calendar: '日程', todos: '待办', approvals: '审批', unread: '未读' }[k] ?? k));
          // 企业微信没有审批 / 未读卡：摘要里也不报这两项
          const supported = officeSupportedWidgets(s.provider ?? 'dingtalk');
          const parts = [
            `日程 ${s.calendar.length} 条`,
            `待办 ${s.todos.length} 条${overdue > 0 ? `（${overdue} 逾期）` : ''}`,
            ...(supported.includes('approvals') ? [`待审批 ${s.approvals.length} 条`] : []),
            ...(supported.includes('unread') ? [`未读 ${s.unreadTotal} 条`] : []),
          ];
          setNotice(`已刷新（${time}）：${parts.join(' · ')}${errs.length > 0 ? `；失败：${errs.join('/')}` : ''}`);
        }}
      />
      )}

      {isWecom ? (
        <p className="text-12 text-muted">
          安全：wecom-cli 以你扫码绑定的机器人身份调用企业微信开放平台，凭据由官方 CLI 加密保存在本机。
          注意：官方预编译版会把调用方程序的进程名及调用链（例如 {brand.name}、命令解释器）回传企业微信云端
          （见官方仓库「数据收集说明」），预编译版无法关闭。{brand.name} 侧执行 wecom-cli 命令照常走命令确认闸。
        </p>
      ) : (
        <p className="text-12 text-muted">
          安全：dws 以你的 OAuth 身份调用钉钉开放平台（全链路可审计）；{brand.name}
          侧执行 dws 命令照常走命令确认闸。升级 dws 后组件异常时：先「重装 / 升级
          dws」，仍失败再「退出登录」重新登录。
        </p>
      )}
    </div>
  );
}

/**
 * 时间型进度：0-60s 线性到 72%，60s-600s 缓爬到 95%（下载任务无精确百分比，
 * 完成时由 run() 的 finally 跳满；上限 10 分钟 = 超时）
 */
function installProgress(installStartedAt: number, nowTick: number): number {
  const el = (nowTick - installStartedAt) / 1000;
  if (el <= 60) return 5 + (el / 60) * 67;
  if (el <= 600) return 72 + ((el - 60) / 540) * 23;
  return 95;
}
