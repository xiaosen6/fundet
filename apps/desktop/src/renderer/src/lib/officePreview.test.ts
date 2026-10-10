import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  bytesToArrayBuffer,
  dataUrlToBytes,
  extractPptxParagraphLines,
  extractPptxSlideTexts,
  isPptxSlidePath,
  sanitizeOfficeHtml,
} from './officePreview.ts';

describe('dataUrlToBytes / bytesToArrayBuffer', () => {
  it('解包 base64 data:URL 并还原字节', () => {
    // "Hello, 世界" 的 UTF-8 字节
    const bytes = dataUrlToBytes('data:application/octet-stream;base64,SGVsbG8sIOS4lueVjA==');
    assert.deepEqual(Array.from(bytes), Array.from(new TextEncoder().encode('Hello, 世界')));
  });

  it('拒绝非 data: / 非 base64 输入', () => {
    assert.throws(() => dataUrlToBytes('https://example.com/a.png'));
    assert.throws(() => dataUrlToBytes('data:text/plain,abc'));
  });

  it('bytesToArrayBuffer 产出等长独立拷贝', () => {
    const src = dataUrlToBytes('data:application/octet-stream;base64,AAECAwQ=');
    const ab = bytesToArrayBuffer(src);
    assert.equal(ab.byteLength, 5);
    assert.equal(new Uint8Array(ab)[0], 0);
  });
});

describe('sanitizeOfficeHtml', () => {
  it('剥 script/style 块（含属性与大小写变体）', () => {
    assert.equal(sanitizeOfficeHtml('<p>a</p><SCRIPT>alert(1)</SCRIPT>'), '<p>a</p>');
    assert.equal(sanitizeOfficeHtml('<p>a</p><style type="text/css">p{}</style><p>b</p>'), '<p>a</p><p>b</p>');
    // 未闭合的裸标签也不残留
    assert.equal(sanitizeOfficeHtml('<p>a</p><script src="x">'), '<p>a</p>');
  });

  it('剥 on* 事件属性（双引号/单引号/无引号）', () => {
    assert.equal(sanitizeOfficeHtml('<img src="data:image/png;base64,AA" onerror="alert(1)">'), '<img src="data:image/png;base64,AA">');
    assert.equal(sanitizeOfficeHtml("<p onclick='x'>a</p>"), '<p>a</p>');
    assert.equal(sanitizeOfficeHtml('<p ONCLICK=x(1)>a</p>'), '<p>a</p>');
  });

  it('拦 javascript: 链接，保留 data: 内联图片', () => {
    assert.equal(sanitizeOfficeHtml('<a href="javascript:alert(1)">x</a>'), '<a href="#">x</a>');
    const keep = '<img src="data:image/png;base64,AA==" />';
    assert.equal(sanitizeOfficeHtml(keep), keep);
  });
});

describe('extractPptxSlideTexts', () => {
  const slide = (body: string): string =>
    `<?xml version="1.0"?><p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><p:cSld>${body}</p:cSld></p:sld>`;

  it('合并段落 run、按页号数值排序', () => {
    const map = {
      'ppt/slides/slide10.xml': slide('<a:p><a:r><a:t>第10页</a:t></a:r></a:p>'),
      'ppt/slides/slide2.xml': slide('<a:p><a:r><a:t>分段</a:t></a:r><a:r><a:t>同段拼接</a:t></a:r></a:p>'),
      'ppt/slides/slide1.xml': slide('<a:p><a:r><a:t>标题</a:t></a:r></a:p><a:p><a:r><a:t>第二行</a:t></a:r></a:p>'),
    };
    const out = extractPptxSlideTexts(map);
    assert.deepEqual(
      out.map((s) => s.number),
      [1, 2, 10],
    );
    assert.deepEqual(out[0].lines, ['标题', '第二行']);
    assert.deepEqual(out[1].lines, ['分段同段拼接']);
    assert.deepEqual(out[2].lines, ['第10页']);
  });

  it('<a:br/> 分行、XML 实体解码、空白折叠、空段落丢弃', () => {
    const xml = slide(
      '<a:p><a:r><a:t>行一</a:t></a:r><a:br/><a:r><a:t>行二</a:t></a:r></a:p>' +
        '<a:p><a:r><a:t>  空白   折叠 </a:t></a:r></a:p>' +
        '<a:p><a:r><a:t></a:t></a:r></a:p>' +
        '<a:p><a:r><a:t>&lt;标签&gt; &amp; &quot;引号&quot; &apos;单&apos;</a:t></a:r></a:p>' +
        '<a:p><a:r><a:t>&#x4e16;&#30028;</a:t></a:r></a:p>',
    );
    assert.deepEqual(extractPptxParagraphLines(xml), [
      '行一',
      '行二',
      '空白 折叠',
      '<标签> & "引号" \'单\'',
      '世界',
    ]);
  });

  it('忽略非 slide 条目；空 map / 空幻灯片返回空行列表', () => {
    assert.deepEqual(extractPptxSlideTexts({ 'ppt/theme/theme1.xml': '<a:t>x</a:t>' }), []);
    assert.deepEqual(extractPptxSlideTexts({ 'ppt/slides/slide1.xml': slide('') }), [{ number: 1, lines: [] }]);
    assert.deepEqual(extractPptxSlideTexts({}), []);
    assert.equal(isPptxSlidePath('ppt/slides/slide1.xml'), true);
    assert.equal(isPptxSlidePath('ppt/slideLayouts/slideLayout1.xml'), false);
    assert.equal(isPptxSlidePath('ppt/slides/_rels/slide1.xml.rels'), false);
  });
});
