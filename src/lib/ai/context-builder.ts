/**
 * ChaosSaga - 上下文组装器
 *
 * 负责为每次 AI 请求组装完整上下文：
 *   System Prompt
 *   + 玩家状态摘要（属性/装备/位置）
 *   + 当前区域信息（节点列表/可达路径）
 *   + 活跃任务列表
 *   + 特殊效果监控
 *   + 最近 N 条对话历史
 *
 * Token 预算：
 *   System Prompt      ~800
 *   玩家状态           ~200
 *   区域信息           ~300
 *   活跃任务           ~200
 *   特殊效果           ~100
 *   对话历史           剩余（动态裁剪）
 */

import { prisma } from "@/lib/db/prisma";
import type { Prisma } from "@/generated/prisma/client";
import type { NormalizedMessage } from "./adapters/types";
import { calcFinalStats } from "@/lib/game/player-calc";
import type { Realm } from "@/lib/game/formulas";

// ============================================================
// 玩家状态摘要
// ============================================================

export async function getPlayerStateSummary(playerId: string): Promise<string> {
  const player = await prisma.player.findUnique({
    where: { id: playerId },
    include: {
      skills: { where: { equipped: true } },
      inventory: { where: { equipped: true } },
    },
  });

  if (!player) return "玩家不存在";

  const equippedSkills = player.skills
    .map((s) => `${s.name}[id:${s.id}](${s.element}, 伤害:${s.damage}, MP:${s.mpCost})`)
    .join("、");

  // 已装备的物品（武器/防具/饰品）
  const equippedGear = player.inventory
    .filter((i) => ["weapon", "armor", "accessory", "helmet", "boots"].includes(i.type))
    .map((i) => {
      const stats = i.stats as Record<string, number> | null;
      const statStr = stats
        ? Object.entries(stats).map(([k, v]) => `${k}:+${v}`).join(" ")
        : "";
      return `${i.name}(${i.type}${statStr ? ", " + statStr : ""})`;
    })
    .join("、");

  // 获取可读的位置名称
  const location = await getReadableLocation(player.currentAreaId, player.currentNodeId);

  return [
    `名称: ${player.name} | 种族: ${player.race} | 境界: ${player.realm} Lv.${player.level}`,
    `HP: ${player.hp}/${player.maxHp} | MP: ${player.mp}/${player.maxMp}`,
    `攻击: ${player.attack} | 防御: ${player.defense} | 速度: ${player.speed}`,
    `金币: ${player.gold} | 灵石: ${player.spiritStones} | 经验: ${player.exp}`,
    `已装备: ${equippedGear || "无"}`,
    `装备技能: ${equippedSkills || "无"}`,
    `位置: ${location}`,
  ].join("\n");
}

// ============================================================
// 可读位置
// ============================================================

async function getReadableLocation(
  areaId: string | null,
  nodeId: string | null
): Promise<string> {
  if (!areaId) return "未知区域（无当前区域）";

  const area = await prisma.area.findUnique({
    where: { id: areaId },
    select: { name: true },
  });

  if (!area) return "未知区域";

  if (!nodeId) return area.name;

  const node = await prisma.areaNode.findUnique({
    where: { id: nodeId },
    select: { name: true, type: true },
  });

  if (!node) return area.name;

  return `${area.name} - ${node.name}（${node.type}）`;
}

// ============================================================
// 区域信息
// ============================================================

export async function getAreaInfoSummary(playerId: string): Promise<string> {
  const player = await prisma.player.findUnique({
    where: { id: playerId },
    select: { currentAreaId: true, currentNodeId: true },
  });

  if (!player?.currentAreaId) return "玩家不在任何区域中";

  const area = await prisma.area.findUnique({
    where: { id: player.currentAreaId },
    select: {
      name: true,
      theme: true,
      recommendedLevel: true,
      description: true,
    },
  });

  if (!area) return "区域数据不存在";

  // 只查当前节点 + 相邻节点（不加载全区域节点列表）
  let currentNodeName = "未知";
  let currentNodeDesc = "";
  let adjacentStr = "无";

  if (player.currentNodeId) {
    const currentNode = await prisma.areaNode.findUnique({
      where: { id: player.currentNodeId },
      select: {
        name: true,
        type: true,
        description: true,
        connections: {
          select: { toNode: { select: { name: true, type: true } } },
        },
      },
    });
    if (currentNode) {
      currentNodeName = `${currentNode.name}（${currentNode.type}）`;
      currentNodeDesc = currentNode.description || "";
      adjacentStr = currentNode.connections
        .map((c) => `${c.toNode.name}(${c.toNode.type})`)
        .join("、") || "无";
    }
  }

  return [
    `区域: ${area.name}（${area.theme}，推荐Lv.${area.recommendedLevel}）`,
    `当前节点: ${currentNodeName} — ${currentNodeDesc}`,
    `可前往: ${adjacentStr}`,
  ].join("\n");
}

