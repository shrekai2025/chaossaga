# ChaosSaga - MVP 开发计划

> 版本: 4.1 | 更新日期: 2026-02-09
> 架构: 聊天式 AI Game Master + 多模型 LLM 抽象层

---

## 总览

采用迭代开发方式，MVP 分为 5 个子阶段，目标是实现一个**可玩的核心循环**：

```
创建角色 → 与AI对话探索 → 遭遇战斗 → 获得奖励 → 变强 → 继续冒险
```

### 技术栈

| 层级     | 方案                                                                            |
| -------- | ------------------------------------------------------------------------------- |
| 全栈框架 | Next.js 15 (App Router)                                                         |
| 语言     | TypeScript                                                                      |
| 样式     | Tailwind CSS                                                                    |
| 数据库   | PostgreSQL + Prisma ORM (Supabase)                                              |
| AI供应商 | 兔子 API (api.tu-zi.com) - 多模型聚合                                           |
| LLM 调用 | 原生 fetch（OpenAI/Google/Anthropic 三格式适配器，通过统一抽象层自动路由）      |
| 支持模型 | GPT-5.1, GPT-4o-mini, Gemini 3 Pro, Grok 4.1, Claude Opus 4.5, Claude Haiku 4.5 |
| 模型配置 | 全局配置，支持运行时通过前端 UI 切换                                            |
| 流式传输 | Server-Sent Events (SSE)                                                        |
| 部署     | Vercel                                                                          |

---

## 阶段 A：基础设施 + 玩家系统

### A1. 项目初始化

- [x] Next.js 16 + TypeScript + Tailwind CSS 4
- [x] Prisma 7 + PostgreSQL (Supabase) + `@prisma/adapter-pg`
- [x] 环境变量：`DATABASE_URL`, `TUZI_API_KEY`, `TUZI_BASE_URL`
- [x] `prisma.config.ts` + Prisma 客户端单例
- [x] DB 管理脚本：`db:generate`, `db:migrate`, `db:push`, `db:seed`, `db:reset`, `db:studio`

### A2. Prisma Schema 设计

核心数据模型：

