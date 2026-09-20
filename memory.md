# Fundet 项目记忆（memory.md）

> 最后更新：2026-09-17。给任何接手的人/AI：先读本文，再读 `README.md`（用户向）。`cindy/` 目录是参考项目源码快照，**只读对照，禁止修改、禁止 fork 进本仓**（GitLab 仓不含 `cindy/`，完整只读克隆在 `D:\AI\Fundet\cindy`）。
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
# 2026-09-11 起活跃工作副本：D:\Go\fundet-buddy（初始开发机副本 D:\AI\Fundet 退役，
# 其 cindy/ 只读克隆仍是对照实现的首选参考）
cd D:\Go\fundet-buddy
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
| 设置 Tab | 通用 / 模型供应商 / 自动操作 / 用量历史 / 搜索（IM 机器人 / 技能 / MCP 服务器 / 知识库自 0.2.18 起移至**侧栏左上独立抽屉面板**，不再占用设置页，见 §4.2） |
| MCP 用户面 | 设置 → MCP 服务器：stdio 命令（cross-spawn 解 Windows .cmd shim）/ streamable-http（非 loopback 强制 https），开关默认开、可停用；新会话注入（`mcp__<名称>__<工具>`），审批跟会话权限档 |
| 复制 | 必须走 Electron `clipboard` IPC（权限处理器拒绝 `navigator.clipboard`） |
| 分享 | 截当前回合卡片为图片进剪贴板 |
| Mac 包 | 未签名（`identity: null`），macOS 新版对 quarantine 包报「文件已损坏」，用户须 `sudo xattr -cr /Applications/Fundet.app`；根治要 Apple 开发者证书 |
| 渲染进程 | `sandbox: true`，preload 必须 CJS 产物（见 §5 坑表） |
| 浏览器自动化 | 内置能力开关（默认关）；托管 Chrome 持久 profile「Fundet」 |
| 视觉发图 | 预设标注 + 编辑对话框「视觉」勾选，只信库值，无推断 |
| 电脑操作 | 内置能力开关（默认关）；cua-driver 外部二进制，遥测已关 |
| 知识库 | 纯 FTS5 关键词检索（**用户决策：无 embedding/无向量**）；导入 PDF/DOCX/TXT/MD，会话绑定后注入内置 knowledge MCP |
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
| 0.2.27 | 09-19 | **主页体验批 + 存量硬阻塞修复**：①`fix(db)` messages_fts 建表挂错入口——0.2.22~0.2.26 存量装机未打开过搜索的库**首次发消息即 no such table 发送失败**（外部用户实报）；修复=写入路径自建表（db/messages-fts.ts 注入式纯模块，幂等+回填），回归+5 测试 156/156，端到端实证表自动回来+MATCH 命中；旧版绕行=打开一次会话搜索。②欢迎页撤用量盘、组件卡高级感重设、条目可下钻（AI 钩子）、灵动岛驻会话头深度融合、知识库面板卡片化（hero 大数字/发丝行/幽灵新建卡）、卡片材质系统（--card-shadow+.fundet-surface）、主页弹层交互（板静态+点击弹窗内滚）、主页自适应无滚动（卡行 1fr 弹性，640 最小窗零溢出）。视觉七轮迭代 DOM 仲裁收敛 |
| 0.2.23 | 09-18 | **钉钉完整集成**（图片收发/审批问答桥/per-bot 目录/Cindy lizi-im 同机制）+ PDF 图片占位符清洗 + 原位编辑框 + 更多菜单对齐 + 按钮双序 |
| 0.2.24 | 09-18 | **钉钉工作台**（官方 dws CLI 四步引导：安装[Gitee 镜像默认]/OAuth 登录/官方技能包装配/状态探测；侧栏新能力面板；与 IM 机器人互补=Fundet 以用户身份操作钉钉 180+ 命令）+ FUNDET_USER_DATA 冒烟隔离通道 |
| 0.2.25 | 09-18 | fix: 「打开登录」没反应——打包环境 detached 控制台 spawn 静默失败；改后台进程跑 dws auth login + 授权 URL 抓取 + 面板「打开授权页」兜底按钮 |
| 0.2.26 | 09-18 | **钉钉组件板 + 灵动岛**：主进程聚合器（2min 门控轮询/TTL 去抖/单组件降级）+ 四组件（今日日程[滤已结束/会议室名]/待办[逾期优先]/待审批/未读）真机 fixture 解析 + 欢迎页/面板双放置 + 会话顶部灵动岛（倒计时+角标+morph 展开）+ AI 钩子预填会话；组件零写操作 |
| 0.2.22 | 09-18 | **追平批**：会话快照/文件回滚（bare 快照仓 + RewindDialog，含 HEAD 对齐坑修复，真实 git 集成测）；消息排队；RunningStatus tok/s；任务栏运行角标；图片 hover 预览 |
| 0.2.21 | 09-18 | **上游安全/诊断批 + 优化批**：#4493 空 stop、#4518 桥控制面写守卫（完全放行档也强制确认）+ RPC 超限帧、#4626 启动 stderr 诊断；思考档位 UI、会话搜索（FTS5）、错误分类自动重试、开机自启、分享卡片 DOM 光栅化、产出文件卡、Vertex/Azure 预设；updater GitLab 死代码清理；发版冒烟脚本化（tools/smoke-installer.mjs） |
| 0.2.20 | 09-17 | **体验高级感批（对齐 Cindy §14.4）**：Motion token 全组件落地；FadeSwitcher 切换淡入（路由/面板/会话）；侧栏 settle 闪烁 + attention 关注点（完成未读绿/错误红）+ 运行扫动条 + 标题 marquee；消息行软入场 + done 收束弹跳；启动 Splash；composer @ 文件引用（fs:list-dir）+ 图片附件缩略图；会话置顶/拖拽排序（sessions 补列）+ FLIP 重排 |
| 0.2.19 | 09-16 | **预览安全模型对齐 Cindy**（deny-list）；能力入口主区内嵌面板（三版演进终态，无返回钮）；确认弹窗柔和化；粘贴长文本 chip；**更新源回 GitHub**（GitLab 弃用，gh CLI + xiaosen6/fundet 单线发版）；**已发 GitHub Release**（三资产，冒烟过；0.2.8~0.2.15 存量装机更新通道复活） |
| 0.2.18 | 09-15 | 粘贴长文本自动收成 chip（≥10 行或 >600 字符；点击预览全文/× 移除；发送按序展开为原文）；含 0.2.17 后的布局修正（编辑入口在消息操作栏/路径按钮在输入卡下方/用户消息完整操作栏）；**tag 本地未推，内容并入 0.2.19** |
| 0.2.17 | 09-14 | **流畅度对齐 Cindy 批（14 项）**：Tooltip/Toast/ConfirmDialog 反馈基元（删会话有确认）+ 跳底/新消息 chip；划选引用、Ctrl+F 页内搜索、跳上一条提问；Lightbox 全屏查看（图/mermaid）、AgentTaskCard 子任务卡；MessageStream 换 TanStack Virtual 真虚拟化；composer 编辑按钮（真编辑截断重发）+ 路径按钮带边框 pill；另含 Cindy #4353 看门狗活性语义移植；**已发 GitLab Release**（静默装冒烟过，查窗口标题无 Error） |
| 0.2.16 | 09-11 | **应用内更新源切内网 GitLab**（generic feed 两跳解析：API 查最新 tag → packages 直连；私有项目需用户在 设置→通用 配访问令牌，safeStorage 落盘；真机 E2E 验证过 0.2.14-beta.1 → 检测/下载/暂存 0.2.15 全链）；**已发 GitLab Release**（静默装冒烟过，查窗口标题无 Error 弹框） |
| 0.2.15 | 09-11 | 稳定性/体验批：IPC 错误统一剥壳（UI 只显业务原文）、错误卡重发带 create（重启后可复活）、fork 缺供应商明确报错、auto-RAG 条数对齐 KB topK、搜索测试默认词清 LongMa 遗留、知识库导入进度条、超长会话列表窗口化；**已发 GitLab Release**（静默装冒烟过） |
| 0.2.14 | 09-10 | 侧栏置顶 IM/技能/MCP 快捷入口 + **本地知识库**（FTS5 检索/文件与文件夹导入/笔记/URL 快照/引用溯源/召回测试）+ 聊天渲染顺滑化 + 新 logo + 「点不动」根因对策（关 backgroundThrottling）与全局小手；**已发 GitLab Release**（2026-09-11，静默装冒烟过） |
| 0.2.13 | 09-10 | **聊天流式渲染顺滑化**（32ms 帧级合帧、流式 markdown 分块 memo 尾块重 parse、结构修复防版式抖动、意图贴底+RO 跟底、content-visibility、列表窗口化、first-paint 基线日志）；**已发 GitLab Release**（静默装冒烟过） |
| 0.2.12 | 09-10 | 同步 Cindy 上游 #3832（未知端点收敛 system role）/ #4182（exit 权威收口）+ **设置新增「MCP 服务器」用户面**（连通状态点/增删改/启停）+ 技能启停开关 + 全套新 logo（白卡 tile app icon + 透明球 UI 标）；**已发 GitLab Release**（静默装冒烟过） |
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
- 侧栏「新对话」上方置顶三个能力入口：IM 机器人 / 技能 / MCP 服务器（点击带 `state.tab` 直达设置对应分区，SettingsPage 从 location.state 初始化 tab）。
- Canvas 开关钉窗口右上（fixed）；贴附件不强制打开 Canvas。
- 会话重命名（侧栏 hover 铅笔/双击）、侧栏宽度拖拽（200-400px，localStorage 持久化）、**超长会话列表增量窗口化**（2026-09-11：首窗最近 60 行，触底 sentinel 再扩 80，activeId 越界自动扩到覆盖——Sidebar.tsx）。
- **交互反馈基元（2026-09-11 对齐 Cindy）**：全局 `ui/Tooltip`（450ms 延迟悬停提示，替代原生 title，已覆盖消息操作栏/侧栏/头部/输入区）、`ui/toast`（模块级 store + `toast.success/error/info`，知识库导入/笔记/快照反馈）、`ui/ConfirmDialog`（`confirmDialog()` 服务替代 window.confirm，danger 态错误色；删会话/删回复/删 KB/MCP/登录态开关全量接入，**删会话从此有确认**）；MessageStream 底部居中悬浮 chip 双件套（有未读→「N 条新消息」计数，无未读且离底>150px→「跳到底部」，互斥，Cindy 同款规格），reduced-motion 下滚动不smooth。
- **侧栏左上能力入口·主区内嵌面板（2026-09-16 定稿；历经三版：520px 抽屉→整屏路由页→主区内嵌）**：IM 机器人/技能/MCP 服务器/**知识库**四按钮常驻侧栏顶部，点击后**右侧主区（原会话区域）就地切换**为对应面板，**侧栏全程可见**；当前面板按钮高亮、再点收起；**返回方式 = Esc / 再点同款按钮 / 点会话或新对话**（面板顶部无返回钮，只留 46px 拖拽条与聊天页头等高）；面板打开时 Canvas 开关隐藏。设置页同步摘除四块（SettingsTab = general/providers/automation/usage/search）。组件：`components/sidebar/SidebarPanelDrawer.tsx`（文件名沿用，导出 PanelView）。**形态演进教训**：整屏路由页版是为绕 ChatPage drag 层吃点击（Windows app-region 命中按布局矩形、portal 层级骗不过）——主区内嵌后面板在 main 布局流内，天然无此问题。
- **确认弹窗柔和化（2026-09-14 对齐 Cindy confirm-dialog）**：中性遮罩 `neutral-900/40`（去掉模糊）+ 卡片缩放淡入/淡出（140-160ms，reduced-motion 跳过）+ danger 确认键**错误色实底** + 按钮 h-9 圆角矩形 min-w-88px；时间序：先标题后描述再 `mt-5` 按钮行。keyframes：`confirm-overlay-in/out`、`confirm-card-in/out`（globals.css）。
- **导航与媒体（2026-09-11 对齐 Cindy 批二）**：划选引用浮钮（消息文本划选→「引用」→onAddToChat 通道）；Ctrl+F 页内搜索（Electron 原生 `findInPage` 四件套 find:start/find:stop + find:result push，FindBar 计数/上下个/大小写）；右上角「跳到上一条提问」icon 圆钮（rAF 探测视口上方最近 user 消息，hover 预览）；`ui/Lightbox` 全屏查看统一三入口（本地图/远程 markdown 图/mermaid 图表点击放大，Esc/遮罩关闭）；**AgentTaskCard**（`agent_task_update` 事件接入 sessionStore applyEvent + DisplayItem task 变体——事件不落库，历史重建不回放）。
- **Composer 编辑与路径按钮（2026-09-11 对齐 Cindy 批三；初版位置做错，经用户截图纠正）**：「编辑」入口在**每条用户消息的 hover 操作栏**（复制 + Pen；**不在** composer 工具行——Cindy 同款）——点击载入原文进输入框（编辑态横幅 + 聚焦全选 + Esc/取消；运行中拦截 toast），发送即真编辑：`deleteTurn` 截断原消息及其后全部内容再重发（sessionStore `truncateItemsFrom` 同步本地条目）。路径按钮（FolderPickerChip，Cindy 会话式带边框 pill：Folder 图标 + 目录名）位于**输入卡下方左侧**（与费用/上下文环同行，不在 composer 工具行内）。
- 用量：首页折叠仪表盘（20 周热力图 + 30 天堆叠柱）+ 设置「用量历史」页（概览 5 格/热力图/按模型表含缓存命中率）。
- 本地图片预览 `fundet-file://` 协议；复制走 clipboard IPC；分享=回合卡片截图。
- **流式渲染纵深（2026-09-10 对齐 Cindy 五层，治「长回答越流越卡/长会话发沉/上滑被拽回」）**：①sessionStore delta 通知 32ms 帧级合帧（状态同步写，只压通知）；②消息条目 `content-visibility:auto`（`.msg-stream-items > *`，屏外零布局成本）；③贴底跟随 = 意图判据（wheel/touch/PageUp 上滚 1px 立即解除）+ ResizeObserver 跟底 + 恢复双信号（向下滚 + 贴底 ≤8px）；④流式 markdown 先 repair（补未闭合围栏/摘半截链接，`lib/streamingMarkdown.ts`）再按顶层块分块 memo，**只有尾块重 parse/重高亮**；逐词淡入只挂尾块（按块位号独立账本，稳定块冻结）；⑤消息列表 **TanStack Virtual 真虚拟化**（2026-09-11 替换原「首帧15→扩80→触顶+80」窗口扩展：动态测量行高、overscan 8、行间距内化为行内 pb-3.5、滚动容器 `overflowAnchor:none` 防浏览器锚定与虚拟化打架、流式未封口文本作伪行恒挂末位、globals 的 content-visibility 规则以 `:not([data-virtual])` 排除虚拟行防测量被腐蚀；跳底/跳上一问/切会话定位全走 scrollToIndex）；⑥`[perf] stream first-paint` debug 日志 = 丝滑度回归基线。thinking/工具卡折叠即卸载（Collapse 移植自带，收起不占 DOM）。
- **动效体系与状态可感知批（2026-09-17 对齐 Cindy DESIGN.md §14.4，已完成未发版）**：①Motion token 全组件落地（`--motion-*` 5 档 + 3 曲线 + 新增 `--motion-morph` 220ms 容器形变例外类；组件硬编码时长清零，新增动效一律引用 token）；②**FadeSwitcher**（`ui/FadeSwitcher.tsx`，trigger 驱动、子树不重挂——composer 草稿/滚动跨切换保留）三处接线：路由切换（main.tsx layout route）/ 能力面板开关（ChatPage 主区）/ 会话切换（仅包 MessageStream）；③**侧栏动态四件套**——运行结束 settle 底色闪烁（0.9s 一次性）、attention 关注点（turn 非注视下完成=绿点带光环 `session-dot-pulse`、终态出错=红点；sessionStore 追踪 + `markSessionSeen` 切进即清）、运行中非选中行底部扫动条（`session-sweep`）、溢出标题 hover marquee（MarqueeTitle：真溢出+hover 才播、每可视宽 2.4s、离开复位）；④**消息行入场软淡入**（`animate-row-enter` 0.4→1；MessageStream `enteredRows` 账本：仅「尾部追加批次」（≤4 行增量且非首渲染）播，历史装载/切会话/虚拟滚动重挂不播）；⑤**Done 收束** `status-done-pop`（0.85→1.08→1 back-out，全应用唯一 sanctioned 过冲，挂 RunningStatus 左段）；⑥**启动 Splash**（`Splash.tsx` renderer 内实现：品牌球光泽 sheen 扫动 + 最短亮 500ms，会话列表就绪即 200ms 淡出）；⑦**composer 增强**——@ 文件引用（新 IPC `fs:list-dir`；输入 @ 唤出工作目录候选面板 `FileMentionPanel`，目录可下钻 `/`，选中文件 stage 成附件 chip）+ 图片附件缩略图（`AttachmentThumb` 24×24，composer chip 与用户消息气泡共用，读失败回落图标）；⑧**会话置顶/拖拽排序**（sessions 表幂等补列 `pinned`/`sort_order`；新 IPC `session:set-pinned`/`session:reorder`；hover 动作区 Pin/PinOff（草稿不显示）；置顶段单独段标「置顶」+ dragenter 活换序 + dragend 持久化）+ **列表 FLIP 重排动画**（Sidebar offsetTop 快照 + translateY 补偿，motion-base move 曲线；offsetTop 而非 viewport rect——不受滚动影响）。**克制红线**：循环动画全部 compositor-only（transform/opacity）+ reduced-motion 白名单登记每个新 keyframes；装饰性 idle 循环（空态品牌球浮动）按 §14.4「禁循环装饰」裁决**不做**；ConfirmDialog 140-160ms 是 0.2.19 用户拍板值不动。SendButton send↔stop 交叉淡切 morph 此前已有（核查确认）。

### 4.3 附件与文档
- 拖/贴/回形针多选；工作目录外文件拷到 `{workDir}/.fundet-uploads/`；粘贴图片魔数嗅探 mime（QQ「原图」=PNG 套 .jpeg 的坑）。
- PDF/Word 拖入自动提取正文随消息发模型（unpdf/mammoth，200k 字/30MB 上限，失败不阻断）。
- 粘贴长文本 chip（2026-09-14 对齐 Cindy）：粘贴 ≥10 行或 >600 字符文本自动收成「粘贴的文本（N 行）」chip（点击 Lightbox 预览全文、× 移除），发送时按粘贴顺序展开为原文追加；DB 存完整拼接文本。
- **预览安全模型（2026-09-16 对齐 Cindy filePathPolicy）**：读取侧（readFileDataUrl/readTextFile/fundet-file:// 协议）从「workDir 白名单」改为 **deny-list**——工作目录外普通文件可预览（agent 引用任意盘路径、原始位置附件），只拦系统目录（Win 系统盘族 + POSIX /etc 等）、凭据（.ssh/.aws/.gnupg…）、浏览器 profile；符号链接 realpath 后判定。策略模块 `main/filePathPolicy.ts`（11 用例）。**附件发送侧 workDir 硬约束不变**（界外必须 stage 进 .fundet-uploads）。

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

### 4.9 本地知识库

- **纯 FTS5 关键词检索**（用户决策：不做 embedding/不做向量化）。表走 raw SQL 幂等创建（`main/knowledge/store.ts`），FTS5 虚表**不进 drizzle 迁移**；`getSqlite()`（db/client.ts）取原生句柄。
- **分词：CJK bigram + 拉丁整词小写**（`knowledge/tokenize.ts`），索引/查询两侧同一函数；**别换 Intl.Segmenter**（ICU 词典深浅不一，本机把「退货」切成单字）。查询 = 各 token 引号 OR + 拉丁前缀 `*`；排序 bm25()。
- 分块：段落聚合 800 字，超长段按句切窗 overlap 120（`knowledge/chunk.ts`）。
- 导入：PDF/DOCX/TXT/MD → `extractKnowledgeDocumentText`（doc-text.ts，抛错制）→ 分块事务入库（kb_chunks + kb_fts，rowid 对齐）。
- 会话绑定存 settings（`kb.session.<sessionId>`，主进程可读）；绑定后**新消息**注入内置 knowledge MCP（`knowledge_search` 工具，返回【n】来源片段并带「不得编造」提示语）；composer 知识库 chip（KnowledgeChip）+ 设置→知识库（CRUD/导入/召回测试）。
- 批A（2026-09-10）：目录导入（递归收集、跳隐藏/node_modules）；KB 级参数 topK/chunkSize/chunkOverlap（knowledge_bases 列，幂等补列；MCP 默认 limit 与导入分块都读它，**改块参数需重新导入才生效**）；导入结果逐文件展示 + 失败项保留路径一键重试。
- 批B（2026-09-10）：会话绑定升级 `{ids, auto}`（兼容旧纯数组）；`auto` = 发送前自动检索注入——session:send 按用户原话检索（**条数与 knowledge MCP 工具同源：各绑定 KB 的 topK 取最大，2026-09-11 起对齐，原为硬编码 top4**）拼进发给模型的消息上下文（**DB messages 仍存用户原话**，注入只影响模型所见）；回答里的【n】经 rehypeKnowledgeCite 渲染成可点角标，点开溯源面板（来源/块序/原文），数据 = 本轮 knowledge_search 工具 resultText 解析（`lib/knowledgeCite.ts`）。
- 批C（2026-09-10）：笔记（knowledge_docs.kind='note' + content 存原文，可再编辑重建索引）；URL 快照（html-to-text 提正文；**SSRF 前置 assertPublicHttpUrl**：仅公网 http(s)、DNS 全地址逐个拦内网/链路本地/元数据，3MB/20s 上限）。
- 二轮反馈（2026-09-10）：**「点不动、过一会自愈」根因对策**——主窗 `backgroundThrottling: false`（Windows 遮挡检测误判 → 渲染冻结，Cindy 同款处理）；全局 `cursor: pointer`（button/[role=button]/summary/select/a，Chromium 按钮默认 default 体感像不可点）；知识库面板「高级参数」整个移除（用户明确不要，store 的参数列保留、工具默认 limit 仍生效）。
- 三轮反馈（2026-09-10）：知识库 chip 弹层去掉「发送前自动检索注入」开关与 knowledge_search 术语说明（用户看不懂）；弹层只留知识库勾选列表。绑定结构的 auto 字段保留（默认 false，注入能力后端不删、UI 不暴露）。
- 四轮反馈（2026-09-10）：chip 弹层列表隐藏滚动条（globals 新增 `.scrollbar-none` 工具类，滚轮仍可滚）——MorphPopover「真溢出才开滚」的取整 1px 假溢出在短列表也会挂出滑块，短列表直接不显示。
- 导入进度（2026-09-11）：文件/目录导入逐文件推 `kb:import-progress`（push 通道，payload `{kbId, completed, total, current}`），设置面板进度条 + 当前文件名；单文件不显示。
- **PDF 图片占位符清洗（2026-09-18，未发版 09ca4e8）**：Word 导出 PDF 的文本层带图片文件名标签（pdf.js 形态 `p14_img0.png`），此前混进知识库分块/附件正文，模型引用时原样吐出（用户实测报告）。`doc-text.ts sanitizePdfText`：独占行连行尾换行一起吃 + 行内残余剥离 + 空行压缩；KB 导入与附件发送共用 extractPdf 一处修复；**存量 KB 需重新导入**。真·图文知识库（提取图像本体+多模态检索）= P2，触发条件：用户明确提出需要图文档问答。
- **操作栏/输入行对齐（2026-09-18，未发版）**：①~~输入卡下方上下文用量环移除~~（**误判次日纠正 7014b97 后**：用户所指「钟表按钮」是消息操作栏 History 图标的回滚钮——已收进更多菜单即满足；用量环保留在输入卡下方，勿再动）；②消息「更多」菜单对齐 Cindy：min-w-184px/h-8 行/删除前分隔线/菜单按 align 双侧对齐，**Rewind 收进菜单**（Undo2「回滚」，仅 user 侧），无「复制消息链接」（Cindy 云端，红线）；③按钮双序：user=[时间][复制][分享][分叉][编辑][更多]，assistant=[复制][分享][分叉][更多][时间][tokens]。
- **编辑 = 原位编辑框（2026-09-18，未发版 09ca4e8，对齐 Cindy UserMessageEditBox）**：入口**仅最后一条 user 消息**（edit-last-message）；点击后气泡**原位**变 textarea（预填原文光标置尾）+ 附件只读 chip + [取消][发送]；运行中点编辑**立即中断 turn**（Cindy 产品语义：点编辑=停下要改）；提交才截断重发（submitUserEdit 等 abort 收口再 deleteTurn+重发，防 running 重发被拒；同时清空排队）；取消零副作用；Enter 发送/Esc 取消。旧的「文本进 composer+编辑横幅+全选」链路已删。不做 Cindy 的「发送将撤销 N 文件改动」提示——Fundet 编辑不回滚文件（与 Cindy rewind-文件语义不同）。
- markdown 渲染链安全基线（2026-09-11 审计，无缺口）：react-markdown 默认转义 raw HTML（无 rehype-raw）、mermaid `securityLevel:'strict'` 后才 dangerouslySetInnerHTML、KaTeX 默认 trust=false、链接/图片走受控组件 + 默认 urlTransform。改渲染链时不得破坏这四道防线。
- 反馈修正（2026-09-10）：设置→知识库简化为「新建 → 添加文件夹/文件」主流程，参数与召回测试收进「高级」折叠（普通用户不折腾）；**app icon/favicon 换成抠出的透明球体**（白卡整图被用户否了；logo-raw 仍是原始图，再生管线见 §品牌）；updater IPC 处理器改为无条件注册（dev 态渲染层查 update:status 不再刷 No handler registered）。

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
| electron-updater 构造器严格校验 semver（四段版本号如 0.2.14.1 → 模块加载即抛，主进程弹原生「A JavaScript error」框假死） | 测试用旧版本号必须合法 semver（如 `0.2.14-beta.1`） |
| electron-updater 6.8.9 `setFeedURL` 不消费 `options.requestHeaders`（仅构造函数读）→ 私有 feed 拉 latest.yml 404（GitLab 把未授权伪装成 404） | 鉴权头直接赋公共字段 `autoUpdater.requestHeaders`（updater.ts applyFeed 有注释） |
| 打包版 `remote-debugging-port` 不监听（Chromium M136 起须显式 `--user-data-dir` 才激活远程调试；重定向 stdout 也常为空） | 打包版主进程诊断用文件插桩最稳（用完删净） |
| 冒烟判据「进程 alive」会被 Error 弹框骗（主进程未捕获异常弹原生框，进程同样活着） | 冒烟必须查 `MainWindowTitle` ≠ "Error"（0.2.16 起冒烟模板） |
| **冒烟静默装留下的目录记忆键**：electron-builder NSIS 把安装目录写在 `HKCU\Software\<guid>`（除 Uninstall 键之外的第二个键），只清 Uninstall 键的话用户下次安装默认路径变成冒烟临时路径（0.2.22 当天真发生，用户报告） | smoke-installer.mjs 已同时清两键 + 本机已有 Fundet 安装时拒绝运行（防污染真实安装）；本机污染键 09-18 手工清除 |

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

## 6. 发版流程（GitHub 单线，2026-09-16 起）

> **GitLab（172.16.56.11）已弃用**（2026-09-16：持续断连不可依赖，remote 改名 `origin`→保留但不再使用）。**主远端 = GitHub `xiaosen6/fundet`**（remote 名 `github`，gh CLI 已登录 xiaosen6）。该仓原是发布分发存根（main 曾只有一个 init 提交），2026-09-16 起 main 强推为完整源码历史 + 全部 tag（v0.2.11 tag 因挂有已发布 Release 刻意未覆盖，避「转 draft」坑）。**更新源自 0.2.19 起回 GitHub Releases**（brand.ts 已删 GitLab updaterFeed；公开仓免令牌——0.2.8~0.2.15 存量装机的更新通道直接复活；0.2.16~0.2.18 内置 GitLab feed 的版本是死端，需手动装一次 0.2.19+）。

1. 升 `apps/desktop/package.json` version；memory.md §3.5 补版本行；提交。
2. `git tag vX.Y.Z && git push github main vX.Y.Z`。
3. **PowerShell** `pnpm dist:win` 本地出包 → 拷一份到 `D:\` 根目录。pre 钩子自动跑 pack-browser-deps；**出包前确认 `apps/cua-driver-bin/win32-x64/VERSION` 存在**。Defender 慢日构建超 10 分钟属正常，斩死后无孤儿进程直接重跑；EBUSY 同理整体重跑。
4. 静默安装冒烟：`/S /D=<临时目录>` → 启动 → **查 MainWindowTitle ≠ "Error"** → 杀进程 → 清理临时目录 + HKCU 安装痕迹（`HKCU\Software\<卸载GUID>`、Uninstall\<GUID>、开始菜单/桌面 Fundet 快捷方式——不清会把冒烟临时路径写进安装器记忆）。
5. `gh release create vX.Y.Z -R xiaosen6/fundet --title vX.Y.Z --notes "<说明>" <exe> <blockmap> <latest.yml>`——三资产挂 Release，electron-updater 读最新 Release 的 latest.yml。
6. 发版前 `git merge-base --is-ancestor <commit> <tag>` 确认资产 commit 已进 tag。

> mac 包暂无产出路径，需要时再定。
> 网络注意：GitHub 直连不稳时资产**上传**只能重试（gh-proxy 只代理下载）；push 源码一般可过。

> **【已废止——0.2.19 起更新源回 GitHub Releases，见上文 §发版；0.2.16~0.2.18 内置 GitLab feed 的版本是更新死端】应用内更新曾切 GitLab（0.2.16 起，产品决策 2026-09-11）**：updater.ts generic feed 两跳解析——GET `releases?per_page=1` 拿最新 tag → setFeedURL 指 `packages/generic/fundet/<版本>/` 直连（不走 downloads API：它 302 到包文件，重定向上自定义头不受控）。项目 272 私有——**用户须在 设置→通用「版本与更新」配 GitLab 访问令牌（scope=api；safeStorage 落盘 `keys/gitlab-updater.bin`；`FUNDET_UPDATER_TOKEN` 环境变量可覆盖，部署/测试用）**，未配时中文指引。**存量过渡**：0.2.15 及以前的安装仍指 GitHub、永远收不到新版本——须手动装一次 0.2.16（Release 页或 `D:\Fundet-Setup-0.2.16-x64.exe`），此后自动更新走 GitLab。
> mac 包暂无产出路径（无 CI mac job、本地无 mac 机），需要时再定。

> **在途事项（2026-09-16）**：**无**——0.2.19 已发 GitHub Release（xiaosen6/fundet，三资产齐、非 draft、冒烟过），源码 + v0.2.12~v0.2.19 tag 已全部推 GitHub；主远端切 `github`（https://github.com/xiaosen6/fundet.git），GitLab remote `origin` 保留但不再使用（服务持续断连已弃用）。v0.2.11 tag 在 GitHub 指向旧分发存根历史（挂已发布 Release），刻意未覆盖。改 package.json 禁用 PowerShell `Set-Content -Encoding utf8`（带 BOM），用 [IO.File]::WriteAllText + UTF8Encoding($false)。Defender 慢日出包超时预算 20-25 分钟，斩死后直接重跑。

> **在途事项（2026-09-18）**：**无**——0.2.22（追平批：快照/文件回滚 + 消息排队 + tok/s + 任务栏角标 + hover 预览，commit 37da546/66502ef）已发 GitHub Release：三资产齐、非 draft、冒烟脚本 PASS；安装包备份 `D:\Fundet-Setup-0.2.22-x64.exe`。出包又遇一次 EBUSY（Defender 锁 cua-driver，同 0.2.21，重跑即过——**两天连撞，此坑已成高频项**）。**与 Cindy 共同功能面追平收尾**：剩 TipTap 富文本 composer（大工程，等产品反馈再定）与 Goal/Ollama（产品级）。快照回滚注意：rewind 后必须落「回滚态」提交对齐 HEAD（checkout 不动 HEAD，不落则 diff 预览/后续快照全失配——已在 store.ts 注释与集成测覆盖）。
>
> 0.2.20（体验高级感批）已于同日发 GitHub Release：tag/commit 5befa77（merge-base 验证过）、三资产齐、非 draft、静默装冒烟过；安装包备份 `D:\Fundet-Setup-0.2.20-x64.exe`；老库升级路径已实测（sessions 表 pinned/sort_order 幂等补列自动生效）。

> **在途事项（2026-09-18 晚，0.2.23 发）**：**无**——0.2.23（钉钉完整集成 + 六项修复：PDF 占位符清洗/原位编辑框/用量环保留/提示语删除/更多菜单对齐/操作栏双序）已发 GitHub Release：tag=commit d7a18d8（含 ae88ed2 移植、c9dc10f 记录），三资产齐、非 draft（gh api 复核过）；安装包备份 `D:\Fundet-Setup-0.2.23-x64.exe`。**冒烟方式变更**：本机装有真实 Fundet 0.2.22，install-smoke 被 smoke-installer.mjs 自家 clean-machine 守卫正确拒绝（守卫按设计工作，防误伤用户装机）——改用 **win-unpacked/Fundet.exe 启动冒烟**替代：4 进程正确路径、1280x800 窗口可见、Win32 CopyFromScreen 截图确认侧栏+空态渲染正常。经验：无框窗下 PowerShell 读 MainWindowTitle 为空属正常（此前冒烟读到 "Fundet" 的都是安装版），别再拿空标题当故障信号。

> **在途事项（2026-09-18 夜，0.2.26 发）**：**无**——0.2.26（钉钉组件板 + 灵动岛）已发 GitHub Release：feat 4a9b676 + 发版提交，三资产齐、非 draft；安装包备份 `D:\Fundet-Setup-0.2.26-x64.exe`。**组件体系事实**：主进程 dws-widgets 聚合器每 2min 并发跑 profile+4 查询（未装/未登录门控不跑；渲染层回焦触发、主进程 TTL 45s 去抖）；单组件失败保留旧数据 + errors 角标；fixture 全部真机登录态实捕进 `__fixtures__/`（时钟可注入防跨日漂移）；**组件只读原则**——一切写操作走 Agent 会话过命令确认闸，组件不执行 dws 写命令（0.2.26 决策）。灵动岛只在会话视图显示（欢迎页有组件板、能力面板打开时让位）。实测注意：`pnpm build` 只重建 out/，**改完代码必须 dist:win 重打包再冒烟**（本次 0/9 假失败的根因——跑的是旧 win-unpacked）；dws `calendar event list` 默认拉当天，日程字段名 summary/start.dateTime/meetingRooms[].roomName；todoCards 按截止排序后工资条类无截止项会沉底（非 bug）。

> **在途事项（2026-09-18 深夜，0.2.25 发）**：**无**——0.2.25（登录按钮修复热更）已发 GitHub Release：fix c63d075 + 发版提交，三资产齐、非 draft；安装包备份 `D:\Fundet-Setup-0.2.25-x64.exe`。**坑**：打包环境里 `spawn(powershell, …, {detached:true, stdio:'ignore'})` 拉可见控制台**静默失败**（错误事件没监听 + 代码照样报成功；CDP 复现：面板报「已打开登录窗口」但进程列表无 PowerShell）——**打包应用里弹外部终端窗这条路别再走**，改后台进程 + 管道抓输出（runCommand 同款 spawn 已被版本探测验证可靠）。**dws 登录流实测（用户真机 0.2.24 + 终端手动）**：扫码 → PAT 授权链接（open-dev personalAuthorization?flowId&userCode，浏览器里第二步）→ 授权成功 → token 30 天自动刷新；登录态机器级（与本仓应用无关），面板 5s 轮询 profile list 即可发现。**用户已登录**：山东未来互联科技有限公司 / 孙记森（dingeb4ed5ff8d088df2a1320dcb25e91351），dws v1.0.62 + 14 技能就绪。**真机三问实测（09-18，0.2.24 面板+已登录态）**：①查人（张章）全链成功——手机/职位/部门/工号/邮箱/直属主管全出，aisearch+contact 管道完好；②会议室三路查询（分组/时段搜房/即时找房）全空——**公司钉钉没配置会议室资源**（组织侧配置问题，非集成缺陷，要此能力须管理员在钉钉后台配会议室）；③提交外出审批被 Agent 正确拒绝——外出模板（PROC-02ECD545）核心字段封装在考勤套件（attendance.goout），dws 无稳定公开提交契约，Agent 按技能纪律不强写正式审批系统，改出钉钉深链直达表单+预填内容（**这是 fail-safe 设计生效，不是 bug**）。待观察：dws 共创期是否会补考勤套件审批契约；请假若同样走考勤套件会遇到同边界。extractAuthUrl 现取第一个 login/dingtalk 链接（扫码页）——若将来要把兜底按钮指向 PAT 授权链接，应取**最后一个**匹配。

> **在途事项（2026-09-18 晚，0.2.24 发）**：**无**——0.2.24（钉钉工作台：dws 官方 CLI 引导面板）已发 GitHub Release：feat 6b307fa + fix 88518df + 发版提交 c8f3b29，三资产齐、非 draft；安装包备份 `D:\Fundet-Setup-0.2.24-x64.exe`。**dws 集成事实**：钉钉官方 CLI = `DingTalk-Real-AI/dingtalk-workspace-cli`（Apache-2.0，npm 名 dingtalk-workspace-cli，命令 dws），21 服务域 180+ 命令，用户 OAuth 身份；`dws skill setup --mode multi --target all --yes` 落 `~/.agents/skills/dingtalk-*`（与本仓技能系统同目录，Agent 核心零改动，14 个技能）；登录硬门槛=企业管理员开放平台开「CLI 访问管理」（共创期）。官方 MCP（open-dingtalk/dingtalk-mcp）**裁决不集成**：无 oa 模块（请假/外出做不了）+ 应用身份非用户身份 + 仓库无 license。**新坑两条**：① 本机 cmd.exe AutoRun 注入 doskey 宏回显，`cmd /c <cli>` 的 stdout 前混两行非 JSON——凡 cmd.exe 转发 CLI 输出必须 `cmd /d /c` + 解析截 JSON 段（host/dws.ts extractJson）；② **用户真装在跑时 unpacked 冒烟法**：Windows 上 Electron appData 走系统 API 不吃 %APPDATA% 环境变量，单实例锁只能用 `FUNDET_USER_DATA` 环境变量覆盖（main/index.ts 已支持）+ `--remote-debugging-port` + CDP 脚本点击验证（本次 5/5 PASS）。另：bash 后台跑 GUI 应用活不过调用边界，要用 cmd `start` 脱附且非沙箱执行。

> **在途事项（2026-09-19，0.2.27 发）**：**无**——0.2.27 已发 GitHub Release（xiaosen6/fundet）：fix f75e15e + 7 个 UI 提交（4990079/a904d4d/5839761/722e524/157140f/e0da4b6/28da1ac）+ 发版提交，三资产齐（构建于修复后 11:54 批）、非 draft（gh api 复核）；安装包备份 `D:\Fundet-Setup-0.2.27-x64.exe`。**核心修复：messages_fts 建表挂错入口**——0.2.22~0.2.26 存量装机未打开过搜索的库首次发消息即 `no such table` 硬阻塞（外部用户下载认证后实报，非本机）；根因 ensure 只挂搜索入口、伴生写裸 INSERT，开发机/种子库全绿假阴性。修复=写路径自建表（`db/messages-fts.ts` 无 electron 依赖注入式纯模块，upsert 内 ensure 幂等+空表回填存量，去模块级标志防多库串；session-search 只留搜索逻辑）。回归 +5（156/156，断言库文本是 bigram 分词串非原文）。

> **查人手机号「时有时无」定位（2026-09-20 实证，非 dws 抽风）**：本机连测——aisearch person 6/6 **逐字节相同**（返回张章 1 条，仅办公地点/职位/工号/staffId，**从不含手机号**）；contact +lookup / user get / user search 稳定返回部门/主管/邮箱（orgAuthEmail）也**无手机号**；唯一携带手机号的**花名册（contact user profile get，server_key=hrmregister）6/6 稳定 2001「操作人无花名册管理权限」**；aisearch enterprise「张章 手机号」17 条（工资条/IM）也无号码。结论：**手机号在钉钉体系唯一正规来源=花名册，按组织权限放行**——「能查到」要么是当时权限开着（09-18 真机三问手机号全出，之后权限被收紧/策略变化，时间维度非随机），要么是 agent 从被索引的聊天/文档里捡到过号码（命中不稳），**且需警惕查不到时模型编号码（幻觉）**——用户 09-20 已清空全部会话（sessions/messages=0，FTS 留 144 孤儿行属已知设计），无法复盘历次号码真伪。对策：企业管理员开智能人事/花名册查看权限即稳定可查。

> **新会话首条回复慢（~30s）根因定位（2026-09-20 实测复现）**：冷启动实测 **31.3s 才「已工作」、32.0s 出回复；同会话第 2 条 50ms 启动/6.7s 回复**。构成：①**最大头 ~20s：checkpoint 快照挡在 session:send 关键路径**（register.ts `await createSnapshot`）——默认 workDir=C:\Users\16086（没选文件夹时），`git add -A` 全量扫 home（EXCLUDES 只有 node_modules/.DS_Store/Thumbs.db，AppData 几十万文件全扫），撞 `GIT_TIMEOUT_MS=20s` 被 SIGTERM；**20s 杀掉后残留 index.lock → 该会话后续快照全部秒失败**（快照功能实际已死 + 日志刷屏），但发送反而变快——bug 自我掩蔽。②`createSession` 6.5s：pi 子进程启动 + MCP 桥**串行**拉起（blender 连不上重试 ~5s 还往 supabase 发遥测、computer/cua-driver 57 工具、浏览器 MCP 401）。③模型首请求 <1s。修复方向（待拍板）：快照挪出发送关键路径（真·不阻断=不 await）/ home 目录跳过快照 / EXCLUDES 补 AppData 等 / MCP 并行拉起+快速失败。测量坑：DOM 计时标记不能出现在用户消息里（回显会秒命中），用「倒序回复」指令规避；「让模型原样回复」设计错误曾把三轮全测成假 TIMEOUT。**方法论教训（本轮新增）**：①「表是自动建的」结论只实证了 KB 表就外推——**多条链路多个结论要分别实证**；②**行为断言会被乐观回显骗**（旧包发送失败但 DOM 有消息、toast 已消失）——存证类验证以杀进程后物理查 db 为裁决；③ PowerShell 里 node -e 内联 `COUNT(*)` 的 `*` 被吞，复杂内联走 Bash；④ **涉及存储的冒烟必须加一轮空/残缺 userData**（种子库掩盖建表路径，外部新装机=我们的盲区）。**0.2.27 UI 批事实**：主页交互模型=DwsWidgets 双模式（popover=欢迎页板静态+点击弹 fixed 浮层[预算式定高 min(440,余量)/翻上方/窗内滚动/Esc 关]；inline=灵动岛原地手风琴）；主页永不滚动=欢迎列 h-full+板区 flex-1+卡行 1fr（660 封顶/150 地板，窗口最小高 640 零溢出，验证用渲染层 window.resizeTo——Emulation override 在 Electron 无效）；卡片材质=--card-shadow(-hover)+.fundet-surface（亮=顶缘白高光+暖黑双层影/暗=纯黑双层影，幽灵卡无材质）；KB 面板卡片化（hero「N 份文档」/Reveal 内嵌/虚线幽灵新建卡）。视觉模型幻觉三例确立纪律：美感判断可用、事实判断必须 DOM/物理仲裁。

---

## 7. 待办 / 已知债

- 真 Key 全链路冒烟。
- Mac 公证（需 Apple 开发者证书 + CI notarize）。
- Cindy 上游可跟进项：browser-runtime 网络守卫竞态修复、MCP 懒加载（**截至 2026-09-03 上游均未落地**，vendor lock 仍 b972feb3 与本仓一致）。「yield cells」（= 上游 #3767 yield marker 收紧）经核查为纯 Codex 作用域（`agents/codex/yielded-exec-cell.ts`），本仓无 Codex harness，**已划掉**。
- **本地知识库（已规划待开工，2026-09-10 用户拍板：纯 FTS5 关键词检索，不做 embedding/不做向量化）**：SQLite FTS5 + Intl.Segmenter 前分词（零依赖，中文友好）、BM25 排序、snippet/highlight 白送；文档管线复用 unpdf/mammoth（TXT/MD/PDF/DOCX），段落+句窗分块；Agent 接入走内置 `knowledge` MCP（会话绑定 → knowledge_search 工具，返回带来源片段）；UI = 设置新 tab（CRUD/导入/召回测试）+ 对话输入框旁知识库 chip + 引用角标片段卡。M1 约 1.5~2 天；Excel/CSV/URL 抓取后置。取舍：纯关键词对语义换说法召回弱（用户知情接受）。
- Cindy 功能级借鉴候选（2026-09-03 盘点，均在 Cindy「跳过登录」模式可用、不碰云）：会话搜索（`localDb/chatHistorySearch` FTS5+向量 RRF，可经 MCP `session_search` 给模型）、checkpoint/回滚（`main/git-snapshot` + RewindPreviewDialog）、错误分类重试补强（本仓已有基础重发，上游按限流/过载/断流/配额分类+倒计时）、effort/思考开关（`EffortSlider`/`ThinkingToggle`）、@ 文件引用+本轮产出文件卡（`AtMentionPanel`/`GeneratedFilesCard`）、计划/待办/提问交互卡（`PlanReviewBubble`/`TodoListCard`/`AskUserQuestionBubble`）、Goal 目标托管（`main/goal-host`，≠定时任务）、Ollama 本地模型托管（`main/local-model-runtime`）、消息排队（`PendingQueuePanel`）。会话导入/cross-agent-convert 数据源涉禁搬的 CC/Codex 生态，移植前需产品裁决。
- **钉钉完整集成（2026-09-18 已移植，Cindy lizi-im 同机制）**：API 客户端 `im/dingtalk-api.ts`（token 双轨缓存+图片下载/上传+robot 主动发+webhook 过期回退）；入站纯函数 `im/dingtalk-inbound.ts`（text/richText/picture/audio/video/file）；图片收发全链（入站 downloadCode→下载→stage→image 块；出站本地图片→上传→单独发图）；**审批问答桥** `im/im-interaction.ts` + dispatcher（IM 会话 ask 档，交互转文本问答，回复旁路防死锁，9min 超时 deny）；per-bot 工作目录。29 IM 单测全绿。
- **钉钉/IM 与 Cindy 差距裁决（2026-09-18 核查留案）**：协议层同款（同 dingtalk-stream SDK/个人凭证/TOPIC_ROBOT）；Cindy 多出的属边界裁剪非欠账——IM 内审批问答（interaction.ts 文本问答桥，P2：需要在 IM 跑 ask 档任务时做）、IM 图片收发与流式卡片（lizi-im 885 行适配层，P2：手机发图给机器人的真实需求出现时做）、per-bot 工作目录隔离（多 bot 同机时再做）。
- IPC 错误已统一剥壳（2026-09-11）：preload `invoke()` helper 按 channel 精确剥 `Error invoking remote method <channel>: ` 前缀（`shared/friendly-error.ts` 的 `stripIpcErrorPrefix`，有单测），UI 只显业务原文。
- 文件夹拖入 composer；Canvas 未覆盖类型仍「用系统打开」。

---

## 8. 命令速查

```powershell
cd D:\Go\fundet-buddy
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

桌面测试覆盖：file-kind / file-name / preview-url / fs-local stage / collectArtifacts / search providers / search MCP 协议 / doc-text / IM dedup / IM turn-collector / 知识库分词分块 / 知识库 MCP 协议 / 真实画像登录态 / RPC 帧诊断 / BYOM compat 透传。

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

**第二段：四步闭环（先评估后动手；不移植也是裁决）**

1. **发现——固定节奏**：每周一次全量对照 + 每次发版前一次增量（Cindy 日均 30+ 提交，隔天增量约 20-30 个、半小时可审完）。`git fetch origin main && git log --oneline <上次同步点>..origin/main` 再按目录维度归纳。红线域（mobile / remote-desktop / codex / bots / teammates / device-link / Ghost / 账号云 / 订阅 / scheduler / skillhub / IM 云 / 项目管理 MCP）标题直接跳过。

2. **评估——git show 读透，三问**：①机制是什么；②**本仓同构吗——必须核对我们本地代码，不能信提交说明**（实证过：同源文件我们可能缺得更狠[#4518 桥控制面守卫]，也可能结构上已免疫[#4180 直插 DB / #4365 单端模型]）；③代价多大。产出四档：**P0** 安全欠账（立即移植）/ **P1** 小通用件（随下版）/ **P2** 条件触发（写明触发条件）/ **不适用**（结构不同构）。

3. **裁决——「不做」也要留案**：每项拒绝写明是**永不**（红线）还是**等触发条件**（例：MCP 网关化=用户自配外部 server 多了再做；媒体消息卡=出现真实音视频消息再做；TipTap 富文本=等用户反馈），连同理由记进下方核查段落，防重复评估。

4. **移植沉淀**：手工移植（**永不 merge/cherry-pick**）；**测试连着搬——Cindy 的测试即规格书**；**上游注释里的实测结论当规范继承**（最高价值情报，如 0.2.21 那次：本仓 redactSensitiveText 会吃反斜杠，遮蔽必须在脱敏前）；本地化四处必改：文案 `brand.name`、IPC 四件套、内部路径常量、git 主线 rebase 线性；验证走完整闸门（typecheck + 全量单测 + pi 集成 + dev:win 冒烟）后更新同步点。

**目录映射**（评估用）：maker-core→`packages/agent-core`、maker-shared→`packages/shared`、browser-control-runtime→`packages/browser-runtime`、lizi-mcps→`packages/browser-mcp`/`src/main/search`、desktop renderer↔renderer。

**特例**：`packages/browser-runtime` 是 vendored 整包（上游 openclaw，经 Cindy），按 `upstream/browser-runtime.lock.json` 整体同步 + 跑 SSRF 契约测试，不手工挑提交、永不过 rollup（见 §5 僵死坑）。

**上次同步点：c3fcefd49（feat(navigation) #4590，2026-09-18；窗口 f4422f816..c3fcefd49 已全部核查，裁决见下）**。

**节奏锚点**：下次 = 发版前增量 或 2026-09-25 周全量（先到者）。

**2026-09-18 核查（a15a240bf..c3fcefd49，23 提交）**：**已移植 1 项**——`2848dbf97` #4626 pi 启动失败诊断（pending 拒绝带脱敏+路径遮蔽的 stderr 尾部摘要；**本仓改造点**：sanitizeStartupDiagnostic 必须在 redactSensitiveText **之前**跑——本仓脱敏函数会吃反斜杠，顺序反了 Windows 路径先被搅碎；首个 RPC 响应到达即停收集；同日落地 efd9c70）。红线/不适用：navigation/teammates、remote-desktop 防窥屏、bots 伙伴通信、mobile、winget 入口（本仓 GitHub Releases+NSIS 无 winget 清单）、slider 家族统一（本仓 EffortSelector 是菜单形态非 slider）、「Cindy 项目管理工具」MCP 十连（任务/项目体系本仓无）。

**2026-09-17 核查（f4422f816..a15a240bf，134 提交，大头 mobile/remote-desktop/codex/bots/teammates/design-system 内部工具均红线）**：**必移植两项（同构文件已定位缺口）**——①`bc40023e7` #4493 translator 空 stop 修复：末次 assistant 消息 stopReason='stop' 但空文本时也要覆盖 `finalAssistantText`（否则 done.result 继承旧工具轮文本，IM turn-collector 读到陈旧回复）；**本仓 translator.ts:361 同款代码在**（`fullText.length > 0` 才覆盖），~5 行 + 测试。②`618cc8d25` #4518 两半：pi 桥**控制面写守卫**（PI_CODING_AGENT_DIR 内 models.json 等被模型改写 = MITM 端点劫持，上游改为即使 bypassPermissions 也强制确认；**本仓 vendored cindy-bridge-source.ts 完全无此守卫**，且本仓 subagent 无 durable 运行故 rg 拷贝半边不适用、extra dirs 未接 UI 故越界写语义半边低优先）+ **RPC 超限帧**（>16MiB JSONL 丢弃并精确 fail pending 的 get_entries，不猜 steer/abort；本仓 attachJsonlReader 无行上限）。**建议移植**：#4533 开机自启（IM 机器人要应用常开，天然配套，app.setLoginItemSettings + NSIS 清理）、#4544 分享卡片改 DOM 光栅化（html-to-image + 主进程原生写剪贴板，治 capturePage 失焦/最小化空图）、#4540 Vertex/Azure 预设（本仓 providerBranding/providerPresets 无这两族）。**可选**：Switch thumb 动效（eaac55cae）、#4620 注视会话排序优先、#4271+#4351 token 速度浮窗。**核查后不适用（勿重查）**：#4468 running 残留/#4520 中断横幅（他们的 projects/remote 多端 store 架构）、#4484 侧栏千条性能（本仓已窗口化）、#4351 单独无意义（本仓无速度功能）、#4591 computer-output 层（本仓 cua-driver 直通）、ab0a5bbe1 model-compat 网关层（本仓无）、auto-review 族持续演进均在 desktop auto-permission-reviewer 管线（与本仓 agent-core auto-review 不同构，维持 09-11 裁决）、#4437 原地加载项目 skill（本仓 pi 启动无 --no-approve 场景不同构，暂缓）、主题对比度 commit+revert 净零、worktree/Slack/Discord/ollama/iOS/Arch Linux 红线。**挂账项**：vendor lock b972feb3 未变（窗口内 browser-control-runtime 零提交）；网络守卫竞态、MCP 懒加载上游仍未落地；pi 版本未动（0.84.4）。

**2026-09-11 核查（50025e3c3..f4422f816）**：**候选移植①`abb822d9e` #4353 的看门狗活性语义——已于同日移植**（types/events.ts 新增 `isTurnWatchdogLivenessEvent` + session.ts 刷新点过滤 + turn-stall 测试 2 用例；agent-core 869 通过）。turn-stall 看门狗从「有任何事件」收紧为「有产品进展」：status/account_usage 心跳、纯空白文本不算，否则假心跳能把已死链路养到永不中断。划掉——`d432f6808` #4365 交互串线/丢失（device-link/mobile 多端回执机制，红线 + 本仓单端 pendingInteraction 模型不同构）；`219ccc685` #4375 isFinal 落第二行（本仓 message_end 直插 DB、无边界 flush/DUP-SKIP，结构免疫，同 #4180 裁决族）；`12bf45102` emitExtensionNotification 类型（本仓 pi/index.ts 无该符号，他们重构后产物）；`05a0d3188` #4404 open-path 归一化（remote 桌面/调度器多上下文管线的产物，本仓 FS_OPEN_PATH 5 行无此层）；retirement 四连（eb1a441b1/24539b921/116b0d6b2/278037275，Cindy 长驻 pi 宿主的退役生命周期，本仓 per-session spawn/close 不同构）；`81643467c` #4402 模型导入统一/a29518d9c effort 透传（多 harness/Chat translation 层，本仓无）。**功能候选入 §7**：#4356 深链接审核导入供应商配置+API Key（provider 一键分享导入）。**vendor lock b972feb3 仍有效**（browser-control-runtime 窗口内零提交）；网络守卫竞态、MCP 懒加载上游仍未落地，继续挂 §7。

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
