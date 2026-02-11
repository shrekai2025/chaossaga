# ChaosSaga - 敌人AI行为决策系统详细设计

> 版本: 1.0 | 更新日期: 2026-02-08
> 对应 GDD 章节: 四、战斗系统
> 设计原则: **纯算法驱动，零API调用，传统数值计算**

---

## 一、设计哲学

```
┌─────────────────────────────────────────────────────────────────┐
│                   敌人AI设计哲学                                  │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  1. 纯算法驱动：所有决策由行为树+加权随机完成，无API调用          │
│  2. 确定性+随机性：核心逻辑确定性可调试，随机性由Math.random提供  │
│  3. 可配置：每种敌人的AI参数通过数据表配置，无需修改代码          │
│  4. 可预测的不可预测：玩家能感知AI行为模式，但无法精确预判        │
│  5. 表现力：通过AI人格+策略切换，让不同敌人有辨识度               │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## 二、行为决策架构

### 2.1 决策流程总览

```
【回合开始 - 敌人行动阶段】
         │
         ▼
┌──────────────────┐
│  1. 检查控制状态   │ ← 冰冻/眩晕/石化 → 跳过行动
└────────┬─────────┘
         │ (可行动)
         ▼
┌──────────────────┐
│  2. 检查紧急状态   │ ← HP<20% → 触发求生策略
└────────┬─────────┘
         │ (非紧急)
         ▼
┌──────────────────┐
│  3. AI人格决策     │ ← 根据敌人人格类型选择策略池
└────────┬─────────┘
         │
         ▼
┌──────────────────┐
│  4. HP阶段策略     │ ← 根据当前HP百分比调整行为权重
└────────┬─────────┘
         │
         ▼
┌──────────────────┐
│  5. 技能可用性过滤 │ ← 排除MP不足/冷却中的技能
└────────┬─────────┘
         │
         ▼
┌──────────────────┐
│  6. 加权随机选择   │ ← 从可用行动中按权重随机
└────────┬─────────┘
         │
         ▼
┌──────────────────┐
│  7. 目标选择       │ ← 单体技能选目标（如果多目标场景）
└────────┬─────────┘
         │
         ▼
      执行行动
```

### 2.2 核心接口定义

```typescript
// lib/game/enemy-ai.ts

/** 敌人AI人格类型 */
type AiPersonality = 'aggressive' | 'defensive' | 'balanced' | 'cunning' | 'berserker' | 'support';

/** HP阶段 */
type HpPhase = 'healthy' | 'wounded' | 'critical';

/** 可用行动 */
interface EnemyAction {
  type: 'attack' | 'skill' | 'defend' | 'heal' | 'buff' | 'flee';
  skillId?: string;
  weight: number;        // 行动权重（越高越可能被选中）
  targetType: 'single' | 'aoe' | 'self';
  mpCost: number;
}

/** 敌人AI配置（存储在Enemy数据表中） */
interface EnemyAiConfig {
  personality: AiPersonality;
  
  /** HP阶段阈值 */
  hpPhaseThresholds: {
    wounded: number;     // 默认 0.5 (50%)
    critical: number;    // 默认 0.2 (20%)
  };
  
  /** 各阶段的行动权重覆盖 */
  phaseWeights: Record<HpPhase, ActionWeightOverride>;
  
  /** 特殊行为规则（BOSS用） */
  specialRules?: SpecialRule[];
  
  /** 逃跑阈值（0表示不逃跑） */
  fleeThreshold: number;  // HP百分比，如0.1表示10%以下可能逃跑
  fleeChance: number;     // 逃跑概率，如0.3表示30%
}

/** 行动权重覆盖 */
interface ActionWeightOverride {
  attack: number;
  skill: number;
  defend: number;
  heal: number;
  buff: number;
}

/** 特殊行为规则（BOSS用） */
interface SpecialRule {
  condition: {
    type: 'hp_below' | 'round_number' | 'round_interval' | 'target_status' | 'self_status';
    value: number | string;
  };
  action: {
    type: 'force_skill' | 'phase_shift' | 'summon' | 'enrage';
    skillId?: string;
    params?: Record<string, any>;
  };
  priority: number;  // 越高越优先检查
  onceOnly: boolean; // 是否只触发一次
}
```

---

## 三、AI 人格类型详解

### 3.1 六种人格及行为模式

| 人格 | 设计意图 | 行为特征 | 典型敌人 |
|------|----------|----------|----------|
| aggressive（攻击型） | 高压力，速战速决 | 优先高伤害技能，很少防御 | 珊瑚蟹、火焰狼 |
| defensive（防御型） | 持久消耗，考验耐心 | 频繁防御和治疗，反击 | 石甲龟、守护者 |
| balanced（平衡型） | 标准对手，全面应对 | 攻防均衡，偶尔使用buff | 海妖斥候、精灵战士 |
| cunning（狡猾型） | 策略性强，针对弱点 | 优先debuff/控制，集火低HP目标 | 暗影刺客、海妖巫师 |
| berserker（狂暴型） | 越打越猛，背水一战 | 低HP时攻击力提升，不防御不治疗 | 狂暴熊、深渊战士 |
| support（辅助型） | 配合其他敌人使用 | 优先buff/heal队友，较少直接攻击 | 海妖祭司、治疗蛙 |

### 3.2 各人格基础行动权重

```typescript
// lib/game/ai-personality.ts

