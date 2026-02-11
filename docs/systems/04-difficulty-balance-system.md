# ChaosSaga - 难度曲线与数值平衡详细设计

> 版本: 1.0 | 更新日期: 2026-02-08
> 对应 GDD 章节: 三、玩家系统 / 四、战斗系统
> 设计原则: **全部传统数值计算，数学公式驱动**

---

## 一、设计目标

```
┌─────────────────────────────────────────────────────────────────┐
│                    数值平衡设计目标                                │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  1. 成长感：玩家每次提升都能感受到明显的变强                       │
│  2. 挑战感：同等级内容保持 60-70% 胜率，不无聊也不沮丧            │
│  3. 策略性：属性克制和技能选择比纯等级碾压更重要                   │
│  4. 可持续：经济产出/消耗长期平衡，不通胀也不紧缩                 │
│  5. 节奏感：每个游戏会话(20-30分钟)都有"完成一件事"的满足感       │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## 二、玩家成长曲线

### 2.1 等级与属性完整对照表（海洋级 Lv.1-10 详表）

```
境界系数 = 1.0 (海洋级)
```

| Lv | 最大HP | 最大MP | 攻击 | 防御 | 速度 | 升级所需经验 | 累计经验 |
|----|--------|--------|------|------|------|-------------|----------|
| 1  | 120    | 95     | 15   | 8    | 52   | 100         | 0        |
| 2  | 140    | 110    | 20   | 11   | 54   | 283         | 100      |
| 3  | 160    | 125    | 25   | 14   | 56   | 520         | 383      |
| 4  | 180    | 140    | 30   | 17   | 58   | 800         | 903      |
| 5  | 200    | 155    | 35   | 20   | 60   | 1118        | 1703     |
| 6  | 220    | 170    | 40   | 23   | 62   | 1470        | 2821     |
| 7  | 240    | 185    | 45   | 26   | 64   | 1852        | 4291     |
| 8  | 260    | 200    | 50   | 29   | 66   | 2263        | 6143     |
| 9  | 280    | 215    | 55   | 32   | 68   | 2700        | 8406     |
| 10 | 300    | 230    | 60   | 35   | 70   | -(突破)     | 11106    |

### 2.2 各境界关键属性预览

| 境界 | 等级 | 系数 | Lv起始HP | Lv终HP | Lv起始攻击 | Lv终攻击 |
|------|------|------|----------|--------|-----------|----------|
| 海洋级 | 1-10  | 1.0   | 120    | 300    | 15    | 60     |
| 陆地级 | 11-20 | 2.0   | 620    | 1000   | 110   | 200    |
| 荒芜级 | 21-30 | 4.0   | 2080   | 3600   | 410   | 720    |
| 行星级 | 31-40 | 8.0   | 7360   | 13600  | 1520  | 2880   |
| 恒星级 | 41-50 | 16.0  | 27520  | 52000  | 5840  | 11200  |
| 银河级 | 51-60 | 32.0  | 105,280 | 200,000 | 22,880 | 44,160 |

### 2.3 属性计算公式汇总

```typescript
// lib/game/player-stats.ts

/** 境界系数表 */
const REALM_COEFFICIENTS: Record<string, number> = {
  ocean: 1.0,    // 海洋级
  land: 2.0,     // 陆地级
  barren: 4.0,   // 荒芜级
  planet: 8.0,   // 行星级
  star: 16.0,    // 恒星级
  galaxy: 32.0,  // 银河级
  beyond: 64.0,  // 超越级
  ancient: 128.0,// 洪荒级
  void: 256.0,   // 空灵级
  origin: 512.0, // 元初级
};

interface StatCalculationResult {
  maxHp: number;
  maxMp: number;
  attack: number;
  defense: number;
  speed: number;
}

/**
 * 计算玩家最终属性
 * 最终属性 = 基础属性 × 境界系数 + 装备加成 + 图鉴加成 + 临时buff
 */
