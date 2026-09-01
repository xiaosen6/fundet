import { defineConfig, externalizeDepsPlugin } from 'electron-vite';

// 品牌：默认 fundet。brand.ts 保留的 longma 分支仅供上游底座同步参考，本仓一切构建/发版都是 Fundet
const BRAND = (process.env.BRAND ?? 'fundet') as 'longma' | 'fundet';
const brandDefine = { __BRAND__: JSON.stringify(BRAND) };
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { resolve } from 'node:path';

export default defineConfig({
  main: {
    define: brandDefine,
    // workspace 包是裸 TS 源码（exports 指向 src/*.ts），打包进产物；
    // 例外：@fundet/browser-runtime 是编译到 dist 的 external 运行时依赖 ——
    // vendored 源码绝不能过 vite/rollup（chunk 渲染会在拼接边界丢代码：
    // esbuild "Unterminated string literal"，且动态 import 拆 chunk 会反向
    // import 入口 chunk 导致主进程僵死）。browser-mcp 门面小、无内部动态
    // import，继续 bundle 没问题。
    plugins: [
      externalizeDepsPlugin({
        exclude: ['@fundet/agent-core', '@fundet/shared', '@fundet/browser-mcp'],
      }),
    ],
    build: {
      outDir: 'out/main',
      target: 'node22',
      rollupOptions: {
        input: { index: resolve(__dirname, 'src/main/index.ts') },
        // browser-runtime 是编译到 dist 的 external 运行时依赖（打包时由
        // tools/pack-browser-deps.mjs 打平进 resources/node_modules），
        // 运行时从 resources/node_modules 解析；vite 只留裸引用不打包。
        // MCP SDK 同理 external——bundle 它会拖进 express 全家（sdk 的 auth
        // 模块静态 import express），flat 目录里已含其完整闭包。
        external: [/^@fundet\/browser-runtime/, /^@modelcontextprotocol\/sdk/],
      },
    },
  },
  preload: {
    define: brandDefine,
    plugins: [externalizeDepsPlugin()],
    build: {
      outDir: 'out/preload',
      rollupOptions: {
        input: { index: resolve(__dirname, 'src/preload/index.ts') },
        // sandbox:true 下渲染进程只能加载 CJS preload（ESM preload 沙箱不支持，
        // window.fundet 会注入失败）。package.json 是 type:module，须显式压回 CJS。
        output: {
          format: 'cjs',
          entryFileNames: '[name].js',
          chunkFileNames: '[name].js',
        },
      },
    },
  },
  renderer: {
    define: brandDefine,
    root: resolve(__dirname, 'src/renderer'),
    plugins: [react(), tailwindcss()],
    build: {
      outDir: 'out/renderer',
      rollupOptions: {
        input: { index: resolve(__dirname, 'src/renderer/index.html') },
      },
    },
  },
});
