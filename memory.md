# Fundet 项目记忆（memory.md）

> 最后更新：2026-09-03。给任何接手的人/AI：先读本文，再读 `README.md`（用户向）。`cindy/` 目录是参考项目源码快照，**只读对照，禁止修改、禁止 fork 进本仓**（GitLab 仓不含 `cindy/`，完整只读克隆在 `D:\AI\Fundet\cindy`）。
>
> 仓库路径：源码已推内网 GitLab `git@172.16.56.11:fundet-harness/fundet-buddy.git`（2026-09-03 起）。**活跃分支 `main`；`master` 是收编进来的落后占位历史，不要在上面开发**。初始开发机工作副本 `D:\AI\Fundet`。
>
> **品牌**：本产品是 **Fundet**（山东未来互联科技的本地 AI 智能体）。Logo 为红球经纬线球体（2026-09-10 全套换新：白卡圆角 tile 版做 app icon——`resources/fundet/` ico/png/svg + renderer favicon；抠底透明球做 UI 内 BrandMark。`logo-raw.png` 是原始图；再生用 PIL，ICO 是多尺寸标准容器，UI 标用「左/上弧边界点最小二乘圆拟合 + 圆掩膜」从白卡里抠球——别用颜色阈值硬分，瓷砖右下粉色渐变和球体分不开）。构建系统（`shared/brand.ts` + `BRAND` 环境变量）源自一个支持多品牌的底座，里面保留着一个由另一团队维护的变体分支（`longma`）——**本仓一切开发/构建/发版都是 Fundet，默认即 Fundet，不要动 brand.ts 里的变体分支，不要用它出包**。
>
> 历史命名：仓库/包名大量使用 `fundet`（`@fundet/agent-core`、`window.fundet`、`FUNDET_*` IPC、`fundet-file://`）——这些就是本项目的主命名，保持即可。

---

## 0. 30 秒上手

```powershell
# 必须在 Windows PowerShell，不要用 WSL 弹 Electron 窗口
cd D:\AI\Fundet
pnpm install
pnpm dev:win
```

打包 Windows：`pnpm dist:win` → `apps/desktop/dist/Fundet-Setup-<version>-x64.exe`。

WSL 里可以改代码、跑 `pnpm --filter fundet-desktop test` / `typecheck`；**不要**在 WSL 里 `pnpm dist` / `electron-vite build`（缺 linux rollup binding，pnpm store 在 Windows 盘）。

---

## 1. 产品是什么

**Fundet** = 本地优先桌面 Agent：聊天/Agent + 技能 + BYOK + 浏览器自动化 + 电脑操作 + IM 机器人。模型请求走用户自己的 Key，不经过任何厂商云。

- Electron 37 + electron-vite + React 19 + Tailwind 4。
- Agent 底座只有 **Pi v0.83.0**（`earendil-works/pi`，bun 单二进制，`--mode rpc`）。
- UI 视觉对齐 Cindy **CINDY skin**（米色浅色 + CINDY Dark），品牌是红球经纬线 Logo（山东未来互联科技 logo 截取），文案中文。自我介绍：**「你是 Fundet，一个运行在本地的 AI 助手」**。
- **不要做成 Cindy fork。** 不搬：账号/OAuth、Ghost 插件、Office、设备互联、IM 云、语音、定时任务、Claude Code/Codex harness、SkillHub 市场。

已对齐的产品边界：

| 决策 | 结论 |
| --- | --- |
| 账号 | 无。纯本地 + BYOK |
| 预装技能 | **无**（`brand.bundledSkills=false`；`resources/bundled-skills/` 已从本仓删除，`ensureBundledSkills` 对缺目录静默跳过） |
| 窗口 | Windows `frame: false` + 自绘 `WindowControls`；mac hidden titleBar |
| 设置 Tab | 通用 / 模型供应商 / 自动操作 / 用量历史 / 搜索 / IM 机器人 / MCP 服务器 / 技能 |
| MCP 用户面 | 设置 → MCP 服务器：stdio 命令（cross-spawn 解 Windows .cmd shim）/ streamable-http（非 loopback 强制 https），开关默认开、可停用；新会话注入（`mcp__<名称>__<工具>`），审批跟会话权限档 |
| 复制 | 必须走 Electron `clipboard` IPC（权限处理器拒绝 `navigator.clipboard`） |
| 分享 | 截当前回合卡片为图片进剪贴板 |
| Mac 包 | 未签名（`identity: null`），macOS 新版对 quarantine 包报「文件已损坏」，用户须 `sudo xattr -cr /Applications/Fundet.app`；根治要 Apple 开发者证书 |
| 渲染进程 | `sandbox: true`，preload 必须 CJS 产物（见 §5 坑表） |
| 浏览器自动化 | 内置能力开关（默认关）；托管 Chrome 持久 profile「Fundet」 |
| 视觉发图 | 预设标注 + 编辑对话框「视觉」勾选，只信库值，无推断 |
| 电脑操作 | 内置能力开关（默认关）；cua-driver 外部二进制，遥测已关 |
| 约束 | 保持 `@fundet/*` 与 `window.fundet`；Windows 用 PowerShell 跑 Electron |

