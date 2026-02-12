/**
 * 行动类工具 - 执行游戏行动（战斗、移动、使用物品等）
 */

import type { NormalizedTool } from "../adapters/types";
import { prisma } from "@/lib/db/prisma";
import {
  processTurn,
  type PlayerBattleState,
  type PlayerBattleSkill,
  type BattleItem,
  type TurnResult,
} from "@/lib/game/battle-engine";
import type { EnemyState } from "@/lib/game/enemy-ai";
import { checkLevelUp, calcBaseStats, type Realm } from "@/lib/game/formulas";
import { calcFinalStats } from "@/lib/game/player-calc";
import type { DropTemplate } from "@/lib/game/drop-system";
import { resolveItem, resolveSkill, resolveNpc } from "./resolve-id";
import { logPlayerAction } from "@/lib/game/logger";

// ============================================================
// 工具定义
// ============================================================

export const actionToolDefinitions: NormalizedTool[] = [
  {
    name: "start_battle",
    description:
      "发起一场战斗。可指定敌人，也可省略由系统根据当前区域随机生成。返回战斗ID和初始状态",
    parameters: {
      type: "object",
      properties: {
        enemies: {
          type: "array",
          items: {
            type: "object",
            properties: {
              name: { type: "string" },
              level: { type: "number" },
              element: {
                type: "string",
                enum: ["water", "fire", "earth", "wind", "dark", "light", "none"],
              },
            },
            required: ["name", "level"],
          },
          description: "敌人列表。如果省略，根据当前区域随机生成",
        },
        enemyCount: {
          type: "number",
          description: "随机生成的敌人数量。仅在 enemies 为空时有效。默认为 1-3 随机",
        },
      },
    },
  },
  {
    name: "execute_battle_action",
    description:
      "执行一个战斗行动（使用技能、普攻、防御、使用道具）。调用传统战斗引擎计算结果。返回本回合详细结果",
    parameters: {
      type: "object",
      properties: {
        battleId: { type: "string" },
        action: {
          type: "object",
          properties: {
            type: {
              type: "string",
              enum: ["attack", "skill", "defend", "item", "flee"],
            },
            skillId: { type: "string", description: "技能ID（type=skill时）" },
            itemId: { type: "string", description: "物品ID（type=item时）" },
            targetIndex: { type: "number", description: "目标敌人索引，默认0" },
          },
          required: ["type"],
        },
      },
      required: ["battleId", "action"],
    },
  },
  {
    name: "use_item",
    description: "使用背包中的物品（消耗品或装备）。可传入物品名或ID",
    parameters: {
      type: "object",
      properties: {
        itemId: { type: "string", description: "物品ID 或 名称" },
        targetSlot: { type: "string", description: "装备目标槽位（穿戴装备时）" },
      },
      required: ["itemId"],
    },
  },
  // move_to_node: 已迁移至 /api/player/move (UI驱动移动)，不再作为 LLM 工具
  {
    name: "interact_npc",
    description:
      "与NPC交互。支持对话(talk)、购买物品(buy)、出售物品(sell)、以物易物(exchange)、治疗(heal)、训练(train)、接取任务(accept_quest)、提交任务(submit_quest)。\nbuy: data={itemName, quantity}\nsell: data={itemId}\nexchange: data={ give: [{itemId, quantity}], receive: [{name, type, ...}] } // 类似add_item的物品结构\ntrain: data={skillId}\nquest: data={questId}",
    parameters: {
      type: "object",
      properties: {
        npcId: { type: "string", description: "NPC ID 或 名称" },
        action: {
          type: "string",
          enum: ["talk", "buy", "sell", "exchange", "heal", "train", "accept_quest", "submit_quest"],
        },
        data: {
          type: "object",
          description: "附加数据。buy: {itemName, quantity}, sell: {itemId}, exchange: {give:[{itemId, quantity}], receive:[{name, type, quality, quantity, stats, specialEffect}]}, train: {skillId}, quest: {questId}",
        },
      },
      required: ["npcId", "action"],
    },
  },
  // enhance_equipment: removed (unimplemented stub)
];

// ============================================================
// 工具执行
// ============================================================

/** 从等级生成敌人属性 */
function buildEnemyStats(e: {
  name: string; level: number; element?: string;
  hp?: number; attack?: number; defense?: number; speed?: number;
  skills?: Array<{
    name: string; damage?: number; element?: string;
    type?: "attack" | "heal" | "buff" | "debuff" | "aoe";
    multiplier?: number; cooldown?: number; healAmount?: number;
  }>;
  drops?: DropTemplate[];
  phases?: Array<{ hpThreshold: number; unlockedSkills: string[]; description?: string }>;
}): BattleEnemy {
  const level = e.level;
  const hp = e.hp ?? Math.floor(50 + level * 20 + Math.random() * level * 10);
  return {
    name: e.name,
    level,
    element: e.element || "none",
    hp,
    maxHp: hp,
    attack: e.attack ?? Math.floor(5 + level * 3 + Math.random() * level * 2),
    defense: e.defense ?? Math.floor(3 + level * 2 + Math.random() * level),
    speed: e.speed ?? Math.floor(5 + level * 2 + Math.random() * level),
    skills: e.skills ?? [],
    drops: e.drops,
    phases: e.phases,
  };
}