function calculatePlayerStats(
  level: number,
  realm: string,
  equipmentBonus: StatBonus,
  collectionBonus: StatBonus,
  buffBonus: StatBonus
): StatCalculationResult {
  const coeff = REALM_COEFFICIENTS[realm] ?? 1.0;

  return {
    maxHp: Math.floor((100 + level * 20) * coeff) + equipmentBonus.hp + collectionBonus.hp + buffBonus.hp,
    maxMp: Math.floor((80 + level * 15) * coeff) + equipmentBonus.mp + collectionBonus.mp + buffBonus.mp,
    attack: Math.floor((10 + level * 5) * coeff) + equipmentBonus.attack + collectionBonus.attack + buffBonus.attack,
    defense: Math.floor((5 + level * 3) * coeff) + equipmentBonus.defense + collectionBonus.defense + buffBonus.defense,
    speed: 50 + level * 2 + equipmentBonus.speed + collectionBonus.speed + buffBonus.speed,
  };
}

/**
 * 升级所需经验
 * 公式: 100 × (level ^ 1.5)
 */
function expToNextLevel(level: number): number {
  return Math.floor(100 * Math.pow(level, 1.5));
}

/**
 * 战斗经验获取
 * 公式: 敌人基础经验 × (1 + 难度系数) × 经验加成
 * 等级差惩罚: 敌人等级比玩家低5级以上，经验减半
 */
function calculateBattleExp(
  enemyBaseExp: number,
  difficultyModifier: number,
  expBonus: number,
  playerLevel: number,
  enemyLevel: number
): number {
  let exp = enemyBaseExp * (1 + difficultyModifier) * (1 + expBonus);
  
  // 等级差惩罚
  const levelDiff = playerLevel - enemyLevel;
  if (levelDiff >= 10) exp *= 0.1;       // 10级以上差距：仅10%经验
  else if (levelDiff >= 7) exp *= 0.3;   // 7-9级差距：30%
  else if (levelDiff >= 5) exp *= 0.5;   // 5-6级差距：50%
  else if (levelDiff >= 3) exp *= 0.8;   // 3-4级差距：80%
  // 低于玩家3级内或高于玩家：100%

  // 敌人高于玩家时有额外奖励
  if (enemyLevel > playerLevel) {
    exp *= 1 + (enemyLevel - playerLevel) * 0.1; // 每高1级+10%
  }

  return Math.floor(exp);
}
```

---

## 三、敌人数值模型

### 3.1 敌人基础属性公式

```typescript
// lib/game/enemy-stats.ts

/** 敌人类型修正 */
const ENEMY_TYPE_MODIFIERS = {
  normal:  { hp: 1.0, attack: 1.0, defense: 1.0, exp: 1.0, gold: 1.0 },
  elite:   { hp: 2.5, attack: 1.5, defense: 1.3, exp: 3.0, gold: 3.0 },
  boss:    { hp: 5.0, attack: 2.0, defense: 1.5, exp: 8.0, gold: 8.0 },
  miniboss:{ hp: 3.5, attack: 1.8, defense: 1.4, exp: 5.0, gold: 5.0 },
};

/**
 * 根据等级生成敌人基础属性
 * 设计原则：同等级敌人约为玩家属性的60-80%
 * 多敌人时总量接近100-130%
 */
