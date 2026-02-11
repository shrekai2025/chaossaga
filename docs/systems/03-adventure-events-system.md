# ChaosSaga - 奇遇事件系统详细设计

> 版本: 1.0 | 更新日期: 2026-02-08
> 对应 GDD 章节: 九、AI剧本创作系统 (奇遇子系统)

---

## 一、系统总览

```
┌─────────────────────────────────────────────────────────────────┐
│                    奇遇事件系统架构                                │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ┌──────────┐    ┌──────────────┐    ┌──────────────────────┐  │
│  │ 触发判定  │ →  │ 事件等级抽取  │ →  │ 事件池筛选与抽取     │  │
│  │(概率计算) │    │(加权随机)    │    │(条件匹配+AI生成)    │  │
│  └──────────┘    └──────────────┘    └──────────┬───────────┘  │
│                                                  │              │
│                                                  ▼              │
│  ┌──────────┐    ┌──────────────┐    ┌──────────────────────┐  │
│  │ 结算奖惩  │ ←  │ 玩家做出选择  │ ←  │ 展示事件与选项       │  │
│  │(数值计算) │    │              │    │                      │  │
│  └──────────┘    └──────────────┘    └──────────────────────┘  │
│       │                                                        │
│       ▼                                                        │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │  记录到奇遇日志 / 更新图鉴 / 触发后续链式事件            │  │
│  └──────────────────────────────────────────────────────────┘  │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘

设计原则:
- 触发判定、等级抽取、奖励结算 = 传统数值计算（本地算法）
- 事件剧情文本 = AI生成（仅叙事层）或预制模板
- 选项结果 = 预定义数值 + AI叙事包装
```

---

## 二、触发系统

### 2.1 触发时机

| 触发时机 | 判定频率 | 说明 |
|----------|----------|------|
| 战斗胜利后 | 每次战斗结算时 | 最常见的触发点 |
| 进入新区域 | 首次进入时 | 区域专属奇遇 |
| 区域探索中 | 每次"探索"操作 | 非战斗探索行为 |
| 特定时间 | 检查环境时间 | 夜间/黎明特殊事件 |
| 境界突破后 | 突破完成时 | 境界相关奇遇 |
| NPC交互后 | 对话完成时 | 社交触发的奇遇 |

### 2.2 基础触发概率

