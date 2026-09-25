/**
 * 应用更新源选择（纯逻辑，node --test 直跑）：
 * 国内用户 GitHub 直连慢（200-500KB/s 且常断），优先 gh-proxy 中转查询+下载；
 * 中转不可用时回落 GitHub 原生 provider（= 旧行为，不会更差）。
 *
 * 注：曾评估 Gitee 镜像仓方案，实测免费版单附件上限 100MB（安装包 258MB
 * 传不上）——放弃；若未来上付费 Gitee/对象存储，把 proxyFeedUrl 换掉即可。
 */

/** 语义化 x.y.z(-pre) 比较：a>b 正、a<b 负、相等 0；非法输入按字符串序兜底 */
export function compareVersions(a: string, b: string): number {
  const parse = (v: string) =>
    v
      .trim()
      .replace(/^v/, '')
      .split(/[-.]/)
      .map((seg) => (/^\d+$/.test(seg) ? Number(seg) : seg));
  const pa = parse(a);
  const pb = parse(b);
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const x = pa[i];
    const y = pb[i];
    if (x === undefined || y === undefined) {
      // 一侧多出段：数字段（0.3 vs 0.3.1）→ 多者新；字符串段（预发布 0.3.1-beta）
      // → 按 semver 语义多者**旧**
      const extra = x ?? y;
      return typeof extra === 'number' ? (x === undefined ? -1 : 1) : x === undefined ? 1 : -1;
    }
    if (typeof x === 'number' && typeof y === 'number') {
      if (x !== y) return x - y > 0 ? 1 : -1;
    } else {
      const xs = String(x);
      const ys = String(y);
      if (xs !== ys) return xs > ys ? 1 : -1;
    }
  }
  return 0;
}

export const GH_PROXY_PREFIX = 'https://gh-proxy.com/';

/** gh-proxy 中转的 GitHub latest release API（查询用） */
export function proxyLatestApiUrl(owner: string, repo: string): string {
  return `${GH_PROXY_PREFIX}https://api.github.com/repos/${owner}/${repo}/releases/latest`;
}

/** gh-proxy 中转的某 tag 资产下载基址（electron-updater generic feed） */
export function proxyFeedUrl(owner: string, repo: string, tag: string): string {
  return `${GH_PROXY_PREFIX}https://github.com/${owner}/${repo}/releases/download/${tag}/`;
}

/** GitHub 原生 feed（回落用；与 app-update.yml 等价） */
export function githubFeedConfig(owner: string, repo: string): {
  provider: 'github';
  owner: string;
  repo: string;
} {
  return { provider: 'github', owner, repo };
}

/** 决策：代理查询结果 → 走代理下载 / 无更新 / 回落 GitHub */
export function decideUpdateAction(args: {
  currentVersion: string;
  proxyTag: string | null | undefined;
}): 'proxy-feed' | 'no-update' | 'fallback-github' {
  if (args.proxyTag === null || args.proxyTag === undefined) return 'fallback-github';
  const tag = args.proxyTag.replace(/^v/, '');
  if (compareVersions(tag, args.currentVersion) > 0) return 'proxy-feed';
  return 'no-update';
}
