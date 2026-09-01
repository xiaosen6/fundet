#!/usr/bin/env node
/**
 * 跨平台品牌环境包装器：with-brand.mjs <brand> <command...>
 * 设置 BRAND=<brand> 后执行命令（electron-vite 据此注入 __BRAND__）。
 */
import { spawnSync } from 'node:child_process';

const brand = process.argv[2];
if (brand !== 'fundet') {
  console.error(`with-brand: brand must be fundet, got "${brand}"`);
  process.exit(1);
}
const cmd = process.argv.slice(3);
if (cmd.length === 0) {
  console.error('with-brand: missing command');
  process.exit(1);
}

const result = spawnSync(cmd[0], cmd.slice(1), {
  stdio: 'inherit',
  env: { ...process.env, BRAND: brand },
  shell: process.platform === 'win32',
});
process.exit(result.status ?? 1);
