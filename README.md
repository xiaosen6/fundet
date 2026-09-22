# Fundet

**Fundet** 是山东未来互联科技的本地优先桌面 AI 智能体：会话、技能、模型设置都在本机；模型用你自己的 Key（BYOK），不经过任何厂商云。

![Fundet](apps/desktop/resources/fundet/icon.png)

界面和会话交互参考了 [Cindy](https://github.com/makecindy/cindy)（Apache-2.0）。Agent 内核裁自 Cindy 的 Pi 接入层，宿主、数据库、设置页为本项目自研；浏览器自动化内核来自 openclaw（MIT），电脑操作引擎为 [trycua/cua](https://github.com/trycua/cua)（MIT）。许可与归属见 [NOTICE](./NOTICE)。

---

## 它做什么

| 模块 | 说明 |
| --- | --- |
| 会话 | 多会话、流式输出、思考/工具卡片、中断、权限三档（每次询问 / 自动审批 / 完全放行） |
| 工作目录 | 输入框旁文件夹 chip，最近目录 +「选择其他文件夹」，先选目录再开聊 |
| 模型 | 30+ 厂商预设（智谱/Kimi/DeepSeek/火山/阿里百炼/Anthropic/OpenAI…）或自定义 Base URL + Key；列模型一键发现；对话里按厂商分组切换 |
| 视觉 | 支持视觉的模型可直接看图（预设标注或手动勾选「视觉」）；粘贴图片自动嗅探真实格式 |
| 附件 | 拖/贴文件与图片；PDF/Word 自动提取正文发给模型 |
| Canvas | 右侧产物画布：图片/视频/音频/HTML/PDF/Markdown 预览，HTML 可切源码 |
| 技能 | 导入 `SKILL.md` 或 zip（本产品不预装技能）。聊天输入 `/` 点选，消息以 `/skill:名字` 开头 |
| 搜索 | 设置里填 Tavily / Brave / 博查 / 智谱 Web Search 的 Key，新对话即可「搜一下…」 |
| 自动操作·浏览器 | 内置托管浏览器（默认关）：读网页正文、点击、填表；可一键拷贝你系统浏览器的登录网站状态，免重复登录 |
| 自动操作·电脑 | 截屏、点击、输入、窗口管理（默认关；需电脑操作权限） |
| 用量 | 首页仪表盘 + 设置用量历史：token 四列拆分、20 周热力图、30 天趋势、按模型统计 |
| IM 机器人 | 个人微信（扫码）/ 企微 / 飞书 / 钉钉接入同一智能体，电脑开着就能在聊天软件里派活 |

数据在本机 SQLite。Windows 用户数据目录：`%APPDATA%\Fundet\`。

---

## 环境

- Node.js ≥ 22.12
- CPU 需支持 **AVX2 指令集**（2013 年后的 Intel / 2015 年后的 AMD 均满足；老 CPU 或部分虚拟机上助手运行时无法启动，启动时会明确提示）
- pnpm 9.x（仓库 `packageManager` 为 9.14.4）
- **Windows 上请用 PowerShell 启动**，不要用 WSL 弹窗口（WSLg + Electron 经常只剩任务栏蓝点）

Pi 运行时不进 Git，需要单独准备（见下）。

---

## 启动（Windows，推荐）

在 **Windows PowerShell**（不要用 Ubuntu 终端）：

```powershell
cd D:\AI\Fundet
pnpm install
node tools\pi\update.mjs 0.83.0 --platform=win32-x64
# 若 GitHub 超时：可走镜像 https://gh-proxy.com/ + 上面的完整 GitHub 下载地址
# 解到 apps\pi-bin\win32-x64\（目录里要有 pi.exe 和 theme\）

pnpm dev:win
```

没有 Visual Studio C++ 工具集时，`better-sqlite3` 会走自带的 Windows 预编译文件，一般不必本地编译。

第一次打开后：

1. **设置 → 模型供应商**：从预设选厂商或自定义（名称、API 形态、Base URL、Key），再 **+ 添加模型**（可「发现模型」自动拉取）。
2. 回到首页，点文件夹 chip 选工作目录（默认为用户主目录）。
3. 点「新建会话」开始聊。

智谱示例：API 选 `openai-completions`，Base URL `https://open.bigmodel.cn/api/paas/v4`，模型填官方 id。

---

## 日常使用

### 工作目录

**先选文件夹再开聊**。空白首页和输入框左侧都是文件夹 chip。Agent 只在这个目录里读写文件；拖入的外部文件会复制进该目录的 `.fundet-uploads/`。

### 技能

本产品**不预装技能**。在 **设置 → 技能** 导入 `SKILL.md` 或 zip，聊天输入 `/` 点选，消息以 `/skill:名字` 开头。

### 联网搜索

**设置 → 搜索** 填 Tavily / Brave / 博查 / 智谱 Web Search 的 API key（和聊天模型不是同一套配置）。填好后**新开对话**，对助手说「搜一下…」即可。

### 自动操作（浏览器 / 电脑）

**设置 → 自动操作** 两个开关，默认关闭。开启后**新会话**里助手获得对应工具；审批跟随会话权限档（想免打扰把会话切「自动」或「完全放行」）。

- 浏览器：专用托管浏览器，登录网站请在「打开托管浏览器」里进行，登录态跨会话保留。「使用我的浏览器登录态」会拷贝系统浏览器已登录状态——**拷贝前需完全退出系统浏览器**（包括托盘后台进程，否则其 Cookie 数据库被锁定，会提示重试）。
- 电脑操作：需要多模态（视觉）模型效果最佳；首次使用 Windows 可能弹系统隐私确认。

### IM 机器人

**设置 → IM 机器人**：个人微信扫码 / 企微 / 飞书 / 钉钉，凭证只存本机。私聊或群里 @ 它派活，**电脑要开着 Fundet**，结果回到消息串。

---

## 打包

在 **Windows PowerShell** 打 Windows 安装包（NSIS exe）：

```powershell
cd D:\AI\Fundet
pnpm dist:win
```

产物：`apps/desktop/dist/Fundet-Setup-<version>-x64.exe`（约 170MB）。

macOS（未签名，CI 或 mac 机器出包）：`Fundet-<version>-arm64.dmg` / `Fundet-<version>-x64.dmg`。**未签名应用在较新 macOS 上会报「文件已损坏」**（Gatekeeper 拦截，不是真损坏），终端执行一次即可：

```bash
sudo xattr -cr /Applications/Fundet.app
```

---

## 仓库结构

```
Fundet/
├── packages/
│   ├── agent-core/        # Pi 接入、会话（源自 Cindy maker-core，Apache-2.0）
│   ├── browser-runtime/   # 浏览器内核（vendored 自 openclaw，MIT）
│   ├── browser-mcp/       # 浏览器 MCP 门面
│   └── shared/            # 纯函数/类型
├── apps/
│   ├── desktop/           # Electron 主工程
│   │   ├── src/main/      # 宿主、IPC、技能、SQLite、内置 MCP
│   │   ├── src/preload/
│   │   └── src/renderer/  # React 19 + Tailwind 4
│   ├── pi-bin/            # Pi 运行时（gitignore，需下载）
│   └── cua-driver-bin/    # 电脑操作驱动（gitignore，需下载）
├── cindy/                 # 参考项目只读快照
└── tools/                 # 二进制下载脚本、依赖打平脚本
```

数据流：

```
界面 → window.fundet（preload）→ IPC
  → 主进程装配 PiAgent
  → 子进程 pi --mode rpc
  → 事件回流落库并推到界面
```

---

## 安全

- API Key 只经系统凭据库（Electron safeStorage）落盘，不进 SQLite、不进日志。
- 权限审批读不到配置时按「每次询问」，不会静默放行。
- 浏览器自动化内置 SSRF 防护（内网/云元数据地址全拦截）。
- 电脑操作驱动默认关闭遥测。

---

## 开发验证

```powershell
pnpm typecheck
pnpm test        # 183 项（node --test，desktop 侧在 apps/desktop/package.json 逐文件枚举）
pnpm --filter @fundet/agent-core test
```

---

## 发版流程（0.2.19 起 GitHub 单线）

1. 确认改动已提交、`pnpm test` 全绿；`apps/desktop/package.json` 升版本号
2. `pnpm build && pnpm dist:win`（apps/desktop 下）——**EBUSY 失败是 Defender 锁新签名 exe 的高频项，重跑即过**（脚本带 3 次重试更稳）
3. `memory.md` 写版本行（内容、根因、验证方式）+ 在途事项清零
4. `git tag -a v<版本> && git push github main && git push github v<版本>`（远端名是 **github**；origin 是已弃用的 GitLab）
5. `gh release create v<版本> dist/Fundet-Setup-*.exe dist/*.blockmap dist/latest.yml --title ... --notes ...`
6. `gh api repos/xiaosen6/fundet/releases/tags/v<版本>` 复核非 draft、三资产齐；安装包备份到 `D:\`

工作节奏（用户约定）：**修复→本地提交→用户实测→用户说「发」才发版**。

---

## 接手必读（AI / 新人）

- **`memory.md` 是项目记忆**：版本史、在途事项、技术事实（skillhub API 真参数、Cindy asar 抽取法、dws 命令族）、踩坑记录（E2E 探针必须写文件脚本忌内联转义、冒烟种子必须 db-only 忌整库拷贝、fixture 抓包必须脱敏凭证——GitHub Push Protection 会拦）。接手先通读。
- **代码纪律**：主进程模块间 import 用 `.ts` 扩展（node --test 直跑 TS 源）；测试注入式依赖（看 `setSkillhubDeps` / `setAutomationDeps` 范式）；表结构变更走 client.ts 幂等 raw SQL（drizzle-kit 迁移留大版本）。
- **设计基准**：UI 对齐 Cindy（本机 `D:\AI\Cindy` 可抽 asar 对照；主题原值已抄进 globals.css）；产品名 Fundet（技术标识 appId/userData/GitHub 仓不可动——动了断存量数据与更新通道）。
- **E2E**：CDP 驱动，工具脚本库在 `C:\temp\fundet-dev-tools\`（launch-dev/sh-pack-launch 等）；引用圈 DOM 是 `button[title^=查看来源]` 不是 `.kb-cite`（渲染层被替换过）。
- **dws 安装镜像**（0.3.7）：Gitee `sun-jisen/dws-mirror`（自建公开仓，v1.0.62 全资产），Fundet 安装 dws 全链走它（官方 Gitee 渠道仍回落 GitHub 下载——国内用户卡死根因）；每周一 09:30 本机定时同步（`C:\temp\dws-mirror-tools\sync-mirror.mjs`，token 在同目录 token.env 不进 git，幂等按 tag 跳过）；镜像仓分支是 **master**（raw URL 用 `/raw/master/`）。

---

## 许可

Apache-2.0。含 Cindy 衍生代码与其它开源组件，见 [NOTICE](./NOTICE)。
