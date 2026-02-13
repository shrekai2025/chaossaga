/**
 * /api/game/quick-action - 战斗极速动作接口（非流式）
 *
 * 仅用于视觉区快捷按钮的"直算战斗"模式：
 * 1) 直接执行传统战斗引擎（不经 LLM 决策）
 * 2) 用结构化数据构建高质量 fallback 叙事
 * 3) 尝试 LLM 润色（失败则用 fallback）
 * 4) 返回普通 JSON，前端写入 Chat
 */

import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { executeToolCall } from "@/lib/ai/tools";
import { getLLMConfig } from "@/lib/ai/config";
import { LLMClient } from "@/lib/ai/llm-client";

interface QuickActionPayload {
  type: "attack" | "skill";
  skillId?: string;
  targetIndex?: number;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type BattleData = Record<string, any>;

const QUICK_NARRATION_SYSTEM_PROMPT = `你是一个战斗旁白员，为修仙文字冒险游戏撰写战斗叙事。

你将收到一段结构化战斗摘要（中文文本），请把它改写成更有画面感的叙事。

【绝对规则】
- 只输出纯中文叙事文本，50-120字
- 严禁输出 JSON、代码、markdown
- 严禁输出 { } [ ] 等符号
- 必须忠实使用给定的数值（伤害、HP等），不得编造
- 如果战斗胜利，必须提及获得的经验和金币
- 语言简洁有力，注重动作感`;

async function saveChatHistory(
  playerId: string,
  role: "user" | "assistant",
  content: string,
  metadata?: Record<string, unknown>
) {
  await prisma.chatHistory.create({
    data: {
      playerId,
      role,
      content,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      metadata: (metadata ?? undefined) as any,
    },
  });
}

/**
 * 从结构化战斗数据构建完整的叙事文本（不依赖 LLM）
 */
function buildStructuredNarrative(data: BattleData): string {
  const parts: string[] = [];

  // summary 是 buildTurnSummary 生成的完整摘要
  const summary = data.summary as string | undefined;
  if (summary?.trim()) {
    parts.push(summary.trim());
  } else {
    // 没有 summary 时手动拼
    const pa = data.playerAction as BattleData | undefined;
    if (pa) {
      if (pa.type === "attack" || pa.type === "skill") {
        const skillPart = pa.skillName ? `使用${pa.skillName}` : "普通攻击";
        const critPart = pa.isCrit ? "（暴击！）" : "";
        parts.push(
          `你${skillPart}攻击${pa.targetName || "敌人"}，造成 ${pa.damage || 0} 点伤害${critPart}。` +
          (pa.isKill ? `${pa.targetName}被击败！` : `${pa.targetName}剩余HP ${pa.targetHpAfter}/${pa.targetMaxHp}。`)
        );
      } else if (pa.type === "defend") {
        parts.push("你采取防御姿态，本回合受伤减半。");
      } else if (pa.type === "item") {
        parts.push(`你使用${pa.itemName}，恢复HP ${pa.hpRestored || 0}/MP ${pa.mpRestored || 0}。`);
      }
    }

    const enemyActions = data.enemyActions as BattleData[] | undefined;
    if (enemyActions?.length) {
      for (const ea of enemyActions) {
        if (ea.phaseChange) parts.push(`⚠ ${ea.attackerName}进入新阶段：${ea.phaseChange}`);
        if (ea.type === "attack" || ea.type === "skill") {
          const eName = ea.skillName ? `使用${ea.skillName}` : "普通攻击";
          parts.push(`${ea.attackerName}${eName}攻击你，造成 ${ea.damage || 0} 点伤害。`);
        } else if (ea.type === "heal") {
          parts.push(`${ea.attackerName}恢复了 ${ea.healAmount || 0} 点HP。`);
        }
      }
    }
  }

  // 胜利奖励
  const status = data.battleStatus as string | undefined;
  const rewards = data.rewards as BattleData | undefined;
  if (status === "won" && rewards) {
    const rewardParts: string[] = [];
    if (rewards.exp) rewardParts.push(`${rewards.exp} 经验`);
    if (rewards.gold) rewardParts.push(`${rewards.gold} 金币`);
    const items = rewards.items as Array<{ name: string; quality?: string }> | undefined;
    if (items?.length) {
      rewardParts.push(items.map((i) => i.name).join("、"));
    }
    const levelUp = rewards.levelUp as { newLevel: number } | undefined;
    if (levelUp) rewardParts.push(`升级到 Lv.${levelUp.newLevel}！`);

    parts.push(`🎉 战斗胜利！获得${rewardParts.join("，")}。`);
  }

  // 失败惩罚
  const penalty = data.defeatPenalty as BattleData | undefined;
  if (status === "lost" && penalty) {
    parts.push(`💀 战斗失败！你昏迷后被救援，损失了 ${penalty.goldLost || 0} 金币。状态已恢复。`);
  }

  return parts.join("\n") || "动作已执行。";
}

/**
 * 清洗 LLM 响应：剥离 JSON 包裹、提取 narrative
 */
function sanitizeLLMResponse(raw: string): string | null {
  const trimmed = raw.trim();

  // 明显是 JSON → 尝试提取 narrative 字段
  if (trimmed.startsWith("{")) {
    try {
      const parsed = JSON.parse(trimmed);
      if (parsed.narrative && typeof parsed.narrative === "string" && parsed.narrative.trim().length > 5) {
        return parsed.narrative.trim();
      }
    } catch {
      // 不是合法 JSON，继续用正则
    }
    // 尝试正则提取 narrative
    const match = trimmed.match(/"narrative"\s*:\s*"((?:[^"\\]|\\.)*)"/);
    if (match?.[1] && match[1].length > 5) {
      return match[1].replace(/\\n/g, "\n").replace(/\\"/g, '"');
    }
    return null; // 无法提取，放弃
  }

