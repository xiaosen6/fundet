/**
 * 技能扫描 utilityProcess 隔离的协议类型（主进程 ↔ worker，纯数据无 Electron 依赖）。
 */
import type { ListCustomizationsOptions, ListCustomizationsResult } from '@fundet/agent-core';

export interface SkillScanRequest {
  kind: 'scan';
  id: string;
  options: ListCustomizationsOptions;
}

export interface SkillScanResponse {
  kind: 'result';
  id: string;
  result: ListCustomizationsResult;
}
