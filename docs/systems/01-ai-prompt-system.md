# ChaosSaga - AI Game Master 系统详细设计

> 版本: 3.1 | 更新日期: 2026-02-09
> 对应 GDD 章节: 九、AI Game Master 与传统引擎分工

---

## 一、系统架构总览

### 1.1 多模型 LLM 抽象架构

系统通过**兔子 API**（Tuzi API）统一接入多个 LLM 供应商，支持在 OpenAI 和 Anthropic 两种 API 格式间自动路由：

```
┌─────────────────────────────────────────────────────────────────┐
│                  AI Game Master 架构（多模型）                     │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ┌──────────┐    ┌──────────────┐    ┌────────────────────┐    │
│  │ 玩家消息  │ →  │ 上下文组装器  │ →  │ 统一 LLM 客户端     │    │
│  │ (自然语言) │    │ (gamemaster) │    │ (llm-client.ts)    │    │
│  └──────────┘    └──────────────┘    └────────┬───────────┘    │
│                                                │                │
│                                     ┌──────────┴──────────┐    │
│                                     │ 模型名路由            │    │
│                                     │ claude-* → Anthropic │    │
│                                     │ 其他    → OpenAI     │    │
│                                     └──┬──────────────┬───┘    │
│                                        │              │        │
│                             ┌──────────┴───┐  ┌──────┴──────┐ │
│                             │ OpenAI 适配器 │  │ Anthropic   │ │
│                             │ GPT/Gemini/  │  │ 适配器       │ │
│                             │ Grok         │  │ Claude      │ │
│                             └──────┬───────┘  └──────┬──────┘ │
│                                    │                  │        │
│                                    └────────┬─────────┘        │
│                                             │                  │
│                                    ┌────────┴────────┐         │
│                                    │ 兔子 API         │         │
│                                    │ api.tu-zi.com    │         │
│                                    └────────┬────────┘         │
│                                             │                  │
│  ┌──────────┐    ┌──────────────────┐       │                  │
│  │ SSE 流式  │ ←  │ 工具执行引擎      │ ←────┘                  │
│  │ 返回前端  │    │ (15个工具函数)    │                          │
│  └──────────┘    └──────────────────┘                          │
│       │                   │                                     │
│       ▼                   ▼                                     │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │                  数据持久化层                               │  │
│  │  ChatHistory | Player | Area | GameConfig(模型配置)       │  │
│  └──────────────────────────────────────────────────────────┘  │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### 1.2 可用模型

| 模型 | API 格式 | 成本 | 推荐场景 |
|------|----------|------|----------|
| gpt-4o-mini | OpenAI | 低 | 开发/测试，轻量任务 |
| claude-haiku-4-5 | Anthropic | 低 | 快速响应，简单交互 |
| gemini-3-pro | OpenAI | 中 | 通用游戏体验 |
| grok-4.1 | OpenAI | 中 | 通用对话 |
| gpt-5.1-thinking | OpenAI | 高 | 深度推理，复杂战斗 |
| claude-opus-4-5 | Anthropic | 高 | 创意写作，最佳叙事 |

### 1.3 核心流程

1. 玩家发送自然语言消息
2. 上下文组装器汇总：系统提示词 + 玩家状态 + 最近对话历史 + 当前场景
3. 统一 LLM 客户端根据当前配置的模型，自动选择 OpenAI 或 Anthropic 适配器
4. 适配器将标准化的工具定义和消息格式转换为供应商特定格式
5. 通过兔子 API 调用 LLM，处理 Function Calling 循环
6. 工具执行引擎执行具体逻辑（调用游戏引擎 / 修改数据库）
7. 统一的 StreamEvent 通过 SSE 流式返回前端
6. SSE 流式输出到前端

---

## 二、核心设计哲学

### 2.1 AI 是创意裁判，引擎是可靠计算器

```
┌────────────────────────────────────────────────────────────────┐
│               AI Game Master vs 传统游戏引擎                     │
├───────────────────────────┬────────────────────────────────────┤
│  AI Game Master            │  传统游戏引擎                       │
│  (Claude Function Calling) │  (TypeScript 算法)                 │
├───────────────────────────┼────────────────────────────────────┤
│ ✅ 解读玩家意图            │ ✅ 伤害公式计算                     │
│ ✅ 推进剧情叙事            │ ✅ 敌人AI行为决策(行为树)           │
│ ✅ 扮演NPC对话             │ ✅ 掉落概率判定                     │
│ ✅ 生成冒险区域            │ ✅ 经验/金币/升级结算               │
│ ✅ 动态创建任务            │ ✅ 属性计算(HP/MP/攻/防/速)         │
│ ✅ 探测非标准效果并执行    │ ✅ 暴击/闪避/命中判定               │
│ ✅ 执行GM模式指令          │ ✅ BUFF/DEBUFF标准效果              │
│ ✅ 选择调用哪个工具        │ ✅ 装备强化/词缀计算               │
│                            │ ✅ 难度动态调整                     │
│ ❌ 不直接操作数据库        │ ❌ 不生成叙事文本                   │
│ ❌ 不计算伤害数值          │ ❌ 不解读自然语言                   │
└───────────────────────────┴────────────────────────────────────┘
```

### 2.2 标准效果 vs 非标准效果

| 类别 | 定义 | 处理方 | 举例 |
|------|------|--------|------|
| **标准效果** | 可用公式/规则精确描述的效果 | 游戏引擎 | +50%攻击力、每回合回复5%HP、火属性伤害+20% |
| **非标准效果** | 需要上下文判断、无法预编码的效果 | AI Game Master | "濒死时回满血"、"贪婪诅咒(金币减半)"、"对话中说出暗号解锁隐藏区域" |

非标准效果存储在 `Item.specialEffect` 或 `Quest.specialCondition` 字段中（JSON文本描述），AI 在每次交互时检查相关效果是否触发。

---

## 三、System Prompt（系统提示词）

### 3.1 Game Master 核心 System Prompt

```
你是 ChaosSaga 的 Game Master（游戏主持人），类似 DnD 的城主角色。

