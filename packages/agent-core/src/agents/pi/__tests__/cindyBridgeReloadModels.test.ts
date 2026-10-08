import path from 'node:path';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

import { CINDY_BRIDGE_EXTENSION_SOURCE } from '../cindy-bridge-source.js';
import { encodeReloadModelsPayload } from '../model-catalog.js';

type ReloadCommand = {
  handler: (args: string, ctx: unknown) => Promise<void>;
};

type ExecutedBridge = {
  commands: Map<string, ReloadCommand>;
  bashSpawnHook: (frame: { command: string; cwd: string; env: Record<string, string | undefined> }) => {
    command: string;
    cwd: string;
    env: Record<string, string | undefined>;
  };
  env: Record<string, string | undefined>;
};

/** 转译并在 VM 里执行 bridge 源码（剥掉 import，注入 node/pi 桩），返回可触达的命令表。 */
function executeBridgeSource(secretEnvNamesJson?: string): ExecutedBridge {
  const importEnd = CINDY_BRIDGE_EXTENSION_SOURCE.indexOf("} from '@earendil-works/pi-coding-agent';");
  if (importEnd < 0) throw new Error('bridge import block not found');
  const body = CINDY_BRIDGE_EXTENSION_SOURCE
    .slice(importEnd + "} from '@earendil-works/pi-coding-agent';".length)
    .replace('export default async function cindyBridge', 'async function cindyBridge')
    + '\n(globalThis as any).__cindyBridge = cindyBridge;';
  const compiled = ts.transpileModule(body, {
    compilerOptions: { module: ts.ModuleKind.None, target: ts.ScriptTarget.ES2022 },
  }).outputText;

  const commands = new Map<string, ReloadCommand>();
  const env: Record<string, string | undefined> = {
    ...(secretEnvNamesJson ? { CINDY_PI_SECRET_ENV_NAMES: secretEnvNamesJson } : {}),
  };
  let bashSpawnHook: ExecutedBridge['bashSpawnHook'] = (frame) => frame;
  const pi = {
    registerTool: () => undefined,
    on: () => undefined,
    registerCommand: (name: string, def: ReloadCommand) => {
      commands.set(name, def);
    },
  };
  const context: Record<string, unknown> = {
    console,
    Buffer,
    process: { env, cwd: () => 'C:\\work', platform: 'win32' },
    path,
    lstatSync: () => {
      throw new Error('not expected in this test');
    },
    readFileSync: () => {
      throw new Error('not expected in this test');
    },
    realpathSync: () => {
      throw new Error('not expected in this test');
    },
    statSync: () => {
      throw new Error('not expected in this test');
    },
    stat: async () => {
      throw new Error('not expected in this test');
    },
    spawn: () => {
      throw new Error('not expected in this test');
    },
    createInterface: () => ({ on: () => undefined, close: () => undefined }),
    createGrepTool: () => ({ name: 'grep', execute: async () => ({}) }),
    createFindTool: (_cwd: unknown, opts: { operations: unknown }) => {
      expect(opts).toBeTypeOf('object');
      return { name: 'find', execute: async () => ({}) };
    },
    createLsTool: () => ({ name: 'ls', execute: async () => ({}) }),
    createBashTool: (_cwd: unknown, opts: { spawnHook: ExecutedBridge['bashSpawnHook'] }) => {
      bashSpawnHook = opts.spawnHook;
      return { name: 'bash', execute: async () => ({}) };
    },
  };
  runInNewContext(compiled, context);
  const factory = context['__cindyBridge'] as (piStub: unknown) => Promise<void>;
  if (typeof factory !== 'function') throw new Error('cindyBridge default export not loaded');
  void factory(pi);
  return { commands, bashSpawnHook, env };
}

describe('cindy-bridge cindy-reload-models command', () => {
  it('registers the command and refreshes the model registry without network', async () => {
    const bridge = executeBridgeSource();
    const command = bridge.commands.get('cindy-reload-models');
    expect(command).toBeTypeOf('object');
    const refreshCalls: Array<Record<string, unknown>> = [];
    await command!.handler(encodeReloadModelsPayload({}), {
      modelRegistry: { refresh: async (opts: Record<string, unknown>) => { refreshCalls.push(opts); } },
    });
    expect(refreshCalls).toEqual([{ allowNetwork: false }]);
  });

  it('injects whitelisted BYOM key env and hides it from model-spawned bash', async () => {
    const bridge = executeBridgeSource(JSON.stringify(['CINDY_PI_PERMISSION_FILE']));
    const command = bridge.commands.get('cindy-reload-models')!;
    await command.handler(
      encodeReloadModelsPayload({
        CINDY_PI_KEY_P1: 'sk-new-provider-key',
        OTHER_VAR: 'nope',
        'CINDY_PI_KEY_bad-name': 'nope',
      } as unknown as Record<string, string>),
      { modelRegistry: { refresh: async () => undefined } },
    );
    expect(bridge.env['CINDY_PI_KEY_P1']).toBe('sk-new-provider-key');
    expect(bridge.env['OTHER_VAR']).toBeUndefined();
    expect(bridge.env['CINDY_PI_KEY_bad-name']).toBeUndefined();
    // 与 spawn 时注入的 key 同口径：bash 工具的 spawn 边界剥离 reload 补注入的 key
    const cleaned = bridge.bashSpawnHook({
      command: 'env',
      cwd: 'C:\\work',
      env: { CINDY_PI_KEY_P1: 'sk-new-provider-key', PATH: 'C:\\bin' },
    });
    expect(cleaned.env['CINDY_PI_KEY_P1']).toBeUndefined();
    expect(cleaned.env['PATH']).toBe('C:\\bin');
  });

  it('ignores malformed payloads but still refreshes; fails closed without a registry', async () => {
    const bridge = executeBridgeSource();
    const command = bridge.commands.get('cindy-reload-models')!;
    let refreshed = 0;
    await command.handler('not-json', {
      modelRegistry: { refresh: async () => { refreshed += 1; } },
    });
    expect(refreshed).toBe(1);
    expect(bridge.env['CINDY_PI_KEY_P1']).toBeUndefined();
    await expect(
      command.handler(encodeReloadModelsPayload({}), {}),
    ).rejects.toThrow('Cindy model registry unavailable');
  });
});
