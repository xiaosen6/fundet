/**
 * 钉钉组件板「未就绪」的两种脸色（纯函数，单测覆盖）。
 *
 * 2026-10-20 UI 走查：DwsWidgets / DynamicIsland 都对 `state !== 'ready'` 直接
 * `return null`——未装、未登录、登录过期、授权失效，四种完全不同的处境在界面上
 * 表现都一样：**整块凭空消失**。用户分不清「今天真没事」还是「钉钉断了」，
 * 工作台入口也跟着无处可点。
 *
 * 修法要区分两类：
 * - 从没配好（not-installed / not-logged-in）→ 安静给一张引导卡；
 * - 本来能用、突然断了（expired / auth-failed）→ 灵动岛必须亮警示，
 *   否则常驻状态簇悄悄少一截，最像「今天没事」。
 */
import type { DwsWidgetsSnapshot } from '../../../shared/fundet-api.ts';

/** 是否属于「本来能用、现在断了」——需要主动示警 */
export function dwsConnectionBroken(
  snapshot: Pick<DwsWidgetsSnapshot, 'state' | 'disabledKind'>,
): boolean {
  if (snapshot.state === 'ready') return false;
  return snapshot.disabledKind === 'expired' || snapshot.disabledKind === 'auth-failed';
}

/** 占位卡标题；unknown 类别（老版本主进程没给 disabledKind）按未登录处理，
 *  因为这是 profile 为空时的默认原因，且不会误报「已失效」 */
export function dwsDisabledTitle(
  snapshot: Pick<DwsWidgetsSnapshot, 'state' | 'disabledKind'>,
): string {
  if (dwsConnectionBroken(snapshot)) return '钉钉连接已失效';
  if (snapshot.disabledKind === 'not-installed') return '还没安装钉钉 CLI';
  return '钉钉还没登录';
}
