# Fundet 项目记忆（memory.md）

> 最后更新：2026-09-30（0.3.27 已发：记忆功能 + 内置生图 + Cindy P1×2 + 弹窗修复；同日 0.3.25 研究修复批/0.3.26 热修。详见 §3.5 版本行）。给任何接手的人/AI：**先通读本文再动手**——版本历史（§3.5）按时间记录每个版本的决策与教训，尾部「在途事项」段记录最新状态；再读 README.md（用户向）。
>
> 仓库路径：工作副本 `D:\Go\fundet-buddy`。**主远端 GitHub `xiaosen6/fundet`（remote 名 `github`，2026-09-16 起单线）；GitLab remote `origin`（172.16.56.11）已弃用但保留**——推送一律 `git push github`，别推 origin（会静默失败或断连）。**活跃分支 `main`**；`master` 是收编的落后占位历史，不要在上面开发。
>
> **品牌（2026-09-21 换新）**：本产品是 **Fundet**（山东未来互联科技的本地 AI 智能体）。Logo 为**红色头盔小宇航员吉祥物**（圆形透明角全套：`resources/fundet/icon.{ico,png}` + renderer favicon + `assets/logo-fundet.png`）；字标 **FunDet 斜体粗体红字**（#c8102e，三处统一：欢迎页/新会话 lockup/侧栏左上）。历史：曾用红球经纬线 logo（旧资产 `logo-raw.png`/icon.svg 还在 resources/，已不用）；曾一日改名「未灵 Weiling」后按用户拍板回退——技术标识（appId com.fundet.app / userData %APPDATA%\Fundet / GitHub 仓）从头到尾没动过，**改名类需求先看 §3.5 的 0.3.0 行**。构建系统（`shared/brand.ts` + BRAND 环境变量）保留 longma 变体分支——一切开发/构建/发版都是 Fundet，**不要动变体分支，不要用它出包**。
>
> 历史命名：仓库/包名大量使用 `fundet`（`@fundet/agent-core`、`window.fundet`、`FUNDET_*` IPC）——这些是本项目主命名，保持即可。

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
- UI 视觉对齐 Cindy（0.3.0 起亮色=Cindy Light 原值冷灰白、暗色=CINDY Dark 原值；新会话空消息态=Cindy 首页布局），品牌是小宇航员圆形 Logo + FunDet 斜体红字标，文案中文。自我介绍：**「你是 Fundet，一个运行在本地的 AI 助手」**。
- **不要做成 Cindy fork。** 不搬：账号/OAuth、Ghost 插件、Office、设备互联、IM 云、语音、Claude Code/Codex harness。（原「不搬」清单里的定时任务、SkillHub 市场已在 0.3.0 按用户要求实现——自动化=宿主层调度非插件沙箱，技能集市=接 skillhub.cn 公共市场。）

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
| 知识库 | **纯语义检索（0.3.16 起）**：向量余弦 TopN（演进史：纯 FTS5 → 混合 RRF → 纯语义，均用户拍板）；导入 PDF/DOCX/TXT/MD，会话绑定后注入内置 knowledge MCP |
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
│   │   ├── resources/fundet/    # 小宇航员圆形 logo 全套（ico/png；旧红球资产 icon.svg/logo-raw.png 已不用）
│   │   └── dist/                # 安装包产物
│   ├── pi-bin/<plat>-<arch>/    # Pi 运行时（gitignore；缺 theme 则 RPC 即崩）
│   ├── ripgrep-bin/             # rg 二进制（gitignore，update.mjs 现下）
│   ├── cua-driver-bin/          # cua-driver（gitignore，update.mjs 现下）
│   └── git-bin/win32-x64/       # 裁剪版便携 Git Bash（gitignore，update.mjs 现下；无 Git 客户机兜底）
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
| 0.3.27 | 09-30 | **记忆 + 生图两大功能 + Cindy P1×2 移植**。①**记忆功能上线**（用户拍板「开吧，IM 共享，面板高级点」）——Maker Memory 纯本地按工作目录分仓（.md 分片+MEMORY.md+FTS5），4 类 curated+digest（pi 压缩自动沉淀）；默认开（`memory.enabled`）；内置 `fundet-memory` MCP **渐进式发现两入口**（list_tools/call_tool，~200 token，防小上下文顶死）+六内工具（review 不暴露：PiAgent 无 oneShot）+auto-approve；pi 会话不注入记忆段（MCP 自学，Cindy pi 同路径）；**IM 共享主目录仓**（agent-core 新 `memoryScopeDir` 选项解耦文件目录与记忆作用域）；侧栏「记忆」面板（hero+开关+文件夹、多仓 chips、FTS 搜索、新建/编辑/删除；**UI 三轮用户反馈迭代：新建极简到一个输入框、类型四分类全面退幕后（过滤/徽标/摘要字段全撤，仅助手自动记用）、空仓可用**——主目录仓恒在列+打开文件夹先 mkdir；真机 e2e PASS）；IPC +9（INVOKE 137）。**坑位**：setEnabled 用 enable({skipAgentSync:true}) 防 setMemory(false) 误杀 digest；#2399 worktree 归一化延后（无场景）。②**内置生图工具**（用户拍板「随时对话生图，留口后接其他服务」）——`fundet-imagegen` MCP 单工具 generate_image（prompt+size 256..3072 默认 1024²，timeout 5min）；**ImageGenProvider 注册表留扩展口**（后续接 CogView/万相只加 provider）；v1=自建网关 Qwen-Image-2.1（b64_json，与语音同 gatewayUrl）；产物落 `<workdir>/fundet-images/`（魔数定扩展名）；`imagegen.enabled` 默认开无 UI；auto-approve；**真实网关生图实证**（200→4.2MB PNG ~31s）。③**Cindy #5256/#5202 移植**——交互卡快捷键让位（问答卡数字键裸奔/审批卡「拒绝」上回车变「允许」实锤修复）+ FindBar no-drag（含拖拽区「先序上报靠后者胜」规则修正）。④供应商弹窗恢复点外关闭（回退 0.3.20 #5104 移植，用户拍板）。验证：typecheck 全绿/277/277/agent-core 878/IPC 137/0/build ✓。**已发**（tag=61495cf，三资产齐 exe 250,281,146B/blockmap 264,058B/latest.yml 352B，sha512 与本地一致（gh release download 比对），gh-proxy 镜像 200、exe Range/直连遇网络波动窗（0.3.20 同款）以 API 通道补验；merge-base 验证过；备份 D:\Fundet-Setup-0.3.27-x64.exe；树外隔离冒烟 PASS；**release+ci 双工作流全绿（release 第三连），资产时间戳未动=CI 不再覆盖持续实证**） |
| 0.3.26 | 09-30 | **发版后热修两件（用户实报「完成提醒消失 + 语音转出韩文乱码 그」排查批的产物）**。①**完成提醒注视判定加固**——抽纯函数 `completion-notify-logic.ts` 的 `isWindowWatching`：**最小化的窗口必提醒**（即使 Electron 焦点簿记未清、isFocused 仍 true 也不算注视），+4 单测入 glob；此前 `isVisible()+isFocused()` 与 0.3.23 诞生时逐字相同，非回归。②**语音输入静音检测**——`wav-encode.ts` 渲染后测峰值，peak<0.005 直接抛中文指引（Windows 麦克风隐私关掉「允许桌面应用访问麦克风」时 getUserMedia 不报错、只交全零数据，直送 ASR 会转出随机字符——**本机探针实锤 RMS=0.00000/peak=0.000 → ASR 返回 "그."，与用户截图一字不差**；根因在系统设置非应用，此防御把天书变可行动提示）。**排查记档要点（详见 §6 09-30 下午块）**：两项功能在发布二进制端到端验证均正常（chime=1/转写准/麦克风 webm 管线通/ASR 16k-24k 全格式正常）；**探针新坑**：最小化类探针必须等页面加载完（revealWindow 挂 did-finish-load 会把加载期最小化弹回）+ 跑探针前必清残留 electron 实例（second-instance→focusMainWindow 恢复窗口）。**已发**（tag=22e13a0，三资产齐 exe 250,271,674B/blockmap 264,300B/latest.yml 352B，sha512 与本地一致，直连 latest.yml 200+gh-proxy 镜像 200+exe Range 206，备份 D:\Fundet-Setup-0.3.26-x64.exe；树外隔离冒烟 PASS——双窗口/fundet.db/git runtime 落位/自有 crashpad 零残留；ci 工作流连续两次全绿）。验证：typecheck 全绿/256/256/IPC 128/0/build ✓ |
| 0.3.25 | 09-30 | **全仓代码研究修复批（16 项，含一次发版通道事故处置）**。①**【P0】CI 覆盖发版资产事故**——0.3.21 起 release.yml win job 不下载 git 运行时且 `--publish always`，人工上传验证完 ~2 分钟被 CI 缺 git 包（-86.5MB）静默覆盖（v0.3.21~24 线上资产 163~175MB vs 本地备份 250~261MB 实锤；mac job icon 256<512 恒红连累 run 标 failure 掩盖了「win 实际成功并发布」，旧结论「CI 从未成功出过包」失效）；修=CI 两 job 改 `--publish never`（**pnpm run 的 `--` 透传 Windows 下带脏参数，CI 直调 `pnpm --filter fundet-desktop exec electron-builder`，pack-browser-deps 在 CI 显式单步**）+ win job 补 `tools/git/update.mjs`；本版起发版资产不再被覆盖，0.3.21~24 存量用户经本版全量包自愈（勿再单独重传历史资产）。②**【P0】HEAD typecheck 红**——bdd8667（0.3.20 windowsHide 测试）TS2352，0.3.20 起一直红、ci.yml 全红源于此；修 `as unknown as`。③**P1×5**：供应商「扫描模型」丢 maxTokens/视觉 input（编辑弹窗+主面板两处，按 id 保留旧值）；mermaid 暗色失效（检测 `classList('dark')` 而主题写 `data-theme`，MutationObserver 同错）；微信 notifyStart/飞书 `void ws.start()` 失败=unhandled rejection+假在线（connected 移到连接成功后）；ask_user/plan 审批无超时+会话关闭不清理（三类交互统一 10min 兜底、ask 超时空答案与 IM 桥同口径、closed/error 清条目）；自动化任务遇终止 error 白等 10min（done/终止 error 先到先落）。④**P2×8**：fork 历史补 FTS 伴生写；语义检索网关故障改上抛（MCP 工具如实告模型「检索失败≠未命中」，auto-RAG catch 跳过注入）；微信扫码取消走 stopWechat+qrCanceled（防授权落定后自动开跑）；AVX2 预检 spawn 补 error 监听；electron-builder 顶层 cua-driver 残留条目删除；mac icon 换 icon-512.png（renderer logo-fundet 512 版）；shared/knowledge.ts BM25 注释方向修正；拖入界外文件 1GB 拷贝上限+删自动化补确认框。⑤**P3**：死代码清理（getSessionKnowledgeKbs/normalizeMediaDownloadUrl/isTurnRunning/minor<0 死条件/dev-desktop.sh 旧路径）+ browser-runtime 三份文档加「2026-09-30 路径更正」横幅 + browser-mcp 注释路径。IPC 规模修正 INVOKE 128+PUSH 14+pet 10。**已发**（tag=e5d4283，三资产齐 exe 250,271,410B/blockmap 264,209B/latest.yml 352B，sha512 一致，直连 latest.yml 200 + gh-proxy 镜像 200 + exe Range 206，备份 D:\Fundet-Setup-0.3.25-x64.exe；树外隔离冒烟 PASS——进程存活/主窗+Fundet Pet 双窗/fresh userData fundet.db+**随包 git 首启解压落位**/自有 crashpad 零残留；**release 工作流史上首次全绿 4m34s（win 补 git 后构建完整/mac icon 修复），且完成后资产时间戳不变=不再覆盖实证**；发版后补修 Linux CI 两个平台用例 e38675b——real-profile 显式传 win32、git-runtime-logic 用 path.join 拼测试键，**ci 工作流转绿**，此前被 typecheck 红挡住从未跑到属存量失败；测试仍 252/252） |
| 0.3.24 | 09-29 | **供应商体验批（用户实报两件）**。①**Key 非法字符校验 + 天书错误友好化**——用户实报 OpenRouter 填 Key 扫描报天书「Cannot convert argument to a ByteString…index 7…36825」：36825=「这」的码点，HTTP 头拒绝非 Latin1，`Bearer ` 恰 7 字符 ⇒ **Key 以「这」开头**（复制带上说明文字）。`host/provider-models.ts`：Key trim 后非可见 ASCII（`/[^\x21-\x7e]/`）提前拦截给中文指引；fetch catch 里 ByteString/255 类错误统一翻译同款文案（防御纵深，扫描/向导/编辑弹窗三条路共用此函数全覆盖）。②**「扫描模型」改真按钮**——编辑供应商弹窗原为裸文本不像可点：描边 pill + ScanSearch 图标 + 扫描中 spinner + disabled。typecheck/test 252/build 全绿。**已发**（tag=d6a7892，三资产齐 exe 250,271,125B/blockmap 264,316B/latest.yml 352B，sha512 一致，直连+gh-proxy 镜像双 200，备份 D:\Fundet-Setup-0.3.24-x64.exe；树外隔离冒烟 PASS） |
| 0.3.23 | 09-29 | **桌宠提醒 + 桌宠误报修复 + 奔跑 v3**。①**完成提醒（音效 + Windows 系统通知）**：turn 终态（done/终止 error 统一口径）且主窗失焦/隐藏时——系统通知（silent，点击=聚焦主窗切到该会话）+ 应用内 chime（WebAudio 双音零资产，3s 节流）；`AppUserModelId` 补设；开关=设置→桌宠「完成提醒」（默认开）；IPC +2+2（通道 128）。端到端探针双向 PASS（失焦触发/聚焦静默）。②**桌宠左键新对话误报修复（用户实报 0.3.22 仍现）**——0.3.19 的 stale closure 修复**漏改 `onPetNewChat` 调用点**（只改了截图路径），左键至今用首渲染空 providers 闭包弹「请先在设置页配置 provider 和模型」误导提示；本版改走 `createSessionRef` + **providers 就绪门控** `whenProvidersReady()`（启动后 listProviders 未返回的窗口期桌宠动作等待就绪，8s 兜底放行），截图入口同门控。其余调用点核实均新鲜闭包。③**奔跑素材 v3（IP 锚定两步法，用户方案+用户验收）**——v2 纯 t2i 形象非公司 IP 被否决后回炉：idle_08 → img2img 生成黄金参考（标准站姿）→ 以黄金参考为锚逐姿势 img2img（腿步态相位+手臂对侧摆）；帧间差异 34.8（旧微动版 15.7），循环闭合差 25 可首尾相接；`rung_00..05` 接入 running（6帧@75ms 硬切），旧 run 14 帧微动版保留可回滚。生图管线 v2 全记录见 §4.11（网关 `/v1/images/edits` multipart 图生图 + `/v1/images/generations` JSON t2i，正解配方=纯 t2i+固定 seed 族+文字锁形象+每帧一个姿势句，两步法解形象/动作矛盾）。**已发**（tag=625d7db，三资产齐 exe 250,270,710B/blockmap 264,361B/latest.yml 352B，sha512 一致，直连+gh-proxy 镜像双 200，备份 D:\Fundet-Setup-0.3.23-x64.exe；树外隔离冒烟 PASS） |
| 0.3.22 | 09-29 | **安装提速批（asar 化，根因=文件数×每文件固定开销：实测 5,622 小文件 11.3s vs 单 85MB 文件 93ms）**。①**浏览器闭包并入 app.asar**——electron-builder `files` 加 `{resources-browser/node_modules → node_modules}`（不碰依赖收集器），删 extraResources 散装，`asarUnpack` 加 `@img/**`（sharp 原生 dll）；可行性由 **spike 五项全绿**（Electron 37 asar 内 ESM 入口/裸包 CJS/ESM/exports/子目录解析）+ **CDP 会话级探针**（loopback provider+browser.enabled 种子，sendMessage `accepted:true` 实证 SDK 从 asar 动态加载；打包应用屏蔽 NODE_OPTIONS 故走真会话链路）双重实证。②**闭包裁剪 pass**——`.ts/.mts/.cts/.map/.md`/license/测试目录不进包（typebox 单包 690 个 .mts），5,622→2,748 文件。③`electronLanguages:[zh-CN,en-US]`（locales 55→2）。**产物对比：安装目录 6,029→363 文件（-94%）、安装包 261.6→249.6MB（-12MB）、总体积 733→668MB、app.asar 56→78MB、asar.unpacked 126 文件**；树外冒烟 PASS（robocopy 从 ~40s 降到数秒）。**已发**（tag=c761421，三资产齐 exe 249,600,329B/blockmap 263,313B/latest.yml 352B，sha512 一致，直连+gh-proxy 镜像双 200，备份 D:\Fundet-Setup-0.3.22-x64.exe；树外隔离冒烟 PASS） |
| 0.3.21 | 09-29 | **pi 跟版批**。①**pi 例行跟版首跑（新惯例，见在途事项锚点）**：评估升 0.87.1 → agent-core 集成套件拦截图片附件回归 → 取证为**上游调试遗留 bug**（`resizeImage` 内 `if (true)` 先试相对路径 worker `./src/utils/image-resize-worker.ts`，编译 exe 中不存在且失败返回 null 不抛异常 → 直接 return null，进程内回退不可达 → 图片附件全变 `[Image omitted: …]`，视觉发图全灭；显式 inputLimits 无效、photon wasm 非根因）→ **回滚 0.84.4**（878/878 复绿），等 0.87.2+/0.88 修复再跟；跟版门禁=pi-agent.integration 两个图片用例。②**pi 版本检测提醒（应用内热更评估的替代，只读不热更）**：`host/pi-version.ts`（spawn `pi --version` 缓存 + 上游 `releases/latest` 302 Location，gh-proxy 前置/直连回落/8s 超时/24h 缓存/失败静默）+ IPC `pi:version-info` 四件套（通道 **126**）+ UpdateCard 新增「Agent 运行时（pi）：0.84.4 · 上游最新 v0.87.1（将随下版应用更新带来）」。③update.mjs 两修：`FUNDET_GH_PROXY` 镜像前缀（digest 校验保留；当日直连两轮超时实锤）+ pin 分支收尾日志 `requestedVersion` null 崩溃。**已发**（tag=68b3182，三资产齐 exe 261,649,438B/blockmap 274,725B/latest.yml 352B，sha512 一致，直连+gh-proxy 镜像双 200，备份 D:\Fundet-Setup-0.3.21-x64.exe；树外隔离冒烟 PASS） |
| 0.3.20 | 09-29 | **Cindy 同步批（§9.5 2026-09-29 全量核查的 P1×2 + P2×3，同步点 cc52aed2d）**。①**桌面 ask_user_question 问答卡（P1，#5198 移植）**——此前 ChatPage 只认 permission，模型追问无卡可点、turn 挂死到 abort；新 `AskUserQuestionPrompt`（多题步进/上一题/跳过 Esc/单选点击即进/多选 JSON 数组串/宿主自供自由输入行/数字快捷键；未移植滑页动画/最小化/草稿持久化，切会话丢进度 v1 接受）+ `shared/ask-options.ts`（剔除模型自造「其他（回复说明）」式选项，+4 测试）+ IM 文本桥同口径过滤（+3 测试）+ sessionStore.resolveAskUser，零新增 IPC。②**pi spawn windowsHide（P1，#5173 同构）**——agent-core rpc-client 补 windowsHide（+vi.mock 选项测试）+ 主进程扫尾四处（mcp-bridge stdio 代理/探测、cua 遥测、AVX2 预检）；复扫「全仓零命中」系 grep 截断误判（dws/checkpoint/git-runtime 原本就有）；pi 子进程内部 spawn 继承 pi 控制台不加。③表单弹窗防误关（#5104）——仅有的两个 Radix Dialog（AddProviderWizard/ProvidersPanel，均带 API key 表单）加 onInteractOutside preventDefault（Esc 仍可关）。④建议卡悬停预览 prompt（#5120，Tooltip side=top）。⑤用量柱图/热力图原生 title 换自绘悬停浮层（即时/元素矩形锚定防 mousemove 重渲染/useLayoutEffect 实测钳制视口/柱图带模型分解色点行）——复扫「无任何悬停」为 grep 错文件名的误判，本项是原生 title→样式浮层的升级。测试 245→252；agent-core 878/878。**已发**（tag=847d6a8，三资产齐 exe 261,638,772B/blockmap 274,734B/latest.yml 352B，sha512 与 latest.yml 校验一致，gh-proxy 镜像 200；直连两轮超时=发版时本机网络波动时段——0.3.19 一小时前直连 200、URL 同构、资产端点 uploaded，updater 主通道本就是 gh-proxy），备份 D:\Fundet-Setup-0.3.20-x64.exe；树外隔离冒烟 PASS——「Fundet」/「Fundet Pet」双窗口标题均出现、fresh userData DB+git-runtime 落位、零自有 crashpad 残留 |
| 0.3.19 | 09-29 | **修复批 + 清理批（全仓复扫驱动，详见 §7 2026-09-29 复扫块与 §6 在途事项）**。①**桌宠联动 stale closure（0.3.18 实发缺陷根修）**——pet 订阅 effect deps=[] 捕获首渲染空 providers 的 createSession：左键新对话/右键截图的「强制新建会话」自 0.3.18 起静默失效（截图注入当前会话）；createSessionRef 修（workDirRef 同款）。②**预热指纹对称**——prewarm 侧补真实 KB 绑定/browser/computer 开关（此前开了开关的用户预热必失配→discard 重建白做）。③**微信入站图片**——ilink `transport.downloadMedia`（AES key/CDN 兜底随消息体，无需额外 ticket）入队前逐张下载落 `.fundet-uploads`（与钉钉同款），纯图/图文混合都进回合，下载失败**文字降级**告知模型不静默；新 `im/wechat-inbound.ts` 纯函数 +10 测试；wechat-ilink mediaTransfer/mediaCrypto 转正。④**知识库 URL 快照逐跳 SSRF 复审**——`url.ts` 新 `fetchGuarded`（`redirect:'manual'` 手动跟随、每跳重过 assertPublicHttpUrl、20s 总时限不放大、fetchImpl 可注入），原 `redirect:'follow'` 可被公网 302→内网绕过；+5 测试。⑤桌宠补强：审批/问答弹窗 notify（原 interaction_request 是不可达死分支——审批走 setInteractionListener 独立通道，新增 bridgeInteractionRequest 接线）、截图按光标所在屏 display_id 匹配（sources 顺序不保证）、broadcast 跳过 pet.html 窗口。⑥**清理批**（净删 ~520 行+27 张 sprite+死 tar.gz 段）：UsageDashboard 死组件/kb FTS 残留（kb_fts DROP 清存量表）/pack-browser-deps 死产物段/PET_SIZE 等零碎/注释漂移全修（LongMa 调试台、[longma:] 前缀、FUNET_ typo 等）/测试 glob 补两孤儿套件（filePathPolicy+providerBranding 14 项）；测试 219→245。**已发**（tag=42e3f03，三资产齐 exe 261,635,864B/blockmap 274,846B/latest.yml 352B，sha512 与 latest.yml 校验一致，直连+gh-proxy 镜像双 200，备份 D:\Fundet-Setup-0.3.19-x64.exe；树外隔离冒烟 PASS——无启动崩溃、主窗+Fundet Pet 双窗口创建（窗口标题轮换「Fundet Pet」↔「Fundet」证实，单进程多窗不能按句柄计数）、fresh userData 首启 fundet.db+git-runtime 解压落位、无冒烟自有 crashpad 残留） |
| 0.3.18 | 09-28 | **已发**（三资产齐 263,155,879B，直连+gh-proxy 镜像双 200，备份 D:\Fundet-Setup-0.3.18-x64.exe；隔离冒烟 PASS——无启动崩溃、Fundet Pet 窗口创建、pi/DB/IM 正常）。**桌宠首发 + 0.3.17 静默回归修复**。**①桌宠**：透明置顶小窗（128px/skipTaskbar/穿透 hover 恢复）；左键=新对话、右键=截图问答（强制新建会话携带截图，pending 附件槽穿会话清空）；拖动=14 帧奔跑循环+朝向随方向翻转（松手即停）；待机=静止帧+极轻漂浮+呼吸+偶发眨眼/跳跃（Shimeji 模式）；agent 事件联动（thinking/notify）；设置页「桌宠」栏开关（pet.enabled 持久化）。**②动画策略定稿（三轮迭代教训）**：生图帧间本体形变不可消除（相邻帧 diff~5000px，配准无效）→循环待机不做轮播；快速单次动作（notify/奔跑）轮播可行（运动感掩盖形变）；帧推进用独立 setInterval（RAF 会被 setPosition 高频移动暂停）。**③素材管线**：网关 Qwen-Image-2.1 密集帧 sheet（idle11/thinking10/notify11/run14，提示词强制同地面线+等大等距+相邻帧微变）+ 内容感知切帧 v2（列投影+碎片并入相邻主体+底对齐高度归一+泛洪去背）。**④0.3.17 静默回归修复**：a3a7ea2 误删 20 个 IPC handler（fs 全家/voice 全家/open-external/kb-session/kb-search/kb-pick）全量恢复——文件拖入/粘贴图片/截图注入/语音/知识库检索自 0.3.17 起静默失效；审计脚本入库 tools/check-ipc-channels.cjs（发版前必跑）。**⑤发版坑**：electron-builder.yml 里 JS 风格 `//` 注释（桌宠 MVP 提交带入）致 YAML 解析炸——yml 只认 `#`。219/219；IPC 审计 125/125 |
| 0.3.17 | 09-28 | 已发（tag=2d02a60，三资产齐，镜像复核，备份 D:Fundet-Setup-0.3.17-x64.exe；隔离冒烟 PASS）。**知识库纯语义检索（用户拍板去除关键词检索）**——向量余弦 TopN 单路；移除 FTS 榜/kb_fts 写入/RRF/「升级语义检索」按钮/回填 IPC 四件套；导入后自动向量化保留（进度显示+完成自动刷新计数）；服务不可达返回未命中。**缓存命中率侧**：服务端已透出 prompt_tokens_details 结构（实测仍 cached=0——vLLM 前缀缓存未真正生效或被双副本 LB 稀释，已反馈运维确认 --enable-prefix-caching）；Fundet 侧链路（pi 解析→translator→用量页）已验证就绪，服务端命中后自动显示。219/219 |
| 0.3.15 | 09-27 | **【事故修复紧急发版】回滚浏览器依赖 tar.gz**——0.3.14 启动即崩（ERR_MODULE_NOT_FOUND @modelcontextprotocol/sdk）：主 bundle ESM 入口静态 import 在进程启动瞬间解析，首启解压代码尚未执行；**冒烟假阴性根因=打包产物在仓库树内，ESM 向上解析命中开发机祖先 node_modules**——打包版冒烟必须把 win-unpacked 复制到仓库树外隔离运行（新铁律）。影响所有 0.3.14 装机；**崩在更新器之前无法自愈，用户须手动装 0.3.15**（gh-proxy 手动分发链接）。恢复 node_modules 散装目录；git tar.gz 不受影响（PATH 机制）保留；安装期文件数 405→~5,400（仍比 0.3.13 少 62%）。|
| 0.3.14 | 09-25 | **①技能安装护栏放行大包（用户实报「>50 报错」）**——真凶是安装校验 MAX_FILES=50（搜索侧本无限制、固定 30 条）：官方 dingtalk-misc 实测 **122 文件/1.5MB** 被「文件数超上限」拒装；上限校准 files 50→**300**、体积 5MB→**20MB**（防穿越/SKILL.md 校验不动；注意技能包不能「截断文件」——截了就残废，用户口径的截断按放行实现）。**②安装慢第一刀：asar 死重清除**——解剖发现 app.asar **189MB/14,362 文件**塞满渲染层依赖全量包（mermaid 系 113MB+katex 系 14MB，vite 早已打包、asar 里纯副本，连 __tests__/.eslintignore 都在）；六个纯渲染依赖挪 devDependencies（@tanstack/react-virtual/katex/mermaid/rehype-katex/remark-cjk-friendly/remark-math；**qrcode 主进程在用必须留**）；安装包 **288.6→258.3MB（-30MB）**、asar 189→53MB、文件数 14,362→5,190（用户机解压+Defender 扫描量同比减）。**③打包确定性修复：`win.signAndEditExecutable: false`**——四连 EBUSY 根因=eb26 的 signtool 逐个锁 exe 改版本资源（rcedit 替代品，我们没证书这步纯装饰），与 extraResources 拷贝重试竞态，慢日确定性撞死；关掉后打包 10min→2.7min 且无轮盘赌。**遗留提案（安装慢的下载侧，部分已落地）**：④Git Bash 改按需下载（再 -86MB，dws 镜像同款链路，仍待拍板）；⑤**更新源国内加速已落地（gh-proxy 中转）**——`shared/updater-source.ts`（compareVersions/decideUpdateAction 纯函数 4 测试）+ updater.checkWin 双源：gh-proxy 查 latest API（8s 超时）→ 有新版走 generic feed `gh-proxy.com/https://github.com/.../download/<tag>/`（**Range/断点实测 206**，差分下载可用）→ 代理失联/无新版回落 GitHub 原生 provider（= 旧行为不更差）。**Gitee 镜像方案已试并放弃：免费版单附件上限 100MB，258MB 安装包传不上**（Gitee 仓 sun-jisen/fundet-app 已建作占位，若未来上付费 Gitee/对象存储，换 proxyFeedUrl 一个函数即可）。**⑥安装慢根因实测与第二刀（09-25 下午，用户澄清痛点=点安装包后的本地安装）**——实测归因：**每文件固定开销（写盘+杀软逐文件扫描）主导**，非体积（pi 111MB/194 文件拷贝 0.2s vs git 264MB/**2,518 文件** 3.1s vs browser 依赖 51MB/**5,000 文件** 3.8s；弱机+激进杀软放大到分钟级）；**git 改单文件 tar.gz 随包**（`tools/git/update.mjs` 产 `win32-x64-runtime.tar.gz` 85MB；extraResources 只带 tgz+git.version 两文件；首启 `ensureBundledGitRuntime`（host/git-runtime.ts，bsdtar 解到 userData/runtime/git，60s 上限，按 VERSION 标记幂等，失败静默=无随包态）在 createWindow 后 Splash 遮面下执行；resolveBundledGitRoot 打包态改指 userData/runtime/git；安装期文件数 **-2,516**，包体积持平 248MiB；tar.gz 85MB 与 NSIS 压缩等价、deflate/zip 只有 210MB 不可用）。**第三刀已落地（09-25 晚）**：browser 依赖 ~5,000 文件 → `browser-runtime.tar.gz` 14.7MB 单文件随包（pack-browser-deps.mjs 末尾产 tgz+版本文件；**坑：bsdtar 经 node spawn 吃反斜杠路径必炸 exit=2，参数一律转正斜杠**）；首启解回**安装目录 resources/node_modules 原位**（主 bundle 是 ESM，裸引用 @fundet/browser-runtime 与 MCP SDK 靠 node_modules 向上解析，globalPaths/NODE_PATH 对 ESM 无效只能落原位；每用户安装目录可写，无写权限降级提示重装；自动更新后标记失配自动重解）。安装期文件数累计 **14,500→~6,000**。**⑦语音输入（用户拍板并入 0.3.14）**——公网网关 `111.34.136.32:16668`（10.7.0.95 同源）实测三服务全通（ASR TTS 闭环只差一个同音字、嵌入 2560 维无关句 0.265、TTS 2s/短句）；`host/service-gateway.ts` 统一客户端（transcribeAudio/synthesizeSpeech/embedTexts/probeGateway，地址可配 settings）；ChatInput 麦克风按钮（Cindy 同款 Mic 图标；录音态红脉冲+计时、25s 自动停=ASR 30s 无 VAD 上限留余量、Esc 取消、转写插入光标处）；`lib/wav-encode.ts`（webm/opus → 16kHz mono PCM16 WAV，SenseVoice 不收 webm）；权限处理器放行 media。**⑧TTS 朗读**——assistant 消息操作栏 Volume2 三态钮（合成中 spinner/播放中可停），data:audio/wav 播放，2000 字上限。**⑨知识库语义检索（用户主动升级 2026-09-10 的「纯 FTS5」拍板）**——混合不替换：FTS5+向量 RRF 融合（`knowledge/embeddings(-logic).ts`；kb_chunks 幂等补 embedding BLOB 列 2560×f32=10KB/块暴力余弦）；查询侧指令前缀（Qwen3 官方建议）；导入/笔记/快照后自动后台向量化（失败静默）；存量库「升级语义检索」按钮回填（kb:embed-progress 推进度，embeddedChunks 进 KB 列表视图）；**服务断自动降级纯关键词（检索永不死）**；searchKnowledgeChunks 转 async（MCP/auto-RAG/召回测试全链自动生效）。设置通用页新增「语音与语义服务」区（开关+网关地址+保存并测试）。219/219（+3 嵌入纯函数）；vite build 双链过。**⑩当日三修（用户实测反馈）**——①启动字体大：Chromium 按域名持久化 zoom，上次最大化的 1.25 被记住、重启普通窗口也顶着大字号；修=did-finish-load 按当前窗口状态复位（applyZoom 抽公共函数）。②语音按钮不见：用户误拨设置开关 voice.enabled=false 落库（一拨即写）；修=**删「语音与语义服务」设置区、按钮常显**（用户拍板不要该设置显示）。③语音按钮形态对齐 Cindy 原版：位置改**发送键左侧**（右侧工具组；Cindy 有「语音按钮位置守恒」注释）、30px 描边圆钮常驻（bg-composer-pill/border-board）、录音红点呼吸+计时胶囊 220ms 宽度形变（pillLabelRef 量宽同款）、转写 spinner；CDP 实测 30×30/间距 8px/展开 56px「1s」。**待用户实测→发版（九件套）** |
| 0.3.13 | 09-24 | **四件**：①草稿预热（`host/session-prewarm`：建草稿即后台 createSession，指纹=provider+workDir+KB+自动操作开关、模型热切、TTL/显式弃/启动清三兜底、探针实测 spawn 2.1s）；②FS_OPEN_PATH 类型闸（26 可执行扩展拒 shell 打开）；③文件夹拖入=切工作目录；④最大化缩放锚定设计基线 1280（修「窗口大时最大化不放大」——旧算法按当前窗宽算比率）。发版历经打包机楔子（crashpad 锁 app.asar，重启解决），详见 09-24 在途事项段 |——`host/session-prewarm(.ts+-logic.ts)`：建草稿/换工作目录即后台 createSession（id=草稿 id、占位标题），ensureSession 见活会话自动接驳（模型变了 setModel 热切；模型**不在**指纹）；指纹=provider+workDir+KB 绑定+browser/computer 开关，漂移弃旧重建；生命周期三兜底（60s 巡检 TTL 5min 零消息回收 / 显式 discard IPC / 启动清占位零消息行——硬杀实测 pi 随父自灭+重启孤儿行被清）；只管 records 登记的会话，真实会话永不碰；失败静默回落 lazy-create；建/删广播 session:list-changed。探针实测预热 spawn **2.1s**（页缓存热，即首条最多省 2-6s）。**②FS_OPEN_PATH 类型闸**——filePathPolicy `isShellExecutablePath`（exe/bat/cmd/ps1/msi/vbs/js/jar/lnk 等 26 扩展），「用系统打开」不再执行类载荷（堵 agent 产出 .exe 点开即跑的口子）。**③文件夹拖入=切工作目录**——file-drop `firstDroppedDirectoryPath`（webkitGetAsEntry 目录判定+webUtils 路径）+ ChatPage applyWorkDir+toast，遮罩文案区分，删旧「暂不支持」提示。209/209（+6+1）。**④最大化缩放锚点修正（09-24 用户实报「全屏没放大」）**——旧算法比率=最大化宽/**当前窗宽**，窗口平时开得接近全屏时比率≈1 不放大（dev+打包双复测均「正常」，根因是场景依赖）；改锚**设计基线 1280**：zoom=clamp(最大化宽/1280, 1, 1.25) 0.05 步进，与最大化前窗口大小无关、效果稳定；复现场景实测（先拉大 1600 再最大化）1.5→1.875 稳定放大、还原回位。**冒烟种子新坑**：db+keys/ 仍不够——**safeStorage 密文绑定 userData 的 Local State（os_crypt 档案密钥），跨 userData 测 key 必须连 Local State 一起拷**；另 provider 要选 enabled 模型（listProviders 含禁用项，pi 拒服务端不在册模型）；订阅型 provider（GLM Coding Plan=OAuth）静态 key 测不了 |
| 0.3.12 | 09-23 | **两修（用户实报，用户实测速度认可）**：①**IM 会话权限改完全放行**——用户微信对话实报：agent 请求权限时微信侧看不到审批卡，一直卡到超时 deny；dispatcher `permissionMode: 'ask'`→`'bypassPermissions'`（memory §4.7 原记 auto 亦漂移，代码实为 ask；桥保留 ask_user_question 问答 + agent-core #4518 控制面强制确认两兜底通道）。②**钉钉查询速查表直进 system prompt**——用户实报「查张章邮箱」先翻技能文件再 dws-help 慢两拍；新增 `host/dws-prompt.md`（内容提炼自本机真实 dingtalk-* SKILL.md 的 shortcut 表+SOP：aisearch person 维度参数/contact user get/calendar +today 族/room-find/todo +get-my-tasks/chat +unread-chats/oa approval list-pending，附「直接执行勿先读技能文件」「--format json」「写操作确认后 --yes」契约），pi-host `buildRuntimeConfig.systemPrompt` 改 getter 每会话求值（agent-core startSession 现读 pi/index.ts:1056）：`isDwsCliInstalled()` 轻量探测（~/.local/bin/dws.exe 落点 + cmd /d /c where dws，进程内缓存，应用内新装 dws 需重启）命中才拼接——没装钉钉的用户零 token 开销。技能文件保留为冷门场景备查（不卸载）。实测法：微信发一条要权限的指令应直接执行不卡；新会话问「查 XX 的邮箱」应首拍即跑 dws aisearch（不再先 Read 技能） |
| 0.3.11 | 09-23 | **随包 Git Bash（外部用户实报：没装 Git 的机器问会议室，agent 直接回「请安装 Git for Windows」——pi bash 工具全灭）**——根因链：pi 只认 bash.exe（解析序=settings.json shellPath → Program Files 两路径 → **PATH 搜索** → 报 No bash shell found），dws 技能/搜索兜底 curl 全走 bash；checkpoint 快照用 PATH 的 git，没装=快照回滚静默关闭（同病）。方案：①`tools/git/update.mjs` 下载 PortableGit 2.55.0.5（sha256 本仓自算 pin——官方不发逐资产 digest；FUNDET_GH_PROXY 可走镜像）→ 裁剪（去 vim/perl/mintty/mingw64 文档，351→264MB；**expand.exe/expr.exe 是 coreutils 不是 vim 家族，别误删**）→ `apps/git-bin/win32-x64/`；②electron-builder win extraResources +`git/win32-x64`（安装包 200→约 280MB）；③`main/host/git-bash.ts`：win32 且随包在场且系统 Git 全不可见（agent-core `resolveWindowsGitPathEntries` 已 barrel 导出复用 + PATH git 探测）时把 `<root>/cmd;<root>/bin` 前置进主进程 PATH——pi spawnEnv 拷贝 process.env 即继承，PATH 搜索命中 `bin/bash.exe`；**用户自装 Git（含装了没进 PATH 的注册表安装）永远优先，此时模块零动作**。实测：裁剪包 bash/coreutils/git init+commit/ls-remote/curl/tar/lfs/cmd 互操作全过；无 Git 机器全链路模拟（条目计算→PATH→pi 解析→bash 实跑）PASS；200/200（+git-bash 11 组）。开发机实测通道 `FUNDET_FORCE_BUNDLED_GIT=1`（无视系统 Git 强制启用）。**新坑：bash heredoc 写 .mjs 会四层剥转义（JSON→bash→文件→JS），连 `\\` 都保不住——探针必须 Write 工具写文件（铁律③又一次实证）**。**UI 四修（用户实报批）**：①右上窗口按钮悬停/点击全死——`SidebarPanelDrawer` 46px 拖拽条缺 `mr-[150px]` 右侧避让（全宽 drag 矩形盖住按钮，Windows app-region 按矩形命中；会话态/空态的条早有防护，面板态漏了），补齐；②**最大化 UI 等比放大**（用户拍板：最大化要保持原大小=大片空白不对）——main 进程 win.on('maximize') 按 内容宽/正常宽 比 setZoomFactor（0.05 步进、封顶 1.25，unmaximize 还原 1；mac 不掺和），实测 dpr 1.5→1.875；③会话 ID 段（输入卡右下、用量环左侧）移除（用户不要；顺带消掉 startsWith('draft-') 恒真死条件）；④发送钮禁用态亮色 `#444242`→`#d1d1cc`（冷灰白界面上太深；暗色主题不动）。CDP 探针验证：按钮命中两视图 3/3、拖拽条右侧留白精确 150px、ID 段 null、token 级联新值。**优化批（接手体检）**：⑤**小上下文模型预警**（0.2.29 挂的产品待办落地——内网 fundet-mini 32768 被 66 工具 32.7k 顶死报 400）：`shared/context-window.ts` 加 `contextTooSmallForTools`（基线 32.7k/8.5k×1.15 余量，实测数字；未知 ctx fail-open）+ ModelSelector chip 挂黄色 TriangleAlert（Tooltip 给关开关/换模型指引，browserStatus/computerStatus 现查）；⑥README pi 命令去掉 `0.83.0` 位置参数（照旧文档执行会把 pi **降回 1210 事故版本**——实测验过真会下 0.83.0）；⑦sessionStore 头注释 100ms→32ms；⑧删 `.msg-stream-items > *:not([data-virtual])` 死规则（行全走虚拟化恒带 data-virtual，规则永不命中）。203/203（+3）。**收尾批（用户拍板做 3、4 后发版）**：⑨resendTurn——错误卡「重新发送」原直连 IPC 绕过 lastSendInputs（手动重发后再遇限流/网络错误不自动重试），sessionStore 新增 resendTurn（不重插气泡、记录重试参数、isRunning 置位），ChatPage resendLast 改走它；⑩localStorage 品牌迁移——main.tsx 入口一次性 longma.*→fundet.*（font.ui/font.code/profile/sidebar-width，拷贝后删旧键），fonts/profile/ChatPage 键常量同步改；⑪**turn_diff/image 事件结案（勿再做 UI）**——两者在仅 Pi 的裁剪里**零生产者**（events.ts 注释自证：image 是 codex 独有、turn_diff 是 provider 工作区 diff 由其它 harness translator 发），渲染层不消费是正确状态非欠账 |
| 0.3.10 | 09-23 | **钉钉知识库勾选（用户设计：选源交给用户，不靠语义理解）**——KnowledgeChip 面板顶部新增「钉钉知识库」开关（binding.dingtalk，JSON 向后兼容）；勾了注入 dingtalk_kb_search MCP 工具（handler 调 dws aisearch enterprise --queries，60s 超时，解析 errorCode/登录失效提示）；MCP server 改动态工具组合（handlers:{search?,list?,dingtalk?} 按绑定出现，tools/list 只列勾了的）——勾谁谁的工具在，消歧由用户显式完成；零依赖 dingtalk-format.ts（formatDingtalkResults 纯函数，样本=dws v1.0.62 实跑脱敏）；189/189（+钉钉解析 5 组+动态组合 1 组）。**②会话按文件夹分组（对齐 Cindy project 分组）**——组键=workDir 归一化（去尾斜杠/统一分隔符/小写）；组头=路径末段+会话计数（悬停显全路径；同名不同路径各自成组属正确行为）；组头可点击折叠/展开（localStorage `fundet.sidebar.collapsed-groups`）；置顶段独立不参与分组（拖拽排序不变）；组头替代原「会话」分隔行，组序随组内最新会话。**③厂商内置图标**——公司 logo 左侧球体（用户提供的干净版 PNG）→ logo-fundet-vendor.png；resolveVendorKind 加 fundet kind（providerId/name/baseUrl 任一含 fundet 即认），ProviderLogoMark 圆形 img 分支——模型下拉/弹层/chip 全生效（Fundet 系自定义 provider 自动有标，后续 V2 零配置继承）。**架构注意**：tool.ts import store 会拉 Electron 链（node-test 挂）——纯函数独立文件 |
| 0.3.9 | 09-22 | **热补 9：知识库消歧 + knowledge_list**——用户实报「问知识库有什么，有时走钉钉 aisearch 有时走本地」：①search 工具描述加选源规则（「知识库/我的文档」→本地；明确说「钉钉/公司/企业」才走钉钉侧）——工具描述是 agent 选工具唯一依据；②新增 knowledge_list 工具（列绑定 KB+文档名/块数/字数），「有什么」类问题直接列清单不再 FTS 硬检索；MCP server 改双工具 dispatch（handlers:{search,list}）。**验证纪律**：协议层单测覆盖（tools/list 双工具+list 清单格式断言），agent 选工具效果靠用户日常实测（真模型验证已停——消耗 Fundet-CN-V1-flash 额度，用户两次提醒） |
| 0.3.8 | 09-22 | **全量 review 三修（自动化模块 0.3.0 引入的隐性 bug）**：①**pi 进程泄漏**——auto- 会话从不 closeSession，interval 任务一天泄漏几十个 pi 子进程；修：sendFn 等 done 事件（run 状态由真完成落定，超时 10min 按失败终止）+ finally closeSession 回收。②**侧栏污染**——sessionRowsToList/session-search 均未过滤 auto- 前缀，每次定时触发用户侧栏多一个会话；双侧过滤（运行历史在自动化面板看）。③**渲染层孤儿 slice**——applyEvent 为 auto 会话建 slice 永不清理；入口丢弃。**教训**：跑长任务的隔离会话必须显式管理生命周期（等 done + close），「不进侧栏」要过滤列表+搜索+事件三面。dev 实测：立即运行→run 终态（种子库无 key 走 failed 路径=auth 闸生效）+ 侧栏无 auto |
| 0.3.7 | 09-22 | **热补 7：dws 安装全链 Gitee 直连（自建镜像仓）+ 面板精简（用户拍板：砍介绍长文/技能 chips/GitHub 源按钮/日志输出区与输出尾巴，保进度条+底部安全段+三钮）**——用户实锤「Gitee 渠道也去 GitHub 下载」：官方 Gitee 仓的 install.ps1 只是脚本壳，二进制资产仍从 GitHub Releases 拉，GitHub 不通即卡死（本机复现：17MB windows 包 curl exit 18 截断）。方案落地：①Gitee 建公开镜像仓 **sun-jisen/dws-mirror**（README + install.ps1 + release v1.0.62 七资产，checksums 可校验逐字节一致；**分支 master** 非 main，raw URL 要用 /raw/master/）；②Fundet INSTALL_SCRIPTS.gitee 改指镜像仓（DWS_GITEE_REPO=sun-jisen/dws-mirror，脚本经 Gitee API 解析版本+下载，全链国内直连）——命令行实测 38s 装完 v1.0.62 零 GitHub 依赖，应用内重装实测 PASS；③每周一 09:30 定时同步（用户拍板从 09:00 改）（C:/temp/dws-mirror-tools/sync-mirror.mjs，幂等跳过同 tag，token 在同目录 token.env 不进 git；Windows-arm64 资产暂缺非关键）。**Gitee API 坑**：建仓 private 默认 true（要显式 private:false）；contents API 必须带 name 字段才能 PATCH；release 必须传 target_commitish=master |
| 0.3.6 | 09-22 | **热补 6 三件**：①知识库引用圈重载丢失——tool_result_full 事件（工具结果全文）从未落库，重载后 knowledgeSourcesFor 拿不到 resultText，【n】退化纯文本；persistEvent 补落库 + sessionStore 恢复挂回 resultText（存量会话救不回，新回复起永久保留）；零模型验证（合成数据 reload 后 5 圈+溯源面板）；引用圈 DOM 口径坑：sup.kb-cite 渲染时被 components.sup 换成 button[title=查看来源]，探针勿查 .kb-cite。②重装体验——「重装中」黑盒：官方脚本本机 47s/慢网 10 分钟超时上限，期间零反馈；点击立即 notice 预期 + 「用 GitHub 源」备选按钮。③安装进度条——runCommandStreaming（spawn 增量）→ DWS_INSTALL_PROGRESS push → DwsPanel：时间型进度条（60s 线性 5→72% 后缓爬 95%）+ 已进行 X 分 X 秒 + 实时输出尾巴 6 行；未安装态一键安装同受益 |
| 0.3.5 | 09-22 | **热补 5：钉钉面板刷新结果反馈**——0.3.4 只修了欢迎页组件板的 spinning，钉钉工作台面板里的刷新钮没接（用户实报仍无反馈）且要结果可见：①面板 onRefresh 改 async（spinning 生效）；②刷新完成 notice 区显示摘要「已刷新（HH:MM）：日程 N 条 · 待办 N 条（M 逾期）· 待审批 N 条 · 未读 N 条」，单组件失败追加「失败：XX」；③底部过时提示更新（退出登录已有按钮）。dev 实测点击即转+摘要显示 |
| 0.3.4 | 09-21 | **热补 4：组件刷新钮反馈**——用户实报「点了没反应」：链路其实通（force=true 真查询），但 dws 查询要几秒~几十秒、期间无任何视觉反馈 = 体感失灵。修：refreshDwsWidgets 返回 Promise（原 void），DwsWidgets 板级 refreshing state——点击图标 animate-spin 直到查询完成，title 注明「需几秒」；dev 实测点击即转、2s 完成（用户机慢则转更久，正是反馈意义） |
| 0.3.3 | 09-21 | **热补 3：技能卡等高**——描述长短不一导致卡片参差（用户实报）：描述固定两行高（line-clamp-2 + min-h-[3.3em]）+「已安装」徽标并入徽标行（不再单独占行）；28 卡实测全部 118px（极差 0） |
| 0.3.2 | 09-21 | **热补 2：钉钉自救链路补全**——0.3.1 后 Damon 仍「刷新失败」，根因二连：①「补装/修复技能」只装技能**不升 dws CLI 本体**（错误提示指错了按钮）；②面板无退出登录出口（升级后旧登录态不兼容没法清）。修：①已登录态新增「重装 / 升级 dws」按钮（installDws 重跑，tooltip 注明用途）；②新增「退出登录」（确认框→dws auth logout→回待登录态，走 confirmDialog）；③enrichApprovalError 文案改指「重装/升级 dws，仍失败再退出重登」。**dws auth 命令族事实**：logout（默认清全部账号）/reset（清 token 触发重新授权）/status（认证健康 JSON）/export+import（迁移登录态）。本机实证：1.0.62+正常登录时 oa approval list-pending 输出标准 result.values（解析器无恙），审批单卡失败=dws 版本或登录态问题 |
| 0.3.1 | 09-21 | **热补：审批卡 dws 版本兼容**——Damon（dws v1.0.60）审批卡「刷新失败」实锤（1.0.62 改了 approvals 输出格式，解析器按 1.0.62 写的）：①parseApprovalsPending 宽容四档（result.values/result.data/result.items/顶层数组）；②enrichApprovalError：dws <1.0.62 时错误文案直点「版本过旧，到钉钉工作台面板点补装/修复技能升级」（此前只说原因不给路径）；③其它三卡（日程/待办/未读）同命令族不受影响。errOf tooltip 已带 dws 原始错误（悬停即见），不用翻日志 |
| 0.3.0 | 09-21 | **品牌换新（保留 Fundet 名）+ Cindy 全对齐 + 自动化 + 技能集市**：红色头盔小宇航员圆形 logo（透明角全套图标）；新会话空消息 = Cindy 首页复刻（FunDet 斜体粗体红字 lockup 44px 圆+字 / 大输入卡 790×150 / 建议卡池 10 条[换一批/不再显示]；对话态回扁条 76px + 列宽 820px 撑满，两态实测对齐）；**亮色主题换 Cindy 原值**（冷灰白系 asar 抄录；暗色本就是原值）；**自动化（定时例行任务，Cindy 侧栏第二钮全搬 + 对齐三补）**：宿主层调度（非插件沙箱）——六触发类型（每小时/每天/工作日/每周/每月/cron）+ 间隔（上次完成+N 分钟）+ 一次性 + 每任务可选模型，到点起隔离会话（auto- 前缀不进侧栏）跑，运行历史 + 暂停/立即运行/漏跑补一次；管理页 = Cindy 同款（空态 hero+模板卡三分组六张预填 + 编辑器分段控件弹层 + 模型自定义弹层带图标搜索）；drizzle 幂等双表、零依赖 automation-schedule.ts（9 cron 单测）、183/183。**SkillHub 技能集市**（设置→技能双 tab）：api.skillhub.cn 匿名全库搜索（真参数 q，keyword 被服务端忽略曾致搜索=默认榜）+ 四排序 + 分类 + 详情弹层（统计/审计可点链接/更新日志）+ 一键安装管线（校验+sha256+原子落位）+ 更新比对。曾当日改「未灵」后按用户拍板回退 Fundet（技术标识从未动过）。0.2.30 并入此发 |
| 0.2.30 | 09-20 | **SkillHub 技能集市（M1+M2）**：设置→技能双 tab（已安装/发现）——发现页接 api.skillhub.cn（匿名免令牌，list 10min TTL）：**全库搜索（服务端真参数 q，中英文；keyword 被服务端忽略曾致搜索=默认榜，实测修复）**300ms 防抖+序号防串、四排序（下载/趋势/星标/评分）、分类 chips、纯文字卡片+重复 slug 去重；**点卡片开详情弹层**（统计/概览/安全审计可点链接/更新日志/安装四态，内容区滚动；Esc 分层：弹层开着面板不吃 Esc）+ grid items-start 修同行拉高；一键安装管线（清单校验[≤50 文件≤5MB 防穿越]+4 并发下载+逐文件 sha256+临时目录原子落位 `~/.agents/skills/<slug>/`+skillhub.json 元数据），重装备份替换，已装 tab 比对显更新。174/174 测试，dev+打包双端真 API 实测 |
| 0.2.29 | 09-20 | **体验批（4 件）**：灵动岛弹层条目点不开修复（0.2.28 回归）；岛与 Canvas 按钮重叠 -16px→20px（头部避让 186px 结构修复）；MCP 服务器移回设置页（侧栏剩四钮）；输入框自动增高（约 10 行封顶才滚动）。打包快检 3/3 |
| 0.2.28 | 09-20 | **性能+可诊断批**：①新会话首条消息 **32s→11.7s** 四联修——快照移出发送关键路径（后台串行队列）、主目录跳过快照+排除名单补巨型目录、陈旧 index.lock 自愈（救活回滚功能）、MCP 桥并行拉起+预热限时；②组件「刷新失败」可诊断化——errOf 真实错误透传（tooltip 可见原因）、profile 失败不再误判未登录（曾整板消失）、角标可点重试。162/162 |
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
- **ask_user_question 问答卡（0.3.20，Cindy #5198 移植）**：模型追问时替换 composer 位——多题步进/上一题/跳过（Esc）/单选点击即进/多选 JSON 数组串/宿主自供自由输入行（模型自造「其他（回复说明）」式选项经 `shared/ask-options.ts` 剔除）/数字快捷键；IM 文本桥同口径过滤。**未移植** Cindy 的滑页动画/最小化/草稿持久化（切会话丢答题进度，v1 接受）。
- 设置 → 通用「版本与更新」卡显示 **Agent 运行时（pi）版本 + 上游最新**（0.3.21；只读检测不热更，`host/pi-version.ts`）。
- **记忆（2026-09-30 上线，用户拍板「开吧+IM 共享+管理面板」）**：Maker Memory 纯本地——`<userData>/maker-memory/<sanitized-workdir>/` 按工作目录分仓（.md 分片+MEMORY.md 索引+fts.db），4 类 curated（user/feedback/project/reference）+ digest（pi 压缩上下文自动沉淀，可检索不进索引）；**默认开**（`memory.enabled` 设置，记忆面板可关）；模型工具面=内置 `fundet-memory` MCP（**渐进式发现**：list_tools/call_tool 两入口，六内工具按需发现，省 system 上下文；auto-approve——只写 userData 内记忆文件）；pi 会话不注入 system prompt 记忆段（模型经 MCP 自学，Cindy pi 同路径）；**IM 会话共享主目录记忆仓**（createSession 传 `memoryScopeDir: os.homedir()`）；侧栏「记忆」能力面板=MemoryPanel（hero 统计+开关+打开文件夹、按目录分仓 chips、类型过滤、FTS 搜索、新建/编辑/删除弹层、digest 只读）；`memory_review` 未暴露（PiAgent 无 oneShot）。
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
- 本地图片预览协议真名 **`longma-file://`**（`shared/file-preview-url.ts` 写死、两品牌共用；历史遗留 longma- 前缀，**勿改名**——断存量 HTML 预览的相对引用）；复制走 clipboard IPC；分享=回合卡片截图。
- **流式渲染纵深（2026-09-10 对齐 Cindy 五层，治「长回答越流越卡/长会话发沉/上滑被拽回」）**：①sessionStore delta 通知 32ms 帧级合帧（状态同步写，只压通知）；②消息条目 `content-visibility:auto`（`.msg-stream-items > *`，屏外零布局成本）；③贴底跟随 = 意图判据（wheel/touch/PageUp 上滚 1px 立即解除）+ ResizeObserver 跟底 + 恢复双信号（向下滚 + 贴底 ≤8px）；④流式 markdown 先 repair（补未闭合围栏/摘半截链接，`lib/streamingMarkdown.ts`）再按顶层块分块 memo，**只有尾块重 parse/重高亮**；逐词淡入只挂尾块（按块位号独立账本，稳定块冻结）；⑤消息列表 **TanStack Virtual 真虚拟化**（2026-09-11 替换原「首帧15→扩80→触顶+80」窗口扩展：动态测量行高、overscan 8、行间距内化为行内 pb-3.5、滚动容器 `overflowAnchor:none` 防浏览器锚定与虚拟化打架、流式未封口文本作伪行恒挂末位、globals 的 content-visibility 规则以 `:not([data-virtual])` 排除虚拟行防测量被腐蚀；跳底/跳上一问/切会话定位全走 scrollToIndex）；⑥`[perf] stream first-paint` debug 日志 = 丝滑度回归基线。thinking/工具卡折叠即卸载（Collapse 移植自带，收起不占 DOM）。
- **动效体系与状态可感知批（2026-09-17 对齐 Cindy DESIGN.md §14.4，已随 0.2.20 发）**：①Motion token 全组件落地（`--motion-*` 5 档 + 3 曲线 + 新增 `--motion-morph` 220ms 容器形变例外类；组件硬编码时长清零，新增动效一律引用 token）；②**FadeSwitcher**（`ui/FadeSwitcher.tsx`，trigger 驱动、子树不重挂——composer 草稿/滚动跨切换保留）三处接线：路由切换（main.tsx layout route）/ 能力面板开关（ChatPage 主区）/ 会话切换（仅包 MessageStream）；③**侧栏动态四件套**——运行结束 settle 底色闪烁（0.9s 一次性）、attention 关注点（turn 非注视下完成=绿点带光环 `session-dot-pulse`、终态出错=红点；sessionStore 追踪 + `markSessionSeen` 切进即清）、运行中非选中行底部扫动条（`session-sweep`）、溢出标题 hover marquee（MarqueeTitle：真溢出+hover 才播、每可视宽 2.4s、离开复位）；④**消息行入场软淡入**（`animate-row-enter` 0.4→1；MessageStream `enteredRows` 账本：仅「尾部追加批次」（≤4 行增量且非首渲染）播，历史装载/切会话/虚拟滚动重挂不播）；⑤**Done 收束** `status-done-pop`（0.85→1.08→1 back-out，全应用唯一 sanctioned 过冲，挂 RunningStatus 左段）；⑥**启动 Splash**（`Splash.tsx` renderer 内实现：品牌球光泽 sheen 扫动 + 最短亮 500ms，会话列表就绪即 200ms 淡出）；⑦**composer 增强**——@ 文件引用（新 IPC `fs:list-dir`；输入 @ 唤出工作目录候选面板 `FileMentionPanel`，目录可下钻 `/`，选中文件 stage 成附件 chip）+ 图片附件缩略图（`AttachmentThumb` 24×24，composer chip 与用户消息气泡共用，读失败回落图标）；⑧**会话置顶/拖拽排序**（sessions 表幂等补列 `pinned`/`sort_order`；新 IPC `session:set-pinned`/`session:reorder`；hover 动作区 Pin/PinOff（草稿不显示）；置顶段单独段标「置顶」+ dragenter 活换序 + dragend 持久化）+ **列表 FLIP 重排动画**（Sidebar offsetTop 快照 + translateY 补偿，motion-base move 曲线；offsetTop 而非 viewport rect——不受滚动影响）。**克制红线**：循环动画全部 compositor-only（transform/opacity）+ reduced-motion 白名单登记每个新 keyframes；装饰性 idle 循环（空态品牌球浮动）按 §14.4「禁循环装饰」裁决**不做**；ConfirmDialog 140-160ms 是 0.2.19 用户拍板值不动。SendButton send↔stop 交叉淡切 morph 此前已有（核查确认）。

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
- 入站去重（渠道消息 id，TTL 10min）+ 单回合 10min 兜底超时；`permissionMode: 'bypassPermissions'`（2026-09-23 用户拍板：IM 侧看不到审批卡，ask 档卡到超时；曾经历 auto→ask→bypass 三态——桥的 ask_user_question 问答与控制面强制确认两通道保留），工作目录 `userData/im-workspace`。**电脑必须开着应用**。群聊需 @。

### 4.8 视觉模型

### 4.10 语音与网关服务（0.3.14）
- **统一服务网关** `host/service-gateway.ts`：自建 nginx 网关（内网 10.7.0.95 / 公网 111.34.136.32，同源）：ASR（SenseVoice，免鉴权，≤30s 单段无 VAD）/ TTS（CosyVoice2，wav 24kHz，支持参考音色克隆）/ 嵌入（Qwen3-Embedding-4B，2560 维，**不支持 dimensions 参数**，查询侧要加指令前缀）；地址存 settings `service.gatewayUrl`（无 UI，改默认值找开发）；网关上还有生图 Qwen-Image-2.1（未接，记档）。
- **语音输入**：输入框麦克风按钮（**Cindy 原版形态**：右侧工具组发送键左侧 30px 描边圆钮常驻；录音红点呼吸+tabular-nums 计时+220ms 胶囊宽度形变；转写 spinner）。点击开关录音、**25s 自动停**（ASR 30s 上限余量）、Esc 取消、转写文本插光标处；**常显无开关**（曾设开关被用户误拨藏了按钮，09-25 拍板删设置区）。前端 `lib/wav-encode.ts` webm→16kHz mono PCM16 WAV（SenseVoice 不收 webm）；权限处理器放行 media。
- **TTS 朗读**：assistant 消息操作栏 Volume2 三态钮（合成 spinner/播放可停），2000 字上限。
- 只信库值：预设标注 + 编辑对话框「视觉」勾选（save/回填/扫描三处都要透传 input/maxTokens）。改完新会话即生效。
- glm-4.5/5.x 无视觉（bigmodel 1210）；`friendly-error.ts` 把供应商错误转中文指引。

---

### 4.11 桌宠（0.3.18 已发，2026-09-28）
- **生图管线 v2（2026-09-29 夜，奔跑循环重制实证）**：网关生图端点=`/v1/images/edits`（multipart：prompt/model=Qwen-Image-2.1/size/seed/steps/guidance_scale + `image` 文件=图生图）与 `/v1/images/generations`（**只收 JSON**，multipart 报 415；无 image 参数=纯 t2i）；~30s/张 1024²、~117s/张 3072×1024；未知参数静默忽略（探测参数用「错误类型法」）。**素材生成正解配方**：纯 t2i + 固定 seed 族（300+i）+ 文字锁形象 + 每帧一个明确姿势句——img2img 参考图会**锚死部件姿势**（腿的大位移挣得脱、胳膊小部件挣不脱，rune/rund 两轮实证）；一张 sheet 画多格会被「平均化」成微动。切帧：sheet 按生成周期等分（帧内容横向溢出会连通列投影），格内取内容包围盒 + 泛洪去背 + 高度归一底对齐。脚本：`C:\temp\fundet-pet-sprites2\`（gen-rundef.mjs/resplit）。奔跑 v2 接入：`runf_00..05` 6 帧 @75ms 硬切（逐姿势：着地/下压/蹬地/腾空/摆腿/换脚，真·对侧摆，用户验收）；旧 run 14 帧（微动版）保留在 sprites 目录可回滚。奔跑提速史：7帧@110ms 抽稀 → 14帧@75ms 恢复（速度感 OK 但素材微动）→ 重生成大动作素材。
- **生图参数**：idle 4096×1024/80 步/CFG 2.0（最高画质，**单张就会打崩 GPU 引擎**——日常用 3072×1024/60 步/无 CFG 是可持续上限）；seed 42 固定。sprite sheet 横条布局 + 提示词强调完整身体（含腿脚）防裁切。
- **切帧必须内容感知（0.3.18 拉纸条事故教训）**：生图 sheet **不是严格网格**——idle 4096 宽实际只有 6 个机器人且间距不均，按 8 等分硬切会把机器人拦腰切两半（=用户看到的"拉纸条"）。正确做法（resplit.mjs）：列投影找非白区段 → 贪心合并最小 gap 到目标帧数 → 每帧行投影取内容包围盒 → **每帧内容高度归一+底部对齐+水平居中**（各 sheet 机器人画幅大小不一，全局统一缩放会让眨眼/通知时机器人突变大小）。白转透明必须**泛洪填充**（只抠与画布边界连通的背景白）；按亮度全局抠白会把白色装甲一起抠成半透明发灰。
- **穿透模型（0.3.18 点击无反应事故教训）**：`setIgnoreMouseEvents(true,{forward:true})` 只转发 **mousemove**，`mouseenter/mouseleave` 在穿透状态下永不触发——靠它恢复交互的写法窗口永久穿透。正确：渲染层 document mousemove + `elementFromPoint` 判定指针是否在宠物上 → `pet:hover` IPC 切换穿透。
- **MVP 已实现（0.3.18 待发）**：`host/pet-host.ts`（窗口创建/销毁/右键菜单/截图 desktopCapturer）+ `pet-state-bridge.ts`（agent 事件→桌宠状态：isRunning→thinking/done→notify+回 idle/interaction→notify/error→notify）+ 渲染层 `pet/pet-window.ts` + `pet-config.ts`（帧动画引擎 RAF + 正弦漂浮 ±6px/2.5s + 状态淡入 180ms + 眨眼随机 3-7s 插播）+ `pet.html`（vite 双入口，public/pet/sprites 经 vite 拷贝）。交互：**左键单击=打开主窗口并新建对话、右键=直接截图问答**（右键菜单已移除，隐藏桌宠走设置 pet.enabled；右键必须渲染层 contextmenu→IPC 显式触发，webContents context-menu 事件在透明穿透小窗上不可靠）、拖拽=主进程 16ms 轮询光标平移窗口（阈值 6px 内不算拖动，松手停在原地记位置 userData/pet-window.json；拖动时漂浮幅度平滑归零）。帧动画=双 img 层 40ms 交叉淡化（**必须等新帧 onload 再过渡+绝对 URL 去重**，否则半加载闪白/重复切换=闪烁根因），idle 120ms/thinking 100ms/notify·blink 90ms。**拖拽必须移动窗口本体**（148×168 小窗内 root 位移会被裁剪）。帧路径用 `./pet/sprites/...` 原样赋 src（`'../'+frame` 在打包态指向 out/pet 必 404）。**截图问答**：desktopCapturer 全屏→base64→主窗口 stageBytes→composer 附件注入。设置开关 pet.enabled 默认开。
- **0.3.17 静默回归事故（IPC handler 整段误删）**：a3a7ea2（KB 纯语义检索）清理时把 register.ts 里 fs:\* 10 通道+voice:\* 6 通道+shell:open-external+kb:session-set 一并删掉（194 行），typecheck/219 测试全绿但运行时功能全灭——**文件拖入/粘贴图片/截图注入/语音输入朗读自 0.3.17 起全部失效**。教训：删 handler 必须对照 channels.ts 全量清单；IPC 注册无测试覆盖，发版前必须人工冒烟核心通道。已恢复（a48a049+2ff2607）。**回归防线**：`node tools/check-ipc-channels.cjs` 全量比对 channels.ts 定义 vs 全 main 目录注册点（注意 IM/DWS 等在各自模块内注册，不能只查 register.ts），发版前必跑。
- **0.3.18 动画终局：混合模式（单帧+代码动画为主，真轮播仅限单次动作）**。密集帧实验结论：提示词「相邻帧微小连续变化」能让帧间连贯（idle 11/thinking 10/notify 11 帧，宽度差异 ±8px），**但整段动作仍是大幅变化**（idle 实际画成了「举手→放下」，轮播=手臂快速甩动=闪烁）；生图逐帧路线**只适合单次动作分解（notify），永远做不好循环待机动画**。终版：idle=idle_08 单帧+呼吸缩放（1.6s，相位用全局 now 保证状态切换不跳变）+漂浮；thinking=thinking_00+摇摆 ±2.5°（2.2s）；notify=11 帧 @80ms 单次轮播；blink=blink_01 插播 150ms；40ms 交叉淡化（onload 等待+绝对 URL 去重）。切帧 v2 含**碎片并入相邻主体**（宽度 <100px 且 gap≤120px）。脚本：C:/temp/fundet-pet-sprites/{gen-dense,resplit-dense}.mjs。
- **待机动画终版（0.3.18 第三次迭代后定稿）**：像素 diff 实验证明相邻生图帧最优平移全为 (0,0)（切帧已对齐）、剩余 ~5000px 差异为不可消除的**本体形变**——生图帧任何速度的轮播（110ms 快速/520ms 慢速）都会被感知为「一闪一闪」，彻底放弃轮播待机。终版：idle/thinking 静止单帧 + 极轻漂浮（±3px/3.2s）+ 轻呼吸（±1%）/微摇摆（±1.5°）；生命感由**偶发动作**提供（每 5-11s 随机眨眼、每 15-30s 随机跳跃，Shimeji 模式：偶尔动一下比持续动自然）。经验：用户对桌宠动画的满意解 = 「大部分静止 + 偶发动作 + 极轻浮动」，而非「持续的帧动画」。
- **拖动跑步状态（0.3.18）**：拖动确立（>6px）后强制 running 动画——run 14 帧生成后**抽稀为 7 帧（隔一取一）@110ms 硬切（16ms 近无过渡）**：快速动作硬切比叠化干净（叠化=四肢重影抖动=用户看到的跑步闪动），抽稀让跑步节奏更清晰。朝向：pointermove 的 dx 实时定 facing（±1），root `scaleX(facing)` 水平翻转；拖动中漂浮归零、呼吸/摇摆停用；松手回待机。**时序红线 1：dragMoved（click 抑制，保留到下次 pointerdown）与 dragRunning（跑步开关，松手即清）是两个变量**——共用一个会导致「松手后跑步不止，要点一下才停」(ccde83f)。**时序红线 2：帧推进必须用独立 setInterval(55ms) 而非 RAF**——窗口被 setPosition 高频移动时合成器会暂停透明窗口的 RAF 回调（动画停走根因），拖着不动也要原地跑。脚本：gen-run.mjs。
- **桌宠开关**：设置页「桌面助手」tab（PetPanel.tsx）→ pet:toggle → 主进程 setBoolSetting('pet.enabled')+togglePet 即时生效；启动时按该设置决定是否创建窗口。
- **showFrame 必须每 tick 无条件调用**（放进帧推进分支会让单帧状态永不刷新画面=切状态后画面冻结在旧帧）。
- **桌宠截图问答 = 强制新建会话携带截图**：ChatPage 用 pending 附件槽（ref）穿过会话切换的 setAttachments([]) 清空（先 createSession 触发 activeId 变化清空，stageBytes 完成后写入 pending 槽，effect 清空后自动恢复，两种时序都覆盖）。
- 二期候选：行走/拖拽/睡觉/庆祝/倾听/出错 六状态（待生成帧）。

### 4.9 本地知识库

- **纯语义检索（0.3.14 混合 → 0.3.16 纯语义，均用户拍板）**：`knowledge/embeddings(-logic).ts`——kb_chunks.embedding BLOB（2560×f32=10KB/块，暴力余弦 TopN）；查询侧指令前缀（Qwen3 官方建议）。**关键词检索（FTS5 榜+kb_fts 写入+回填按钮+RRF）已于 0.3.16 整体移除**；服务不可达 → 返回空（调用方提示未命中）。导入/笔记/快照后自动后台向量化（进度条 kb:embed-progress，完成自动刷新计数）；queryTerms 仅存片段定位用。分块（800/120）不变；tokenize 模块仍被 messages-fts 复用。

- **纯 FTS5 关键词检索**（用户决策：不做 embedding/不做向量化）。表走 raw SQL 幂等创建（`main/knowledge/store.ts`），FTS5 虚表**不进 drizzle 迁移**；`getSqlite()`（db/client.ts）取原生句柄。
- **分词：CJK bigram + 拉丁整词小写**（`knowledge/tokenize.ts`），索引/查询两侧同一函数；**别换 Intl.Segmenter**（ICU 词典深浅不一，本机把「退货」切成单字）。查询 = 各 token 引号 OR + 拉丁前缀 `*`；排序 bm25()。
- 分块：段落聚合 800 字，超长段按句切窗 overlap 120（`knowledge/chunk.ts`）。
- 导入：PDF/DOCX/TXT/MD → `extractKnowledgeDocumentText`（doc-text.ts，抛错制）→ 分块事务入库（kb_chunks）。
- 会话绑定存 settings（`kb.session.<sessionId>`，主进程可读）；绑定后**新消息**注入内置 knowledge MCP（`knowledge_search` 工具，返回【n】来源片段并带「不得编造」提示语）；composer 知识库 chip（KnowledgeChip）+ 设置→知识库（CRUD/导入/召回测试）。
- 批A（2026-09-10）：目录导入（递归收集、跳隐藏/node_modules）；KB 级参数 topK/chunkSize/chunkOverlap（knowledge_bases 列，幂等补列；MCP 默认 limit 与导入分块都读它，**改块参数需重新导入才生效**）；导入结果逐文件展示 + 失败项保留路径一键重试。
- 批B（2026-09-10）：会话绑定升级 `{ids, auto}`（兼容旧纯数组）；`auto` = 发送前自动检索注入——session:send 按用户原话检索（**条数与 knowledge MCP 工具同源：各绑定 KB 的 topK 取最大，2026-09-11 起对齐，原为硬编码 top4**）拼进发给模型的消息上下文（**DB messages 仍存用户原话**，注入只影响模型所见）；回答里的【n】经 rehypeKnowledgeCite 渲染成可点角标，点开溯源面板（来源/块序/原文），数据 = 本轮 knowledge_search 工具 resultText 解析（`lib/knowledgeCite.ts`）。
- 批C（2026-09-10）：笔记（knowledge_docs.kind='note' + content 存原文，可再编辑重建索引）；URL 快照（html-to-text 提正文；**SSRF 前置 assertPublicHttpUrl**：仅公网 http(s)、DNS 全地址逐个拦内网/链路本地/元数据，3MB/20s 上限）。
- 二轮反馈（2026-09-10）：**「点不动、过一会自愈」根因对策**——主窗 `backgroundThrottling: false`（Windows 遮挡检测误判 → 渲染冻结，Cindy 同款处理）；全局 `cursor: pointer`（button/[role=button]/summary/select/a，Chromium 按钮默认 default 体感像不可点）；知识库面板「高级参数」整个移除（用户明确不要，store 的参数列保留、工具默认 limit 仍生效）。
- 三轮反馈（2026-09-10）：知识库 chip 弹层去掉「发送前自动检索注入」开关与 knowledge_search 术语说明（用户看不懂）；弹层只留知识库勾选列表。绑定结构的 auto 字段保留（默认 false，注入能力后端不删、UI 不暴露）。
- 四轮反馈（2026-09-10）：chip 弹层列表隐藏滚动条（globals 新增 `.scrollbar-none` 工具类，滚轮仍可滚）——MorphPopover「真溢出才开滚」的取整 1px 假溢出在短列表也会挂出滑块，短列表直接不显示。
- 导入进度（2026-09-11）：文件/目录导入逐文件推 `kb:import-progress`（push 通道，payload `{kbId, completed, total, current}`），设置面板进度条 + 当前文件名；单文件不显示。
- **PDF 图片占位符清洗（2026-09-18，已随 0.2.23 发）**：Word 导出 PDF 的文本层带图片文件名标签（pdf.js 形态 `p14_img0.png`），此前混进知识库分块/附件正文，模型引用时原样吐出（用户实测报告）。`doc-text.ts sanitizePdfText`：独占行连行尾换行一起吃 + 行内残余剥离 + 空行压缩；KB 导入与附件发送共用 extractPdf 一处修复；**存量 KB 需重新导入**。真·图文知识库（提取图像本体+多模态检索）= P2，触发条件：用户明确提出需要图文档问答。
- **操作栏/输入行对齐（2026-09-18，已随 0.2.23 发）**：①~~输入卡下方上下文用量环移除~~（**误判次日纠正 7014b97 后**：用户所指「钟表按钮」是消息操作栏 History 图标的回滚钮——已收进更多菜单即满足；用量环保留在输入卡下方，勿再动）；②消息「更多」菜单对齐 Cindy：min-w-184px/h-8 行/删除前分隔线/菜单按 align 双侧对齐，**Rewind 收进菜单**（Undo2「回滚」，仅 user 侧），无「复制消息链接」（Cindy 云端，红线）；③按钮双序：user=[时间][复制][分享][分叉][编辑][更多]，assistant=[复制][分享][分叉][更多][时间][tokens]。
- **编辑 = 原位编辑框（2026-09-18，已随 0.2.23 发，对齐 Cindy UserMessageEditBox）**：入口**仅最后一条 user 消息**（edit-last-message）；点击后气泡**原位**变 textarea（预填原文光标置尾）+ 附件只读 chip + [取消][发送]；运行中点编辑**立即中断 turn**（Cindy 产品语义：点编辑=停下要改）；提交才截断重发（submitUserEdit 等 abort 收口再 deleteTurn+重发，防 running 重发被拒；同时清空排队）；取消零副作用；Enter 发送/Esc 取消。旧的「文本进 composer+编辑横幅+全选」链路已删。不做 Cindy 的「发送将撤销 N 文件改动」提示——Fundet 编辑不回滚文件（与 Cindy rewind-文件语义不同）。
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
| Windows bash 不可用 | pi 的 bash 工具只认 Git Bash；**0.3.11 起随包裁剪版 Git Bash 兜底**（git-bash.ts：系统 Git 全不可见才前置 PATH，用户自装优先）；system-prompt 引导装 Git 仅剩 dev 兜底 |
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
3. **PowerShell** `pnpm dist:win` 本地出包 → 拷一份到 `D:\` 根目录。pre 钩子自动跑 pack-browser-deps；**出包前确认 `apps/cua-driver-bin/win32-x64/VERSION` 与 `apps/git-bin/win32-x64/VERSION` 存在**。Defender 慢日构建超 10 分钟属正常，斩死后无孤儿进程直接重跑；EBUSY 同理整体重跑。
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

> **在途事项（2026-09-20，0.2.28 发）**：**无**——0.2.28 已发 GitHub Release（xiaosen6/fundet）：a8d9683（首条消息四联修）+ 2ff7909（组件失败可诊断化）+ 2 个 docs + 发版提交，三资产齐（12:28 批）、非 draft（gh api 复核）；安装包备份 `D:\Fundet-Setup-0.2.28-x64.exe`。**首条消息慢四联修**：①快照移出发送关键路径——`enqueueSnapshot` 后台串行队列（每会话一条链防同仓并发 git 撞 index.lock，fire-and-forget 零等待）；②workDir=主目录跳过快照 + EXCLUDES 补 AppData/Library/.cache/.gradle/.venv/venv/__pycache__；③陈旧 index.lock 自愈（>15s 清，救活曾被锁死的回滚）；④MCP 桥全并行拉起 + stdio 预热 initialize 限时 15s。实测 dev 冷首条 32.0s→11.7s（剩余=pi 启动 6.4s【打字期间完成】+模型首请求）。**组件失败态**：errOf 人话错误透传（dws error.message→stderr 尾行→退出码）；profile 失败分流（401/token/授权→提示重登；其余保登录态+旧数据+四卡角标等重试，不再误判未登录致整板消失）；角标可点重试。

> **在途事项（2026-09-20，0.2.28 发）**：**无**——0.2.28 已发 GitHub Release（xiaosen6/fundet）：a8d9683（首条消息四联修：快照后台串行队列不挡发送/主目录跳过+EXCLUDES 补巨型目录/index.lock 自愈救活回滚/MCP 桥并行+预热限时 15s，dev 实测冷首条 32.0s→11.7s）+ 2ff7909（组件失败可诊断化：errOf 真实原因透传/profile 失败分流不再误判未登录致整板消失/角标可点重试）+ 发版提交，三资产齐、非 draft；安装包备份 D:Fundet-Setup-0.2.28-x64.exe。

> **在途事项（2026-09-20，0.2.29 发）**：**无**——0.2.29 已发 GitHub Release（xiaosen6/fundet）：ec019ae + 8fd1e7e + 6d22811 + 发版提交，三资产齐（重试一次过 EBUSY）、非 draft；安装包备份 D:Fundet-Setup-0.2.29-x64.exe。内容四件（用户实测反馈批）：①灵动岛弹层条目点不开（0.2.28 回归，ListCtx 单 mode 糅合密度与行为，拆 sliced×expandable 正交）；②岛与 Canvas 钮重叠 -16px→20px（Canvas 固定钮实占 [W-178,W-138] 而头部只避让 150px，修 pr-186+岛 mr-3）；③MCP 服务器移回设置页（侧栏剩 IM/钉钉工作台/技能/知识库四钮，设置新 tab 在模型供应商后）；④输入框自动增高（flex-1 basis-0 无视显式 height，去后内容驱动 200px≈10 行封顶才滚动 + value effect 覆盖程序化改值）。打包快检 3/3（侧栏/设置 tab/composer 增长）。另：内网模型 fundet-mini 上下文已由用户侧提到 262K，400 问题服务端解决。

> **内网小模型（fundet-mini @vLLM 32768 ctx）在 Fundet 里 400 定位（2026-09-20 实证）**：直连 curl 一句话 53 token 正常；经 Fundet 发「你好」400「input ≥32768」。**本地代理解剖实发请求：140.7KB = system 22,043B（技能说明+指令）+ 66 个工具定义（8 核心 + 57「电脑操作」+ 1 搜索；浏览器开时更多）≈ 32.7k token——恰好 ≥ fundet-mini 的 32768 上限**；GLM 页脚同请求「32.7k tokens」交叉印证。**消减实测：关掉 设置→通用「电脑操作」+「浏览器自动化」两开关 → 同请求 8.5k tokens**（57 工具+浏览器定义占了 ~24k），fundet-mini 宽裕可用（剩 ~24k 对话空间）。用户配置本身无误（ctx 已正确填 32768）。对策排序：① 用 fundet-mini 时关这两个开关（运维小模型用不上截屏/浏览器）；② 服务端 vLLM 把 max-model-len 提到 ≥65536；③ blender 外部 MCP 建议删（连不上纯占工具位）。**复现方法论**：本地 loopback 代理（加 Bearer+记 body 解剖）+ 隔离种子库直插 providers 表（loopback baseUrl 免 safeStorage key）——providers 表无 enabled 列（id/name/api/base_url/models/created_at），插入别多写列。**产品待办（未做）**：选中模型 ctx 小于 harness 基线时 UI 预警/自动裁剪工具集——记待办。

> **在途事项（2026-09-21，0.3.0 发）**：**0.2.30（SkillHub 集市）并入 0.3.0（品牌重塑未灵）一起发**（已发 GitHub Release：三资产齐[exe 202MB/blockmap/latest.yml]、非 draft[gh api 复核]；安装包备份 D:Fundet-Setup-0.3.0-x64.exe）。

> **在途事项（2026-09-23，0.3.11 发）**：**无**——0.3.11 已发 GitHub Release（xiaosen6/fundet）：tag=commit 7d52b40（版本提交在 tag 内，merge-base 验证过），三资产齐（exe 288MB/blockmap/latest.yml，gh api 资产端点+公开下载双复核；**release list 接口有分钟级缓存滞后会假显 assets:[]，以 /releases/<id>/assets 端点和直连下载为准**），非 draft；安装包备份 `D:\Fundet-Setup-0.3.11-x64.exe`（275MB）。win-unpacked 冒烟 PASS（db-only 种子：资产齐/随包 bash 实跑/亮色发送钮 #d1d1cc/按钮命中 3/3/无会话 ID 段/无 longma 键）。版本内容四批：①随包 Git Bash 兜底（PortableGit 2.55.0.5 裁剪 264MB，系统 Git 可见时零动作）②UI 四修（面板拖拽条盖窗口按钮/最大化等比放大 ×1.25 封顶/去会话 ID 段/发送钮禁用浅灰）③优化批（小上下文模型预警角标/README pi 命令去 0.83.0 降级坑/注释与死 CSS 清理）④收尾批（resendTurn 走自动重试/localStorage longma→fundet 迁移/turn_diff+image 零生产者结案）。**发版新坑两条**：①`pnpm dist:win` 不重建 out/——必须 `pnpm build && pnpm dist:win` 两连（本次只跑 dist:win 用了旧 out/，冒烟靠 db-only 种子+composer 态断言抓出，重打包后过）；②随包 git 的几百个 exe 让签名阶段拖长打包到 ~20 分钟，EBUSY 首包照旧重跑即过。

> **在途事项（2026-09-23，0.3.12 发）**：**无**——0.3.12 已发 GitHub Release：tag=commit 9ae3e77（merge-base 验证过），三资产齐（资产端点 + 直连下载双复核：exe 206/blockmap 200/latest.yml 内容 sha512/size 一致），非 draft；安装包备份 `D:\Fundet-Setup-0.3.12-x64.exe`。内容两件：IM 权限完全放行（微信卡审批根修）+ 钉钉速查表直进 system prompt（常见查询免翻技能文件）。**发版坑新增**：275MB 资产上传会被 Bash 后台任务 600s 上限斩死（连斩两次、还留孤儿 draft）——正解：`gh release create --draft` 只带 latest.yml 秒建 → `Start-Process gh release upload` **脱离任务系统独立进程**传大资产（活过调用边界，实测 ~4 分钟）→ `gh release edit --draft=false` 发布；draft 阶段按 tag 查会 404（untagged），要按 release id 走资产端点。打包全程 build+dist 一条龙 ~10 分钟无 EBUSY。

> **在途事项（2026-09-28，0.3.16 发）**：**无**——任务栏灰图标修复版已发（tag=245d0e8，三资产齐，镜像复核，备份 D:Fundet-Setup-0.3.16-x64.exe）。根因=0.3.14 关 signAndEditExecutable 连带关掉 exe 图标/版本资源嵌入（我的误判「无证书纯装饰」）。修法=**afterPack 钩子**（build/after-pack.cjs）：rcedit 只处理 Fundet.exe（妙处：既保住图标又避开全目录 signtool 锁风暴）；cua-driver 同步挪进钩子**带重试拷贝**（每文件等杀软放行最长 90s——四连 EBUSY 的确定性解法，Defender 对截屏/输入钩子 DLL 新鲜拷贝有秒级扫描锁窗）。**rcedit 参数坑：--set-version-string 的 Key/Value 是两个独立参数**。eb 有更优雅的 signExecutable:false（跳签名保图标）但现方案已验证不动。0.3.15 用户自动更新到本版。

> **在途事项（2026-09-27，0.3.15 事故修复发）**：0.3.14 启动崩溃事故已热修——0.3.15 已发（tag=15b73fb，三资产齐，镜像复核过，备份 D:Fundet-Setup-0.3.15-x64.exe）。**运维要点：0.3.14 装机崩在更新器之前无法自愈，必须手动装 0.3.15**——恢复链接已放 Release 说明（gh-proxy 直链）。**新铁律：打包版冒烟必须把 win-unpacked 复制到仓库树外隔离运行（smoke-0315-iso.cjs 模板）——ESM 向上解析会命中开发机祖先 node_modules 造成假阴性，本事故的直接教训**。安装期文件数口径修正：0.3.15 实为 ~5,400（浏览器依赖回滚散装；仍比 0.3.13 少 62%）。

> **在途事项（2026-09-29，0.3.19 发）**：**无**——全仓复扫修复批已随 0.3.19 发 GitHub Release（tag=42e3f03，三资产齐，sha512 校验一致，直连+gh-proxy 镜像双 200，备份 D:\Fundet-Setup-0.3.19-x64.exe；隔离冒烟 PASS）。内容详见 §3.5 0.3.19 行与 §7 复扫块。发版过程事实：①CI release/ci 工作流照旧全红（从未成功出过包，**本地手动流程仍是唯一出包路径**，勿被 tag 触发的失败 run 迷惑）；②本次网络快日 262MB Start-Process 脱离上传 <1 分钟完成；③draft→--draft=false 后 tag URL 正常解析；④冒烟脚本坑：robocopy 退出码 1=复制成功（<8 都算成功，execFileSync 会误报）；Git Bash 里 powershell 内联 `$_` 会被展开成路径碎片——ps1 一律走 -File 且路径用正斜杠。下述为 0.3.19 内容摘要（详录留档）：
> - **①桌宠联动 stale closure（0.3.18 实发缺陷）**：pet 订阅 effect deps=[] 捕获首渲染空 providers 的 createSession→左键新对话/右键截图强制新建会话静默失效；修=createSessionRef。**②预热指纹不对称**：prewarm 侧指纹不带 KB 绑定/自动操作开关（全默认），attach 侧带真实值→开了开关的用户预热必失配白做；修=同口径。
> - **③微信入站图片**（新 im/wechat-inbound.ts 纯函数 +10 测试）：ilink `transport.downloadMedia`（AES key/CDN 兜底全在消息体内，无需额外 ticket）入队前逐张下载，落 `.fundet-uploads/im-*` 与钉钉同款；纯图/图文混合都进回合；下载失败**文字降级**告知模型不静默吞（选入队前下载因 dispatcher 回调无法回注降级文字；重复推送窗口短，代价可忽略）。引用消息内图片与出站图片未做。
> - **④知识库 URL 快照 SSRF**：`url.ts` 新 `fetchGuarded`——`redirect:'manual'` 手动跟随、**每跳重过 assertPublicHttpUrl**（原 `redirect:'follow'` 公网 302→内网可绕过）、20s 总时限不随跳数放大、fetchImpl 可注入（+5 测试）。
> - **⑤桌宠补强**：审批/问答弹窗桌宠 notify（原 interaction_request 是不可达死分支——审批走 setInteractionListener 独立通道，新增 bridgeInteractionRequest 在 register.ts 接线）；截图按光标所在屏 `display_id` 匹配（sources 顺序不保证）；broadcast 跳过 pet.html 窗口（流式事件不再白发给桌宠一份）。
> - **清理批（净删 ~520 行 + 27 张 sprite ~1.5MB + 死 tar.gz 产物段）**：UsageDashboard 死组件、sprite 52→22（保留集=pet.html 占位 idle_00+pet-config 引用 21 张）、kb FTS 残留（建表+2 DELETE+mergeRrf/indexText/buildSnippet/embeddingStats；ensure 加 `DROP TABLE IF EXISTS kb_fts` 清存量表；**matchExpression 保留——session-search 活代码**）、pack-browser-deps 末段死 tar.gz（git 的 tar 链路未动）、PET_SIZE/frameDir/spritesPath/voiceEnabled、enteredRows 会话切换清账本（sessionStore 新增 getFocusedSessionId，MessageStream 模块级比对）、ChatPage onDragEnd 复位、注释漂移批（LongMa 调试台/[longma:] 前缀/ci.yml/FUNET_→FUNDET_ typo 等）、测试 glob 补两个孤儿套件（filePathPolicy+providerBranding=14 项）。**品牌变体机制内的 LongMa 字样（brand.ts/BrandMark/pi-host replace）不是漂移，保留**。
> - **评估后刻意不动**：resumeSessionId（重启恢复 pi 上下文=大工程，待产品拍板）、im-workspace per-bot 隔离（内部路径常量红线）、stageFileIntoWorkDir 大小上限、agent-core flaky 测试、service-gateway 明文 HTTP（待运维）。

> **在途事项（2026-09-29 深夜，完成提醒批，已随 0.3.23 发，历史留档）**：**agent 完成统一提醒（用户拍板：音效 + Windows 右下角系统通知，不区分 done/出错）**。触发门控=`pet.notify` 开关（默认开，设置→桌宠「完成提醒」）且**主窗非可见且聚焦**（看着应用不打扰；窗口没了也提醒）；终止 error 判定对齐 events.ts 语义（isTerminal 优先，缺省看 !willRetry，都缺按终止）。`host/completion-notify.ts`：系统通知 **silent:true**（声音统一走应用内 chime，不双响）+ 点击通知=聚焦主窗并 `NOTIFY_OPEN_SESSION` 切会话（顺手 markSessionSeen 清关注态）；chime=`renderer/lib/chime.ts` WebAudio 双音（A5→D6 ~0.5s，**零资产文件**离线可用，主窗 backgroundThrottling:false 保证后台可播），3s 节流防并发连响。`app.setAppUserModelId('com.fundet.app')` 补设（Windows toast 无 AUMID 不显示）。IPC +2 invoke +2 push（128 通道）。**端到端探针双向 PASS**（C:/temp/notify-probe.cjs 模板：loopback provider 种子 + CDP 真发消息——失焦态 chime=1、聚焦态 chime=0）。**待用户实测**：听 chime 音色观感（不合适可换音）、看 toast 文案、点 toast 跳会话。桌宠 notify 动画维持现状（未做 celebrate 态/气泡/生图——用户选了纯音效+通知方案）。

> **在途事项（2026-09-29 深夜二批，桌宠新对话误报修复 + 奔跑 v3 IP 锚定帧，已随 0.3.23 发，历史留档）**：**用户实报「点击桌宠新建对话弹『请先在设置页配置 provider 和模型』但配置明明是好的」（0.3.22 上仍现，截图存证）**——取证推翻 0.3.19 的修复记录：**当时只改了截图路径的调用点，`onPetNewChat`（桌宠左键新对话）漏改**，至今仍捕获首渲染空 providers 闭包（createSession 弹误导性提示后返回，不建会话）。同窗期叠加第二竞态：启动后 `listProviders` 未返回时点击，即使走 ref 拿到的也是空数组。双修：①`onPetNewChat` 改 `createSessionRef.current`（同款 ref 模式）；②**providers 就绪门控** `whenProvidersReady()`（立即/等 listProviders 返回/8s 兜底放行），桌宠截图与新对话两入口都先过门控再调 createSession，就绪前的点击不再弹误导提示。其余 createSession 调用点（askDwsAgent/Sidebar onCreate/空态按钮）核实均新鲜闭包。**同批：奔跑素材 v3（IP 锚定两步法，用户方案）**——v2 纯 t2i 版（runf）形象非公司 IP 被否决；两步法=idle_08 → img2img 生成「黄金参考 ip-canon」（标准站姿）→ 以黄金参考为锚逐姿势 img2img（腿相位+手臂对侧摆）。量化：帧间差异 34.8（旧 15.7/sheet 版 26.8），循环闭合差 25 在帧间差范围内（能首尾接上）。`rung_00..05` 接入 running（6帧@75ms 硬切），旧 run 14 帧微动版保留可回滚。**待用户实测**：①启动后立刻点桌宠左键 → 应等 providers 加载后正常建会话（不再误报）；②拖拽看 v3 奔跑循环观感。

> **在途事项（2026-09-29 深夜三批，供应商 Key 校验 + 扫描按钮可视化，已随 0.3.24 发，历史留档）**：**用户实报两件**（截图存证）：①OpenRouter 向导填 Key 后自动扫描报天书「Cannot convert argument to a ByteString…index 7…36825」——36825=汉字「这」的码点，HTTP 头拒绝非 Latin1 字符，`Bearer ` 恰 7 字符 ⇒ **Key 内容以「这」开头**（复制时带上了说明文字）。`host/provider-models.ts` 双修：Key trim 后非「可见 ASCII」（`/[^\x21-\x7e]/`）提前拦下给中文指引；fetch catch 里 ByteString/greater than 255 类错误统一翻译成同款友好文案（防御纵深）。②编辑供应商弹窗的「扫描模型」是裸文本不像按钮——改成真按钮（描边圆角 pill + ScanSearch 图标 + 扫描中 spinner + disabled 态，与对话框按钮族一致）。**待用户实测**：重新纯复制 Key 扫描应成功；故意混入中文应得到中文指引而非天书。

> **在途事项（2026-09-30，全仓代码研究修复批，16 项，已随 0.3.25 发，历史留档）**：用户令「全面研究代码」后五路深挖 + 两 bug 亲核实证，修复如下（typecheck 全绿 / desktop 252/252 / agent-core 878 / IPC 审计 128/0 / vite build ✓ / dist:win ✓）：
> - **【P0·CI 覆盖发版资产事故】**0.3.21 起 release.yml win job 下载 pi/ripgrep/cua-driver 但**不下载 git**，`dist:win:publish`（--publish always）在人工上传验证完 ~2 分钟后**静默覆盖 Release 资产**——覆盖上去的是缺 86.5MB 随包 Git 的包（v0.3.21~24 线上资产实测 163~175MB vs 本地备份 250~261MB；0.3.23/24 备份 D:\ 已核对一致；差值恒 ≈ tar.gz）。mac job 恒红（icon 256<512）连累 run 标 failure，掩盖了「win 实际成功并发布」——旧结论「CI 从未成功出过包」已失效。**修**：CI 两 job 改 `pnpm --filter fundet-desktop exec electron-builder … --publish never`（直调 exec——pnpm run 的 `--` 透传在 Windows 下带脏参数 `""`/`--`，勿走脚本追加）+ win job 补 `node tools/git/update.mjs`；pack-browser-deps 在 CI 显式单步跑（exec 不触发 predist 钩子）。**资产重传已裁决不必做**——0.3.25 全量包发布后 latest.yml 指向新版，0.3.21~24 存量装机直接更新到 0.3.25 即自愈（发版后实测 release 工作流全绿且资产时间戳不变=覆盖已根治）。
> - **【P0·typecheck 红】**bdd8667（0.3.20 windowsHide 测试）引入 TS2352（EventEmitter 直 as Record），0.3.20 起 HEAD typecheck 一直红、ci.yml 全红源于此——此前各版「typecheck ✓」记录只对了 desktop 包。修：`as unknown as`。**教训：CI 红别当背景噪音，先看是不是自己红的。**
> - **【P1×5】**①供应商「扫描模型」两处（编辑弹窗+主面板 rescan）只保留 contextWindow/enabled，**勾了「视觉」再扫描即静默丢 input/maxTokens**——合并时按 id 保留旧值；②mermaid 暗色失效：detectDark 查 `classList('dark')` 而主题系统写 `data-theme`（MutationObserver 同错）——改 dataset.theme + attributeFilter；③微信 pollLoop notifyStart 在 try 外（失败=unhandled rejection+假在线）、飞书 `void ws.start()` 同款——connected 移到连接成功后置位；④ask_user/plan 审批无超时且会话关闭不清理（Map 泄漏+幽灵卡）——三类交互统一 10min 兜底（ask 超时空答案与 IM 桥同口径）+ 会话 closed/error 时清条目；⑤自动化任务遇终止 error 白等满 10min 超时——等 done 或终止 error 先到先落。
> - **【P2×8】**fork 历史 copyMessagesUntil 补 FTS 伴生写（此前分叉会话正文搜不到）；语义检索网关故障改上抛（MCP 工具如实告模型「检索失败≠未命中」，auto-RAG 路径 catch 跳过注入不阻断发送）；微信扫码取消改走 stopWechat（授权已成功时连轮询一起停，防「UI 未连接、消息照收」）+ qrCanceled 标记防取消后落定自动开跑；AVX2 预检 spawn 补 error 监听（防杀软删二进制竞态打崩主进程）；electron-builder 顶层 extraResources 残留 cua-driver 条目删除（win 双拷正是 EBUSY 元凶面、mac 指向不存在路径）；mac icon 换 `resources/fundet/icon-512.png`（新 logo 512 版，256 的会被 eb 拒）；shared/knowledge.ts BM25「越小越相关」注释漂移修正（实为余弦降序）；拖入界外文件拷贝加 1GB 上限（界内零拷贝不受限）；删除自动化补 confirmDialog（其余删除类操作早有确认惯例）。
> - **【P3 清理】**knowledge getSessionKnowledgeKbs 死函数、dingtalk normalizeMediaDownloadUrl 空壳、MessageStream isTurnRunning 死 prop（3 处）、dws-widgets minor<0 死条件、dev-desktop.sh 帮助文本旧路径（D:\AI\Fundet→D:\Go\fundet-buddy）、browser-runtime README/MAINTAINING/STATUS 顶部加「2026-09-30 路径更正」横幅（Cindy 时代包名/路径对照 + sync.mjs 不在本仓 + 17→23 action）、browser-mcp 两处注释路径修正。
> - **规模修正**：IPC = INVOKE **128** + PUSH **14** + pet 散写 **10**（09-29 复扫块记 125+12+11 已过期）；§9.5 2026-09-17 条「#4518/#4493 未移植」已过时（控制面守卫/超限帧/空 stop 代码都在，该条按历史留档勿再引用）。
> - **评估后刻意不动（维持 0.3.19 裁决）**：service-gateway 明文 HTTP（待运维上 https）、wechat-ilink 未接线面（typing/出站图片/markdown 降级/chunkWechatText——产品功能决策非 bug）。
> - **待用户实测**：①勾「视觉」的模型 → 编辑供应商 → 点扫描模型 → 保存后视觉勾选仍在；②暗色主题下发一张 mermaid 图应深色渲染、切换主题自动重渲；③配置错的微信/飞书凭证启动应显示 error 而非假「已连接」；④删自动化任务弹确认框；⑤自动化任务配错 key 触发应秒级标失败（不再等 10 分钟）。

> **在途事项（2026-09-30 深夜三批，语音取证 + 生图误报加固，待实测未发版）**：用户实报两件。①**语音「时快时慢、慢时质量差」取证**——服务端排查结论：ASR 实测 **68~352ms 任意长度都快**（4s/20s/33s 音频、12 连发无慢模式 P50=75ms；生图进行中也无竞争 189 vs 144ms 基线）；**TTS 倒是 2s↔13s 剧烈波动**（网关确有拥堵时段——今天全公司上了生图，用户撞上 GPU 打满时段 ASR 排队是最可能解释，探测时未复现）；质量差的可能叠加因素=25s 自动停截断尾词（SenseVoice 无 VAD）。**落地：VOICE_TRANSCRIBE 加计时日志** `[fundet:voice] 转写耗时 Xms（音频 Ys/ZKB）`——下次再慢立刻能分清「网关段慢」还是「客户端段慢」；若确认网关时段性拥堵→交运维（证据框架已备）。②**「生图工具不可用」误报加固**——分析：应用更新必重启、会话全部重建带最新工具集，epoch 刷新类机械无意义（评估后跳过）；真实成因=（a）**对方还在旧版本**（模型真没工具，升级即解）或（b）模型调了但网关报错→被表述成「不可用」。修（b）：工具描述与错误文案双向钉死「本工具确实存在，失败多为服务繁忙，建议重试/减尺寸，**不要声称没有生图能力**」。验证：typecheck/277/build 全绿。**待用户反馈**：报「不可用」的同事确认其版本 ≥0.3.27；慢语音发生时看主进程日志耗时归因。

> **在途事项（2026-09-30 深夜二批，知识库优先级 + 最大化缩放撤销，待实测未发版）**：用户实报两件。①**「勾了知识库却跑去联网搜」**——根因：知识检索靠模型选工具、选工具只看描述，此前 knowledge_search 与 web_search 描述都没声明优先级。修=双向声明：knowledge_search 描述加「本会话已绑定知识库，查资料/事实/制度类问题【首选本工具】」；**绑定知识库的会话**里 web_search 描述改写为「仅在用户明确要联网或知识库未命中时使用」（`startSearchMcpServer` 增 `opts.toolDescription`，mcp-bridge 按 `getSessionKnowledgeBinding` 判定换描述）。注意：auto-RAG 注入 UI 早已隐藏（auto 默认 false），路由纯靠工具描述，此修复是正解层。②**最大化字体太大**——用户拍板对齐 Cindy：撤销 0.3.11「最大化等比放大」（0.3.13 锚 1280 封顶 1.25 整套删）；保留 did-finish-load 复位 zoom=1（Chromium 按域名记忆 Ctrl+滚轮缩放，不复位会带到下次启动——0.3.14 ⑩①的教训保留）。验证：typecheck/277/build 全绿。**待用户实测**：绑知识库问资料问题应走 knowledge_search；最大化/还原字体不再变化。

> **在途事项（2026-09-30 深夜，内置生图工具，已随 0.3.27 发，历史留档）**：用户拍板「给助手内置生图工具，用户侧随时对话生图，留口后续接其他生图服务」。v1 全链：**内置 `fundet-imagegen` MCP**（单工具 `generate_image` 直接暴露——单工具 ~100 token 无需 memory 的渐进式发现）→ **provider 层留扩展口**（`main/imagegen/gateway.ts` 的 ImageGenProvider 接口 + providers 注册表，后续接智谱 CogView/通义万相只加 provider 不动工具面/桥/审批）→ v1 provider=自建网关 Qwen-Image-2.1（`/v1/images/generations` JSON {model,prompt,size}，b64_json 返回；与语音/嵌入同一 `service.gatewayUrl` 配置）；产物落**会话工作目录 `fundet-images/<hhmmss>-<slug>-<rand>.<ext>`**（魔数定扩展名，目录不隐藏便于用户找图）；开关 `imagegen.enabled` 默认开（无设置 UI，后续版本随 provider 扩展一起加设置面）；auto-approve（用户拍板「随时可以生成」，走自有网关无外发）；尺寸校验 256..3072、默认 1024x1024、timeout 5 分钟（1024² 实测 ~31s）。验证：typecheck 全绿/**277**/277（+6）/build ✓/IPC 137/0（MCP-only 零新通道）/**真实网关生图实证**（最小请求体 HTTP 200 → 4.2MB PNG 魔数正确）。**待用户实测**：对话里说「画一个红色小宇航员」→ 应生成约 30s 后报文件路径，工作目录 fundet-images/ 有图、Canvas 可看。

> **在途事项（2026-09-30 晚二批，记忆功能上线，已随 0.3.27 发，历史留档）**：用户拍板「开吧，IM 共享记忆，管理页面高级点」。全链落地：①**agent-core**——`StartSessionOptions`/`PiExtraSpawnConfigContext` 增 `memoryScopeDir`（记忆仓作用域与文件工作目录解耦；IM 传主目录实现共享）；pi 压缩 digest 写入随作用域。**#2399 worktree 归一化评估后延后**（本仓无 worktree 会话场景；用户手动在 git worktree 里开会话会得到独立记忆仓，v1 接受——启用该场景前须移植 scope-resolver）。②**宿主开启**——`host/memory.ts` initialEnabled 读 `memory.enabled`（默认开）；pi-host `makerMemoryEnabled` getter 每会话读 manager（面板开关即时生效于新会话）；shutdown 补 `memoryManager.dispose()`。③**内置 fundet-memory MCP**（`main/memory/mcp-server.ts`+`handlers.ts`）——**渐进式发现两入口**（list_tools/call_tool，常驻 ~200 token，防 32k 小上下文顶死——六内工具定义不进 system）；memory_list/read/write/delete/search/consolidate（**memory_review 不暴露**：PiAgent 无 oneShot）；auto-approve；handlers 全注入式（MemoryStoreLike 结构类型，node --test 假 store 直测）。④**mcp-bridge**——`createPreparePiExtraSpawnConfig(logger, memoryManager?)` 参数注入（避免与 pi-host 循环 import）；manager 经参数传（**注意：不能 import getHost——pi-host↔mcp-bridge 循环**）；scope=ctx.memoryScopeDir??workingDir。⑤**面板**——侧栏第六入口「记忆」（Brain 图标）+ MemoryPanel（hero 总览+开关+文件夹钮、多仓 chips、类型过滤、FTS 防抖搜索、新建/编辑弹层、删除确认、digest 只读）；IPC +9 通道（INVOKE 137）：scopes/list/get/save/delete/search/enabled-get/enabled-set/open-folder；服务层 `main/memory/service.ts`（磁盘扫仓读 meta.json absPath 还原工作目录；**setEnabled(true) 用 enable({skipAgentSync:true})**——跳过原生联动，防 setMemory(false) 误杀 pi 压缩 digest 门控的坑）。⑥**IM 共享**——dispatcher `memoryScopeDir: os.homedir()`（与桌面默认会话同仓）。验证：typecheck 全绿/**271**/271（+9）/agent-core 878/IPC 审计 **137**/0/build ✓/**真机 e2e PASS**（C:/temp/memory-e2e.cjs：开关默认开→保存→列表→FTS 搜索「简洁」命中→scope 扫描→关/开切换→删除后磁盘分片消失）。**待用户实测**：①对助手说「记住我喜欢简洁回答」→ 记忆面板出现 user 类型新条目；②新会话问「我有什么偏好」→ 应检索到；③长会话压缩后记忆面板出现 digest 条目；④IM 发「记住 XXX」→ 桌面记忆面板（主目录仓）可见；⑤记忆面板关/开即时生效。

> **在途事项（2026-09-30 晚，Cindy 增量同步批 P1×2，已随 0.3.27 发，历史留档）**：例行增量核查（cc52aed2d..e75eae3f1，145 提交，裁决见 §9.5）后手工移植两项。①**交互卡快捷键让位（#5256）**——新 `lib/card-shortcut-yield.ts`（决策表纯函数 decideCardShortcutYield 可直测 + DOM 适配 shouldCardShortcutYield；SELECT/Radix 弹层含在让位面）；AskUserQuestionPrompt 数字/Esc 快捷键与 PermissionPrompt 回车/Esc 快捷键全部过判据（此前问答卡数字键完全裸奔：侧栏搜索打字会选中选项；审批卡焦点在「拒绝」上回车会 preventDefault 吃掉按钮原生激活变成「允许一次」）；+6 单测入 glob（262 项）。②**FindBar no-drag（#5202）**——根元素 WebkitAppRegion:'no-drag' 挖洞 + 在 ChatPage 布局树挪到 FadeSwitcher（承载 46px 拖拽条）**之后**（先序上报靠后者胜，挪之前挖洞会被拖拽条盖回）；顺带修正 ChatPage 里「悬浮挖洞不可靠」旧注释为新规则。验证：typecheck 全绿/262/262/build ✓。**待用户实测**：①开一个带选项的提问卡 → 侧栏搜索框打数字不应选中选项、焦点在「拒绝」按回车应仍是拒绝；②Ctrl+F 打开查找条 → 关闭/上一个/下一个按钮点击不应变成拖窗。

> **在途事项（2026-09-30 下午，用户实报「完成提醒消失 + 语音不识别」排查，已随 0.3.26 发，历史留档——两项功能验证均正常）**：0.3.25 发版后用户实报两件。**排查结论：两项在发布二进制（iso-run 同款）上端到端全部正常**——①完成提醒：修正时序的探针（loopback provider 种子 + CDP + 真发消息 + 最小化主窗）chime=1；②语音：网关 TTS→ASR 回环 200 且文本准确 + 应用内 `voiceTranscribe` 全链返回正确转写 + 打包版 getUserMedia/MediaRecorder 真采集正常（Realtek 麦克风阵列，2s 录到 28KB）。**语音「그」乱码根因（用户二报截图+探针实锤）**：Windows 麦克风隐私关掉「允许桌面应用访问麦克风」时 getUserMedia **不报错、只交全零数据**（RMS=0.00000/peak=0.000），SenseVoice 对静音输入随机吐字符（"그."）——根因在系统设置非应用；已随 0.3.26 加静音检测（wav-encode 峰值<0.005 → 中文指引）。**探针新坑两条（务必背熟）**：㊀最小化类探针必须等页面完全加载（≥6s）再最小化——`createWindow` 的 `revealWindow` 挂在 `did-finish-load`，加载完成前最小化会被它弹回（stack 实锤：restore 事件 ← revealWindow ← did-finish-load），曾据此连误判三轮「窗口被神秘恢复→门控失效→chime=0」；㊁残留旧探针实例会让存活实例触发 second-instance→focusMainWindow 恢复窗口（跑探针前必 `taskkill /F /IM electron.exe` 清场——但注意别误杀用户自己的 dev 实例），且日志过滤器要匹配全部标记（曾只匹配 'debug]' 漏掉 [win-evt]）。**设置排查事实**：用户库 `voice.enabled=0` 是 0.3.14 误拨遗留死值（渲染层零消费、不 gating 任何东西，可无视）；`pet.notify` 缺省=开。完成提醒设计语义提醒：仅主窗「可见+未最小化+聚焦」时静默（盯着应用不打扰是有意设计）。**后续如再报**：语音→先看是否弹「麦克风没有采集到声音」新提示（弹了=系统设置问题，指引已给）；完成提醒→问窗口状态+专注助手。

> **在途事项（2026-09-29 夜，安装提速批 asar 化，已随 0.3.22 发，历史留档）**：安装慢根因=**文件数 × 每文件固定开销**（写盘+杀软逐文件扫描；本机实测 5,622 小文件 63MB 复制 **11.3s** vs 单 85MB 文件 **93ms**，每文件 ~2ms，弱机+杀软放大到分钟级）。0.3.21 安装目录 6,029 文件中 **93% 是浏览器闭包散装 node_modules（5,622 文件仅 63MB；typebox 单包 1,383 文件含 690 个 .mts 源码）**。三项落地：
> - **A. 闭包进 asar（结构性）**：electron-builder `files` 加 `{from: resources-browser/node_modules, to: node_modules}`（走 files 拷贝不碰依赖收集器，express 死循环规避逻辑不变），删 extraResources 散装条目；`asarUnpack` 加 `**/node_modules/@img/**`（sharp 原生 dll）。**可行性 spike 五项全绿**（Electron 37：ESM 入口/裸包 CJS/ESM+exports map/子目录裸包/相对路径全部从 asar 解析；spike 脚本曾是 C:\temp/asar-spike）——0.3.14 tar.gz 死于「ESM 静态 import 在首启解压前解析」，asar 无需解压按需读，是正解。**打包应用屏蔽 NODE_OPTIONS**（探针注入失败），会话级探针改走 CDP+loopback provider 种子+browser.enabled：sendMessage `accepted:true` = SDK 从 asar 动态加载实证（startBrowserMcpServer 在会话装配时 import）。
> - **B. pack-browser-deps 裁剪 pass**：`.ts/.mts/.cts/.map/.md`+license 族+测试目录（运行时不可达），保留 5,622→**2,748 文件**（-51%），末尾清空目录+计数。
> - **C. `electronLanguages: [zh-CN, en-US]`**：locales 55→2。
> - **产物对比（0.3.21 → 本批）**：安装目录文件 **6,029→363（-94%）**；总体积 733→668MB；app.asar 56→78MB；asar.unpacked 126 文件（@img）；**安装包 261.6→249.6MB（-12MB）**；树外冒烟 PASS（且冒烟 robocopy 从 ~40s 降到数秒——提速直接体感）。**待用户真机实测**：浏览器自动化开/关两会话各跑一轮（SDK 已探针实证；browser-runtime 本体走 host.ts 动态导入，需真 Chrome 动作覆盖）+ 正常安装一次体感。

> **在途事项（2026-09-29 晚，pi 例行跟版首跑 + 检测提醒，历史留档；检测提醒已随 0.3.21 发）**：
> - **例行跟版第一次运行即拦截一个断视觉的版本**：评估升 0.87.1（latest.json 六平台 digest 齐备、镜像下载安装、theme 完整）→ agent-core 集成套件 **2 个图片附件用例失败** → 取证定位**上游调试遗留 bug** 并**回滚 0.84.4**（878/878 复绿）。取证：pi 0.87.x `resizeImage` 源码内嵌 `if (true) { return await resizeImageInWorker("./src/utils/image-resize-worker.ts", …) } catch {}`——相对路径 worker 在编译单文件 exe 里不存在且失败**返回 null 不抛异常**，函数直接 return null，后面的 URL worker 与进程内回退（1x1 png 快路径必过）永远不可达 → 所有编译版消费者的图片附件变 `[Image omitted: could not be resized below the inline image size limit.]`（视觉发图全灭）。**显式 `inputLimits.images.resize` 无效**（死在 bug 之前）；photon wasm 在包内、getFallbackWasmPaths 含 execPath 目录（wasm 非根因）。**跟版门禁=pi-agent.integration.test.ts 的两个图片用例**；等 0.87.2+/0.88 修复后重试，可向上游报 issue（取证已备）。
> - **update.mjs 两修**：①`FUNDET_GH_PROXY` 前缀镜像（同 tools/git；digest 校验保留，直连波动日必须）；②pin 分支收尾日志 `path.join(UPDATES_DIR, requestedVersion)` 未传版本时 null 崩溃（下载/promote 本身已完成，纯日志 bug）。
> - **检测提醒落地（应用内热更评估的替代方案）**：`host/pi-version.ts`（随包版本 spawn `pi --version` 缓存 + 上游 `releases/latest` 302 Location 探测，gh-proxy 前置直连回落 8s 超时，24h 内存缓存，失败静默）+ IPC `pi:version-info` 四件套（通道 126）+ UpdateCard 新增「Agent 运行时（pi）：0.84.4 · 上游最新 v0.87.1（将随下版应用更新带来）」——**只读检测不做热更**（供应链/验证纪律取舍见同日上午评估记档）。
> - **pi 例行跟版锚点（新惯例）**：每月一次（与 §9.5 Cindy 同步同节奏）。流程：改 `tools/pi/latest.json`（六平台 digest 取自 release API）→ `FUNDET_GH_PROXY=https://gh-proxy.com/ node tools/pi/update.mjs --platform=win32-x64` → agent-core 全量（真 pi 集成套件即门禁，图片用例必看）→ 真机清单（贴图/纯文本多轮，用户执行）→ 随下版应用发。**坑：直连波动日管道接 tail 会吃退出码，重试命令别用 `cmd | tail` 判成败**。

> **在途事项（2026-09-29 下午，0.3.20 发，历史留档）**：0.3.20（Cindy 同步批 P1×2+P2×3）已发 GitHub Release（tag=847d6a8，三资产齐，sha512 一致，镜像 200，备份 D:\Fundet-Setup-0.3.20-x64.exe，隔离冒烟 PASS）。内容详见 §3.5 0.3.20 行。**Cindy 剩余 P2**：Lightbox 滚轮/触控板缩放（等真实看大图需求）；#5204 rename 有界重试（无内核自更新场景，仅作 update.mjs 参考）。下述为该批实现细节留档：
> - **① pi spawn windowsHide（上游 #5173 同构）**：agent-core `rpc-client.ts` 补 `windowsHide:true`（+vi.mock spawn 选项测试）；主进程同扫 4 处裸奔点——mcp-bridge stdio 代理/探测两处（crossSpawn）、computer/driver 遥测、index.ts AVX2 预检。**纠正早前误判：dws runCommand（默认 true）与 checkpoint/git-runtime 原本就有 windowsHide，复扫盘点「全仓零命中」是 grep 截断所致**。pi 子进程内部的 spawn（cindy-bridge rg / cindy-subagent）继承 pi 自身控制台，不加。
> - **② 桌面 ask_user_question 问答卡**（此前 ChatPage 只认 permission，问答请求无卡可点、turn 挂死到 abort）：新 `components/AskUserQuestionPrompt.tsx`（Cindy 向导收敛版——多题步进/上一题/跳过/Esc、单选点击即进、多选勾选+JSON 数组串编码、宿主自供自由输入行、数字 1..N 与 N+1 快捷键；**未移植** Cindy 的滑页动画/最小化条/答题草稿持久化——切会话中途进度会丢，v1 接受）；纯函数 `shared/ask-options.ts`（#5198 `isFreeTextAskOptionLabel`/`visibleAskOptions`，+4 测试）同时接入 IM 文本桥（im-interaction 提问文案与序号解析同口径过滤，+3 测试）；sessionStore 新增 `resolveAskUser`；ChatPage 接 pendingAsk 分支（composer 悬挂位，与 PermissionPrompt 并列）。
> - 验证：typecheck ✓ / desktop **252**/252 ✓ / agent-core **878**/878 ✓（flaky 也绿）/ build ✓。**待用户实测**：问答卡需真模型触发（让 agent 出选择题）；windowsHide 重启后看 pi 会话不再伴生 conhost.exe。
> - **P2 批（同日）**：①**表单弹窗防误关（#5104）**——全仓仅 AddProviderWizard 与 ProvidersPanel 两个 Radix Dialog（均带 API key 表单），`Dialog.Content` 加 `onInteractOutside preventDefault`（Esc 仍可关）；手搓弹窗（自动化编辑器/技能详情/回滚/分享）核实遮罩本就不可点关。②**建议卡悬停预览 prompt（#5120）**——WelcomeSuggestions 每卡套 ui/Tooltip（side=top）显示 prompt 全文，点击行为不变。③**用量图悬停浮层**——柱图/热力图的原生 `title` 换成自绘浮层（即时出现、CINDY 卡样式、按元素矩形锚定不跟随光标防 mousemove 重渲染、useLayoutEffect 实测尺寸钳制进视口、柱图带模型分解色点行）。**纠正复扫误判：柱图/热力图原本就有原生 title 悬停（「无任何悬停」是 grep 错文件名），本项实为慢速原生 title→即时样式浮层的升级，非从无到有**。