---

## 2. 硬约束（改代码前必守）

1. **不修改 cindy/ 参考仓。** 只读对照实现；值得搬的交互用手写移植。
2. **Windows Electron 用 PowerShell**（`pnpm dev:win` / `pnpm dist:win`）。WSLg 窗口经常只剩任务栏蓝点。
3. 权限 fail-closed。`setPermissionRequestHandler` 只放行 clipboard。
4. 链接不许顶替主窗口：`main/index.ts` 的 `will-navigate` + `setWindowOpenHandler` 只放行应用自身页面，http(s) 一律 `shell.openExternal`。
5. UI 文案（渲染层/main）**禁止硬编码产品名**——统一走 `shared/brand.ts` 的 `brand.name`（历史上曾漏网 17 个文件才清干净）。
6. 渲染进程不要 `node:path`；共享逻辑放 `apps/desktop/src/shared/`（无 Node API）。
7. 注释短、事实性；不要用注释叙述实现过程。
8. **改完产品事实立刻改 `memory.md`**。本文是下一轮 AI 的真源，过期比缺文档更糟。
9. IM 机器人只做**个人凭证**（飞书/钉钉/企微填开放平台 Key，微信 iLink 扫码）。入站接到现有 Pi 会话，不要拷 Cindy orchestrator 整棵。
10. 新增任何 `dist:*` 构建脚本必须配对 `predist:*` 钩子跑 `tools/pack-browser-deps.mjs`（漏配曾导致安装包缺 103 个运行时包、启动即崩）。
11. 内部路径常量（`MANAGED_PROFILE='Fundet'`、托管浏览器 `browser/Fundet/`、IM 工作目录 `~/Fundet-IM`、上传目录 `.fundet-uploads`）**改动会丢用户登录态/会话目录**，动前必想。

---

## 3. 仓库地图

```
Fundet/
├── package.json                 # 根脚本：dev:win / dist:win / typecheck / test:unit
├── pnpm-workspace.yaml
├── NOTICE                       # 开源归属（Cindy Apache-2.0 / openclaw MIT / Tencent MIT）
├── README.md                    # 用户向
├── memory.md                    # 本文件
├── cindy/                       # 参考项目只读快照（无 .git）
├── packages/
│   ├── agent-core/              # @fundet/agent-core：PiAgent + Maker + Session
│   ├── browser-runtime/         # @fundet/browser-runtime：vendored 浏览器内核（tsc 编译到 dist，external 运行时依赖）
│   ├── browser-mcp/             # @fundet/browser-mcp：浏览器 MCP 门面（bundle 进主进程）
│   └── shared/                  # 纯函数（agent-task / session-title / …）
├── apps/
│   ├── desktop/                 # Electron 主工程（产品几乎全在这）
│   │   ├── electron-builder.yml # 打包主配置（productName Fundet、发布 xiaosen6/fundet）
│   │   ├── src/main|preload|renderer|shared/
│   │   ├── resources/fundet/    # 红球 logo 全套（ico/png/svg；icon.ico=PNG-in-ICO 容器）
│   │   └── dist/                # 安装包产物
│   ├── pi-bin/<plat>-<arch>/    # Pi 运行时（gitignore；缺 theme 则 RPC 即崩）
│   ├── ripgrep-bin/             # rg 二进制（gitignore，update.mjs 现下）
│   └── cua-driver-bin/          # cua-driver（gitignore，update.mjs 现下）
└── tools/                       # pi/ripgrep/cua-driver 下载器、pack-browser-deps、with-brand
```

数据流：`ChatPage → window.fundet.sendMessage → IPC session:send → PiAgent session.send → 子进程 pi --mode rpc → translator → AgentEvent 广播 + SQLite messages → sessionStore 分发`。

### 关键文件