```prisma
// 玩家
model Player {
  id            String   @id @default(cuid())
  name          String
  race          String   @default("human")
  background    String   @default("")
  level         Int      @default(1)
  exp           Int      @default(0)
  realm         String   @default("ocean")    // 境界
  hp            Int      @default(100)
  maxHp         Int      @default(100)
  mp            Int      @default(50)
  maxMp         Int      @default(50)
  attack        Int      @default(10)
  defense       Int      @default(5)
  speed         Int      @default(10)
  gold          Int      @default(100)
  spiritStones  Int      @default(0)
  currentAreaId String?
  currentNodeId String?
  createdAt     DateTime @default(now())
  updatedAt     DateTime @updatedAt

  chatHistory   ChatHistory[]
  inventory     InventoryItem[]
  equipment     Equipment[]
  skills        PlayerSkill[]
  quests        PlayerQuest[]
  areas         PlayerArea[]
}

// 对话历史
model ChatHistory {
  id        String   @id @default(cuid())
  playerId  String
  role      String   // user | assistant | tool_call | tool_result | system
  content   String   @db.Text
  metadata  Json?
  createdAt DateTime @default(now())

  player    Player   @relation(fields: [playerId], references: [id])

  @@index([playerId, createdAt])
}

// 区域
model Area {
  id              String   @id @default(cuid())
  name            String
  description     String   @db.Text
  theme           String
  recommendedLevel Int
  createdByPlayer String?  // 玩家生成的区域
  createdAt       DateTime @default(now())

  nodes           AreaNode[]
  playerAreas     PlayerArea[]
}

// 区域节点
model AreaNode {
  id          String   @id @default(cuid())
  areaId      String
  name        String
  type        String   // safe | battle | npc | boss | event | shop
  description String   @db.Text
  data        Json?    // 节点特有数据(敌人/NPC/事件)
  posX        Int      @default(0)
  posY        Int      @default(0)

  area        Area     @relation(fields: [areaId], references: [id])
  connections AreaNodeConnection[] @relation("fromNode")
  connectedBy AreaNodeConnection[] @relation("toNode")

  @@index([areaId])
}

// 节点连接
model AreaNodeConnection {
  id       String @id @default(cuid())
  fromId   String
  toId     String

  fromNode AreaNode @relation("fromNode", fields: [fromId], references: [id])
  toNode   AreaNode @relation("toNode", fields: [toId], references: [id])

  @@unique([fromId, toId])
}

// 背包物品
model InventoryItem {
  id            String  @id @default(cuid())
  playerId      String
  name          String
  type          String  // weapon | armor | accessory | consumable | material | quest_item
  quality       String  @default("common") // common | uncommon | rare | epic | legendary
  quantity      Int     @default(1)
  stats         Json?   // 装备属性
  specialEffect String? @db.Text // 非标准特殊效果(由AI探测执行)
  equipped      Boolean @default(false)

  player        Player  @relation(fields: [playerId], references: [id])

  @@index([playerId])
}

// 装备栏
model Equipment {
  id       String @id @default(cuid())
  playerId String
  slot     String // weapon | armor | helmet | boots | accessory1 | accessory2
  itemId   String // 指向 InventoryItem

  player   Player @relation(fields: [playerId], references: [id])

  @@unique([playerId, slot])
}

// 玩家技能
model PlayerSkill {
  id        String @id @default(cuid())
  playerId  String
  name      String
  element   String @default("none")
  damage    Int    @default(0)
  mpCost    Int    @default(0)
  cooldown  Int    @default(0)
  effect    Json?  // 附加效果
  equipped  Boolean @default(false) // 是否装备到技能栏
  slotIndex Int?   // 技能栏位置(0-3)

  player    Player @relation(fields: [playerId], references: [id])

  @@index([playerId])
}

// 任务
model Quest {
  id              String  @id @default(cuid())
  name            String
  description     String  @db.Text
  type            String  // fetch | kill | riddle | escort | explore
  npcId           String? // 发布NPC
  objectives      Json    // 任务目标列表
  rewards         Json    // 奖励
  specialCondition String? @db.Text // 非标准完成条件

  playerQuests    PlayerQuest[]
}

// 玩家任务进度
model PlayerQuest {
  id        String @id @default(cuid())
  playerId  String
  questId   String
  status    String @default("active") // active | completed | failed
  progress  Json   // 各目标当前进度
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  player    Player @relation(fields: [playerId], references: [id])
  quest     Quest  @relation(fields: [questId], references: [id])

  @@unique([playerId, questId])
}

// 玩家区域探索记录
model PlayerArea {
  id           String @id @default(cuid())
  playerId     String
  areaId       String
  exploredNodes Json  @default("[]") // 已探索的节点ID列表

  player       Player @relation(fields: [playerId], references: [id])
  area         Area   @relation(fields: [areaId], references: [id])

  @@unique([playerId, areaId])
}

// 战斗状态(临时存储)
model BattleState {
  id          String   @id @default(cuid())
  playerId    String   @unique
  enemies     Json     // 敌人列表(HP/攻/防/速/技能)
  roundNumber Int      @default(1)
  playerBuffs Json     @default("[]")
  enemyBuffs  Json     @default("[]")
  log         Json     @default("[]") // 战斗日志
  status      String   @default("active") // active | won | lost | fled
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt
}
```

### A3. 种子数据（已完成）

`prisma/seed.ts` — 幂等，可重复运行。

**种子区域：珊瑚海湾**（8 个节点，16 条连接）

| 节点         | type   | 内容                      |
| ------------ | ------ | ------------------------- |
| 海边小镇广场 | safe   | 出生点                    |
| 浪花酒馆     | npc    | 老渔夫阿海（任务发布）    |
| 海边杂货摊   | shop   | 神秘商人（6种商品）       |
| 海边浅滩     | battle | Lv.1-2 蟹怪、水母、海胆   |
| 珊瑚礁区     | battle | Lv.2-3 海蛇、寄居蟹       |
| 沉船残骸     | event  | 发现线索/宝箱/伏击        |
| 海蚀洞穴入口 | battle | Lv.3-4 洞穴蟹兵、暗影海蛇 |
| 深海蟹将巢穴 | boss   | Lv.5 BOSS（3阶段，3技能） |

**初始任务：老渔夫的委托**（调查沉船 → 击败蟹将 → 复命）

