# ChaosSaga - 声望与势力系统详细设计

> 版本: 1.0 | 更新日期: 2026-02-08
> 对应 GDD 章节: 八、区域与关卡系统

---

## 一、系统总览

```
┌─────────────────────────────────────────────────────────────────┐
│                    声望系统架构                                    │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  玩家行为 ──→ 声望变化 ──→ 等级判定 ──→ 效果应用               │
│  (任务/战斗/     (正/负)    (8级体系)   (商店/任务/             │
│   选择/赠礼)                             技能/剧情)             │
│                                                                 │
│  势力间关系: 部分势力互斥（提升A会降低B）                        │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## 二、声望等级体系

### 2.1 八级声望

| 等级 | 数值范围 | 颜色 | 商店折扣 | 解锁内容 |
|------|----------|------|----------|----------|
| 仇恨 | -1000~ -500 | 深红 | 拒绝交易 | 敌对NPC攻击玩家 |
| 敌对 | -499 ~ -200 | 红 | +50% | 无法接任务 |
| 冷漠 | -199 ~ -1 | 橙 | +20% | 基础任务 |
| 中立 | 0 ~ 499 | 白 | 原价 | 普通任务 |
| 友善 | 500 ~ 1999 | 绿 | -5% | 支线任务解锁 |
| 尊敬 | 2000 ~ 4999 | 蓝 | -10% | 稀有商品，声望装备 |
| 崇敬 | 5000 ~ 9999 | 紫 | -15% | 隐藏任务，阵营技能 |
| 崇拜 | 10000+ | 橙/金 | -20% | 传说装备，专属称号，终极任务 |

### 2.2 声望获取与消耗

```typescript
// lib/game/reputation.ts

interface ReputationChange {
  source: string;
  amount: number;
  repeatable: boolean;
  dailyCap?: number;
}

/** 声望获取途径 */
const REPUTATION_GAINS: Record<string, ReputationChange[]> = {
  // 渔民联盟
  'fishermen_alliance': [
    { source: 'main_quest',        amount: 150, repeatable: false },           // 主线任务
    { source: 'side_quest',        amount: 75,  repeatable: false },           // 支线任务
    { source: 'daily_quest',       amount: 25,  repeatable: true, dailyCap: 3 }, // 日常任务
    { source: 'kill_mermaid',      amount: 5,   repeatable: true, dailyCap: 20 }, // 击杀海妖
    { source: 'donate_fish',      amount: 10,  repeatable: true, dailyCap: 5 },  // 捐献鱼类
  ],
  // 海妖一族
  'mermaid_tribe': [
    { source: 'main_quest_peace', amount: 200, repeatable: false },
    { source: 'help_mermaid',     amount: 50,  repeatable: true, dailyCap: 3 },
    { source: 'donate_pearl',     amount: 15,  repeatable: true, dailyCap: 5 },
  ],
};
```

---

## 三、势力关系矩阵

### 3.1 对立关系

```typescript
/**
 * 势力互斥关系
 * 提升A的声望时，B的声望会按比例降低
 */
interface FactionRelation {
  factionA: string;
  factionB: string;
  type: 'hostile' | 'rival' | 'neutral' | 'allied';
  spilloverRatio: number;  // 声望溢出比率（负数=减少）
}

const FACTION_RELATIONS: FactionRelation[] = [
  // 渔民联盟 vs 海妖一族：敌对 - 提升一方降低另一方50%
  {
    factionA: 'fishermen_alliance',
    factionB: 'mermaid_tribe',
    type: 'hostile',
    spilloverRatio: -0.5,
  },
  // 渔民联盟 vs 商人协会：友好 - 提升一方增加另一方10%
  {
    factionA: 'fishermen_alliance',
    factionB: 'merchant_guild',
    type: 'allied',
    spilloverRatio: 0.1,
  },
];

/**
 * 应用声望变化（含溢出计算）
 */
function applyReputationChange(
  playerId: string,
  factionId: string,
  amount: number
): ReputationChangeResult[] {
  const results: ReputationChangeResult[] = [];
  
  // 主要变化
  const newValue = changeReputation(playerId, factionId, amount);
  results.push({ factionId, change: amount, newValue });

  // 溢出计算
  for (const rel of FACTION_RELATIONS) {
    let targetFaction: string | null = null;
    if (rel.factionA === factionId) targetFaction = rel.factionB;
    else if (rel.factionB === factionId) targetFaction = rel.factionA;
    
    if (targetFaction) {
      const spillover = Math.floor(amount * rel.spilloverRatio);
      if (spillover !== 0) {
        const newVal = changeReputation(playerId, targetFaction, spillover);
        results.push({ factionId: targetFaction, change: spillover, newValue: newVal });
      }
    }
  }

  return results;
}
```

---

## 四、声望奖励详表

### 4.1 渔民联盟声望奖励

| 等级 | 声望 | 奖励 |
|------|------|------|
| 友善(500) | 解锁支线任务"渔夫的遗物" |
| 友善(1000) | 解锁商品：高级回复药 |
| 尊敬(2000) | 解锁声望装备：珊瑚渔网(武器) |
| 尊敬(3000) | 阿海传授技能："潮汐预知" |
| 崇敬(5000) | 解锁隐藏任务线："深海的真相" |
| 崇敬(7000) | 解锁声望装备：海潮守护套装 |
| 崇拜(10000) | 专属称号："珊瑚海守护者"(攻击+5%，水系+10%) |
| 崇拜(15000) | 传说装备：阿海的遗物(武器) |

---

## 五、数据库扩展

```prisma
model PlayerReputation {
  id        String @id @default(cuid())
  playerId  String
  factionId String
  value     Int    @default(0)
  
  // 每日获取追踪
  dailyGains Json  @default("{}")  // { source: count }
  lastResetAt DateTime @default(now())

  player Player @relation(fields: [playerId], references: [id], onDelete: Cascade)

  @@unique([playerId, factionId])
}
```

---

> 📝 本文档定义了 ChaosSaga 的声望与势力系统。8级声望体系、势力间互斥关系、声望溢出机制，以及丰富的声望奖励。所有计算纯数值驱动。