| 任务 | 文件 |
| --- | --- |
| 发消息 / 附件 | `apps/desktop/src/main/ipc/register.ts`、`sessionStore.ts`、`ChatPage.tsx` |
| 拖文件 / 回形针 | `ChatInput.tsx`、`lib/file-drop.ts`、`main/fs-local.ts` |
| Canvas 预览 | `lib/artifacts.ts`、`CanvasPane.tsx`、`shared/file-kind.ts`、`main/file-protocol.ts` |
| IPC 契约 | `src/shared/fundet-api.ts`、`preload/index.ts`、`main/ipc/channels.ts`（新 IPC 四处一起改） |
| Pi 装配 | `main/host/pi-host.ts`、`packages/agent-core/src/agents/pi/index.ts` |
| 系统提示 | `main/host/system-prompt.md`（原文即 Fundet 终稿；pi-host 里的 replace 是底座机制，对本仓为 no-op） |
| 浏览器自动化 | `main/browser/{host,mcp-http,real-profile}.ts`、`packages/browser-runtime|mcp` |
| 电脑操作 | `main/computer/driver.ts`（cua-driver 解析 + 遥测关闭） |
| 搜索 | `main/search/{tool,mcp-server,engine}.ts` |
| 主题 token | `renderer/src/styles/globals.css`（CINDY token，不自创色板） |
| BYOK key | `main/host/secrets.ts`（Windows 走系统凭据） |

---

## 3.5 版本历史

| 版本 | 日期 | 要点 |
| --- | --- | --- |
| 0.2.11 | 09-07 | **同步 Cindy 上游**（#3751 登录态浏览器竞态+AppBound 检测、#3742 RPC 帧诊断、#3706 完全放行对齐原生、#3738 智谱目录数据）+ 发版流程切 GitLab 单线（§6）；**安装包已发 GitLab Release**（fundet 包 0.2.11，静默装冒烟过） |
| 0.2.10 | 09-03 | **修复视觉发图 1210**（pi 0.84.4 + 已知模型补全表 + 空text块占位）+ 用户长消息折叠 + markdown 对齐 Cindy（数学/CJK/mermaid）+ update.mjs pin 模式 |
| 0.2.9 | 08-31 | 界面硬编码品牌名全清（17 文件 → brand.name）；cua-driver 下载自动回退 |
| 0.2.8 | 08-31 | **修复 0.2.7 安装包启动崩溃 + 旧图标**（见 §5 发版坑） |
| 0.2.7 | 08-30 | **首次发版**。功能即全量：浏览器/电脑自动化、用量、IM、登录态拷贝 |

> 本仓 git 从 0.2.9 代码起步（独立 git，不继承底座历史）；更早的功能演进不在版本史里，见 §4 功能清单。

---

## 4. 功能清单（已完成）

### 4.1 核心
- Pi 会话：流式、工具调用、权限三档（ask/自动/完全放行，审批超时 10min deny）、草稿会话（空草稿不进侧栏）。
- 记忆：产品面固定关闭（`memoryEnabled: false`）；`memory_search`/`memory_write` 未暴露给模型。
- MCP 桥：主进程注入 search/browser/computer 三个内置 MCP + 用户自配 MCP 服务器（`mcp-bridge.ts`，stdio 经 StdioMcpHttpProxy、http 描述符直通）；用户面在设置 → MCP 服务器（§1 边界表），带连通性状态点（设置页对启用中的 server 跑一次 initialize 握手，绿=通/红=失败，可手动重测；stdio 探测自起自杀不占会话）。
- 技能启停：设置 → 技能每项有开关；停用 = 目录从 `skills/` 同级挪进 `skills.disabled/`（pi 只扫 `skills/`，挪出即对新会话隐形，scope 天然保持），卸载对停用目录同样有效。新增语义色 `--color-success`（绿，状态点用）。
- 死会话容错：401/欠费后 set-model 等只落库，下次发送 lazy-create。

### 4.2 UI（Cindy 风格）
- 两栏 + Canvas 右侧 380px；无边框窗口 + WindowControls；Win 关窗=最小化到托盘（IM 保持在线），托盘菜单「打开 Fundet / 退出」。
- 上下文用量环在输入卡下方右侧 + 会话短 id（前 8 位）。
- Canvas 开关钉窗口右上（fixed）；贴附件不强制打开 Canvas。
- 会话重命名（侧栏 hover 铅笔/双击）、侧栏宽度拖拽（200-400px，localStorage 持久化）。
- 用量：首页折叠仪表盘（20 周热力图 + 30 天堆叠柱）+ 设置「用量历史」页（概览 5 格/热力图/按模型表含缓存命中率）。
- 本地图片预览 `fundet-file://` 协议；复制走 clipboard IPC；分享=回合卡片截图。

### 4.3 附件与文档
- 拖/贴/回形针多选；工作目录外文件拷到 `{workDir}/.fundet-uploads/`；粘贴图片魔数嗅探 mime（QQ「原图」=PNG 套 .jpeg 的坑）。
- PDF/Word 拖入自动提取正文随消息发模型（unpdf/mammoth，200k 字/30MB 上限，失败不阻断）。