/** 
 * 基础行动权重表
 * 值越高，该行动在加权随机中被选中的概率越大
 * 每个阶段的权重可独立配置
 */
const PERSONALITY_WEIGHTS: Record<AiPersonality, Record<HpPhase, ActionWeightOverride>> = {
  aggressive: {
    healthy:  { attack: 30, skill: 50, defend: 5,  heal: 0,  buff: 15 },
    wounded:  { attack: 25, skill: 55, defend: 5,  heal: 5,  buff: 10 },
    critical: { attack: 20, skill: 65, defend: 0,  heal: 10, buff: 5  },
  },
  defensive: {
    healthy:  { attack: 25, skill: 25, defend: 25, heal: 10, buff: 15 },
    wounded:  { attack: 15, skill: 20, defend: 30, heal: 25, buff: 10 },
    critical: { attack: 10, skill: 15, defend: 25, heal: 40, buff: 10 },
  },
  balanced: {
    healthy:  { attack: 30, skill: 35, defend: 15, heal: 5,  buff: 15 },
    wounded:  { attack: 25, skill: 30, defend: 20, heal: 15, buff: 10 },
    critical: { attack: 20, skill: 25, defend: 20, heal: 25, buff: 10 },
  },
  cunning: {
    healthy:  { attack: 15, skill: 45, defend: 10, heal: 5,  buff: 25 },
    wounded:  { attack: 20, skill: 40, defend: 15, heal: 15, buff: 10 },
    critical: { attack: 25, skill: 35, defend: 15, heal: 20, buff: 5  },
  },
  berserker: {
    healthy:  { attack: 40, skill: 40, defend: 5,  heal: 0,  buff: 15 },
    wounded:  { attack: 35, skill: 50, defend: 0,  heal: 0,  buff: 15 },
    critical: { attack: 30, skill: 60, defend: 0,  heal: 0,  buff: 10 },
    // berserker特殊：critical阶段攻击力+30%
  },
  support: {
    healthy:  { attack: 15, skill: 20, defend: 10, heal: 25, buff: 30 },
    wounded:  { attack: 20, skill: 15, defend: 15, heal: 30, buff: 20 },
    critical: { attack: 25, skill: 20, defend: 10, heal: 35, buff: 10 },
  },
};
```

---

## 四、核心决策算法

### 4.1 主决策函数

```typescript
// lib/game/enemy-ai.ts

interface BattleContext {
  round: number;
  enemies: CombatEntity[];       // 所有敌人（含自身）
  players: CombatEntity[];       // 所有玩家方（含召唤兽）
  activeEffects: StatusEffect[]; // 当前场上所有状态效果
  environmentEffect?: string;    // 环境效果
}

interface CombatEntity {
  id: string;
  name: string;
  currentHp: number;
  maxHp: number;
  currentMp: number;
  maxMp: number;
  attack: number;
  defense: number;
  speed: number;
  element: string;
  skills: SkillInstance[];
  statusEffects: StatusEffect[];
  isAlive: boolean;
}

interface SkillInstance {
  skillId: string;
  name: string;
  type: string;
  element: string;
  mpCost: number;
  cooldown: number;
  currentCooldown: number;  // 0=可用
  damageRatio: number;
  targetType: string;
  effectType?: string;
}

interface DecisionResult {
  actionType: 'attack' | 'skill' | 'defend' | 'heal' | 'flee';
  skillId?: string;
  targetId: string;
  reasoning: string;  // 用于战斗叙事模板选择
}

function makeEnemyDecision(
  enemy: CombatEntity,
  aiConfig: EnemyAiConfig,
  context: BattleContext
): DecisionResult {
  // ========== Step 1: 控制状态检查 ==========
  if (hasControlEffect(enemy)) {
    return { actionType: 'skip', targetId: '', reasoning: 'controlled' };
  }

  // ========== Step 2: 特殊规则检查（BOSS专用） ==========
  if (aiConfig.specialRules) {
    const forcedAction = checkSpecialRules(enemy, aiConfig.specialRules, context);
    if (forcedAction) return forcedAction;
  }

  // ========== Step 3: 确定HP阶段 ==========
  const hpPercent = enemy.currentHp / enemy.maxHp;
  const hpPhase: HpPhase = 
    hpPercent > aiConfig.hpPhaseThresholds.wounded ? 'healthy' :
    hpPercent > aiConfig.hpPhaseThresholds.critical ? 'wounded' :
    'critical';

  // ========== Step 4: 逃跑判定 ==========
  if (aiConfig.fleeThreshold > 0 && hpPercent <= aiConfig.fleeThreshold) {
    if (Math.random() < aiConfig.fleeChance) {
      return { actionType: 'flee', targetId: '', reasoning: 'low_hp_flee' };
    }
  }

  // ========== Step 5: 获取当前阶段的行动权重 ==========
  const phaseWeights = aiConfig.phaseWeights[hpPhase]
    ?? PERSONALITY_WEIGHTS[aiConfig.personality][hpPhase];

  // ========== Step 6: 构建可用行动池 ==========
  const actionPool = buildActionPool(enemy, phaseWeights, context);

  // ========== Step 7: 加权随机选择 ==========
  const selectedAction = weightedRandomSelect(actionPool);

  // ========== Step 8: 选择目标 ==========
  const target = selectTarget(enemy, selectedAction, aiConfig.personality, context);

  return {
    actionType: selectedAction.type,
    skillId: selectedAction.skillId,
    targetId: target.id,
    reasoning: `${aiConfig.personality}_${hpPhase}_${selectedAction.type}`,
  };
}
```

### 4.2 行动池构建

```typescript
function buildActionPool(
  enemy: CombatEntity,
  weights: ActionWeightOverride,
  context: BattleContext
): EnemyAction[] {
  const pool: EnemyAction[] = [];

  // 普通攻击（始终可用）
  if (weights.attack > 0) {
    pool.push({
      type: 'attack',
      weight: weights.attack,
      targetType: 'single',
      mpCost: 0,
    });
  }

  // 防御（始终可用）
  if (weights.defend > 0) {
    pool.push({
      type: 'defend',
      weight: weights.defend,
      targetType: 'self',
      mpCost: 0,
    });
  }

  // 技能类行动
  for (const skill of enemy.skills) {
    // 跳过冷却中或MP不足的技能
    if (skill.currentCooldown > 0) continue;
    if (skill.mpCost > enemy.currentMp) continue;

    // 根据技能类型分配到对应行动类别
    const actionType = categorizeSkill(skill);
    const baseWeight = weights[actionType] ?? 0;
    if (baseWeight <= 0) continue;

    // 技能权重 = 基础权重 × 技能倍率调整
    // 高倍率技能权重略高，鼓励使用强技能
    const ratioBonus = Math.min(skill.damageRatio * 0.5, 1.5);
    const skillWeight = baseWeight * ratioBonus;

    // 属性克制加成：如果技能属性克制玩家，权重+50%
    const elementBonus = hasElementAdvantage(skill.element, context.players[0]?.element)
      ? 1.5 : 1.0;

    pool.push({
      type: actionType,
      skillId: skill.skillId,
      weight: skillWeight * elementBonus,
      targetType: skill.targetType as any,
      mpCost: skill.mpCost,
    });
  }

  return pool;
}

