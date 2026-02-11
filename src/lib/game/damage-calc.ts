/**
 * ChaosSaga - 伤害计算器
 *
 * 完整伤害公式 = (攻击力 × 技能系数 - 防御 × 减伤系数) × 元素倍率 × 暴击 × 随机波动
 * 最低 1 点伤害
 */

import {
  calcDamage,
  rollCritical,
  getElementMultiplier,
} from "./formulas";

// ============================================================
// 类型定义
// ============================================================

/** 战斗中的角色属性（玩家或敌人通用） */
export interface Combatant {
  name: string;
  attack: number;
  defense: number;
  speed: number;
  element?: string;
}

/** 技能信息 */
export interface SkillInfo {
  name: string;
  damage: number;       // 技能基础伤害
  element?: string;     // 技能元素（覆盖攻击者元素）
  multiplier?: number;  // 技能系数（默认 1.0）
  /** 附加效果 */
  effects?: SkillEffect[];
}

/** 技能附加效果 */
export interface SkillEffect {
  type: "dot" | "heal" | "buff" | "debuff" | "stun";
  value: number;
  duration?: number; // 持续回合
  chance?: number;   // 触发概率 0-1
}

/** 伤害计算结果 */
export interface DamageResult {
  /** 最终伤害值 */
  damage: number;
  /** 是否暴击 */
  isCrit: boolean;
  /** 元素倍率 */
  elementMultiplier: number;
  /** 元素关系描述 */
  elementRelation: "advantage" | "disadvantage" | "neutral";
  /** 使用的技能名（null 为普攻） */
  skillName: string | null;
  /** 触发的附加效果 */
  triggeredEffects: SkillEffect[];
}

// ============================================================
// 核心伤害计算
// ============================================================

/**
 * 计算一次攻击的完整伤害
 *
 * @param attacker - 攻击方
 * @param defender - 防御方
 * @param skill    - 使用的技能（null 为普攻）
 * @param isDefending - 防御方是否处于防御状态（伤害减半）
 */
export function calculateDamage(
  attacker: Combatant,
  defender: Combatant,
  skill: SkillInfo | null = null,
  isDefending: boolean = false
): DamageResult {
  // 1. 基础攻击力 = 角色攻击 + 技能基础伤害
  const totalAttack = attacker.attack + (skill?.damage ?? 0);

  // 2. 技能系数
  const skillMultiplier = skill?.multiplier ?? 1.0;

  // 3. 基础伤害 = (攻击力 × 技能系数 - 防御 × 0.5)，最低 1
  const baseDamage = calcDamage(totalAttack, defender.defense, skillMultiplier);

  // 4. 元素克制
  const attackElement = skill?.element ?? attacker.element ?? "none";
  const defendElement = defender.element ?? "none";
  const elementMultiplier = getElementMultiplier(attackElement, defendElement);

  let elementRelation: DamageResult["elementRelation"] = "neutral";
  if (elementMultiplier > 1) elementRelation = "advantage";
  else if (elementMultiplier < 1) elementRelation = "disadvantage";

  // 5. 暴击
  const { isCrit, multiplier: critMultiplier } = rollCritical(
    attacker.speed,
    defender.speed
  );

  // 6. 防御状态减伤
  const defendMultiplier = isDefending ? 0.5 : 1.0;

  // 7. 最终伤害
  const finalDamage = Math.max(
    1,
    Math.floor(baseDamage * elementMultiplier * critMultiplier * defendMultiplier)
  );

  // 8. 技能附加效果触发判定
  const triggeredEffects: SkillEffect[] = [];
  if (skill?.effects) {
    for (const effect of skill.effects) {
      const chance = effect.chance ?? 1.0;
      if (Math.random() < chance) {
        triggeredEffects.push(effect);
      }
    }
  }

  return {
    damage: finalDamage,
    isCrit,
    elementMultiplier,
    elementRelation,
    skillName: skill?.name ?? null,
    triggeredEffects,
  };
}

// ============================================================
// 治疗计算
// ============================================================

/**
 * 计算治疗量
 * 基础治疗 = 技能基础伤害值（用作治疗基数）× (1 + 攻击力/100)
 */
export function calculateHeal(
  casterAttack: number,
  skillDamage: number
): number {
  const raw = skillDamage * (1 + casterAttack / 100);
  // ±10% 随机波动
  const variance = 0.9 + Math.random() * 0.2;
  return Math.floor(raw * variance);
}
