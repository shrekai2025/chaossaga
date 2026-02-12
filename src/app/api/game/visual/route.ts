/**
 * /api/game/visual - 获取游戏视觉区数据
 *
 * GET ?playerId=xxx
 *
 * 根据玩家当前状态返回：
 * - 探索模式：区域名、地点名、地点类型、NPC列表
 * - 战斗模式：区域名、地点名、敌人列表（名称、HP、MP）、玩家已装备技能
 */

import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const playerId = searchParams.get("playerId");

  if (!playerId) {
    return NextResponse.json({ error: "缺少 playerId" }, { status: 400 });
  }

  const player = await prisma.player.findUnique({
    where: { id: playerId },
    select: {
      currentAreaId: true,
      currentNodeId: true,
    },
  });

  if (!player) {
    return NextResponse.json({ error: "玩家不存在" }, { status: 404 });
  }

  // 获取区域和地点信息
  let areaName = "未知区域";
  let nodeName = "未知地点";
  let nodeType = "unknown";
  let npcs: Array<{ name: string; role?: string }> = [];

  if (player.currentAreaId) {
    const area = await prisma.area.findUnique({
      where: { id: player.currentAreaId },
      select: { name: true },
    });
    if (area) areaName = area.name;
  }

  if (player.currentNodeId) {
    const node = await prisma.areaNode.findUnique({
      where: { id: player.currentNodeId },
      select: { name: true, type: true, data: true },
    });
    if (node) {
      nodeName = node.name;
      nodeType = node.type;
      // 从 node.data 中提取 NPC 列表
      const nodeData = node.data as Record<string, unknown> | null;
      if (nodeData?.npcs) {
        npcs = (
          nodeData.npcs as Array<{
            name?: string;
            role?: string;
          }>
        )
          .filter((n) => n.name)
          .map((n) => ({ name: n.name!, role: n.role }));
      }
    }
  }

  // 检查战斗状态
  const battle = await prisma.battleState.findUnique({
    where: { playerId },
    select: { status: true, enemies: true },
  });

  const isBattle = battle?.status === "active";
  let enemies: Array<{
    name: string;
    level: number;
    hp: number;
    maxHp: number;
    mp: number;
    maxMp: number;
  }> = [];

  // 战斗模式下的额外数据
  let skills: Array<{
    name: string;
    element: string;
    mpCost: number;
    damage: number;
    effect: unknown;
  }> = [];

  if (isBattle && battle?.enemies) {
    const rawEnemies = battle.enemies as Array<{
      name: string;
      level?: number;
      hp: number;
      maxHp: number;
      mp?: number;
      maxMp?: number;
    }>;
    enemies = rawEnemies.map((e) => ({
      name: e.name,
      level: e.level ?? 1,
      hp: e.hp,
      maxHp: e.maxHp,
      mp: e.mp ?? 0,
      maxMp: e.maxMp ?? 0,
    }));

    // 获取玩家已装备的技能
    const equippedSkills = await prisma.playerSkill.findMany({
      where: { playerId, equipped: true },
      orderBy: { slotIndex: "asc" },
      select: {
        name: true,
        element: true,
        mpCost: true,
        damage: true,
        effect: true,
      },
    });
    skills = equippedSkills.map((s) => ({
      name: s.name,
      element: s.element,
      mpCost: s.mpCost,
      damage: s.damage,
      effect: s.effect,
    }));
  }

  return NextResponse.json({
    success: true,
    data: {
      areaName,
      nodeName,
      nodeType,
      isBattle,
      npcs,
      enemies,
      skills,
    },
  });
}
