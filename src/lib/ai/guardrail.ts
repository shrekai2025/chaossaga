/**
 * ChaosSaga - Guardrail 安全层
 *
 * 两层安全网：
 * 1. 确定性数值校验（快速、零成本）：物品/伤害/任务奖励的数值合理性
 * 2. 监管 Agent（LLM 判定）：非数值问题的合理性审核
 *
 * 核心原则：给 AI 自由 → 但每个动作必须经过 Guardrail → 不合规就打回并附原因
 */

import { REALM_COEFFICIENTS, type Realm } from "@/lib/game/formulas";
import { getElementMultiplier } from "@/lib/game/formulas";

// ============================================================
// 类型定义
// ============================================================

export interface ValidationResult {
  ok: boolean;
  reason?: string;
  /** 伤害校验时返回被 cap 后的值 */
  cappedValue?: number;
  /** 元素克制加成信息 */
  elementBonus?: number;
}

export interface ItemProposal {
  name: string;
  type: string;
  quality?: string;
  stats?: Record<string, number>;
  specialEffect?: string;
  quantity?: number;
}

export interface DamageProposal {
  value: number;
  playerAttack: number;
  hasItem: boolean;
  attackElement?: string;
  defendElement?: string;
}

export interface QuestRewardProposal {
  exp?: number;
  gold?: number;
  items?: ItemProposal[];
}

export interface SupervisorContext {
  action: string;
  description: string;
  playerState: string;
  battleState?: string;
}

// ============================================================
// 常量
// ============================================================

/** 允许的物品类型 */
const VALID_ITEM_TYPES = new Set([
  "weapon", "armor", "accessory", "helmet", "boots",
  "consumable", "material", "quest_item", "collectible",
]);

/** 禁止出现的特殊效果黑名单 */
const BANNED_SPECIAL_EFFECTS = new Set([
  "instant_kill", "infinite_gold", "invincible", "immortal",
  "one_hit_kill", "unlimited_hp", "unlimited_mp", "god_mode",
  "infinite_damage", "kill_all", "全体秒杀", "无敌", "不死",
  "一击必杀", "无限金币", "无限生命",
]);

/** 品质等级对应的 stats 乘数 */
const QUALITY_MULTIPLIERS: Record<string, number> = {
  common: 1.0,
  uncommon: 1.5,
  rare: 2.5,
  epic: 4.0,
  legendary: 7.0,
};

/** 物品来源对应的最高品质 */
const SOURCE_QUALITY_CAP: Record<string, string> = {
  pickup: "uncommon",
  enemy: "rare",
  boss: "epic",
  quest: "epic",
};

/** 品质排序（用于比较） */
const QUALITY_ORDER: Record<string, number> = {
  common: 0,
  uncommon: 1,
  rare: 2,
  epic: 3,
  legendary: 4,
};

// ============================================================
// 第一层：确定性数值校验
// ============================================================

/**
 * 校验物品赠送/拾取的合理性
 */