export async function startBattle(
  args: Record<string, unknown>,
  playerId: string
) {
  const enemyInput = args.enemies as Array<{ name: string; level: number; element?: string }> | undefined;
  const countInput = args.enemyCount as number | undefined;

  // 获取玩家信息（含当前节点）
  const player = await prisma.player.findUnique({ where: { id: playerId } });
  if (!player) return { success: false, error: "玩家不存在" };

  let enemies: BattleEnemy[];

  if (enemyInput && enemyInput.length > 0) {
    // AI 明确指定了敌人
    enemies = enemyInput.map((e) => buildEnemyStats(e));
  } else {
    // 未指定敌人 → 从当前节点的 enemyTemplates 随机抽取
    enemies = await (async () => {
      if (player.currentNodeId) {
        const node = await prisma.areaNode.findUnique({
          where: { id: player.currentNodeId },
          select: { data: true, type: true },
        });
        const nodeData = node?.data as Record<string, unknown> | null;

        if (node?.type === "boss" && nodeData?.boss) {
          // BOSS 节点：直接使用 boss 数据（含 drops、phases、技能完整信息）
          // ... (omitted for brevity, no change here)
          const boss = nodeData.boss as {
            name: string; level: number; element?: string;
            hp?: number; attack?: number; defense?: number; speed?: number;
            skills?: Array<{
              name: string; damage?: number; element?: string;
              type?: "attack" | "heal" | "buff" | "debuff" | "aoe";
              multiplier?: number; cooldown?: number; healAmount?: number;
            }>;
            drops?: DropTemplate[];
            phases?: Array<{ hpThreshold: number; unlockedSkills: string[]; description?: string }>;
          };
          return [buildEnemyStats(boss)];
        }

        if (nodeData?.enemyTemplates) {
          // 战斗节点：从 enemyTemplates 随机抽取
          const templates = nodeData.enemyTemplates as Array<{
            name: string; level: number; element?: string;
            hp?: number; attack?: number; defense?: number;
          }>;
          
          let count = 1;
          if (countInput && countInput > 0) {
             count = countInput;
          } else {
             count = 1 + Math.floor(Math.random() * 2); // 默认 1-2
          }
          // 确保不超过模版总数（如果模版不够多，也没办法）
          // 实际上应该允许重复？比如 3只螃蟹，模版只有1个螃蟹。
          // 现有逻辑是 shuffled.slice(0, count)，如果不允许重复，最多只能 spawn templates.length
          // 我们应该允许重复抽取以支持“3只同样的怪”
          
          const selected: typeof templates = [];
          for (let i = 0; i < count; i++) {
            const template = templates[Math.floor(Math.random() * templates.length)];
            selected.push(template);
          }
          
          return selected.map((t) => buildEnemyStats(t));
        }
      }

      // 最终兜底：根据玩家等级生成泛用敌人
      return [buildEnemyStats({ name: "野怪", level: player.level })];
    })();
  }

  // 清除旧战斗状态
  await prisma.battleState.deleteMany({ where: { playerId } });

  // 创建新战斗
  const battle = await prisma.battleState.create({
    data: {
      playerId,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      enemies: enemies as any,
      roundNumber: 1,
      status: "active",
    },
  });

  await logPlayerAction(
    playerId,
    "battle",
    `遭遇敌人：${enemies.map((e) => e.name).join("、")}`,
    { battleId: battle.id, enemyCount: enemies.length }
  );

  return {
    success: true,
    data: {
      battleId: battle.id,
      enemies: enemies.map((e) => ({
        name: e.name,
        level: e.level,
        hp: e.hp,
        maxHp: e.maxHp,
        element: e.element,
      })),
      playerHp: player.hp,
      playerMaxHp: player.maxHp,
    },
  };
}

/** 战斗中敌人的完整类型（兼容 DB JSON 和 startBattle） */
interface BattleEnemy {
  name: string;
  level: number;
  element: string;
  hp: number;
  maxHp: number;
  attack: number;
  defense: number;
  speed: number;
  /** 完整技能信息（含 type/cooldown 等，保证跨回合不丢失） */
  skills: Array<{
    name: string;
    damage?: number;
    element?: string;
    type?: "attack" | "heal" | "buff" | "debuff" | "aoe";
    multiplier?: number;
    cooldown?: number;
    currentCooldown?: number;
    healAmount?: number;
  }>;
  /** BOSS 专属掉落表 */
  drops?: DropTemplate[];
  /** BOSS 阶段数据 */
  phases?: Array<{ hpThreshold: number; unlockedSkills: string[]; description?: string }>;
  /** 已触发的阶段索引 */
  triggeredPhases?: number[];
}