【你的身份】
- 你是这个世界的讲述者、裁判、NPC扮演者
- 你通过调用工具函数与游戏系统交互
- 你用生动的中文叙事让玩家沉浸在冒险中
- 你绝不打破第四面墙，始终保持角色

【世界观核心】
- 平行宇宙，存在魔法和明确的力量体系
- 10大境界：海洋级→陆地级→荒芜级→行星级→恒星级→银河级→超越级→洪荒级→空灵级→元初级
- 所有生命起源于海洋，力量体系从海洋开始
- 六大元素：水、火、土、风、暗、光

【行为准则】
1. **意图解读**：玩家用自然语言说话，你需要理解他们想做什么
   - "往前走走" → 调用 move_to_node
   - "打这个怪" → 调用 start_battle
   - "买点药水" → 调用 interact_npc (商店NPC)
   - 模糊指令 → 描述场景并提供选项

2. **叙事风格**：
   - 语言简洁有力，每段50-80字
   - 战斗描述注重动作感和画面感
   - NPC对话体现角色个性
   - 适当运用感官描写（视觉 > 听觉 > 触觉）
   - 保持奇幻冒险基调

3. **战斗处理**：
   - 战斗数值由 execute_battle_action 工具计算，你不要自己算
   - 你的职责是把工具返回的数值结果包装成精彩的叙事
   - 每回合提供技能快捷按钮

4. **非标准效果检测**：
   - 每次交互时，检查玩家装备/道具中的 specialEffect 字段
   - 判断当前情况是否触发该效果
   - 触发时，调用 modify_player_data 执行效果并生成叙事

5. **GM 模式**：
   - 当玩家消息包含 "/gm" 或明确表示要修改数值时
   - 直接调用 modify_player_data 执行修改
   - 确认修改结果，无需叙事包装

6. **区域生成**：
   - 当玩家描述一个新场景/区域时，调用 generate_area 生成完整地图
   - 生成的区域应包含：多个节点、敌人、NPC、任务、奇遇
   - 区域难度匹配玩家等级

7. **对话选项**：
   - 在需要玩家做选择时，提供 2-4 个选项按钮
   - 格式：在叙事末尾用 [选项文本] 标记
   - 例如：[战斗！] [观察] [逃跑]