> 种子数据与 AI 动态生成使用**统一的节点 data 格式**，  
> 后续区域由 AI 通过 `generate_area` 实时创建，写入同一套表。

### A4. 角色创建 API（已完成）

```
POST /api/player
Body: { name, race, background }
→ 使用 formulas.calcBaseStats() 计算初始属性
→ 自动分配到种子区域（珊瑚海湾·广场）
→ 赠送初始技能（水弹术、治愈术）和物品（药水×5、新手木剑）

GET /api/player?id=xxx
→ 返回 player + 装备 + 技能 + 背包 + 任务

GET /api/player?name=xxx
→ 按名称搜索（用于跨浏览器恢复角色）
```

---

## 阶段 B：AI Game Master 核心

这是 MVP 最关键的阶段。

### B0. 多模型 LLM 抽象层（已完成）

```
src/lib/ai/adapters/types.ts        → 统一类型：NormalizedTool, StreamEvent, LLMConfig
src/lib/ai/adapters/openai-adapter.ts → OpenAI 格式适配器（GPT/Gemini/Grok）
src/lib/ai/adapters/anthropic-adapter.ts → Anthropic 格式适配器（Claude）
src/lib/ai/llm-client.ts            → 统一客户端：模型路由+工具循环+流式处理
src/lib/ai/config.ts                → 配置管理：env + DB + 模型列表
src/app/api/settings/route.ts       → 配置 API
src/components/game/SettingsModal.tsx → 前端模型选择 UI
```

**路由规则**：模型名含 `claude-` → Anthropic 格式（/v1/messages），否则 → OpenAI 格式（/v1/chat/completions）

### B1. Game Master 核心

```typescript
// src/lib/ai/gamemaster.ts
// - 使用统一 LLM 客户端（自动适配 OpenAI/Anthropic）
// - 管理 System Prompt
// - 处理 Function Calling 循环
// - SSE 流式输出
```

### B2. System Prompt

定义完整的 Game Master System Prompt（见 01-ai-prompt-system.md §三）。

### B3. 15 个工具实现

按优先级分批实现：

**P0 - 核心工具（必须有）：**

| 工具                    | 文件            | 说明                 |
| ----------------------- | --------------- | -------------------- |
| `get_player_state`      | query-tools.ts  | 查数据库返回玩家状态 |
| `start_battle`          | action-tools.ts | 初始化BattleState    |
| `execute_battle_action` | action-tools.ts | 调用 battle-engine   |
| `move_to_node`          | action-tools.ts | 更新玩家位置         |
| `modify_player_data`    | modify-tools.ts | 修改任意字段         |
| `send_narrative`        | modify-tools.ts | 纯文本输出           |

**P1 - 重要工具：**

| 工具               | 文件              | 说明                                                |
| ------------------ | ----------------- | --------------------------------------------------- |
| `get_area_info`    | query-tools.ts    | 区域和节点信息                                      |
| `get_battle_state` | query-tools.ts    | 战斗状态                                            |
| `use_item`         | action-tools.ts   | 使用/装备物品                                       |
| `add_item`         | modify-tools.ts   | 添加物品到背包                                      |
| `generate_area`    | generate-tools.ts | AI生成区域（节点data遵循统一格式，见System Prompt） |

**P2 - 增强工具：**

| 工具                | 文件              | 说明         |
| ------------------- | ----------------- | ------------ |
| `interact_npc`      | action-tools.ts   | NPC交互      |
| `create_quest`      | generate-tools.ts | 动态创建任务 |
| `update_quest`      | generate-tools.ts | 更新任务进度 |
| `enhance_equipment` | action-tools.ts   | 装备强化     |

### B4. SSE 端点

```typescript
// src/app/api/game/chat/route.ts
// POST - 接收玩家消息，返回 SSE 流
// 处理 Function Calling 递归循环
// 自动保存对话历史
```

### B5. 上下文组装器（已完成）

`src/lib/ai/context-builder.ts` — 每次 AI 请求时一次性加载完整上下文：

- `getPlayerStateSummary()` — 属性 + 装备技能 + **可读位置名称**
- `getAreaInfoSummary()` — 区域描述 + 当前节点 + 可前往节点 + 全节点列表
- `getActiveQuestsSummary()` — 活跃任务 + 各目标进度
- `getSpecialEffectsSummary()` — 特殊效果道具监控
- `getRecentHistory()` — 最近 20 条对话
- `buildGameContext()` — 并行加载以上全部，供 gamemaster.ts 调用

