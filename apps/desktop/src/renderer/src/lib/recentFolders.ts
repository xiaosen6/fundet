const KEY = 'fundet.recentFolders';
const MAX = 5;

export interface RecentFolder {
  path: string;
  name: string;
}

export function folderNameOf(folderPath: string): string {
  return folderPath.split(/[\\/]/).filter(Boolean).pop() ?? folderPath;
}

export function getRecentFolders(): RecentFolder[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as RecentFolder[];
    return Array.isArray(parsed) ? parsed.slice(0, MAX) : [];
  } catch {
    return [];
  }
}

export function addRecentFolder(folderPath: string): void {
  const name = folderNameOf(folderPath);
  const next = [{ path: folderPath, name }, ...getRecentFolders().filter((f) => f.path !== folderPath)].slice(0, MAX);
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    // ignore
  }
}
