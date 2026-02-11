/**
 * 生成类工具 - AI 动态生成游戏内容（区域、任务等）
 */

import type { NormalizedTool } from "../adapters/types";
import { prisma } from "@/lib/db/prisma";
import { clearActiveBattle } from "./action-tools";
import { resolveQuest } from "./resolve-id";

// ============================================================
// 工具定义
// ============================================================

export const generateToolDefinitions: NormalizedTool[] = [
  {
    name: "generate_area",
    description:
      "根据玩家描述生成一个完整的冒险区域（5-8个节点），写入数据库并将玩家传送至入口。" +
      "节点的 data 字段必须按类型填写标准结构，详见 System Prompt 中的【区域生成格式规范】。",
    parameters: {
      type: "object",
      properties: {
        name: { type: "string", description: "区域名称" },
        description: { type: "string", description: "区域整体描述（50-100字）" },
        theme: { type: "string", description: "主题标签（如 ocean、forest、desert、cave、city）" },
        recommendedLevel: { type: "number", description: "推荐等级，匹配当前玩家等级" },
        nodes: {
          type: "array",
          description: "节点列表（5-8个），每个节点的 data 字段按 type 不同有不同结构",
          items: {
            type: "object",
            properties: {
              id: { type: "string", description: "节点逻辑ID（如 entrance、boss-lair）" },
              name: { type: "string", description: "节点名称" },
              type: {
                type: "string",
                enum: ["safe", "battle", "npc", "boss", "event", "shop"],
                description: "safe=安全区, battle=战斗区, npc=NPC交互, boss=BOSS, event=事件, shop=商店",
              },
              description: { type: "string", description: "节点环境描述（30-60字，注重感官描写）" },
              data: {
                type: "object",
                description:
                  "节点数据，按 type 填写：" +
                  "battle → { enemyTemplates: [{ name, level, element, minCount, maxCount, description }] }；" +
                  "npc → { npc: { id, name, role, personality, greeting, dialogTopics } }；" +
                  "shop → { npc: { id, name, role, greeting }, shopItems: [{ name, type, quality, price, stats, description }] }；" +
                  "boss → { boss: { name, level, element, description, hp, attack, defense, speed, skills: [{ name, damage, element, type: attack|heal|buff|aoe, description }], phases: [{ hpThreshold, unlockedSkills, description }], drops: [{ name, type, quality, stats?, chance, skillData?: { element, damage, mpCost, cooldown, effect? } }] } }。" +
                  "⚠️ BOSS 的 drops 数组中**必须包含至少一个 type='skill' 的技能掉落**，该技能必须与区域主题相关（如 ocean→water, forest→wind/earth, desert→fire/earth, cave→earth/dark）；" +
                  "event → { events: [{ id, name, type, description, reward?, loot? }] }；" +
                  "safe → { hints?: string[] }",
              },
            },
            required: ["id", "name", "type", "description", "data"],
          },
        },
        connections: {
          type: "array",
          items: { type: "array", items: { type: "string" } },
          description: '双向连接 [["node-a","node-b"], ...]，第一个节点为入口',
        },
      },
      required: ["name", "description", "theme", "recommendedLevel", "nodes", "connections"],
    },
  },
  {
    name: "create_quest",
    description:
      "在NPC对话中动态创建一个任务。可以是采集、击杀、解谜、护送、探索类型",
    parameters: {
      type: "object",
      properties: {
        npcId: { type: "string", description: "发布任务的NPC" },
        name: { type: "string" },
        description: { type: "string" },
        type: { type: "string", enum: ["fetch", "kill", "riddle", "escort", "explore"] },
        objectives: {
          type: "array",
          items: {
            type: "object",
            properties: {
              description: { type: "string" },
              targetType: { type: "string" },
              targetId: { type: "string" },
              targetCount: { type: "number" },
            },
          },
        },
        rewards: {
          type: "object",
          properties: {
            exp: { type: "number" },
            gold: { type: "number" },
            spiritStones: { type: "number", description: "灵石奖励" },
            items: { type: "array", items: { type: "object" } },
            skillUnlock: { type: "string" },
          },
        },
        specialCondition: { type: "string", description: "非标准完成条件" },
      },
      required: ["name", "description", "type", "objectives", "rewards"],
    },
  },
  {
    name: "update_quest",
    description: "更新任务进度。当玩家完成某个任务目标时调用",
    parameters: {
      type: "object",
      properties: {
        questId: { type: "string" },
        objectiveIndex: { type: "number", description: "目标索引" },
        incrementCount: { type: "number", description: "增加计数", default: 1 },
        completed: { type: "boolean", description: "是否直接标记完成" },
      },
      required: ["questId"],
    },
  },
];

