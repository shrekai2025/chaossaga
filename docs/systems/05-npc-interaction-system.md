# ChaosSaga - NPC 深度交互系统详细设计

> 版本: 1.0 | 更新日期: 2026-02-08
> 对应 GDD 章节: 九、AI剧本创作系统 (NPC交互)

---

## 一、系统总览

```
┌─────────────────────────────────────────────────────────────────┐
│                    NPC 交互系统架构                                │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ┌────────────┐    ┌──────────────┐    ┌────────────────────┐  │
│  │ NPC 数据库  │ →  │ 交互管理器    │ →  │ 对话引擎            │  │
│  │ (静态配置)  │    │ (状态+路由)   │    │ (AI生成/模板混合)   │  │
│  └────────────┘    └──────────────┘    └────────┬───────────┘  │
│                                                  │              │
│  ┌────────────┐    ┌──────────────┐              │              │
│  │ 好感度系统  │ ←  │ 记忆系统      │ ←───────────┘              │
│  │ (数值驱动)  │    │ (对话摘要)    │                            │
│  └────────────┘    └──────────────┘                             │
│                                                                 │
│  对话生成: 剧情NPC用AI | 商店/日常NPC用模板 | 混合策略            │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## 二、NPC 分类与数据模型

### 2.1 NPC 角色类型

| 类型 | 代码 | 说明 | 对话方式 | 示例 |
|------|------|------|----------|------|
| 任务NPC | quest | 发放/接收任务 | AI生成 | 老渔夫阿海 |
| 剧情NPC | story | 推动主线/支线故事 | AI生成 | 海妖公主珊珊 |
| 商人NPC | merchant | 买卖物品 | 模板+AI混合 | 神秘商人 |
| 功能NPC | function | 提供功能服务 | 纯模板 | 铁匠、药剂师 |
| 氛围NPC | ambient | 提供世界观信息 | 模板池随机 | 路人、村民 |

### 2.2 NPC 数据结构

```typescript
// lib/game/npc-types.ts

interface NpcConfig {
  id: string;
  name: string;
  role: 'quest' | 'story' | 'merchant' | 'function' | 'ambient';
  areaId: string;
  
  /** 性格特征（用于AI对话生成） */
  personality: {
    traits: string[];        // 如: ['和蔼', '忧心忡忡', '唠叨']
    speechStyle: string;     // 说话方式描述: '老人家口吻，常用"唉"开头'
    greeting: string;        // 固定开场白（无AI时使用）
  };
  
  /** 立场与态度 */
  stance: {
    faction: string;         // 所属势力
    initialAttitude: 'friendly' | 'neutral' | 'hostile' | 'cautious';
    attitudeConditions?: AttitudeCondition[]; // 态度变化条件
  };
  
  /** 功能配置 */
  functions: {
    canTrade: boolean;
    shopInventory?: ShopConfig;
    canEnhance: boolean;
    canTeachSkill: boolean;
    teachableSkills?: string[];
  };
  
  /** 关联任务 */
  questIds: string[];        // 该NPC相关的任务ID
  
  /** NPC描述 */
  appearance: string;        // 外观描述
  backstory: string;         // 背景故事（AI对话参考）
  
  /** 对话模板（非AI模式时使用） */
  dialogueTemplates?: NpcDialogueTemplates;
}

