/**
 * 修改类工具 - 直接修改游戏数据（GM模式、非标准效果）
 */

import type { NormalizedTool } from "../adapters/types";
import { prisma } from "@/lib/db/prisma";
import { logPlayerAction } from "@/lib/game/logger";

// ============================================================
// 工具定义
// ============================================================

export const modifyToolDefinitions: NormalizedTool[] = [
  {
    name: "modify_player_data",
    description:
      "直接修改玩家数据。用于GM模式和非标准效果执行。可修改任何玩家属性（等级、HP、MP、金币、经验等）",
    parameters: {
      type: "object",
      properties: {
        modifications: {
          type: "array",
          items: {
            type: "object",
            properties: {
              field: {
                type: "string",
                description: "要修改的字段: level, hp, mp, maxHp, maxMp, attack, defense, speed, gold, spiritStones, exp, realm (ocean/land/barren/planetary/stellar/galactic/transcend/primordial/ethereal/origin)",
              },
              value: { type: "number", description: "值" },
              operation: {
                type: "string",
                enum: ["set", "add", "subtract", "multiply"],
                description: "操作类型，默认set",
              },
            },
            required: ["field", "value"],
          },
        },
        reason: { type: "string", description: "修改原因（用于日志）" },
        recalculate: {
          type: "boolean",
          description: "是否重新计算派生属性",
          default: true,
        },
      },
      required: ["modifications", "reason"],
    },
  },
  {
    name: "add_item",
    description:
      "向玩家背包添加物品。用于奖励发放、任务奖励、GM模式",
    parameters: {
      type: "object",
      properties: {
        items: {
          type: "array",
          items: {
            type: "object",
            properties: {
              name: { type: "string" },
              type: {
                type: "string",
                enum: ["weapon", "armor", "accessory", "consumable", "material", "quest_item", "collectible"],
              },
              quality: {
                type: "string",
                enum: ["common", "uncommon", "rare", "epic", "legendary"],
              },
              quantity: { type: "number", default: 1 },
              stats: { type: "object", description: "装备属性" },
              specialEffect: { type: "string", description: "非标准特殊效果描述" },
            },
            required: ["name", "type"],
          },
        },
      },
      required: ["items"],
    },
  },
  {
    name: "modify_enemy_hp",
    description:
      "GM指令：修改当前战斗中敌人的当前HP。可按敌人索引或名称定位，支持 set/add/subtract 操作",
    parameters: {
      type: "object",
      properties: {
        battleId: { type: "string", description: "战斗ID（可选，省略时自动使用玩家当前活跃战斗）" },
        enemyIndex: { type: "number", description: "目标敌人的索引（从0开始）" },
        enemyName: { type: "string", description: "目标敌人的名称（支持包含匹配）" },
        value: { type: "number", description: "HP数值（结合 operation 使用）" },
        operation: {
          type: "string",
          enum: ["set", "add", "subtract"],
          description: "操作类型，默认 set",
        },
        reason: { type: "string", description: "修改原因（用于日志）" },
      },
      required: ["value"],
    },
  },
  // send_narrative: removed (LLM outputs narrative text directly)
  {
    name: "abandon_quest",
    description: "GM指令：强制放弃任务。仅在GM模式或玩家明确要求强制放弃时使用。放弃后可重新在NPC处接取。",
    parameters: {
      type: "object",
      properties: {
        questId: { type: "string", description: "任务ID 或 任务名称" },
        reason: { type: "string", description: "放弃原因" },
      },
      required: ["questId"],
    },
  },
];

// ============================================================
// 工具执行
// ============================================================

/** 允许修改的玩家字段白名单 */
const MODIFIABLE_FIELDS = new Set([
  "level", "hp", "mp", "maxHp", "maxMp",
  "attack", "defense", "speed",
  "gold", "spiritStones", "exp", "realm",
]);

