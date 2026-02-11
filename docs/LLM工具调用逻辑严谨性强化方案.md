# 项目架构探索报告
1. 项目目录结构概览
chaossaga/├── src/│   ├── app/│   │   ├── api/│   │   │   ├── game/chat/route.ts          # 核心 LLM 调用入口│   │   │   ├── player/                      # 玩家数据 API│   │   │   ├── areas/route.ts              # 区域查询│   │   │   └── settings/route.ts           # 配置管理│   │   └── game/page.tsx                    # 游戏主界面│   ├── lib/│   │   ├── ai/│   │   │   ├── adapters/                   # LLM 适配器（OpenAI/Anthropic/Google）│   │   │   ├── tools/                       # Tool 定义和执行│   │   │   ├── gamemaster.ts                # Game Master 核心逻辑│   │   │   ├── llm-client.ts               # 统一 LLM 客户端│   │   │   ├── system-prompt.ts             # 系统 Prompt 定义│   │   │   ├── context-builder.ts           # 上下文组装器│   │   │   └── config.ts                    # LLM 配置管理│   │   ├── db/prisma.ts                     # Prisma 客户端│   │   └── game/                            # 游戏逻辑引擎│   ├── components/                          # React 组件│   ├── hooks/│   │   └── useGameChat.ts                   # 游戏聊天 Hook│   └── store/│       └── gameStore.ts                     # Zustand 状态管理├── prisma/│   └── schema.prisma                        # 数据库 Schema└── docs/                                    # 设计文档
2. LLM 调用链完整流程
2.1 入口：API 路由
文件: src/app/api/game/chat/route.ts
POST /api/game/chat  ↓processGameMessage({ playerId, message })  ↓返回 SSE Response
2.2 核心处理：Game Master
文件: src/lib/ai/gamemaster.ts
流程：
准备阶段（Preparing）
加载 LLM 配置（getLLMConfig()）
构建游戏上下文（buildGameContext()）
组装 System Prompt + Context Injection
构建消息列表（历史 + 当前消息）
思考阶段（Thinking）
发送 "thinking" 事件给前端
启动心跳保活（每 8 秒）
LLM 调用阶段
调用 client.chatStreamWithTools()
传入工具集（战斗模式：BATTLE_TOOLS，探索模式：EXPLORATION_TOOLS）
流式接收文本和工具调用事件
工具执行循环
   AI 输出文本 → 检测到 tool_call_start     ↓   暂停文本流     ↓   收集完整 tool_call_end（含参数）     ↓   执行 executeToolCall(name, args, playerId)     ↓   工具返回结果（JSON）     ↓   将结果追加到消息历史     ↓   AI 继续生成（基于工具结果）