### 4.4 浏览器自动化
- 设置→自动操作开关（默认关）。新会话注入 MCP `browser`（单工具 23 action + list_tools），审批跟会话档。
- vendored 内核（packages/browser-runtime，tsc→dist external，**永不过 rollup**）；playwright-core connectOverCDP 连托管 Chrome：持久 profile「Fundet」、CDP 18800、默认有头、复用系统 Chrome。
- **使用我的浏览器登录态**：探测系统 Chrome/Edge/Brave → SQLite online-backup 一致性拷 Cookie/密码 → 改写 Local State → staging 原子发布。**源浏览器运行时会锁库 → PROFILE_LOCKED 中文提示=设计内**（用户须完全退出系统浏览器，含托盘后台进程）。拷贝/清除前强制停托管 runtime。
- SSRF 拦截：localhost/RFC1918/metadata 全拦，只豁免代理 fake-IP 段。

### 4.5 电脑操作（Computer Use）
- cua-driver（Rust 驱动，stdio MCP 子进程，57 工具）。开启开关时自动 `telemetry disable`（**只能放在开关 IPC 里 fire-and-forget**，放进会话装配路径会与 mcp 子进程争全局锁挂死）。
- 分发：`tools/cua-driver/update.mjs`（**带从新到旧自动回退**——上游删过 release 留 tag，纯 tag 选版会 404）；打包经 extraResources，伴生 dll/uia 必须同目录。

### 4.6 搜索
- 设置→搜索：Tavily/Brave/博查/智谱 Key；新会话挂 `mcp__search__web_search`（MCP serverInfo 名 `fundet-search`）。
- GEO 是内置技能（封装 geo-optimizer-skill CLI，CLI 自抓站），≠通用搜索；不要为 GEO 再做抓取工具。

### 4.7 IM 个人机器人
- 微信 iLink 扫码 / 企微 / 飞书 / 钉钉，个人凭证，凭证只存本机。
- 入站去重（渠道消息 id，TTL 10min）+ 单回合 10min 兜底超时；`permissionMode: auto`，工作目录 `userData/im-workspace`。**电脑必须开着应用**。群聊需 @。

### 4.8 视觉模型
- 只信库值：预设标注 + 编辑对话框「视觉」勾选（save/回填/扫描三处都要透传 input/maxTokens）。改完新会话即生效。
- glm-4.5/5.x 无视觉（bigmodel 1210）；`friendly-error.ts` 把供应商错误转中文指引。

---

## 5. 环境与坑（重点背熟）

**发版链路**（每个坑都真踩过）：

| 坑 | 规矩 |
| --- | --- |
| `dist:*` 脚本缺 pre 钩子 → 安装包缺 103 包启动崩，**且 electron-builder 对缺失 extraResources 只警告不报错，CI 全绿照样是坏包** | 新 dist 脚本必配 predist 钩子；**发版后必须人工静默安装冒烟**（`/S /D=临时目录` → 启动 → 杀进程） |
| tag 早于资产提交 → CI 产物用旧图标/旧代码 | 发版前 `git merge-base --is-ancestor <commit> <tag>` 验证 |
| icon.ico 非法（sharp 不能写 ICO） | 现用 PNG-in-ICO 标准容器（resources/fundet/icon.ico），别用 sharp 直接生成 .ico |
| 上游删 release 留 tag → 下载 404 | update.mjs 已带自动回退；「昨天能下今天 404」先对比 releases vs tags |
| 删远端 tag 重推 → published Release 转 draft，资产对外不可见 | 重推后必查 `gh api repos/xiaosen6/fundet/releases --jq '.[]|.tag_name,.draft'`，draft 则 `gh release edit <tag> --draft=false` |
| EBUSY：electron-builder 拷 fresh 解包的 cua-driver 被 Defender 锁 | win job 有 3 次重试 + hash 预热步；tag 必须含该修复 commit（重跑复用旧 tag 不带修复） |
| Bash 管道接 tail 会吃掉退出码 | 判构建成败看日志尾部内容，不看 exit code |

**架构级**：

| 坑 | 处理 |
| --- | --- |
| rollup 渲染 vendored browser-runtime 整段丢代码 → 主进程僵死 | runtime tsc 编译到 dist 作 external，vendored 源码永不过 rollup |
| electron-builder + pnpm collector 遇 express 树死循环 | MCP SDK 等运行时依赖不进 desktop dependencies；`tools/pack-browser-deps.mjs` 打平闭包 → extraResources 到 resources/node_modules |
| sharp 的 @img 平台二进制 pnpm 不建符号链接 | pack 脚本从 .pnpm store 扫描 |
| pi 无 AVX2 启动崩（code 3221225501） | bun 硬要求；启动预检 + 中文弹窗。无解，除非 pi 出 baseline 构建 |
| electron-updater ESM 炸 | CJS 包，`import pkg from 'electron-updater'` 再解构；**发版前冒烟打包产物** |
| 沙箱渲染进程不支持 ESM preload | preload 必须 CJS（electron.vite 显式 format cjs） |
| Windows bash 不可用 | pi 的 bash 工具只认 Git Bash；system-prompt 引导用户装 Git |
| node --test 直跑链 import shared 模块用 `.ts` 后缀 | main/im、main/search、shared 直跑；vite bundle 链用 `.js` |
| 单引号串里 `${...}` 是死文本 | 模板串用反引号；JSX 文本插值用花括号表达式 |
| WSL Electron 窗口蓝点 / rollup 缺 linux binding | 开发构建打包全在 Windows PowerShell |
| mac 未签名 | electron-updater 只检测不安装；用户 xattr -cr 或跳 Release 下载 |
| Windows 图标缓存 | 用户报「图标还是旧的」先答 `ie4uinit.exe -show` + 重启 explorer |