/** 技能分类 */
function categorizeSkill(skill: SkillInstance): string {
  if (skill.effectType === 'heal' || skill.effectType === 'regen') return 'heal';
  if (skill.effectType === 'shield' || skill.effectType === 'buff') return 'buff';
  return 'skill'; // 攻击类技能
}
```

### 4.3 加权随机选择算法

```typescript
/**
 * 加权随机选择
 * 例：attack(30) + skill(50) + defend(20) = 总100
 * 随机数0-100：0-30选attack，31-80选skill，81-100选defend
 */
function weightedRandomSelect(pool: EnemyAction[]): EnemyAction {
  if (pool.length === 0) {
    // 安全兜底：返回普通攻击
    return { type: 'attack', weight: 1, targetType: 'single', mpCost: 0 };
  }

  const totalWeight = pool.reduce((sum, action) => sum + action.weight, 0);
  let roll = Math.random() * totalWeight;

  for (const action of pool) {
    roll -= action.weight;
    if (roll <= 0) return action;
  }

  return pool[pool.length - 1]; // 浮点精度兜底
}
```

### 4.4 目标选择算法

```typescript
/** 目标选择策略 */
function selectTarget(
  enemy: CombatEntity,
  action: EnemyAction,
  personality: AiPersonality,
  context: BattleContext
): CombatEntity {
  // AOE技能无需选择具体目标
  if (action.targetType === 'aoe') {
    return context.players[0]; // 返回任一活着的玩家方
  }

  // 自身技能
  if (action.targetType === 'self') {
    return enemy;
  }

  // 治疗/buff类：选择己方目标
  if (action.type === 'heal' || action.type === 'buff') {
    return selectAllyTarget(enemy, context.enemies, action.type);
  }

  // 攻击类：根据人格选择目标
  const aliveTargets = context.players.filter(p => p.isAlive);
  if (aliveTargets.length <= 1) return aliveTargets[0];

  switch (personality) {
    case 'cunning':
      // 狡猾型：攻击HP最低的目标（补刀策略）
      return aliveTargets.reduce((lowest, t) =>
        (t.currentHp / t.maxHp) < (lowest.currentHp / lowest.maxHp) ? t : lowest
      );

    case 'aggressive':
    case 'berserker':
      // 攻击型/狂暴型：攻击防御最低的目标
      return aliveTargets.reduce((weakest, t) =>
        t.defense < weakest.defense ? t : weakest
      );

    case 'support':
      // 辅助型：攻击对己方威胁最大的目标（攻击力最高的）
      return aliveTargets.reduce((strongest, t) =>
        t.attack > strongest.attack ? t : strongest
      );

    default:
      // 平衡型/防御型：随机选择（带轻微偏向低HP）
      return weightedTargetSelect(aliveTargets);
  }
}

/** 带HP偏向的随机目标选择 */
function weightedTargetSelect(targets: CombatEntity[]): CombatEntity {
  // 低HP目标有更高被选中概率
  // 权重 = 1 + (1 - HP百分比) * 0.5
  const weights = targets.map(t => ({
    target: t,
    weight: 1 + (1 - t.currentHp / t.maxHp) * 0.5,
  }));

  const total = weights.reduce((sum, w) => sum + w.weight, 0);
  let roll = Math.random() * total;
  for (const w of weights) {
    roll -= w.weight;
    if (roll <= 0) return w.target;
  }
  return targets[targets.length - 1];
}