```typescript
// lib/game/adventure-trigger.ts

interface TriggerContext {
  player: {
    level: number;
    realm: string;
    background: string;
    luck: number;           // 幸运值（来自装备/称号/图鉴加成）
    currentAreaId: string;
    currentHpPercent: number;
  };
  environment: {
    weather: string;
    timeOfDay: string;
    season: string;
  };
  history: {
    lastAdventureRound: number;   // 距上次奇遇的战斗场次
    totalAdventures: number;      // 总奇遇次数
    todayAdventures: number;      // 今日奇遇次数
  };
  triggerSource: 'battle_end' | 'area_enter' | 'explore' | 'time' | 'breakthrough' | 'npc';
}

/** 基础触发概率 */
const BASE_TRIGGER_RATES: Record<string, number> = {
  battle_end: 0.15,     // 15% 战斗后触发
  area_enter: 0.30,     // 30% 进入新区域触发
  explore: 0.25,        // 25% 探索行为触发
  time: 0.10,           // 10% 时间事件
  breakthrough: 0.80,   // 80% 境界突破后触发
  npc: 0.08,            // 8% NPC交互后触发
};

/**
 * 计算实际触发概率
 * 概率 = 基础概率 × 保底加成 × 背景加成 × 环境加成 × 幸运加成 × 冷却惩罚
 */
function calculateTriggerChance(ctx: TriggerContext): number {
  let chance = BASE_TRIGGER_RATES[ctx.triggerSource] ?? 0.10;

  // 保底机制：距上次奇遇越久，概率越高
  // 每多打3场战斗，概率+5%，最多+30%
  const pityBonus = Math.min(
    Math.floor(ctx.history.lastAdventureRound / 3) * 0.05,
    0.30
  );
  chance += pityBonus;

  // 背景加成：海洋之子在海域区域+15%
  if (ctx.player.background === '海洋之子' && isOceanArea(ctx.player.currentAreaId)) {
    chance *= 1.15;
  }

  // 环境加成
  chance *= getEnvironmentBonus(ctx.environment);

  // 幸运值加成：每10点幸运+1%
  chance *= (1 + ctx.player.luck * 0.001);

  // 每日冷却：今日已触发超过5次后概率减半
  if (ctx.history.todayAdventures >= 5) {
    chance *= 0.5;
  }
  if (ctx.history.todayAdventures >= 10) {
    chance *= 0.3; // 累积
  }

  // 概率上限80%（永远有不触发的可能）
  return Math.min(chance, 0.80);
}

/** 环境对奇遇概率的加成 */
function getEnvironmentBonus(env: { weather: string; timeOfDay: string; season: string }): number {
  let bonus = 1.0;

  // 特殊天气增加奇遇概率
  const weatherBonuses: Record<string, number> = {
    '迷雾': 1.3,
    '雷暴': 1.2,
    '暴风雨': 1.2,
    '大雪': 1.15,
    '晴': 1.0,
    '雨': 1.05,
    '雪': 1.1,
  };
  bonus *= weatherBonuses[env.weather] ?? 1.0;

  // 深夜和黎明奇遇概率更高
  const timeBonuses: Record<string, number> = {
    '深夜': 1.25,
    '黎明': 1.2,
    '傍晚': 1.1,
    '早晨': 1.0,
    '中午': 0.95,
  };
  bonus *= timeBonuses[env.timeOfDay] ?? 1.0;

  return bonus;
}
```

### 2.3 触发流程

```typescript
/**
 * 奇遇触发入口
 * 返回null表示未触发
 */
function tryTriggerAdventure(ctx: TriggerContext): AdventureEvent | null {
  // 1. 计算触发概率
  const chance = calculateTriggerChance(ctx);
  
  // 2. 随机判定
  if (Math.random() > chance) {
    return null; // 未触发
  }

  // 3. 抽取事件等级
  const tier = rollEventTier(ctx);

  // 4. 从事件池筛选并抽取
  const event = selectEvent(ctx, tier);

  return event;
}
```

---

## 三、事件等级系统

### 3.1 四个事件等级

| 等级 | 颜色 | 概率权重 | 奖励倍率 | 风险程度 | 选项数 |
|------|------|----------|----------|----------|--------|
| 普通 (Common) | 白色 | 55% | 1.0x | 低 | 2 |
| 稀有 (Rare) | 蓝色 | 30% | 2.0x | 中 | 2-3 |
| 史诗 (Epic) | 紫色 | 12% | 4.0x | 高 | 3 |
| 传说 (Legendary) | 橙色 | 3% | 8.0x | 极高 | 3 |

### 3.2 等级抽取算法

```typescript
interface EventTierConfig {
  tier: 'common' | 'rare' | 'epic' | 'legendary';
  baseWeight: number;
}

const TIER_WEIGHTS: EventTierConfig[] = [
  { tier: 'common',    baseWeight: 55 },
  { tier: 'rare',      baseWeight: 30 },
  { tier: 'epic',      baseWeight: 12 },
  { tier: 'legendary', baseWeight: 3  },
];

/**
 * 抽取事件等级
 * 受玩家等级和幸运值影响
 */
function rollEventTier(ctx: TriggerContext): string {
  const weights = TIER_WEIGHTS.map(t => {
    let w = t.baseWeight;

    // 高等级玩家稀有事件概率略增
    if (ctx.player.level > 30 && t.tier !== 'common') {
      w *= 1.1;
    }
    if (ctx.player.level > 60 && t.tier === 'legendary') {
      w *= 1.2;
    }

    // 幸运值加成（主要影响稀有以上）
    if (t.tier !== 'common') {
      w *= (1 + ctx.player.luck * 0.002);
    }

    return { tier: t.tier, weight: w };
  });

  // 加权随机
  const total = weights.reduce((sum, w) => sum + w.weight, 0);
  let roll = Math.random() * total;
  for (const w of weights) {
    roll -= w.weight;
    if (roll <= 0) return w.tier;
  }
  return 'common';
}
```

