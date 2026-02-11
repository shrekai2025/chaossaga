/**
 * ChaosSaga - 敌人 AI 决策
 *
 * 行为树 + 加权随机：
 * - 低 HP 时优先回复/防御
 * - 高 HP 时正常攻击/使用技能
 * - BOSS 有多阶段策略
 */

import { type DropTemplate } from "./drop-system";

// ============================================================
// 类型定义
// ============================================================

/** 战斗中的敌人 */
export interface EnemyState {
  name: string;
  level: number;
  element: string;
  hp: number;
  maxHp: number;
  attack: number;
  defense: number;
  speed: number;
  skills: EnemySkill[];
  /** BOSS 专用：阶段数据 */
  phases?: BossPhase[];
  /** BOSS 专属掉落表 */
  drops?: DropTemplate[];
  /** 已触发的阶段索引（防止重复通知），用数组存储以支持 JSON 序列化 */
  triggeredPhases?: number[];
}

/** 敌人技能 */
export interface EnemySkill {
  name: string;
  damage: number;
  element?: string;
  multiplier?: number;
  /** 技能类型 */
  type?: "attack" | "heal" | "buff" | "debuff" | "aoe";
  /** 使用冷却（回合数），0 = 无冷却 */
  cooldown?: number;
  /** 当前冷却剩余 */
  currentCooldown?: number;
  /** 治疗量（type=heal 时） */
  healAmount?: number;
}

/** BOSS 阶段 */
export interface BossPhase {
  /** 触发条件：HP 百分比阈值（如 0.5 = HP 低于 50% 时进入） */
  hpThreshold: number;
  /** 该阶段解锁的技能名列表 */
  unlockedSkills: string[];
  /** 进入阶段时的叙事描述 */
  description?: string;
}

/** AI 决策结果 */
export interface EnemyAction {
  type: "attack" | "skill" | "defend" | "heal";
  /** 使用的技能（type=skill 或 type=heal 时） */
  skill?: EnemySkill;
  /** 攻击目标索引（多目标战斗预留，目前固定 0 即玩家） */
  targetIndex: number;
  /** 阶段变化描述（BOSS 切阶段时） */
  phaseChange?: string;
}

// ============================================================
// AI 决策核心
// ============================================================

/**
 * 敌人 AI 决策
 *
 * @param enemy      - 敌人当前状态
 * @param roundNumber - 当前回合数
 * @returns 本回合的行动决策
 */
export function decideEnemyAction(
  enemy: EnemyState,
  roundNumber: number
): EnemyAction {
  const hpPercent = enemy.hp / enemy.maxHp;
  const isBoss = !!enemy.phases?.length;

  // 检查 BOSS 阶段变化（只在首次进入时通知）
  let phaseChange: string | undefined;
  if (isBoss && enemy.phases) {
    if (!enemy.triggeredPhases) enemy.triggeredPhases = [];
    for (let i = 0; i < enemy.phases.length; i++) {
      const phase = enemy.phases[i];
      if (hpPercent <= phase.hpThreshold && !enemy.triggeredPhases.includes(i)) {
        enemy.triggeredPhases.push(i);
        phaseChange = phase.description;
        break; // 本回合只通知一个新阶段
      }
    }
  }

  // 获取可用技能（排除冷却中的）
  const availableSkills = getAvailableSkills(enemy, roundNumber);

  // BOSS 阶段解锁技能过滤
  const phaseSkills = isBoss
    ? getPhaseSkills(enemy, availableSkills)
    : availableSkills;

  // ---- 决策逻辑 ----

  // 1. 低 HP（< 30%）：优先治疗或防御
  if (hpPercent < 0.3) {
    const healSkill = phaseSkills.find((s) => s.type === "heal");
    if (healSkill) {
      return { type: "heal", skill: healSkill, targetIndex: 0, phaseChange };
    }
    // 30% 概率防御
    if (Math.random() < 0.3) {
      return { type: "defend", targetIndex: 0, phaseChange };
    }
  }

  // 将攻击类和非攻击类技能分开
  const attackSkills = phaseSkills.filter(
    (s) => !s.type || s.type === "attack" || s.type === "aoe"
  );

  // 2. 中 HP（30%-60%）：优先使用强力攻击技能
  if (hpPercent < 0.6 && attackSkills.length > 0) {
    // 80% 概率用技能
    if (Math.random() < 0.8) {
      const skill = weightedSkillSelect(attackSkills, "aggressive");
      if (skill) {
        return { type: "skill", skill, targetIndex: 0, phaseChange };
      }
    }
  }

  // 3. 高 HP（>60%）：混合策略（攻击技能 + buff 技能，排除 heal）
  const nonHealSkills = phaseSkills.filter((s) => s.type !== "heal");
  if (nonHealSkills.length > 0 && Math.random() < 0.5) {
    const skill = weightedSkillSelect(nonHealSkills, "balanced");
    if (skill) {
      return { type: "skill", skill, targetIndex: 0, phaseChange };
    }
  }

  // 4. 默认普通攻击
  return { type: "attack", targetIndex: 0, phaseChange };
}