/** 选择己方治疗/buff目标 */
function selectAllyTarget(
  self: CombatEntity,
  allies: CombatEntity[],
  actionType: string
): CombatEntity {
  const aliveAllies = allies.filter(a => a.isAlive);
  
  if (actionType === 'heal') {
    // 治疗HP百分比最低的队友
    return aliveAllies.reduce((lowest, a) =>
      (a.currentHp / a.maxHp) < (lowest.currentHp / lowest.maxHp) ? a : lowest
    );
  }
  
  // buff优先给攻击力最高的队友
  return aliveAllies.reduce((strongest, a) =>
    a.attack > strongest.attack ? a : strongest
  );
}
```

---

## 五、BOSS AI 特殊模式

### 5.1 BOSS AI 设计理念

| 设计点 | 说明 |
|--------|------|
| 阶段转换 | BOSS有多个HP阶段，每阶段行为模式不同 |
| 预告机制 | 强力技能前有"蓄力"回合，给玩家准备时间 |
| 固定规律 | 特定回合或HP阈值触发必然行为，让玩家可学习 |
| 愤怒机制 | 被连续攻击后提升攻击力，惩罚无脑输出 |
| 机制技能 | 需要玩家特定应对的技能（如：必须防御/必须打断） |

### 5.2 BOSS 阶段系统

```typescript
// lib/game/boss-ai.ts

interface BossPhase {
  name: string;
  hpThreshold: number;        // HP百分比阈值（低于此值进入该阶段）
  personalityOverride: AiPersonality;
  statModifiers: {
    attackMultiplier: number;  // 攻击力倍率
    defenseMultiplier: number; // 防御力倍率
    speedMultiplier: number;   // 速度倍率
  };
  phaseStartSkill?: string;   // 进入阶段时强制释放的技能
  phaseStartNarrative: string; // 阶段转换叙事（模板）
  specialRules: SpecialRule[];
}

interface BossConfig extends EnemyAiConfig {
  phases: BossPhase[];
  enrageTimer: number;         // 愤怒倒计时（回合数，0=无）
  enrageEffect: {
    attackMultiplier: number;
    narrative: string;
  };
}

/**
 * BOSS AI - 在基础AI之上增加阶段管理
 */
function makeBossDecision(
  boss: CombatEntity,
  bossConfig: BossConfig,
  context: BattleContext,
  bossState: BossRuntimeState
): DecisionResult {
  const hpPercent = boss.currentHp / boss.maxHp;

  // ========== 阶段转换检查 ==========
  const currentPhase = bossConfig.phases.find(p => hpPercent <= p.hpThreshold)
    ?? bossConfig.phases[0];

  if (currentPhase.name !== bossState.currentPhaseName) {
    // 触发阶段转换
    bossState.currentPhaseName = currentPhase.name;
    bossState.phaseJustChanged = true;

    // 应用属性修正
    applyStatModifiers(boss, currentPhase.statModifiers);

    // 强制释放阶段转换技能
    if (currentPhase.phaseStartSkill) {
      return {
        actionType: 'skill',
        skillId: currentPhase.phaseStartSkill,
        targetId: context.players[0].id,
        reasoning: `boss_phase_${currentPhase.name}`,
      };
    }
  }

  // ========== 愤怒计时器检查 ==========
  if (bossConfig.enrageTimer > 0 && context.round >= bossConfig.enrageTimer) {
    if (!bossState.isEnraged) {
      bossState.isEnraged = true;
      boss.attack = Math.floor(boss.attack * bossConfig.enrageEffect.attackMultiplier);
    }
  }

  // ========== 使用当前阶段的AI配置进行决策 ==========
  const phaseConfig: EnemyAiConfig = {
    ...bossConfig,
    personality: currentPhase.personalityOverride,
    specialRules: currentPhase.specialRules,
  };

  return makeEnemyDecision(boss, phaseConfig, context);
}
```

### 5.3 BOSS 配置示例：海妖女王

```typescript
const MERMAID_QUEEN_CONFIG: BossConfig = {
  personality: 'cunning',
  hpPhaseThresholds: { wounded: 0.6, critical: 0.3 },
  fleeThreshold: 0,
  fleeChance: 0,
  phaseWeights: {} as any, // 由phases覆盖

  phases: [
    {
      name: 'phase1_grace',
      hpThreshold: 1.0,
      personalityOverride: 'balanced',
      statModifiers: { attackMultiplier: 1.0, defenseMultiplier: 1.0, speedMultiplier: 1.0 },
      phaseStartNarrative: '海妖女王优雅地举起珊瑚权杖，冰冷的目光扫过战场。',
      specialRules: [
        {
          condition: { type: 'round_interval', value: 3 },
          action: { type: 'force_skill', skillId: 'tidal_wave' },
          priority: 10,
          onceOnly: false,
          // 每3回合释放一次潮汐波
        },
      ],
    },
    {
      name: 'phase2_fury',
      hpThreshold: 0.6,
      personalityOverride: 'aggressive',
      statModifiers: { attackMultiplier: 1.3, defenseMultiplier: 0.9, speedMultiplier: 1.2 },
      phaseStartSkill: 'ocean_rage',  // 进入阶段时释放"海洋之怒"
      phaseStartNarrative: '海妖女王怒吼一声！海水翻涌，她的力量急剧膨胀！',
      specialRules: [
        {
          condition: { type: 'round_interval', value: 2 },
          action: { type: 'force_skill', skillId: 'water_prison' },
          priority: 10,
          onceOnly: false,
          // 每2回合释放水牢（控制技能）
        },
      ],
    },
    {
      name: 'phase3_desperation',
      hpThreshold: 0.3,
      personalityOverride: 'berserker',
      statModifiers: { attackMultiplier: 1.6, defenseMultiplier: 0.7, speedMultiplier: 1.5 },
      phaseStartSkill: 'summon_guardians',  // 召唤2只海妖护卫
      phaseStartNarrative: '海妖女王发出凄厉的长啸，深海中浮起两道暗影——援军到了！',
      specialRules: [
        {
          condition: { type: 'hp_below', value: 0.1 },
          action: { type: 'force_skill', skillId: 'last_resort' },
          priority: 99,
          onceOnly: true,
          // HP低于10%时释放"最后一搏"（全屏大招）
        },
      ],
    },
  ],

  enrageTimer: 20, // 20回合后愤怒
  enrageEffect: {
    attackMultiplier: 2.0,
    narrative: '海妖女王的眼中燃起疯狂之火！她放弃了一切防御，全力爆发！',
  },
};
```

---

## 六、特殊规则检查系统

### 6.1 规则检查器

```typescript
function checkSpecialRules(
  enemy: CombatEntity,
  rules: SpecialRule[],
  context: BattleContext,
  runtimeState: EnemyRuntimeState
): DecisionResult | null {
  // 按优先级排序
  const sortedRules = [...rules].sort((a, b) => b.priority - a.priority);

  for (const rule of sortedRules) {
    // 检查是否已触发过（onceOnly）
    if (rule.onceOnly && runtimeState.triggeredRules.has(ruleId(rule))) {
      continue;
    }

    // 检查条件
    if (!evaluateCondition(enemy, rule.condition, context)) {
      continue;
    }

    // 标记已触发
    if (rule.onceOnly) {
      runtimeState.triggeredRules.add(ruleId(rule));
    }

    // 执行规则动作
    return executeRuleAction(enemy, rule.action, context);
  }

  return null; // 无规则触发
}