---

## 四、事件池设计

### 4.1 事件分类

| 类别 | 代码 | 说明 | 典型场景 |
|------|------|------|----------|
| 探索发现 | exploration | 发现隐藏地点/物品 | 发现古老宝箱、隐秘洞穴 |
| 战斗遭遇 | combat | 特殊战斗事件 | 精英怪伏击、流浪武者挑战 |
| 社交际遇 | social | 遇到NPC/旅者 | 迷路的旅人、神秘商人 |
| 谜题机关 | mystery | 解谜/抉择事件 | 古老石碑、神秘祭坛 |
| 命运转折 | fortune | 运气/赌博类事件 | 许愿池、命运转盘 |
| 环境异变 | environment | 环境引发的特殊事件 | 突如其来的暴风雨、地震 |
| 背景专属 | background | 与玩家背景关联 | 海洋之子听到海兽呼唤 |

### 4.2 预制事件模板（本地事件池）

```typescript
// lib/game/adventure-events-pool.ts

interface PresetEvent {
  id: string;
  name: string;
  category: string;
  tier: 'common' | 'rare' | 'epic' | 'legendary';
  
  /** 触发条件 */
  conditions: {
    realmMin?: string;          // 最低境界
    realmMax?: string;          // 最高境界
    areaTypes?: string[];       // 限定区域类型
    weather?: string[];         // 限定天气
    timeOfDay?: string[];       // 限定时间
    season?: string[];          // 限定季节
    background?: string[];      // 限定背景
    requireQuestComplete?: string; // 需完成某任务
  };

  /** 事件描述（支持变量替换） */
  description: string;

  /** 选项 */
  choices: PresetChoice[];

  /** 本事件的冷却（触发后N场战斗内不再出现） */
  cooldown: number;
  
  /** 是否只能触发一次 */
  oneTime: boolean;
}

interface PresetChoice {
  text: string;
  risk: 'low' | 'medium' | 'high';
  
  /** 成功概率（1.0 = 必定成功） */
  successRate: number;
  
  /** 成功结果 */
  successOutcome: EventOutcome;
  
  /** 失败结果（successRate < 1.0 时需要） */
  failOutcome?: EventOutcome;
  
  /** 需要消耗（如金币、道具） */
  requirements?: {
    gold?: number;
    itemId?: string;
    hpPercent?: number;
  };
}

interface EventOutcome {
  narrative: string;       // 结果叙事模板
  rewards: {
    exp?: number;          // 基础经验（会乘以等级系数）
    gold?: number;         // 基础金币
    items?: { itemId: string; quantity: number; dropRate: number }[];
    skillUnlock?: string;  // 解锁技能ID
    statBoost?: { stat: string; value: number; duration: number }; // 临时属性提升
  };
  consequences: {
    hpChange?: number;     // HP变化（负数=扣血，百分比如-0.2=扣20%最大HP）
    mpChange?: number;
    reputationChange?: { factionId: string; amount: number };
    unlockAreaId?: string; // 解锁新区域
    triggerQuestId?: string;
    triggerEventId?: string; // 链式触发另一个事件
  };
}
```

### 4.3 预制事件示例