// ============================================================
// 活跃任务
// ============================================================

export async function getActiveQuestsSummary(playerId: string): Promise<string> {
  const activeQuests = await prisma.playerQuest.findMany({
    where: { playerId, status: "active" },
    include: { quest: true },
    take: 5,
  });

  if (activeQuests.length === 0) return "无";

  return activeQuests
    .map((pq) => {
      const objectives = pq.quest.objectives as Array<{
        description: string;
        required?: number;
      }>;
      const progress = pq.progress as Array<{
        currentCount: number;
        completed: boolean;
      }>;

      const objList = objectives
        .map((obj, i) => {
          const p = progress[i];
          const status = p?.completed ? "✅" : `${p?.currentCount || 0}/${obj.required || 1}`;
          return `  ${status} ${obj.description}`;
        })
        .join("\n");

      return `📜 ${pq.quest.name}（${pq.quest.type}）\n${objList}`;
    })
    .join("\n\n");
}

// ============================================================
// 活跃战斗
// ============================================================

export async function getActiveBattleSummary(playerId: string): Promise<string> {
  const battle = await prisma.battleState.findUnique({
    where: { playerId },
  });

  if (!battle || battle.status !== "active") return "无";

  const enemies = battle.enemies as Array<{
    name: string; level: number; hp: number; maxHp: number; element?: string;
  }>;

  const enemyList = enemies
    .map((e) => `${e.name}(Lv.${e.level}, HP:${e.hp}/${e.maxHp}, ${e.element || "none"})`)
    .join("、");

  return [
    `战斗ID: ${battle.id}`,
    `回合: ${battle.roundNumber}`,
    `敌人: ${enemyList}`,
  ].join("\n");
}

// ============================================================
// 特殊效果
// ============================================================

export async function getSpecialEffectsSummary(playerId: string): Promise<string> {
  const items = await prisma.inventoryItem.findMany({
    where: { playerId, specialEffect: { not: null } },
    select: { name: true, specialEffect: true },
  });

  if (items.length === 0) return "无";

  return items.map((i) => `- ${i.name}: ${i.specialEffect}`).join("\n");
}

// ============================================================
// 对话历史
// ============================================================

export async function getRecentHistory(
  playerId: string,
  limit: number = 20
): Promise<NormalizedMessage[]> {
  const records = await prisma.chatHistory.findMany({
    where: { playerId },
    orderBy: { createdAt: "desc" },
    take: limit,
  });

  // 倒序取出后反转为正序
  records.reverse();

  return records.map((r) => ({
    role: r.role as NormalizedMessage["role"],
    content: r.content,
    toolCallId: (r.metadata as Record<string, string> | null)?.toolCallId,
  }));
}

// ============================================================
// 完整上下文组装
// ============================================================

export interface GameContext {
  playerState: string;
  areaInfo: string;
  activeQuests: string;
  activeBattle: string;
  specialEffects: string;
  history: NormalizedMessage[];
}

/**
 * 一次性加载玩家的完整游戏上下文（优化版：减少数据库查询次数）
 * @param isBattle 战斗模式下跳过区域详情和特殊效果
 */