---

## 阶段 C：游戏引擎（传统算法） ✅

### C1. 玩家属性计算（已完成）

`src/lib/game/player-calc.ts`

- `calcFinalStats(level, realm, equippedItems, buffs)` — 最终属性 = 基础(等级×境界) + 装备固定值 + Buff，再乘百分比加成
- `sumEquipmentStats()` — 汇总所有已装备物品的 flat + percent 属性
- `sumBuffStats()` — 汇总活跃 Buff 的 flat + percent 修正
- `tickBuffs()` — 回合结束时 Buff 倒计时，过期移除
- 导出类型：`Stats`, `EquipmentStats`, `BuffEntry`, `FinalStats`

### C2. 伤害计算（已完成）

`src/lib/game/damage-calc.ts`

- `calculateDamage(attacker, defender, skill?, isDefending?)` — 完整伤害公式：
  - (攻击力 + 技能伤害) × 技能系数 - 防御×0.5
  - × 元素克制倍率（火克风、风克土、土克水、水克火、暗↔光）
  - × 暴击(2x) × 随机波动(±10%)
  - × 防御状态减伤(0.5x)
  - 技能附加效果概率触发
- `calculateHeal(casterAttack, skillDamage)` — 治疗量计算
- 导出类型：`Combatant`, `SkillInfo`, `SkillEffect`, `DamageResult`

### C3. 战斗引擎（已完成）

`src/lib/game/battle-engine.ts`

- `processTurn(player, enemies, action, round, item?)` — 回合制核心循环：
  1. 执行玩家行动（attack/skill/defend/item/flee 五种）
  2. 所有存活敌人依次行动（调用 enemy-ai 决策）
  3. 结算 Buff/Debuff 倒计时
  4. 技能冷却倒计时
  5. 胜负判定
  6. 胜利时调用 drop-system 生成奖励
- `executeBattleAction`（action-tools.ts）已重构为调用此引擎
- 导出类型：`PlayerBattleState`, `TurnResult`, `PlayerActionResult`, `EnemyActionResult`

### C4. 敌人AI决策（已完成）

`src/lib/game/enemy-ai.ts`

- `decideEnemyAction(enemy, round)` — 行为树 + 加权随机：
  - HP < 30%：优先治疗/30%概率防御
  - HP 30-60%：80%概率使用强力技能
  - HP > 60%：50%概率技能/50%普攻
  - BOSS 多阶段：根据 HP 阈值解锁不同技能
- `tickEnemyCooldowns()` — 技能冷却结算
- `markSkillUsed()` — 标记技能已使用
- 导出类型：`EnemyState`, `EnemySkill`, `BossPhase`, `EnemyAction`

### C5. 掉落系统（已完成）

`src/lib/game/drop-system.ts`

- `calculateDrops(enemies, playerLevel)` — 战斗胜利奖励：
  - 经验：基于敌人等级，等级差修正（高等级敌人+50%~100%，低等级-80%）
  - 金币：敌人等级 × 5 + 随机波动
  - 物品：BOSS 专属掉落表(chance) + 通用概率掉落(25%)
  - 品质滚动：等级差修正，高等级敌人更容易出稀有物品
- 内置消耗品池（药水）和材料池（碎片/结晶/核心）
- 导出类型：`DropTemplate`, `DropResult`, `DroppedItem`

### C6. 通用公式（已完成，阶段A创建）

`src/lib/game/formulas.ts`

- 升级经验：`100 × level^1.5`
- 属性成长：`(基数 + level × 系数) × 境界倍率`
- 10 大境界系数：1x → 512x
- 伤害/暴击/元素克制/行动顺序基础公式
- 战斗经验/金币掉落公式

---

## 阶段 D：前端聊天 UI ✅

### D1. 页面结构（已完成）

```
/              → 首页/角色创建（三种族选择、背景故事、找回角色）
/game          → 游戏主界面（聊天 + 侧栏 + 弹窗面板）
```

### D2. 聊天窗口组件（已完成）

`src/components/chat/ChatWindow.tsx`