```typescript
const PRESET_EVENTS: PresetEvent[] = [
  // ==================== 普通事件 ====================
  {
    id: 'evt_common_chest',
    name: '路边的宝箱',
    category: 'exploration',
    tier: 'common',
    conditions: {},
    description: '你在路边发现了一个老旧的木箱，上面布满了青苔。',
    cooldown: 5,
    oneTime: false,
    choices: [
      {
        text: '打开宝箱',
        risk: 'low',
        successRate: 0.85,
        successOutcome: {
          narrative: '宝箱打开了！里面有些不错的东西。',
          rewards: { gold: 50, exp: 20, items: [
            { itemId: 'common_material_random', quantity: 1, dropRate: 1.0 },
          ]},
          consequences: {},
        },
        failOutcome: {
          narrative: '宝箱是个陷阱！一股毒气喷了出来！',
          rewards: {},
          consequences: { hpChange: -0.1 },
        },
      },
      {
        text: '谨慎离开',
        risk: 'low',
        successRate: 1.0,
        successOutcome: {
          narrative: '你谨慎地绕过了宝箱，继续前行。',
          rewards: { exp: 5 },
          consequences: {},
        },
      },
    ],
  },

  {
    id: 'evt_common_herb',
    name: '路边药草',
    category: 'exploration',
    tier: 'common',
    conditions: { areaTypes: ['major', 'minor'] },
    description: '你注意到路边生长着一些看起来很珍贵的药草。',
    cooldown: 8,
    oneTime: false,
    choices: [
      {
        text: '采集药草',
        risk: 'low',
        successRate: 1.0,
        successOutcome: {
          narrative: '你小心翼翼地采集了药草，这些可以用来制作回复药剂。',
          rewards: { items: [
            { itemId: 'healing_herb', quantity: 2, dropRate: 1.0 },
            { itemId: 'rare_herb', quantity: 1, dropRate: 0.2 },
          ]},
          consequences: {},
        },
      },
      {
        text: '仔细研究后采集（消耗MP）',
        risk: 'low',
        successRate: 1.0,
        successOutcome: {
          narrative: '你用魔力感知了一番，发现了更稀有的品种！',
          rewards: { exp: 15, items: [
            { itemId: 'healing_herb', quantity: 3, dropRate: 1.0 },
            { itemId: 'rare_herb', quantity: 1, dropRate: 0.6 },
          ]},
          consequences: { mpChange: -0.05 },
        },
        requirements: { hpPercent: 0.2 },
      },
    ],
  },

  // ==================== 稀有事件 ====================
  {
    id: 'evt_rare_wanderer',
    name: '流浪的武者',
    category: 'combat',
    tier: 'rare',
    conditions: { realmMin: 'ocean' },
    description: '一位衣衫褴褛的武者拦住了你的去路。"年轻人，跟我过过招如何？"他的眼神中闪烁着自信的光芒。',
    cooldown: 20,
    oneTime: false,
    choices: [
      {
        text: '接受挑战',
        risk: 'medium',
        successRate: 0.6,
        successOutcome: {
          narrative: '经过一番激烈的交手，你赢了！武者露出满意的笑容，传授了你一招秘技。',
          rewards: { exp: 100, gold: 200, statBoost: { stat: 'attack', value: 5, duration: 10 }},
          consequences: { hpChange: -0.3 },
        },
        failOutcome: {
          narrative: '你败下阵来。武者摇了摇头："还需要修炼啊。"',
          rewards: { exp: 30 },
          consequences: { hpChange: -0.5 },
        },
      },
      {
        text: '婉言谢绝',
        risk: 'low',
        successRate: 1.0,
        successOutcome: {
          narrative: '武者叹了口气，转身离去。"有缘再会。"',
          rewards: { exp: 10 },
          consequences: {},
        },
      },
      {
        text: '请教武艺（消耗金币）',
        risk: 'low',
        successRate: 1.0,
        successOutcome: {
          narrative: '武者收下酬金，认真地指点了你几招，你感觉受益匪浅。',
          rewards: { exp: 80, statBoost: { stat: 'defense', value: 3, duration: 10 }},
          consequences: {},
        },
        requirements: { gold: 100 },
      },
    ],
  },

  {
    id: 'evt_rare_merchant',
    name: '神秘商人',
    category: 'social',
    tier: 'rare',
    conditions: {},
    description: '一个戴着斗笠的神秘商人突然出现在你面前。"有些特别的东西，要看看吗？"他掀开了斗篷，露出了琳琅满目的商品。',
    cooldown: 15,
    oneTime: false,
    choices: [
      {
        text: '查看商品（可购买稀有道具）',
        risk: 'low',
        successRate: 1.0,
        successOutcome: {
          narrative: '你浏览了商人的货物，发现了一些在普通商店买不到的东西。',
          rewards: {},
          consequences: { triggerQuestId: 'secret_shop_encounter' },
        },
      },
      {
        text: '用200金币赌一件随机物品',
        risk: 'medium',
        successRate: 0.5,
        successOutcome: {
          narrative: '商人从袋中掏出一件散发微光的物品——运气不错！',
          rewards: { items: [
            { itemId: 'rare_random_equipment', quantity: 1, dropRate: 1.0 },
          ]},
          consequences: {},
        },
        failOutcome: {
          narrative: '商人递给你一件……普通的石头。"运气嘛，总有好有坏。"',
          rewards: { items: [
            { itemId: 'common_stone', quantity: 1, dropRate: 1.0 },
          ]},
          consequences: {},
        },
        requirements: { gold: 200 },
      },
      {
        text: '离开',
        risk: 'low',
        successRate: 1.0,
        successOutcome: {
          narrative: '你摆摆手离开了。商人的身影很快消失在雾中。',
          rewards: {},
          consequences: {},
        },
      },
    ],
  },

  // ==================== 史诗事件 ====================
  {
    id: 'evt_epic_ancient_shrine',
    name: '远古祭坛',
    category: 'mystery',
    tier: 'epic',
    conditions: { realmMin: 'land' },
    description: '你发现了一座被藤蔓覆盖的远古祭坛。祭坛上的符文仍在微微发光，似乎蕴含着强大的力量。空气中弥漫着古老的魔力气息。',
    cooldown: 50,
    oneTime: false,
    choices: [
      {
        text: '献上灵石祈祷',
        risk: 'medium',
        successRate: 0.7,
        successOutcome: {
          narrative: '祭坛轰鸣！远古的力量涌入你的身体，你感到一阵前所未有的强大！',
          rewards: {
            exp: 500,
            statBoost: { stat: 'all', value: 10, duration: 20 },
          },
          consequences: {},
        },
        failOutcome: {
          narrative: '祭坛上的符文闪烁了一下便熄灭了。似乎你的诚意还不够……',
          rewards: { exp: 50 },
          consequences: {},
        },
        requirements: { gold: 500 },
      },
      {
        text: '尝试解读符文',
        risk: 'high',
        successRate: 0.4,
        successOutcome: {
          narrative: '你成功解读了远古符文！一段失传的技法涌入脑海——你领悟了新的力量！',
          rewards: {
            exp: 300,
            skillUnlock: 'ancient_power',
          },
          consequences: {},
        },
        failOutcome: {
          narrative: '符文的力量失控了！一股冲击波将你击飞！',
          rewards: { exp: 30 },
          consequences: { hpChange: -0.4, mpChange: -0.3 },
        },
      },
      {
        text: '记录位置后离开',
        risk: 'low',
        successRate: 1.0,
        successOutcome: {
          narrative: '你仔细记录了祭坛的位置。也许准备更充分时再来探索。',
          rewards: { exp: 20 },
          consequences: {},
        },
      },
    ],
  },

  // ==================== 传说事件 ====================
  {
    id: 'evt_legendary_sea_call',
    name: '深海的呼唤',
    category: 'background',
    tier: 'legendary',
    conditions: {
      background: ['海洋之子'],
      areaTypes: ['major'],
      timeOfDay: ['深夜'],
    },
    description: '深夜，你突然从睡梦中惊醒。一个古老而熟悉的声音在你脑海中回荡："孩子……来吧……大海在呼唤你……"你感到海洋的力量在血脉中涌动。',
    cooldown: 100,
    oneTime: true,
    choices: [
      {
        text: '循着声音走向大海',
        risk: 'high',
        successRate: 0.8,
        successOutcome: {
          narrative: '你走入月光下的海水中，一头巨大的海兽从深处浮现。它温柔地注视着你，仿佛看到了久别重逢的亲人。海兽低下头来，表示愿意与你缔结契约。',
          rewards: {
            exp: 1000,
            items: [
              { itemId: 'sea_beast_contract', quantity: 1, dropRate: 1.0 },
            ],
          },
          consequences: {
            triggerQuestId: 'sea_beast_bond',
          },
        },
        failOutcome: {
          narrative: '你走入海中，但一股暗流突然将你卷入深处！你拼尽全力才挣脱，浑身湿透，精疲力竭地爬上岸。但你隐约感觉到……那个声音还在等着你。',
          rewards: { exp: 200 },
          consequences: { hpChange: -0.6, mpChange: -0.5 },
        },
      },
      {
        text: '冥想回应这个声音',
        risk: 'medium',
        successRate: 1.0,
        successOutcome: {
          narrative: '你盘膝而坐，用内心回应那个声音。海洋的力量缓缓渗入你的身体，你的境界修为获得了显著提升。',
          rewards: {
            exp: 800,
            statBoost: { stat: 'mp', value: 50, duration: 50 },
          },
          consequences: {},
        },
      },
      {
        text: '抵抗呼唤，继续睡觉',
        risk: 'low',
        successRate: 1.0,
        successOutcome: {
          narrative: '你强行压制住了那个声音，重新沉入梦乡。但梦中，你看到了广阔无垠的深海和一双温柔的眼睛……',
          rewards: { exp: 100 },
          consequences: {},
        },
      },
    ],
  },
];
```