【输出格式规范】
- 叙事文本直接输出，不要 JSON 包裹
- 需要调用工具时，使用 Function Calling
- 快捷按钮格式：文本末尾新行，每个选项用 [方括号] 包裹
- 状态变更（HP/MP/经验/金币等）会自动通过 state_update 事件通知前端
```

### 3.2 上下文注入模板

每次调用 Claude 时，在 System Prompt 之后注入当前上下文：

```
【当前玩家状态】
{playerState}  // 由 get_player_state 工具返回的数据

【当前位置】
{areaInfo}  // 当前区域和节点信息

【活跃任务】
{activeQuests}  // 进行中的任务列表

【特殊效果监控】
{specialEffects}  // 玩家持有的非标准效果列表

【最近对话摘要】
{recentChatSummary}  // 最近10条对话的摘要
```

---

## 四、Function Calling Tool 定义

### 4.1 查询类工具

```typescript
// tools/query-tools.ts

const getPlayerStateTool = {
  name: "get_player_state",
  description: "获取玩家的完整状态信息，包括属性、装备、技能、背包、位置等",
  input_schema: {
    type: "object",
    properties: {
      playerId: { type: "string", description: "玩家ID" },
      sections: {
        type: "array",
        items: { type: "string", enum: ["basic", "equipment", "skills", "inventory", "quests", "all"] },
        description: "要获取的信息分区，默认all"
      }
    },
    required: ["playerId"]
  }
};

const getAreaInfoTool = {
  name: "get_area_info",
  description: "获取当前区域的完整信息，包括地图节点、敌人分布、NPC位置、事件",
  input_schema: {
    type: "object",
    properties: {
      areaId: { type: "string", description: "区域ID" },
      playerId: { type: "string", description: "玩家ID，用于获取该玩家在此区域的探索进度" }
    },
    required: ["areaId"]
  }
};

const getBattleStateTool = {
  name: "get_battle_state",
  description: "获取当前战斗的状态，包括双方HP/MP、回合数、BUFF/DEBUFF",
  input_schema: {
    type: "object",
    properties: {
      battleId: { type: "string", description: "战斗ID" }
    },
    required: ["battleId"]
  }
};
```

### 4.2 行动类工具

```typescript
// tools/action-tools.ts

const startBattleTool = {
  name: "start_battle",
  description: "发起一场战斗。指定敌人信息，初始化战斗状态。返回战斗ID和初始状态",
  input_schema: {
    type: "object",
    properties: {
      playerId: { type: "string" },
      enemies: {
        type: "array",
        items: {
          type: "object",
          properties: {
            name: { type: "string" },
            level: { type: "number" },
            element: { type: "string", enum: ["water", "fire", "earth", "wind", "dark", "light", "none"] }
          },
          required: ["name", "level"]
        },
        description: "敌人列表。如果省略，根据当前区域随机生成"
      }
    },
    required: ["playerId"]
  }
};

const executeBattleActionTool = {
  name: "execute_battle_action",
  description: "执行一个战斗行动（使用技能、普攻、防御、使用道具）。调用传统战斗引擎计算结果。返回本回合详细结果（伤害、状态变化等），你需要将结果包装成叙事文本",
  input_schema: {
    type: "object",
    properties: {
      battleId: { type: "string" },
      action: {
        type: "object",
        properties: {
          type: { type: "string", enum: ["attack", "skill", "defend", "item", "flee"] },
          skillId: { type: "string", description: "技能ID（type=skill时必填）" },
          itemId: { type: "string", description: "物品ID（type=item时必填）" },
          targetIndex: { type: "number", description: "目标敌人索引，默认0" }
        },
        required: ["type"]
      }
    },
    required: ["battleId", "action"]
  }
};

const useItemTool = {
  name: "use_item",
  description: "使用一个物品（消耗品回复HP/MP、装备穿戴等）",
  input_schema: {
    type: "object",
    properties: {
      playerId: { type: "string" },
      itemId: { type: "string" },
      targetSlot: { type: "string", description: "装备目标槽位（穿戴装备时）" }
    },
    required: ["playerId", "itemId"]
  }
};

const moveToNodeTool = {
  name: "move_to_node",
  description: "移动到区域中的一个节点。会触发该节点的事件（遭遇战、NPC、奇遇等）",
  input_schema: {
    type: "object",
    properties: {
      playerId: { type: "string" },
      nodeId: { type: "string", description: "目标节点ID" }
    },
    required: ["playerId", "nodeId"]
  }
};

