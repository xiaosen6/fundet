import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  compareVersions,
  decideUpdateAction,
  githubFeedConfig,
  proxyFeedUrl,
  proxyLatestApiUrl,
} from './updater-source.ts';

test('compareVersions：常规升降与相等', () => {
  assert.equal(compareVersions('0.3.13', '0.3.12'), 1);
  assert.equal(compareVersions('0.3.9', '0.3.10'), -1);
  assert.equal(compareVersions('0.3.13', '0.3.13'), 0);
  assert.equal(compareVersions('v0.3.13', '0.3.13'), 0);
});

test('compareVersions：跨位与预发布', () => {
  assert.equal(compareVersions('0.4.0', '0.3.99'), 1);
  assert.equal(compareVersions('1.0.0', '0.99.99'), 1);
  assert.equal(compareVersions('0.3.13-beta.1', '0.3.13'), -1); // 预发布段字符串序
});

test('decideUpdateAction：有新版走代理，无新版不折腾，代理失败回落', () => {
  assert.equal(decideUpdateAction({ currentVersion: '0.3.13', proxyTag: 'v0.3.14' }), 'proxy-feed');
  assert.equal(decideUpdateAction({ currentVersion: '0.3.13', proxyTag: 'v0.3.13' }), 'no-update');
  assert.equal(decideUpdateAction({ currentVersion: '0.3.13', proxyTag: null }), 'fallback-github');
});

test('URL 构造', () => {
  assert.equal(
    proxyLatestApiUrl('xiaosen6', 'fundet'),
    'https://gh-proxy.com/https://api.github.com/repos/xiaosen6/fundet/releases/latest',
  );
  assert.equal(
    proxyFeedUrl('xiaosen6', 'fundet', 'v0.3.14'),
    'https://gh-proxy.com/https://github.com/xiaosen6/fundet/releases/download/v0.3.14/',
  );
  assert.deepEqual(githubFeedConfig('xiaosen6', 'fundet'), {
    provider: 'github',
    owner: 'xiaosen6',
    repo: 'fundet',
  });
});