// ============================================================
// 辅助函数
// ============================================================

/** 获取当前可用技能（排除冷却中的） */
function getAvailableSkills(
  enemy: EnemyState,
  _roundNumber: number
): EnemySkill[] {
  return enemy.skills.filter((s) => {
    if (!s.cooldown) return true;
    return (s.currentCooldown ?? 0) <= 0;
  });
}

/** 获取 BOSS 当前阶段可用的技能 */
function getPhaseSkills(
  enemy: EnemyState,
  availableSkills: EnemySkill[]
): EnemySkill[] {
  if (!enemy.phases?.length) return availableSkills;

  const hpPercent = enemy.hp / enemy.maxHp;

  // 收集所有已激活阶段解锁的技能名
  const unlockedNames = new Set<string>();
  for (const phase of enemy.phases) {
    if (hpPercent <= phase.hpThreshold) {
      phase.unlockedSkills.forEach((n) => unlockedNames.add(n));
    }
  }

  // 基础技能（不在任何阶段限制列表中的）始终可用
  const allPhaseSkillNames = new Set(
    enemy.phases.flatMap((p) => p.unlockedSkills)
  );

  return availableSkills.filter(
    (s) => !allPhaseSkillNames.has(s.name) || unlockedNames.has(s.name)
  );
}

/** 加权技能选择 */
function weightedSkillSelect(
  skills: EnemySkill[],
  strategy: "aggressive" | "balanced"
): EnemySkill | null {
  if (skills.length === 0) return null;

  const weights = skills.map((s) => {
    let w = 1;
    if (strategy === "aggressive") {
      // 高伤害技能权重更高
      w = (s.damage ?? 10) / 10;
      if (s.type === "aoe") w *= 1.5;
    } else {
      // 平均分配
      w = 1;
      if (s.type === "buff") w = 1.5;
    }
    return w;
  });

  const totalWeight = weights.reduce((a, b) => a + b, 0);
  let roll = Math.random() * totalWeight;

  for (let i = 0; i < skills.length; i++) {
    roll -= weights[i];
    if (roll <= 0) return skills[i];
  }

  return skills[skills.length - 1];
}

/**
 * 更新技能冷却（回合结束时调用）
 */
export function tickEnemyCooldowns(enemy: EnemyState): void {
  for (const skill of enemy.skills) {
    if (skill.currentCooldown && skill.currentCooldown > 0) {
      skill.currentCooldown--;
    }
  }
}

/**
 * 标记技能已使用（设置冷却）
 */
export function markSkillUsed(skill: EnemySkill): void {
  if (skill.cooldown) {
    skill.currentCooldown = skill.cooldown;
  }
}