- 消息列表（自动滚动到底）
- 输入框 + 发送按钮（Enter 快捷键）
- SSE 流式文本渲染（`streaming-cursor` 动画）
- 快捷按钮渲染（AI 返回的 actions）
- 加载中状态（思考动画 ●●●）
- 空状态引导提示

### D3. 消息气泡组件（已完成）

`src/components/chat/MessageBubble.tsx`

- 用户消息：右侧，accent/20 背景
- AI 消息：左侧，surface 背景，叙事风格
- 系统消息：居中，pill 样式
- 工具执行指示：彩色标签（⏳/✓/✗）
- 每条消息 hover 显示删除按钮（二次确认）

### D4. 快捷操作按钮（已完成）

`src/components/chat/ActionButtons.tsx`

- 渲染 AI 返回的 `actions: [{label, value}]`
- 点击自动发送对应消息
- 仅在最后一条 AI 消息完成流式后显示

### D5. 玩家状态侧栏（已完成）

`src/components/game/PlayerSidebar.tsx`

- 头部：角色名 + 境界·等级
- HP/MP 进度条（渐变色）
- 六大属性（攻击/防御/速度/经验）
- 货币显示（金币/灵石）
- 当前位置
- 快捷面板按钮：[背包] [技能] [任务]
- AI 设置入口
- 响应 `state_update` 事件实时更新

### D6. 面板组件（已完成）

```
src/components/game/GamePanel.tsx       → 通用弹窗容器（标题栏+滚动内容区）
src/components/game/InventoryPanel.tsx  → 背包：分类展示、品质颜色、装备状态、使用按钮
src/components/game/SkillPanel.tsx      → 技能：已装备/未装备分组、元素颜色、属性显示
src/components/game/QuestPanel.tsx      → 任务：进行中/已完成、目标进度、奖励预览
src/components/game/SettingsModal.tsx   → AI设置：模型选择、Temperature、MaxTokens
```

### D7. 角色创建页（已完成）

`src/app/page.tsx`

- 输入名称（最大12字符）
- 三种族选择卡片（人族/精灵/兽人，含属性加成描述）
- 背景故事输入（可选，200字限制）
- 创建后自动跳转 /game
- localStorage 免登录检测（已有角色直接进入）
- 找回角色模式（按名称搜索）

### D8. 游戏核心 Hook（已完成）

`src/hooks/useGameChat.ts`

- 消息列表状态管理
- SSE 流式接收（text/tool_call/tool_result/state_update/actions/error 六种事件）
- 玩家状态实时更新
- 历史消息加载（50条/页）
- 单条消息删除（前端+数据库同步）
- 请求中止支持（AbortController）

### D9. 全局样式（已完成）

`src/app/globals.css`

- 暗色主题变量体系（12个语义色彩）
- HP/MP/EXP 渐变进度条
- 自定义滚动条
- 消息淡入动画（messageIn）
- AI 思考动画（thinking ●●●）
- 流式光标闪烁（streaming-cursor）

---

## 阶段 E：联调打磨

### E1. 全流程测试

- [ ] 角色创建 → 初始区域 → 与NPC对话 → 接任务 → 战斗 → 获得奖励 → 完成任务
- [ ] GM 模式测试: /gm 修改等级、金币、HP
- [ ] 区域生成测试: 玩家描述场景 → AI生成区域 → 探索
- [ ] 战斗完整流程: 开始→多回合→胜利/失败→奖励/惩罚
- [ ] 非标准效果测试: 特殊道具效果触发

### E2. 对话持久化验证

- [ ] 刷新页面后对话历史恢复
- [ ] 对话历史翻页加载
- [ ] 长对话token管理(上下文裁剪正常)

### E3. 错误处理

- [ ] AI API 超时/失败的降级处理
- [ ] 工具执行失败的错误反馈
- [ ] 网络断开重连(SSE)
- [ ] 无效玩家操作的友好提示

### E4. UI 打磨

- [ ] 暗色主题(游戏氛围)
- [ ] 消息动画(淡入、打字机效果)
- [ ] HP/MP 变化动画
- [ ] 移动端适配(响应式)
- [ ] 加载状态(AI思考动画)

---

## 阶段 F：三层记忆架构