function generateEnemyStats(
  level: number,
  realm: string,
  type: 'normal' | 'elite' | 'boss' | 'miniboss'
): EnemyBaseStats {
  const coeff = REALM_COEFFICIENTS[realm] ?? 1.0;
  const mod = ENEMY_TYPE_MODIFIERS[type];

  // 基础值为玩家属性的约70%
  const baseHp = Math.floor((100 + level * 20) * coeff * 0.7 * mod.hp);
  const baseAttack = Math.floor((10 + level * 5) * coeff * 0.65 * mod.attack);
  const baseDefense = Math.floor((5 + level * 3) * coeff * 0.6 * mod.defense);
  const baseSpeed = Math.floor((50 + level * 2) * 0.9); // 速度略低于玩家

  // 经验和金币奖励
  const baseExp = Math.floor(30 + level * 8 * mod.exp);
  const baseGold = Math.floor(15 + level * 5 * mod.gold);

  return { hp: baseHp, attack: baseAttack, defense: baseDefense, 
           speed: baseSpeed, exp: baseExp, gold: baseGold };
}
```

### 3.2 敌人配置表（海洋级示例）

| 敌人名称 | 等级 | 类型 | HP | 攻击 | 防御 | 速度 | 属性 | 经验 | 金币 |
|----------|------|------|-----|------|------|------|------|------|------|
| 小珊瑚蟹 | 1 | normal | 84 | 10 | 5 | 47 | water | 38 | 20 |
| 海藻怪 | 2 | normal | 98 | 13 | 7 | 49 | water | 46 | 25 |
| 毒水母 | 3 | normal | 112 | 16 | 8 | 51 | water | 54 | 30 |
| 珊瑚蟹 | 4 | normal | 126 | 20 | 10 | 53 | water | 62 | 35 |
| 深海蟹怪 | 5 | normal | 140 | 23 | 12 | 55 | water | 70 | 40 |
| 海蛇 | 5 | normal | 140 | 26 | 10 | 58 | water | 70 | 40 |
| 幽灵水手 | 6 | normal | 154 | 26 | 14 | 57 | dark | 78 | 45 |
| 海妖小兵 | 7 | normal | 168 | 29 | 15 | 59 | water | 86 | 50 |
| 海妖斥候 | 8 | elite | 420 | 49 | 23 | 61 | water | 192 | 120 |
| 深海蟹将 | 8 | miniboss | 490 | 54 | 25 | 58 | water | 320 | 200 |
| 海妖女王 | 10 | boss | 1050 | 78 | 32 | 65 | water | 640 | 400 |

### 3.3 战斗时长预期

| 战斗类型 | 预期回合数 | 预期时间(含阅读) |
|----------|-----------|-----------------|
| 普通战斗(1v1) | 4-6回合 | 2-3分钟 |
| 普通战斗(1v2) | 5-8回合 | 3-4分钟 |
| 精英战斗 | 8-12回合 | 4-6分钟 |
| BOSS战 | 12-20回合 | 6-10分钟 |
| 试炼塔单层 | 3-5回合 | 1-2分钟 |

---

## 四、伤害模型深度分析

### 4.1 完整伤害计算链

```typescript
// lib/game/damage-calculator.ts

interface DamageCalcInput {
  attacker: {
    attack: number;
    critRate: number;
    critDamage: number;
    element: string;
    level: number;
    statusEffects: StatusEffect[];
  };
  defender: {
    defense: number;
    element: string;
    level: number;
    statusEffects: StatusEffect[];
    isDefending: boolean;
  };
  skill: {
    damageRatio: number;
    element: string;
    ignoreDefensePercent?: number; // 暗影箭等无视防御
  };
  environment: {
    weather: string;
    timeOfDay: string;
    season: string;
  };
}

interface DamageCalcResult {
  finalDamage: number;
  isCrit: boolean;
  elementBonus: number;    // 属性克制倍率
  environmentBonus: number; // 环境加成倍率
  breakdown: {
    baseDamage: number;
    afterDefense: number;
    afterCrit: number;
    afterElement: number;
    afterEnvironment: number;
    afterRandom: number;
  };
}