function evaluateCondition(
  enemy: CombatEntity,
  condition: SpecialRule['condition'],
  context: BattleContext
): boolean {
  switch (condition.type) {
    case 'hp_below':
      return (enemy.currentHp / enemy.maxHp) < (condition.value as number);

    case 'round_number':
      return context.round === condition.value;

    case 'round_interval':
      return context.round > 0 && context.round % (condition.value as number) === 0;

    case 'target_status':
      // 检查玩家是否有指定状态效果
      return context.players.some(p =>
        p.statusEffects.some(e => e.type === condition.value)
      );

    case 'self_status':
      return enemy.statusEffects.some(e => e.type === condition.value);

    default:
      return false;
  }
}
```

---

## 七、群体敌人战术协调

### 7.1 多敌人时的协调逻辑

当战斗中存在多个敌人时，需要简单的战术协调：

```typescript
/**
 * 群体敌人战术分配
 * 在每个敌人独立决策前，先进行全局战术规划
 */
function coordinateGroupTactics(
  enemies: CombatEntity[],
  aiConfigs: Map<string, EnemyAiConfig>,
  context: BattleContext
): Map<string, TacticalHint> {
  const hints = new Map<string, TacticalHint>();
  const aliveEnemies = enemies.filter(e => e.isAlive);

  if (aliveEnemies.length <= 1) return hints; // 单敌人无需协调

  // 策略：确保至少一个不同的目标（避免所有人打同一个）
  let hasHealer = false;
  let hasTank = false;

  for (const enemy of aliveEnemies) {
    const config = aiConfigs.get(enemy.id);
    if (!config) continue;

    if (config.personality === 'support') hasHealer = true;
    if (config.personality === 'defensive') hasTank = true;

    // 辅助型优先治疗/buff
    if (config.personality === 'support') {
      hints.set(enemy.id, {
        preferredAction: 'heal',
        preferredTarget: findMostDamagedAlly(aliveEnemies),
      });
    }
  }

  // 如果队伍有辅助，攻击型可以更激进
  if (hasHealer) {
    for (const enemy of aliveEnemies) {
      const config = aiConfigs.get(enemy.id);
      if (config?.personality === 'aggressive' || config?.personality === 'berserker') {
        hints.set(enemy.id, {
          aggressionBoost: 1.3, // 攻击权重×1.3
        });
      }
    }
  }

  return hints;
}
```

### 7.2 集火与分散策略

```typescript
/** 
 * 集火决策
 * 条件：当目标HP低于30%时，提升所有敌人攻击该目标的概率
 */
function shouldFocusTarget(
  context: BattleContext
): { shouldFocus: boolean; targetId?: string } {
  const lowHpTargets = context.players.filter(p =>
    p.isAlive && (p.currentHp / p.maxHp) < 0.3
  );

  if (lowHpTargets.length > 0) {
    // 70%概率集火低HP目标
    if (Math.random() < 0.7) {
      return {
        shouldFocus: true,
        targetId: lowHpTargets[0].id,
      };
    }
  }

  return { shouldFocus: false };
}
```

---

## 八、战斗叙事模板引擎

### 8.1 设计理念

战斗叙事不使用AI生成，而是通过模板引擎实现：

```
┌─────────────────────────────────────────────────────────────────┐
│                  战斗叙事模板引擎                                  │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  行动数据 + 结果数据 ──→ 模板选择器 ──→ 变量替换 ──→ 叙事文本   │
│                             │                                   │
│                    ┌────────┴─────────┐                         │
│                    │  模板库           │                         │
│                    │  ├─ 普通攻击模板  │                         │
│                    │  ├─ 技能释放模板  │                         │
│                    │  ├─ 暴击模板      │                         │
│                    │  ├─ 击杀模板      │                         │
│                    │  ├─ 状态触发模板  │                         │
│                    │  ├─ 防御模板      │                         │
│                    │  ├─ 治疗模板      │                         │
│                    │  └─ 闪避模板      │                         │
│                    └──────────────────┘                         │
│                                                                 │
│  特点：零延迟、零成本、真随机模板抽取、支持条件分支               │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### 8.2 模板数据结构与示例