export async function buildGameContext(playerId: string, isBattle = false): Promise<GameContext> {
  // 优化：使用单次查询加载所有玩家相关数据（6+ 查询 → 3 查询）
  const [playerData, battleState, history] = await Promise.all([
    // 查询 1: 玩家 + 技能 + 背包 + 任务 + 区域信息（一次性加载）
    prisma.player.findUnique({
      where: { id: playerId },
      include: {
        skills: { where: { equipped: true } },
        inventory: true, // 加载全部背包（用于装备和特殊效果）
        quests: {
          where: { status: "active" },
          include: { quest: true },
          take: 5,
          orderBy: { createdAt: "desc" },
        },
      },
    }),
    // 查询 2: 战斗状态（独立表）
    prisma.battleState.findUnique({ where: { playerId } }),
    // 查询 3: 对话历史（独立表）
    prisma.chatHistory.findMany({
      where: { playerId },
      orderBy: { createdAt: "desc" },
      take: 20,
      select: { role: true, content: true, metadata: true },
    }),
  ]);

  if (!playerData) {
    throw new Error(`玩家不存在: ${playerId}`);
  }

  // 如果需要区域信息，额外加载（战斗模式跳过）
  let areaData = null;
  let currentNode = null;
  if (!isBattle && playerData.currentAreaId) {
    [areaData, currentNode] = await Promise.all([
      prisma.area.findUnique({
        where: { id: playerData.currentAreaId },
        select: { name: true, theme: true, recommendedLevel: true, description: true },
      }),
      playerData.currentNodeId
        ? prisma.areaNode.findUnique({
            where: { id: playerData.currentNodeId },
            select: {
              name: true,
              type: true,
              description: true,
              data: true, // 🆕 添加 data 字段以提取 NPCs 和商店信息
              connections: {
                select: { toNode: { select: { name: true, type: true } } },
              },
            },
          })
        : null,
    ]);
  }

  // ========== 区域任务隔离：只注入当前区域的活跃任务 ==========
  // 核心规则：A 区任务只在 A 区对话中可见，到 B 区后 AI 看不到 A 区任务
  const currentAreaId = playerData.currentAreaId;
  const currentAreaQuests = playerData.quests.filter((pq) => {
    // 玩家不在任何区域（理论上不应该发生），显示全部
    if (!currentAreaId) return true;

    // 方案1（推荐）：使用 Quest.areaId 字段判断（新创建的任务都有此字段）
    const questAreaId = (pq.quest as { areaId?: string | null }).areaId;
    if (questAreaId) {
      return questAreaId === currentAreaId;
    }

    // 方案2（兼容）：旧任务无 areaId，通过 progress 中的 acceptedAreaId 推断
    const acceptedAreaId = extractAcceptedAreaId(pq.progress);
    if (acceptedAreaId) {
      return acceptedAreaId === currentAreaId;
    }

    // 方案3（最终兜底）：无法判断区域的旧任务，默认不显示，防止跨区域泄漏
    // 如果旧任务需要显示，可通过 /gm 指令手动处理
    return false;
  });

  const npcLocations: Record<string, string> = {};

  // 构建摘要字符串（保持原有格式）
  const playerState = buildPlayerStateSummary(playerData, areaData, currentNode);
  const areaInfo = isBattle ? "战斗中" : buildAreaInfoSummary(areaData, currentNode);
  const activeQuests = buildActiveQuestsSummary(currentAreaQuests, npcLocations);
  const activeBattle = buildActiveBattleSummary(battleState);
  const specialEffects = isBattle ? "无" : buildSpecialEffectsSummary(playerData.inventory);
  const historyMessages = history.reverse().map((r) => ({
    role: r.role as NormalizedMessage["role"],
    content: r.content,
    toolCallId: (r.metadata as Record<string, string> | null)?.toolCallId,
  }));

  return {
    playerState,
    areaInfo,
    activeQuests,
    activeBattle,
    specialEffects,
    history: historyMessages,
  };
}

// ============================================================
// 内部辅助函数：从已加载数据构建摘要（避免重复查询）
// ============================================================

type PlayerWithIncludes = Prisma.PlayerGetPayload<{
  include: {
    skills: { where: { equipped: true } };
    inventory: true;
    quests: {
      where: { status: "active" };
      include: { quest: true };
    };
  };
}>;

function buildPlayerStateSummary(
  player: PlayerWithIncludes,
  area: { name: string } | null,
  node: { name: string; type: string } | null
): string {
  const equippedSkills = player.skills
    .map((s) => `${s.name}[id:${s.id}](${s.element}, 伤害:${s.damage}, MP:${s.mpCost})`)
    .join("、");

  const equippedItems = player.inventory
    .filter((i) => i.equipped)
    .map((i) => ({ stats: i.stats as Record<string, unknown> | null }));

  const finalStats = calcFinalStats(player.level, player.realm as Realm, equippedItems);

  const equippedGear = player.inventory
    .filter((i) => i.equipped && ["weapon", "armor", "accessory", "helmet", "boots"].includes(i.type))
    .map((i) => {
      const stats = i.stats as Record<string, number> | null;
      const statStr = stats
        ? Object.entries(stats).map(([k, v]) => `${k}:+${v}`).join(" ")
        : "";
      return `${i.name}(${i.type}${statStr ? ", " + statStr : ""})`;
    })
    .join("、");

  const location = area
    ? node
      ? `${area.name} - ${node.name}（${node.type}）`
      : area.name
    : "未知区域";

  return [
    `名称: ${player.name} | 种族: ${player.race} | 境界: ${player.realm} Lv.${player.level}`,
    `HP: ${player.hp}/${finalStats.maxHp} | MP: ${player.mp}/${finalStats.maxMp}`,
    `攻击: ${finalStats.attack} | 防御: ${finalStats.defense} | 速度: ${finalStats.speed}`,
    `金币: ${player.gold} | 灵石: ${player.spiritStones} | 经验: ${player.exp}`,
    `已装备: ${equippedGear || "无"}`,
    `装备技能: ${equippedSkills || "无"}`,
    `位置: ${location}`,
  ].join("\n");
}