export async function executeBattleAction(
  args: Record<string, unknown>,
  playerId: string
) {
  let battleId = args.battleId as string | undefined;
  const action = args.action as {
    type: string;
    skillId?: string;
    itemId?: string;
    targetIndex?: number;
  } | undefined;

  // 自动查找活跃战斗 (Robustness Fix)
  if (!battleId) {
    const activeBattle = await prisma.battleState.findFirst({
      where: { playerId, status: "active" },
      select: { id: true }
    });
    if (activeBattle) {
      battleId = activeBattle.id;
    }
  }

  if (!battleId) return { success: false, error: "缺少 battleId 参数，且当前无活跃战斗" };
  if (!action || !action.type) return { success: false, error: "缺少 action 参数，需要 { type: 'attack'|'skill'|'item'|'flee', ... }" };

  // ---- 加载数据 ----
  const battle = await prisma.battleState.findUnique({ where: { id: battleId } });
  if (!battle || battle.playerId !== playerId) {
    return { success: false, error: "战斗不存在" };
  }
  if (battle.status !== "active") {
    return { success: false, error: `战斗已结束: ${battle.status}` };
  }

  const player = await prisma.player.findUnique({
    where: { id: playerId },
    include: { skills: { where: { equipped: true } }, inventory: true },
  });
  if (!player) return { success: false, error: "玩家不存在" };

  // ---- 构建战斗引擎输入（保留完整字段，保证跨回合不丢失） ----
  const dbEnemies = battle.enemies as unknown as BattleEnemy[];
  const enemyStates: EnemyState[] = dbEnemies.map((e) => ({
    name: e.name,
    level: e.level,
    element: e.element,
    hp: e.hp,
    maxHp: e.maxHp,
    attack: e.attack,
    defense: e.defense,
    speed: e.speed,
    skills: (e.skills ?? []).map((s) => ({
      name: s.name,
      damage: s.damage ?? 0,
      element: s.element,
      type: s.type,
      multiplier: s.multiplier,
      cooldown: s.cooldown,
      currentCooldown: s.currentCooldown,
      healAmount: s.healAmount,
    })),
    drops: e.drops,
    phases: e.phases,
    triggeredPhases: e.triggeredPhases,
  }));

  // 计算装备加成后的最终属性
  const equippedItems = player.inventory
    .filter((i) => i.equipped)
    .map((i) => ({ stats: i.stats as Record<string, unknown> | null }));
  const finalStats = calcFinalStats(
    player.level,
    player.realm as Realm,
    equippedItems
  );

  const playerSkills: PlayerBattleSkill[] = player.skills.map((s) => ({
    id: s.id,
    name: s.name,
    damage: s.damage,
    element: s.element,
    mpCost: s.mpCost,
    cooldown: s.cooldown,
    effect: s.effect as Record<string, unknown> | undefined,
  }));

  // ---- 技能ID解析：使用集中式解析器 ----
  if (action.type === "skill" && action.skillId) {
    const resolved = await resolveSkill(action.skillId, playerId);
    if (!resolved.found) {
      return { success: false, error: resolved.error };
    }
    action.skillId = resolved.record.id;
  }

  const playerState: PlayerBattleState = {
    id: player.id,
    name: player.name,
    level: player.level,
    hp: player.hp,
    maxHp: finalStats.maxHp,
    mp: player.mp,
    maxMp: finalStats.maxMp,
    attack: finalStats.attack,
    defense: finalStats.defense,
    speed: finalStats.speed,
    buffs: [],
    skills: playerSkills,
  };

  // ---- 处理物品使用（需要 DB 操作） ----
  let battleItem: BattleItem | undefined;
  if (action.type === "item" && action.itemId) {
    const item = player.inventory.find(
      (i) => i.id === action.itemId && i.type === "consumable"
    );
    if (!item) return { success: false, error: "物品不存在或非消耗品" };

    const stats = item.stats as Record<string, number> | null;
    battleItem = {
      id: item.id,
      name: item.name,
      hpRestore: stats?.hpRestore ?? 0,
      mpRestore: stats?.mpRestore ?? 0,
    };

    // 消耗物品
    if (item.quantity <= 1) {
      await prisma.inventoryItem.delete({ where: { id: item.id } });
    } else {
      await prisma.inventoryItem.update({
        where: { id: item.id },
        data: { quantity: { decrement: 1 } },
      });
    }
  }

  // ---- 调用战斗引擎 ----
  const turnResult = processTurn(
    playerState,
    enemyStates,
    {
      type: action.type as "attack" | "skill" | "defend" | "item" | "flee",
      skillId: action.skillId,
      itemId: action.itemId,
      targetIndex: action.targetIndex,
    },
    battle.roundNumber,
    battleItem
  );

  // ---- 持久化结果到 DB（保留完整数据，保证跨回合不丢失） ----
  const updatedEnemies: BattleEnemy[] = enemyStates.map((e) => ({
    name: e.name,
    level: e.level,
    element: e.element,
    hp: e.hp,
    maxHp: e.maxHp,
    attack: e.attack,
    defense: e.defense,
    speed: e.speed,
    skills: e.skills,
    drops: e.drops,
    phases: e.phases,
    triggeredPhases: e.triggeredPhases,
  }));

  await prisma.battleState.update({
    where: { id: battleId },
    data: {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      enemies: updatedEnemies as any,
      roundNumber: battle.roundNumber + 1,
      status: turnResult.battleStatus,
    },
  });

  // 更新玩家 HP/MP
  await prisma.player.update({
    where: { id: playerId },
    data: {
      hp: turnResult.playerState.hp,
      mp: turnResult.playerState.mp,
    },
  });

  // 胜利奖励
  let levelUpInfo: { levelsGained: number; newLevel: number } | null = null;
  if (turnResult.battleStatus === "won" && turnResult.rewards) {
    const { exp, gold } = turnResult.rewards;

    // 先增加经验和金币
    const updatedPlayer = await prisma.player.update({
      where: { id: playerId },
      data: {
        exp: { increment: exp },
        gold: { increment: gold },
      },
    });

    // 检查升级
    const levelCheck = checkLevelUp(updatedPlayer.level, updatedPlayer.exp);
    if (levelCheck.levelsGained > 0) {
      // 计算新属性
      const newStats = calcBaseStats(levelCheck.newLevel, updatedPlayer.realm as Realm);
      await prisma.player.update({
        where: { id: playerId },
        data: {
          level: levelCheck.newLevel,
          exp: levelCheck.remainingExp,
          maxHp: newStats.maxHp,
          maxMp: newStats.maxMp,
          attack: newStats.attack,
          defense: newStats.defense,
          speed: newStats.speed,
          // 升级回满 HP/MP
          hp: newStats.maxHp,
          mp: newStats.maxMp,
        },
      });
      levelUpInfo = {
        levelsGained: levelCheck.levelsGained,
        newLevel: levelCheck.newLevel,
      };

      await logPlayerAction(
        playerId,
        "levelup",
        `恭喜升级！当前等级：${levelCheck.newLevel}`,
        { level: levelCheck.newLevel, levelsGained: levelCheck.levelsGained }
      );
    }

    // 掉落物品写入背包（区分技能和普通物品）
    for (const drop of turnResult.rewards.items) {
      if (drop.type === "skill" && drop.skillData) {
        // 技能掉落 → 添加到玩家技能表
        await prisma.playerSkill.create({
          data: {
            playerId,
            name: drop.name,
            element: drop.skillData.element,
            damage: drop.skillData.damage,
            mpCost: drop.skillData.mpCost,
            cooldown: drop.skillData.cooldown,
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            effect: drop.skillData.effect ? (drop.skillData.effect as any) : undefined,
            equipped: false,
          },
        });
      } else {
        // 普通物品 → 添加到背包
        await prisma.inventoryItem.create({
          data: {
            playerId,
            name: drop.name,
            type: drop.type,
            quality: drop.quality,
            quantity: drop.quantity,
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            stats: drop.stats ? (drop.stats as any) : undefined,
          },
        });
        }
    }

    await logPlayerAction(
      playerId,
      "battle_win",
      `战斗胜利！获得 ${exp} 经验，${gold} 金币，${turnResult.rewards.items.length} 件物品。`,
      { exp, gold, items: turnResult.rewards.items.map(i => i.name) }
    );
    }

  let defeatPenalty: { goldLost: number; recovery: string } | null = null;
  if (turnResult.battleStatus === "lost") {
    const goldLost = Math.floor(player.gold * 0.3); // 损失 30% 金币

    // 更新玩家状态：扣除金币，回满状态
    await prisma.player.update({
      where: { id: playerId },
      data: {
        gold: { decrement: goldLost },
        hp: finalStats.maxHp,
        mp: finalStats.maxMp,
      },
      // 注意：这里没有修改 EXP，根据需求只扣金币
    });

    await logPlayerAction(
      playerId,
      "battle_loss",
      `战斗失败！昏迷后被救援，损失了 ${goldLost} 金币。状态已恢复。`,
      { goldLost }
    );

    // 移除战斗状态
    await prisma.battleState.delete({ where: { id: battleId } });

    defeatPenalty = {
      goldLost,
      recovery: "健康状态已完全恢复",
    };
  }

  // 胜利后续处理（清理战斗状态）
  if (turnResult.battleStatus === "won") {
      await prisma.battleState.delete({ where: { id: battleId } });
  }

  // ---- 读取最新玩家状态以构造准确的 stateUpdate ----
  const latestPlayer = await prisma.player.findUnique({
    where: { id: playerId },
    select: { hp: true, mp: true, maxHp: true, maxMp: true, exp: true, gold: true, level: true, attack: true, defense: true, speed: true },
  });

  // ---- 构造返回结果 ----
  const summary = buildTurnSummary(turnResult);

  return {
    success: true,
    data: {
      round: battle.roundNumber,
      // 文本摘要：帮助 AI 快速理解本回合发生的事情（尤其是敌人行动），请务必在叙事中体现！
      summary,
      playerAction: turnResult.playerAction,
      enemyActions: turnResult.enemyActions,
      battleStatus: turnResult.battleStatus,
      rewards: turnResult.rewards
        ? {
            exp: turnResult.rewards.exp,
            gold: turnResult.rewards.gold,
            items: turnResult.rewards.items.map((i) => ({
              name: i.name,
              quality: i.quality,
            })),
            levelUp: levelUpInfo,
          }
        : null,
      enemyStates: turnResult.enemyStates,
      defeatPenalty, // 新增：失败惩罚信息
    },
    stateUpdate: latestPlayer
      ? {
          hp: latestPlayer.hp,
          mp: latestPlayer.mp,
          maxHp: latestPlayer.maxHp,
          maxMp: latestPlayer.maxMp,
          exp: latestPlayer.exp,
          gold: latestPlayer.gold,
          level: latestPlayer.level,
          attack: latestPlayer.attack,
          defense: latestPlayer.defense,
          speed: latestPlayer.speed,
        }
      : {
          hp: turnResult.playerState.hp,
          mp: turnResult.playerState.mp,
          maxHp: turnResult.playerState.maxHp,
          maxMp: turnResult.playerState.maxMp,
        },
  };
}

