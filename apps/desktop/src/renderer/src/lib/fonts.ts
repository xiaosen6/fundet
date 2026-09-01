const UI_KEY = 'longma.font.ui';
const CODE_KEY = 'longma.font.code';

export const DEFAULT_UI_FONT =
  "'Inter Variable', Inter, system-ui, -apple-system, 'Segoe UI', sans-serif";
export const DEFAULT_CODE_FONT =
  "'JetBrains Mono Variable', 'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, Consolas, monospace";

export const UI_FONT_PRESETS: Array<{ id: string; label: string; family: string }> = [
  { id: 'default', label: 'Inter（默认）', family: '' },
  { id: 'system', label: '系统 UI', family: '-apple-system, BlinkMacSystemFont, "Segoe UI"' },
  { id: 'harmony', label: 'HarmonyOS Sans SC', family: '"HarmonyOS Sans SC"' },
];

export const CODE_FONT_PRESETS: Array<{ id: string; label: string; family: string }> = [
  { id: 'default', label: 'JetBrains Mono（默认）', family: '' },
  { id: 'system', label: '系统等宽', family: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace' },
];

export function getUiFont(): string {
  return window.localStorage.getItem(UI_KEY) ?? '';
}

export function getCodeFont(): string {
  return window.localStorage.getItem(CODE_KEY) ?? '';
}

export function setUiFont(family: string): void {
  window.localStorage.setItem(UI_KEY, family);
  applyFonts();
}

export function setCodeFont(family: string): void {
  window.localStorage.setItem(CODE_KEY, family);
  applyFonts();
}

export function applyFonts(): void {
  const ui = getUiFont().trim();
  const code = getCodeFont().trim();
  const root = document.documentElement;
  root.style.setProperty('--app-font-ui', ui ? `${ui}, ${DEFAULT_UI_FONT}` : DEFAULT_UI_FONT);
  root.style.setProperty('--app-font-code', code ? `${code}, ${DEFAULT_CODE_FONT}` : DEFAULT_CODE_FONT);
}
