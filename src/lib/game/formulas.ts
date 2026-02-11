/**
 * ChaosSaga - 游戏数值公式
 *
 * 所有核心数值计算集中于此，便于平衡性调整。
 */

// ============================================================
// 境界系数
// ============================================================

/** 10大境界及其系数（与 GDD §2.2 一致） */
export const REALM_ORDER = [
  "ocean",      // 海洋级
  "land",       // 陆地级
  "barren",     // 荒芜级
  "planetary",  // 行星级
  "stellar",    // 恒星级
  "galactic",   // 银河级
  "transcend",  // 超越级
  "primordial", // 洪荒级
  "ethereal",   // 空灵级
  "origin",     // 元初级
] as const;

export type Realm = (typeof REALM_ORDER)[number];

/** 境界属性倍率（与 GDD §2.2 表格一致） */
export const REALM_COEFFICIENTS: Record<Realm, number> = {
  ocean: 1.0,
  land: 2.0,
  barren: 4.0,
  planetary: 8.0,
  stellar: 16.0,
  galactic: 32.0,
  transcend: 64.0,
  primordial: 128.0,
  ethereal: 256.0,
  origin: 512.0,
};

/** 突破境界所需等级（与 GDD §2.2 表格一致） */
export const REALM_LEVEL_REQ: Record<Realm, number> = {
  ocean: 1,
  land: 11,
  barren: 21,
  planetary: 31,
  stellar: 41,
  galactic: 51,
  transcend: 61,
  primordial: 71,
  ethereal: 81,
  origin: 91,
};

// ============================================================
// 经验公式
// ============================================================

/**
 * 升到下一级所需总经验
 * 公式：100 * level^1.5
 */
export function expToNextLevel(level: number): number {
  return Math.floor(100 * Math.pow(level, 1.5));
}

/**
 * 检查是否可以升级，返回升级后的等级和剩余经验
 */
export function checkLevelUp(
  level: number,
  currentExp: number
): { newLevel: number; remainingExp: number; levelsGained: number } {
  let lv = level;
  let exp = currentExp;
  let gained = 0;

  while (exp >= expToNextLevel(lv) && lv < 100) {
    exp -= expToNextLevel(lv);
    lv++;
    gained++;
  }

  return { newLevel: lv, remainingExp: exp, levelsGained: gained };
}

// ============================================================
// 属性成长
// ============================================================

/**
 * 计算基础属性（不含装备加成）
 * 每升一级按固定公式增长，再乘以境界系数
 */
export function calcBaseStats(level: number, realm: Realm) {
  const coeff = REALM_COEFFICIENTS[realm];
  return {
    maxHp: Math.floor((80 + level * 20) * coeff),   // L1: 100
    maxMp: Math.floor((40 + level * 10) * coeff),   // L1: 50 (与 Schema 默认值一致)
    attack: Math.floor((8 + level * 2) * coeff),    // L1: 10
    defense: Math.floor((4 + level * 1.5) * coeff), // L1: 5 (floor(5.5)=5)
    speed: Math.floor((8 + level * 2) * coeff),     // L1: 10 (与 Schema 默认值一致)
  };
}

// ============================================================
// 战斗公式
// ============================================================

/**
 * 伤害计算
 * 基础伤害 = 攻击力 - 防御力 * 0.5
 * 最低1点伤害
 */
export function calcDamage(
  attack: number,
  defense: number,
  skillMultiplier: number = 1.0
): number {
  const raw = Math.max(1, attack - defense * 0.5) * skillMultiplier;
  // ±10% 随机波动
  const variance = 0.9 + Math.random() * 0.2;
  return Math.floor(raw * variance);
}

/**
 * 暴击判定
 * 基础暴击率: 5% + (速度差/100)
 * 暴击倍率: 2x
 */
export function rollCritical(
  attackerSpeed: number,
  defenderSpeed: number
): { isCrit: boolean; multiplier: number } {
  const baseCritRate = 0.05 + (attackerSpeed - defenderSpeed) / 100;
  const isCrit = Math.random() < Math.max(0.01, Math.min(0.5, baseCritRate));
  return { isCrit, multiplier: isCrit ? 2.0 : 1.0 };
}

/**
 * 元素克制倍率
 * 火克风，风克土，土克水，水克火
 * 暗↔光互克
 */
export function getElementMultiplier(
  attackElement: string,
  defendElement: string
): number {
  const advantages: Record<string, string> = {
    fire: "wind",
    wind: "earth",
    earth: "water",
    water: "fire",
    dark: "light",
    light: "dark",
  };

  if (advantages[attackElement] === defendElement) return 1.5;
  if (advantages[defendElement] === attackElement) return 0.75;
  return 1.0;
}

/**
 * 行动顺序（按速度排序，加随机扰动）
 */
export function calcTurnOrder(
  participants: Array<{ id: string; speed: number }>
): string[] {
  return [...participants]
    .map((p) => ({
      id: p.id,
      priority: p.speed + Math.random() * 5,
    }))
    .sort((a, b) => b.priority - a.priority)
    .map((p) => p.id);
}

// ============================================================
// 掉落公式
// ============================================================

/**
 * 战斗经验奖励
 * 基础: 敌人等级 * 20
 * 等级差修正: 高于5级减少，低于5级增加
 */
export function calcBattleExp(
  playerLevel: number,
  enemyLevels: number[]
): number {
  let total = 0;
  for (const eLv of enemyLevels) {
    const base = eLv * 20;
    const diff = eLv - playerLevel;
    const modifier = Math.max(0.2, Math.min(2.0, 1 + diff * 0.1));
    total += Math.floor(base * modifier);
  }
  return total;
}

/**
 * 金币掉落
 */
export function calcGoldDrop(enemyLevels: number[]): number {
  let total = 0;
  for (const lv of enemyLevels) {
    total += lv * 5 + Math.floor(Math.random() * lv * 3);
  }
  return total;
}
