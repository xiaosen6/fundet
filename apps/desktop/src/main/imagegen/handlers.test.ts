import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createImagegenHandlers } from './handlers.ts';

function fakeDeps(overrides: Partial<Parameters<typeof createImagegenHandlers>[0]> = {}) {
  const saved: Array<{ dir: string; prompt: string }> = [];
  const deps = {
    provider: {
      generate: async (req: { prompt: string; size: string }) => ({ bytes: new Uint8Array([1, 2, 3]) }),
    },
    workingDir: 'W:/proj',
    saveImage: async (dir: string, _b: unknown, prompt: string) => {
      saved.push({ dir, prompt });
      return `fundet-images/x-${prompt.slice(0, 4)}.png`;
    },
    ...overrides,
  };
  return { deps, saved };
}

test('正常生成：prompt 必填、size 默认 1024x1024、结果带保存路径', async () => {
  const { deps, saved } = fakeDeps();
  const calls: Array<{ prompt: string; size: string }> = [];
  deps.provider.generate = async (req) => {
    calls.push(req);
    return { bytes: new Uint8Array([9]) };
  };
  const h = createImagegenHandlers(deps);
  const ok = await h.generateImage({ prompt: '一个红色宇航员机器人' });
  assert.ok(!ok.isError);
  assert.ok(ok.text.includes('fundet-images/x-'));
  assert.deepEqual(calls, [{ prompt: '一个红色宇航员机器人', size: '1024x1024' }]);
  assert.equal(saved.length, 1);
  assert.equal(saved[0].dir, 'W:/proj');
});

test('缺 prompt / 非法 size 报 INVALID_PARAMS 并给出格式说明', async () => {
  const h = createImagegenHandlers(fakeDeps().deps);
  const noPrompt = await h.generateImage({});
  assert.ok(noPrompt.isError && noPrompt.text.includes('prompt'));
  const badSize = await h.generateImage({ prompt: 'x', size: '巨大' });
  assert.ok(badSize.isError && badSize.text.includes('宽x高'));
  const tooBig = await h.generateImage({ prompt: 'x', size: '4096x1024' });
  assert.ok(tooBig.isError);
  // 合法尺寸透传
  const okSize = await h.generateImage({ prompt: 'x', size: '1280x720' });
  assert.ok(!okSize.isError);
});

test('provider 抛错转友好错误文本（isError 不炸通道）', async () => {
  const { deps } = fakeDeps({
    provider: {
      generate: async () => {
        throw new Error('生图服务失败（HTTP 503）：busy');
      },
    },
  });
  const h = createImagegenHandlers(deps);
  const r = await h.generateImage({ prompt: 'x' });
  assert.ok(r.isError);
  assert.ok(r.text.includes('503') && r.text.includes('重试'));
});

test('slugOf：拉丁 prompt 转 slug、中文兜底 image', async () => {
  const h = createImagegenHandlers(fakeDeps().deps);
  assert.equal(h.slugOf('Red Astronaut Robot!'), 'red-astronaut-robot');
  assert.equal(h.slugOf('一个机器人'), 'image');
});