// ============================================================
// 工具执行
// ============================================================

export async function generateArea(
  args: Record<string, unknown>,
  playerId: string
) {
  // ---- 输入校验：防止 AI 传入错误参数导致崩溃 ----
  const name = args.name as string | undefined;
  const description = args.description as string | undefined;
  const theme = args.theme as string | undefined;
  const recommendedLevel = args.recommendedLevel as number | undefined;
  const nodesInput = args.nodes as Array<{
    id: string; name: string; type: string; description: string;
    data?: Record<string, unknown>;
  }> | undefined;
  const connections = args.connections as string[][] | undefined;

  if (!name || !description || !theme) {
    return {
      success: false,
      error: "generate_area 缺少必填参数。需要: name(区域名), description(描述), theme(主题), recommendedLevel(推荐等级), nodes(节点数组), connections(连接关系)。请按正确格式重新调用。",
    };
  }
  if (!nodesInput || !Array.isArray(nodesInput) || nodesInput.length < 2) {
    return {
      success: false,
      error: "generate_area 的 nodes 必须是包含至少 2 个节点的数组。每个节点需要 id, name, type, description, data 字段。",
    };
  }
  if (!connections || !Array.isArray(connections) || connections.length < 1) {
    return {
      success: false,
      error: "generate_area 的 connections 必须是连接对数组，如 [[\"entrance\",\"forest\"], ...]",
    };
  }

  // 校验每个节点的基本字段
  for (const n of nodesInput) {
    if (!n.id || !n.name || !n.type) {
      return {
        success: false,
        error: `节点缺少必填字段 (id/name/type)。问题节点: ${JSON.stringify(n).slice(0, 100)}`,
      };
    }
  }

  const level = recommendedLevel ?? 1;

  // 创建区域
  const area = await prisma.area.create({
    data: {
      name,
      description,
      theme,
      recommendedLevel: level,
      createdByPlayer: playerId,
    },
  });

  // 创建节点（直接存储 AI 提供的 data 字段，格式与种子数据一致）
  const nodeIdMap: Record<string, string> = {};
  for (let i = 0; i < nodesInput.length; i++) {
    const n = nodesInput[i];
    const node = await prisma.areaNode.create({
      data: {
        areaId: area.id,
        name: n.name,
        type: n.type,
        description: n.description,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        data: (n.data ?? {}) as any,
        posX: i % 4,
        posY: Math.floor(i / 4),
      },
    });
    nodeIdMap[n.id] = node.id;
  }

  // 创建连接
  for (const [fromLogical, toLogical] of connections) {
    const fromId = nodeIdMap[fromLogical];
    const toId = nodeIdMap[toLogical];
    if (fromId && toId) {
      await prisma.areaNodeConnection.create({
        data: { fromId, toId },
      });
      // 双向连接
      await prisma.areaNodeConnection.create({
        data: { fromId: toId, toId: fromId },
      }).catch(() => { /* 忽略重复 */ });
    }
  }

  // 设置玩家位置为区域入口
  const entranceLogical = nodesInput[0]?.id;
  const entranceId = entranceLogical ? nodeIdMap[entranceLogical] : undefined;

  // 生成新区域 = 区域转移 → 自动清除活跃战斗
  const escapedBattle = await clearActiveBattle(playerId);

  if (entranceId) {
    await prisma.player.update({
      where: { id: playerId },
      data: { currentAreaId: area.id, currentNodeId: entranceId },
    });

    await prisma.playerArea.create({
      data: {
        playerId,
        areaId: area.id,
        exploredNodes: JSON.stringify([entranceId]),
      },
    });
  }

  return {
    success: true,
    data: {
      areaId: area.id,
      areaName: name,
      nodeCount: nodesInput.length,
      entranceNode: nodesInput[0]?.name,
      nodes: nodesInput.map((n) => ({
        logicalId: n.id,
        actualId: nodeIdMap[n.id],
        name: n.name,
        type: n.type,
      })),
      ...(escapedBattle ? { escapedBattle: `逃离了与 ${escapedBattle.enemyNames.join("、")} 的战斗` } : {}),
    },
    stateUpdate: {
      location: `${name} - ${nodesInput[0]?.name || "入口"}`,
    },
  };
}

