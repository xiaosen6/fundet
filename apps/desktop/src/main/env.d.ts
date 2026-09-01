// vite `?raw` import（system-prompt.md / browser-mcp 规则文档）的类型声明
declare module '*.md?raw' {
  const content: string;
  export default content;
}

// browser-mcp 的 recipe-loader 用 Vite import.meta.glob('?raw') 打包内置站点配方
interface ImportMeta {
  glob<T = unknown>(
    pattern: string | string[],
    options?: {
      eager?: boolean;
      query?: string;
      import?: string;
    },
  ): Record<string, T>;
}
