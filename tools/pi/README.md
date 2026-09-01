# Pi 二进制管理

Fundet 的 agent harness 是 [Pi](https://github.com/earendil-works/pi)，运行时需要它的完整
产物目录（`pi` 可执行文件 + `theme/` + `node_modules/` 等运行时资产，缺一不可——实测缺
`theme/` 时 RPC 模式启动即崩）。

目标位置：`apps/pi-bin/<platform>-<arch>/`（如 `apps/pi-bin/linux-x64/pi`）。
`apps/desktop` 的 host 在 dev 态从这里取，打包时整目录经 extraResources 拷进安装包。

## 自动下载（首选）

```bash
pnpm install:pi          # = node tools/pi/update.mjs，拉 latest release
node tools/pi/update.mjs 0.83.0          # 指定版本
node tools/pi/update.mjs --platform=linux-x64   # 只下一个平台
```

脚本会从 `api.github.com` 读 release 元数据、按 digest 校验 sha256（fail-closed）、
解包并 promote 到 `apps/pi-bin/`。

## 手动下载（api.github.com 被墙 / 403 时）

某些网络环境下 `api.github.com` 返回 403，脚本在第一步就会挂。此时可以不动脚本，
手动完成等价步骤——下载链接和 sha256 都 pin 在 `tools/pi/latest.json` 的
`runtimeAssets.<platform>` 里：

```bash
cd /path/to/fundet

# 1. 看 pin 的版本与下载信息
cat tools/pi/latest.json
#    → runtimeAssets.linux-x64.url / .sha256 / .size

# 2. 下载归档（URL 以 latest.json 为准，下面是 v0.83.0 linux-x64 示例）
curl -L -o /tmp/pi-linux-x64.tar.gz \
  https://github.com/earendil-works/pi/releases/download/v0.83.0/pi-linux-x64.tar.gz

# 3. 校验 sha256（必须与 latest.json 里的完全一致，不符就不要用）
echo "b0625eb623197b0afe20c870d21ef2f34481f1504e5777df3f698a66c7636f5f  /tmp/pi-linux-x64.tar.gz" | sha256sum -c -

# 4. 解包（Unix 归档内是一个 pi/ 目录）
rm -rf /tmp/pi-extract && mkdir -p /tmp/pi-extract
tar -xzf /tmp/pi-linux-x64.tar.gz -C /tmp/pi-extract

# 5. flatten：把内层 pi/ 目录的内容上移到 apps/pi-bin/linux-x64/ 本级
#    （注意内层目录名 pi/ 与主二进制 pi 同名，先 mv 成临时名再逐个上移，直接 cp 会撞名）
rm -rf apps/pi-bin/linux-x64 && mkdir -p apps/pi-bin/linux-x64
mv /tmp/pi-extract/pi /tmp/pi-extract/.pi-tmp
mv /tmp/pi-extract/.pi-tmp/* /tmp/pi-extract/.pi-tmp/.[!.]* apps/pi-bin/linux-x64/ 2>/dev/null || true

# 6. 赋可执行权限并验证
chmod +x apps/pi-bin/linux-x64/pi
apps/pi-bin/linux-x64/pi --version
```

Windows 产物是 `.zip` 且新版（v0.83+）已把完整 dist 平铺在归档根，解出后直接整体拷到
`apps/pi-bin/win32-x64/` 即可，无需 flatten。

完成后目录里至少要有：`pi`（可执行）、`theme/`、`node_modules/`、`package.json`。
验证通过后 `pnpm dev` 即可正常起会话。