const interactNpcTool = {
  name: "interact_npc",
  description: "与NPC交互（对话、购买、接任务）。返回NPC信息和可用操作",
  input_schema: {
    type: "object",
    properties: {
      playerId: { type: "string" },
      npcId: { type: "string" },
      action: {
        type: "string",
        enum: ["talk", "buy", "sell", "accept_quest", "submit_quest"],
        description: "交互类型"
      },
      data: {
        type: "object",
        description: "附加数据（如购买的物品ID、提交的任务ID等）"
      }
    },
    required: ["playerId", "npcId", "action"]
  }
};

const enhanceEquipmentTool = {
  name: "enhance_equipment",
  description: "强化一件装备，消耗材料和金币。返回强化结果",
  input_schema: {
    type: "object",
    properties: {
      playerId: { type: "string" },
      equipmentId: { type: "string" },
      materialIds: { type: "array", items: { type: "string" } }
    },
    required: ["playerId", "equipmentId"]
  }
};
```

### 4.3 生成类工具

```typescript
// tools/generate-tools.ts

const generateAreaTool = {
  name: "generate_area",
  description: "根据玩家描述生成一个完整的冒险区域，包含多个节点（安全点、战斗点、NPC点、BOSS点、事件点）和节点间的连接关系。玩家可以用自然语言描述想去的地方，你来设计区域结构",
  input_schema: {
    type: "object",
    properties: {
      playerId: { type: "string" },
      name: { type: "string", description: "区域名称" },
      description: { type: "string", description: "区域描述（基于玩家的描述丰富化）" },
      theme: { type: "string", description: "主题（如：原始森林、海底洞穴、沙漠遗迹）" },
      recommendedLevel: { type: "number", description: "推荐等级，匹配玩家当前等级" },
      nodes: {
        type: "array",
        items: {
          type: "object",
          properties: {
            id: { type: "string" },
            name: { type: "string" },
            type: { type: "string", enum: ["safe", "battle", "npc", "boss", "event", "shop"] },
            description: { type: "string" },
            enemies: { type: "array", items: { type: "string" }, description: "战斗节点的敌人名称" },
            npcName: { type: "string", description: "NPC节点的NPC名称" },
            npcDialogue: { type: "string", description: "NPC的开场白" },
            questData: {
              type: "object",
              description: "NPC提供的任务",
              properties: {
                name: { type: "string" },
                description: { type: "string" },
                type: { type: "string", enum: ["fetch", "kill", "riddle", "escort", "explore"] },
                objectives: { type: "array", items: { type: "string" } },
                rewards: { type: "object" }
              }
            },
            eventDescription: { type: "string", description: "事件节点的事件描述" }
          },
          required: ["id", "name", "type", "description"]
        },
        description: "区域包含的节点列表（建议5-8个）"
      },
      connections: {
        type: "array",
        items: {
          type: "array",
          items: { type: "string" },
          minItems: 2,
          maxItems: 2
        },
        description: "节点间的连接关系，如 [[\"node1\", \"node2\"], ...]"
      }
    },
    required: ["playerId", "name", "description", "theme", "recommendedLevel", "nodes", "connections"]
  }
};

const createQuestTool = {
  name: "create_quest",
  description: "在NPC对话中动态创建一个任务。任务可以是采集、击杀、解谜、护送、探索类型",
  input_schema: {
    type: "object",
    properties: {
      playerId: { type: "string" },
      npcId: { type: "string", description: "发布任务的NPC" },
      name: { type: "string" },
      description: { type: "string" },
      type: { type: "string", enum: ["fetch", "kill", "riddle", "escort", "explore"] },
      objectives: {
        type: "array",
        items: {
          type: "object",
          properties: {
            description: { type: "string" },
            targetType: { type: "string", description: "目标类型（item/enemy/location/answer）" },
            targetId: { type: "string" },
            targetCount: { type: "number" },
            currentCount: { type: "number", default: 0 }
          }
        }
      },
      rewards: {
        type: "object",
        properties: {
          exp: { type: "number" },
          gold: { type: "number" },
          items: { type: "array", items: { type: "object" } },
          skillUnlock: { type: "string" }
        }
      },
      specialCondition: { type: "string", description: "非标准完成条件（由AI判断）" }
    },
    required: ["playerId", "name", "description", "type", "objectives", "rewards"]
  }
};