```typescript
// lib/game/narrative-templates.ts

interface NarrativeTemplate {
  id: string;
  category: NarrativeCategory;
  conditions?: {                 // 可选条件（为空则通用）
    element?: string;            // 限定属性
    isCrit?: boolean;            // 限定暴击
    isKill?: boolean;            // 限定击杀
    hpPercentBelow?: number;     // 目标HP百分比低于
    effectType?: string;         // 限定状态效果
    weatherMatch?: string;       // 限定天气
  };
  templates: string[];           // 多个模板随机抽取
  weight: number;                // 权重（条件越精确的权重越高）
}

type NarrativeCategory =
  | 'player_attack'     // 玩家普攻
  | 'player_skill'      // 玩家释放技能
  | 'player_defend'     // 玩家防御
  | 'player_item'       // 玩家使用道具
  | 'enemy_attack'      // 敌人普攻
  | 'enemy_skill'       // 敌人释放技能
  | 'enemy_defend'      // 敌人防御
  | 'crit'              // 暴击追加
  | 'kill'              // 击杀追加
  | 'effect_trigger'    // 状态触发
  | 'effect_tick'       // 持续效果结算
  | 'dodge'             // 闪避/未命中
  | 'battle_start'      // 战斗开始
  | 'battle_victory'    // 战斗胜利
  | 'battle_defeat'     // 战斗失败
  | 'round_tension';    // 回合氛围（长战斗时穿插）

/**
 * 模板变量说明
 * {actor}     - 行动者名称
 * {target}    - 目标名称
 * {weapon}    - 武器名称
 * {skill}     - 技能名称
 * {element}   - 属性名称
 * {damage}    - 伤害数值
 * {heal}      - 治疗数值
 * {effect}    - 状态效果名称
 * {item}      - 道具名称
 * {hpPercent} - 目标HP百分比
 */

const NARRATIVE_TEMPLATES: NarrativeTemplate[] = [
  // ========== 普通攻击 ==========
  {
    id: 'pa_basic_1',
    category: 'player_attack',
    templates: [
      '{actor}挥动{weapon}，猛力攻击{target}，造成了{damage}点伤害！',
      '{actor}快步冲上前，{weapon}精准命中{target}，{damage}点伤害！',
      '{actor}瞄准{target}的破绽，一击而中，造成{damage}点伤害！',
      '{actor}挥舞{weapon}划出一道弧光，击中{target}！{damage}点伤害！',
      '{weapon}带着凌厉的风声劈下，{target}被击退半步——{damage}点伤害！',
    ],
    weight: 1,
  },

  // ========== 技能攻击（水系） ==========
  {
    id: 'ps_water_1',
    category: 'player_skill',
    conditions: { element: 'water' },
    templates: [
      '{actor}凝聚水之力，{skill}！湛蓝光芒笼罩{target}，造成{damage}点伤害！',
      '水流在{actor}身周旋转加速——{skill}！{target}被水柱吞没，{damage}点伤害！',
      '{actor}高举双手，{skill}！汹涌的水流冲向{target}，造成{damage}点伤害！',
    ],
    weight: 2,
  },

  // ========== 技能攻击（火系） ==========
  {
    id: 'ps_fire_1',
    category: 'player_skill',
    conditions: { element: 'fire' },
    templates: [
      '{actor}双手燃起烈焰——{skill}！灼热的火球轰向{target}，{damage}点伤害！',
      '火焰在{actor}周围猛烈燃烧，{skill}！{target}被火海吞噬，{damage}点伤害！',
      '{actor}释放{skill}，炽热的火焰划过空气，{target}惨叫，{damage}点伤害！',
    ],
    weight: 2,
  },

  // ========== 技能攻击（通用/无属性匹配时） ==========
  {
    id: 'ps_generic_1',
    category: 'player_skill',
    templates: [
      '{actor}释放了{skill}！能量光芒直冲{target}，造成{damage}点伤害！',
      '{skill}！{actor}凝聚力量轰向{target}，{damage}点伤害！',
      '{actor}施展{skill}，强大的力量席卷{target}，造成{damage}点伤害！',
    ],
    weight: 1,
  },

  // ========== 暴击追加 ==========
  {
    id: 'crit_append_1',
    category: 'crit',
    templates: [
      '暴击！伤害倍增！',
      '会心一击！{target}踉跄后退！',
      '致命打击！这一下正中要害！',
      '完美一击！{target}被强大的力量震退！',
    ],
    weight: 1,
  },

  // ========== 击杀追加 ==========
  {
    id: 'kill_append_1',
    category: 'kill',
    templates: [
      '{target}发出最后一声哀嚎，轰然倒下！',
      '{target}再也无法支撑，化为光点消散了。',
      '致命一击！{target}倒在了地上，不再动弹。',
      '{target}的身体摇晃了一下，缓缓跪倒在地。',
    ],
    weight: 1,
  },

  // ========== 状态效果触发 ==========
  {
    id: 'effect_poison',
    category: 'effect_trigger',
    conditions: { effectType: 'poison' },
    templates: [
      '毒素渗入{target}的身体！(中毒)',
      '{target}中毒了！紫色的雾气从伤口蔓延。',
    ],
    weight: 2,
  },
  {
    id: 'effect_freeze',
    category: 'effect_trigger',
    conditions: { effectType: 'freeze' },
    templates: [
      '寒冰封锁了{target}！(冰冻)',
      '{target}被冻住了！冰晶覆盖全身。',
    ],
    weight: 2,
  },
  {
    id: 'effect_burn',
    category: 'effect_trigger',
    conditions: { effectType: 'burn' },
    templates: [
      '火焰灼烧着{target}！(灼烧)',
      '{target}身上燃起了火焰！持续灼烧中。',
    ],
    weight: 2,
  },
  {
    id: 'effect_stun',
    category: 'effect_trigger',
    conditions: { effectType: 'stun' },
    templates: [
      '{target}被震晕了！(眩晕)',
      '强烈的冲击让{target}头晕目眩！',
    ],
    weight: 2,
  },

  // ========== 持续效果结算 ==========
  {
    id: 'tick_poison',
    category: 'effect_tick',
    conditions: { effectType: 'poison' },
    templates: [
      '毒素侵蚀着{target}，损失了{damage}点HP。',
      '{target}因中毒受到{damage}点伤害。',
    ],
    weight: 1,
  },
  {
    id: 'tick_burn',
    category: 'effect_tick',
    conditions: { effectType: 'burn' },
    templates: [
      '灼烧的火焰吞噬{target}，损失{damage}点HP。',
      '{target}被火焰灼烧，受到{damage}点伤害。',
    ],
    weight: 1,
  },
  {
    id: 'tick_regen',
    category: 'effect_tick',
    conditions: { effectType: 'regen' },
    templates: [
      '再生之力治愈着{target}，恢复了{heal}点HP。',
      '{target}的伤口缓缓愈合，回复{heal}点HP。',
    ],
    weight: 1,
  },

  // ========== 防御 ==========
  {
    id: 'defend_1',
    category: 'player_defend',
    templates: [
      '{actor}举起防御姿态，准备迎接下一波攻击。',
      '{actor}集中精神，进入防御状态。减伤50%！',
    ],
    weight: 1,
  },

  // ========== 敌人攻击 ==========
  {
    id: 'ea_basic_1',
    category: 'enemy_attack',
    templates: [
      '{actor}冲向{target}发起攻击，造成{damage}点伤害！',
      '{actor}露出凶光，猛扑向{target}！{damage}点伤害！',
      '{actor}挥出利爪，{target}被击中，承受{damage}点伤害！',
    ],
    weight: 1,
  },

  // ========== 敌人技能 ==========
  {
    id: 'es_generic_1',
    category: 'enemy_skill',
    templates: [
      '{actor}释放了{skill}！{target}受到{damage}点伤害！',
      '{actor}凝聚{element}之力——{skill}！{target}被命中，{damage}点伤害！',
    ],
    weight: 1,
  },

  // ========== 战斗开始 ==========
  {
    id: 'battle_start_1',
    category: 'battle_start',
    templates: [
      '前方出现了{target}！战斗开始！',
      '危险！{target}拦住了去路！准备战斗！',
      '{target}从暗处现身，敌意毫不掩饰——战斗不可避免！',
    ],
    weight: 1,
  },

  // ========== 回合氛围 (每5回合插入一次) ==========
  {
    id: 'tension_1',
    category: 'round_tension',
    templates: [
      '战斗进入白热化！双方都在寻找决定性的一击。',
      '空气中弥漫着紧张的气息，胜负即将揭晓。',
      '激烈的交锋还在继续，双方都不肯退让半步。',
    ],
    weight: 1,
  },
];
```