环境：pi pin 0.84.4（版本只写在 `tools/pi/latest.json`，升级只改这一个文件；0.83.0 曾因智谱新模型不识别导致视觉发图 1210，见 §5.5）；userData `%APPDATA%\Fundet`；GitHub 资产下载优先 gh-proxy.com 镜像（直连常断，实测 ~9MB/s）。

### 5.5 v0.2.10 发版实录：视觉发图 1210 三层根因（2026-09-03，commit 0d98b3b/4a434c9/0f9d804/2524b49）

**客诉「发图片报错」的完整排查记录，处理同类问题照此方法论**：

1. **pi 0.83.0 太旧**：智谱 8 月底新模型（glm-5.3-flash 等）不在其内置目录，zai 兼容层不完整。已升 **pi 0.84.4**（tools/pi/latest.json，与 Cindy 项目所用版本一致，sha256 校验）。**升级方式：`node tools/pi/update.mjs --platform=<plat>`（不传版本，自动读 latest.json 的 pin）——pi 升级只需改 latest.json 一个文件，workflow 已去硬编码**。
2. **空 text 块 1210**：BYOM 裸模型定义缺 reasoning/thinkingLevelMap 时，pi 对 open.bigmodel.cn（zai 兼容格式）不发 thinking 参数；且纯图片消息被 pi 编成 [{"type":"text","text":""}, image]——**智谱严格校验，拒绝空字符串 text 块**。修复：①pi-host 按 id 从 `main/host/pi-model-catalog.ts`（pi 0.84.4 智谱 9 模型字段：reasoning/thinkingLevelMap/input/contextWindow/maxTokens）补全缺失字段，用户显式配置优先；②PiAgent send/steer 对纯图片消息的空 promptText 补 '.' 占位（agent-core send+steer 两处）。
3. **zip 解包丢 theme**（0.2.10 首发包全员启动崩的元凶）：pi v0.84+ 的 Windows zip 换了打包结构，update.mjs 原来用 bsdtar 从 **stdin 流式**解 zip 会静默丢 theme/ 目录 → 包内 pi 缺 theme，RPC 启动即崩（退出码 1）。extractArchive 已改：.zip 走 PowerShell Expand-Archive（seek 完整读取），.tar.gz 维持 stdin+tar。

**诊断方法论（比逆向二进制快得多，优先使用）**：
- 本地回显服务器：把 provider baseUrl 指向 `http://127.0.0.1:9876`（node http 服务器 dump 请求体），新会话发消息即可拿到 pi 发出的完整请求；
- 解 API key：写 Electron 脚本 `app.setName('Fundet'); app.setPath('userData', %APPDATA%/Fundet)` 后 `safeStorage.decryptString` 读 `keys/<providerId>.bin`（密钥与 userData 绑定，路径必须一致）；
- 拿到 key 后直接 fetch 智谱做**请求矩阵**（纯文本/图片/图片+tools/各字段变体逐个排除）——本次用 T1~T21 矩阵定位到「空 text 块」精确根因；
- 注意 baseUrl 指向回显地址时 pi 的 compat 判定会变（127.0.0.1 ≠ zai 端点 → developer 角色/max_completion_tokens 等 openai 形态），对照真实请求时要修正这个假象。

**真机验证清单（模型/网络类改动必做）**：新开对话 → 选目标模型 → 贴图发送 → 确认模型描述图片内容 → 再发一条纯文本确认多轮正常。

---

## 6. 发版流程（GitLab 单线，2026-09-07 起）

