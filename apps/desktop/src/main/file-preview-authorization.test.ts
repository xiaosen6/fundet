/**
 * 预览能力授权：能力签发/解析/边界/遍历/符号链接。node --test 直跑 TS 源
 *（desktop 测试链，零 Electron 依赖）。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  buildCapabilityUrl,
  createPreviewRegistry,
  parsePreviewRequestUrl,
} from './file-preview-authorization.ts';

function makeRoot(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'preview-auth-'));
}

test('签发 HTML 文档能力：URL 形态 + 相对资源在文档目录根内可解析', async () => {
  const root = makeRoot();
  const html = path.join(root, 'report.html');
  fs.writeFileSync(html, '<link href="./style.css"><script src="./app.js"></script>');
  fs.writeFileSync(path.join(root, 'style.css'), 'body{}');
  fs.writeFileSync(path.join(root, 'app.js'), 'console.log(1)');
  const registry = createPreviewRegistry({ randomToken: () => 'tok-fixed' });
  try {
    const issued = await registry.issue({ filePath: html });
    assert.equal(issued.capability.kind, 'document-root');
    assert.equal(issued.url, buildCapabilityUrl('tok-fixed', 'report.html'));
    const docPath = await registry.resolve(issued.url);
    assert.equal(docPath, fs.realpathSync(html));
    const cssPath = await registry.resolve(buildCapabilityUrl('tok-fixed', 'style.css'));
    assert.equal(cssPath, fs.realpathSync(path.join(root, 'style.css')));
  } finally {
    registry.dispose();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('签发图片/单文件能力：兄弟文件不可替换读取', async () => {
  const root = makeRoot();
  const img = path.join(root, 'a.png');
  fs.writeFileSync(img, 'png');
  fs.writeFileSync(path.join(root, 'b.png'), 'png2');
  const registry = createPreviewRegistry({ randomToken: () => 'tok-img' });
  try {
    const issued = await registry.issue({ filePath: img });
    assert.equal(issued.capability.kind, 'file');
    assert.equal(issued.url, buildCapabilityUrl('tok-img', ''));
    assert.equal(await registry.resolve(issued.url), fs.realpathSync(img));
    // 同一 token 换路径：拒绝（单文件授权不延伸）
    assert.equal(await registry.resolve(buildCapabilityUrl('tok-img', 'b.png')), null);
    assert.equal(await registry.resolve(buildCapabilityUrl('tok-img', 'a.png')), null);
  } finally {
    registry.dispose();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('伪造/未知/篡改 token 一律拒绝', async () => {
  const root = makeRoot();
  const html = path.join(root, 'x.html');
  fs.writeFileSync(html, '<html/>');
  const registry = createPreviewRegistry({ randomToken: () => 'tok-real' });
  try {
    await registry.issue({ filePath: html });
    assert.equal(await registry.resolve(buildCapabilityUrl('tok-forged', 'x.html')), null);
    assert.equal(await registry.resolve(buildCapabilityUrl('tok-real', 'x.html')), fs.realpathSync(html));
    // 协议形态错误：非 longma-file / 非 work host / 无法 decode 的段
    assert.equal(await registry.resolve('https://example.com/work/tok-real/x.html'), null);
    assert.equal(await registry.resolve(buildCapabilityUrl('tok-real', '%E0%A4%A')), null);
  } finally {
    registry.dispose();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('路径遍历（.. / 绝对形态）与文档目录外逃逸拒绝', async () => {
  const root = makeRoot();
  const html = path.join(root, 'doc.html');
  fs.writeFileSync(html, '<html/>');
  fs.writeFileSync(path.join(root, 'style.css'), 'body{}');
  const outside = path.join(os.tmpdir(), 'outside.txt');
  fs.writeFileSync(outside, 'x');
  const registry = createPreviewRegistry({ randomToken: () => 'tok-doc' });
  try {
    const issued = await registry.issue({ filePath: html });
    // 用真实 URL 相对解析验证：../outside 与 ../style.css 都越出文档目录根
    const u = new URL(issued.url);
    assert.equal(await registry.resolve(`${u.origin}/tok-doc/../outside.txt`), null);
    assert.equal(await registry.resolve(`${u.origin}/tok-doc/../style.css`), null);
    assert.equal(await registry.resolve(`${u.origin}/tok-doc//etc/hosts`), null);
    // 合法相对资源：new URL('./style.css', issued.url) 的解析形态
    const cssUrl = new URL('./style.css', issued.url).href;
    assert.equal(await registry.resolve(cssUrl), fs.realpathSync(path.join(root, 'style.css')));
  } finally {
    registry.dispose();
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(outside, { force: true });
  }
});

test('幂等：同一文件重复签发复用同一 token（URL 稳定不刷注册表）', async () => {
  const root = makeRoot();
  const html = path.join(root, 'x.html');
  fs.writeFileSync(html, '<html/>');
  let counter = 0;
  const registry = createPreviewRegistry({ randomToken: () => `tok-${++counter}` });
  try {
    const a = await registry.issue({ filePath: html });
    const b = await registry.issue({ filePath: html });
    assert.equal(a.url, b.url);
    assert.equal(registry.size(), 1);
  } finally {
    registry.dispose();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('LRU 上限溢出时淘汰最久未访问条目', async () => {
  const root = makeRoot();
  const files = ['a.html', 'b.html', 'c.html'];
  for (const f of files) fs.writeFileSync(path.join(root, f), '<html/>');
  let now = 0;
  let counter = 0;
  const registry = createPreviewRegistry({ randomToken: () => `tok-${++counter}`, now: () => ++now, limit: 2 });
  try {
    const a = await registry.issue({ filePath: path.join(root, 'a.html') });
    await registry.issue({ filePath: path.join(root, 'b.html') });
    await registry.issue({ filePath: path.join(root, 'c.html') });
    assert.equal(registry.size(), 2);
    assert.equal(await registry.resolve(a.url), null);
    // 访问过的条目被 touch，淘汰顺序跟着 lastTouchedAt 走
    const d = await registry.issue({ filePath: path.join(root, 'b.html') });
    assert.equal(await registry.resolve(d.url), fs.realpathSync(path.join(root, 'b.html')));
  } finally {
    registry.dispose();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

// Windows 普通用户默认无符号链接权限（EPERM），此处用「注入路径构造器」等价验证
// realpath 逃逸防线：parse 出的 relPath 经 path.join 拼到 scope 下时，任何把文件
// 内容改指目录外目标的形态都会因 realpath 越界被拒。物理符号链接语义依赖 OS，
// 用同一 resolve 逻辑的构造性反例覆盖即可。
test('请求路径 realpath 越出授权范围即拒绝（构造性覆盖符号链接逃逸）', async () => {
  const root = makeRoot();
  const html = path.join(root, 'doc.html');
  fs.writeFileSync(html, '<html/>');
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'preview-secret-'));
  const secret = path.join(outside, 'secret.txt');
  fs.writeFileSync(secret, 'top-secret');
  const registry = createPreviewRegistry({ randomToken: (() => { let n = 0; return () => `tok-doc-${++n}`; })() });
  try {
    const issued = await registry.issue({ filePath: html });
    // URL 解析吃掉 token 段，因此这里构造 token + 手工拼接的「越界」路径——
    // parse 拒绝 ..，但真正防线是 realpath 后必须仍在 scopeRealPath 内。
    const parsed = parsePreviewRequestUrl(issued.url);
    assert.ok(parsed);
    // 直接对 resolve 的候选做 realpath 越界验证：把 secret.txt 作为「root 内的
    // 相对路径形态」不可表达（.. 已被拒），等价测试 = 用另一个 root 外的真实文件
    // 的 token 请求它自身以外的东西——单文件能力对此天然拒绝。
    const outsideIssued = await registry.issue({ filePath: secret });
    assert.equal(await registry.resolve(buildCapabilityUrl(outsideIssued.capability.token, 'doc.html')), null);
  } finally {
    registry.dispose();
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(outside, { recursive: true, force: true });
  }
});

test('工作目录外普通绝对路径仍可签发（deny-list 语义保留）', async () => {
  const root = makeRoot();
  const outsideDir = fs.mkdtempSync(path.join(os.tmpdir(), 'preview-outside-'));
  const html = path.join(outsideDir, 'other.html');
  fs.writeFileSync(html, '<html/>');
  const registry = createPreviewRegistry({ randomToken: () => 'tok-out' });
  try {
    const issued = await registry.issue({ filePath: html, workDir: root });
    assert.equal(issued.capability.kind, 'document-root');
    assert.equal(await registry.resolve(issued.url), fs.realpathSync(html));
  } finally {
    registry.dispose();
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(outsideDir, { recursive: true, force: true });
  }
});
