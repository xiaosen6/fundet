# AGENTS.md — AI 接手入口

Fundet：本地优先的桌面 AI 智能体（Electron 37 + React 19 + Pi 底座）。
Windows 开发机；仓库 `D:\Go\fundet-buddy`；远端 `github` = `xiaosen6/fundet`（`origin` 是已弃用的 GitLab）。

## 开工前必读（按序，不要跳过）

1. **`memory.md`** —— 项目记忆：版本史、技术事实（每个大功能都有「实现定稿 + 时序红线」）、踩坑记录。通读后再动手；改动涉及哪个模块，就对照哪一节。
2. **`README.md`** 的「接手必读」和「发版流程」两节。

## 铁律（不可违反）

1. `appId com.fundet.app` / userData `%APPDATA%\Fundet` / GitHub 仓名 `xiaosen6/fundet` **不可动**——动了断存量用户数据与更新通道。
2. 工作节奏：**修复 → 本地提交 → 用户实测 → 用户说「发」才发版**。绝不擅自发版。
3. E2E / 冒烟：探针写独立文件脚本（忌命令行内联转义）；冒烟种子只拷 db 文件；fixture 抓包先脱敏凭证（GitHub Push Protection 会拦）；**打包版冒烟必须把 win-unpacked 复制到仓库树外**（如 `C:\temp\iso-run`）运行，否则 ESM 向上解析命中开发机 node_modules 造成假阴性。

## 常用命令

```powershell
pnpm typecheck            # apps/desktop 下
pnpm test                 # 411 项（node --test）
pnpm dev                  # 开发
pnpm build && pnpm dist:win   # 打包（约 3 分钟；EBUSY 重跑即过）
node ../../tools/check-ipc-channels.cjs   # IPC 通道审计，发版前必跑（在 apps/desktop 下执行）
```

## 高频坑（详见 memory.md 对应章节）

- **IPC handler 注册没有测试覆盖**：删/重构主进程代码前先跑审计脚本（0.3.17 曾整段误删 20 个 handler 且全绿发布）。
- `electron-builder.yml` 是 YAML：注释只用 `#`，不认 `//`。
- 桌宠动画/拖拽的时序红线（dragMoved 与 dragRunning 是两个变量、帧推进用 setInterval 不用 RAF 等）见 memory.md §4.11。
- 主进程模块间 import 用 `.ts` 扩展（node --test 直跑 TS 源）。

## 发版

完整流程见 `README.md`「发版流程」节（版本 bump → 审计脚本 + 全量测试 → dist:win → 树外隔离冒烟 → tag/push → draft release + 脱离任务系统上传大资产 → 双通道验证 → 安装包备份到 `D:\`）。