function buildAreaInfoSummary(
  area: { name: string; theme: string; recommendedLevel: number; description: string } | null,
  node: {
    name: string;
    type: string;
    description: string;
    data?: unknown;
    connections: Array<{ toNode: { name: string; type: string } }>;
  } | null
): string {
  if (!area) return "玩家不在任何区域中";

  const currentNodeName = node ? `${node.name}（${node.type}）` : "未知";
  const currentNodeDesc = node?.description || "";
  const adjacentStr = node
    ? node.connections.map((c) => `${c.toNode.name}(${c.toNode.type})`).join("、") || "无"
    : "无";

  // 🆕 提取当前节点的 NPCs 和商店信息
  let npcInfo = "";
  if (node?.data) {
    const nodeData = node.data as Record<string, unknown>;

    // NPCs 列表
    const npcs = nodeData.npcs as Array<{ id?: string; name?: string; role?: string }> | undefined;
    if (npcs && Array.isArray(npcs) && npcs.length > 0) {
      const npcList = npcs.map(npc => {
        const roleDesc = npc.role ? `（${npc.role}）` : "";
        return `  - ${npc.name}${roleDesc}`;
      }).join("\n");
      npcInfo += `\n可交互 NPC:\n${npcList}`;
    }

    // 商店物品
    const shopItems = nodeData.shopItems as Array<{ name: string; price: number; type: string }> | undefined;
    if (shopItems && Array.isArray(shopItems) && shopItems.length > 0) {
      const itemList = shopItems.slice(0, 5).map(item =>
        `  - ${item.name}（${item.type}，${item.price}金币）`
      ).join("\n");
      const moreItems = shopItems.length > 5 ? `\n  ...还有${shopItems.length - 5}件商品` : "";
      npcInfo += `\n商店物品:\n${itemList}${moreItems}`;
    }
  }

  return [
    `区域: ${area.name}（${area.theme}，推荐Lv.${area.recommendedLevel}）`,
    `当前节点: ${currentNodeName} — ${currentNodeDesc}`,
    `可前往: ${adjacentStr}`,
    npcInfo,
  ].filter(s => s).join("\n");
}

function buildActiveQuestsSummary(
  quests: Array<{
    quest: {
      name: string;
      type: string;
      objectives: unknown;
      npcId?: string | null;
    };
    progress: unknown;
  }>,
  _npcLocations: Record<string, string> = {}
): string {
  if (quests.length === 0) return "无（当前区域没有进行中的任务）";

  return quests
    .map((pq) => {
      const objectives = pq.quest.objectives as Array<{
        description: string;
        required?: number;
      }>;
      const progress = pq.progress as Array<{
        currentCount: number;
        completed: boolean;
      }>;

      const objList = objectives
        .map((obj, i) => {
          const p = progress[i];
          const status = p?.completed ? "✅" : `${p?.currentCount || 0}/${obj.required || 1}`;
          return `  ${status} ${obj.description}`;
        })
        .join("\n");

      return `📜 ${pq.quest.name}（${pq.quest.type}）\n${objList}`;
    })
    .join("\n\n");
}

function extractAcceptedAreaId(progress: unknown): string | null {
  if (!Array.isArray(progress)) return null;

  for (const entry of progress) {
    if (
      entry &&
      typeof entry === "object" &&
      "acceptedAreaId" in entry &&
      typeof (entry as { acceptedAreaId?: unknown }).acceptedAreaId === "string"
    ) {
      return (entry as { acceptedAreaId: string }).acceptedAreaId;
    }
  }

  return null;
}

function buildActiveBattleSummary(
  battle: { id: string; roundNumber: number; enemies: unknown; status: string } | null
): string {
  if (!battle || battle.status !== "active") return "无";

  const enemies = battle.enemies as Array<{
    name: string;
    level: number;
    hp: number;
    maxHp: number;
    element?: string;
  }>;

  const enemyList = enemies
    .map((e) => `${e.name}(Lv.${e.level}, HP:${e.hp}/${e.maxHp}, ${e.element || "none"})`)
    .join("、");

  return [`战斗ID: ${battle.id}`, `回合: ${battle.roundNumber}`, `敌人: ${enemyList}`].join("\n");
}

function buildSpecialEffectsSummary(
  inventory: Array<{ name: string; specialEffect: string | null }>
): string {
  const items = inventory.filter((i) => i.specialEffect);
  if (items.length === 0) return "无";
  return items.map((i) => `- ${i.name}: ${i.specialEffect}`).join("\n");
}