> **在途事项（2026-09-25，0.3.14 发）**：**无**——0.3.14 已发 GitHub Release：tag=commit 6083bdc（版本提交在内，merge-base 验证），三资产齐（exe 261.6MB/blockmap/latest.yml，资产端点+gh-proxy 镜像双复核，sha512/size 与本地一致），非 draft；安装包备份 `D:\Fundet-Setup-0.3.14-x64.exe`（249MB）。发版前例行 Cindy 增量速扫：**714ec5b1f..96dcfad99 两天 99 提交无 P0**（大头 mobile/bots/teammates 红线；唯一疑似同构 #5062 code-less 服务错误恢复——本仓 errorRetry 分类器已覆盖 503/529/过载模式，不移植；**同步点推进 96dcfad99**，下锚=09-30 周全量或下版发版前）。打包版冒烟史上最全 8 项 PASS：双 tar.gz 资产/首启双解压（git→userData、browser→安装目录原位）/zoom 复位/麦克风 Cindy 形态/预热闭环/真 TTS（108KB wav）/语义检索全链（**换说法「出差别忘了报账的时间限制」命中差旅制度原文，零关键词重叠**——嵌入检索真实生效）。安装期文件数 **14,500→405（-97%）**。上传走 draft 先建+独立进程（~10 分钟，262MB 网络慢日）。
> **打包机楔子排障全记录（2026-09-24 白天，已随重启解决）**：electron-builder 曾稳定挂死在「searching for node modules」（单核空转）；**已排除**仓库内容/路径/node_modules/FS 速度/符号链接/pm 模式——机器级状态问题。**起病链**：打包版冒烟 → Fundet 死后 **crashpad_handler 孤儿进程锁住 dist\win-unpacked\resources\app.asar**（杀 Fundet 不够，crashpad 会留！）→ 后续构建连环异常，重启才彻底清。**新坑入账**：①打包版冒烟后必须查杀 crashpad_handler 残留再打包；②Restart Manager API（C:\temp\fundet-dev-tools\FileLockFinder.cs）可定位文件占用者；③robocopy /XD dist 排掉所有层级同名目录（误杀 vendored dist）；④打包版 safeStorage 与 dev/安装版互解不开真实密钥（app 绑定加密）——打包冒烟涉及会话一律用 **loopback provider 种子**（127.0.0.1 免 key）。