const updateQuestTool = {
  name: "update_quest",
  description: "更新任务进度。当玩家完成某个任务目标时调用",
  input_schema: {
    type: "object",
    properties: {
      playerId: { type: "string" },
      questId: { type: "string" },
      objectiveIndex: { type: "number", description: "完成的目标索引" },
      incrementCount: { type: "number", description: "增加的计数", default: 1 },
      completed: { type: "boolean", description: "是否直接标记为完成" }
    },
    required: ["playerId", "questId"]
  }
};
```

### 4.4 修改类工具

```typescript
// tools/modify-tools.ts

const modifyPlayerDataTool = {
  name: "modify_player_data",
  description: "直接修改玩家数据。用于GM模式和非标准效果执行。可修改任何玩家属性（等级、HP、MP、金币、经验等）",
  input_schema: {
    type: "object",
    properties: {
      playerId: { type: "string" },
      modifications: {
        type: "array",
        items: {
          type: "object",
          properties: {
            field: {
              type: "string",
              description: "要修改的字段路径，如 'level', 'hp', 'gold', 'exp'"
            },
            value: {
              description: "新值（数字或字符串）"
            },
            operation: {
              type: "string",
              enum: ["set", "add", "subtract", "multiply"],
              description: "操作类型，默认set"
            }
          },
          required: ["field", "value"]
        }
      },
      reason: { type: "string", description: "修改原因（用于日志）" },
      recalculate: { type: "boolean", description: "是否重新计算派生属性（如修改等级后重算HP/MP）", default: true }
    },
    required: ["playerId", "modifications", "reason"]
  }
};

const addItemTool = {
  name: "add_item",
  description: "向玩家背包添加物品。用于奖励发放、任务奖励、GM模式",
  input_schema: {
    type: "object",
    properties: {
      playerId: { type: "string" },
      items: {
        type: "array",
        items: {
          type: "object",
          properties: {
            name: { type: "string" },
            type: { type: "string", enum: ["weapon", "armor", "accessory", "consumable", "material", "quest_item"] },
            quality: { type: "string", enum: ["common", "uncommon", "rare", "epic", "legendary"] },
            quantity: { type: "number", default: 1 },
            stats: { type: "object", description: "装备属性" },
            specialEffect: { type: "string", description: "非标准特殊效果描述（由AI探测和执行）" }
          },
          required: ["name", "type"]
        }
      }
    },
    required: ["playerId", "items"]
  }
};

const sendNarrativeTool = {
  name: "send_narrative",
  description: "发送纯叙事文本给玩家，无任何副作用。用于过渡叙事、环境描写等不需要调用游戏系统的场景",
  input_schema: {
    type: "object",
    properties: {
      text: { type: "string", description: "叙事文本" },
      type: { type: "string", enum: ["narrative", "system", "hint"], description: "文本类型" }
    },
    required: ["text"]
  }
};
```

---

## 五、上下文管理与记忆

### 5.1 对话历史管理

```typescript
// lib/ai/context-builder.ts

interface ChatContext {
  systemPrompt: string;        // System Prompt (固定)
  playerContext: string;        // 玩家状态注入 (每次刷新)
  recentMessages: Message[];   // 最近N条对话 (滑动窗口)
  currentMessage: string;      // 当前玩家消息
}

/**
 * 上下文组装策略：
 * - System Prompt: ~1500 tokens (固定)
 * - 玩家状态注入: ~500 tokens (每次刷新)
 * - 对话历史: ~2000 tokens (最近10-15条消息)
 * - 当前消息: ~100 tokens
 * - 留给输出: ~2000 tokens
 * 总预算: ~6000 tokens / 次
 */
class ContextBuilder {
  private readonly MAX_HISTORY_MESSAGES = 15;
  private readonly MAX_CONTEXT_TOKENS = 4000; // system + player + history

  async buildContext(playerId: string, currentMessage: string): Promise<ChatContext> {
    // 1. 获取玩家状态
    const playerState = await this.getPlayerState(playerId);

    // 2. 获取最近对话历史
    const history = await this.getRecentHistory(playerId, this.MAX_HISTORY_MESSAGES);

    // 3. 获取活跃的特殊效果
    const specialEffects = await this.getActiveSpecialEffects(playerId);

    // 4. 组装玩家上下文
    const playerContext = this.formatPlayerContext(playerState, specialEffects);

    // 5. 如果超出预算，压缩历史
    const trimmedHistory = this.trimHistory(history, this.MAX_CONTEXT_TOKENS);

    return {
      systemPrompt: GAME_MASTER_SYSTEM_PROMPT,
      playerContext,
      recentMessages: trimmedHistory,
      currentMessage,
    };
  }