1. 升 `apps/desktop/package.json` version；memory.md §3.5 补版本行；提交（确认 logo 等资产已在 tag 里）。
2. `git tag vX.Y.Z && git push origin main vX.Y.Z`（源码 + tag 同步 GitLab）。
3. **PowerShell** `pnpm dist:win` 本地出包 → `apps/desktop/dist/Fundet-Setup-<version>-x64.exe`（pre 钩子自动跑 pack-browser-deps；**extraResources 的 cua-driver 缺失只警告不报错**，出包前确认 `apps/cua-driver-bin/win32-x64/VERSION` 存在，当前 0.22.1）。**本地出包同样撞 §5 的 Defender EBUSY 坑（cua-driver/pi/rg 被 signtool 拷贝时锁住）**：先对三个 bin 目录做 Get-FileHash 预热，EBUSY 就整体重跑 `pnpm dist:win`——实测预热后第 3 次过，别只修单个文件。
4. 静默安装冒烟：`Fundet-Setup-<version>-x64.exe /S /D=<临时目录>` → 启动 → 杀进程 → 清理临时目录。
5. 安装包（连同 `latest.yml`、`.blockmap`）挂 GitLab Release。已验证的 API 模式（2026-09-07，本 GitLab 版本资产链接用 `filepath` 属性，`direct_asset_path` 会报 invalid format）：①`PUT /api/v4/projects/272/packages/generic/fundet/<版本>/<文件名>`（curl --upload-file，PRIVATE-TOKEN 头）；②`POST /api/v4/projects/272/releases`，`assets.links[].url` 指向包文件。Token 用项目/个人 access token（scope=api），由发版人自持，**不进仓**。
6. 发版前 `git merge-base --is-ancestor <commit> <tag>` 确认资产 commit 已进 tag。

> **应用内更新待决**：electron-updater 仍读 GitHub xiaosen6/fundet 的 latest.yml——GitLab 单线后新版本不会出现在 GitHub，旧装用户发现不了更新。要让更新走 GitLab 需改 `shared/brand.ts` 的 updater 段为 gitlab provider（electron-updater 原生支持）并真机验证，属产品决策。
> mac 包暂无产出路径（无 CI mac job、本地无 mac 机），需要时再定。

---

## 7. 待办 / 已知债

- 真 Key 全链路冒烟。
- Mac 公证（需 Apple 开发者证书 + CI notarize）。
- Cindy 上游可跟进项：browser-runtime 网络守卫竞态修复、MCP 懒加载（**截至 2026-09-03 上游均未落地**，vendor lock 仍 b972feb3 与本仓一致）。「yield cells」（= 上游 #3767 yield marker 收紧）经核查为纯 Codex 作用域（`agents/codex/yielded-exec-cell.ts`），本仓无 Codex harness，**已划掉**。
- Cindy 功能级借鉴候选（2026-09-03 盘点，均在 Cindy「跳过登录」模式可用、不碰云）：会话搜索（`localDb/chatHistorySearch` FTS5+向量 RRF，可经 MCP `session_search` 给模型）、checkpoint/回滚（`main/git-snapshot` + RewindPreviewDialog）、错误分类重试补强（本仓已有基础重发，上游按限流/过载/断流/配额分类+倒计时）、effort/思考开关（`EffortSlider`/`ThinkingToggle`）、@ 文件引用+本轮产出文件卡（`AtMentionPanel`/`GeneratedFilesCard`）、计划/待办/提问交互卡（`PlanReviewBubble`/`TodoListCard`/`AskUserQuestionBubble`）、Goal 目标托管（`main/goal-host`，≠定时任务）、Ollama 本地模型托管（`main/local-model-runtime`）、消息排队（`PendingQueuePanel`）。会话导入/cross-agent-convert 数据源涉禁搬的 CC/Codex 生态，移植前需产品裁决。
- 超长会话列表虚拟化（组件已 memo）。
- 文件夹拖入 composer；Canvas 未覆盖类型仍「用系统打开」。
- IPC 错误展示会裸露 `Error invoking remote method ...` 前缀（可统一剥壳只显中文）。

---

## 8. 命令速查

```powershell
cd D:\AI\Fundet
pnpm install
pnpm dev:win                                  # 开发
pnpm dist:win                                 # Fundet-Setup exe（约 170MB）
pnpm --filter fundet-desktop test             # node --test 全量
pnpm --filter fundet-desktop typecheck
```

```bash
# WSL 可跑（不弹 GUI）
pnpm --filter @fundet/browser-runtime compile
pnpm -r --if-present run test
```

桌面测试覆盖：file-kind / file-name / preview-url / fs-local stage / collectArtifacts / search providers / search MCP 协议 / doc-text / IM dedup / IM turn-collector。

---

## 9. 参考（本项目站在哪些开源项目上）