> **SkillHub 实现事实（0.2.30 批次，随 0.3.0 发）**：`shared/skillhub.ts` 类型；`main/host/skillhub.ts`（api.skillhub.cn 匿名客户端 + 安装管线：清单校验→4 并发下载→逐文件 sha256→临时目录原子 rename 到 `~/.agents/skills/<slug>/`→写 skillhub.json 元数据；重装走备份替换；≤50 文件 ≤5MB 防穿越）+ 零依赖 `skill-frontmatter.ts`（node --test 下 agent-core 是 TS 源不可 import，剥出验证器）；单测（fixture=真 API 捕获）；IPC 四通道；SkillsPanel 双 tab。实测：dev+打包（db-only 种子 9343）双端真 API 30 卡/搜索/详情/安装 1.5s 物理验证+清场。**交互两改（用户实测反馈）**：①卡片改**点开详情弹层**（SkillhubDetailDialog，对齐 ConfirmDialog 观感：遮罩+居中卡+内容区滚动/Esc/点遮罩关；统计行/概览/安全审计可点报告链接走系统浏览器/更新日志/底部安装钮四态），内联展开整体废除——原展开条信息量太薄用户视为「没详情」；grid 加 items-start 修同行拉高。②**Esc 分层修复**：面板壳 SidebarPanelDrawer 与弹层都在 document 监听 Esc，一次 Esc 连关两层——壳层加 `[role="dialog"] 存在则不吃 Esc` 守卫（对所有 dialog 通用，含 ConfirmDialog）。全链 dev 实测：弹层内容齐全/Esc 只关弹层再 Esc 才关面板/全新安装→弹层即时翻已安装/已装卡角标+重新安装按钮。**图标一事的决策轨迹（防翻烧饼）**：发现页图标先做了整套 `skillhub-icon://` 主进程代理（域白名单+1MB+魔数嗅探+磁盘缓存，因 CSP img-src 不放行 https，直连全被拦回退 Zap）——dev/打包双端实测 24/28 渲染通过后**用户拍板不要图标、卡片纯文字**，已整体拆除（协议文件/CSP 入口/host 函数/改写器/4 组测试全删，不留死代码），卡片名称升 14px 当视觉锚。若将来重启图标：完整方案在 git 历史（ae21c7c 完整实现，后续 commit 拆除）。**skillhub.cn 事实**：api.skillhub.cn/api/v1 匿名无频限（search/skills/{slug}/files/file），文件走腾讯 COS CDN 302；**搜索真参数是 `q=`（中英文都真搜全库）——`keyword` 等其它参数名被服务端静默忽略、回落默认榜**；无匹配回落默认榜（其设计）；**结果顺序跨请求会抖动**，E2E 认卡用精确 slug 搜（如 q=bid-proposal-compliance-assistant 稳定 rank0）；中文搜索结果**会吐重复 slug**（parseSkillhubSearch 已保序去重）；排序白名单 downloads/trending/stars/score；真包普遍带 `_meta.json`（下划线开头）——FILE_PATH_RE 必须放开首下划线。**M2 裁剪**：合集（skillsets 端点已验证可用）未做 UI，M3 缓冲服务器/版本历史回滚/发布未动。

