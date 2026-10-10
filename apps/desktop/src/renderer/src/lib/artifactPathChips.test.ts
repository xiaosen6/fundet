import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  ARTIFACT_HREF_PREFIX,
  decodeArtifactHref,
  findArtifactPathMatches,
  joinWorkDir,
  remarkArtifactPaths,
  resolveArtifactToken,
} from './artifactPathChips.ts';

const KNOWN = ['D:/公众号/draft-01-公众号.md', 'D:\\proj\\out\\report.pptx'];

function tokens(text: string, known: readonly string[] = KNOWN, workDir?: string): string[] {
  return findArtifactPathMatches(text, known, workDir).map((m) => m.token);
}

describe('findArtifactPathMatches 路线 B（路径形状）', () => {
  it('盘符绝对路径（含中文目录/文件名）', () => {
    const m = findArtifactPathMatches('已生成 D:\\outputs\\draft-01-公众号.md，请查收', [], undefined);
    assert.deepEqual(
      m.map((x) => [x.token, x.fullPath]),
      [['D:\\outputs\\draft-01-公众号.md', 'D:\\outputs\\draft-01-公众号.md']],
    );
  });

  it('POSIX 绝对路径与相对路径（workDir 拼 fullPath）', () => {
    const m = findArtifactPathMatches('改了 /usr/local/app.log 和 src/App.tsx', [], '/home/u');
    assert.deepEqual(m.map((x) => x.token), ['/usr/local/app.log', 'src/App.tsx']);
    assert.equal(m[1]!.fullPath, '/home/u/src/App.tsx');
  });

  it('裸文件名（无分隔符）不点；无扩展名的目录不点', () => {
    assert.deepEqual(tokens('见 readme.md 与 outputs 目录', []), []);
    assert.deepEqual(tokens('见 outputs 目录', KNOWN), []);
  });

  it('URL 形状不点（scheme / 域名首段）', () => {
    assert.deepEqual(tokens('详情见 https://example.com/a.md 与 www.example.com/b.md'), []);
  });

  it('右边界：扩展名后紧跟字母数字不截断', () => {
    assert.deepEqual(tokens('文件是 src/file.typescriptreact'), []);
  });
});

describe('findArtifactPathMatches 路线 A（已知产物 basename）', () => {
  it('basename 出现在正文 → 命中且 fullPath 为已知完整路径', () => {
    const m = findArtifactPathMatches('初稿 draft-01-公众号.md 已完成', KNOWN, undefined);
    assert.deepEqual(m.map((x) => [x.token, x.fullPath]), [
      ['draft-01-公众号.md', 'D:/公众号/draft-01-公众号.md'],
    ]);
  });

  it('紧贴 CJK 也命中（产物名是结构化事实）', () => {
    assert.deepEqual(tokens('文件draft-01-公众号.md已保存', KNOWN), ['draft-01-公众号.md']);
  });

  it('边界：前缀字母数字 / 后续 .xxx 视为更长文件名，不命中', () => {
    assert.deepEqual(tokens('xdraft-01-公众号.md', KNOWN), []);
    assert.deepEqual(tokens('draft-01-公众号.md.bak', KNOWN), []);
    assert.deepEqual(tokens('draft-01-公众号.md5', KNOWN), []);
  });

  it('句末句点与省略号放行', () => {
    assert.deepEqual(tokens('产出 draft-01-公众号.md.', KNOWN), ['draft-01-公众号.md']);
    assert.deepEqual(tokens('产出 draft-01-公众号.md...', KNOWN), ['draft-01-公众号.md']);
  });

  it('与路线 B 重叠时整条路径胜（长者在同起点优先）', () => {
    const m = findArtifactPathMatches('产物在 D:\\proj\\out\\report.pptx 附近', KNOWN, undefined);
    assert.deepEqual(m.map((x) => x.token), ['D:\\proj\\out\\report.pptx']);
    assert.equal(m[0]!.fullPath, 'D:\\proj\\out\\report.pptx');
  });
});

describe('resolveArtifactToken', () => {
  it('已知产物整路径（大小写不敏感）与 basename 命中', () => {
    assert.equal(resolveArtifactToken('d:/公众号/draft-01-公众号.md', KNOWN), KNOWN[0]);
    assert.equal(resolveArtifactToken('report.pptx', KNOWN, undefined), KNOWN[1]);
  });

  it('显式绝对路径是权威：与某产物 basename 同名也指向自己写的位置', () => {
    assert.equal(resolveArtifactToken('D:\\outputs\\draft-01-公众号.md', KNOWN, undefined), 'D:\\outputs\\draft-01-公众号.md');
  });

  it('绝对路径原样；相对路径拼 workDir；其余 null', () => {
    assert.equal(resolveArtifactToken('E:\\tmp\\x.png', [], undefined), 'E:\\tmp\\x.png');
    assert.equal(resolveArtifactToken('out/a.md', [], 'D:\\proj'), 'D:\\proj\\out\\a.md');
    assert.equal(resolveArtifactToken('out/a.md', [], undefined), null);
    assert.equal(resolveArtifactToken('https://a.com/x.md', [], undefined), null);
    assert.equal(resolveArtifactToken('随便一句话', [], undefined), null);
  });
});

describe('joinWorkDir', () => {
  it('跟随 workDir 分隔符风格并归一混合分隔符', () => {
    assert.equal(joinWorkDir('D:\\proj', 'out/a.md'), 'D:\\proj\\out\\a.md');
    assert.equal(joinWorkDir('/home/u', 'out\\a.md'), '/home/u/out/a.md');
  });
});

describe('remarkArtifactPaths 插件', () => {
  interface TestNode {
    type: string;
    value?: string;
    url?: string;
    children?: TestNode[];
  }
  const run = (tree: TestNode): TestNode => {
    remarkArtifactPaths({ knownPaths: KNOWN, workDir: 'D:\\w' })()(tree);
    return tree;
  };

  it('正文 text 切成 [text, link, text]，link 挂编码后的完整路径', () => {
    const tree: TestNode = {
      type: 'paragraph',
      children: [{ type: 'text', value: '初稿 draft-01-公众号.md 已完成' }],
    };
    const out = run(tree);
    assert.equal(out.children!.length, 3);
    const link = out.children![1]!;
    assert.equal(link.type, 'link');
    assert.ok(link.url!.startsWith(ARTIFACT_HREF_PREFIX));
    assert.equal(decodeArtifactHref(link.url!), 'D:/公众号/draft-01-公众号.md');
    assert.equal(link.children![0]!.value, 'draft-01-公众号.md');
    assert.equal(out.children![0]!.value, '初稿 ');
    assert.equal(out.children![2]!.value, ' 已完成');
  });

  it('已在 link 里的 text 不动；inlineCode 无 children 天然不动', () => {
    const inner: TestNode = { type: 'text', value: 'draft-01-公众号.md' };
    const tree: TestNode = {
      type: 'paragraph',
      children: [
        { type: 'link', url: 'https://a.com', children: [inner] },
        { type: 'inlineCode', value: 'draft-01-公众号.md' },
        { type: 'text', value: '无路径纯文本' },
      ],
    };
    const out = run(tree);
    assert.equal(out.children!.length, 3);
    assert.equal(out.children![0]!.children![0], inner);
    assert.equal(out.children![2]!.type, 'text');
  });

  it('decodeArtifactHref 往返（反斜杠与中文）', () => {
    const p = 'D:\\out\\幻灯片-最终版.pptx';
    assert.equal(decodeArtifactHref(ARTIFACT_HREF_PREFIX + encodeURIComponent(p)), p);
  });
});