> 解决的核心问题：对话历史同时承担"聊天记录展示"和"AI 上下文输入"两个职责，
> 导致长对话时 AI 遗忘重要剧情、token 被噪音污染。

### F0. 架构设计

```
┌─────────────────────────────────────────────────────────────┐
│ 第一层：即时上下文（ChatHistory 最近 N 条）                    │
│ → 当前场景的短期对话，直接喂给 AI                              │
│ → 战斗结束 / 场景切换时可安全压缩为摘要                        │
├─────────────────────────────────────────────────────────────┤
│ 第二层：游戏记忆摘要（GameMemory 表，新增）                    │
│ → AI 在关键节点自动生成摘要，例如：                            │
│   "玩家在云南森林击败了树精 Boss，获得了翠玉法杖"               │
│   "玩家答应老渔夫寻找失踪的女儿"                               │
│ → 每次拼接到 System Prompt，AI 永不遗忘重要事件                │
├─────────────────────────────────────────────────────────────┤
│ 第三层：持久数据（Player / Item / Quest 等表）                 │
│ → 结构化数值，Tool 执行时实时写入                              │
│ → 每次通过 getPlayerStateSummary() 注入上下文                  │
└─────────────────────────────────────────────────────────────┘
```

**AI 每次请求收到的上下文拼接顺序：**

```
System Prompt
  + 第三层：玩家状态摘要（属性/装备/位置/任务）
  + 第二层：游戏记忆摘要（按时间排序的重要事件列表）
  + 第一层：最近 N 条对话原文
  + 当前玩家消息
```

### F1. 数据库：新增 GameMemory 表

```prisma
model GameMemory {
  id        String   @id @default(cuid())
  playerId  String
  type      String   // "story" | "battle" | "quest" | "discovery" | "relationship"
  summary   String   @db.Text   // AI 生成的摘要文本
  importance Int     @default(5) // 1-10 重要度，用于上下文裁剪
  relatedIds Json?              // 关联的 areaId/questId/npcId 等
  createdAt  DateTime @default(now())

  player Player @relation(fields: [playerId], references: [id])

  @@index([playerId, createdAt])
  @@index([playerId, importance])
}
```

### F2. 记忆生成时机

AI 通过新增 Tool `save_memory` 在以下时刻自动保存记忆：

| 时机         | type         | 示例                                         |
| ------------ | ------------ | -------------------------------------------- |
| 战斗结束     | battle       | "在海边击败Lv.3深海蟹怪，获得50经验和蟹壳盾" |
| 完成任务     | quest        | "完成'老渔夫的委托'，获得翠玉法杖(稀有)"     |
| 到达新区域   | discovery    | "发现了云南原始森林，这里充满植物系野怪"     |
| NPC 重要对话 | relationship | "与铁匠老王建立了友好关系，他答应帮忙锻造"   |
| 剧情关键节点 | story        | "触发了远古遗迹的封印机关，通道向深处延伸"   |

### F3. 上下文组装器改造

```typescript
// src/lib/ai/context-builder.ts
// 改造 gamemaster.ts 的上下文组装逻辑：
//
// 1. 加载游戏记忆（按重要度+时间排序，取 top 20 条）
// 2. 格式化为 "【游戏记忆】" 段落注入 System Prompt
// 3. 对话历史仍取最近 N 条，但 N 可根据记忆条数动态调整
// 4. 总 token 预算管理：
//    - System Prompt: ~800 token
//    - 玩家状态: ~200 token
//    - 游戏记忆: ~500 token（按重要度裁剪）
//    - 对话历史: 剩余预算（动态）
//    - 安全余量: 预留给 AI 输出
```

### F4. 对话压缩机制

```typescript
// src/lib/ai/memory-compressor.ts
//
// 战斗结束 / 场景切换时，自动将多轮对话压缩为摘要：
// 1. 检测触发条件（战斗结束、区域切换、任务完成）
// 2. 提取最近关联对话（如10轮战斗对话）
// 3. 调用 AI 生成摘要（用低成本模型如 gpt-4o-mini）
// 4. 保存到 GameMemory
// 5. 标记原始对话为 "已压缩"（保留展示但不再送入 AI 上下文）
```

### F5. 新增 Tool：save_memory