/**
 * 生成回合文本摘要，突出敌人行动信息
 */
function buildTurnSummary(result: TurnResult): string {
  const parts: string[] = [];

  // 玩家行动摘要
  const pa = result.playerAction;
  if (pa.type === "attack" || pa.type === "skill") {
    const skillPart = pa.skillName ? `使用${pa.skillName}` : "普通攻击";
    const critPart = pa.isCrit ? "（暴击！）" : "";
    const elemPart = pa.elementRelation && pa.elementRelation !== "normal" ? `[${pa.elementRelation}]` : "";
    parts.push(`玩家${skillPart}攻击${pa.targetName}，造成${pa.damage}点伤害${critPart}${elemPart}。${pa.targetName}剩余HP ${pa.targetHpAfter}/${pa.targetMaxHp}${pa.isKill ? "（击杀！）" : ""}`);
  } else if (pa.type === "defend") {
    parts.push("玩家选择防御，本回合受伤减半。");
  } else if (pa.type === "item") {
    parts.push(`玩家使用${pa.itemName}，恢复HP${pa.hpRestored ?? 0}/MP${pa.mpRestored ?? 0}。`);
  } else if (pa.type === "flee") {
    parts.push(pa.fleeSuccess ? "玩家成功逃跑！" : "玩家逃跑失败！");
  }

  // 敌人行动摘要 —— 这是最关键的部分
  if (result.enemyActions.length > 0) {
    parts.push("【敌人回合】");
    for (const ea of result.enemyActions) {
      if (ea.phaseChange) {
        parts.push(`⚠ ${ea.attackerName}进入新阶段：${ea.phaseChange}`);
      }
      if (ea.type === "attack" || ea.type === "skill") {
        const skillPart = ea.skillName ? `使用${ea.skillName}` : "普通攻击";
        const critPart = ea.isCrit ? "（暴击！）" : "";
        parts.push(`${ea.attackerName}${skillPart}攻击玩家，造成${ea.damage}点伤害${critPart}。`);
      } else if (ea.type === "heal") {
        parts.push(`${ea.attackerName}使用${ea.skillName ?? "治愈"}恢复了${ea.healAmount}点HP。`);
      } else if (ea.type === "defend") {
        parts.push(`${ea.attackerName}选择防御。`);
      }
    }
  }

  // 当前战况
  const ps = result.playerState;
  parts.push(`当前战况：玩家HP ${ps.hp}/${ps.maxHp}, MP ${ps.mp}/${ps.maxMp}`);

  return parts.join("\n");
}