> **品牌重塑未灵（0.3.0）——已于同日回退**：09-21 用户先定名「未灵 Weiling」（未来互联之未+灵动精灵；备选曾提伙星/小未/鲁小班），全链改名+打包标识（Weiling.exe/Weiling-Setup）+数据连续性钉死（app.setName('Fundet')+userData 显式拼 Fundet，改名第一雷=brand.name 直拼 userData 目录，改了所有存量数据"消失"）；**同日晚些用户拍板改回 Fundet**（"这里的未灵都改为 Fundet"）——展示名/打包 productName/快捷方式/安装包名全回 Fundet，未灵只存在于 git 历史（9077948/7d9a832）。教训：**改名这种全链决策要让用户先看到实物（出包验收）再定，别当天连环改**。
>
> **Cindy 对齐四件套（0.3.0，保留）**：①logo 圆形化（超采样蒙版透明角，GDI+ LockBits 乘 alpha；BrandMark 比例按品牌分支 1:1，旧 581/567 会拉成椭圆）；②**亮色主题换 Cindy Light 原值**（surface #f2f2ed/card #fdfdf8/chip #eeeee9/board #e4e4df/text #1a1a1a/accent #3c3f43，从本机 Cindy 0.1.14 D:\AI\Cindy asar 主题对象抄录，暖米色弃用；暗色本就是 cindy-dark 原值）；③**新会话空消息态 = Cindy 首页复刻**：空消息时——header 隐去标题/下划线（仅 46px 拖拽条）、composer 块垂直居中（flex-1 justify-center）、lockup（40px 圆 logo + 24px Fundet 同行）在 composer 列内上置、WelcomeSuggestions 引导卡（10 池取 4，点击预填 prompt；换一批洗牌、不再显示 localStorage `fundet.welcome-suggestions.dismissed=1`）；**首条消息发出后全部回归**（header 标题/下划线回、MessageStream 挂载、lockup/建议卡退场）——dev 双态实测全绿。④Esc 分层/详情弹层等集市交互见 0.2.30 条。**ChatPage 空消息布局结构（改动雷区）**：slice.items.length===0 分叉处三处——①header 标题区条件渲染；②MessageStream 条件挂载；③composer 容器 flex-1 justify-center + lockup 内嵌列头。此结构用平面条件而非嵌套（嵌套把 composer 移进 lockup 容器改一片破一片，stash 重做过一次）。**Cindy 抽取方法论**：D:\AI\Cindy\resources\app.asar → npx @electron/asar extract → 主题值在 minified JS（TopLevelErrorBoundary-*.js）的主题对象字面量里（cindy-light 的 zE={surface:...}），homeSuggestions 是 JSON.parse 大串（标签+prompt 表，~20 条）；Cindy 单实例在跑时 --remote-debugging-port 会被吞（单实例锁挂到旧实例）拿不到 CDP。**发版注意**：安装包名回 Fundet-Setup-*.exe；E2E 点引导卡要用 label 白名单（类选择器会误点侧栏/跳到底钮，已踩）。实测：dev+打包（db-only 种子 9343）双端真 API 30 卡/搜索/详情/安装 1.5s 物理验证+清场。**交互两改（用户实测反馈）**：①卡片改**点开详情弹层**（SkillhubDetailDialog，对齐 ConfirmDialog 观感：遮罩+居中卡+内容区滚动/Esc/点遮罩关；统计行/概览/安全审计可点报告链接走系统浏览器/更新日志/底部安装钮四态），内联展开整体废除——原展开条信息量太薄用户视为「没详情」；grid 加 items-start 修同行拉高。②**Esc 分层修复**：面板壳 SidebarPanelDrawer 与弹层都在 document 监听 Esc，一次 Esc 连关两层——壳层加 `[role="dialog"] 存在则不吃 Esc` 守卫（对所有 dialog 通用，含 ConfirmDialog）。全链 dev 实测：弹层内容齐全/Esc 只关弹层再 Esc 才关面板/全新安装→弹层即时翻已安装/已装卡角标+重新安装按钮。**图标一事的决策轨迹（防翻烧饼）**：发现页图标先做了整套 `skillhub-icon://` 主进程代理（域白名单+1MB+魔数嗅探+磁盘缓存，因 CSP img-src 不放行 https，直连全被拦回退 Zap）——dev/打包双端实测 24/28 渲染通过后**用户拍板不要图标、卡片纯文字**，已整体拆除（协议文件/CSP 入口/host 函数/改写器/4 组测试全删，不留死代码），卡片名称升 14px 当视觉锚。若将来重启图标：根因与完整方案在本条+git 历史（ae21c7c 完整实现，后续 commit 拆除），.userData 下 skillhub-icons 缓存目录残留无害。**skillhub.cn 事实**：api.skillhub.cn/api/v1 匿名无频限（search/skills/{slug}/files/file），文件走腾讯 COS CDN 302；**搜索真参数是 `q=`（中英文都真搜全库）——`keyword` 等其它参数名被服务端静默忽略、回落默认榜**（2026-09-20 实测 pdf/dingtalk/乱码词同返回同榜才发现；无匹配时空列表回落默认榜、非空报错；**结果顺序跨请求会抖动**，E2E 认卡别依赖排名——用精确 slug 搜（如 q=bid-proposal-compliance-assistant 稳定 rank0））；中文搜索结果**会吐重复 slug**（渲染 key=slug 会撞，parseSkillhubSearch 已保序去重）；排序白名单 downloads/trending/stars/score；真包普遍带 `_meta.json`（下划线开头）——FILE_PATH_RE 必须放开首下划线（初版这里挡死安装）。**M2 裁剪**：合集（skillsets 端点已验证可用）未做 UI，M3 缓冲服务器/版本历史回滚/发布未动。**测试纪律（新教训）**：打包版渲染进程无 `require`，E2E 目录数检查用 CDP 拿不到 fs——物理磁盘检查为最终仲裁；**冒烟种子必须 db-only（fundet.db* 共 1.2MB）**——整份拷贝 %APPDATA%\Fundet 会带 ~8GB 检查点快照，历史 6 份把 C 盘写爆到 400MB（2026-09-20 用户实报，46.4GB 已清，launch-dev/sh-pack-launch 均已改最小种子）；**E2E 探针一律写文件脚本**——bash 里 node -e 内联多层转义（模板串+引号）必炸，同坑连踩三次。

