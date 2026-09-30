# @fundet/browser-runtime

Neutral, in-process browser-automation runtime. Exposes a small,
stable contract (`BrowserControlRuntime`) that the `cindy_browser` MCP and the
desktop host drive — without depending on any upstream product API or surfacing
an upstream product name in product code.

## Layout

```
src/
  types.ts            Public contract: BrowserControlRuntime / Request / Result
  runtime.ts          createBrowserControlRuntime() — drives the vendored
                      in-process route dispatcher behind the contract
  unavailable.ts      A safe "not configured" runtime
  shim/               Hand-written replacements for the upstream plugin-sdk
                      surface the vendored core imports (see shim-spec)
    _local/           Faithful ports of small self-contained upstream helpers
                      (errors, ports, redact, tmp-dir, browser-cdp, text-utils)
  _generated/         GENERATED — DO NOT EDIT. Produced by sync.mjs:
    extension/        vendored browser core (extensions/browser/src/**)
    leaf/             vendored SSRF / security leaf closure (src/infra, src/security)
    packages/         vendored net-policy + normalization-core
    vendor/fs-safe/   vendored @openclaw/fs-safe dist (zero-dep, version-pinned)
  __tests__/          runtime + SSRF contract tests
upstream/
  MAINTAINING.md              维护者必读:三层架构 + 踩坑清单 + 上游同步 + 中性约束
  browser-runtime.lock.json   pinned commit + fs-safe version + content hash
  vendor-manifest.txt         the 133 core files
  shim-spec.md                exact named-export surface each shim must provide
  STATUS.md                   交付现状
  BUILD-PLAN.md               历史设计笔记
```

> **改这块代码前先读 `upstream/MAINTAINING.md`** —— 它记录了集成层(desktop host + cindy_browser MCP)以及所有踩过的坑与不变量。

## Updating from upstream

**`sync.mjs` is NOT in this repo** (it stayed behind in the upstream Cindy
workspace when this package was vendored). Re-syncing therefore means a manual
whole-directory diff against the pinned upstream commit recorded in
`upstream/browser-runtime.lock.json` (2 `LOCAL_PATCHES` are listed there and
must be re-applied), followed by:

```
pnpm --filter @fundet/browser-runtime compile   # surfaces any shim gaps
pnpm --filter @fundet/browser-runtime test      # contract + SSRF guard
```

`_generated/**` is regenerated wholesale upstream; never hand-edit it here. To
change behavior, edit the hand-written `src/shim/*` (and record any new
divergence in `upstream/browser-runtime.lock.json`).

## Security note

The SSRF/path-containment *decision logic* is vendored upstream code, not
re-implemented. `src/shim/ssrf-runtime.ts` only re-implements the thin fetch
*shell* that composes those vendored primitives (`isBlockedHostnameOrIp`,
`resolvePinnedHostnameWithPolicy`, `createPinnedDispatcher`). The SSRF contract
tests assert the real teeth still block cloud-metadata and private IPs, so a
future sync that weakens them fails CI.
