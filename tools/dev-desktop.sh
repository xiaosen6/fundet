#!/usr/bin/env bash
# WSL 里 Electron 只能起进程，WSLg 画不出可点的窗口（任务栏蓝点）。
# 这台机器请改用 Windows 本机启动。
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

if [ -n "${WSL_DISTRO_NAME:-}${WSL_INTEROP:-}" ]; then
  cat <<'EOF'
[fundet] 不能用 WSL 弹窗口。

进程能起来，但 Windows 任务栏里那个「Fundet (Ubuntu)」蓝点点不开，
这是 WSL 图形通道 (WSLg) + Electron 的问题，不是应用没启动。

请关掉这个终端里的进程 (Ctrl+C)，打开 Windows PowerShell：

  cd D:\AI\Fundet\fundet
  pnpm dev:win

第一次还要装 Windows 依赖（只需一次）：

  cd D:\AI\Fundet\fundet
  pnpm install
  pnpm --filter fundet-desktop rebuild:native
  node tools\pi\update.mjs --platform=win32-x64
  pnpm dev:win

代码仍可在 WSL / Cursor 里改，只是窗口必须从 Windows 启动。
EOF
  exit 1
fi

exec pnpm --filter fundet-desktop exec electron-vite dev "$@"
