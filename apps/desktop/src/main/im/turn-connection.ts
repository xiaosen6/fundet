/**
 * IM 回合的连接代次绑定：入站时捕获 client + generation；之后即使 stop/start
 * 换了全局连接，旧回合也不能借用新账号发出去。分块循环每块发送前都复核。
 */
export interface ImTurnConnection<T> {
  readonly client: T;
  isCurrent: () => boolean;
}

export function captureImTurnConnection<T>(
  client: T,
  generation: number,
  currentGeneration: () => number,
): ImTurnConnection<T> {
  return { client, isCurrent: () => currentGeneration() === generation };
}

/** 返回 true=整段发送完成；false=代次失效，剩余分块全部丢弃。 */
export async function sendImTextChunks<T>(
  connection: ImTurnConnection<T>,
  chunks: readonly string[],
  send: (client: T, chunk: string) => Promise<void>,
): Promise<boolean> {
  for (const chunk of chunks) {
    if (!connection.isCurrent()) return false;
    await send(connection.client, chunk);
  }
  return true;
}
