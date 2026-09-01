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