interface NpcDialogueTemplates {
  greeting: string[];         // 问候语池
  farewell: string[];         // 告别语池
  idle: string[];             // 闲聊池
  shopOpen: string[];         // 开店台词
  shopClose: string[];        // 关店台词
  questAvailable: string[];   // 有新任务
  questComplete: string[];    // 任务完成
}
```

---

## 三、好感度系统

### 3.1 好感度等级

| 等级 | 数值范围 | 称呼变化 | 效果 |
|------|----------|----------|------|
| 敌视 | -100 ~ -50 | "你这个家伙" | 拒绝交易，可能攻击 |
| 冷淡 | -49 ~ -1 | "旅人" | 价格+20%，信息有限 |
| 中立 | 0 ~ 49 | "朋友" | 正常价格，基础信息 |
| 友好 | 50 ~ 99 | "好友" | 价格-10%，额外信息 |
| 信任 | 100 ~ 149 | 玩家名字 | 价格-15%，隐藏任务 |
| 挚友 | 150 ~ 199 | 昵称/亲称 | 价格-20%，专属物品 |
| 至交 | 200+ | 特殊称呼 | 价格-25%，解锁专属技能/剧情 |

### 3.2 好感度变化规则

```typescript
// lib/game/npc-affinity.ts

interface AffinityChangeRule {
  action: string;
  baseChange: number;
  maxPerDay?: number;   // 每日最大获取次数
}

const AFFINITY_RULES: AffinityChangeRule[] = [
  // 正面行为
  { action: 'complete_quest',     baseChange: +15, maxPerDay: 3 },  // 完成NPC的任务
  { action: 'gift_item',         baseChange: +5,  maxPerDay: 3 },  // 赠送物品
  { action: 'gift_favorite',     baseChange: +20, maxPerDay: 1 },  // 赠送偏好物品
  { action: 'help_faction',      baseChange: +10 },                 // 帮助NPC所属势力
  { action: 'dialogue_positive', baseChange: +3,  maxPerDay: 5 },  // 对话中选择友好选项
  { action: 'daily_visit',       baseChange: +1,  maxPerDay: 1 },  // 每日首次拜访
  
  // 负面行为
  { action: 'dialogue_negative', baseChange: -5 },   // 对话中选择敌对选项
  { action: 'attack_faction',    baseChange: -20 },   // 攻击NPC所属势力
  { action: 'fail_quest',        baseChange: -10 },   // 任务失败
  { action: 'steal',             baseChange: -30 },   // 偷窃（如果有此机制）
  { action: 'betray_trust',      baseChange: -50 },   // 背叛（剧情选择）
];

/** NPC偏好物品配置 */
interface NpcPreferences {
  npcId: string;
  favoriteItems: string[];        // 偏好物品ID
  dislikedItems: string[];        // 厌恶物品ID
  favoriteTopics: string[];       // 偏好话题（AI对话参考）
}

/**
 * 计算好感度变化
 */
function calculateAffinityChange(
  npcId: string,
  action: string,
  playerId: string,
  itemId?: string
): number {
  const rule = AFFINITY_RULES.find(r => r.action === action);
  if (!rule) return 0;

  let change = rule.baseChange;

  // 检查每日限制
  if (rule.maxPerDay) {
    const todayCount = getTodayActionCount(playerId, npcId, action);
    if (todayCount >= rule.maxPerDay) return 0;
  }

  // 赠送物品时检查偏好
  if (action === 'gift_item' && itemId) {
    const prefs = getNpcPreferences(npcId);
    if (prefs.favoriteItems.includes(itemId)) {
      change = AFFINITY_RULES.find(r => r.action === 'gift_favorite')!.baseChange;
    } else if (prefs.dislikedItems.includes(itemId)) {
      change = -10; // 送了讨厌的东西
    }
  }

  return change;
}
```

### 3.3 好感度对系统的影响

```typescript
/** 好感度等级判定 */
function getAffinityLevel(value: number): AffinityLevel {
  if (value >= 200) return 'soulmate';   // 至交
  if (value >= 150) return 'best_friend'; // 挚友
  if (value >= 100) return 'trusted';     // 信任
  if (value >= 50)  return 'friendly';    // 友好
  if (value >= 0)   return 'neutral';     // 中立
  if (value >= -50) return 'cold';        // 冷淡
  return 'hostile';                        // 敌视
}

