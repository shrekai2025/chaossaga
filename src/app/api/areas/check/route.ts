/**
 * POST /api/areas/check - 区域完整性检查 API
 *
 * SSE 流式返回检查进度和修复结果。
 * 请求体: { areaId: string, playerId: string }
 */

import { checkAreaIntegrity, type CheckSSEEvent } from "@/lib/ai/area-operations";

export async function POST(req: Request) {
  let body: { areaId?: string; playerId?: string };
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "无效的请求体" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const { areaId, playerId } = body;
  if (!areaId || !playerId) {
    return new Response(JSON.stringify({ error: "缺少 areaId 或 playerId" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  // SSE 流式响应
  const encoder = new TextEncoder();
  const stream = new TransformStream();
  const writer = stream.writable.getWriter();

  const sendEvent = (event: CheckSSEEvent) => {
    const data = `data: ${JSON.stringify(event)}\n\n`;
    writer.write(encoder.encode(data)).catch(() => {/* 连接已关闭 */});
  };

  // 后台执行检查（不阻塞响应）
  (async () => {
    try {
      await checkAreaIntegrity(areaId, playerId, sendEvent);
    } catch (error) {
      sendEvent({
        type: "error",
        message: `检查过程发生错误: ${error instanceof Error ? error.message : "未知错误"}`,
      });
      sendEvent({ type: "done" });
    } finally {
      writer.close().catch(() => {/* 已关闭 */});
    }
  })();

  return new Response(stream.readable, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