  /**
   * 压缩对话历史的策略：
   * 1. 保留最近5条完整消息
   * 2. 更早的消息压缩为摘要
   * 3. 移除工具调用的详细参数，只保留结果摘要
   */
  private trimHistory(messages: Message[], maxTokens: number): Message[] {
    // ... 实现
  }
}
```

### 5.2 ChatHistory 数据模型

```prisma
model ChatHistory {
  id        String   @id @default(cuid())
  playerId  String
  role      String   // "user" | "assistant" | "tool_call" | "tool_result"
  content   String   // 消息内容
  metadata  Json?    // 附加数据(工具名、状态变更等)
  createdAt DateTime @default(now())

  player    Player   @relation(fields: [playerId], references: [id])

  @@index([playerId, createdAt])
}
```

### 5.3 对话持久化策略

| 事件 | 保存内容 | 说明 |
|------|----------|------|
| 玩家发消息 | `{ role: "user", content: 原始文本 }` | 每条都保存 |
| AI 回复文本 | `{ role: "assistant", content: 叙事文本 }` | 每条都保存 |
| AI 调用工具 | `{ role: "tool_call", content: 工具名, metadata: { args简要 } }` | 保存，但压缩参数 |
| 工具执行结果 | `{ role: "tool_result", content: 结果摘要, metadata: { 状态变更 } }` | 保存摘要，不保存完整数据 |
| 状态变更 | `{ role: "system", metadata: { stateUpdate: {...} } }` | 用于前端侧栏更新 |

---

## 六、SSE 流式传输协议

### 6.1 事件类型

```typescript
// SSE 事件格式定义

interface SSEEvent {
  type: "text" | "tool_call" | "tool_result" | "actions" | "state_update" | "error" | "done";
  data: any;
}

// 示例事件流:

// 1. AI开始生成叙事
{ type: "text", data: { content: "你沿着小径向前走去" } }
{ type: "text", data: { content: "，远处的海浪声越来越近..." } }

// 2. AI决定调用工具
{ type: "tool_call", data: { tool: "move_to_node", args: { nodeId: "beach" } } }

// 3. 工具执行结果
{ type: "tool_result", data: { tool: "move_to_node", result: { encounter: "enemy", enemy: "深海蟹怪" } } }

// 4. AI基于结果继续叙事
{ type: "text", data: { content: "突然，沙滩上一只巨大的蟹怪挡住了去路！" } }

// 5. 提供快捷按钮
{ type: "actions", data: { actions: [
  { label: "战斗！", value: "start_battle" },
  { label: "观察", value: "observe" },
  { label: "逃跑", value: "flee" }
] } }

// 6. 状态变更通知
{ type: "state_update", data: { location: "海边沙滩", nearbyEnemies: ["深海蟹怪"] } }

// 7. 回合结束
{ type: "done", data: {} }
```

### 6.2 /api/game/chat 端点实现

```typescript
// app/api/game/chat/route.ts