---

## 7. 待办 / 已知债

- 真 Key 全链路冒烟。
- Mac 公证（需 Apple 开发者证书 + CI notarize）。
- Cindy 上游可跟进项：browser-runtime 网络守卫竞态修复、MCP 懒加载（**截至 2026-09-03 上游均未落地**，vendor lock 仍 b972feb3 与本仓一致）。「yield cells」（= 上游 #3767 yield marker 收紧）经核查为纯 Codex 作用域（`agents/codex/yielded-exec-cell.ts`），本仓无 Codex harness，**已划掉**。
- **记忆功能（Cindy 调研记档 2026-09-30，开启评估用）**：Cindy 的 Maker Memory = **纯本地文件记忆**，双作用域：`<userData>/owners/<登录账号hash>/maker-memory/<sanitized工作目录>/`（每账号×每工作目录一份仓，同目录多会话共享；无账号环境等价每机一份=我们现状 basePath 直接 userData）。**存储**=人可读 .md 分片（`<type>_<slug>.md` + yaml frontmatter title/description/type/updatedAt）+ MEMORY.md 索引（仅 4 类 curated）+ SQLite FTS5（fts.db，WAL）+ meta.json；限额：分片软 2KB/硬 8KB、索引 4KB、description 200 字。**4 类 curated**（user/feedback/project/reference，照搬 Claude Code auto-memory 规范）+ `digest` 系统内部类（pi 压缩上下文时丢弃内容摘要沉淀：进 FTS 可检索、不进 MEMORY.md 不注入 prompt——「压缩即记忆」best-effort）。**注入**=新会话 system prompt 拼 memory 段（使用手册 system-prompt.md + 当前 MEMORY.md 索引全文）；模型工具面走 `cindy_memory` MCP（memory_write/read/search/review/consolidate，schema 校验+ALREADY_EXISTS+尺寸软警告）；支持手trigger「Save in memory:/记到 memory:」。**memory_review**=LLM 复审只出建议不自动执行（依赖 host 注入 oneShot agent，默认 claude haiku）。**flush-controller**=pre-compaction 抢救（token 阈值 0.70/0.85/0.92 多档），**当前 A 轻版只打日志不注入**（Cindy 自己也在验证期）。**设置**=`<userData>/memory-settings.json` 按 agent kind 开关（maker/claudeCode/codex/pi，默认全开）；UI 仅开关，编辑记忆=直接改 .md 文件；bots 伙伴有记忆管理页（#4971，bots 域）。**Fundet 开启成本**：agent-core 模块已在（09-01 快照，**缺 #2399 worktree 归一化——开启前应补**，否则 git worktree 会话各开一份仓）；host/memory.ts 已装配恒关；需新建内置 memory MCP server（照 search/browser 手写 JSON-RPC 模式包 MakerMemoryStore 五工具）；system prompt 拼装链路快照已有；设置开关照 pet.enabled 模式；**review 工具先不暴露**（PiAgent 无 oneShot，agent-core 已知断链）或砍掉 memory_review；IM/自动化会话是否共享记忆需拍板（Cindy #4566 教训：伙伴记忆独立于全局开关）。
- Cindy 功能级借鉴候选（2026-09-03 盘点，均在 Cindy「跳过登录」模式可用、不碰云）：会话搜索（`localDb/chatHistorySearch` FTS5+向量 RRF，可经 MCP `session_search` 给模型）、checkpoint/回滚（`main/git-snapshot` + RewindPreviewDialog）、错误分类重试补强（本仓已有基础重发，上游按限流/过载/断流/配额分类+倒计时）、effort/思考开关（`EffortSlider`/`ThinkingToggle`）、@ 文件引用+本轮产出文件卡（`AtMentionPanel`/`GeneratedFilesCard`）、计划/待办/提问交互卡（`PlanReviewBubble`/`TodoListCard`/`AskUserQuestionBubble`）、Goal 目标托管（`main/goal-host`，≠定时任务）、Ollama 本地模型托管（`main/local-model-runtime`）、消息排队（`PendingQueuePanel`）。会话导入/cross-agent-convert 数据源涉禁搬的 CC/Codex 生态，移植前需产品裁决。
- **钉钉完整集成（2026-09-18 已移植，Cindy lizi-im 同机制）**：API 客户端 `im/dingtalk-api.ts`（token 双轨缓存+图片下载/上传+robot 主动发+webhook 过期回退）；入站纯函数 `im/dingtalk-inbound.ts`（text/richText/picture/audio/video/file）；图片收发全链（入站 downloadCode→下载→stage→image 块；出站本地图片→上传→单独发图）；**审批问答桥** `im/im-interaction.ts` + dispatcher（IM 会话 ask 档，交互转文本问答，回复旁路防死锁，9min 超时 deny）；per-bot 工作目录。29 IM 单测全绿。
- **钉钉/IM 与 Cindy 差距裁决（2026-09-18 核查留案）**：协议层同款（同 dingtalk-stream SDK/个人凭证/TOPIC_ROBOT）；Cindy 多出的属边界裁剪非欠账——IM 内审批问答（interaction.ts 文本问答桥，P2：需要在 IM 跑 ask 档任务时做）、IM 图片收发与流式卡片（lizi-im 885 行适配层，P2：手机发图给机器人的真实需求出现时做）、per-bot 工作目录隔离（多 bot 同机时再做）。
- IPC 错误已统一剥壳（2026-09-11）：preload `invoke()` helper 按 channel 精确剥 `Error invoking remote method <channel>: ` 前缀（`shared/friendly-error.ts` 的 `stripIpcErrorPrefix`，有单测），UI 只显业务原文。
- 文件夹拖入 composer；Canvas 未覆盖类型已有「用系统打开」兜底（CanvasPane 右上角常驻按钮，2026-09-23 核实非待办）。**遗留小洞**：`FS_OPEN_PATH` 无文件类型闸（register.ts 直接 shell.openPath）——agent 产出可执行文件被点开即执行，待加扩展名 deny-list。

