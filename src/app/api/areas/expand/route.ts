/**
 * POST /api/areas/expand - 区域扩展 API
 *
 * SSE 流式返回扩展进度和新节点创建结果。
 * 请求体: { areaId: string, playerId: string, scale: number, hint?: string }
 */

import { expandArea, type ExpandSSEEvent } from "@/lib/ai/area-operations";

export async function POST(req: Request) {
  let body: { areaId?: string; playerId?: string; scale?: number; hint?: string };
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "无效的请求体" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const { areaId, playerId, scale, hint } = body;
  if (!areaId || !playerId) {
    return new Response(JSON.stringify({ error: "缺少 areaId 或 playerId" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  // 校验 scale 参数
  const validScales = [0.5, 1.0, 2.0];
  const actualScale = validScales.includes(scale ?? 0) ? scale! : 0.5;

  // SSE 流式响应
  const encoder = new TextEncoder();
  const stream = new TransformStream();
  const writer = stream.writable.getWriter();

  const sendEvent = (event: ExpandSSEEvent) => {
    const data = `data: ${JSON.stringify(event)}\n\n`;
    writer.write(encoder.encode(data)).catch(() => {/* 连接已关闭 */});
  };

  // 后台执行扩展（不阻塞响应）
  (async () => {
    try {
      await expandArea(areaId, playerId, actualScale, hint || "", sendEvent);
    } catch (error) {
      sendEvent({
        type: "error",
        message: `扩展过程发生错误: ${error instanceof Error ? error.message : "未知错误"}`,
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