### 8.3 叙事生成引擎

```typescript
// lib/game/narrative-engine.ts

interface NarrativeContext {
  actor: string;
  target: string;
  weapon?: string;
  skill?: string;
  element?: string;
  damage?: number;
  heal?: number;
  effect?: string;
  item?: string;
  hpPercent?: number;
  isCrit: boolean;
  isKill: boolean;
  weather?: string;
}

class NarrativeEngine {
  private templates: NarrativeTemplate[];

  /**
   * 生成战斗叙事
   * 纯本地计算，零延迟，零成本
   */
  generate(category: NarrativeCategory, ctx: NarrativeContext): string {
    // 1. 筛选匹配的模板（条件匹配+通用模板）
    const matched = this.templates
      .filter(t => t.category === category)
      .filter(t => this.matchConditions(t.conditions, ctx))
      .sort((a, b) => b.weight - a.weight);

    if (matched.length === 0) {
      return `${ctx.actor}对${ctx.target}发起了行动。`;
    }

    // 2. 加权随机选择模板组
    const selected = this.weightedSelect(matched);

    // 3. 从模板组中随机选择一条
    const template = selected.templates[
      Math.floor(Math.random() * selected.templates.length)
    ];

    // 4. 变量替换
    let narrative = this.replaceVariables(template, ctx);

    // 5. 追加暴击/击杀/状态效果描述
    if (ctx.isCrit) {
      narrative += this.generate('crit', ctx);
    }
    if (ctx.isKill) {
      narrative += this.generate('kill', ctx);
    }
    if (ctx.effect) {
      narrative += this.generate('effect_trigger', ctx);
    }

    return narrative;
  }

  private matchConditions(
    conditions: NarrativeTemplate['conditions'],
    ctx: NarrativeContext
  ): boolean {
    if (!conditions) return true; // 无条件=通用模板
    if (conditions.element && conditions.element !== ctx.element) return false;
    if (conditions.isCrit !== undefined && conditions.isCrit !== ctx.isCrit) return false;
    if (conditions.isKill !== undefined && conditions.isKill !== ctx.isKill) return false;
    if (conditions.effectType && conditions.effectType !== ctx.effect) return false;
    if (conditions.weatherMatch && conditions.weatherMatch !== ctx.weather) return false;
    if (conditions.hpPercentBelow !== undefined && 
        (ctx.hpPercent ?? 100) >= conditions.hpPercentBelow) return false;
    return true;
  }

  private replaceVariables(template: string, ctx: NarrativeContext): string {
    return template
      .replace(/{actor}/g, ctx.actor)
      .replace(/{target}/g, ctx.target)
      .replace(/{weapon}/g, ctx.weapon ?? '武器')
      .replace(/{skill}/g, ctx.skill ?? '技能')
      .replace(/{element}/g, ctx.element ?? '')
      .replace(/{damage}/g, String(ctx.damage ?? 0))
      .replace(/{heal}/g, String(ctx.heal ?? 0))
      .replace(/{effect}/g, ctx.effect ?? '')
      .replace(/{item}/g, ctx.item ?? '道具')
      .replace(/{hpPercent}/g, String(ctx.hpPercent ?? 100));
  }

  private weightedSelect(templates: NarrativeTemplate[]): NarrativeTemplate {
    const total = templates.reduce((sum, t) => sum + t.weight, 0);
    let roll = Math.random() * total;
    for (const t of templates) {
      roll -= t.weight;
      if (roll <= 0) return t;
    }
    return templates[templates.length - 1];
  }
}
```