| 参考 | 是什么 | 本仓中的位置 / 用法 |
| --- | --- | --- |
| **Cindy**（github.com/makecindy/cindy，XD Inc.，Apache-2.0） | 桌面 Agent 产品。UI 视觉、交互形态与多功能的对标/移植来源 | **GitLab 仓不含 Cindy 源码**（zip 打包时排除了 `cindy/`）。完整只读克隆在初始开发机 `D:\AI\Fundet\cindy`（blobless，08-29 @ a971f9e）；内网跟进方式见 §9.5。已移植：浏览器自动化（browser-control-runtime 整包 + browser-mcp 门面）、电脑操作形态、用量历史页、登录态拷贝、视觉勾选、错误重发。**禁止修改/fork 进本仓**；不搬 Ghost/账号云/Office/官方 IM Hook |
| **openclaw**（github.com/openclaw/openclaw，MIT） | browser-runtime 的更上游 vendored 浏览器内核 | `packages/browser-runtime/upstream/browser-runtime.lock.json` 钉 commit |
| **trycua/cua**（MIT） | cua-driver Rust 二进制（电脑操作引擎，stdio MCP） | `tools/cua-driver/update.mjs` 现下；注意其删 release 留 tag 的前科 |
| **earendil-works/pi** | Agent 底座（bun 单二进制，`--mode rpc`） | `tools/pi/update.mjs` + pin 0.83.0；AVX2 硬要求 |
| **Tencent openclaw-weixin**（MIT） | 微信 iLink 协议工具 | `apps/desktop/src/main/im/wechat-ilink/` |
| **Auriti-Labs/geo-optimizer-skill**（MIT） | GEO 技能封装的 CLI 上游 | 不 vendor，运行时 `uvx` |

### 9.5 Cindy 上游跟进（内网环境专用流程）

上游在 GitHub，内网通常访问不了；本 GitLab 仓也不含 Cindy 源码。跟进永远从**外网侧**发起，两段式：

**第一段：把「更新」带进内网（三选一，按网络条件）**

- **GitLab pull mirror（服务器能出网时首选）**：GitLab 新建 `cindy-mirror` 仓 → Settings → Repository → Mirroring repositories → 填 `https://github.com/makecindy/cindy.git` 设 pull mirror，自动定时同步。之后内网直接 clone 镜像。
- **外网中继（服务器完全不通外网）**：外网机器 clone 上游（国内用 gh-proxy.com 镜像前缀，如 `https://gh-proxy.com/https://github.com/makecindy/cindy.git`），加内网镜像为 remote 定期 `git push`。
- **按需 patch（最轻）**：不建镜像，需要某功能时由外网侧（跟踪 AI / 有外网的同事）`git format-patch` 出 patch 文件 + 移植说明，经内网交换渠道带进去，`git apply` 或照 diff 手工移植。

**第二段：移植四步（与上游对照后手工落地）**

1. **发现**：`git log --oneline <上次同步点>..origin/main [-- <目录>]`（上次同步点记在本节末尾）。
2. **评估**：目录映射 maker-core→`packages/agent-core`、maker-shared→`packages/shared`、browser-control-runtime→`packages/browser-runtime`、lizi-mcps→`packages/browser-mcp`/`src/main/search`、renderer↔renderer；产品红线（账号云/Ghost/Office/官方 IM）永不搬；`git show <commit>` 读透再动手。
3. **手工移植**：**永不 merge/cherry-pick 上游**。四处必须本地化：文案走 `brand.name`、IPC 四件套（channels/fundet-api/preload/register）、内部路径常量（`MANAGED_PROFILE`/`.fundet-uploads`/`Fundet-IM` 勿照抄上游命名）、Git 主线用 rebase 保持线性。
4. **验证沉淀**：`pnpm typecheck` + `pnpm --filter fundet-desktop test` + `pnpm dev:win` 真机；更新本节「上次同步点」；新增衍生文件补 NOTICE derived 列表；随版发布。

**特例**：`packages/browser-runtime` 是 vendored 整包（上游 openclaw，经 Cindy），按 `upstream/browser-runtime.lock.json` 整体同步 + 跑 SSRF 契约测试，不手工挑提交、永不过 rollup（见 §5 僵死坑）。

**上次同步点：50025e3c3（fix(pi): 修正 Windows 分组路径测试的子进程预算，2026-09-10；窗口 944b1c261..50025e3c3 共 639 提交已处理完毕：移植 #3832+#4182，其余裁决见下）**。

**2026-09-10 核查（944b1c261..95c773105，637 提交，大头 mobile/bots/remote-desktop/skillhub 属红线）**：候选①`c2bb4487c` #3832 未知自定义 openai-completions 端点默认 `supportsDeveloperRole:false`（pi 的 detectCompat 对陌生端点默认 true → system 发成 role=developer，火山类网关整个模型不可用；**本仓 pi-host.ts buildPiNativeProviders 同病**，~10 行）；②`240e70256` #4180 message_end 即落盘正文——**本仓持久化是 message_end 直插 DB（register.ts persistEvent），无 Cindy「内存流式 block 等边界 flush」中间态，缺口结构上不存在**，不移植；其 docs/research/pi-successful-reply-delivery-3696.md 是 #3696 权威取证（可复现缺口=内存校准覆盖，非已证实事故根因）。观察项：`7e275443b` #4182 executor exit 早于后代管道关闭（transport 层，长任务后卡死类，本仓 rpc-client 单文件需映射）；`c7c64e99e` #4062 浏览器放行内网导航（Cindy 外围新功能，与 SSRF fail-closed 立场冲突，产品决策）；history 12 连修复是 Cindy 投影重构补丁雨，本仓渲染层不同构不跟。**vendor lock 仍 b972feb3 未变**。

