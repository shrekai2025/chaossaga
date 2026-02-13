/**
 * 环境交互工具 - 探索模式下的环境交互（拾取、使用、检查、破坏）
 */

import type { NormalizedTool } from "../adapters/types";
import { prisma } from "@/lib/db/prisma";
import { validateItemGift, type ItemProposal } from "../guardrail";
import { resolveItem } from "./resolve-id";
import { logPlayerAction } from "@/lib/game/logger";
import type { Realm } from "@/lib/game/formulas";

// ============================================================
// 工具定义
// ============================================================

export const environmentToolDefinitions: NormalizedTool[] = [
  {
    name: "interact_environment",
    description:
      "探索环境交互：拾取(pickup)、使用物品(use)、检查(examine)、破坏(destroy)环境物品。" +
      "拾取的物品品质上限为 uncommon。不要编造'物品碎了/消失了'来拒绝合理的拾取请求。",
    parameters: {
      type: "object",
      properties: {
        action: {
          type: "string",
          enum: ["pickup", "use", "examine", "destroy"],
          description: "交互类型：pickup=拾取, use=使用背包物品, examine=检查, destroy=破坏",
        },
        description: {
          type: "string",
          description: "交互描述，如'捡起地上的翅翼'、'使用火把点燃篝火'",
        },
        itemToAdd: {
          type: "object",
          description: "拾取时添加到背包的物品（action=pickup 时必填）",
          properties: {
            name: { type: "string" },
            type: {
              type: "string",
              enum: ["weapon", "armor", "accessory", "consumable", "material", "quest_item", "collectible"],
            },
            quality: {
              type: "string",
              enum: ["common", "uncommon"],
              description: "环境拾取品质上限为 uncommon",
            },
            quantity: { type: "number", default: 1 },
            statsJson: { type: "string", description: "物品属性JSON字符串，如 {\"hpRestore\":20} 或 {\"attack\":3}" },
            specialEffect: { type: "string" },
          },
          required: ["name", "type"],
        },
        itemToConsume: {
          type: "string",
          description: "使用的背包物品ID或名称（action=use 时必填）",
        },
        effectDescription: {
          type: "string",
          description: "效果描述（纯叙事辅助，不改变数值）",
        },
      },
      required: ["action", "description"],
    },
  },
];

// ============================================================
// 工具执行
// ============================================================

export async function interactEnvironment(
  args: Record<string, unknown>,
  playerId: string
) {
  const action = args.action as string | undefined;
  const description = args.description as string | undefined;
  const itemToConsume = args.itemToConsume as string | undefined;
  const effectDescription = args.effectDescription as string | undefined;

  // 解析 itemToAdd，将 statsJson 转换为 stats 对象
  let itemToAdd: ItemProposal | undefined;
  const rawItemToAdd = args.itemToAdd as Record<string, unknown> | undefined;
  if (rawItemToAdd) {
    itemToAdd = {
      name: rawItemToAdd.name as string,
      type: rawItemToAdd.type as string,
      quality: rawItemToAdd.quality as string | undefined,
      quantity: rawItemToAdd.quantity as number | undefined,
      specialEffect: rawItemToAdd.specialEffect as string | undefined,
      stats: undefined,
    };
    if (rawItemToAdd.statsJson && typeof rawItemToAdd.statsJson === "string") {
      try { itemToAdd.stats = JSON.parse(rawItemToAdd.statsJson); } catch { /* ignore */ }
    } else if (rawItemToAdd.stats && typeof rawItemToAdd.stats === "object") {
      itemToAdd.stats = rawItemToAdd.stats as Record<string, number>;
    }
  }

  if (!action) return { success: false, error: "缺少 action 参数" };
  if (!description) return { success: false, error: "缺少 description 参数" };

  const player = await prisma.player.findUnique({ where: { id: playerId } });
  if (!player) return { success: false, error: "玩家不存在" };

  // ---- pickup: 拾取环境物品 ----
  if (action === "pickup") {
    if (!itemToAdd) {
      return { success: false, error: "拾取操作缺少 itemToAdd 参数" };
    }

    // Guardrail 校验（pickup 品质上限 uncommon）
    const validation = validateItemGift(
      itemToAdd,
      player.level,
      "pickup",
      player.realm as Realm
    );

    if (!validation.ok) {
      return { success: false, error: `拾取物品不合规：${validation.reason}` };
    }

    // 添加到背包
    const created = await prisma.inventoryItem.create({
      data: {
        playerId,
        name: itemToAdd.name,
        type: itemToAdd.type,
        quality: itemToAdd.quality || "common",
        quantity: itemToAdd.quantity || 1,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        stats: (itemToAdd.stats ?? undefined) as any,
        specialEffect: itemToAdd.specialEffect,
      },
    });

    await logPlayerAction(
      playerId,
      "explore",
      `拾取环境物品：${itemToAdd.name}`,
      { action: "pickup", itemName: itemToAdd.name, itemId: created.id }
    );

    return {
      success: true,
      data: {
        action: "pickup",
        description,
        itemAdded: {
          name: itemToAdd.name,
          type: itemToAdd.type,
          quality: itemToAdd.quality || "common",
          quantity: itemToAdd.quantity || 1,
        },
      },
    };
  }

  // ---- use: 使用背包物品与环境交互 ----
  if (action === "use") {
    if (!itemToConsume) {
      return { success: false, error: "使用操作缺少 itemToConsume 参数" };
    }

    // 查找物品
    const resolved = await resolveItem(itemToConsume, playerId);
    if (!resolved.found) return { success: false, error: resolved.error };
    const item = resolved.record;

    // 消耗物品
    if (item.quantity <= 1) {
      await prisma.inventoryItem.delete({ where: { id: item.id } });
    } else {
      await prisma.inventoryItem.update({
        where: { id: item.id },
        data: { quantity: { decrement: 1 } },
      });
    }

    await logPlayerAction(
      playerId,
      "explore",
      `使用物品与环境交互：${item.name} - ${description}`,
      { action: "use", itemName: item.name, description }
    );

    return {
      success: true,
      data: {
        action: "use",
        description,
        consumedItem: item.name,
        effectDescription: effectDescription || "物品已使用",
      },
    };
  }

  // ---- examine: 检查 / destroy: 破坏 ----
  if (action === "examine" || action === "destroy") {
    // 纯叙事，不改 DB

    await logPlayerAction(
      playerId,
      "explore",
      `${action === "examine" ? "检查" : "破坏"}环境：${description}`,
      { action, description, effectDescription }
    );

    return {
      success: true,
      data: {
        action,
        description,
        effectDescription: effectDescription || (action === "examine" ? "仔细观察后获得了一些线索" : "目标被破坏了"),
      },
    };
  }

  return { success: false, error: `不支持的环境交互类型: ${action}` };
}