export function validateItemGift(
  item: ItemProposal,
  playerLevel: number,
  source: "pickup" | "enemy" | "boss" | "quest",
  realm: Realm = "ocean"
): ValidationResult {
  // 1. 类型校验
  if (!VALID_ITEM_TYPES.has(item.type)) {
    return { ok: false, reason: `物品类型「${item.type}」不合法，允许：${[...VALID_ITEM_TYPES].join("、")}` };
  }

  // 2. 品质校验
  const quality = item.quality || "common";
  const maxQuality = SOURCE_QUALITY_CAP[source] || "rare";
  if ((QUALITY_ORDER[quality] ?? 0) > (QUALITY_ORDER[maxQuality] ?? 2)) {
    return {
      ok: false,
      reason: `来源为「${source}」的物品品质上限为「${maxQuality}」，但提议品质为「${quality}」`,
    };
  }

  // 3. 特殊效果黑名单
  if (item.specialEffect) {
    const effectLower = item.specialEffect.toLowerCase();
    for (const banned of BANNED_SPECIAL_EFFECTS) {
      if (effectLower.includes(banned)) {
        return { ok: false, reason: `特殊效果「${item.specialEffect}」包含禁止词「${banned}」` };
      }
    }
  }

  // 4. Stats 数值上限校验
  if (item.stats && Object.keys(item.stats).length > 0) {
    const realmCoeff = REALM_COEFFICIENTS[realm] || 1.0;
    const qualityMult = QUALITY_MULTIPLIERS[quality] || 1.0;
    const statCap = Math.floor(playerLevel * realmCoeff * qualityMult);

    for (const [key, value] of Object.entries(item.stats)) {
      // hpRestore / mpRestore 的上限更宽松（消耗品恢复量）
      if (key === "hpRestore" || key === "mpRestore") {
        const restoreCap = statCap * 5; // 恢复量允许更高
        if (value > restoreCap) {
          return {
            ok: false,
            reason: `物品 stats.${key}=${value} 超过上限 ${restoreCap}（${playerLevel}级 × ${realmCoeff}境界 × ${qualityMult}品质 × 5）`,
          };
        }
        continue;
      }
      if (value > statCap) {
        return {
          ok: false,
          reason: `物品 stats.${key}=${value} 超过上限 ${statCap}（${playerLevel}级 × ${realmCoeff}境界 × ${qualityMult}品质）`,
        };
      }
    }
  }

  // 5. 数量校验
  if (item.quantity && item.quantity > 99) {
    return { ok: false, reason: `物品数量 ${item.quantity} 超过上限 99` };
  }

  return { ok: true };
}

/**
 * 校验伤害提议的合理性，并 cap 到安全范围
 */
export function validateDamageProposal(proposal: DamageProposal): ValidationResult {
  const { value, playerAttack, hasItem, attackElement, defendElement } = proposal;

  // 基础上限
  let cap: number;
  if (hasItem) {
    // 有物品的创意攻击：上限 = player.attack * 1.5
    cap = Math.floor(playerAttack * 1.5);
  } else {
    // 无物品的环境攻击：上限 = player.attack * 0.3
    cap = Math.max(1, Math.floor(playerAttack * 0.3));
  }

  // 元素克制调整
  let elementBonus = 1.0;
  if (attackElement && defendElement) {
    elementBonus = getElementMultiplier(attackElement, defendElement);
  }

  const cappedBase = Math.min(value, cap);
  const cappedValue = Math.max(1, Math.floor(cappedBase * elementBonus));

  if (value > cap) {
    return {
      ok: true, // 仍然通过，但会被 cap
      cappedValue,
      elementBonus,
      reason: `提议伤害 ${value} 超过上限 ${cap}（${hasItem ? "有物品×1.5" : "无物品×0.3"}），已调整为 ${cappedBase}`,
    };
  }

  return { ok: true, cappedValue, elementBonus };
}

/**
 * 校验任务奖励的合理性
 */
export function validateQuestReward(
  rewards: QuestRewardProposal,
  playerLevel: number,
  realm: Realm = "ocean"
): ValidationResult {
  // 经验上限
  if (rewards.exp !== undefined) {
    const expCap = playerLevel * 30;
    if (rewards.exp > expCap) {
      return { ok: false, reason: `经验奖励 ${rewards.exp} 超过上限 ${expCap}（${playerLevel}级 × 30）` };
    }
  }

  // 金币上限
  if (rewards.gold !== undefined) {
    const goldCap = playerLevel * 50;
    if (rewards.gold > goldCap) {
      return { ok: false, reason: `金币奖励 ${rewards.gold} 超过上限 ${goldCap}（${playerLevel}级 × 50）` };
    }
  }

  // 物品奖励递归校验
  if (rewards.items && rewards.items.length > 0) {
    for (const item of rewards.items) {
      const itemResult = validateItemGift(item, playerLevel, "quest", realm);
      if (!itemResult.ok) {
        return { ok: false, reason: `任务奖励物品「${item.name}」不合规：${itemResult.reason}` };
      }
    }
  }

  return { ok: true };
}