---

## 五、事件选择与抽取算法

### 5.1 事件筛选

```typescript
/**
 * 从事件池中筛选当前可用的事件
 */
function filterAvailableEvents(
  tier: string,
  ctx: TriggerContext,
  playerHistory: PlayerAdventureHistory
): PresetEvent[] {
  return PRESET_EVENTS.filter(event => {
    // 等级匹配
    if (event.tier !== tier) return false;

    // 一次性事件已完成
    if (event.oneTime && playerHistory.completedEvents.has(event.id)) return false;

    // 冷却中
    if (playerHistory.eventCooldowns.get(event.id) ?? 0 > 0) return false;

    // 条件检查
    const c = event.conditions;
    if (c.realmMin && realmIndex(ctx.player.realm) < realmIndex(c.realmMin)) return false;
    if (c.realmMax && realmIndex(ctx.player.realm) > realmIndex(c.realmMax)) return false;
    if (c.areaTypes && !c.areaTypes.includes(getAreaType(ctx.player.currentAreaId))) return false;
    if (c.weather && !c.weather.includes(ctx.environment.weather)) return false;
    if (c.timeOfDay && !c.timeOfDay.includes(ctx.environment.timeOfDay)) return false;
    if (c.season && !c.season.includes(ctx.environment.season)) return false;
    if (c.background && !c.background.includes(ctx.player.background)) return false;

    return true;
  });
}

/**
 * 从可用事件中抽取一个
 * 如果有多个可用，按以下优先级：
 * 1. 背景专属事件（高优先）
 * 2. 区域专属事件
 * 3. 通用事件
 * 在同优先级内随机选择
 */
function selectEvent(ctx: TriggerContext, tier: string): AdventureEvent {
  const available = filterAvailableEvents(tier, ctx, getPlayerHistory(ctx.player));

  if (available.length === 0) {
    // 没有匹配的预制事件 → 请求AI生成
    return requestAiGeneratedEvent(ctx, tier);
  }

  // 优先级排序
  const prioritized = available.sort((a, b) => {
    const aPriority = getEventPriority(a, ctx);
    const bPriority = getEventPriority(b, ctx);
    return bPriority - aPriority;
  });

  // 从最高优先级组中随机选择
  const topPriority = getEventPriority(prioritized[0], ctx);
  const topGroup = prioritized.filter(e => getEventPriority(e, ctx) === topPriority);
  
  return topGroup[Math.floor(Math.random() * topGroup.length)];
}

function getEventPriority(event: PresetEvent, ctx: TriggerContext): number {
  let priority = 0;
  if (event.category === 'background') priority += 10;
  if (event.conditions.areaTypes?.length) priority += 5;
  if (event.conditions.weather?.length) priority += 3;
  if (event.conditions.timeOfDay?.length) priority += 3;
  if (event.oneTime) priority += 2; // 一次性事件优先展示
  return priority;
}
```

