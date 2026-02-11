/**
 * POST /api/player/move - UI-driven player movement
 *
 * Replaces the LLM tool `move_to_node` with a direct API call.
 * Body: { playerId, nodeId, force? }
 * Returns: movement result + new node info
 */

import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { clearActiveBattle } from "@/lib/ai/tools/action-tools";

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { playerId, nodeId, force } = body as {
      playerId: string;
      nodeId: string;
      force?: boolean;
    };

    if (!playerId || !nodeId) {
      return NextResponse.json(
        { success: false, error: "缺少 playerId 或 nodeId" },
        { status: 400 }
      );
    }

    // 查找目标节点
    const node = await prisma.areaNode.findUnique({
      where: { id: nodeId },
      include: { area: true },
    });

    if (!node) {
      return NextResponse.json(
        { success: false, error: `节点不存在` },
        { status: 404 }
      );
    }

    // 获取玩家当前位置
    const player = await prisma.player.findUnique({
      where: { id: playerId },
      select: { currentNodeId: true, currentAreaId: true },
    });

    if (!player) {
      return NextResponse.json(
        { success: false, error: "玩家不存在" },
        { status: 404 }
      );
    }

    // 连通性校验（非 force 模式）
    if (!force) {
      const isSameArea = player.currentAreaId === node.areaId;

      // 跨区域移动：仅允许传送至安全区 (safe)
      if (!isSameArea) {
        if (node.type !== "safe") {
          return NextResponse.json({
            success: false,
            error: `跨区域移动只能传送至安全区（如城镇、驿站）`,
          });
        }
        // 允许传送，跳过连通性检查
      } 
      // 同区域移动：检查连通性
      else if (player.currentNodeId) {
        const connections = await prisma.areaNodeConnection.findMany({
          where: {
            OR: [
              { fromId: player.currentNodeId },
              { toId: player.currentNodeId },
            ],
          },
          select: { fromId: true, toId: true },
        });

        const reachableIds = new Set(
          connections.map((c) =>
            c.fromId === player.currentNodeId ? c.toId : c.fromId
          )
        );

        if (!reachableIds.has(node.id)) {
          return NextResponse.json({
            success: false,
            error: `无法直接到达「${node.name}」，该节点与当前位置不相邻`,
          });
        }
      }
    }

    // 区域切换时自动清除战斗
    let escapedBattle: { enemyNames: string[] } | null = null;
    if (player.currentAreaId && player.currentAreaId !== node.areaId) {
      escapedBattle = await clearActiveBattle(playerId);
    }

    // 更新玩家位置
    await prisma.player.update({
      where: { id: playerId },
      data: { currentAreaId: node.areaId, currentNodeId: node.id },
    });

    // 更新已探索节点列表
    const playerArea = await prisma.playerArea.findUnique({
      where: { playerId_areaId: { playerId, areaId: node.areaId } },
    });

    if (playerArea) {
      const explored = JSON.parse(playerArea.exploredNodes as string) as string[];
      if (!explored.includes(node.id)) {
        explored.push(node.id);
        await prisma.playerArea.update({
          where: { id: playerArea.id },
          data: { exploredNodes: JSON.stringify(explored) },
        });
      }
    } else {
      await prisma.playerArea.create({
        data: {
          playerId,
          areaId: node.areaId,
          exploredNodes: JSON.stringify([node.id]),
        },
      });
    }

    // 写入聊天历史作为系统消息，让 LLM 知道玩家移动了
    await prisma.chatHistory.create({
      data: {
        playerId,
        role: "system",
        content: `🤖 玩家移动到了${node.area.name}的「${node.name}」（${node.type}节点）。${node.description || ""}`,
      },
    });

    return NextResponse.json({
      success: true,
      data: {
        nodeName: node.name,
        nodeType: node.type,
        description: node.description,
        areaName: node.area.name,
        ...(escapedBattle
          ? { escapedBattle: `逃离了与 ${escapedBattle.enemyNames.join("、")} 的战斗` }
          : {}),
      },
    });
  } catch (error) {
    console.error("[API /player/move] Error:", error);
    return NextResponse.json(
      { success: false, error: "移动失败" },
      { status: 500 }
    );
  }
}