> **全仓代码研究盘点（2026-09-23，接手四路深挖，均已亲核）**：
> - **规模修正**：browser-runtime src 实为 ~3.4 万行（`_generated/` 31k 同步自 openclaw + `shim/` 1.7k 垫片 + 根适配层 526 行）——"小包"印象作废；全仓 TS ≈11.4 万行（agent-core 源/测各 ~2 万）。IPC 通道共 ~128 个（invoke+push）。
> - **渲染层小 bug（待修）**：ChatPage.tsx ~1014 `!activeId.startsWith('draft-')` 恒真（草稿 id 是 crypto.randomUUID），空草稿也显示会话 ID 段；判草稿应走 `isDraftSession()`。
> - **注释漂移**：sessionStore.ts 头注释写「100ms 节流」，实现是 FLUSH_MS=32。
> - **agent-core 未接线面（死代码/负债，非待办）**：desktop 只消费 Maker 6 方法、Session 9 方法；steer/getUsageSnapshot/sessionTree/planMode/compact/exportHtml/fork/reviewMode 整链、memory 模块（~1500 行装配、makerMemoryEnabled 恒 false）均未消费。包内数十文件、数百处 cindy/CINDY 命名（env `CINDY_PI_*`、provider id `'cindy'`、`XDT_SESSION_TURN_STALL_MS`）是底座机制名（pi 扩展与 bridge 依赖），**不是待清理项，改名即断**。
> - **审批超时语义澄清**：10min 兜底 deny 在 desktop 宿主层（register.ts pendingInteractions）；agent-core 核心交互卡本身无超时；auto-review delegate（reviewAutoPermissionAction）Fundet 未接 → 灰区一律 ask。
> - **browser-runtime 同步工具缺失**：lock.json/MAINTAINING.md 引用的 `scripts/browser-runtime/sync.mjs` 不在本仓（留在上游），`_generated/` 禁手改 = 再同步能力已失，升级 vendored 需整目录人工比对；upstream lock b972feb3 + 2 条 LOCAL_PATCHES（fake-IP 豁免、去上游自动 profile）。
> - **杂项**：localStorage key 品牌分裂（fundet.* 为主、longma.* 残留在 sidebar-width/profile/font）；checkpoint 环境变量 typo `FUNET_CHECKPOINT_ROOT`（少 D，测试专用自洽）；with-brand.mjs 已硬编码只收 fundet（longma 分支仅存参考）；`.msg-stream-items > *:not([data-virtual])` 的 content-visibility 规则虚拟化后仅剩空态命中（优化已被真虚拟化取代）；resendLast 绕过 lastSendInputs 不享自动重试。