function calculateDamage(input: DamageCalcInput): DamageCalcResult {
  const { attacker, defender, skill, environment } = input;

  // ===== Step 1: 基础伤害 =====
  const baseDamage = attacker.attack * skill.damageRatio;

  // ===== Step 2: 防御减伤 =====
  // 公式: 减伤率 = 防御 / (防御 + 100)
  // Lv1 防御8: 减伤7.4%  |  Lv10 防御35: 减伤25.9%
  // Lv50 防御560: 减伤84.8% (高境界需要穿透/无视防御)
  let effectiveDefense = defender.defense;
  
  // 无视防御
  if (skill.ignoreDefensePercent) {
    effectiveDefense = Math.floor(effectiveDefense * (1 - skill.ignoreDefensePercent));
  }
  
  // 防御姿态加成
  if (defender.isDefending) {
    effectiveDefense = Math.floor(effectiveDefense * 1.5); // 防御状态防御+50%
  }

  const defenseReduction = effectiveDefense / (effectiveDefense + 100);
  const afterDefense = baseDamage * (1 - defenseReduction);

  // ===== Step 3: 暴击判定 =====
  const isCrit = Math.random() < attacker.critRate;
  const afterCrit = isCrit ? afterDefense * attacker.critDamage : afterDefense;

  // ===== Step 4: 属性克制 =====
  const elementBonus = getElementMultiplier(skill.element, defender.element);
  const afterElement = afterCrit * elementBonus;

  // ===== Step 5: 环境加成 =====
  const environmentBonus = getEnvironmentDamageBonus(skill.element, environment);
  const afterEnvironment = afterElement * environmentBonus;

  // ===== Step 6: 状态效果影响 =====
  let statusMultiplier = 1.0;
  // 攻击方增伤buff
  for (const effect of attacker.statusEffects) {
    if (effect.type === 'attack_up') statusMultiplier *= (1 + effect.value / 100);
  }
  // 防御方减伤/增伤debuff
  for (const effect of defender.statusEffects) {
    if (effect.type === 'defense_down') statusMultiplier *= (1 + effect.value / 100);
  }
  const afterStatus = afterEnvironment * statusMultiplier;

  // ===== Step 7: 随机浮动 ±10% =====
  const randomFactor = 0.9 + Math.random() * 0.2;
  const afterRandom = afterStatus * randomFactor;

  // ===== 最终伤害（最低1） =====
  const finalDamage = Math.max(1, Math.floor(afterRandom));

  return {
    finalDamage,
    isCrit,
    elementBonus,
    environmentBonus,
    breakdown: {
      baseDamage: Math.floor(baseDamage),
      afterDefense: Math.floor(afterDefense),
      afterCrit: Math.floor(afterCrit),
      afterElement: Math.floor(afterElement),
      afterEnvironment: Math.floor(afterEnvironment),
      afterRandom: finalDamage,
    },
  };
}
```

### 4.2 属性克制表

```typescript
/**
 * 属性克制关系
 * 水克火、火克木(风)、木克土、土克水
 * 暗 ↔ 光 互相克制
 */
const ELEMENT_CHART: Record<string, Record<string, number>> = {
  water: { fire: 1.3, earth: 0.7, water: 1.0, wind: 1.0, dark: 1.0, light: 1.0, none: 1.0 },
  fire:  { wind: 1.3, water: 0.7, fire: 1.0, earth: 1.0, dark: 1.0, light: 1.0, none: 1.0 },
  wind:  { earth: 1.3, fire: 0.7, wind: 1.0, water: 1.0, dark: 1.0, light: 1.0, none: 1.0 },
  earth: { water: 1.3, wind: 0.7, earth: 1.0, fire: 1.0, dark: 1.0, light: 1.0, none: 1.0 },
  dark:  { light: 1.3, dark: 1.0, water: 1.0, fire: 1.0, wind: 1.0, earth: 1.0, none: 1.0 },
  light: { dark: 1.3, light: 1.0, water: 1.0, fire: 1.0, wind: 1.0, earth: 1.0, none: 1.0 },
  none:  { water: 1.0, fire: 1.0, wind: 1.0, earth: 1.0, dark: 1.0, light: 1.0, none: 1.0 },
};

function getElementMultiplier(attackElement: string, defenseElement: string): number {
  return ELEMENT_CHART[attackElement]?.[defenseElement] ?? 1.0;
}
```

### 4.3 伤害验证（Lv.5 玩家 vs Lv.5 敌人 模拟）

```
玩家: Lv.5 海洋级, 攻击35, 暴击率5%, 暴击伤害1.5x
敌人: 深海蟹怪, Lv.5, HP140, 防御12

