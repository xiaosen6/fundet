/**
 * 办公 CLI 供应商的读写（settings 表 officecli.provider，缺省企业微信）。
 *
 * settings 依赖 sqlite 原生模块，只能惰性 import——dws.ts / dws-widgets.ts 被
 * node --test 直跑，模块顶层不能拉起数据库（dws.enabled 的同款约束）。
 */
import {
  DEFAULT_OFFICE_PROVIDER,
  normalizeOfficeProvider,
  OFFICE_PROVIDER_SETTING,
  type OfficeCliProvider,
} from '../../shared/office-cli.ts';

export async function getOfficeProvider(): Promise<OfficeCliProvider> {
  try {
    const { getSetting } = await import('../db/settings.js');
    return normalizeOfficeProvider(getSetting(OFFICE_PROVIDER_SETTING));
  } catch {
    return DEFAULT_OFFICE_PROVIDER;
  }
}

export async function setOfficeProvider(provider: OfficeCliProvider): Promise<void> {
  const { setSetting } = await import('../db/settings.js');
  setSetting(OFFICE_PROVIDER_SETTING, normalizeOfficeProvider(provider));
}
