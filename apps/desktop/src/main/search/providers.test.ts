import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  hitFromUnknown,
  parseBraveBody,
  parseBochaBody,
  parseTavilyBody,
  parseZhipuBody,
  searchWithEngine,
} from './providers.ts';

describe('hitFromUnknown', () => {
  it('accepts url/link and snippet aliases', () => {
    assert.deepEqual(hitFromUnknown({ title: 'A', link: 'https://a.test', content: 'hi' }), {
      title: 'A',
      url: 'https://a.test',
      snippet: 'hi',
    });
    assert.equal(hitFromUnknown({ title: 'x', url: 'ftp://no' }), null);
  });
});

describe('parsers', () => {
  it('parses Tavily / Brave / Bocha / Zhipu shapes', () => {
    assert.equal(
      parseTavilyBody({ results: [{ title: 't', url: 'https://t.test', content: 'c' }] }, 5)[0]?.title,
      't',
    );
    assert.equal(
      parseBraveBody({ web: { results: [{ title: 'b', url: 'https://b.test', description: 'd' }] } }, 5)[0]
        ?.snippet,
      'd',
    );
    assert.equal(
      parseBochaBody(
        { data: { webPages: { value: [{ name: '博', url: 'https://bo.test', snippet: 's' }] } } },
        5,
      )[0]?.title,
      '博',
    );
    assert.equal(
      parseZhipuBody({ search_result: [{ title: 'z', link: 'https://z.test', content: '正文' }] }, 5)[0]
        ?.url,
      'https://z.test',
    );
  });
});

describe('searchWithEngine', () => {
  it('returns a config error without calling the network when key is empty', async () => {
    let called = 0;
    const out = await searchWithEngine('tavily', '  ', 'q', 3, async () => {
      called += 1;
      return { status: 200, text: '{}' };
    });
    assert.equal(out.ok, false);
    assert.equal(called, 0);
  });

  it('maps 401 to a Chinese auth error', async () => {
    const out = await searchWithEngine('brave', 'k', 'news', 3, async () => ({
      status: 401,
      text: 'nope',
    }));
    assert.equal(out.ok, false);
    if (!out.ok) assert.match(out.error, /鉴权/);
  });

  it('posts Tavily and returns hits', async () => {
    const out = await searchWithEngine('tavily', 'tvly-x', 'foo', 2, async (url, init) => {
      assert.equal(url, 'https://api.tavily.com/search');
      assert.equal(init.method, 'POST');
      assert.ok(String(init.headers?.Authorization).includes('tvly-x'));
      return {
        status: 200,
        text: JSON.stringify({ results: [{ title: 'One', url: 'https://one.test', content: 'ok' }] }),
      };
    });
    assert.equal(out.ok, true);
    if (out.ok) {
      assert.equal(out.engine, 'tavily');
      assert.equal(out.results[0]?.url, 'https://one.test');
    }
  });

  it('GETs Brave with subscription token', async () => {
    const out = await searchWithEngine('brave', 'BSA-x', 'news', 4, async (url, init) => {
      assert.equal(init.method, 'GET');
      assert.match(url, /api\.search\.brave\.com/);
      assert.match(url, /count=4/);
      assert.equal(init.headers?.['X-Subscription-Token'], 'BSA-x');
      return {
        status: 200,
        text: JSON.stringify({
          web: { results: [{ title: 'B', url: 'https://b.test', description: 'n' }] },
        }),
      };
    });
    assert.equal(out.ok, true);
    if (out.ok) assert.equal(out.results[0]?.snippet, 'n');
  });

  it('falls back from bochaai.com to bocha.cn unless the first response is auth/quota', async () => {
    const urls: string[] = [];
    const out = await searchWithEngine('bocha', 'k', 'q', 3, async (url) => {
      urls.push(url);
      if (url.includes('bochaai.com')) return { status: 404, text: 'gone' };
      return {
        status: 200,
        text: JSON.stringify({
          data: { webPages: { value: [{ name: '博', url: 'https://bo.test', snippet: 's' }] } },
        }),
      };
    });
    assert.equal(out.ok, true);
    assert.deepEqual(urls, [
      'https://api.bochaai.com/v1/web-search',
      'https://api.bocha.cn/v1/web-search',
    ]);
  });

  it('does not fallback Bocha on 401', async () => {
    let n = 0;
    const out = await searchWithEngine('bocha', 'k', 'q', 3, async () => {
      n += 1;
      return { status: 401, text: 'nope' };
    });
    assert.equal(out.ok, false);
    assert.equal(n, 1);
  });

  it('posts Zhipu web_search and truncates query to 70 chars', async () => {
    const q = '中'.repeat(80);
    const out = await searchWithEngine('zhipu', 'glm-k', q, 3, async (url, init) => {
      assert.equal(url, 'https://open.bigmodel.cn/api/paas/v4/web_search');
      const body = JSON.parse(String(init.body)) as { search_query: string };
      assert.equal(body.search_query.length, 70);
      return {
        status: 200,
        text: JSON.stringify({
          search_result: [{ title: 'z', link: 'https://z.test', content: '正文' }],
        }),
      };
    });
    assert.equal(out.ok, true);
    if (out.ok) assert.equal(out.results[0]?.url, 'https://z.test');
  });
});