export async function modifyPlayerData(
  args: Record<string, unknown>,
  playerId: string
) {
  const modifications = args.modifications as Array<{
    field: string; value: number | string; operation?: string;
  }> | undefined;
  const reason = args.reason as string | undefined;

  if (!modifications || !Array.isArray(modifications) || modifications.length === 0) {
    return { success: false, error: "缺少 modifications 数组参数" };
  }
  if (!reason) {
    return { success: false, error: "缺少 reason 参数（修改原因）" };
  }

  const player = await prisma.player.findUnique({ where: { id: playerId } });
  if (!player) return { success: false, error: "玩家不存在" };

  const updateData: Record<string, unknown> = {};
  const changes: Array<{ field: string; from: unknown; to: unknown }> = [];

  for (const mod of modifications) {
    if (!MODIFIABLE_FIELDS.has(mod.field)) {
      continue; // 跳过不允许修改的字段
    }

    const currentValue = (player as Record<string, unknown>)[mod.field];
    const op = mod.operation || "set";
    let newValue: unknown;

    if (mod.field === "realm") {
      // realm 是字符串，只支持 set
      newValue = mod.value;
    } else {
      const numCurrent = typeof currentValue === "number" ? currentValue : 0;
      const numValue = typeof mod.value === "number" ? mod.value : parseFloat(String(mod.value));

      switch (op) {
        case "add":
          newValue = numCurrent + numValue;
          break;
        case "subtract":
          newValue = numCurrent - numValue;
          break;
        case "multiply":
          newValue = Math.floor(numCurrent * numValue);
          break;
        default:
          newValue = numValue;
      }
    }

    updateData[mod.field] = newValue;
    changes.push({ field: mod.field, from: currentValue, to: newValue });
  }

  if (Object.keys(updateData).length === 0) {
    return { success: false, error: "没有有效的修改" };
  }

  await prisma.player.update({
    where: { id: playerId },
    data: updateData,
  });

  // 构造状态更新
  const stateUpdate: Record<string, unknown> = {};
  for (const change of changes) {
    stateUpdate[change.field] = change.to;
  }

  // 记录日志
  const changeSummary = changes.map(c => `${c.field}: ${c.from} -> ${c.to}`).join(", ");
  await logPlayerAction(
    playerId,
    "misc", // 使用 misc 类型，因为通常由于 GM 或特殊事件触发
    `数据变更 (${reason}): ${changeSummary}`,
    { reason, changes: stateUpdate }
  );

  return {
    success: true,
    data: { reason, changes },
    stateUpdate,
  };
}

export async function addItem(
  args: Record<string, unknown>,
  playerId: string
) {
  const items = args.items as Array<{
    name: string; type: string; quality?: string; quantity?: number;
    stats?: Record<string, unknown>; specialEffect?: string;
  }> | undefined;

  if (!items || !Array.isArray(items) || items.length === 0) {
    return { success: false, error: "缺少 items 数组参数" };
  }

  const added: Array<{ name: string; quantity: number }> = [];

  for (const item of items) {
    await prisma.inventoryItem.create({
      data: {
        playerId,
        name: item.name,
        type: item.type,
        quality: item.quality || "common",
        quantity: item.quantity || 1,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        stats: (item.stats ?? undefined) as any,
        specialEffect: item.specialEffect,
      },
    });
    added.push({ name: item.name, quantity: item.quantity || 1 });
  }

  // 记录日志
  const itemNames = added.map(i => `${i.name} x${i.quantity}`).join(", ");
  await logPlayerAction(
    playerId,
    "reward", // add_item 通常用于奖励
    `获得物品: ${itemNames}`,
    { items: added }
  );

  return {
    success: true,
    data: { addedItems: added },
  };
}

interface BattleEnemySnapshot {
  name: string;
  hp: number;
  maxHp: number;
}