  // 非 JSON：检查是否过短或无意义
  if (trimmed.length < 5) return null;

  return trimmed;
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const playerId = body.playerId as string | undefined;
    const userText = body.userText as string | undefined;
    const action = body.action as QuickActionPayload | undefined;

    if (!playerId || !userText || !action?.type) {
      return NextResponse.json(
        { success: false, error: "缺少必填参数：playerId, userText, action.type" },
        { status: 400 }
      );
    }

    if (!["attack", "skill"].includes(action.type)) {
      return NextResponse.json(
        { success: false, error: "该动作不支持极速模式" },
        { status: 400 }
      );
    }

    // 保存用户消息
    await saveChatHistory(playerId, "user", userText, { quickMode: true, action });

    // 执行战斗
    const toolArgs: Record<string, unknown> = {
      action: {
        type: action.type,
        skillId: action.skillId,
        targetIndex: action.targetIndex ?? 0,
      },
    };
    const toolResult = await executeToolCall("execute_battle_action", toolArgs, playerId);

    // 构建结构化 fallback 叙事（总是可用）
    let narrative: string;
    if (!toolResult.success) {
      narrative = `⚠️ ${toolResult.error || "动作执行失败"}`;
    } else {
      const structuredNarrative = buildStructuredNarrative(
        (toolResult.data ?? {}) as BattleData
      );

      // 尝试 LLM 润色（以结构化摘要为输入，非原始 JSON）
      let llmNarrative: string | null = null;
      try {
        const config = await getLLMConfig();
        const client = new LLMClient(config);
        const llm = await client.chat({
          model: config.model,
          systemPrompt: QUICK_NARRATION_SYSTEM_PROMPT,
          messages: [
            {
              role: "user",
              content: `请将以下战斗摘要改写为有画面感的叙事（严禁输出JSON）：\n\n${structuredNarrative}`,
            },
          ],
          temperature: 0.6,
          maxTokens: 300,
        });
        llmNarrative = sanitizeLLMResponse(llm.content || "");
      } catch (err) {
        console.warn("[quick-action] LLM 润色失败，使用结构化叙事:", err);
      }

      narrative = llmNarrative || structuredNarrative;
    }

    // 保存 AI 回复
    await saveChatHistory(playerId, "assistant", narrative, {
      quickMode: true,
      action,
      tool: "execute_battle_action",
      toolResult: { success: toolResult.success, error: toolResult.error },
    });

    // 检查战斗是否已结束（用于前端立即切换状态）
    const battleCheck = await prisma.battleState.findUnique({
      where: { playerId },
      select: { status: true },
    });
    const isBattleActive = battleCheck?.status === "active";

    return NextResponse.json({
      success: toolResult.success,
      narrative,
      isBattle: isBattleActive,
      toolResult: {
        success: toolResult.success,
        data: toolResult.data,
        error: toolResult.error,
        stateUpdate: toolResult.stateUpdate,
      },
    });
  } catch (error) {
    console.error("[quick-action] 极速战斗执行失败:", error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "极速战斗执行失败",
      },
      { status: 500 }
    );
  }
}