---

## 九、难度自适应系统

### 9.1 动态难度调整

```typescript
// lib/game/difficulty-adapter.ts

interface DifficultyState {
  recentResults: BattleResult[];  // 最近10场战斗结果
  currentModifier: number;         // 当前难度修正 (0.8 ~ 1.3)
  consecutiveWins: number;
  consecutiveLosses: number;
}

/**
 * 根据玩家近期表现动态调整敌人强度
 * 目标: 保持约60-70%的胜率，确保挑战感又不至于沮丧
 */
function adjustDifficulty(state: DifficultyState): number {
  const recent = state.recentResults.slice(-10);
  const winRate = recent.filter(r => r === 'victory').length / Math.max(recent.length, 1);

  let modifier = state.currentModifier;

  // 连续获胜：缓慢提升难度
  if (state.consecutiveWins >= 5) {
    modifier = Math.min(modifier + 0.05, 1.3);
  } else if (state.consecutiveWins >= 3) {
    modifier = Math.min(modifier + 0.02, 1.3);
  }

  // 连续失败：快速降低难度（避免玩家沮丧）
  if (state.consecutiveLosses >= 3) {
    modifier = Math.max(modifier - 0.1, 0.8);
  } else if (state.consecutiveLosses >= 2) {
    modifier = Math.max(modifier - 0.05, 0.8);
  }

  // 胜率过高/过低时微调
  if (winRate > 0.8 && recent.length >= 5) {
    modifier = Math.min(modifier + 0.03, 1.3);
  } else if (winRate < 0.5 && recent.length >= 5) {
    modifier = Math.max(modifier - 0.03, 0.8);
  }

  return modifier;
}

/**
 * 应用难度修正到敌人属性
 */
function applyDifficultyToEnemy(
  baseStats: EnemyStats,
  difficultyModifier: number
): EnemyStats {
  return {
    ...baseStats,
    hp: Math.floor(baseStats.hp * difficultyModifier),
    attack: Math.floor(baseStats.attack * difficultyModifier),
    defense: Math.floor(baseStats.defense * difficultyModifier),
    // 速度不受难度影响（保持行动顺序的可预期性）
    speed: baseStats.speed,
    // 经验和金币随难度提升
    expReward: Math.floor(baseStats.expReward * difficultyModifier),
    goldReward: Math.floor(baseStats.goldReward * difficultyModifier),
  };
}
```

### 9.2 难度修正范围

| 场景 | 修正范围 | 说明 |
|------|----------|------|
| 随机冒险 | 0.8 ~ 1.3 | 全范围自适应 |
| BOSS战 | 0.9 ~ 1.1 | 微调，保持BOSS威严感 |
| 剧情战斗 | 1.0 (固定) | 不调整，确保叙事体验 |
| 试炼塔 | 1.0 + 层数×0.02 | 线性递增，纯挑战 |

---

> 📝 本文档定义了 ChaosSaga 的完整敌人AI行为决策系统。所有战斗决策均由本地算法驱动（行为树+加权随机），零API调用，保证高效率和真正的随机性。战斗叙事通过模板引擎生成，同样零成本零延迟。
