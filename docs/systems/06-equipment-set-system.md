# ChaosSaga - 套装与装备特效系统详细设计

> 版本: 1.0 | 更新日期: 2026-02-08
> 对应 GDD 章节: 六、装备与道具系统

---

## 一、装备系统架构

```
┌─────────────────────────────────────────────────────────────────┐
│                    装备系统层级                                    │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  L1 - 基础属性：HP/MP/攻/防/速 加成                              │
│  L2 - 品质倍率：白(1.0x)→绿(1.2x)→蓝(1.5x)→紫(2.0x)→橙(3.0x)→红(5.0x) │
│  L3 - 强化系统：+1~+15 递增加成                                  │
│  L4 - 词缀系统：随机附加特殊效果                                  │
│  L5 - 套装效果：集齐触发套装加成                                  │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## 二、强化系统

### 2.1 强化等级与成功率

| 强化等级 | 成功率 | 属性提升 | 消耗金币 | 消耗强化石 | 失败后果 |
|----------|--------|----------|----------|-----------|----------|
| +1 ~ +3 | 100% | +5% | 50×等级 | 1 | - |
| +4 ~ +6 | 80% | +8% | 100×等级 | 2 | 等级不变 |
| +7 ~ +9 | 60% | +12% | 200×等级 | 3 | 等级-1 |
| +10 ~ +12 | 40% | +15% | 400×等级 | 5 | 等级-2 |
| +13 ~ +15 | 20% | +20% | 800×等级 | 8 | 等级-3 |

### 2.2 强化计算

```typescript
// lib/game/equipment-enhance.ts

interface EnhanceResult {
  success: boolean;
  newLevel: number;
  statChange: StatBonus;
  consumed: { gold: number; stones: number };
}

function calculateEnhancedStats(
  baseItem: Item,
  enhanceLevel: number
): StatBonus {
  // 每级强化提升基础属性的百分比
  const enhancePercent = getEnhancePercent(enhanceLevel);
  
  return {
    hp: Math.floor(baseItem.hp * enhancePercent),
    mp: Math.floor(baseItem.mp * enhancePercent),
    attack: Math.floor(baseItem.attack * enhancePercent),
    defense: Math.floor(baseItem.defense * enhancePercent),
    speed: Math.floor(baseItem.speed * enhancePercent),
  };
}

function getEnhancePercent(level: number): number {
  if (level <= 0) return 0;
  // 累计加成 (非线性增长)
  let total = 0;
  for (let i = 1; i <= level; i++) {
    if (i <= 3) total += 0.05;
    else if (i <= 6) total += 0.08;
    else if (i <= 9) total += 0.12;
    else if (i <= 12) total += 0.15;
    else total += 0.20;
  }
  return total;
  // +3: 15%, +6: 39%, +9: 75%, +12: 120%, +15: 180%
}

function attemptEnhance(item: InventoryItem, player: Player): EnhanceResult {
  const currentLevel = item.enhanceLevel;
  const config = getEnhanceConfig(currentLevel + 1);
  
  // 扣除消耗
  const goldCost = config.goldBase * player.level;
  const stoneCost = config.stoneCount;
  
  if (player.gold < goldCost) throw new Error('金币不足');
  player.gold -= BigInt(goldCost);

  // 判定成功
  const success = Math.random() < config.successRate;

  if (success) {
    item.enhanceLevel = currentLevel + 1;
  } else {
    // 失败降级
    item.enhanceLevel = Math.max(0, currentLevel - config.failPenalty);
  }

  return {
    success,
    newLevel: item.enhanceLevel,
    statChange: calculateEnhancedStats(item.item, item.enhanceLevel),
    consumed: { gold: goldCost, stones: stoneCost },
  };
}
```

---

## 三、词缀系统

### 3.1 词缀分类

| 词缀类型 | 说明 | 品质要求 | 最大词缀数 |
|----------|------|----------|-----------|
| 基础词缀 | 固定属性加成 | 绿色以上 | 1 |
| 高级词缀 | 百分比属性加成 | 蓝色以上 | 1 |
| 特殊词缀 | 特殊效果/技能 | 紫色以上 | 1 |
| 传说词缀 | 强力唯一效果 | 橙色以上 | 1 |

### 3.2 词缀数据

```typescript
// lib/game/affixes.ts

interface Affix {
  id: string;
  name: string;
  tier: 'basic' | 'advanced' | 'special' | 'legendary';
  applicableTo: ItemType[];    // 可应用的装备类型
  effect: AffixEffect;
  weight: number;              // 出现权重
}

type AffixEffect =
  | { type: 'flat_stat'; stat: string; value: number }          // 固定属性: +50 HP
  | { type: 'percent_stat'; stat: string; percent: number }     // 百分比: +10% 攻击
  | { type: 'on_hit'; effect: string; chance: number }          // 命中触发: 10%中毒
  | { type: 'on_defend'; effect: string; chance: number }       // 受击触发: 15%反弹
  | { type: 'passive'; description: string; mechanic: string }; // 被动效果