/** 商店价格修正 */
const PRICE_MODIFIERS: Record<string, number> = {
  hostile: 1.5,     // +50%
  cold: 1.2,        // +20%
  neutral: 1.0,     // 原价
  friendly: 0.9,    // -10%
  trusted: 0.85,    // -15%
  best_friend: 0.8, // -20%
  soulmate: 0.75,   // -25%
};

/** 各好感度等级解锁的内容 */
const AFFINITY_UNLOCKS: Record<string, string[]> = {
  friendly: ['额外对话选项', '背景故事片段'],
  trusted: ['隐藏任务线索', '稀有商品'],
  best_friend: ['专属任务', '技能传授', '独家商品'],
  soulmate: ['专属剧情线', '终极技能', '特殊称号'],
};
```

---

## 四、NPC 记忆系统

### 4.1 记忆结构

```typescript
// lib/game/npc-memory.ts

interface NpcMemory {
  npcId: string;
  playerId: string;
  
  /** 对话摘要（最近10条，用于AI上下文） */
  dialogueSummaries: DialogueSummary[];
  
  /** 关键事件记忆 */
  keyEvents: KeyEvent[];
  
  /** 玩家选择记录（影响后续对话走向） */
  playerChoices: PlayerChoice[];
  
  /** 好感度 */
  affinity: number;
  
  /** 首次见面时间 */
  firstMetAt: Date;
  
  /** 总交互次数 */
  interactionCount: number;
}

interface DialogueSummary {
  timestamp: Date;
  scene: string;          // 'quest_give' | 'casual' | 'shop' 等
  summary: string;        // 对话摘要（50字内）
  playerChoice: string;   // 玩家的关键选择
  npcReaction: string;    // NPC的反应
}

interface KeyEvent {
  type: string;           // 'quest_complete' | 'betrayal' | 'rescue' 等
  description: string;
  timestamp: Date;
  affinityImpact: number;
}

/**
 * 将记忆压缩为AI上下文
 * 控制在200 token以内
 */
function compressMemoryForAI(memory: NpcMemory): string {
  const level = getAffinityLevel(memory.affinity);
  const recentDialogues = memory.dialogueSummaries.slice(-3);
  const keyEventsStr = memory.keyEvents.slice(-2)
    .map(e => e.description).join('；');

  return `与${memory.playerId}的关系: ${level}(好感度${memory.affinity})，` +
    `互动${memory.interactionCount}次。` +
    (keyEventsStr ? `关键事件: ${keyEventsStr}。` : '') +
    (recentDialogues.length > 0 
      ? `近期对话: ${recentDialogues.map(d => d.summary).join('；')}`
      : '首次见面。'
    );
}
```

---

## 五、对话引擎

### 5.1 对话路由策略

```typescript
/**
 * 对话路由：决定使用AI还是模板
 */
function routeDialogue(
  npc: NpcConfig,
  scene: DialogueScene,
  player: PlayerState
): 'ai' | 'template' {
  // 剧情NPC和任务NPC：AI生成
  if (npc.role === 'quest' || npc.role === 'story') {
    return 'ai';
  }
  
  // 商人NPC：首次见面用AI，之后用模板
  if (npc.role === 'merchant') {
    const memory = getMemory(npc.id, player.id);
    return memory.interactionCount === 0 ? 'ai' : 'template';
  }
  
  // 功能NPC和氛围NPC：纯模板
  return 'template';
}
```

### 5.2 模板对话引擎

```typescript
/**
 * 模板对话生成器
 * 高效、零成本、适合高频交互
 */