=== 普通攻击 (倍率1.0) ===
基础伤害: 35 × 1.0 = 35
防御减伤: 12/(12+100) = 10.7% → 35 × 0.893 = 31.3
非暴击: ~31 (±10% = 28~34)
暴击: 31 × 1.5 = ~47

→ 需要 4-5 次普攻击杀 (140/31 ≈ 4.5)
→ 合理：纯普攻约5回合结束

=== 冰箭术 (倍率1.3, 水系) ===
基础伤害: 35 × 1.3 = 45.5
防御减伤: → 45.5 × 0.893 = 40.6
属性克制(水vs水): 1.0 → 40.6
非暴击: ~41 (±10% = 37~45)

→ 需要 3-4 次技能击杀
→ 技能比普攻强约30%，符合预期

=== 暗影箭 (倍率1.8, 暗系, 无视30%防御) ===
有效防御: 12 × 0.7 = 8.4
基础伤害: 35 × 1.8 = 63
防御减伤: 8.4/(8.4+100) = 7.8% → 63 × 0.922 = 58.1
非暴击: ~58 (±10% = 52~64)

→ 需要 2-3 次击杀
→ 高倍率+穿甲效果明显，但MP消耗高(35)，不可滥用
```

---

## 五、经济系统平衡

### 5.1 单场战斗收益预期

| 等级段 | 战斗类型 | 经验 | 金币 | 装备掉落率 |
|--------|----------|------|------|-----------|
| Lv.1-5 | 普通 | 38-70 | 20-40 | 15% (白/绿) |
| Lv.1-5 | 精英 | 192 | 120 | 40% (绿/蓝) |
| Lv.1-5 | BOSS | 640 | 400 | 80% (蓝/紫) |
| Lv.6-10 | 普通 | 78-110 | 45-60 | 15% |
| Lv.6-10 | 精英 | 250 | 150 | 45% |
| Lv.6-10 | BOSS | 800 | 500 | 85% |

### 5.2 升级节奏设计

```
设计目标: 每个等级需要 8-12 场普通战斗 升级
         或 3-5 场包含精英/BOSS的混合战斗

示例: Lv.5 → Lv.6 需要 1118 经验
  - 纯普通战斗(~70exp): 1118/70 = ~16场 (偏多，鼓励做任务)
  - 任务+战斗: 任务奖励~300exp + 8场战斗(~560exp) = ~860 ≈ 合理
  - 包含精英: 任务300 + 5场普通350 + 2场精英384 = 1034 ≈ 合理

预期每级游戏时间: 20-30分钟
预期海洋级(1-10)总时间: 3-5小时
```

### 5.3 金币产出与消耗平衡

```typescript
// 海洋级经济平衡预览

/** 产出 (每级平均) */
const INCOME_PER_LEVEL = {
  battleGold: 400,      // ~10场战斗 × ~40金币
  questGold: 200,       // 任务奖励
  sellItems: 100,       // 出售多余掉落
  adventureGold: 50,    // 奇遇事件
  // 总计: ~750/级
};

/** 消耗 (每级平均) */
const EXPENSES_PER_LEVEL = {
  potions: 150,         // 回复药剂 (~5瓶 × 30金币)
  equipEnhance: 200,    // 装备强化 (每2级强化一次)
  shopPurchase: 100,    // 商店购买杂项
  adventureCost: 50,    // 奇遇事件消耗
  // 总计: ~500/级
};

// 净余: ~250/级，足够积累但不会过剩
// 境界突破消耗: ~2000灵石 (需要约10级积累的副本灵石)
```

### 5.4 掉落概率表

```typescript
// lib/game/loot-table.ts

interface LootEntry {
  itemId: string;
  dropRate: number;     // 0.0 ~ 1.0
  minQuantity: number;
  maxQuantity: number;
  qualityWeights?: Record<string, number>; // 品质权重
}

