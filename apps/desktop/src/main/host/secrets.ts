/**
 * BYOK API key 存储：electron safeStorage 加密后落 userData/keys/<providerId>.bin。
 * key 绝不进数据库、不进日志。
 *
 * 兜底：无钥匙串的环境（WSL 等）safeStorage 不可用时，仅开发态降级为 base64 明文
 * 存储（文件带 plain: 前缀标记 + 启动警告）；打包版保持硬报错。
 */
import fs from 'node:fs';
import path from 'node:path';
import { app, safeStorage } from 'electron';

const PLAIN_PREFIX = 'plain:';

function keysDir(): string {
  const dir = path.join(app.getPath('userData'), 'keys');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function keyFile(providerId: string): string {
  // providerId 是 uuid，直接做文件名安全；防御性再清洗一次
  const safe = providerId.replace(/[^a-zA-Z0-9_-]/g, '_');
  return path.join(keysDir(), `${safe}.bin`);
}

function encryptionUsable(): boolean {
  try {
    return safeStorage.isEncryptionAvailable();
  } catch {
    return false;
  }
}

export function writeProviderKey(providerId: string, key: string): void {
  if (encryptionUsable()) {
    const encrypted = safeStorage.encryptString(key);
    fs.writeFileSync(keyFile(providerId), encrypted.toString('base64'), 'utf-8');
    return;
  }
  if (app.isPackaged) {
    throw new Error('safeStorage 加密不可用（系统无钥匙串），无法保存 API key');
  }
  console.warn('[fundet:secrets] safeStorage 不可用，开发态降级为明文存储 API key（仅本机调试用）');
  fs.writeFileSync(keyFile(providerId), PLAIN_PREFIX + Buffer.from(key, 'utf-8').toString('base64'), 'utf-8');
}

export function readProviderKey(providerId: string): string | null {
  const file = keyFile(providerId);
  if (!fs.existsSync(file)) return null;
  try {
    const raw = fs.readFileSync(file, 'utf-8');
    if (raw.startsWith(PLAIN_PREFIX)) {
      return Buffer.from(raw.slice(PLAIN_PREFIX.length), 'base64').toString('utf-8');
    }
    return safeStorage.decryptString(Buffer.from(raw, 'base64'));
  } catch {
    return null;
  }
}

export function hasProviderKey(providerId: string): boolean {
  return readProviderKey(providerId) !== null;
}

export function deleteProviderKey(providerId: string): void {
  const file = keyFile(providerId);
  if (fs.existsSync(file)) fs.rmSync(file, { force: true });
}
