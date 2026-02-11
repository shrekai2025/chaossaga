/**
 * 查询类工具 - 获取游戏状态，无副作用
 */

import type { NormalizedTool } from "../adapters/types";
import { prisma } from "@/lib/db/prisma";

// ============================================================
// 工具定义（标准化格式）
// ============================================================

export const queryToolDefinitions: NormalizedTool[] = [
  // get_player_state: removed (玩家状态已通过 context injection 注入)
  // get_area_info: removed (区域信息已通过 context injection 注入)
  {
    name: "get_battle_state",
    description:
      "获取当前战斗的状态，包括双方HP/MP、回合数、BUFF/DEBUFF。可通过 battleId 或省略参数自动查找玩家的活跃战斗",
    parameters: {
      type: "object",
      properties: {
        battleId: { type: "string", description: "战斗ID（可选，省略时自动查找玩家当前活跃战斗）" },
      },
    },
  },
];

// ============================================================
// 工具执行
// ============================================================

export async function getPlayerState(
  args: Record<string, unknown>,
  playerId: string
) {
  const sections = (args.sections as string[]) || ["all"];
  const isAll = sections.includes("all");

  const player = await prisma.player.findUnique({
    where: { id: playerId },
    include: {
      skills: isAll || sections.includes("skills") ? true : false,
      inventory: isAll || sections.includes("inventory") ? true : false,
      equipment: isAll || sections.includes("equipment") ? true : false,
      quests: isAll || sections.includes("quests")
        ? { include: { quest: true } }
        : false,
    },
  });

  if (!player) {
    return { success: false, error: "玩家不存在" };
  }

  return { success: true, data: player };
}

export async function getAreaInfo(
  args: Record<string, unknown>,
  playerId: string
) {
  const areaId = (args.areaId as string) || null;

  // 如果未指定，使用玩家当前区域
  let targetAreaId = areaId;
  if (!targetAreaId) {
    const player = await prisma.player.findUnique({
      where: { id: playerId },
      select: { currentAreaId: true },
    });
    targetAreaId = player?.currentAreaId || null;
  }

  if (!targetAreaId) {
    return { success: false, error: "没有当前区域" };
  }

  let area = await prisma.area.findUnique({
    where: { id: targetAreaId },
    include: {
      nodes: {
        include: {
          connections: { include: { toNode: { select: { id: true, name: true } } } },
        },
      },
    },
  });

  // 如果 ID 查找失败，尝试按名称查找
  if (!area) {
    area = await prisma.area.findFirst({
      where: { name: { contains: targetAreaId } },
      include: {
        nodes: {
          include: {
            connections: { include: { toNode: { select: { id: true, name: true } } } },
          },
        },
      },
    });
  }

  if (!area) {
    return { success: false, error: "区域不存在" };
  }

  return { success: true, data: area };
}

export async function getBattleState(
  args: Record<string, unknown>,
  playerId: string
) {
  const battleId = args.battleId as string | undefined;

  let battle;
  if (battleId) {
    battle = await prisma.battleState.findUnique({
      where: { id: battleId },
    });
  } else {
    // 未指定 battleId → 按 playerId 查找活跃战斗
    battle = await prisma.battleState.findUnique({
      where: { playerId },
    });
  }

  if (!battle) {
    return { success: false, error: "没有进行中的战斗" };
  }

  return { success: true, data: battle };
}