/** 品质权重（根据敌人类型） */
const QUALITY_WEIGHTS = {
  normal: { common: 60, uncommon: 30, rare: 8, epic: 2, legendary: 0, mythic: 0 },
  elite:  { common: 20, uncommon: 40, rare: 30, epic: 8, legendary: 2, mythic: 0 },
  boss:   { common: 5, uncommon: 15, rare: 40, epic: 30, legendary: 8, mythic: 2 },
};

/**
 * 执行掉落判定
 */
function rollLoot(
  lootTable: LootEntry[],
  enemyType: string,
  playerLuck: number
): LootResult[] {
  const results: LootResult[] = [];

  for (const entry of lootTable) {
    // 幸运值影响掉落率: 每10点幸运+1%
    const adjustedRate = Math.min(entry.dropRate * (1 + playerLuck * 0.001), 1.0);

    if (Math.random() < adjustedRate) {
      const quantity = randomInt(entry.minQuantity, entry.maxQuantity);
      const quality = rollQuality(QUALITY_WEIGHTS[enemyType] ?? QUALITY_WEIGHTS.normal, playerLuck);

      results.push({
        itemId: entry.itemId,
        quantity,
        quality,
      });
    }
  }

  return results;
}

function rollQuality(weights: Record<string, number>, luck: number): string {
  // 幸运值提升稀有品质概率
  const adjusted = { ...weights };
  adjusted.rare = (adjusted.rare ?? 0) * (1 + luck * 0.002);
  adjusted.epic = (adjusted.epic ?? 0) * (1 + luck * 0.003);
  adjusted.legendary = (adjusted.legendary ?? 0) * (1 + luck * 0.005);

  const total = Object.values(adjusted).reduce((sum, w) => sum + w, 0);
  let roll = Math.random() * total;

  for (const [quality, weight] of Object.entries(adjusted)) {
    roll -= weight;
    if (roll <= 0) return quality;
  }
  return 'common';
}
```

---

## 六、境界突破平衡

### 6.1 突破条件总表

| 突破 | 等级要求 | 突破丹 | 灵石消耗 | 当前境界战斗次数 | 备注 |
|------|----------|--------|----------|-----------------|------|
| 海洋→陆地 | Lv.10 | 陆地突破丹×1 | 500 | ≥30 | 可通过任务获得突破丹 |
| 陆地→荒芜 | Lv.20 | 荒芜突破丹×1 | 2000 | ≥60 | 需探索特定区域 |
| 荒芜→行星 | Lv.30 | 行星突破丹×1 | 8000 | ≥100 | 需击败特定BOSS |
| 行星→恒星 | Lv.40 | 恒星突破丹×1 | 30000 | ≥150 | 需完成星际试炼 |
| 恒星→银河 | Lv.50 | 银河突破丹×1 | 100000 | ≥200 | 需觉醒特殊能力 |

### 6.2 突破时属性跳跃

```typescript
/**
 * 境界突破时的属性重算
 * 突破后属性会有显著跳跃，给玩家强烈的成长感
 */
