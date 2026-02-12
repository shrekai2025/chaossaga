/**
 * ChaosSaga - 工具注册表 & 分发器
 *
 * 汇总所有 15 个工具定义（标准化格式），并提供统一的执行分发。
 * 适配器层会将 NormalizedTool 转换为供应商特定格式。
 */

import type { NormalizedTool } from "../adapters/types";

// 工具定义
import { queryToolDefinitions } from "./query-tools";
import { actionToolDefinitions } from "./action-tools";
import { generateToolDefinitions } from "./generate-tools";
import { modifyToolDefinitions } from "./modify-tools";

// 工具执行函数
import { getBattleState } from "./query-tools";
import {
  startBattle,
  executeBattleAction,
  useItem,
  interactNpc,
} from "./action-tools";
import { generateArea, createQuest, updateQuest } from "./generate-tools";
import { modifyPlayerData, addItem, abandonQuest } from "./modify-tools";

// ============================================================
// 工具定义导出（传给 LLM 的 tools 参数）
// ============================================================

/** 所有工具定义（标准化格式） */
export const ALL_TOOLS: NormalizedTool[] = [
  ...queryToolDefinitions,
  ...actionToolDefinitions,
  ...generateToolDefinitions,
  ...modifyToolDefinitions,
];

/** 战斗模式专用工具集 (精简工具列表以减少幻觉) */
export const BATTLE_TOOLS: NormalizedTool[] = ALL_TOOLS.filter((t) =>
  [
    "execute_battle_action", // 核心战斗
    "use_item",              // 喝药
    "get_battle_state",      // 查询状态
    "add_item",              // 战斗胜利奖励/掉落
    "create_quest",          // 战斗触发任务
    "update_quest",          // 战斗完成任务目标
  ].includes(t.name)
);

/** GM 工具集 (仅限 /gm 指令或特殊情况调用) */
export const GM_TOOLS: NormalizedTool[] = ALL_TOOLS.filter((t) =>
  [
    "modify_player_data",
    "add_item",
    "generate_area",
    "abandon_quest"
  ].includes(t.name)
);

/** 探索模式工具集 (标准游戏交互，不含 GM 工具) */
export const EXPLORATION_TOOLS: NormalizedTool[] = ALL_TOOLS.filter(
  (t) => 
    t.name !== "execute_battle_action" && // 排除战斗工具
    !GM_TOOLS.some(gm => gm.name === t.name) // 排除 GM 工具
);

// ============================================================
// 工具执行分发
// ============================================================

/** 工具执行结果标准格式 */
export interface ToolExecutionResult {
  success: boolean;
  data?: unknown;
  error?: string;
  stateUpdate?: Record<string, unknown>;
}

/** 工具执行器映射 */
const TOOL_HANDLERS: Record<
  string,
  (args: Record<string, unknown>, playerId: string) => Promise<ToolExecutionResult>
> = {
  // 查询类
  // get_player_state: removed (已通过 context injection 注入)
  // get_area_info: removed (已通过 context injection 注入)
  get_battle_state: getBattleState,
  // 行动类
  start_battle: startBattle,
  execute_battle_action: executeBattleAction,
  use_item: useItem,
  // move_to_node: removed (now UI-driven via /api/player/move)
  interact_npc: interactNpc,
  // enhance_equipment: removed (unimplemented stub)
  // 生成类
  generate_area: generateArea,
  create_quest: createQuest,
  update_quest: updateQuest,
  // 修改类
  modify_player_data: modifyPlayerData,
  add_item: addItem,
  abandon_quest: abandonQuest, // New GM tool
  // send_narrative: removed (LLM outputs text directly)
};

/**
 * 执行工具调用
 *
 * @param name 工具名称
 * @param args 工具参数（由 AI 提供）
 * @param playerId 当前玩家 ID
 * @returns 执行结果（JSON.stringify 后返回给 AI）
 */
export async function executeToolCall(
  name: string,
  args: Record<string, unknown>,
  playerId: string
): Promise<ToolExecutionResult> {
  const handler = TOOL_HANDLERS[name];

  if (!handler) {
    return { success: false, error: `未知工具: ${name}` };
  }

  try {
    const result = await handler(args, playerId);
    return result;
  } catch (error) {
    console.error(`工具执行失败 [${name}]:`, error);
    return {
      success: false,
      error: `工具执行失败: ${error instanceof Error ? error.message : "未知错误"}`,
    };
  }
}
