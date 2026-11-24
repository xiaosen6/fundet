/**
 * 办公工作台面板的企业微信段：wecom-cli 的三步引导（安装 → 扫码登录 → 官方技能）。
 * 状态与动作由 DwsPanel 统一持有（轮询、busy、错误/提示、安装进度）；本组件只渲染。
 */
import type { DwsActionResult, DwsStatusView } from '../../../../shared/fundet-api.js';
import { OFFICE_PROVIDER_META } from '../../../../shared/office-cli.js';
import { confirmDialog } from '../../components/ui/ConfirmDialog';
import { cn } from '../../lib/cn';

const SECONDARY_BTN = 'h-8 rounded-full border border-board px-3 text-12 text-primary disabled:opacity-40';
const PRIMARY_BTN = 'h-8 rounded-full bg-accent px-3 text-12 font-medium text-accent-fg disabled:opacity-40';
const LINK_BTN =
  'h-8 px-1 text-12 text-secondary underline decoration-board underline-offset-2 hover:text-primary';

/** 官方「智能机器人 Bot ID 和 Secret 获取方式」说明页（README 前置条件里给的链接） */
const WECOM_BOT_DOC_URL = 'https://open.work.weixin.qq.com/help2/pc/cat?doc_id=21677';

export type OfficeRunAction = (
  key: string,
  action: () => Promise<DwsActionResult>,
  opts?: { silent?: boolean },
) => Promise<void>;

interface WecomSetupProps {
  status: DwsStatusView;
  busy: string | null;
  chip: { label: string; className: string };
  /** 秒级时钟（二维码有效期倒计时用；父组件在等待扫码期间驱动） */
  nowTick: number;
  run: OfficeRunAction;
}

export function WecomSetup({ status, busy, chip, nowTick, run }: WecomSetupProps): React.JSX.Element {
  const login = status.login;
  const meta = OFFICE_PROVIDER_META.wecom;
  const startLogin = (): Promise<void> =>
    run('login', () => window.fundet.dwsLogin(), { silent: true });
  const waiting = login?.state === 'waiting';
  const remainSec = waiting ? Math.max(0, Math.ceil((login.expiresAt - nowTick) / 1000)) : 0;

  const logout = async (): Promise<DwsActionResult> => {
    const ok = await confirmDialog({
      title: '解除企业微信授权？',
      description:
        '删除本机 wecom-cli 的授权凭据（credentials.enc）。工作台与对话里的企业微信操作会不可用，重新扫码即可恢复；如果本机还有别的工具在用同一个 wecom-cli，也会一起失去授权。',
      confirmText: '解除授权',
      danger: true,
    });
    if (!ok) return { ok: true, output: '' };
    return window.fundet.dwsLogout();
  };

  return (
    <>
      <div className="flex items-center gap-2">
        <p className="text-14 font-medium text-primary">{meta.cli}</p>
        <span className={cn('rounded-full px-2 py-0.5 text-11', chip.className)}>{chip.label}</span>
        {status.version && <span className="text-12 text-muted">{status.version}</span>}
      </div>

      {!status.installed ? (
        <>
          <p className="mt-2 text-12 text-secondary">
            还没装。安装会从企业微信官方 npm 发行包里取原生程序（开放平台开源，MIT），按官方
            registry 登记的校验值核对后装到本机用户目录——不要求本机装有 Node.js。
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              disabled={busy !== null}
              className={PRIMARY_BTN}
              onClick={() => void run('install', () => window.fundet.dwsInstall('mirror'))}
            >
              {busy === 'install' ? '安装中（可能要一分钟）…' : '安装（国内镜像）'}
            </button>
            <button
              type="button"
              disabled={busy !== null}
              className={SECONDARY_BTN}
              onClick={() => void run('install', () => window.fundet.dwsInstall('npm'))}
            >
              用 npm 官方源安装
            </button>
            <button
              type="button"
              className={LINK_BTN}
              onClick={() => void window.fundet.openExternal(meta.repoUrl)}
            >
              官方仓库
            </button>
          </div>
        </>
      ) : !status.loggedIn ? (
        waiting && login.state === 'waiting' && login.qrDataUrl ? (
          <div className="mt-3 flex flex-wrap items-start gap-4">
            <img
              src={login.qrDataUrl}
              alt="企业微信扫码登录二维码"
              width={196}
              height={196}
              className="shrink-0 rounded-lg border border-board bg-white p-1"
            />
            <div className="min-w-[220px] flex-1">
              <p className="text-13 text-primary">请用企业微信扫一扫</p>
              <p className="mt-1 text-12 leading-relaxed text-secondary">
                扫完在手机上确认绑定。二维码 {remainSec} 秒内有效，授权完成后这里自动跳到下一步。
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                {login.pageUrl && (
                  <button
                    type="button"
                    disabled={busy !== null}
                    className={SECONDARY_BTN}
                    onClick={() => void window.fundet.openExternal(login.pageUrl ?? '')}
                  >
                    打开授权页
                  </button>
                )}
                <button
                  type="button"
                  disabled={busy !== null}
                  className={SECONDARY_BTN}
                  onClick={() => void startLogin()}
                >
                  {busy === 'login' ? '正在获取二维码…' : '重新获取二维码'}
                </button>
              </div>
            </div>
          </div>
        ) : (
          <>
            <p className="mt-2 text-12 leading-relaxed text-secondary">
              已安装，还没授权。点「扫码登录」会生成一个二维码显示在这里，用企业微信
              扫一扫、在手机上确认绑定即可；二维码 5 分钟内有效。
            </p>
            {login?.state === 'expired' && (
              <p className="mt-2 text-12 text-warning">二维码已过期，重新点「扫码登录」即可。</p>
            )}
            {login?.state === 'failed' && (
              <p className="mt-2 text-12 text-error">扫码登录没成功：{login.message}</p>
            )}
            <div className="mt-3 flex flex-wrap gap-2">
              <button type="button" disabled={busy !== null} className={PRIMARY_BTN} onClick={() => void startLogin()}>
                {busy === 'login' ? '正在获取二维码…' : '扫码登录'}
              </button>
              <button
                type="button"
                className={LINK_BTN}
                onClick={() => void window.fundet.openExternal(WECOM_BOT_DOC_URL)}
              >
                官方说明·机器人凭证
              </button>
            </div>
          </>
        )
      ) : (
        <>
          <p className="mt-2 text-12 text-secondary">
            已授权{status.botId ? ` · 机器人 ${status.botId}` : ''}。授权以你扫码绑定的企业微信机器人身份调用。
          </p>
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
              title="重装 wecom-cli 到最新版（默认国内镜像，通常十几秒到 1 分钟）"
              onClick={() =>
                void run('install', () => window.fundet.dwsInstall('mirror'))
              }
            >
              {busy === 'install' ? '重装中…' : '重装 / 升级'}
            </button>
            <button
              type="button"
              disabled={busy !== null}
              className="h-8 px-3 text-12 text-secondary underline decoration-board underline-offset-2 hover:text-error disabled:opacity-40"
              onClick={() => void run('logout', logout)}
            >
              {busy === 'logout' ? '解除中…' : '解除授权'}
            </button>
          </div>
        </>
      )}
    </>
  );
}