export async function useItem(
  args: Record<string, unknown>,
  playerId: string
) {
  const itemId = args.itemId as string | undefined;
  if (!itemId) return { success: false, error: "缺少 itemId 参数" };

  // 使用集中式解析器查找物品（支持 ID / 精确名称 / 模糊名称）
  const resolved = await resolveItem(itemId, playerId);
  if (!resolved.found) return { success: false, error: resolved.error };
  const item = resolved.record;

  if (item.type === "consumable") {
    const stats = item.stats as Record<string, number> | null;
    const hpRestore = stats?.hpRestore ?? 0;
    const mpRestore = stats?.mpRestore ?? 0;

    const player = await prisma.player.findUnique({ where: { id: playerId } });
    if (!player) return { success: false, error: "玩家不存在" };

    const newHp = Math.min(player.maxHp, player.hp + hpRestore);
    const newMp = Math.min(player.maxMp, player.mp + mpRestore);

    await prisma.player.update({
      where: { id: playerId },
      data: { hp: newHp, mp: newMp },
    });

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
      "item_use",
      `使用了 ${item.name}，恢复 HP ${hpRestore} / MP ${mpRestore}`,
      { itemId: item.id, hpRestore, mpRestore }
    );

    return {
      success: true,
      data: { used: item.name, hpRestore, mpRestore },
      stateUpdate: { hp: newHp, mp: newMp },
    };
  }

  // ---- 装备穿戴/卸下 ----
  const equipTypes = ["weapon", "armor", "accessory", "helmet", "boots"];
  if (equipTypes.includes(item.type)) {
    // 重新获取玩家（包括最新的背包状态，因为下面要重新计算属性）
    // 注意：我们需要在 DB 更新后再计算，但为了性能，我们可以手动模拟变化
    // 这里选择简单做法：先更新 DB，再查一次并计算
    
    if (item.equipped) {
      // 已装备 → 卸下
      await prisma.inventoryItem.update({
        where: { id: item.id },
        data: { equipped: false },
      });
    } else {
      // 未装备 → 穿上（同类型旧装备自动卸下）
      const playerCheck = await prisma.player.findUnique({
         where: { id: playerId },
         include: { inventory: { where: { equipped: true, type: item.type } } }
      });
      
      const existingEquipped = playerCheck?.inventory[0];
      if (existingEquipped) {
        await prisma.inventoryItem.update({
          where: { id: existingEquipped.id },
          data: { equipped: false },
        });
      }

      await prisma.inventoryItem.update({
        where: { id: item.id },
        data: { equipped: true },
      });
    }
    
    // 重新计算属性并更新到 DB (可选，如果Player表存储了非基础属性) 
    // 目前设计是 Player 表存 current hp/mp，但 maxHp/attack 等通常是动态计算
    // 但 context-builder 需要读取。为了前端 stateUpdate，我们需要计算最新值。
    
    const player = await prisma.player.findUnique({
      where: { id: playerId },
      include: {
        inventory: { where: { equipped: true } },
        skills: { where: { equipped: true } }
      },
    });
    
    if (!player) return { success: false, error: "玩家不存在" };

    const equippedItems = player.inventory.map((i) => ({ stats: i.stats as Record<string, unknown> | null }));
    const finalStats = calcFinalStats(player.level, player.realm as Realm, equippedItems);

    // 顺便更新玩家 maxHp/maxMp (如果设计需要持久化) - 这里仅返回给前端
    // 更新 HP/MP 避免溢出
    let hpUpdate = player.hp;
    let mpUpdate = player.mp;
    if (player.hp > finalStats.maxHp) hpUpdate = finalStats.maxHp;
    if (player.mp > finalStats.maxMp) mpUpdate = finalStats.maxMp;
    
    if (hpUpdate !== player.hp || mpUpdate !== player.mp) {
        await prisma.player.update({
            where: { id: playerId },
            data: { hp: hpUpdate, mp: mpUpdate }
        });
    }

    return {
      success: true,
      data: {
        action: item.equipped ? "unequipped" : "equipped", // 注意 item.equipped 是旧状态
        item: item.name,
        type: item.type,
      },
      stateUpdate: {
        maxHp: finalStats.maxHp,
        maxMp: finalStats.maxMp,
        attack: finalStats.attack,
        defense: finalStats.defense,
        speed: finalStats.speed,
        hp: hpUpdate,
        mp: mpUpdate,
      },
    };
  }

  return { success: false, error: "无法使用该物品" };
}

/**
 * 清除玩家当前活跃战斗（视为逃跑）
 * 返回被清除的战斗信息，如果没有则返回 null
 */