文本缓冲（战斗模式）
启用 50 字符缓冲区
如果 AI 输出短文本后立即调工具 → 丢弃缓冲区（视为"起手式幻觉"）
如果输出长文本 → 正常输出
后处理
提取快捷按钮（extractActions()）
保存对话历史到数据库
发送 "done" 事件
2.3 LLM 客户端层
文件: src/lib/ai/llm-client.ts
统一接口：LLMClient 类
自动路由：根据模型名选择适配器（OpenAI/Anthropic/Google）
工具循环：chatStreamWithTools() 自动处理递归调用
2.4 适配器层
文件: src/lib/ai/adapters/
openai-adapter.ts: OpenAI 格式（GPT 系列）
anthropic-adapter.ts: Claude 格式
google-adapter.ts: Gemini 格式
统一事件流：StreamEvent 类型
3. 当前定义的 Tools/Functions
3.1 查询类工具（Query Tools）
文件: src/lib/ai/tools/query-tools.ts
get_battle_state: 获取战斗状态
已移除（通过 Context Injection 注入）：
get_player_state
get_area_info
3.2 行动类工具（Action Tools）
文件: src/lib/ai/tools/action-tools.ts
start_battle: 发起战斗
execute_battle_action: 执行战斗行动（核心）
use_item: 使用物品（消耗品/装备）
interact_npc: NPC 交互（对话/购买/出售/治疗/训练）
已移除：
move_to_node（改为 UI 驱动：/api/player/move）
3.3 生成类工具（Generate Tools）
文件: src/lib/ai/tools/generate-tools.ts
generate_area: 生成区域（5-8 个节点）
create_quest: 创建任务
update_quest: 更新任务进度
3.4 修改类工具（Modify Tools）
文件: src/lib/ai/tools/modify-tools.ts
modify_player_data: 直接修改玩家数据（GM 模式）
add_item: 添加物品到背包
3.5 工具集切换
文件: src/lib/ai/tools/index.ts
BATTLE_TOOLS: 战斗模式（仅 3 个工具）
execute_battle_action
use_item
get_battle_state
EXPLORATION_TOOLS: 探索模式（完整工具集 - execute_battle_action）
4. Prompt 中如何指导 LLM 使用 Tool
4.1 核心原则（System Prompt）
文件: src/lib/ai/system-prompt.ts
【⚠️ 绝对不可违背的行动准则 (CRITICAL PROTOCOL)】**你只是游戏引擎的接口，绝不是游戏引擎本身！**❌ **严禁脑补数值变化**：你不能通过写文字来改变玩家的 HP、MP、金币、物品数量或任务状态。✅ **必须调用工具**：任何涉及数值或状态的变化，**必须**调用相应的工具。
4.2 战斗模式特殊规则
【⚠️ 绝对核心原则】- **任何** 战斗动作**必须**触发 `execute_battle_action` 工具调用- **严禁** 在没有调用工具的情况下直接描述战斗结果- **严禁** 仅仅因为上一轮调用过工具就认为这一轮可以省略【思考流】1. 收到玩家指令 "水弹术"2. **🤫 闭嘴！(SHUT UP!)**：绝对不要输出 "你准备施放..." 这种废话3. **直接调用工具** `execute_battle_action(type='skill', skillName='水弹术')`4. 等待工具返回结果5. **只有在获得工具结果后**，才开始撰写叙事
4.3 探索模式规则
- "打这个怪" → 调用 start_battle- "买点药水" → 调用 interact_npc (商店NPC)- NPC请求帮忙时 → 调用 create_quest- 玩家完成目标时 → 调用 update_quest- **严禁只口头答应任务而不调用工具**
5. 数据入库机制
5.1 通过 Tool 执行入库
所有数据变更都通过工具执行：
战斗数据
execute_battle_action → 更新 BattleState 表
胜利奖励 → 更新 Player（exp/gold/level）
掉落物品 → 创建 InventoryItem 或 PlayerSkill
物品使用
use_item → 更新 Player（hp/mp）
消耗品 → 删除或减少 InventoryItem.quantity
装备 → 更新 InventoryItem.equipped
NPC 交互
interact_npc (buy) → 扣除 Player.gold，创建 InventoryItem
interact_npc (sell) → 增加 Player.gold，删除 InventoryItem
任务系统
create_quest → 创建 Quest + PlayerQuest
update_quest → 更新 PlayerQuest.progress
完成时 → 发放奖励（更新 Player + 创建 InventoryItem）
区域生成
generate_area → 创建 Area + AreaNode + AreaNodeConnection
更新 Player.currentAreaId / currentNodeId
5.2 对话历史入库
文件: src/lib/ai/gamemaster.ts (第 45-60 行)
async function saveChatHistory(  playerId: string,  role: string,  content: string,  metadata?: Record<string, unknown>): Promise<void>
用户消息：在第一次尝试时保存
AI 消息：在流结束后保存（fullText）
5.3 状态更新通知
工具执行后返回 stateUpdate：
return {  success: true,  data: {...},  stateUpdate: { hp: 80, mp: 50, gold: 200 }  // 前端自动更新}
通过 SSE 事件 state_update 发送给前端。
6. 防止 LLM 编造数据的机制
6.1 Prompt 层面的强制约束
明确的禁止指令
   ❌ **严禁脑补数值变化**   ❌ **严禁编造工具执行结果**   ❌ **严禁**在没有调用工具的情况下直接描述战斗结果
正确的思考模式示例
   ✅ 正确思维："玩家想喝药水 → 这会改变 HP 和 物品数量 →       我必须调用 `use_item` 工具 → 等待工具返回结果 →       根据结果描述'你喝下了药水，伤口愈合了'。"
战斗模式"闭嘴"指令
   **🤫 闭嘴！(SHUT UP!)**：绝对不要输出 "你准备施放..."    这种废话。直接调用工具。
6.2 代码层面的防护
文本缓冲机制（战斗模式）
文件: src/lib/ai/gamemaster.ts (第 275-362 行)
   let textBuffer = "";   let isBuffering = isBattle; // 仅在战斗模式下启用   const BUFFER_LIMIT = 50;      // 如果 AI 输出短文本后立即调工具 → 丢弃缓冲区   if (isBuffering && event.type === "tool_call_start") {     console.log(`丢弃起手式文本: "${textBuffer}"`);     textBuffer = "";   }
目的：丢弃 AI 在调用工具前输出的"起手式"文本（如"你挥剑..."），避免幻觉。
工具集限制
战斗模式：仅提供 3 个工具（减少幻觉）
探索模式：完整工具集（但不包含 execute_battle_action）
工具执行结果验证
所有工具返回 { success: boolean, data?, error? }
AI 必须基于真实结果撰写叙事
工具执行失败会返回错误信息
6.3 数据库层面的保证
所有数值变更都通过 Prisma 直接写入数据库
工具执行是唯一的数据修改入口
对话历史独立存储，不参与游戏逻辑
6.4 潜在问题线索
文本缓冲可能误判
如果 AI 输出 51 字符后调工具，缓冲区会被输出
如果 AI 输出 49 字符后调工具，缓冲区会被丢弃
阈值（50 字符）可能不够精确
Prompt 依赖性强
主要依赖 Prompt 约束，没有代码层面的强制检查
如果 LLM 忽略指令，仍可能编造数据
工具参数验证不足
部分工具只做基本类型检查
没有验证参数合理性（如伤害值是否合理）
重试机制可能重复执行
如果工具已执行但 LLM 连接断开，重试可能重复执行
代码中有 hasSentRealData 标志，但可能不够完善
总结
架构特点：
清晰的工具调用链：API → Game Master → LLM Client → Adapter → LLM
工具执行是唯一的数据修改入口
流式 SSE 实时反馈
上下文注入优化（减少工具调用）
防护机制：
Prompt 层面的强制约束
战斗模式文本缓冲
工具集动态切换
数据库层面的保证
潜在风险：
主要依赖 Prompt，缺少代码层面的强制检查
文本缓冲阈值可能不够精确
重试机制可能重复执行工具
建议改进方向：
增加工具执行前的参数合理性验证
增加工具执行后的结果验证（如检查数据库是否真的更新）
考虑增加"工具调用日志"，便于追踪和调试
优化文本缓冲逻辑，使用更智能的检测方法

# 问题诊断
从截图和代码分析，核心问题是：LLM 在探索模式下，对于"NPC 赠予物品、交易物品、获得奖励"等场景，经常直接在文本中写出"获得 XXX"而不调用 add_item / interact_npc 工具，导致数据库无变更，玩家实际没有获得物品。
当前防护手段仅有：
Prompt 层：文字警告"严禁脑补数值变化"
代码层：战斗模式的文本缓冲（仅战斗有效）
这两者对探索模式的保护几乎为零。
方案：多层防护体系
我提出 4 层防护，从根因到补救逐层递进：
第 1 层：输出后审计（Post-Output Audit）— 最关键
在 LLM 输出完成后、发送 done 事件前，对 fullText 做正则扫描，检测是否包含"编造了数据变更"的迹象。
检测模式：
【背包更新】、获得：、获得了、失去了
HP恢复、MP恢复、金币+、经验+
装备了、学会了技能
任务完成、任务接取
处理逻辑：
如果本轮 没有任何 tool 被调用，但文本中出现了上述模式 → 拦截并补救
补救方式：自动追加一轮 LLM 调用，强制要求调用工具；或者直接将编造的文本标记为"待确认"
第 2 层：工具调用强制模式（Tool Enforcement）
在探索模式下，对特定意图的消息启用 "must-use-tool" 模式：在发送给 LLM 之前，先用轻量检测判断玩家意图是否涉及状态变更（买东西、使用物品、接任务、NPC 交互等），如果是，则在 system prompt 末尾追加一条 强化指令，并在输出完成后验证是否真的调用了工具。
第 3 层：结构化输出约束（Structured Output Gate）
对于明确的交易/获取场景，不让 LLM 自由发挥，而是将流程拆分为：
LLM 决定意图 → 调用 tool
Tool 返回结果
LLM 基于结果撰写叙事
通过在 prompt 中更明确地用 "先工具后叙事"的 CoT 模板 引导。
第 4 层：前端校验层（UI Warning）
前端在收到文本中检测到"获得物品"类信息、但没有收到 state_update 事件时，显示一个小提示："数据可能未同步"。
下面我来实现第 1 层（输出审计 + 自动补救）和第 2 层（工具强制模式），这两层是最核心的。你觉得这个方向对吗？还是你想先讨论更多再动手？
有几个问题想先确认：
补救策略选择：当检测到 LLM 编造数据时，你倾向于：
A：自动发起一轮新的 LLM 调用，让它"纠正"并调用工具（增加延迟和成本）
B：直接用正则从文本中提取"获得 XXX"并自动调用 add_item（可能不够准确但即时生效）
C：在对话中插入一条系统提示"[系统：上述物品变更未入库，请手动确认]"，不自动修复
误检容忍度：审计可能会误判纯叙事文本（如 NPC 口头说"我给你一条鱼"但实际是剧情推进），你倾向于宁可多拦截还是宁可少拦截？
是否需要把战斗模式的"文本缓冲"机制也扩展到探索模式？目前只有战斗模式会丢弃"起手式"文本。