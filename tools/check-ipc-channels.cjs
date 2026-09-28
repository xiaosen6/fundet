// 全量核对：channels.ts 定义的 invoke 通道 vs register.ts 已注册 handler
const fs = require('fs');
const path = require('path');
const ch = fs.readFileSync('src/main/ipc/channels.ts', 'utf-8');
const pre = fs.readFileSync('src/preload/index.ts', 'utf-8');
const defs = [...ch.matchAll(/^\s{2}([A-Z_0-9]+):/gm)].map((m) => m[1]);
// 扫描 main 全目录（register + 各 host 模块）
function walk(dir, acc = []) {
  for (const f of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, f.name);
    if (f.isDirectory()) { if (f.name !== 'node_modules') walk(p, acc); }
    else if (f.name.endsWith('.ts') && !f.name.endsWith('.test.ts')) acc.push(p);
  }
  return acc;
}
const files = walk('src/main');
const allCode = files.map((f) => fs.readFileSync(f, 'utf-8')).join('\n');
const pushDefs = [...ch.matchAll(/^\s{2}([A-Z_0-9]+):/gm)].map((m) => m[1]);
// FUNDET_INVOKE 段才需要 handle；粗略：取 channels.ts 中 FUNDET_INVOKE 对象范围内
const invokeSection = ch.slice(ch.indexOf('FUNDET_INVOKE'), ch.indexOf('FUNDET_PUSH'));
const invokeDefs = [...invokeSection.matchAll(/^\s{2}([A-Z_0-9]+):/gm)].map((m) => m[1]);
const missing = invokeDefs.filter((d) => {
  const re = new RegExp(`FUNDET_INVOKE\\.${d}\\b`);
  return !files.some((f) => re.test(fs.readFileSync(f, 'utf-8')));
});
console.log('INVOKE 通道:', invokeDefs.length, ' 未注册:', missing.length);
for (const m of missing) {
  const mm = ch.match(new RegExp('^\\s{2}' + m + ':.*$', 'm'));
  const usedInPreload = new RegExp(`FUNDET_INVOKE\\.${m}\\b`).test(pre);
  console.log(' -', m, mm ? mm[0].trim() : '', '| preload:', usedInPreload ? '是' : '否');
}