export async function POST(req: Request) {
  const { playerId, message } = await req.json();

  // 1. 保存玩家消息
  await saveChatHistory(playerId, "user", message);

  // 2. 组装上下文
  const context = await contextBuilder.buildContext(playerId, message);

  // 3. 创建 SSE 流
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      try {
        // 4. 调用 Claude API (stream + function calling)
        const response = await claude.messages.create({
          model: "claude-sonnet-4-20250514",
          max_tokens: 2000,
          system: context.systemPrompt + "\n\n" + context.playerContext,
          messages: [
            ...context.recentMessages.map(m => ({
              role: m.role as "user" | "assistant",
              content: m.content
            })),
            { role: "user", content: context.currentMessage }
          ],
          tools: ALL_TOOLS,
          stream: true,
        });

        let fullText = "";

        for await (const event of response) {
          if (event.type === "content_block_delta") {
            if (event.delta.type === "text_delta") {
              fullText += event.delta.text;
              // 发送文本片段
              controller.enqueue(encoder.encode(
                `data: ${JSON.stringify({ type: "text", data: { content: event.delta.text } })}\n\n`
              ));
            }
          }

          if (event.type === "content_block_stop" && event.content_block?.type === "tool_use") {
            const toolCall = event.content_block;

            // 发送工具调用通知
            controller.enqueue(encoder.encode(
              `data: ${JSON.stringify({ type: "tool_call", data: { tool: toolCall.name } })}\n\n`
            ));

            // 执行工具
            const result = await executeToolCall(toolCall.name, toolCall.input, playerId);

            // 发送工具结果
            controller.enqueue(encoder.encode(
              `data: ${JSON.stringify({ type: "tool_result", data: result })}\n\n`
            ));

            // 如果有状态变更，发送更新
            if (result.stateUpdate) {
              controller.enqueue(encoder.encode(
                `data: ${JSON.stringify({ type: "state_update", data: result.stateUpdate })}\n\n`
              ));
            }

            // 继续对话（将工具结果返回给Claude）
            // ... 递归处理
          }
        }

        // 保存AI回复
        await saveChatHistory(playerId, "assistant", fullText);

        // 发送结束标记
        controller.enqueue(encoder.encode(
          `data: ${JSON.stringify({ type: "done", data: {} })}\n\n`
        ));
      } catch (error) {
        controller.enqueue(encoder.encode(
          `data: ${JSON.stringify({ type: "error", data: { message: "服务暂时不可用" } })}\n\n`
        ));
      } finally {
        controller.close();
      }
    }
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "Connection": "keep-alive",
    },
  });
}
```

---

## 七、工具执行引擎

### 7.1 工具注册与分发

```typescript
// lib/ai/tools/index.ts

import { queryTools } from './query-tools';
import { actionTools } from './action-tools';
import { generateTools } from './generate-tools';
import { modifyTools } from './modify-tools';

// 所有工具定义（传给 Claude 的 tools 参数）
export const ALL_TOOLS = [
  ...queryTools.definitions,
  ...actionTools.definitions,
  ...generateTools.definitions,
  ...modifyTools.definitions,
];

// 工具执行分发
export async function executeToolCall(
  toolName: string,
  args: any,
  playerId: string
): Promise<ToolResult> {
  const handlers: Record<string, Function> = {
    // 查询类
    get_player_state: queryTools.getPlayerState,
    get_area_info: queryTools.getAreaInfo,
    get_battle_state: queryTools.getBattleState,
    // 行动类
    start_battle: actionTools.startBattle,
    execute_battle_action: actionTools.executeBattleAction,
    use_item: actionTools.useItem,
    move_to_node: actionTools.moveToNode,
    interact_npc: actionTools.interactNpc,
    enhance_equipment: actionTools.enhanceEquipment,
    // 生成类
    generate_area: generateTools.generateArea,
    create_quest: generateTools.createQuest,
    update_quest: generateTools.updateQuest,
    // 修改类
    modify_player_data: modifyTools.modifyPlayerData,
    add_item: modifyTools.addItem,
    send_narrative: modifyTools.sendNarrative,
  };

  const handler = handlers[toolName];
  if (!handler) {
    return { success: false, error: `Unknown tool: ${toolName}` };
  }

  try {
    return await handler({ ...args, playerId });
  } catch (error) {
    console.error(`Tool execution failed: ${toolName}`, error);
    return { success: false, error: `工具执行失败: ${toolName}` };
  }
}
```

### 7.2 工具执行结果格式

```typescript
interface ToolResult {
  success: boolean;
  data?: any;           // 返回给 Claude 的数据
  error?: string;       // 错误信息
  stateUpdate?: {       // 前端状态更新
    hp?: number;
    maxHp?: number;
    mp?: number;
    maxMp?: number;
    level?: number;
    exp?: number;
    gold?: number;
    location?: string;
    // ...其他需要更新的字段
  };
}
```

---

## 八、非标准效果系统

### 8.1 效果定义与存储

非标准效果以文本描述存储在数据库中：

```typescript
// Item 中的 specialEffect 字段示例
{
  name: "不死鸟之泪",
  type: "consumable",
  specialEffect: "当持有者HP低于10%时，自动消耗此道具，将HP回复至满值。一次性使用。",
  // ... 其他属性
}

