/**
 * ChaosSaga - 回合制战斗引擎
 *
 * 核心循环：
 * 1. 按速度排序行动顺序
 * 2. 执行玩家行动（来自 AI tool_call）
 * 3. 执行敌人行动（enemy-ai 决策）
 * 4. 结算 Buff/Debuff
 * 5. 检查胜负条件
 * 6. 返回回合结果
 */

import { calculateDamage, calculateHeal, type SkillInfo } from "./damage-calc";
import {
  decideEnemyAction,
  tickEnemyCooldowns,
  markSkillUsed,
  type EnemyState,
  type EnemyAction,
} from "./enemy-ai";
import { calculateDrops, type DropResult, type DefeatedEnemy } from "./drop-system";
import { type BuffEntry, tickBuffs } from "./player-calc";
import { calcTurnOrder } from "./formulas";

// ============================================================
// 类型定义
// ============================================================

/** 玩家战斗状态 */
export interface PlayerBattleState {
  id: string;
  name: string;
  level: number;
  hp: number;
  maxHp: number;
  mp: number;
  maxMp: number;
  attack: number;
  defense: number;
  speed: number;
  element?: string;
  buffs: BuffEntry[];
  /** 装备的技能列表 */
  skills: PlayerBattleSkill[];
}

/** 玩家战斗技能 */
export interface PlayerBattleSkill {
  id: string;
  name: string;
  damage: number;
  element: string;
  mpCost: number;
  cooldown: number;
  currentCooldown?: number;
  effect?: Record<string, unknown>;
}

/** 玩家行动指令 */
export interface PlayerAction {
  type: "attack" | "skill" | "defend" | "item" | "flee";
  skillId?: string;
  itemId?: string;
  targetIndex?: number;
}

/** 使用的物品信息 */
export interface BattleItem {
  id: string;
  name: string;
  hpRestore: number;
  mpRestore: number;
}

/** 回合结果 */
export interface TurnResult {
  round: number;
  /** 玩家行动结果 */
  playerAction: PlayerActionResult;
  /** 敌人行动结果列表 */
  enemyActions: EnemyActionResult[];
  /** 回合结束后的战斗状态 */
  battleStatus: "active" | "won" | "lost" | "fled";
  /** 胜利时的掉落奖励 */
  rewards: DropResult | null;
  /** 回合结束后玩家状态 */
  playerState: {
    hp: number;
    maxHp: number;
    mp: number;
    maxMp: number;
  };
  /** 回合结束后敌人状态 */
  enemyStates: Array<{
    name: string;
    hp: number;
    maxHp: number;
    alive: boolean;
  }>;
}

/** 玩家行动结果 */
export interface PlayerActionResult {
  type: string;
  success: boolean;
  /** 造成的伤害 */
  damage?: number;
  isCrit?: boolean;
  /** 目标名称 */
  targetName?: string;
  targetHpAfter?: number;
  targetMaxHp?: number;
  isKill?: boolean;
  /** 使用的技能名 */
  skillName?: string;
  mpCost?: number;
  /** 使用的物品名 */
  itemName?: string;
  hpRestored?: number;
  mpRestored?: number;
  /** 防御状态 */
  defenseBonus?: string;
  /** 元素关系 */
  elementRelation?: string;
  /** 逃跑结果 */
  fleeSuccess?: boolean;
}

/** 敌人行动结果 */
export interface EnemyActionResult {
  attackerName: string;
  type: string;
  damage?: number;
  isCrit?: boolean;
  skillName?: string;
  healAmount?: number;
  /** BOSS 阶段变化 */
  phaseChange?: string;
}

// ============================================================
// 战斗引擎
// ============================================================

/**
 * 处理一个完整回合
 *
 * @param player      - 玩家战斗状态（会被直接修改）
 * @param enemies     - 敌人列表（会被直接修改）
 * @param action      - 玩家行动指令
 * @param roundNumber - 当前回合数
 * @param item        - 使用的物品信息（action.type === "item" 时）
 */
