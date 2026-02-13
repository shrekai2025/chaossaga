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
  type: "weapon" | "armor" | "accessory" | "consumable" | "material" | "quest_item" | "skill" | "collectible";
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
const BASE_ITEM_DROP_RATE = 0.35;

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

type DropQuality = keyof typeof QUALITY_TABLE;

const RANDOM_PREFIXES: Record<DropQuality, string[]> = {
  common: ["粗糙的", "斑驳的", "旧制", "普通的"],
  uncommon: ["精制", "结实的", "微光", "坚固的"],
  rare: ["稀有", "秘纹", "湛蓝", "锋锐"],
  epic: ["史诗", "远古", "星辉", "深渊"],
  legendary: ["传说", "神铸", "天启", "圣辉"],
};

const RANDOM_COLLECTIBLES = ["海螺徽章", "碎裂珊瑚片", "古旧铜币", "发光贝壳", "奇异羽饰"];
const RANDOM_MATERIALS = ["灵木碎片", "晶化尘砂", "潮汐矿屑", "星尘结晶", "异化鳞片"];
const RANDOM_WEAPONS = ["短刃", "战斧", "长枪", "弯刀", "骨杖"];
const RANDOM_ACCESSORIES = ["戒指", "护符", "挂坠", "腕环", "纹章"];

const CATEGORY_WEIGHTS = [
  { type: "consumable", weight: 30 },
  { type: "material", weight: 25 },
  { type: "collectible", weight: 15 },
  { type: "weapon", weight: 15 },
  { type: "accessory", weight: 15 },
] as const;

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
  const quality = rollQuality(enemyLevel - playerLevel) as DropQuality;
  const category = rollRandomCategory();

  // 消耗品：保持当前固定池逻辑
  if (category === "consumable") {
    const fixed = rollFromFixedPool(GENERIC_CONSUMABLES, quality);
    if (fixed) return fixed;
  }

  // 材料：50% 固定池 + 50% 程序化随机
  if (category === "material") {
    if (Math.random() < 0.5) {
      const fixed = rollFromFixedPool(GENERIC_MATERIALS, quality);
      if (fixed) return fixed;
    }
    return buildRandomMaterial(quality);
  }

  if (category === "collectible") {
    return buildRandomCollectible(quality);
  }

  if (category === "weapon") {
    return buildRandomWeapon(quality, enemyLevel);
  }

  if (category === "accessory") {
    return buildRandomAccessory(quality, enemyLevel);
  }

  return rollFromFixedPool(GENERIC_MATERIALS, quality);
}

function rollFromFixedPool(
  pool: DropTemplate[],
  quality: DropQuality
): Omit<DroppedItem, "source"> | null {
  const qualityOrder: DropQuality[] = ["legendary", "epic", "rare", "uncommon", "common"];
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

function rollRandomCategory(): (typeof CATEGORY_WEIGHTS)[number]["type"] {
  const total = CATEGORY_WEIGHTS.reduce((s, c) => s + c.weight, 0);
  let r = Math.random() * total;
  for (const c of CATEGORY_WEIGHTS) {
    r -= c.weight;
    if (r <= 0) return c.type;
  }
  return "material";
}

function randomPick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function randomPrefix(quality: DropQuality): string {
  return randomPick(RANDOM_PREFIXES[quality]);
}

function qualityScale(quality: DropQuality): number {
  switch (quality) {
    case "common":
      return 1.0;
    case "uncommon":
      return 1.25;
    case "rare":
      return 1.6;
    case "epic":
      return 2.1;
    case "legendary":
      return 2.8;
  }
}

function buildRandomMaterial(quality: DropQuality): Omit<DroppedItem, "source"> {
  const name = `${randomPrefix(quality)}${randomPick(RANDOM_MATERIALS)}`;
  return {
    name,
    type: "material",
    quality,
    quantity: 1,
  };
}

function buildRandomCollectible(quality: DropQuality): Omit<DroppedItem, "source"> {
  const name = `${randomPrefix(quality)}${randomPick(RANDOM_COLLECTIBLES)}`;
  return {
    name,
    type: "collectible",
    quality,
    quantity: 1,
  };
}

function buildRandomWeapon(
  quality: DropQuality,
  enemyLevel: number
): Omit<DroppedItem, "source"> {
  const name = `${randomPrefix(quality)}${randomPick(RANDOM_WEAPONS)}`;
  const atk = Math.max(1, Math.floor((2 + enemyLevel * 0.8) * qualityScale(quality)));
  return {
    name,
    type: "weapon",
    quality,
    quantity: 1,
    stats: { attack: atk },
  };
}

function buildRandomAccessory(
  quality: DropQuality,
  enemyLevel: number
): Omit<DroppedItem, "source"> {
  const name = `${randomPrefix(quality)}${randomPick(RANDOM_ACCESSORIES)}`;
  const scale = qualityScale(quality);
  const statsPool: Array<Record<string, number>> = [
    { defense: Math.max(1, Math.floor((1 + enemyLevel * 0.4) * scale)) },
    { maxHp: Math.max(5, Math.floor((10 + enemyLevel * 4) * scale)) },
    { maxMp: Math.max(3, Math.floor((6 + enemyLevel * 3) * scale)) },
    { speed: Math.max(1, Math.floor((1 + enemyLevel * 0.25) * scale)) },
  ];
  return {
    name,
    type: "accessory",
    quality,
    quantity: 1,
    stats: randomPick(statsPool),
  };
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