/**
 * 校验活跃任务数量
 */
export async function validateActiveQuestCount(
  playerId: string,
  prisma: { playerQuest: { count: (args: { where: Record<string, unknown> }) => Promise<number> } }
): Promise<ValidationResult> {
  const MAX_ACTIVE_QUESTS = 5;
  const count = await prisma.playerQuest.count({
    where: { playerId, status: "active" },
  });

  if (count >= MAX_ACTIVE_QUESTS) {
    return { ok: false, reason: `活跃任务已达上限 ${MAX_ACTIVE_QUESTS}，请先完成或放弃现有任务` };
  }

  return { ok: true };
}

// ============================================================
// 第二层：监管 Agent（LLM 判定）
// ============================================================

/**
 * 判断是否需要触发监管 Agent
 */
export function needsSupervisorCheck(context: {
  hasRareItem?: boolean;
  hasSkillReward?: boolean;
  hasUnusualEffect?: boolean;
}): boolean {
  // 环境变量控制总开关
  if (process.env.GUARDRAIL_SUPERVISOR_ENABLED === "false") return false;

  return !!(context.hasRareItem || context.hasSkillReward || context.hasUnusualEffect);
}

/**
 * 监管 Agent：使用快速 LLM 做二次审核
 *
 * 仅在确定性规则无法判定时调用（如剧情合理性）。
 * 有 2s 超时兜底 → 超时默认通过，避免阻塞游戏体验。
 */
export async function supervisorCheck(
  context: SupervisorContext
): Promise<{ approved: boolean; reason?: string }> {
  // 如果监管 Agent 被禁用，直接通过
  if (process.env.GUARDRAIL_SUPERVISOR_ENABLED === "false") {
    return { approved: true };
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 2000); // 2s 超时

    const apiKey = process.env.TUZI_API_KEY;
    const baseUrl = process.env.TUZI_BASE_URL || "https://api.tu-zi.com";

    if (!apiKey) {
      // 无 API key 时默认通过
      clearTimeout(timeout);
      return { approved: true, reason: "监管 Agent 未配置 API key，默认通过" };
    }

    const response = await fetch(`${baseUrl}/v1/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        temperature: 0,
        max_tokens: 200,
        messages: [
          {
            role: "system",
            content:
              "你是游戏安全审核员。判断以下游戏行动是否合理。只回复JSON：{\"approved\":true/false,\"reason\":\"简短原因\"}\n" +
              "判定标准：是否符合奇幻RPG世界观？数值是否夸张？是否会破坏游戏平衡？\n" +
              "倾向宽松：只有明显不合理才拒绝。",
          },
          {
            role: "user",
            content: JSON.stringify(context),
          },
        ],
      }),
      signal: controller.signal,
    });

    clearTimeout(timeout);

    if (!response.ok) {
      console.warn(`[Guardrail] Supervisor API error: ${response.status}`);
      return { approved: true, reason: "监管 Agent API 错误，默认通过" };
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content;

    if (!content) {
      return { approved: true, reason: "监管 Agent 无返回，默认通过" };
    }

    // 尝试解析 JSON
    try {
      const result = JSON.parse(content);
      return {
        approved: !!result.approved,
        reason: result.reason || undefined,
      };
    } catch {
      // 简单启发式：如果返回包含 "true" 或 "approved" 则通过
      const lower = content.toLowerCase();
      if (lower.includes('"approved":true') || lower.includes('"approved": true')) {
        return { approved: true };
      }
      return { approved: false, reason: `监管 Agent 返回解析失败: ${content.slice(0, 100)}` };
    }
  } catch (error) {
    // 超时或网络错误 → 默认通过（不阻塞游戏）
    if (error instanceof DOMException && error.name === "AbortError") {
      console.warn("[Guardrail] Supervisor timeout, defaulting to approved");
      return { approved: true, reason: "监管 Agent 超时，默认通过" };
    }
    console.warn("[Guardrail] Supervisor error:", error);
    return { approved: true, reason: "监管 Agent 异常，默认通过" };
  }
}