export async function modifyEnemyHp(
  args: Record<string, unknown>,
  playerId: string
) {
  const battleId = args.battleId as string | undefined;
  const enemyIndex = args.enemyIndex as number | undefined;
  const enemyName = args.enemyName as string | undefined;
  const operation = (args.operation as string | undefined) || "set";
  const reason = (args.reason as string | undefined) || "GM调整敌人血量";
  const rawValue = args.value;
  const value =
    typeof rawValue === "number" ? rawValue : Number.parseFloat(String(rawValue ?? ""));

  if (!Number.isFinite(value)) {
    return { success: false, error: "缺少或无效的 value 参数" };
  }

  const battle = battleId
    ? await prisma.battleState.findUnique({ where: { id: battleId } })
    : await prisma.battleState.findFirst({
        where: { playerId, status: "active" },
      });

  if (!battle || battle.playerId !== playerId) {
    return { success: false, error: "未找到该玩家的战斗记录" };
  }
  if (battle.status !== "active") {
    return { success: false, error: `战斗已结束: ${battle.status}` };
  }

  const enemies = (battle.enemies as unknown as BattleEnemySnapshot[]) ?? [];
  if (!Array.isArray(enemies) || enemies.length === 0) {
    return { success: false, error: "战斗中没有可修改的敌人" };
  }

  let targetIndex = -1;
  if (typeof enemyIndex === "number" && Number.isInteger(enemyIndex)) {
    if (enemyIndex < 0 || enemyIndex >= enemies.length) {
      return { success: false, error: `enemyIndex 越界，当前敌人数: ${enemies.length}` };
    }
    targetIndex = enemyIndex;
  } else if (enemyName && enemyName.trim()) {
    const needle = enemyName.trim().toLowerCase();
    targetIndex = enemies.findIndex((e) => e.name.toLowerCase().includes(needle));
    if (targetIndex < 0) {
      return { success: false, error: `未找到名称匹配「${enemyName}」的敌人` };
    }
  } else {
    targetIndex = enemies.findIndex((e) => e.hp > 0);
    if (targetIndex < 0) targetIndex = 0;
  }

  const target = enemies[targetIndex];
  const currentHp = typeof target.hp === "number" ? target.hp : 0;
  const maxHp =
    typeof target.maxHp === "number" && target.maxHp > 0 ? target.maxHp : Math.max(1, currentHp);

  let nextHp: number;
  switch (operation) {
    case "add":
      nextHp = currentHp + value;
      break;
    case "subtract":
      nextHp = currentHp - value;
      break;
    default:
      nextHp = value;
  }
  const clampedHp = Math.max(0, Math.min(maxHp, Math.floor(nextHp)));
  target.hp = clampedHp;
  enemies[targetIndex] = target;

  await prisma.battleState.update({
    where: { id: battle.id },
    data: {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      enemies: enemies as any,
    },
  });

  await logPlayerAction(
    playerId,
    "battle",
    `GM修改敌人血量：${target.name} HP ${currentHp} -> ${clampedHp} (${operation} ${value})`,
    {
      battleId: battle.id,
      enemyIndex: targetIndex,
      enemyName: target.name,
      fromHp: currentHp,
      toHp: clampedHp,
      operation,
      value,
      reason,
    }
  );

  return {
    success: true,
    data: {
      battleId: battle.id,
      enemyIndex: targetIndex,
      enemyName: target.name,
      fromHp: currentHp,
      toHp: clampedHp,
      maxHp,
      operation,
      value,
      reason,
    },
  };
}

export async function sendNarrative(args: Record<string, unknown>) {
  // 纯文本工具，无副作用
  return {
    success: true,
    data: {
      text: args.text as string,
      type: (args.type as string) || "narrative",
    },
  };
}

export async function abandonQuest(
  args: Record<string, unknown>,
  playerId: string
) {
  const questId = args.questId as string;
  const reason = args.reason as string | undefined;

  if (!questId) return { success: false, error: "未指定任务" };

  // 1. 查找任务（支持模糊匹配）
  // 这里的 resolveQuest 需要从 generate-tools 导入，或者我们简单实现一个查找
  // 由于 modify-tools.ts 没有导入 resolveQuest，我们这里先手动查找
  // 为了复用逻辑，最好是从 resolve-id 导入，但当前文件头没有导入。
  // 让我们查看文件头引用，如果有必要添加导入。
  
  // 简单查找逻辑：
  const targetQuestId = questId;
  const directMatch = await prisma.playerQuest.findFirst({
    where: { 
      playerId, 
      questId: targetQuestId 
    },
    include: { quest: true }
  });

  let pq = directMatch;

  if (!pq) {
    // 尝试按名称查找
    pq = await prisma.playerQuest.findFirst({
      where: {
        playerId,
        quest: { name: { contains: questId } }
      },
      include: { quest: true }
    });
  }

  if (!pq) {
    return { success: false, error: "未找到该任务，或未接取" };
  }

  // 2. 删除任务记录
  await prisma.playerQuest.delete({
    where: { id: pq.id }
  });

  // 3. 记录日志
  await logPlayerAction(
    playerId,
    "misc",
    `放弃任务：${pq.quest.name} ${(reason ? "原因: " + reason : "")}`,
    { questId: pq.questId, reason }
  );

  return {
    success: true,
    data: {
      action: "abandon_quest",
      questName: pq.quest.name,
      message: "任务已放弃，相关进度已清除。",
    },
  };
}