### 5.2 AI 生成事件（兜底/补充）

当预制事件池中没有匹配事件时，可请求AI生成：

```typescript
/**
 * AI生成事件
 * 仅在预制事件池无匹配时调用
 * AI只负责生成叙事文本，数值由本地计算
 */
async function requestAiGeneratedEvent(
  ctx: TriggerContext,
  tier: string
): Promise<AdventureEvent> {
  // 先计算数值框架
  const rewardScale = TIER_REWARD_SCALES[tier];
  const baseRewards = calculateBaseRewards(ctx.player.level, rewardScale);

  // 请求AI填充叙事内容
  const aiResult = await chaosSagaAI.generate({
    type: 'adventure_event',
    input: {
      player: ctx.player,
      environment: ctx.environment,
      eventTier: tier,
      previousEvents: getRecentEventNames(ctx),
      // 传入数值框架，让AI在此基础上创作叙事
      rewardFramework: baseRewards,
    },
  });

  // 合并AI叙事 + 本地数值
  return mergeAiEventWithValues(aiResult.data, baseRewards);
}
```

---

## 六、奖励结算系统

### 6.1 奖励缩放公式

```typescript
// lib/game/adventure-rewards.ts

/** 各等级的奖励基础倍率 */
const TIER_REWARD_SCALES: Record<string, number> = {
  common: 1.0,
  rare: 2.0,
  epic: 4.0,
  legendary: 8.0,
};

/**
 * 计算奇遇奖励的实际数值
 * 基础值会根据玩家等级缩放
 */
function calculateActualRewards(
  baseRewards: EventOutcome['rewards'],
  playerLevel: number,
  tier: string
): ResolvedRewards {
  const scale = TIER_REWARD_SCALES[tier] ?? 1.0;
  const levelScale = 1 + (playerLevel - 1) * 0.1; // 每级+10%

  return {
    exp: Math.floor((baseRewards.exp ?? 0) * levelScale * scale),
    gold: Math.floor((baseRewards.gold ?? 0) * levelScale * scale),
    items: (baseRewards.items ?? [])
      .filter(item => Math.random() < item.dropRate)
      .map(item => ({
        itemId: item.itemId,
        quantity: item.quantity,
      })),
    skillUnlock: baseRewards.skillUnlock,
    statBoost: baseRewards.statBoost,
  };
}

/**
 * 执行选项结果
 */
function resolveChoice(
  event: PresetEvent,
  choiceIndex: number,
  player: PlayerState
): EventResolution {
  const choice = event.choices[choiceIndex];

  // 检查需求
  if (choice.requirements) {
    if (choice.requirements.gold && player.gold < choice.requirements.gold) {
      return { success: false, message: '金币不足' };
    }
    if (choice.requirements.hpPercent && 
        (player.currentHp / player.maxHp) < choice.requirements.hpPercent) {
      return { success: false, message: 'HP不足' };
    }
  }

  // 扣除消耗
  if (choice.requirements?.gold) {
    player.gold -= choice.requirements.gold;
  }

  // 判定成功/失败
  const isSuccess = Math.random() < choice.successRate;
  const outcome = isSuccess ? choice.successOutcome : choice.failOutcome!;

  // 计算奖励
  const rewards = calculateActualRewards(
    outcome.rewards,
    player.level,
    event.tier
  );

  // 应用后果
  applyConsequences(player, outcome.consequences);

  return {
    success: isSuccess,
    narrative: outcome.narrative,
    rewards,
    consequences: outcome.consequences,
  };
}
```

