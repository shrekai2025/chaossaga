/**
 * ChaosSaga - 玩家属性计算
 *
 * 计算玩家最终属性 = 基础属性(等级×境界) + 装备加成 + Buff
 */

import { calcBaseStats, type Realm } from "./formulas";

// ============================================================
// 类型定义
// ============================================================

/** 五维属性 */
export interface Stats {
  maxHp: number;
  maxMp: number;
  attack: number;
  defense: number;
  speed: number;
}

/** 装备属性（来自 InventoryItem.stats JSON） */
export interface EquipmentStats {
  maxHp?: number;
  maxMp?: number;
  attack?: number;
  defense?: number;
  speed?: number;
  /** 百分比加成，如 0.1 表示 +10% */
  maxHpPercent?: number;
  maxMpPercent?: number;
  attackPercent?: number;
  defensePercent?: number;
  speedPercent?: number;
}

/** Buff/Debuff 条目 */
export interface BuffEntry {
  id: string;
  name: string;
  /** 影响的属性及数值（正=增益，负=减益） */
  stats: Partial<Stats>;
  /** 百分比修正 */
  percentStats?: Partial<Record<keyof Stats, number>>;
  /** 剩余回合数，-1 表示永久 */
  remainingTurns: number;
}

/** 最终属性计算结果 */
export interface FinalStats extends Stats {
  /** 各项来源明细 */
  breakdown: {
    base: Stats;
    equipment: Partial<Stats>;
    buffs: Partial<Stats>;
  };
}

// ============================================================
// 装备属性汇总
// ============================================================

/**
 * 汇总所有已装备物品的属性加成
 */
export function sumEquipmentStats(
  equippedItems: Array<{ stats: Record<string, unknown> | null }>
): { flat: Partial<Stats>; percent: Partial<Record<keyof Stats, number>> } {
  const flat: Partial<Stats> = {};
  const percent: Partial<Record<keyof Stats, number>> = {};

  const statKeys: (keyof Stats)[] = [
    "maxHp",
    "maxMp",
    "attack",
    "defense",
    "speed",
  ];

  for (const item of equippedItems) {
    const s = (item.stats ?? {}) as EquipmentStats;

    for (const key of statKeys) {
      if (typeof s[key] === "number") {
        flat[key] = (flat[key] ?? 0) + s[key]!;
      }
      const pKey = `${key}Percent` as keyof EquipmentStats;
      if (typeof s[pKey] === "number") {
        percent[key] = (percent[key] ?? 0) + (s[pKey] as number);
      }
    }
  }

  return { flat, percent };
}

// ============================================================
// Buff 属性汇总
// ============================================================

/**
 * 汇总所有活跃 Buff 的属性修正
 */
export function sumBuffStats(
  buffs: BuffEntry[]
): { flat: Partial<Stats>; percent: Partial<Record<keyof Stats, number>> } {
  const flat: Partial<Stats> = {};
  const percent: Partial<Record<keyof Stats, number>> = {};

  const statKeys: (keyof Stats)[] = [
    "maxHp",
    "maxMp",
    "attack",
    "defense",
    "speed",
  ];

  for (const buff of buffs) {
    if (buff.remainingTurns === 0) continue;
    for (const key of statKeys) {
      if (buff.stats[key] !== undefined) {
        flat[key] = (flat[key] ?? 0) + buff.stats[key]!;
      }
      if (buff.percentStats?.[key] !== undefined) {
        percent[key] = (percent[key] ?? 0) + buff.percentStats[key]!;
      }
    }
  }

  return { flat, percent };
}

// ============================================================
// 最终属性计算
// ============================================================

/**
 * 计算玩家最终属性
 *
 * 公式：(基础属性 + 装备固定值 + Buff固定值) × (1 + 装备百分比 + Buff百分比)
 * 所有值向下取整，最低为 1
 */
export function calcFinalStats(
  level: number,
  realm: Realm,
  equippedItems: Array<{ stats: Record<string, unknown> | null }>,
  buffs: BuffEntry[] = []
): FinalStats {
  const base = calcBaseStats(level, realm);
  const equip = sumEquipmentStats(equippedItems);
  const buff = sumBuffStats(buffs);

  const statKeys: (keyof Stats)[] = [
    "maxHp",
    "maxMp",
    "attack",
    "defense",
    "speed",
  ];

  const result: Stats = { maxHp: 0, maxMp: 0, attack: 0, defense: 0, speed: 0 };
  const equipFlat: Partial<Stats> = {};
  const buffFlat: Partial<Stats> = {};

  for (const key of statKeys) {
    const baseVal = base[key];
    const equipFlatVal = equip.flat[key] ?? 0;
    const buffFlatVal = buff.flat[key] ?? 0;
    const equipPct = equip.percent[key] ?? 0;
    const buffPct = buff.percent[key] ?? 0;

    const raw = (baseVal + equipFlatVal + buffFlatVal) * (1 + equipPct + buffPct);
    result[key] = Math.max(1, Math.floor(raw));

    equipFlat[key] = equipFlatVal;
    buffFlat[key] = buffFlatVal;
  }

  return {
    ...result,
    breakdown: {
      base,
      equipment: equipFlat,
      buffs: buffFlat,
    },
  };
}

// ============================================================
// Buff 回合结算
// ============================================================

/**
 * 回合结束时更新 Buff 剩余回合数，移除过期 Buff
 */
export function tickBuffs(buffs: BuffEntry[]): BuffEntry[] {
  return buffs
    .map((b) =>
      b.remainingTurns === -1
        ? b
        : { ...b, remainingTurns: b.remainingTurns - 1 }
    )
    .filter((b) => b.remainingTurns !== 0);
}