const AFFIX_POOL: Affix[] = [
  // 基础词缀
  { id: 'affix_hp_1',     name: '坚韧',   tier: 'basic', applicableTo: ['armor'], 
    effect: { type: 'flat_stat', stat: 'hp', value: 50 }, weight: 20 },
  { id: 'affix_atk_1',    name: '锋利',   tier: 'basic', applicableTo: ['weapon'], 
    effect: { type: 'flat_stat', stat: 'attack', value: 10 }, weight: 20 },
  { id: 'affix_def_1',    name: '坚固',   tier: 'basic', applicableTo: ['armor'], 
    effect: { type: 'flat_stat', stat: 'defense', value: 8 }, weight: 20 },
  { id: 'affix_spd_1',    name: '迅捷',   tier: 'basic', applicableTo: ['accessory'],
    effect: { type: 'flat_stat', stat: 'speed', value: 5 }, weight: 15 },

  // 高级词缀
  { id: 'affix_atk_pct',  name: '狂暴',   tier: 'advanced', applicableTo: ['weapon'],
    effect: { type: 'percent_stat', stat: 'attack', percent: 10 }, weight: 10 },
  { id: 'affix_hp_pct',   name: '不朽',   tier: 'advanced', applicableTo: ['armor'],
    effect: { type: 'percent_stat', stat: 'hp', percent: 12 }, weight: 10 },
  { id: 'affix_crit',     name: '精准',   tier: 'advanced', applicableTo: ['weapon', 'accessory'],
    effect: { type: 'percent_stat', stat: 'critRate', percent: 3 }, weight: 8 },

  // 特殊词缀
  { id: 'affix_poison',   name: '剧毒',   tier: 'special', applicableTo: ['weapon'],
    effect: { type: 'on_hit', effect: 'poison', chance: 0.1 }, weight: 5 },
  { id: 'affix_lifesteal', name: '吸血', tier: 'special', applicableTo: ['weapon'],
    effect: { type: 'passive', description: '攻击回复5%伤害为HP', mechanic: 'lifesteal_5' }, weight: 4 },
  { id: 'affix_thorns',   name: '荆棘',   tier: 'special', applicableTo: ['armor'],
    effect: { type: 'on_defend', effect: 'reflect_10', chance: 0.2 }, weight: 5 },

  // 传说词缀
  { id: 'affix_ocean_bless', name: '海洋祝福', tier: 'legendary', applicableTo: ['weapon', 'accessory'],
    effect: { type: 'passive', description: '水系技能伤害+20%', mechanic: 'water_damage_20' }, weight: 1 },
  { id: 'affix_phoenix',    name: '浴火重生', tier: 'legendary', applicableTo: ['armor'],
    effect: { type: 'passive', description: '致死伤害时恢复30%HP(每战1次)', mechanic: 'revive_30_once' }, weight: 1 },
];

/**
 * 生成装备词缀
 */
function rollAffixes(item: Item): Affix[] {
  const maxAffixes = getMaxAffixCount(item.quality);
  const applicable = AFFIX_POOL.filter(a => {
    if (!a.applicableTo.includes(item.type)) return false;
    if (a.tier === 'advanced' && qualityIndex(item.quality) < qualityIndex('rare')) return false;
    if (a.tier === 'special' && qualityIndex(item.quality) < qualityIndex('epic')) return false;
    if (a.tier === 'legendary' && qualityIndex(item.quality) < qualityIndex('legendary')) return false;
    return true;
  });

  const selected: Affix[] = [];
  for (let i = 0; i < maxAffixes && applicable.length > 0; i++) {
    const affix = weightedRandomSelect(applicable);
    selected.push(affix);
    // 移除已选词缀避免重复
    const idx = applicable.indexOf(affix);
    applicable.splice(idx, 1);
  }

  return selected;
}

function getMaxAffixCount(quality: string): number {
  switch (quality) {
    case 'common': return 0;
    case 'uncommon': return 1;
    case 'rare': return 2;
    case 'epic': return 3;
    case 'legendary': return 3;
    case 'mythic': return 4;
    default: return 0;
  }
}
```

---

## 四、套装系统

### 4.1 套装效果设计

```typescript
interface SetBonus {
  setId: string;
  setName: string;
  pieces: string[];          // 组成物品ID
  bonuses: SetBonusLevel[];
}

interface SetBonusLevel {
  requiredPieces: number;    // 需要装备的件数
  effects: SetEffect[];
  description: string;
}

type SetEffect =
  | { type: 'stat'; stat: string; value: number }
  | { type: 'percent_stat'; stat: string; percent: number }
  | { type: 'passive'; mechanic: string; description: string };