export async function createQuest(
  args: Record<string, unknown>,
  playerId: string
) {
  const name = args.name as string;
  const description = args.description as string;
  const type = args.type as string;
  const objectives = args.objectives as Array<Record<string, unknown>>;
  const rewards = args.rewards as Record<string, unknown>;
  const specialCondition = args.specialCondition as string | undefined;

  const quest = await prisma.quest.create({
    data: {
      name,
      description,
      type,
      npcId: args.npcId as string | undefined,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      objectives: objectives as any,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      rewards: rewards as any,
      specialCondition,
    },
  });

  // 自动为玩家接取任务
  const initialProgress = objectives.map(() => ({ currentCount: 0, completed: false }));
  await prisma.playerQuest.create({
    data: {
      playerId,
      questId: quest.id,
      status: "active",
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      progress: initialProgress as any,
    },
  });

  return {
    success: true,
    data: {
      questId: quest.id,
      questName: name,
      type,
      objectives: objectives.map((o) => o.description),
      rewards,
    },
  };
}

export async function updateQuest(
  args: Record<string, unknown>,
  playerId: string
) {
  const questId = args.questId as string;
  const objectiveIndex = args.objectiveIndex as number | undefined;
  const incrementCount = (args.incrementCount as number) ?? 1;
  const completed = args.completed as boolean | undefined;

  // 使用集中式解析器查找任务（支持 ID / 精确名称 / 模糊名称）
  const resolved = await resolveQuest(questId, playerId);
  if (!resolved.found) return { success: false, error: resolved.error };
  const pq = resolved.record;

  const progress = pq.progress as Array<{ currentCount: number; completed: boolean }>;
  const objectives = pq.quest.objectives as Array<{ targetCount?: number }>;

  if (completed) {
    // 直接完成任务
    await prisma.playerQuest.update({
      where: { id: pq.id },
      data: { status: "completed" },
    });

    // 发放奖励
    const rewards = pq.quest.rewards as {
      exp?: number; gold?: number; spiritStones?: number;
      items?: Array<Record<string, unknown>>;
    };
    if (rewards.exp || rewards.gold || rewards.spiritStones) {
      await prisma.player.update({
        where: { id: playerId },
        data: {
          exp: { increment: rewards.exp ?? 0 },
          gold: { increment: rewards.gold ?? 0 },
          spiritStones: { increment: rewards.spiritStones ?? 0 },
        },
      });
    }

    // 发放奖励物品到背包
    if (rewards.items && rewards.items.length > 0) {
      for (const ri of rewards.items) {
        await prisma.inventoryItem.create({
          data: {
            playerId,
            name: (ri.name as string) || "未知物品",
            type: (ri.type as string) || "material",
            quality: (ri.quality as string) || "common",
            quantity: (ri.quantity as number) || 1,
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            stats: ri.stats ? (ri.stats as any) : undefined,
            specialEffect: (ri.description as string) || null,
          },
        });
      }
    }

    // 读取更新后的玩家数据，发送绝对值 stateUpdate（避免前端误将增量当作绝对值）
    const updatedPlayer = await prisma.player.findUnique({
      where: { id: playerId },
      select: { exp: true, gold: true, spiritStones: true, level: true },
    });

    return {
      success: true,
      data: { questName: pq.quest.name, status: "completed", rewards },
      stateUpdate: updatedPlayer
        ? {
            exp: updatedPlayer.exp,
            gold: updatedPlayer.gold,
            spiritStones: updatedPlayer.spiritStones,
            level: updatedPlayer.level,
          }
        : {},
    };
  }

  if (objectiveIndex !== undefined && progress[objectiveIndex]) {
    progress[objectiveIndex].currentCount += incrementCount;
    const target = objectives[objectiveIndex]?.targetCount ?? 1;
    if (progress[objectiveIndex].currentCount >= target) {
      progress[objectiveIndex].completed = true;
    }

    const allDone = progress.every((p) => p.completed);

    await prisma.playerQuest.update({
      where: { id: pq.id },
      data: {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        progress: progress as any,
        status: allDone ? "completed" : "active",
      },
    });

    return {
      success: true,
      data: {
        questName: pq.quest.name,
        objectiveIndex,
        progress: progress[objectiveIndex],
        allCompleted: allDone,
      },
    };
  }

  return { success: false, error: "未指定有效操作" };
}
