/**
 * 技能扫描 utilityProcess 入口（固定的一次性 worker，Cindy #5858 同构）：
 * 无 renderer bridge、无凭证、无写命令——只监听一次 parentPort 消息做扫描。
 * 错误不抛异常：任何失败都变成 {items: [], errors} 的正常响应，主进程永不 reject。
 * parentPort 可选链保证 node --test / 主进程 import 本文件不炸。
 */
import { scanPiCustomizations } from '@fundet/agent-core/customization-scanner';
import type { SkillScanRequest, SkillScanResponse } from './skill-scan-protocol.js';

interface ParentPort {
  postMessage(message: SkillScanResponse): void;
  once(event: 'message', listener: (event: { data: SkillScanRequest }) => void): void;
}

const parentPort = (process as unknown as { parentPort?: ParentPort }).parentPort;
parentPort?.once('message', ({ data: request }) => {
  if (!request || typeof request.id !== 'string' || request.kind !== 'scan') return;
  void (async () => {
    try {
      const result = await scanPiCustomizations(request.options);
      parentPort.postMessage({ kind: 'result', id: request.id, result });
    } catch {
      parentPort.postMessage({
        kind: 'result',
        id: request.id,
        result: { items: [], errors: [{ message: '[pi] Skill discovery failed' }] },
      });
    }
  })();
});