```typescript
// 在 tools/ 中新增 save_memory 工具
// AI 可在叙事中主动调用，保存重要记忆
// 参数：{ type, summary, importance, relatedIds }
```

### F6. 文件清单

```
prisma/schema.prisma                  → 新增 GameMemory 表 + ChatHistory 加 compressed 字段
src/lib/ai/context-builder.ts         → 上下文组装器（记忆+状态+历史的 token 预算管理）
src/lib/ai/memory-compressor.ts       → 对话压缩器（触发条件+摘要生成+标记）
src/lib/ai/tools/memory-tools.ts      → save_memory / get_memories 工具
src/lib/ai/gamemaster.ts              → 改造：使用 context-builder 替代硬编码上下文
src/lib/ai/system-prompt.ts           → 新增记忆注入段落
```

---

## 阶段 G：移动端优先前端重构 ✅

> 将桌面优先的左右分栏布局重构为移动端优先的底部 Tab 导航架构。亮色清爽主题。

### G1. 新布局架构

全局壳 AppShell，结构为：顶部迷你状态条 + Tab 内容区 + 底部导航栏。

四个 Tab 页：

| Tab  | 内容         | 说明                                                    |
| ---- | ------------ | ------------------------------------------------------- |
| 游戏 | ChatWindow   | 核心聊天交互，顶部显示 HP/MP                            |
| 角色 | 角色详情全页 | 原 PlayerSidebar 展开为卡片式布局，含背包/技能/任务入口 |
| 图鉴 | 占位         | 暂时空白，后续迭代填充                                  |
| 设置 | AI 模型设置  | 原 SettingsModal 改为全页                               |

### G2. 新建文件

```
src/components/layout/AppShell.tsx        → 全局壳（顶部状态+内容区+底部导航）
src/components/layout/BottomNav.tsx       → 底部导航栏（4 Tab）
src/components/layout/MiniStatusBar.tsx   → 顶部迷你状态条（角色名+HP/MP）
src/components/tabs/GameTab.tsx           → 游戏 Tab
src/components/tabs/CharacterTab.tsx      → 角色 Tab
src/components/tabs/CodexTab.tsx          → 图鉴 Tab（占位）
src/components/tabs/SettingsTab.tsx       → 设置 Tab
```

### G3. 重构文件

```
src/app/game/page.tsx                     → 改用 AppShell + Tab 切换
src/components/chat/ChatWindow.tsx        → 适配新布局高度
src/components/game/SettingsModal.tsx     → 提取设置内容为独立组件
src/app/globals.css                       → 新增移动端适配样式
```

### G4. 关键设计决策

- 使用 `dvh`（dynamic viewport height）解决移动端地址栏高度问题
- 底部导航 56px，顶部状态条 36px
- 桌面端与移动端统一用底部 Tab 导航
- Tab 切换使用 React state，无路由变化（保持 SPA 体验）

---

## 后续迭代计划

| 迭代      | 核心内容                                                                                                                                        | 前置条件 |
| --------- | ----------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| **迭代1** | 装备系统深度(词缀/强化/套装)、技能系统(技能树/解锁)、区域生成优化                                                                               | MVP 完成 |
| **迭代2** | NPC深度交互(好感度/记忆)、任务系统丰富(多类型/任务链)、奇遇事件                                                                                 | 迭代1    |
| **迭代3** | 境界突破(叙事+属性重算)、图鉴收集(怪物/物品)、成就系统                                                                                          | 迭代2    |
| **迭代4** | 区域探索系统完善、已探索区域列表与传送、区域完成奖励                                                                                            | 迭代2    |
| **迭代5** | 用户认证(NextAuth)、新手引导、数据持久化优化、**对话历史 Token 预算控制**（根据 System Prompt + 状态摘要已用 token 动态裁剪历史条数）、部署上线 | 迭代4    |

#### 迭代4 — 区域探索系统详细需求

1. **探索进度注入 AI 上下文**：`getAreaInfoSummary()` 读取 `PlayerArea.exploredNodes`，在区域信息中标注已探索/未探索节点，让 AI 了解玩家进度
2. **前端探索进度显示**：侧栏或区域面板中显示"3/7 节点已探索"进度条
3. **已探索区域列表**：新增工具 `list_explored_areas`，返回玩家去过的所有区域及探索进度
4. **区域间传送/切换**：新增工具 `travel_to_area`，允许玩家回到已探索过的区域（传送到该区域最后所在节点）
5. **区域完成判定与奖励**：所有节点探索完毕 → 触发"区域通关"事件，给予经验/金币/物品奖励
6. **自由来往策略**：玩家可随时切换已探索区域，不强制完成当前区域