**2026-09-10 补查（同窗口，机器核查覆盖上一条未列项， tip 50025e3c3）**：**#3832 与 #4182 已于同日移植**（commit 2a1f980/33d0719：compat 透传进 PiNativeModelSpec + pi-host 注入；rpc-client 改 exit 权威收口 + 250ms 尾帧排水 + 销毁自端管道；exit-lifecycle/provider-routing 新增用例，pi 二进制就位后集成套件已真机跑过）。不适用/划掉——`eee3d8e8e` #3946 与 `50a6e913b` #3895（网关 catalog-to-descriptors/服务端目录平面，本仓无此层）；`9d6ee6ddb` #4178 与 `e2a0ff695` #4181（pi 原生命令管理/内核自更新，产品特性非修复，本仓 pi 走 tools/pi pin）；30165a942 `#4093`（Claude Code 预设，harness）；7bf942a9b 等 models 族 25 连（V4 媒体模型注册/服务端目录）。待对照再定：auto-review 三连（`3758e73f5` 保留真实授权/准确回传拒绝原因、`a95fc0d0d` 重连后追加指令恢复历史授权——均在 Cindy desktop auto-permission-reviewer 管线，与本病本仓 agent-core auto-review 不同构，移植前需先映射审批流；`73bb4c931` 分享导入 N/A 本仓无分享）；`afa8a51b2` #4126 全局约定继承到隔离运行目录（对照本仓 subagent 隔离）；`149d0d7b2` 停用技能入口优先解析（本仓无 skill-activation.ts，对照 customization-scanner 行为）。数据面：pi-model-catalog.json 智谱值与 0.2.11 已同步值逐项一致，无新数据；上游 pi 版本未动 0.84.4；挂账项网络守卫竞态、MCP 懒加载仍未落地。

**2026-09-03 窗口移植记录**（上游 hash 均见当日 commit message）：
- 已移植 4 项：#3751 登录态浏览器（生命周期队列 + running/pid 双信号判停 + status/stop 钉显式 profile + Windows App-Bound 加密检测拒绝拷贝）；#3742 pi RPC 帧级定界诊断（帧直方图，agent-core rpc-client）；#3706 完全放行对齐原生 Pi（移除 /proc environ 与凭证读两处 bypassPermissions 硬拦，Ask/自动档审批不变）；#3738 智谱目录数据（thinkingLevelMap 显式 off/minimal/xhigh 键 + glm-4.6v；网关 efforts 路由半边不适用）。
- 核查后不适用（勿再重查）：#3697 Windows 更新器 VC++/重试死循环——本仓 electron-updater 走自包含 NSIS、无自动重启机制，两半前提都不存在；#3662 后代清理超时——对应 PowerShell 清理机制本仓未移植（windows-git-path-lite 头注有声明）；#3723 SIGKILL 收尸——rpc-client.close() 已有 SIGTERM→3s→SIGKILL；#3554+944b1c261 飞书话题群——上游窗口内「加后撤」净变化≈0，本仓 feishu.ts 无话题/镜像机制；#3677 DeepSeek reasoning_content、#3741 vLLM responses——落在 codex-proxy / anthropic-compat-proxy 网关层，本仓无此层；#3768 provider id——落在 claude-code agent，未移植；`5997c497e` pi settings.json——本仓不写 pi settings；`360aeccf7` yield marker——Codex 作用域。
- vendor browser-control-runtime 本窗口零改动（lock b972feb3 一致）；网络守卫竞态与 MCP 懒加载上游仍未落地，继续挂 §7。
- 移植后真机项未做：`pnpm dev:win` 起应用 + §5.5 真机验证清单（模型/网络类改动：新会话选 glm-5.x → 贴图 → 确认描述 → 纯文本多轮）+ 设置里开合「使用我的浏览器登录态」。

---

## 10. 给接手 AI 的工作方式

1. 先读本文 §2 硬约束 + §5 坑表 + §3 关键文件表。
2. 搜索相关：实现前再读 §4.6，不要默认智谱、不要承诺「每账号每天 150 次 Exa」。
3. 视觉：对齐 `globals.css` CINDY token，不自创色板。
4. UI 改完：Windows 上 `pnpm dev:win` 真机点；WSL 只做单测/typecheck。
5. 新 IPC：`channels.ts` + `fundet-api.ts` + `preload` + `register.ts` 四处一起改。
6. 用户附件路径：工作目录外必须 stage 进 `.fundet-uploads`，否则 fail-closed。
7. UI 文案一律 `brand.name`；内部路径常量不许动。
8. 改完产品事实立刻更新本文件。
