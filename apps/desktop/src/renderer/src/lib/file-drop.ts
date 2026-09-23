/**
 * 从 OS 拖放取出 File。保留 Electron 原 File 对象（上面挂着本地路径）。
 * 目录会被跳过（暂不递归拷贝）。
 */
export function filesFromDataTransfer(dataTransfer: DataTransfer): { files: File[]; skippedDirectory: boolean } {
  const files: File[] = [];
  let skippedDirectory = false;
  let fileIndex = 0;
  const items = Array.from(dataTransfer.items ?? []);
  for (const item of items) {
    if (item.kind !== 'file') continue;
    const file = dataTransfer.files[fileIndex] ?? item.getAsFile();
    fileIndex += 1;
    if (!file) continue;
    if (item.webkitGetAsEntry?.()?.isDirectory) {
      skippedDirectory = true;
      continue;
    }
    files.push(file);
  }
  if (files.length === 0 && !skippedDirectory) {
    files.push(...Array.from(dataTransfer.files ?? []));
  }
  return { files, skippedDirectory };
}

export function dataTransferHasFiles(dataTransfer: DataTransfer | null): boolean {
  if (!dataTransfer) return false;
  return Array.from(dataTransfer.types ?? []).includes('Files');
}

/** 拖拽悬浮期判断：是否含目录条目（用于遮罩文案切换） */
export function dataTransferHasDirectory(dataTransfer: DataTransfer | null): boolean {
  if (!dataTransfer) return false;
  return Array.from(dataTransfer.items ?? []).some(
    (item) => item.kind === 'file' && item.webkitGetAsEntry?.()?.isDirectory === true,
  );
}

/**
 * 取拖放里第一个目录的本地路径（没有则 null）。目录拖入 = 切工作目录
 * （0.3.13：文件夹拖 composer 设为 workDir，取代旧的「暂不支持」提示）。
 */
export function firstDroppedDirectoryPath(dataTransfer: DataTransfer): string | null {
  const items = Array.from(dataTransfer.items ?? []);
  let fileIndex = 0;
  for (const item of items) {
    if (item.kind !== 'file') continue;
    const file = dataTransfer.files[fileIndex] ?? item.getAsFile();
    fileIndex += 1;
    if (file && item.webkitGetAsEntry?.()?.isDirectory) {
      const p = window.fundet.getPathForFile(file);
      if (p) return p;
    }
  }
  return null;
}