function generateTemplateDialogue(
  npc: NpcConfig,
  scene: string,
  memory: NpcMemory,
  player: PlayerState
): DialogueOutput {
  const templates = npc.dialogueTemplates;
  if (!templates) return getDefaultDialogue(scene);

  const affinityLevel = getAffinityLevel(memory.affinity);
  
  // 根据场景选择模板池
  let pool: string[];
  switch (scene) {
    case 'greeting':
      pool = templates.greeting;
      break;
    case 'shop':
      pool = templates.shopOpen;
      break;
    case 'quest_available':
      pool = templates.questAvailable;
      break;
    case 'quest_complete':
      pool = templates.questComplete;
      break;
    default:
      pool = templates.idle;
  }

  // 随机选择模板
  const template = pool[Math.floor(Math.random() * pool.length)];

  // 变量替换
  const text = template
    .replace(/{playerName}/g, player.name)
    .replace(/{npcName}/g, npc.name)
    .replace(/{greeting}/g, getAffinityGreeting(affinityLevel))
    .replace(/{realm}/g, player.realm);

  return {
    greeting: text,
    mainDialogue: '',
    options: getDefaultOptions(scene),
    source: 'template',
  };
}
```

---

## 六、NPC 配置示例

### 6.1 老渔夫阿海（任务NPC）

```typescript
const ELDER_AHAI: NpcConfig = {
  id: 'elder_ahai',
  name: '老渔夫阿海',
  role: 'quest',
  areaId: 'coral_bay',
  personality: {
    traits: ['和蔼', '忧心忡忡', '经验丰富', '唠叨'],
    speechStyle: '老人家口吻，语速慢，常叹气。偶尔冒出渔谚语。称玩家为"年轻人"或"孩子"。',
    greeting: '唉，又是一天啊…年轻人，你来了。',
  },
  stance: {
    faction: 'fishermen_alliance',
    initialAttitude: 'friendly',
  },
  functions: {
    canTrade: false,
    canEnhance: false,
    canTeachSkill: true,
    teachableSkills: ['fishing_mastery', 'tide_reading'],
  },
  questIds: ['Q101', 'Q102', 'Q103', 'Q104', 'Q105', 'S01'],
  appearance: '满头白发的老人，脸上刻满了海风留下的皱纹，穿着打了补丁的渔服。',
  backstory: '珊瑚渔村的长老，出海捕鱼50余年。最近渔船失踪事件让他忧心忡忡。年轻时曾是一名强大的水系法师。',
  dialogueTemplates: {
    greeting: [
      '唉，{playerName}，你来了。海上的事…越来越不对劲了。',
      '年轻人，今天的海风不太对…小心点。',
      '哦，是你啊{playerName}。来，坐下歇歇。',
    ],
    farewell: [
      '路上小心，海妖可不是好惹的。',
      '去吧，年轻人。大海会指引你的。',
    ],
    idle: [
      '想当年老头子我也是能劈开海浪的人啊…',
      '这片海，养育了我们一辈子。不能让它毁在那些怪物手里。',
      '年轻人，你有海洋的气息…这很少见。',
    ],
    shopOpen: [],
    shopClose: [],
    questAvailable: [
      '年轻人，我有件事想拜托你…',
      '{playerName}，村里出了点麻烦，你能帮帮忙吗？',
    ],
    questComplete: [
      '太好了！你做到了！老头子果然没有看错人。',
      '感谢你，{playerName}。珊瑚渔村不会忘记你的恩情。',
    ],
  },
};
```

---

## 七、数据库扩展

### 7.1 Prisma Schema 补充

```prisma
model NpcRelation {
  id               String   @id @default(cuid())
  playerId         String
  npcId            String
  affinity         Int      @default(0)
  interactionCount Int      @default(0)
  firstMetAt       DateTime @default(now())
  lastInteractAt   DateTime @default(now())
  
  // 记忆存储
  dialogueSummaries Json     @default("[]")
  keyEvents         Json     @default("[]")
  playerChoices     Json     @default("[]")

  player Player @relation(fields: [playerId], references: [id], onDelete: Cascade)

  @@unique([playerId, npcId])
}
```

---

> 📝 本文档定义了 ChaosSaga 的NPC深度交互系统，包含好感度机制、NPC记忆、对话路由策略（AI/模板混合）和完整的数据模型。好感度系统纯数值驱动，对话生成采用智能路由降低AI调用成本。
