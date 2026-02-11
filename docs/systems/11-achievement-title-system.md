# ChaosSaga - 成就与称号系统详细设计

> 版本: 1.0 | 更新日期: 2026-02-08

---

## 一、成就分类

| 分类 | 说明 | 示例 |
|------|------|------|
| 战斗成就 | 战斗相关里程碑 | 首次胜利、百战不殆、BOSS猎人 |
| 探索成就 | 地图/区域探索 | 踏足新区、全图探索、秘境发现 |
| 收集成就 | 图鉴/物品收集 | 图鉴大师、装备收藏家 |
| 社交成就 | NPC/声望相关 | 人缘极佳、势力领袖 |
| 成长成就 | 境界/等级突破 | 境界突破者、满级传说 |
| 特殊成就 | 特定条件/隐藏 | 零伤通关、速通记录 |

---

## 二、成就数据结构

```typescript
// lib/game/achievements.ts

interface Achievement {
  id: string;
  name: string;
  description: string;
  category: string;
  icon: string;
  
  /** 解锁条件 */
  condition: AchievementCondition;
  
  /** 多阶段成就 */
  tiers?: AchievementTier[];
  
  /** 奖励 */
  reward: AchievementReward;
  
  /** 是否隐藏（未解锁前不显示） */
  isHidden: boolean;
  
  /** 稀有度提示 */
  rarity: 'common' | 'rare' | 'epic' | 'legendary';
}

type AchievementCondition =
  | { type: 'counter'; stat: string; target: number }       // 计数型: 击杀100只怪
  | { type: 'flag'; event: string }                          // 标记型: 首次BOSS击杀
  | { type: 'collection'; category: string; count: number }  // 收集型: 集齐10种生物
  | { type: 'compound'; conditions: AchievementCondition[]; logic: 'and' | 'or' }; // 复合

interface AchievementTier {
  tier: number;           // 1/2/3 星
  target: number;         // 该阶段目标值
  reward: AchievementReward;
}

interface AchievementReward {
  exp?: number;
  gold?: number;
  items?: { itemId: string; quantity: number }[];
  titleId?: string;       // 解锁称号
  statBonus?: { stat: string; value: number };  // 永久属性加成
}
```

---

## 三、成就列表示例

```typescript
const ACHIEVEMENTS: Achievement[] = [
  // ===== 战斗成就 =====
  {
    id: 'ach_first_blood',
    name: '初出茅庐',
    description: '赢得第一场战斗',
    category: 'combat',
    icon: '⚔️',
    condition: { type: 'counter', stat: 'battles_won', target: 1 },
    reward: { exp: 50, gold: 50 },
    isHidden: false,
    rarity: 'common',
  },
  {
    id: 'ach_battle_veteran',
    name: '百战老兵',
    description: '赢得战斗',
    category: 'combat',
    icon: '🏆',
    condition: { type: 'counter', stat: 'battles_won', target: 10 },
    tiers: [
      { tier: 1, target: 10,  reward: { exp: 100, titleId: 'title_novice_warrior' }},
      { tier: 2, target: 100, reward: { exp: 500, titleId: 'title_veteran' }},
      { tier: 3, target: 500, reward: { exp: 2000, titleId: 'title_war_god', statBonus: { stat: 'attack', value: 10 }}},
    ],
    reward: { exp: 100 },
    isHidden: false,
    rarity: 'common',
  },
  {
    id: 'ach_boss_slayer',
    name: 'BOSS猎人',
    description: '击败5个不同的BOSS',
    category: 'combat',
    icon: '👑',
    condition: { type: 'collection', category: 'boss_kills', count: 5 },
    reward: { exp: 1000, titleId: 'title_boss_hunter', items: [{ itemId: 'boss_trophy', quantity: 1 }]},
    isHidden: false,
    rarity: 'epic',
  },
  {
    id: 'ach_perfect_battle',
    name: '完美战斗',
    description: '在BOSS战中零伤害通关',
    category: 'combat',
    icon: '💎',
    condition: { type: 'flag', event: 'boss_no_damage' },
    reward: { titleId: 'title_untouchable', statBonus: { stat: 'speed', value: 5 }},
    isHidden: true,
    rarity: 'legendary',
  },

  // ===== 探索成就 =====
  {
    id: 'ach_explorer',
    name: '探索者',
    description: '探索区域',
    category: 'exploration',
    icon: '🗺️',
    condition: { type: 'counter', stat: 'areas_explored', target: 3 },
    tiers: [
      { tier: 1, target: 3,  reward: { exp: 200 }},
      { tier: 2, target: 10, reward: { exp: 800, titleId: 'title_explorer' }},
      { tier: 3, target: 25, reward: { exp: 3000, titleId: 'title_world_traveler' }},
    ],
    reward: { exp: 200 },
    isHidden: false,
    rarity: 'common',
  },

  // ===== 成长成就 =====
  {
    id: 'ach_realm_land',
    name: '踏足大地',
    description: '突破至陆地级',
    category: 'growth',
    icon: '🏔️',
    condition: { type: 'flag', event: 'realm_breakthrough_land' },
    reward: { exp: 500, gold: 1000, titleId: 'title_earth_walker' },
    isHidden: false,
    rarity: 'rare',
  },
];
```