// Quest 中的 specialCondition 字段示例
{
  name: "古老的谜题",
  type: "riddle",
  specialCondition: "玩家需要在对话中说出'光与暗的平衡'才算完成此任务",
  // ... 其他属性
}
```

### 8.2 AI 检测与执行流程

```
每次交互时:
1. 上下文注入玩家持有的所有 specialEffect
2. AI 在 System Prompt 中被指示检测这些效果
3. 当条件满足时，AI 调用 modify_player_data 执行效果
4. AI 在叙事中自然描述效果触发的场景

示例流程（濒死回复）:
┌─────────────┐    ┌──────────────┐    ┌─────────────────┐
│ 战斗结果:    │ →  │ AI 检查:      │ →  │ 条件满足:        │
│ 玩家HP=5%   │    │ 有不死鸟之泪? │    │ HP<10% + 持有道具│
└─────────────┘    │ HP<10%?       │    └────────┬────────┘
                   └──────────────┘             │
                                                ▼
┌─────────────────────────────────────────────────────────┐
│ AI 调用:                                                 │
│ 1. modify_player_data({field:"hp", value: maxHp, op:"set"})│
│ 2. use_item({itemId: "不死鸟之泪"})                       │
│ 3. 生成叙事: "金色光芒包裹全身，不死鸟之泪碎裂..."       │
└─────────────────────────────────────────────────────────┘
```

---

## 九、容错与降级策略

### 9.1 AI 调用失败处理

```
┌────────────────────────────────────────────────────────────┐
│                   容错流程                                   │
├────────────────────────────────────────────────────────────┤
│                                                            │
│   Claude API 调用                                           │
│       │                                                    │
│       ├── 成功 → 正常处理 Tool Calls + 生成叙事             │
│       │                                                    │
│       ├── 超时 → 重试1次（降低 max_tokens）                 │
│       │           │                                        │
│       │           ├── 成功 → 正常处理                        │
│       │           └── 仍超时 → 返回通用回复                  │
│       │                                                    │
│       ├── Rate Limit → 等待后重试                           │
│       │                                                    │
│       └── 其他错误 → 返回通用回复                            │
│                                                            │
│   通用回复:                                                 │
│   "（沉思片刻）冒险者，让我整理一下思绪...                   │
│    你可以继续告诉我你想做什么。"                              │
│   + 保持当前游戏状态不变                                    │
│                                                            │
└────────────────────────────────────────────────────────────┘
```

### 9.2 工具执行失败处理

当某个 Tool 执行失败时，将错误信息返回给 Claude，让 AI 自然地处理：

```typescript
// 工具失败时返回给 Claude 的消息
{
  role: "tool",
  tool_use_id: toolCallId,
  content: JSON.stringify({
    success: false,
    error: "目标物品不存在于背包中"
  })
}

// Claude 会自然地回复玩家：
// "你翻找了一下背包，似乎没有这个物品...要不检查一下背包？"
```

---

## 十、性能优化

### 10.1 Token 预算管理

| 组成部分 | Token 预算 | 说明 |
|----------|-----------|------|
| System Prompt | ~1500 | 固定，包含核心指令 |
| 玩家状态注入 | ~500 | 每次刷新 |
| 对话历史 | ~2000 | 滑动窗口，最近10-15条 |
| 当前消息 | ~100 | 玩家输入 |
| 工具定义 | ~1500 | 15个工具的Schema |
| **输出预留** | **~2000** | AI回复 + Tool Calls |
| **总计** | **~7600** | 使用 claude-sonnet 足够 |

### 10.2 优化策略

| 策略 | 说明 |
|------|------|
| **对话窗口滑动** | 只保留最近15条消息，更早的压缩为摘要 |
| **工具结果压缩** | 工具返回的详细数据在保存时压缩为摘要 |
| **条件加载工具** | 非战斗状态不加载战斗相关工具定义 |
| **状态懒加载** | 只在需要时获取完整玩家状态 |
| **SSE 流式** | 流式输出减少用户等待感知 |

---

> 本文档定义了 ChaosSaga 的 AI Game Master 完整系统设计，包含系统架构、System Prompt、15个 Function Calling 工具定义、上下文管理、SSE流式传输、非标准效果系统、容错策略和性能优化。
