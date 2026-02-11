/**
 * /api/game/chat - 核心 SSE 端点
 *
 * POST - 接收玩家消息，返回 SSE 流式响应
 *
 * 所有游戏交互都通过此端点：战斗、移动、使用物品、NPC交互等
 * AI Game Master 解析意图后调用对应 Tool 完成操作。
 */

import { processGameMessage } from "@/lib/ai/gamemaster";

export const maxDuration = 120; // Vercel 超时设置（秒）

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { playerId, message } = body;

    if (!playerId) {
      return new Response(
        JSON.stringify({ error: "playerId 为必填参数" }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    // processGameMessage 直接返回 SSE Response
    return await processGameMessage({ playerId, message });
  } catch (error) {
    console.error("Chat API error:", error);
    return new Response(
      JSON.stringify({
        error: error instanceof Error ? error.message : "服务器错误",
      }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
}
