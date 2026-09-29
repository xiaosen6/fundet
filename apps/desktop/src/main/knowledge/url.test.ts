import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { fetchGuarded } from './url.ts';

// 测试全程用公网字面 IP（93.184.216.x），绕开 DNS；私网侧同样用字面 IP 触发拦截。
const PUB_A = 'http://93.184.216.34/a';
const PUB_B = 'http://93.184.216.35/b';

function redirectResponse(location: string): Response {
  return new Response(null, { status: 302, headers: { location } });
}

describe('fetchGuarded 重定向逐跳 SSRF 复审', () => {
  it('重定向跳内网字面 IP 被拦截', async () => {
    const fetchImpl = async (url: URL): Promise<Response> =>
      url.href === PUB_A ? redirectResponse('http://10.0.0.1/b') : new Response('ok');
    await assert.rejects(fetchGuarded(PUB_A, fetchImpl), /内网|保留/);
  });

  it('重定向跳回环地址被拦截', async () => {
    const fetchImpl = async (): Promise<Response> => redirectResponse('http://127.0.0.1/x');
    await assert.rejects(fetchGuarded(PUB_A, fetchImpl), /内网|保留/);
  });

  it('公网多跳重定向放行并返回最终响应与 URL', async () => {
    const fetchImpl = async (url: URL): Promise<Response> =>
      url.href === PUB_A ? redirectResponse(PUB_B) : new Response('<html><body>hi</body></html>');
    const { res, url } = await fetchGuarded(PUB_A, fetchImpl);
    assert.equal(res.status, 200);
    assert.equal(url.href, PUB_B);
  });

  it('相对 Location 按当前 URL 解析后复审', async () => {
    const fetchImpl = async (url: URL): Promise<Response> =>
      url.pathname === '/a' ? redirectResponse('/c') : new Response('ok');
    const { url } = await fetchGuarded(PUB_A, fetchImpl);
    assert.equal(url.href, 'http://93.184.216.34/c');
  });

  it('超限重定向链报错', async () => {
    let n = 0;
    const fetchImpl = async (): Promise<Response> => {
      n += 1;
      return redirectResponse(`/hop${n}`);
    };
    await assert.rejects(fetchGuarded(PUB_A, fetchImpl), /重定向次数过多/);
  });
});
