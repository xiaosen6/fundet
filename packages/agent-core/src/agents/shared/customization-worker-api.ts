/**
 * 窄出口：供宿主把文件系统发现（discovery）隔离进 utilityProcess 的场景。
 * 只暴露扫描器本身，不拖入完整 agent/运行时图（pi/index.ts 三千行）。
 */
export { scanPiCustomizations } from '../pi/customization-scanner.js';