---

## 四、称号系统

### 4.1 称号效果

```typescript
interface Title {
  id: string;
  name: string;
  description: string;
  source: string;           // 获取途径描述
  
  /** 称号效果（装备后生效） */
  effects: TitleEffect[];
  
  /** 稀有度 */
  rarity: 'common' | 'rare' | 'epic' | 'legendary';
}

type TitleEffect =
  | { type: 'stat'; stat: string; value: number }           // 固定属性
  | { type: 'percent_stat'; stat: string; percent: number }  // 百分比属性
  | { type: 'special'; mechanic: string; description: string };

const TITLES: Title[] = [
  {
    id: 'title_novice_warrior',
    name: '新手战士',
    description: '赢得10场战斗',
    source: '成就: 百战老兵(Tier1)',
    effects: [{ type: 'stat', stat: 'attack', value: 3 }],
    rarity: 'common',
  },
  {
    id: 'title_boss_hunter',
    name: 'BOSS猎人',
    description: '击败5个不同BOSS',
    source: '成就: BOSS猎人',
    effects: [
      { type: 'percent_stat', stat: 'boss_damage', percent: 10 },
    ],
    rarity: 'epic',
  },
  {
    id: 'title_untouchable',
    name: '不可触碰',
    description: 'BOSS战零伤通关',
    source: '隐藏成就: 完美战斗',
    effects: [
      { type: 'stat', stat: 'speed', value: 5 },
      { type: 'special', mechanic: 'dodge_chance_3', description: '3%概率闪避任何攻击' },
    ],
    rarity: 'legendary',
  },
  {
    id: 'title_coral_guardian',
    name: '珊瑚海守护者',
    description: '渔民联盟声望崇拜',
    source: '声望: 渔民联盟崇拜',
    effects: [
      { type: 'percent_stat', stat: 'attack', percent: 5 },
      { type: 'percent_stat', stat: 'water_damage', percent: 10 },
    ],
    rarity: 'epic',
  },
];
```

### 4.2 称号管理

```typescript
/**
 * 玩家同时只能装备一个称号
 * 但已解锁的称号可随时切换
 */
interface PlayerTitleState {
  unlockedTitles: string[];    // 已解锁的称号ID列表
  equippedTitle: string | null; // 当前装备的称号
}

function getEquippedTitleEffects(titleId: string | null): TitleEffect[] {
  if (!titleId) return [];
  const title = TITLES.find(t => t.id === titleId);
  return title?.effects ?? [];
}
```

---

## 五、数据库扩展

```prisma
model PlayerAchievement {
  id           String   @id @default(cuid())
  playerId     String
  achievementId String
  currentTier  Int      @default(1)
  progress     Int      @default(0)
  unlockedAt   DateTime @default(now())
  
  player Player @relation(fields: [playerId], references: [id], onDelete: Cascade)
  
  @@unique([playerId, achievementId])
}
```

---

> 📝 本文档定义了 ChaosSaga 的成就与称号系统。包含6大类成就、多阶段成就进阶、隐藏成就，以及称号的属性加成效果。称号同时只能装备一个，增加策略选择。