function onRealmBreakthrough(player: Player, newRealm: string): void {
  const oldCoeff = REALM_COEFFICIENTS[player.realm];
  const newCoeff = REALM_COEFFICIENTS[newRealm];
  
  // 重新计算所有属性
  const newStats = calculatePlayerStats(
    player.level, newRealm,
    getEquipmentBonus(player),
    getCollectionBonus(player),
    getBuffBonus(player)
  );

  // 示例: 海洋Lv.10(系数1.0) → 陆地Lv.11(系数2.0)
  // HP: 300 → 620 (+106%)
  // 攻击: 60 → 110 (+83%)
  // 这种翻倍式的成长极大增强成就感

  player.realm = newRealm;
  player.maxHp = newStats.maxHp;
  player.maxMp = newStats.maxMp;
  player.attack = newStats.attack;
  player.defense = newStats.defense;
  player.speed = newStats.speed;
  
  // 突破后满血满蓝
  player.currentHp = player.maxHp;
  player.currentMp = player.maxMp;
}
```

---

## 七、难度等级系统

### 7.1 四个难度等级

| 难度 | 敌人属性倍率 | 奖励倍率 | 适合场景 |
|------|-------------|----------|----------|
| 简单 (Easy) | 0.8x | 0.7x | 新手/休闲/挂机 |
| 普通 (Normal) | 1.0x | 1.0x | 默认难度 |
| 困难 (Hard) | 1.3x | 1.5x | 挑战/刷装备 |
| 噩梦 (Nightmare) | 1.6x | 2.0x | 极限挑战 |

### 7.2 战斗评分系统

```typescript
/**
 * 战斗结束后的表现评分
 * 影响额外奖励和图鉴评价
 */
function calculateBattleScore(battleResult: BattleResult): BattleScore {
  let score = 0;

  // 基础分: 胜利100分, 失败30分, 逃跑10分
  if (battleResult.result === 'victory') score += 100;
  else if (battleResult.result === 'defeat') score += 30;
  else score += 10;

  // 回合效率: 越快越高分
  // 理想回合数的1.5倍以内为A, 2倍以内为B, 超过为C
  const idealRounds = Math.ceil(battleResult.totalEnemyHp / battleResult.playerAttack / 0.7);
  const roundRatio = battleResult.rounds / idealRounds;
  if (roundRatio <= 1.0) score += 50;       // S级效率
  else if (roundRatio <= 1.5) score += 35;  // A级
  else if (roundRatio <= 2.0) score += 20;  // B级
  else score += 10;                          // C级

  // HP保持: 结束时HP越高越高分
  const hpPercent = battleResult.playerHpPercent;
  if (hpPercent >= 0.8) score += 30;
  else if (hpPercent >= 0.5) score += 20;
  else if (hpPercent >= 0.2) score += 10;
  else score += 5;

  // 零伤害加分
  if (battleResult.damageTaken === 0) score += 20;

  // 评级
  const grade = score >= 180 ? 'S' : score >= 150 ? 'A' : score >= 100 ? 'B' : 'C';

  // 评级对应的奖励倍率
  const rewardMultiplier = { S: 1.5, A: 1.2, B: 1.0, C: 0.9 }[grade];

  return { score, grade, rewardMultiplier };
}
```

---

## 八、会话节奏设计

### 8.1 理想的20分钟游戏会话

```
┌────────────────────────────────────────────────────────────┐
│             理想的20分钟游戏会话                              │
├────────────────────────────────────────────────────────────┤
│                                                            │
│  0-2分钟: 登录，查看状态，检查任务                           │
│           └→ 满足感: "我知道今天要做什么"                    │
│                                                            │
│  2-5分钟: 接任务/选择区域探索                                │
│           └→ AI生成区域背景（首次）或直接进入                 │
│                                                            │
│  5-12分钟: 2-3场战斗                                        │
│           └→ 核心游戏循环，战斗+奖励                        │
│           └→ 可能触发奇遇事件                               │
│                                                            │
│  12-16分钟: 交任务/整理装备                                  │
│           └→ 满足感: "我完成了一个任务/升了级"               │
│                                                            │
│  16-20分钟: 再打1-2场或探索                                  │
│           └→ 为下次会话留下"钩子"（新任务/新区域提示）       │
│                                                            │
│  会话结算: 经验+金币+可能的装备+任务进度                      │
│           └→ 满足感: "这20分钟很值得"                       │
│                                                            │
└────────────────────────────────────────────────────────────┘
```

---

> 📝 本文档定义了 ChaosSaga 的完整数值平衡体系。所有数值计算由数学公式驱动，包含详细的属性模型、伤害计算、经济系统和会话节奏设计。关键设计点已通过数值验证（Lv.5模拟战斗），确保游戏体验合理。
