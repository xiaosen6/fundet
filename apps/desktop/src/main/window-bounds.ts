/** 启动窗口边界：按目标屏 workArea 拟合默认矩形，避免高 DPI/矮屏越界。 */
export interface WindowRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface StartupWindowLayout {
  bounds: WindowRect;
  minWidth: number;
  minHeight: number;
}

export function fitStartupBounds(
  requested: WindowRect,
  workArea: WindowRect,
  minimum: { width: number; height: number },
): StartupWindowLayout {
  // 工作区比最小尺寸还小时，让 min 也随工作区收缩，否则 BrowserWindow 会再次越界。
  const minWidth = Math.max(1, Math.min(minimum.width, Math.floor(workArea.width)));
  const minHeight = Math.max(1, Math.min(minimum.height, Math.floor(workArea.height)));
  const width = Math.max(minWidth, Math.min(Math.floor(requested.width), Math.floor(workArea.width)));
  const height = Math.max(minHeight, Math.min(Math.floor(requested.height), Math.floor(workArea.height)));
  const maxX = workArea.x + workArea.width - width;
  const maxY = workArea.y + workArea.height - height;
  const x = Math.max(workArea.x, Math.min(Math.floor(requested.x), maxX));
  const y = Math.max(workArea.y, Math.min(Math.floor(requested.y), maxY));
  return { bounds: { x, y, width, height }, minWidth, minHeight };
}