export async function clearActiveBattle(playerId: string): Promise<{ enemyNames: string[] } | null> {
  const battle = await prisma.battleState.findUnique({
    where: { playerId },
  });
  if (!battle || battle.status !== "active") return null;

  const enemies = battle.enemies as Array<{ name: string }>;
  const enemyNames = enemies.map((e) => e.name);

  // 删除战斗记录
  await prisma.battleState.delete({
    where: { playerId },
  });

  console.log(`[clearActiveBattle] 玩家 ${playerId} 逃离战斗: ${enemyNames.join(", ")}`);
  return { enemyNames };
}

export async function moveToNode(
  args: Record<string, unknown>,
  playerId: string
) {
  const nodeId = args.nodeId as string | undefined;
  const force = (args.force as boolean) ?? false;

  if (!nodeId) return { success: false, error: "缺少 nodeId 参数。请指定要移动到的节点ID或节点名称" };

  // 先按 ID 查找
  let node = await prisma.areaNode.findUnique({
    where: { id: nodeId },
    include: { area: true },
  });

  // 如果未找到，按名称在玩家当前区域内查找
  if (!node) {
    const player = await prisma.player.findUnique({
      where: { id: playerId },
      select: { currentAreaId: true },
    });
    if (player?.currentAreaId) {
      node = await prisma.areaNode.findFirst({
        where: {
          areaId: player.currentAreaId,
          name: { contains: nodeId },
        },
        include: { area: true },
      });
    }
  }

  if (!node) return { success: false, error: `节点「${nodeId}」不存在` };

  // 获取玩家当前位置
  const player = await prisma.player.findUnique({
    where: { id: playerId },
    select: { currentNodeId: true, currentAreaId: true },
  });

  // ---- 连通性校验（非 force 模式） ----
  if (!force && player?.currentNodeId) {
    // 查询从当前节点出发的所有连接
    const connections = await prisma.areaNodeConnection.findMany({
      where: {
        OR: [
          { fromId: player.currentNodeId },
          { toId: player.currentNodeId },
        ],
      },
      select: { fromId: true, toId: true },
    });

    const reachableIds = new Set(
      connections.map((c) =>
        c.fromId === player.currentNodeId ? c.toId : c.fromId
      )
    );

    if (!reachableIds.has(node.id)) {
      // 返回可达节点列表，帮助 AI 引导玩家
      const reachableNodes = await prisma.areaNode.findMany({
        where: { id: { in: [...reachableIds] } },
        select: { id: true, name: true, type: true },
      });
      return {
        success: false,
        error: `无法直接到达「${node.name}」，该节点与当前位置不相邻`,
        data: {
          reachableNodes,
          hint: "可使用 force=true 强制跳转（需玩家明确要求）",
        },
      };
    }
  }

  // ---- 区域切换时自动清除战斗（视为逃跑） ----
  let escapedBattle: { enemyNames: string[] } | null = null;
  if (player?.currentAreaId && player.currentAreaId !== node.areaId) {
    escapedBattle = await clearActiveBattle(playerId);
  }

  // ---- 更新玩家位置 ----
  await prisma.player.update({
    where: { id: playerId },
    data: { currentAreaId: node.areaId, currentNodeId: node.id },
  });

  // ---- 更新已探索节点列表 ----
  const playerArea = await prisma.playerArea.findUnique({
    where: { playerId_areaId: { playerId, areaId: node.areaId } },
  });

  if (playerArea) {
    const explored = JSON.parse(playerArea.exploredNodes as string) as string[];
    if (!explored.includes(node.id)) {
      explored.push(node.id);
      await prisma.playerArea.update({
        where: { id: playerArea.id },
        data: { exploredNodes: JSON.stringify(explored) },
      });
    }
  } else {
    // 首次进入该区域，创建探索记录
    await prisma.playerArea.create({
      data: {
        playerId,
        areaId: node.areaId,
        exploredNodes: JSON.stringify([node.id]),
      },
    });
  }

  return {
    success: true,
    data: {
      nodeName: node.name,
      nodeType: node.type,
      description: node.description,
      nodeData: node.data,
      areaName: node.area.name,
      forced: force,
      ...(escapedBattle ? { escapedBattle: `逃离了与 ${escapedBattle.enemyNames.join("、")} 的战斗` } : {}),
    },
    stateUpdate: { location: `${node.area.name} - ${node.name}` },
  };
}