> **全仓代码研究复扫（2026-09-29，0.3.18 后，六路深挖 + 两 bug 亲核实证；同日修复批见 §6 在途事项）**：
> - **规模**：全仓 TS 116,061 行/590 文件（browser-runtime `_generated` ≈3 万行占 1/4）；渲染层 ≈2.03 万行；agent-core 源/测各 ≈2.03 万行；`ipc/register.ts` 1442 行。IPC = FUNDET_INVOKE **125** + FUNDET_PUSH **12** + **pet 11 个字符串散写**（未进 channels.ts 收口，是「新 IPC 四处一起改」铁律的存量例外）；WINDOW_MINIMIZE 等四个定义在 INVOKE 组但实际走单向 send。
> - **健康实测**：typecheck ✓；IPC 审计 125/0 ✓；desktop 单测 245/245（09-29 修复批后：219 −13 随死代码作废的用例 +14 孤儿套件补入 +10 微信 +5 URL）；agent-core 876/877（`cindySubagentParentWatchdog` 负载敏感 flaky，单跑/复跑均过）；browser-mcp 91；shared 48。孤儿测试与审计脚本路径问题均已修（09-29）。
> - **确认 bug ①（影响已发的 0.3.18）：桌宠联动 stale closure**——ChatPage pet 订阅 effect `deps=[]`（ChatPage.tsx:263-294）捕获首渲染的 `createSession`，而 `providers` 初值 `[]` 异步装载（:83/:227），空 providers 走「请先配置 provider」提前 return：**左键新对话、右键截图的强制新建会话实际失效**（截图注入当前会话/空态）。0.3.18 冒烟只验了窗口创建未验交互。**已修 09-29**（createSessionRef，workDirRef 同款）。
> - **确认 bug ②：预热指纹不对称**——`prewarmSession` 存指纹不带 `getBinding/boolSetting`（全默认空/false），`prewarmAttachDecision` 比对时带真实值：开了浏览器/电脑操作开关或绑了 KB 的用户预热必指纹失配→discard 重建，预热白做（静默性能回归，无功能故障）。**已修 09-29**（prewarm 侧与 attach 侧同口径）。
> - **架构事实**：`resumeSessionId` 全仓零调用——**重启后旧会话=全新 pi 上下文**（UI 历史只是 SQLite 显示层，模型看不到，sessions.sdkSessionId 只写不读）；~~pet-state-bridge 的 `interaction_request` 是死分支~~（**已修 09-29**：审批走独立 setInteractionListener 通道，新增 bridgeInteractionRequest 接通——审批/问答弹窗时桌宠 notify）；~~petScreenshot 取 `sources[0]` 当主屏~~（**已修 09-29**：按光标所在屏 display_id 匹配）；service-gateway=明文 HTTP 固定公网 IP（语音/嵌入文本链路裸奔，待运维上 https）；~~broadcast 群发所有窗口含桌宠~~（**已修 09-29**：pet.html 窗口跳过）。
> - **死代码批（已全部清理 09-29）**：UsageDashboard.tsx 死组件（+孤儿 key）、pet sprite 52→22 张（留 pet.html 占位 idle_00 + 代码引用 21 张）、kb FTS 残留三件套（kb_fts DROP 清存量）、pack-browser-deps 死产物 tar.gz 段、PET_SIZE/frameDir/spritesPath/voiceEnabled；wechat-ilink 媒体收发能力随微信图片支持转正（mediaTransfer/mediaCrypto 开始被消费），upload/typing 仍闲置属 vendored 备用。
> - **注释漂移批（已全部修正 09-29）**：embeddings.ts 头注、register.ts 不存在的「升级语义检索」按钮提示、DebugPage「LongMa 调试台」、全部 `[longma:]` 日志前缀、ci.yml 引用已删 dist-mac.yml、checkpoint `FUNET_`→`FUNDET_` typo、providerPresets/Sidebar 注释。品牌变体机制内的 LongMa 字样（brand.ts/BrandMark/pi-host replace/电子 builder 注释）**不是漂移，不许清**。
> - **边界风险**：~~`knowledge/url.ts` `redirect:'follow'` 不做逐跳 SSRF 复审~~（**已修 09-29**：fetchGuarded 手动逐跳+每跳 assertPublicHttpUrl+20s 总时限，+5 测试）；~~微信纯图片消息静默丢弃~~（**已修 09-29**：ilink downloadMedia+AES 全链落地，下载失败文字降级，+10 测试）。**仍开放（评估后刻意不动）**：`stageFileIntoWorkDir` 无大小上限（stageBytes 有 32MB）；微信渠道共享全局 im-workspace（per-bot 隔离仅钉钉——路径常量红线，动前必想）；agent-core flaky 测试。
> - **防线复核完好（勿再重查）**：审批 10min 兜底 deny（仅 permission 类挂定时器；ask_user_question 靠会话关闭时 pi 侧 dismissAllPendingPrompts 强制 deny）；快照后台串行队列不在发送关键路径；zoom 1280 锚定封顶 1.25；SSRF 每跳复审+跨 origin 剥敏感头+fake-IP 两段豁免；控制面写守卫 bypassPermissions 下仍强制确认；preview deny-list/FS_OPEN_PATH 27 扩展闸/附件 stage 约束；`will-navigate` 放行所有 `file://`（打包态自身就是 file 协议，属必要放宽）。

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

