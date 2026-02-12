/**
 * /api/areas - 区域数据 API
 *
 * GET - 获取所有区域列表，或指定区域的详细信息（含节点和连接）
 *   ?playerId=xxx          获取该玩家可见的所有区域
 *   ?id=xxx                获取指定区域的详细信息（节点+连接）
 */

import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const areaId = searchParams.get("id");
  const playerId = searchParams.get("playerId");
  const forPlayerId = searchParams.get("forPlayerId"); // 用于区域详情时获取玩家当前节点

  // 获取单个区域详情
  if (areaId) {
    const area = await prisma.area.findUnique({
      where: { id: areaId },
      include: {
        nodes: {
          select: {
            id: true,
            name: true,
            type: true,
            description: true,
            data: true,
            posX: true,
            posY: true,
          },
          orderBy: { posX: "asc" },
        },
      },
    });

    if (!area) {
      return NextResponse.json({ error: "区域不存在" }, { status: 404 });
    }

    // 获取连接关系
    const connections = await prisma.areaNodeConnection.findMany({
      where: { fromId: { in: area.nodes.map((n) => n.id) } },
      select: { fromId: true, toId: true },
    });

    // 构建节点名称映射
    const nameMap: Record<string, string> = {};
    area.nodes.forEach((n) => (nameMap[n.id] = n.name));

    // 去重（只保留一个方向）
    const seen = new Set<string>();
    const uniqueConnections = connections.filter((c) => {
      const key = [c.fromId, c.toId].sort().join("-");
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    // 获取请求者的当前节点（如果有 forPlayerId）
    let currentNodeId: string | null = null;
    if (forPlayerId) {
      const reqPlayer = await prisma.player.findUnique({
        where: { id: forPlayerId },
        select: { currentNodeId: true, currentAreaId: true },
      });
      if (reqPlayer?.currentAreaId === areaId) {
        currentNodeId = reqPlayer.currentNodeId;
      }
    }

    // 计算边缘节点（连接数最少的非 boss 节点，供扩展功能使用）
    const dedupedCounts: Record<string, number> = {};
    area.nodes.forEach((n) => (dedupedCounts[n.id] = 0));
    for (const c of uniqueConnections) {
      dedupedCounts[c.fromId] = (dedupedCounts[c.fromId] || 0) + 1;
      dedupedCounts[c.toId] = (dedupedCounts[c.toId] || 0) + 1;
    }
    const edgeNodes = area.nodes
      .filter((n) => n.type !== "boss")
      .map((n) => ({
        id: n.id,
        name: n.name,
        type: n.type,
        connectionCount: dedupedCounts[n.id] || 0,
      }))
      .sort((a, b) => a.connectionCount - b.connectionCount)
      .slice(0, 5);

    return NextResponse.json({
      success: true,
      data: {
        ...area,
        currentNodeId,
        connections: uniqueConnections.map((c) => ({
          fromId: c.fromId,
          toId: c.toId,
          from: nameMap[c.fromId] || c.fromId,
          to: nameMap[c.toId] || c.toId,
        })),
        edgeNodes,
      },
    });
  }

  // 获取区域列表
  if (playerId) {
    // 获取玩家当前位置
    const player = await prisma.player.findUnique({
      where: { id: playerId },
      select: { currentAreaId: true, currentNodeId: true },
    });

    const areas = await prisma.area.findMany({
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        name: true,
        description: true,
        theme: true,
        recommendedLevel: true,
        createdAt: true,
        _count: { select: { nodes: true } },
      },
    });

    return NextResponse.json({
      success: true,
      data: {
        areas: areas.map((a) => ({
          id: a.id,
          name: a.name,
          description: a.description,
          theme: a.theme,
          recommendedLevel: a.recommendedLevel,
          nodeCount: a._count.nodes,
          isCurrent: player?.currentAreaId === a.id,
        })),
        currentAreaId: player?.currentAreaId,
      },
    });
  }

  return NextResponse.json(
    { error: "需要 playerId 或 id 参数" },
    { status: 400 }
  );
}