---

## 七、链式事件与事件记忆

### 7.1 链式事件触发

```typescript
/**
 * 某些事件的结果可以触发后续事件
 * 形成事件链，创造连续的叙事体验
 */
interface EventChain {
  chainId: string;
  events: string[];        // 有序的事件ID列表
  currentStep: number;
  triggerCondition: 'immediate' | 'next_battle' | 'next_explore' | 'area_enter';
}

// 示例：海洋之子的专属事件链
const SEA_CHILD_CHAIN: EventChain = {
  chainId: 'sea_child_awakening',
  events: [
    'evt_legendary_sea_call',       // 1. 深海的呼唤
    'evt_chain_sea_beast_appear',   // 2. 海兽显现
    'evt_chain_sea_bond',           // 3. 契约缔结
    'evt_chain_sea_power',          // 4. 海洋之力觉醒
  ],
  currentStep: 0,
  triggerCondition: 'next_battle',
};
```

### 7.2 事件历史记录

```typescript
interface PlayerAdventureHistory {
  /** 已完成的一次性事件 */
  completedEvents: Set<string>;
  
  /** 事件冷却计数器 (事件ID → 剩余冷却场次) */
  eventCooldowns: Map<string, number>;
  
  /** 活跃的事件链 */
  activeChains: EventChain[];
  
  /** 统计数据 */
  stats: {
    totalEvents: number;
    eventsByTier: Record<string, number>;
    eventsByCategory: Record<string, number>;
  };
  
  /** 距上次奇遇的战斗场次 (用于保底) */
  battlesSinceLastEvent: number;
  
  /** 今日触发次数 */
  todayEventCount: number;
}

/**
 * 每场战斗后更新冷却计数器
 */
function tickCooldowns(history: PlayerAdventureHistory): void {
  for (const [eventId, cooldown] of history.eventCooldowns) {
    if (cooldown > 0) {
      history.eventCooldowns.set(eventId, cooldown - 1);
    } else {
      history.eventCooldowns.delete(eventId);
    }
  }
  history.battlesSinceLastEvent++;
}
```

