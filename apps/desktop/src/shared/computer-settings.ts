/** 电脑操作（Computer Use）共享常量 */
export const COMPUTER_MCP_SERVER_NAME = 'computer';
/** 设置表里的开关 key */
export const COMPUTER_ENABLED_SETTING = 'computer.enabled';

export interface ComputerStatus {
  enabled: boolean;
  /** cua-driver 二进制是否就绪（打包内置或 apps/cua-driver-bin 下载） */
  driverAvailable: boolean;
}