export function processTurn(
  player: PlayerBattleState,
  enemies: EnemyState[],
  action: PlayerAction,
  roundNumber: number,
  item?: BattleItem
): TurnResult {
  const isDefending = action.type === "defend";

  // ======== 1. 按速度排序行动顺序 ========
  const aliveEnemies = enemies.filter((e) => e.hp > 0);
  const participants = [
    { id: "__player__", speed: player.speed },
    ...aliveEnemies.map((e, i) => ({ id: `enemy_${i}`, speed: e.speed })),
  ];
  const turnOrder = calcTurnOrder(participants);

  let playerActionResult: PlayerActionResult | null = null;
  const enemyActions: EnemyActionResult[] = [];
  let playerActed = false;

  for (const actorId of turnOrder) {
    // 战斗已结束则中断
    if (player.hp <= 0 || enemies.every((e) => e.hp <= 0)) break;

    if (actorId === "__player__" && !playerActed) {
      // ---- 玩家行动 ----
      playerActed = true;
      playerActionResult = executePlayerAction(player, enemies, action, item);

      // 逃跑成功 → 直接返回
      if (action.type === "flee" && playerActionResult.fleeSuccess) {
        return {
          round: roundNumber,
          playerAction: playerActionResult,
          enemyActions: [],
          battleStatus: "fled",
          rewards: null,
          playerState: {
            hp: player.hp,
            maxHp: player.maxHp,
            mp: player.mp,
            maxMp: player.maxMp,
          },
          enemyStates: enemies.map((e) => ({
            name: e.name,
            hp: e.hp,
            maxHp: e.maxHp,
            alive: e.hp > 0,
          })),
        };
      }

      // 检查敌人是否全灭
      if (enemies.every((e) => e.hp <= 0)) break;
    } else if (actorId.startsWith("enemy_")) {
      // ---- 敌人行动 ----
      const enemyIdx = parseInt(actorId.split("_")[1]);
      const enemy = aliveEnemies[enemyIdx];
      if (!enemy || enemy.hp <= 0) continue;

      const decision = decideEnemyAction(enemy, roundNumber);
      const result = executeEnemyAction(enemy, decision, player, isDefending);
      enemyActions.push(result);

      if (player.hp <= 0) break;
    }
  }

  // 如果速度排序导致玩家未行动（极端情况），兜底执行
  if (!playerActed) {
    playerActionResult = executePlayerAction(player, enemies, action, item);
  }

  // ======== 2. 回合结算 ========
  // Buff 倒计时
  player.buffs = tickBuffs(player.buffs);
  // 敌人技能冷却
  for (const enemy of enemies.filter((e) => e.hp > 0)) {
    tickEnemyCooldowns(enemy);
  }
  // 玩家技能冷却
  for (const skill of player.skills) {
    if (skill.currentCooldown && skill.currentCooldown > 0) {
      skill.currentCooldown--;
    }
  }

  // ======== 3. 胜负判定 ========
  const allDead = enemies.every((e) => e.hp <= 0);
  const playerDead = player.hp <= 0;
  const status = allDead ? "won" : playerDead ? "lost" : "active";

  const rewards = status === "won" ? calculateRewards(enemies, player.level) : null;

  return buildResult(roundNumber, playerActionResult!, enemyActions, status, rewards, player, enemies);
}

// ============================================================
// 玩家行动执行
// ============================================================

function executePlayerAction(
  player: PlayerBattleState,
  enemies: EnemyState[],
  action: PlayerAction,
  item?: BattleItem
): PlayerActionResult {
  const aliveEnemies = enemies.filter((e) => e.hp > 0);
  const targetIdx = Math.min(action.targetIndex ?? 0, aliveEnemies.length - 1);
  const target = aliveEnemies[targetIdx];

  // ---- flee ----
  if (action.type === "flee") {
    const avgSpeed = aliveEnemies.reduce((s, e) => s + e.speed, 0) / (aliveEnemies.length || 1);
    const chance = Math.max(0.1, Math.min(0.9, 0.3 + (player.speed - avgSpeed) * 0.02));
    const fled = Math.random() < chance;
    return { type: "flee", success: fled, fleeSuccess: fled };
  }

  // ---- defend ----
  if (action.type === "defend") {
    return { type: "defend", success: true, defenseBonus: "本回合受伤减半" };
  }

  // ---- item ----
  if (action.type === "item" && item) {
    const hpBefore = player.hp;
    const mpBefore = player.mp;
    player.hp = Math.min(player.maxHp, player.hp + item.hpRestore);
    player.mp = Math.min(player.maxMp, player.mp + item.mpRestore);
    return {
      type: "item",
      success: true,
      itemName: item.name,
      hpRestored: player.hp - hpBefore,
      mpRestored: player.mp - mpBefore,
    };
  }

  if (!target) {
    return { type: action.type, success: false };
  }

  // ---- skill ----
  if (action.type === "skill" && action.skillId) {
    const skill = player.skills.find((s) => s.id === action.skillId);
    if (!skill) return { type: "skill", success: false };
    if (player.mp < skill.mpCost) return { type: "skill", success: false };

    player.mp -= skill.mpCost;
    if (skill.cooldown) skill.currentCooldown = skill.cooldown;

    // 治疗类技能 → 恢复玩家 HP
    const skillEffect = skill.effect as { type?: string; value?: number } | undefined;
    if (skillEffect?.type === "heal" && skillEffect.value) {
      const healAmount = calculateHeal(player.attack, skillEffect.value);
      const hpBefore = player.hp;
      player.hp = Math.min(player.maxHp, player.hp + healAmount);
      return {
        type: "skill",
        success: true,
        skillName: skill.name,
        mpCost: skill.mpCost,
        hpRestored: player.hp - hpBefore,
      };
    }

    // 攻击类技能 → 对敌人造成伤害
    const skillInfo: SkillInfo = {
      name: skill.name,
      damage: skill.damage,
      element: skill.element,
    };

    const dmgResult = calculateDamage(
      { name: player.name, attack: player.attack, defense: player.defense, speed: player.speed, element: player.element },
      { name: target.name, attack: target.attack, defense: target.defense, speed: target.speed, element: target.element },
      skillInfo
    );

    target.hp = Math.max(0, target.hp - dmgResult.damage);

    return {
      type: "skill",
      success: true,
      damage: dmgResult.damage,
      isCrit: dmgResult.isCrit,
      targetName: target.name,
      targetHpAfter: target.hp,
      targetMaxHp: target.maxHp,
      isKill: target.hp <= 0,
      skillName: skill.name,
      mpCost: skill.mpCost,
      elementRelation: dmgResult.elementRelation,
    };
  }

  // ---- attack (普通攻击) ----
  const dmgResult = calculateDamage(
    { name: player.name, attack: player.attack, defense: player.defense, speed: player.speed, element: player.element },
    { name: target.name, attack: target.attack, defense: target.defense, speed: target.speed, element: target.element }
  );

  target.hp = Math.max(0, target.hp - dmgResult.damage);

  return {
    type: "attack",
    success: true,
    damage: dmgResult.damage,
    isCrit: dmgResult.isCrit,
    targetName: target.name,
    targetHpAfter: target.hp,
    targetMaxHp: target.maxHp,
    isKill: target.hp <= 0,
    elementRelation: dmgResult.elementRelation,
  };
}

