import type { StreamEvent } from '@short-drama/shared';

/** SSE 客户端：afterSeq 断线续传；EventSource 自动重连带 Last-Event-ID。 */
export function subscribeEvents(
  projectId: string,
  afterSeq: number,
  onEvent: (event: StreamEvent) => void,
): () => void {
  const source = new EventSource(`/api/projects/${projectId}/events?afterSeq=${afterSeq}`);
  source.onmessage = (message) => {
    try {
      onEvent(JSON.parse(message.data) as StreamEvent);
    } catch {
      // 忽略无法解析的帧
    }
  };
  return () => source.close();
}