```

### 4.2 套装列表

```typescript
const SET_BONUSES: SetBonus[] = [
  {
    setId: 'ocean_tide',
    setName: '海潮套装',
    pieces: ['ocean_helm', 'ocean_armor', 'ocean_gloves', 'ocean_boots', 'ocean_ring'],
    bonuses: [
      {
        requiredPieces: 2,
        effects: [{ type: 'stat', stat: 'mp', value: 100 }],
        description: '(2件) MP+100',
      },
      {
        requiredPieces: 3,
        effects: [{ type: 'percent_stat', stat: 'water_damage', percent: 15 }],
        description: '(3件) 水系伤害+15%',
      },
      {
        requiredPieces: 5,
        effects: [
          { type: 'percent_stat', stat: 'all_stat', percent: 10 },
          { type: 'passive', mechanic: 'ocean_regen', description: '每回合恢复3%最大MP' },
        ],
        description: '(5件) 全属性+10%，每回合恢复3%MP',
      },
    ],
  },
  {
    setId: 'coral_guardian',
    setName: '珊瑚守护套装',
    pieces: ['coral_shield', 'coral_armor', 'coral_helm', 'coral_boots'],
    bonuses: [
      {
        requiredPieces: 2,
        effects: [{ type: 'stat', stat: 'defense', value: 30 }],
        description: '(2件) 防御+30',
      },
      {
        requiredPieces: 4,
        effects: [
          { type: 'percent_stat', stat: 'hp', percent: 20 },
          { type: 'passive', mechanic: 'coral_shield', description: '受到致命伤害时，生成等同10%最大HP的护盾(每战1次)' },
        ],
        description: '(4件) HP+20%，被动: 珊瑚护盾(每战1次)',
      },
    ],
  },
  {
    setId: 'shadow_assassin',
    setName: '暗影刺客套装',
    pieces: ['shadow_blade', 'shadow_cloak', 'shadow_gloves', 'shadow_boots'],
    bonuses: [
      {
        requiredPieces: 2,
        effects: [
          { type: 'stat', stat: 'speed', value: 15 },
          { type: 'percent_stat', stat: 'critRate', percent: 5 },
        ],
        description: '(2件) 速度+15，暴击率+5%',
      },
      {
        requiredPieces: 4,
        effects: [
          { type: 'percent_stat', stat: 'critDamage', percent: 30 },
          { type: 'passive', mechanic: 'shadow_strike', description: '暴击时额外造成目标最大HP 5%的真实伤害' },
        ],
        description: '(4件) 暴击伤害+30%，被动: 暗影穿刺',
      },
    ],
  },
  {
    setId: 'light_blessing',
    setName: '光明祝福套装',
    pieces: ['light_staff', 'light_robe', 'light_crown', 'light_pendant'],
    bonuses: [
      {
        requiredPieces: 2,
        effects: [{ type: 'percent_stat', stat: 'healEffect', percent: 20 }],
        description: '(2件) 治疗效果+20%',
      },
      {
        requiredPieces: 4,
        effects: [
          { type: 'stat', stat: 'hp', value: 200 },
          { type: 'passive', mechanic: 'light_aura', description: '每回合开始时恢复5%最大HP' },
        ],
        description: '(4件) HP+200，被动: 光明光环',
      },
    ],
  },
];

/**
 * 计算玩家当前激活的套装效果
 */
function calculateSetBonuses(equippedItems: Item[]): SetEffect[] {
  const effects: SetEffect[] = [];
  
  // 统计每个套装装备了多少件
  const setCounts = new Map<string, number>();
  for (const item of equippedItems) {
    if (item.setId) {
      setCounts.set(item.setId, (setCounts.get(item.setId) ?? 0) + 1);
    }
  }

  // 检查套装效果
  for (const [setId, count] of setCounts) {
    const setBonus = SET_BONUSES.find(s => s.setId === setId);
    if (!setBonus) continue;

    for (const bonus of setBonus.bonuses) {
      if (count >= bonus.requiredPieces) {
        effects.push(...bonus.effects);
      }
    }
  }

  return effects;
}
```

---

## 五、装备评分系统

```typescript
/**
 * 计算装备综合评分（用于比较和排序）
 * 考虑: 基础属性 + 品质 + 强化 + 词缀 + 套装
 */
function calculateEquipmentScore(
  item: Item,
  enhanceLevel: number,
  affixes: Affix[]
): number {
  let score = 0;

  // 基础属性评分
  score += item.hp * 0.5;
  score += item.mp * 0.5;
  score += item.attack * 3;
  score += item.defense * 2;
  score += item.speed * 2;

  // 品质倍率
  const qualityMultiplier: Record<string, number> = {
    common: 1.0, uncommon: 1.2, rare: 1.5,
    epic: 2.0, legendary: 3.0, mythic: 5.0,
  };
  score *= qualityMultiplier[item.quality] ?? 1.0;

  // 强化加成
  score *= (1 + getEnhancePercent(enhanceLevel));

  // 词缀额外分
  for (const affix of affixes) {
    switch (affix.tier) {
      case 'basic': score += 10; break;
      case 'advanced': score += 25; break;
      case 'special': score += 50; break;
      case 'legendary': score += 100; break;
    }
  }

  // 套装加分
  if (item.setId) score += 15;

  return Math.floor(score);
}
```

---

> 📝 本文档定义了 ChaosSaga 的完整装备系统，包含强化（概率+降级惩罚）、词缀（4阶随机词缀池）、套装效果（多级套装加成）和装备评分系统。所有计算纯数值驱动。