// ============================================================
// 敌人行动执行
// ============================================================

function executeEnemyAction(
  enemy: EnemyState,
  decision: EnemyAction,
  player: PlayerBattleState,
  playerDefending: boolean
): EnemyActionResult {
  const result: EnemyActionResult = {
    attackerName: enemy.name,
    type: decision.type,
    phaseChange: decision.phaseChange,
  };

  if (decision.type === "defend") {
    // 敌人防御 → 本回合不攻击，但也不受伤减半（简化）
    return result;
  }

  if (decision.type === "heal" && decision.skill?.healAmount) {
    const heal = calculateHeal(enemy.attack, decision.skill.healAmount);
    enemy.hp = Math.min(enemy.maxHp, enemy.hp + heal);
    markSkillUsed(decision.skill);
    result.healAmount = heal;
    result.skillName = decision.skill.name;
    return result;
  }

  // 攻击或技能攻击
  const skillInfo: SkillInfo | null = decision.skill
    ? {
        name: decision.skill.name,
        damage: decision.skill.damage,
        element: decision.skill.element,
        multiplier: decision.skill.multiplier,
      }
    : null;

  if (decision.skill) markSkillUsed(decision.skill);

  const dmgResult = calculateDamage(
    { name: enemy.name, attack: enemy.attack, defense: enemy.defense, speed: enemy.speed, element: enemy.element },
    { name: player.name, attack: player.attack, defense: player.defense, speed: player.speed, element: player.element },
    skillInfo,
    playerDefending
  );

  player.hp = Math.max(0, player.hp - dmgResult.damage);

  result.damage = dmgResult.damage;
  result.isCrit = dmgResult.isCrit;
  if (decision.skill) result.skillName = decision.skill.name;

  return result;
}

// ============================================================
// 奖励计算
// ============================================================

function calculateRewards(
  enemies: EnemyState[],
  playerLevel: number
): DropResult {
  const defeated: DefeatedEnemy[] = enemies.map((e) => ({
    name: e.name,
    level: e.level,
    drops: e.drops as DefeatedEnemy["drops"],
  }));
  return calculateDrops(defeated, playerLevel);
}

// ============================================================
// 结果构建
// ============================================================

function buildResult(
  round: number,
  playerAction: PlayerActionResult,
  enemyActions: EnemyActionResult[],
  battleStatus: TurnResult["battleStatus"],
  rewards: DropResult | null,
  player: PlayerBattleState,
  enemies: EnemyState[]
): TurnResult {
  return {
    round,
    playerAction,
    enemyActions,
    battleStatus,
    rewards,
    playerState: {
      hp: player.hp,
      maxHp: player.maxHp,
      mp: player.mp,
      maxMp: player.maxMp,
    },
    enemyStates: enemies.map((e) => ({
      name: e.name,
      hp: e.hp,
      maxHp: e.maxHp,
      alive: e.hp > 0,
    })),
  };
}
