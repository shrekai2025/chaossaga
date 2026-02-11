/**
 * ChaosSaga - 掉落系统
 *
 * 战斗胜利后的奖励计算：
 * - 经验值（基于敌人等级和等级差）
 * - 金币（基于敌人等级 + 随机波动）
 * - 物品掉落（概率表 + 品质滚动）
 */

import { calcBattleExp, calcGoldDrop } from "./formulas";

// ============================================================
// 类型定义
// ============================================================

/** 掉落物品模板（来自 BOSS.drops 或节点 data） */
export interface DropTemplate {
  name: string;
  type: "weapon" | "armor" | "accessory" | "consumable" | "material" | "quest_item" | "skill";
  quality: "common" | "uncommon" | "rare" | "epic" | "legendary";
  stats?: Record<string, number>;
  specialEffect?: string;
  /** 掉落概率 0-1 */
  chance: number;
  /** 技能专属字段 */
  skillData?: {
    element: string;
    damage: number;
    mpCost: number;
    cooldown: number;
    effect?: Record<string, unknown>;
  };
}

/** 单个敌人信息（用于奖励计算） */
export interface DefeatedEnemy {
  name: string;
  level: number;
  /** BOSS 专用掉落表 */
  drops?: DropTemplate[];
}

/** 掉落结果 */
export interface DropResult {
  exp: number;
  gold: number;
  items: DroppedItem[];
}

/** 掉落的物品 */
export interface DroppedItem {
  name: string;
  type: string;
  quality: string;
  quantity: number;
  stats?: Record<string, number>;
  specialEffect?: string;
  /** 掉落来源 */
  source: string;
  /** 技能专属数据 */
  skillData?: {
    element: string;
    damage: number;
    mpCost: number;
    cooldown: number;
    effect?: Record<string, unknown>;
  };
}

// ============================================================
// 品质概率表
// ============================================================

/** 通用掉落品质概率（等级差修正后） */
const QUALITY_TABLE = {
  common:    0.50,
  uncommon:  0.30,
  rare:      0.15,
  epic:      0.04,
  legendary: 0.01,
} as const;

/** 基础物品掉落概率（每只敌人） */
const BASE_ITEM_DROP_RATE = 0.25;

/** 通用消耗品池 */
const GENERIC_CONSUMABLES: DropTemplate[] = [
  { name: "回复药水", type: "consumable", quality: "common", stats: { hpRestore: 50 }, chance: 1.0 },
  { name: "魔力药水", type: "consumable", quality: "common", stats: { mpRestore: 30 }, chance: 1.0 },
  { name: "高级回复药水", type: "consumable", quality: "uncommon", stats: { hpRestore: 120 }, chance: 1.0 },
];

/** 通用材料池 */
const GENERIC_MATERIALS: DropTemplate[] = [
  { name: "兽骨碎片", type: "material", quality: "common", chance: 1.0 },
  { name: "魔力结晶", type: "material", quality: "uncommon", chance: 1.0 },
  { name: "元素核心", type: "material", quality: "rare", chance: 1.0 },
];

// ============================================================
// 核心掉落计算
// ============================================================

/**
 * 计算战斗胜利后的完整奖励
 *
 * @param enemies     - 被击败的敌人列表
 * @param playerLevel - 玩家等级
 */
export function calculateDrops(
  enemies: DefeatedEnemy[],
  playerLevel: number
): DropResult {
  const enemyLevels = enemies.map((e) => e.level);

  // 经验和金币（使用 formulas.ts 的公式）
  const exp = calcBattleExp(playerLevel, enemyLevels);
  const gold = calcGoldDrop(enemyLevels);

  // 物品掉落
  const items: DroppedItem[] = [];

  for (const enemy of enemies) {
    // 1. 优先使用敌人专属掉落表（BOSS drops）
    if (enemy.drops?.length) {
      for (const drop of enemy.drops) {
        if (Math.random() < drop.chance) {
          items.push({
            name: drop.name,
            type: drop.type,
            quality: drop.quality,
            quantity: 1,
            stats: drop.stats,
            specialEffect: drop.specialEffect,
            skillData: drop.skillData, // 传递技能数据
            source: enemy.name,
          });
        }
      }
    }

    // 2. 通用掉落判定（非 BOSS 也有概率掉东西）
    if (Math.random() < BASE_ITEM_DROP_RATE) {
      const item = rollGenericDrop(enemy.level, playerLevel);
      if (item) {
        items.push({ ...item, source: enemy.name });
      }
    }
  }

  return { exp, gold, items };
}

// ============================================================
// 通用物品掉落
// ============================================================

/** 随机滚动一个通用掉落物品 */
function rollGenericDrop(
  enemyLevel: number,
  playerLevel: number
): Omit<DroppedItem, "source"> | null {
  // 品质滚动（等级差修正：高等级敌人更容易出好东西）
  const quality = rollQuality(enemyLevel - playerLevel);

  // 70% 概率掉消耗品，30% 概率掉材料
  const pool = Math.random() < 0.7 ? GENERIC_CONSUMABLES : GENERIC_MATERIALS;

  // 从池中选一个品质匹配的，没有就降一级
  const qualityOrder: string[] = ["legendary", "epic", "rare", "uncommon", "common"];
  const qualityIdx = qualityOrder.indexOf(quality);

  for (let i = qualityIdx; i < qualityOrder.length; i++) {
    const candidates = pool.filter((p) => p.quality === qualityOrder[i]);
    if (candidates.length > 0) {
      const pick = candidates[Math.floor(Math.random() * candidates.length)];
      return {
        name: pick.name,
        type: pick.type,
        quality: pick.quality,
        quantity: 1,
        stats: pick.stats,
      };
    }
  }

  return null;
}

/** 品质滚动（等级差修正） */
function rollQuality(levelDiff: number): string {
  // 等级差每 +1 级，稀有度权重提升 2%
  const bonus = Math.max(-0.1, Math.min(0.2, levelDiff * 0.02));

  const weights = {
    common: Math.max(0.1, QUALITY_TABLE.common - bonus * 2),
    uncommon: QUALITY_TABLE.uncommon + bonus * 0.5,
    rare: QUALITY_TABLE.rare + bonus * 0.8,
    epic: Math.min(0.15, QUALITY_TABLE.epic + bonus * 0.5),
    legendary: Math.min(0.05, QUALITY_TABLE.legendary + bonus * 0.2),
  };

  const totalWeight = Object.values(weights).reduce((a, b) => a + b, 0);
  let roll = Math.random() * totalWeight;

  for (const [quality, weight] of Object.entries(weights)) {
    roll -= weight;
    if (roll <= 0) return quality;
  }

  return "common";
}