export async function interactNpc(
  args: Record<string, unknown>,
  playerId: string
) {
  const npcId = args.npcId as string | undefined;
  const action = args.action as string | undefined;
  const actionData = args.data as Record<string, unknown> | undefined;

  if (!npcId) return { success: false, error: "缺少 npcId 参数" };
  if (!action) return { success: false, error: "缺少 action 参数（talk / buy / sell / heal / train）" };

  // 使用集中式解析器查找 NPC
  const resolved = await resolveNpc(npcId, playerId);
  if (!resolved.found) {
    return { success: false, error: resolved.error };
  }
  
  const { nodeId, npc: npcData } = resolved.record;

  // 校验玩家位置：必须在 NPC 所在节点
  const player = await prisma.player.findUnique({
    where: { id: playerId },
    select: { currentNodeId: true, gold: true, currentAreaId: true },
  });

  if (player?.currentNodeId !== nodeId) {
    const targetNode = await prisma.areaNode.findUnique({
      where: { id: nodeId },
      select: { name: true },
    });
    return { 
      success: false, 
      error: `NPC「${npcData.name}」在「${targetNode?.name}」，而你在另一个位置。请先通过对话移动到该处。` 
    };
  }

  // 获取节点数据（用于商店物品等）
  const node = await prisma.areaNode.findUnique({
    where: { id: nodeId },
    select: { data: true },
  });
  const nodeData = (node?.data ?? {}) as Record<string, unknown>;

  // ---- talk: 对话 ----
  if (action === "talk") {
    return {
      success: true,
      data: {
        npcId: npcData.id,
        npcName: npcData.name,
        role: npcData.role,
        personality: npcData.personality,
        greeting: npcData.greeting,
        dialogTopics: npcData.dialogTopics,
        questId: npcData.questId || null,
      },
    };
  }

  // ---- buy: 购买商品 ----
  if (action === "buy") {
    const shopItems = nodeData?.shopItems as Array<{
      name: string; type: string; quality?: string;
      price: number; stats?: Record<string, unknown>; description?: string;
    }> | undefined;

    if (!shopItems) {
      return { success: false, error: `${npcData.name} 没有商品出售` };
    }

    const itemName = actionData?.itemName as string | undefined;
    const quantity = (actionData?.quantity as number) || 1;

    if (!itemName) {
      // 返回商品列表
      return {
        success: true,
        data: {
          npcName: npcData.name,
          action: "shop_list",
          items: shopItems,
          playerGold: player.gold,
        },
      };
    }

    // 查找商品
    const shopItem = shopItems.find(
      (i) => i.name === itemName || i.name.includes(itemName)
    );
    if (!shopItem) {
      return { success: false, error: `商品「${itemName}」不存在` };
    }

    const totalCost = shopItem.price * quantity;
    if (player.gold < totalCost) {
      return {
        success: false,
        error: `金币不足，需要 ${totalCost} 金币，当前 ${player.gold} 金币`,
      };
    }

    // 扣金币
    await prisma.player.update({
      where: { id: playerId },
      data: { gold: { decrement: totalCost } },
    });

    // 添加物品到背包
    await prisma.inventoryItem.create({
      data: {
        playerId,
        name: shopItem.name,
        type: shopItem.type,
        quality: shopItem.quality || "common",
        quantity,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        stats: (shopItem.stats ?? undefined) as any,
      },
    });

    return {
      success: true,
      data: {
        npcName: npcData.name,
        action: "bought",
        item: shopItem.name,
        quantity,
        cost: totalCost,
        remainingGold: player.gold - totalCost,
      },
      stateUpdate: { gold: player.gold - totalCost },
    };
  }

  // ---- sell: 出售物品 ----
  if (action === "sell") {
    const itemId = actionData?.itemId as string | undefined;
    if (!itemId) return { success: false, error: "未指定要出售的物品" };

    const item = await prisma.inventoryItem.findFirst({
      where: { id: itemId, playerId },
    });
    if (!item) return { success: false, error: "物品不存在" };

    // 出售价格为购买价的 40%（简单估算）
    const sellPrice = Math.max(1, Math.floor(
      (item.quality === "rare" ? 150 : item.quality === "uncommon" ? 80 : 30) * 0.4
    ));

    await prisma.player.update({
      where: { id: playerId },
      data: { gold: { increment: sellPrice } },
    });

    if (item.quantity <= 1) {
      await prisma.inventoryItem.delete({ where: { id: itemId } });
    } else {
      await prisma.inventoryItem.update({
        where: { id: itemId },
        data: { quantity: { decrement: 1 } },
      });
    }

    return {
      success: true,
      data: {
        action: "sold",
        item: item.name,
        price: sellPrice,
        remainingGold: player.gold + sellPrice,
      },
      stateUpdate: { gold: player.gold + sellPrice },
    };
  }

  // ---- exchange: 以物易物 ----
  if (action === "exchange") {
    // 1. 解析参数
    const giveDetails = actionData?.give as Array<{ itemId: string; quantity?: number }> | undefined;
    const receiveDetails = actionData?.receive as Array<{
      name: string; type: string; quality?: string; quantity?: number;
      stats?: Record<string, unknown>; specialEffect?: string;
    }> | undefined;

    if (!giveDetails || !Array.isArray(giveDetails) || giveDetails.length === 0) {
      return { success: false, error: "缺少 give 参数 (玩家需要付出的物品)" };
    }
    if (!receiveDetails || !Array.isArray(receiveDetails) || receiveDetails.length === 0) {
      return { success: false, error: "缺少 receive 参数 (玩家将获得的物品)" };
    }

    // 2. 验证玩家是否拥有足够的物品
    const itemsToRemove: Array<{ dbItem: { id: string, quantity: number, name: string }, removeQty: number }> = [];

    for (const give of giveDetails) {
       // 使用 resolveItem 查找物品 (支持部分匹配，但为了安全最好用ID)
       const resolved = await resolveItem(give.itemId, playerId);
       if (!resolved.found) return { success: false, error: resolved.error };
       const item = resolved.record;

       const qtyNeeded = give.quantity || 1;
       if (item.quantity < qtyNeeded) {
         return { success: false, error: `物品不足：${item.name} (需要 ${qtyNeeded}, 拥有 ${item.quantity})` };
       }
       itemsToRemove.push({ dbItem: item, removeQty: qtyNeeded });
    }

    // 3. 执行扣除
    for (const { dbItem, removeQty } of itemsToRemove) {
      if (dbItem.quantity <= removeQty) { // 应该相等，除非有并发修改
        await prisma.inventoryItem.delete({ where: { id: dbItem.id } });
      } else {
        await prisma.inventoryItem.update({
          where: { id: dbItem.id },
          data: { quantity: { decrement: removeQty } },
        });
      }
    }

    // 4. 执行给予
    const addedItems: string[] = [];
    for (const receive of receiveDetails) {
      await prisma.inventoryItem.create({
        data: {
          playerId,
          name: receive.name,
          type: receive.type,
          quality: receive.quality || "common",
          quantity: receive.quantity || 1,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          stats: (receive.stats ?? undefined) as any,
          specialEffect: receive.specialEffect,
        },
      });
      addedItems.push(`${receive.name} x${receive.quantity || 1}`);
    }

    // 5. 记录日志
    const giveStr = itemsToRemove.map(i => `${i.dbItem.name} x${i.removeQty}`).join(", ");
    const receiveStr = addedItems.join(", ");
    
    await logPlayerAction(
      playerId,
      "trade",
      `与 ${npcData.name} 交换：失去 [${giveStr}]，获得 [${receiveStr}]`,
      { npcId: npcData.id, give: giveStr, receive: receiveStr }
    );

    return {
      success: true,
      data: {
        action: "exchange_completed",
        npcName: npcData.name,
        gave: giveStr,
        received: receiveStr,
      },
      // stateUpdate 这里比较复杂，暂不更新详细 inventory 列表，前端通常会自动重拉或通过 events 更新
    };
  }

  // ---- accept_quest: 接取任务 ----
  if (action === "accept_quest") {
    const questId = (actionData?.questId as string) || (npcData.questId as string);
    if (!questId) {
      return { success: false, error: `${npcData.name} 没有可接取的任务` };
    }

    const quest = await prisma.quest.findUnique({ where: { id: questId } });
    if (!quest) return { success: false, error: "任务不存在。如果这是NPC新发布的任务，请先调用 create_quest 工具创建任务，然后再让玩家接取。" };

    // 检查是否已接取
    const existing = await prisma.playerQuest.findUnique({
      where: { playerId_questId: { playerId, questId } },
    });
    if (existing) {
      return {
        success: false,
        error: `任务「${quest.name}」已接取，状态: ${existing.status}`,
      };
    }

    const objectives = quest.objectives as Array<Record<string, unknown>>;
    const initialProgress = objectives.map(() => ({
      currentCount: 0,
      completed: false,
    }));

    await prisma.playerQuest.create({
      data: {
        playerId,
        questId,
        status: "active",
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        progress: initialProgress as any,
      },
    });

    await logPlayerAction(
      playerId,
      "quest",
      `接取任务：${quest.name}`,
      { questId: quest.id }
    );

    return {
      success: true,
      data: {
        action: "quest_accepted",
        questId: quest.id,
        questName: quest.name,
        description: quest.description,
        objectives: objectives.map((o) => o.description),
      },
    };
  }

  // ---- submit_quest: 提交任务 ----
  if (action === "submit_quest") {
    const questId = (actionData?.questId as string) || (npcData.questId as string);
    if (!questId) return { success: false, error: "未指定任务" };

    // Fix: Explicitly type the result or use a more specific query to ensuring typing
    const pq = await prisma.playerQuest.findUnique({
      where: { playerId_questId: { playerId, questId } },
      include: { quest: true },
    });
    
    if (!pq) return { success: false, error: "未接取该任务" };

    const progress = pq.progress as Array<{ completed: boolean }>;
    const allDone = progress.every((p) => p.completed);
    if (!allDone && pq.status !== "completed") {
      return { success: false, error: "任务目标尚未全部完成" };
    }

    // 发放奖励
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const questData = (pq as any).quest; 
    const rewards = questData.rewards as {
      exp?: number; gold?: number; items?: Array<Record<string, unknown>>;
    };

    await prisma.playerQuest.update({
      where: { id: pq.id },
      data: { status: "completed" },
    });

    const updateData: Record<string, unknown> = {};
    if (rewards.exp) updateData.exp = { increment: rewards.exp };
    if (rewards.gold) updateData.gold = { increment: rewards.gold };

    if (Object.keys(updateData).length > 0) {
      await prisma.player.update({
        where: { id: playerId },
        data: updateData,
      });
    }

    // 发放奖励物品
    if (rewards.items && rewards.items.length > 0) {
      for (const ri of rewards.items) {
        await prisma.inventoryItem.create({
          data: {
            playerId,
            name: (ri.name as string) || "未知物品",
            type: (ri.type as string) || "material",
            quality: (ri.quality as string) || "common",
            quantity: (ri.quantity as number) || 1,
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            stats: ri.stats ? (ri.stats as any) : undefined,
            specialEffect: (ri.description as string) || null,
          },
        });
      }
    }

    await logPlayerAction(
      playerId,
      "quest",
      `完成任务：${pq.quest.name}，获得奖励：${rewards.exp || 0} 经验, ${rewards.gold || 0} 金币`,
      { questId: pq.questId, rewards }
    );

    return {
      success: true,
      data: {
        action: "quest_completed",
        questName: pq.quest.name,
        rewards,
      },
      stateUpdate: {
        ...(rewards.exp ? { exp: rewards.exp } : {}),
        ...(rewards.gold ? { gold: rewards.gold } : {}),
      },
    };
  }

  return { success: false, error: `不支持的交互类型: ${action}` };
}

export async function enhanceEquipment(
  args: Record<string, unknown>,
  playerId: string
) {
  const equipmentId = args.equipmentId as string;

  // 使用集中式解析器查找装备
  const resolved = await resolveItem(equipmentId, playerId);
  if (!resolved.found) {
    return { success: false, error: resolved.error };
  }
  const item = resolved.record;

  if (!item) return { success: false, error: "装备不存在" };

  // 简化实现：后续由 equipment-calc 完善
  return {
    success: true,
    data: { message: `装备 ${item.name} 强化功能开发中` },
  };
}
