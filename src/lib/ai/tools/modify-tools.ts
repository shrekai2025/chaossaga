/**
 * 修改类工具 - 直接修改游戏数据（GM模式、非标准效果）
 */

import type { NormalizedTool } from "../adapters/types";
import { prisma } from "@/lib/db/prisma";

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
  // send_narrative: removed (LLM outputs narrative text directly)
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

  return {
    success: true,
    data: { addedItems: added },
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