---

## 八、数据库扩展

### 8.1 新增：玩家奇遇记录表 (PlayerAdventure)

| 字段 | 类型 | 说明 |
|------|------|------|
| id | String | 主键 |
| playerId | String | 玩家ID (FK) |
| eventId | String | 事件ID |
| tier | Enum | common/rare/epic/legendary |
| category | String | 事件分类 |
| choiceIndex | Int | 玩家选择的选项索引 |
| isSuccess | Boolean | 选择结果是否成功 |
| rewards | Json | 实际获得的奖励 |
| narrative | String | 事件叙事文本 |
| createdAt | DateTime | 触发时间 |

### 8.2 Prisma Schema 补充

```prisma
model PlayerAdventure {
  id          String   @id @default(cuid())
  playerId    String
  eventId     String
  tier        String
  category    String
  choiceIndex Int
  isSuccess   Boolean
  rewards     Json
  narrative   String   @db.Text
  createdAt   DateTime @default(now())

  player Player @relation(fields: [playerId], references: [id], onDelete: Cascade)

  @@index([playerId, createdAt])
}
```

---

> 📝 本文档定义了 ChaosSaga 的完整奇遇事件系统。触发判定、等级抽取、奖励计算均由传统算法驱动，仅在预制事件池无匹配时才调用AI生成叙事内容。事件池支持丰富的条件筛选、链式触发和保底机制。