**上次同步点：e75eae3f1（2026-09-30 增量核查完成；窗口 cc52aed2d..e75eae3f1 共 145 提交已全部裁决，见下；0.3.26 发版后例行增量）**。

**节奏锚点**：下次 = 发版前增量 或 2026-10-06 周全量（先到者）。

**2026-09-30 增量核查（cc52aed2d..e75eae3f1，145 提交）**：**P1 两项（同构实锤，同日手工移植，见在途事项）**：①`613e41e76` #5256 **交互卡快捷键让位**——三张卡（授权/计划/提问）window 级回车/Esc/数字快捷键会在按键已有归属时替用户做决定（焦点在「拒绝」上回车变「允许」、侧栏搜索打数字选中提问选项、Esc 关菜单顺带拒计划）；统一判据 `shouldCardShortcutYield`（已处理/组字/可编辑控件/卡片外浮层与控件让位、卡片自己按钮上普通回车让给原生激活、修饰键组合保留）。**本仓同坑实锤**：AskUserQuestionPrompt 数字键完全裸奔（0.3.20 移植早于此修复）、PermissionPrompt 只挡了输入框没挡按钮/浮层——均已接线。②`b7967db99` #5202 **FindBar no-drag + 拖拽区规则修正**——Electron 拖拽区纯几何、**renderer 按布局树先序上报 drag/no-drag 矩形、重叠处列表靠后者胜**（这条修正推翻了我们 0.3.11 时代「悬浮 no-drag 挖洞不可靠」的旧认知：可挖，但挖洞元素必须在布局树中位于 drag 元素之后）；本仓 FindBar `top-1 right-4` 与 46px 拖拽条垂直全重叠且原排在容器前=按钮被吞，已挖洞+挪到 FadeSwitcher 之后。**核查后不适用（勿重查）**：#5236 effort 切换即时生效（我们 SESSION_SET_EFFORT 本就活会话热切）；#3024 subagent 启动失败上浮（`<tool_use_error>` 是 Claude Code harness 协议标记，本仓无该 harness）；#5261 sessions 归档同步（codex archive-state 域）；migration 缺失分类指引（他们的 migrationRunner 架构，本仓 drizzle 静态+raw SQL 幂等不同构）；#5213 proxy 大 SSE 事件（codex-proxy 层本仓无）；#5215 pi release 检查复用 GitHub 登录（本仓已走匿名 302 探测）；desktop 测试两项 lock deadlines/skill shelves watcher（架构不同构）；#5254 GPT-6.1/Codex models（服务端 models 族）；#5221 Claude 订阅连接提示（订阅红线）。**红线簇整批跳过**：mobile 伙伴改版~18、companions 伙伴导入~60（凭证脱敏/技能目录/导入恢复大簇）、github 账号与下载~11、bots 4、shared-task 2、device-link 1、codex 3、scheduler 1、ios-simulator 1、im 大陆机器人渠道 1（bots 云）、i18n 1（本仓无多语言）、chat 远程多端 2、auth 验证码 1、design 台账 2。

**pi 例行跟版锚点（2026-09-29 起新惯例）**：每月一次（与 Cindy 同步同节奏）。流程：改 `tools/pi/latest.json`（六平台 digest 取自 release API）→ `FUNDET_GH_PROXY=https://gh-proxy.com/ node tools/pi/update.mjs --platform=win32-x64` → agent-core 全量（真 pi 集成套件即门禁，**两个图片附件用例必看**——0.87.1 即被其拦截）→ 真机清单（贴图/纯文本多轮，用户执行）→ 随下版应用发。**不做应用内 pi 热更**（供应链/验证纪律取舍，2026-09-29 评估留档；四判据触发再议）。当前 pin 0.84.4，**0.87.x 被上游图片 bug 阻塞**（取证见 0.3.21 行），等 0.87.2+/0.88 修复后重试。

**2026-09-29 全量核查（96dcfad99..cc52aed2d，222 提交）**：**P1 两项（同构实锤；均已于同日手工移植，见在途事项）**：①`57854d15f` #5179 pi spawn 补 windowsHide——pi.exe 是 Bun 控制台子系统二进制，Windows 不隐藏则每会话派生 conhost.exe；本仓 `rpc-client.ts:113` 同病且**全仓 grep windowsHide 零命中**（dws cmd / MCP stdio 代理 / git-runtime bsdtar / checkpoint git 等 spawn 点全裸奔），3 行修+测试。②**桌面 ask_user_question 问答卡缺失**——`ChatPage.tsx:645` 只认 permission，问答请求到达桌面 UI 无卡可点、turn 挂死到 abort（IM 文本桥反而有处理）；Cindy 本窗口恰好交付整套 AskUserQuestionPrompt 卡 + `f53624ced` #5198 免费输入纯函数（maker-shared/interaction.ts 的 `isFreeTextAskOptionLabel`/`visibleAskOptions`：识别「其他（回复说明）/Other (please specify)」式模型自造选项并剔除、宿主自供输入行，38 行源+52 行测试可直接移植）。**P2**：#5120 建议卡 hover 预览 prompt（我们 WelcomeSuggestions 只显示 label，点击已预填）；`be3c9eb89` 用量柱图自绘悬停浮层+读屏明细（我们 UsageHistory 柱图无任何悬停详情）；`1e16eb61e` Lightbox 滚轮/触控板区分缩放平移（我们 Lightbox 无缩放，其 lightboxGestures.ts 纯逻辑可移植；Mac 捏合 e30a25644 跳过）；#5104 表单弹窗遮罩误关（我们 AddProviderWizard 用 Radix Dialog 默认点外关闭=误点丢 API key 输入，AutomationsPanel/SkillsPanel 弹层同查）；#5204 pi 内核 rename 有界重试（我们无内核自更新，仅作 tools/pi/update.mjs 解压链参考）。**核查后不适用（勿重查）**：#5207 markdown 主进程卡死（他们通知预览在主进程跑 marked 再换 unified；我们主进程不解析 markdown）；#5183 发送气泡消失重现（他们 local-history echo 架构；我们 appendItem 乐观插入永不重建，已亲核 sendMessage）；#5045 413/重试重复输入（他们 contextOverflowRollover+send 事务体系；我们 retry 不重插 user 消息，结构免疫）；`e5597dcde` 等 agent 触发更新安全簇（他们 xdt-helper MCP 暴露宿主能力给 agent，我们 agent 面无 update 工具）；#5087 scheduler 保留自动任务聊天（我们 auto- 消息本就落 DB 仅侧栏隐藏，设计内）；`06f7cfd5a` raw HTML img 当交付渲染（需放开 raw HTML，与 markdown 四道安全防线冲突，有意分歧）；auto-review 网关超时重试/outage→Full access（LLM 审阅委托未接线）；语音簇（云语音 vs 我们本地网关 ASR/TTS 栈不同构）；图片标注大簇（我们无标注系统；若未来做视觉标注，`0cde17f9b` maker-shared 跨端纯函数核心是起点）。红线域全跳过：mobile（安卓对齐 iOS/象牙白色板）、bots（伙伴群聊三阶段+Hermes 导入+SOUL 补种系列~20 提交）、shared-task 邀请链、device-link、codex（含 scheduler 恢复四连）、plugins（只读模型目录/安装权限确认）、订阅模型/claude 余量、remote-desktop、telegram、orca、ios-simulator、terminal、cindy-media、cindy-helper。

**2026-09-23 全量核查（c3fcefd49..714ec5b1f，413 提交）**：**P0/P1 = 无**（无安全修复落在同构代码上；#4518 类控制面守卫未复发）。大头全在红线/异构域：built-in skill/Learn 体系（账号云技能，~30 提交）、账号边界回滚（多账号体系，~20）、共享任务/伙伴、codex 专项修复、Cindy Make/ios-simulator/remote-desktop、worktree 回收族。**P2 条件触发项（勿主动做）**：①**工具循环熔断 loop-guard**（#4837/#4929：agent 死循环工具调用检测+正常日志轮询/子代理等待豁免——我们无此机制，上游实现在 agents/shared/loop-guard.ts 纯函数可移植；触发=真实出现循环烧 token 报障）；②pi 内核版本管理+正式版恢复（#4913：上游已动态化，0.85.x 线存在；触发=pi 升级频繁成痛点）；③Git 保存点三态策略（#4797：快照 on/ask/off；触发=用户抱怨快照频繁/占盘）；④分组头未读聚合灯（#2938 思路；触发=多分组下漏看未读）。**不适用/有意分歧（勿重查）**：未知图片能力默认 supported（#4854）与我们「只信库值+手选」拍板相反（default-on 会复发 glm 无视觉 1210 类事故）——有意分歧；无推理配置不生成档位（#4860）我们 EffortSelector 已有 reasoning||thinkingLevelMap 门槛等价覆盖；MessageStream 切换跳动两连删码（#48xx：删 shell-first 首帧+两段式窗口扩容）修的是渐进窗口体系——我们 0.2.20 已整体换 TanStack 真虚拟化，结构免疫（反向验证选型）；计划模式通知错位（#4753）渲染管线不同构；网关会话标识（#4755）无网关；切模缩窗闸门（#4835）无缩窗重建体系；消息跳动（#4584）无远程刷新/历史一次装载；侧栏空项目（#4679）我们分组由会话派生无空组；凭证后端恢复（#3960）BYOK 无 OAuth；更新后二进制校验（#4950）我们 getHost 启动已硬校验弹窗退出；HTTP 分类/重试豁免（#47xx/#4337）传输层与 OAuth 池不同构。**vendor lock b972feb3 窗口内零提交仍有效**；网络守卫竞态、MCP 懒加载上游仍未落地，继续挂 §7。

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
8. 改完产品事实立刻更新本文件。发版收尾三查：§3.5 版本行标「已发」、在途块头同步状态、头部「最后更新」——「未发版」标签已多次漏清（动效批/PDF 批拖了一个多月、0.3.22/0.3.23 收尾各漏一次），收尾后应 grep「未发版」清零。
