import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { documentExtractSupport, extractDocumentText } from './doc-text.ts';

let tmp = '';

before(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fundet-doc-'));
});

after(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

/** 最小合法 PDF：无压缩文字流，内容为 "Hello Fundet PDF-2026" */
const PDF_FIXTURE = `%PDF-1.4
1 0 obj
<< /Type /Catalog /Pages 2 0 R >>
endobj
2 0 obj
<< /Type /Pages /Kids [3 0 R] /Count 1 >>
endobj
3 0 obj
<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>
endobj
4 0 obj
<< /Length 58 >>
stream
BT /F1 24 Tf 100 700 Td (Hello Fundet PDF-2026) Tj ET
endstream
endobj
5 0 obj
<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>
endobj
trailer
<< /Root 1 0 R >>
`;

/** 最小 docx（base64）：正文 "Fundet docx 提取测试：红球精神" */
const DOCX_FIXTURE_B64 =
  'UEsDBAoAAAAAACVoGl0XmADXsgEAALIBAAATAAAAW0NvbnRlbnRfVHlwZXNdLnhtbDw/eG1sIHZlcnNpb249IjEuMCIgZW5jb2Rpbmc9IlVURi04IiBzdGFuZGFsb25lPSJ5ZXMiPz4KPFR5cGVzIHhtbG5zPSJodHRwOi8vc2NoZW1hcy5vcGVueG1sZm9ybWF0cy5vcmcvcGFja2FnZS8yMDA2L2NvbnRlbnQtdHlwZXMiPgo8RGVmYXVsdCBFeHRlbnNpb249InJlbHMiIENvbnRlbnRUeXBlPSJhcHBsaWNhdGlvbi92bmQub3BlbnhtbGZvcm1hdHMtcGFja2FnZS5yZWxhdGlvbnNoaXBzK3htbCIvPgo8RGVmYXVsdCBFeHRlbnNpb249InhtbCIgQ29udGVudFR5cGU9ImFwcGxpY2F0aW9uL3htbCIvPgo8T3ZlcnJpZGUgUGFydE5hbWU9Ii93b3JkL2RvY3VtZW50LnhtbCIgQ29udGVudFR5cGU9ImFwcGxpY2F0aW9uL3ZuZC5vcGVueG1sZm9ybWF0cy1vZmZpY2Vkb2N1bWVudC53b3JkcHJvY2Vzc2luZ21sLmRvY3VtZW50Lm1haW4reG1sIi8+CjwvVHlwZXM+UEsDBAoAAAAAACVoGl0/rf76LAEAACwBAAALAAAAX3JlbHMvLnJlbHM8P3htbCB2ZXJzaW9uPSIxLjAiIGVuY29kaW5nPSJVVEYtOCIgc3RhbmRhbG9uZT0ieWVzIj8+CjxSZWxhdGlvbnNoaXBzIHhtbG5zPSJodHRwOi8vc2NoZW1hcy5vcGVueG1sZm9ybWF0cy5vcmcvcGFja2FnZS8yMDA2L3JlbGF0aW9uc2hpcHMiPgo8UmVsYXRpb25zaGlwIElkPSJySWQxIiBUeXBlPSJodHRwOi8vc2NoZW1hcy5vcGVueG1sZm9ybWF0cy5vcmcvb2ZmaWNlRG9jdW1lbnQvMjAwNi9yZWxhdGlvbnNoaXBzL29mZmljZURvY3VtZW50IiBUYXJnZXQ9IndvcmQvZG9jdW1lbnQueG1sIi8+CjwvUmVsYXRpb25zaGlwcz5QSwMECgAAAAAAFQ0hXftryjLzAAAA8wAAABEAAAB3b3JkL2RvY3VtZW50LnhtbDw/eG1sIHZlcnNpb249IjEuMCIgZW5jb2Rpbmc9IlVURi04IiBzdGFuZGFsb25lPSJ5ZXMiPz4KPHc6ZG9jdW1lbnQgeG1sbnM6dz0iaHR0cDovL3NjaGVtYXMub3BlbnhtbGZvcm1hdHMub3JnL3dvcmRwcm9jZXNzaW5nbWwvMjAwNi9tYWluIj4KPHc6Ym9keT48dzpwPjx3OnI+PHc6dD5GdW5kZXQgZG9jeCDmj5Dlj5bmtYvor5XvvJrnuqLnkIPnsr7npZ48L3c6dD48L3c6cj48L3c6cD48L3c6Ym9keT4KPC93OmRvY3VtZW50PlBLAwQKAAAAAAAVDSFdAAAAAAAAAAAAAAAABQAAAHdvcmQvUEsBAhQACgAAAAAAJWgaXReYANeyAQAAsgEAABMAAAAAAAAAAAAAAAAAAAAAAFtDb250ZW50X1R5cGVzXS54bWxQSwECFAAKAAAAAAAlaBpdP63++iwBAAAsAQAACwAAAAAAAAAAAAAAAADjAQAAX3JlbHMvLnJlbHNQSwECFAAKAAAAAAAVDSFd+2vKMvMAAADzAAAAEQAAAAAAAAAAAAAAAAA4AwAAd29yZC9kb2N1bWVudC54bWxQSwECFAAKAAAAAAAVDSFdAAAAAAAAAAAAAAAABQAAAAAAAAAAABAAAABaBAAAd29yZC9QSwUGAAAAAAQABADsAAAAfQQAAAAA';

describe('documentExtractSupport', () => {
  it('routes by extension', () => {
    assert.equal(documentExtractSupport('a/b.pdf'), 'pdf');
    assert.equal(documentExtractSupport('a/b.DOCX'), 'docx');
    assert.equal(documentExtractSupport('a/b.doc'), 'doc-legacy');
    assert.equal(documentExtractSupport('a/b.txt'), null);
    assert.equal(documentExtractSupport('noext'), null);
  });
});

describe('extractDocumentText', () => {
  it('extracts text from a PDF', async () => {
    const p = path.join(tmp, 'sample.pdf');
    fs.writeFileSync(p, PDF_FIXTURE);
    const out = await extractDocumentText(p);
    assert.match(out, /正文提取/);
    assert.match(out, /Hello Fundet PDF-2026/);
  });

  it('extracts text from a docx', async () => {
    const p = path.join(tmp, 'sample.docx');
    fs.writeFileSync(p, Buffer.from(DOCX_FIXTURE_B64, 'base64'));
    const out = await extractDocumentText(p);
    assert.match(out, /红球精神/);
  });

  it('legacy .doc gets a resave hint', async () => {
    const p = path.join(tmp, 'old.doc');
    fs.writeFileSync(p, 'junk');
    assert.match(await extractDocumentText(p), /另存为 \.docx/);
  });

  it('unsupported types return empty string', async () => {
    const p = path.join(tmp, 'note.txt');
    fs.writeFileSync(p, 'plain text');
    assert.equal(await extractDocumentText(p), '');
  });

  it('missing/corrupt file degrades to a failure note instead of throwing', async () => {
    const missing = path.join(tmp, 'gone.pdf');
    assert.match(await extractDocumentText(missing), /提取失败/);
    const bad = path.join(tmp, 'bad.pdf');
    fs.writeFileSync(bad, 'not a pdf at all');
    assert.match(await extractDocumentText(bad), /提取失败/);
  });
});

// PDF 文本层图片占位符清洗（p14_img0.png 类，Word 导出 PDF 常见）
describe('sanitizePdfText', () => {
  it('剥图片占位符并压空行', async () => {
    const { sanitizePdfText } = await import('./doc-text.ts');
    const out = sanitizePdfText('标题\np14_img0.png\n正文一段。\n\n\np15_img1.PNG\n结尾');
    assert.equal(out, '标题\n正文一段。\n\n结尾');
  });
});
