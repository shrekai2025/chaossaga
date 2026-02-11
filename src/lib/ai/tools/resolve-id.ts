/**
 * 集中式 名称→ID 解析器
 *
 * LLM 经常传入物品名称 / 任务名称 而不是数据库 ID。
 * 此模块提供统一的解析函数，先尝试按 ID 精确查找，
 * 失败后按名称模糊匹配，从而增强鲁棒性。
 */

import { prisma } from "@/lib/db/prisma";

/** 解析结果 */
interface ResolveResult<T> {
  found: true;
  record: T;
}

interface ResolveNotFound {
  found: false;
  error: string;
}

type Resolved<T> = ResolveResult<T> | ResolveNotFound;

// ============================================================
// 物品解析
// ============================================================

type InventoryItem = Awaited<ReturnType<typeof prisma.inventoryItem.findFirst>> & {};

/**
 * 解析物品：先按 ID 查找，再按名称模糊匹配
 */
export async function resolveItem(
  identifier: string,
  playerId: string
): Promise<Resolved<NonNullable<InventoryItem>>> {
  // 1. 按 ID 精确查找
  const byId = await prisma.inventoryItem.findFirst({
    where: { id: identifier, playerId },
  });
  if (byId) return { found: true, record: byId };

  // 2. 按名称精确匹配
  const byExactName = await prisma.inventoryItem.findFirst({
    where: { playerId, name: identifier },
  });
  if (byExactName) return { found: true, record: byExactName };

  // 3. 按名称模糊匹配（contains）
  const byFuzzyName = await prisma.inventoryItem.findFirst({
    where: { playerId, name: { contains: identifier } },
  });
  if (byFuzzyName) return { found: true, record: byFuzzyName };

  return { found: false, error: `背包中没有找到物品「${identifier}」` };
}

// ============================================================
// 任务解析
// ============================================================

type PlayerQuestWithQuest = NonNullable<
  Awaited<ReturnType<typeof prisma.playerQuest.findFirst>>
> & {
  quest: NonNullable<Awaited<ReturnType<typeof prisma.quest.findFirst>>>;
};

/**
 * 解析任务：先按 questId 复合键查找，再按任务名称模糊匹配
 */
export async function resolveQuest(
  identifier: string,
  playerId: string,
  statusFilter?: string
): Promise<Resolved<PlayerQuestWithQuest>> {
  // 1. 按 questId 复合键查找
  const byId = await prisma.playerQuest.findFirst({
    where: {
      playerId,
      questId: identifier,
      ...(statusFilter ? { status: statusFilter } : {}),
    },
    include: { quest: true },
  });
  if (byId) return { found: true, record: byId as PlayerQuestWithQuest };

  // 2. 按任务名称精确匹配
  const byExactName = await prisma.playerQuest.findFirst({
    where: {
      playerId,
      quest: { name: identifier },
      ...(statusFilter ? { status: statusFilter } : {}),
    },
    include: { quest: true },
  });
  if (byExactName) return { found: true, record: byExactName as PlayerQuestWithQuest };

  // 3. 按任务名称模糊匹配
  const byFuzzyName = await prisma.playerQuest.findFirst({
    where: {
      playerId,
      quest: { name: { contains: identifier } },
      ...(statusFilter ? { status: statusFilter } : {}),
    },
    include: { quest: true },
  });
  if (byFuzzyName) return { found: true, record: byFuzzyName as PlayerQuestWithQuest };

  return { found: false, error: `任务「${identifier}」不存在` };
}

// ============================================================
// NPC 解析
// ============================================================

/**
 * 解析 NPC：先按 ID 在当前区域节点查找，再按名称模糊匹配
 * NPC 存储在 AreaNode.data 中，没有独立的 DB 表，
 * 所以这里返回节点 + NPC 数据
 */
export async function resolveNpc(
  identifier: string,
  playerId: string
): Promise<
  Resolved<{
    nodeId: string;
    npc: { id: string; name: string; [key: string]: unknown };
  }>
> {
  const player = await prisma.player.findUnique({
    where: { id: playerId },
    select: { currentAreaId: true, currentNodeId: true },
  });
  if (!player?.currentAreaId) {
    return { found: false, error: "玩家不在任何区域中" };
  }

  // 获取当前区域所有节点
  const nodes = await prisma.areaNode.findMany({
    where: { areaId: player.currentAreaId },
    select: { id: true, data: true, type: true },
  });

  for (const node of nodes) {
    const data = node.data as Record<string, unknown> | null;
    if (!data) continue;

    // NPC 节点
    const npc = data.npc as { id?: string; name?: string; [key: string]: unknown } | undefined;
    if (npc) {
      if (npc.id === identifier || npc.name === identifier ||
          (npc.name && npc.name.includes(identifier)) ||
          (npc.id && npc.id.includes(identifier))) {
        return {
          found: true,
          record: {
            nodeId: node.id,
            npc: { ...npc, id: npc.id || node.id, name: npc.name || "NPC" },
          },
        };
      }
    }
  }

  return { found: false, error: `当前区域没有找到 NPC「${identifier}」` };
}

// ============================================================
// 技能解析
// ============================================================

/**
 * 解析技能：先按 ID 查找，再按名称模糊匹配
 * 注意：只能查找玩家已学习且已装备的技能（battle context）
 */
export async function resolveSkill(
  identifier: string,
  playerId: string
): Promise<Resolved<{ id: string; name: string; damage: number; mpCost: number; element: string; cooldown?: number }>> {
  // 获取玩家装备的技能
  const player = await prisma.player.findUnique({
    where: { id: playerId },
    include: {
      skills: { where: { equipped: true } },
    },
  });

  if (!player || !player.skills || player.skills.length === 0) {
    return { found: false, error: "玩家没有装备任何技能" };
  }

  const skills = player.skills;

  // 1. 按 ID 精确查找
  let matched = skills.find((s) => s.id === identifier);
  
  // 2. 按名称精确查找
  if (!matched) {
    matched = skills.find((s) => s.name === identifier);
  }

  // 3. 按名称模糊查找
  if (!matched) {
    matched = skills.find((s) => s.name.includes(identifier) || identifier.includes(s.name));
  }

  if (matched) {
    return {
      found: true,
      record: {
        id: matched.id,
        name: matched.name,
        damage: matched.damage,
        mpCost: matched.mpCost,
        element: matched.element,
        cooldown: matched.cooldown,
      },
    };
  }

  return {
    found: false,
    error: `未找到技能「${identifier}」。可用技能: ${skills.map((s) => s.name).join("、")}`,
  };
}