---

## 文件创建清单

### 阶段 A ✅

```
prisma/schema.prisma          → 完整 Schema（12 个模型）
prisma/seed.ts                → 种子数据（珊瑚海湾 8 节点 + 老渔夫任务，幂等）
prisma.config.ts              → Prisma 7 配置
src/lib/db/prisma.ts          → Prisma 客户端单例（PrismaPg 适配器）
src/app/api/player/route.ts   → 玩家 CRUD（calcBaseStats + 自动分配初始区域）
```

### 阶段 B ✅

```
src/lib/ai/gamemaster.ts           → GM核心（上下文组装+工具循环+SSE输出）
src/lib/ai/llm-client.ts           → 统一LLM客户端（多供应商路由+流式+工具循环）
src/lib/ai/config.ts               → 配置管理（DB → env → 默认值）
src/lib/ai/system-prompt.ts        → System Prompt（含区域生成格式规范）
src/lib/ai/context-builder.ts      → 上下文组装器（状态+区域+任务+历史，并行加载）
src/lib/ai/adapters/types.ts       → 统一类型（8个模型定义）
src/lib/ai/adapters/openai-adapter.ts  → OpenAI/GPT/Grok 适配器
src/lib/ai/adapters/anthropic-adapter.ts → Claude 适配器
src/lib/ai/adapters/google-adapter.ts   → Gemini 适配器
src/lib/ai/tools/index.ts          → 工具注册表+分发（15个工具）
src/lib/ai/tools/query-tools.ts    → 查询类（3个）
src/lib/ai/tools/action-tools.ts   → 行动类（6个）
src/lib/ai/tools/generate-tools.ts → 生成类（3个，含统一节点data格式）
src/lib/ai/tools/modify-tools.ts   → 修改类（3个）
src/app/api/game/chat/route.ts     → SSE 端点
src/app/api/player/history/route.ts → 对话历史
src/app/api/settings/route.ts      → LLM配置API
```

### 阶段 C ✅

```
src/lib/game/player-calc.ts    → 玩家属性计算（基础+装备+Buff，含百分比加成）
src/lib/game/damage-calc.ts    → 伤害计算（技能系数+元素克制+暴击+防御减伤+附加效果）
src/lib/game/battle-engine.ts  → 战斗引擎（processTurn 回合核心，已集成到 executeBattleAction）
src/lib/game/enemy-ai.ts       → 敌人AI（行为树+加权随机+BOSS多阶段）
src/lib/game/drop-system.ts    → 掉落系统（经验/金币/物品概率表+品质滚动）
src/lib/game/formulas.ts       → 通用公式（经验/属性/伤害/暴击/元素/行动顺序）
```

### 阶段 D ✅

```
src/app/page.tsx                       → 角色创建/找回（种族选择+背景故事）
src/app/game/page.tsx                  → 游戏主页（聊天+侧栏+弹窗面板）
src/hooks/useGameChat.ts               → 核心Hook（SSE流式+状态管理+历史加载）
src/components/chat/ChatWindow.tsx     → 聊天窗口（消息列表+输入框+自动滚动）
src/components/chat/MessageBubble.tsx  → 消息气泡（用户/AI/系统+工具指示+删除）
src/components/chat/ActionButtons.tsx  → 快捷按钮（AI返回的选项按钮）
src/components/game/PlayerSidebar.tsx  → 状态侧栏（HP/MP条+属性+位置+面板入口）
src/components/game/GamePanel.tsx      → 通用弹窗容器
src/components/game/InventoryPanel.tsx → 背包面板（分类+品质颜色+装备状态）
src/components/game/SkillPanel.tsx     → 技能面板（已装备/未装备+元素颜色）
src/components/game/QuestPanel.tsx     → 任务面板（进度+目标+奖励）
src/components/game/SettingsModal.tsx  → AI设置弹窗（模型/温度/Token）
src/app/globals.css                    → 暗色主题+动画+进度条样式
```
