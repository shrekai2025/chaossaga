/**
 * ChaosSaga - AI Game Master 核心模块
 *
 * 职责：
 * 1. 组装上下文（玩家状态 + 对话历史 + System Prompt）
 * 2. 调用 LLM（通过统一客户端，非流式）
 * 3. 处理 Function Calling 循环（AI → tool → result → AI）
 * 4. SSE 输出给前端
 */

import { LLMClient } from "./llm-client";
import { getLLMConfig } from "./config";
import {
  getSystemPrompt,
  buildContextInjection,
} from "./system-prompt";
import { BATTLE_TOOLS, EXPLORATION_TOOLS, GM_TOOLS, executeToolCall } from "./tools";
import { buildGameContext } from "./context-builder";
import { prisma } from "@/lib/db/prisma";
import {
  StreamingJSONParser,
  parseAsPlainText,
  type StructuredResponse
} from "./structured-response";

/** Game Master 上下文 */
interface GameMasterContext {
  playerId: string;
  message?: string;
}

/** SSE 输出事件（传给前端） */
export type GameSSEEvent =
  | { type: "text"; data: { content: string } }
  | { type: "preparing"; data: { message: string } }
  | { type: "thinking"; data: { message: string } }
  | { type: "tool_call"; data: { tool: string } }
  | { type: "tool_result"; data: { tool: string; success: boolean } }
  | { type: "state_update"; data: Record<string, unknown> }
  | {
      type: "actions";
      data: { actions: Array<{ label: string; value: string }> };
    }
  | { type: "error"; data: { message: string } }
  | { type: "done"; data: Record<string, unknown> };

/**
 * 保存对话记录
 */
async function saveChatHistory(
  playerId: string,
  role: string,
  content: string,
  metadata?: Record<string, unknown>
): Promise<void> {
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

/** SSE 编码辅助 */
function sseEncode(event: GameSSEEvent): string {
  return `data: ${JSON.stringify(event)}\n\n`;
}

/**
 * Game Master 消息处理
 *
 * 使用非流式 LLM 调用 + SSE 传输。
 * 返回 Response 对象，直接用于 API 路由。
 */
export async function processGameMessage(
  ctx: GameMasterContext
): Promise<Response> {
  const encoder = new TextEncoder();

  // 使用 TransformStream 实现 SSE
  const { readable, writable } = new TransformStream();
  const writer = writable.getWriter();

  // 辅助：写入 SSE 事件
  async function send(event: GameSSEEvent) {
    await writer.write(encoder.encode(sseEncode(event)));
  }

  // 后台处理逻辑（不阻塞 Response 返回）
  const process = async () => {
    const startTime = Date.now();
    const msgPreview = ctx.message ? `"${ctx.message.slice(0, 50)}..."` : "(System Trigger)";
    console.log(`[GameMaster] 开始处理消息: ${msgPreview}`);
    
    // 重试逻辑
    const MAX_RETRIES = 3;
    let hasSentRealData = false; // 是否已发送真实数据（如果已经发送了文本，就不能重试了，否则前端会重复）

    try {
      for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
        try {
          if (attempt > 1) {
            console.log(`[GameMaster] 第 ${attempt} 次尝试重试...`);
          }

          // 阶段 1: 整理数据 (Preparing)
          await send({ type: "preparing", data: { message: "正在整理记忆与状态..." } });

          // 1. 加载配置
          console.log(`[GameMaster] 步骤1: 加载 LLM 配置...`);
          const config = await getLLMConfig();
          console.log(`[GameMaster] 使用模型: ${config.model}`);
          const client = new LLMClient(config);

          // 2. 通过 context-builder 一次性加载完整游戏上下文
          console.log(`[GameMaster] 步骤2: 构建游戏上下文...`);

          // 预检测战斗状态（轻量查询），以便跳过探索模式专属查询
          const activeBattle = await prisma.battleState.findUnique({
            where: { playerId: ctx.playerId },
            select: { status: true },
          });
          const isBattle = activeBattle?.status === "active";
          const isGM = !isBattle && ctx.message?.trim().toLowerCase().startsWith("/gm");

          const gameCtx = await buildGameContext(ctx.playerId, isBattle);

          const contextInjection = buildContextInjection({
            playerState: gameCtx.playerState,
            areaInfo: gameCtx.areaInfo,
            activeQuests: gameCtx.activeQuests,
            activeBattle: gameCtx.activeBattle,
            specialEffects: gameCtx.specialEffects,
          });

          const systemPrompt =
            getSystemPrompt(isBattle, isGM) + "\n" + contextInjection;

          // 3. 构建消息列表（历史 + 当前消息）
          console.log(`[GameMaster] 步骤3: 构建消息列表 (历史: ${gameCtx.history.length} 条)`);
          const messages = [...gameCtx.history];
          if (ctx.message) {
            // [Optimization] 战斗模式下注入强提示，防止 AI 先输出一大段废话再调工具
            const suffix = isBattle 
              ? "\n\n(系统强指令：立即调用 execute_battle_action 工具，严禁在工具调用前输出任何剧情文本)"
              : "";
            messages.push({ role: "user" as const, content: ctx.message + suffix });
          }

          // 4. 保存用户消息（仅当存在且为第一次尝试时）
          if (attempt === 1 && ctx.message) {
            console.log(`[GameMaster] 步骤4: 保存用户消息...`);
            // 注意：保存原始消息到数据库，不要包含系统指令后缀，以免污染用户看到的记录
            await saveChatHistory(ctx.playerId, "user", ctx.message);
          } else if (!ctx.message) {
            console.log(`[GameMaster] 步骤4: 跳过保存用户消息 (System Trigger)`);
          }

          // 阶段 2: AI 思考中 (Thinking)
          await send({ type: "thinking", data: { message: "Game Master 正在思考..." } });

          // 5. 流式调用 LLM（带工具循环）
          console.log(`[GameMaster] 步骤5: 开始调用 LLM API...`);

          let fullText = "";

          // 心跳保活：每 8 秒发一个 thinking 事件
          let heartbeatCount = 0;
          const heartbeat = setInterval(async () => {
            heartbeatCount++;
            const elapsed = Math.round((Date.now() - startTime) / 1000);
            try {
              const dots = ".".repeat((heartbeatCount % 3) + 1);
              console.log(`[GameMaster] 心跳 #${heartbeatCount} (已用时 ${elapsed}s)`);
              await send({
                type: "thinking",
                data: { message: `AI 正在思考${dots} (${elapsed}s)` },
              });
            } catch {
              clearInterval(heartbeat);
            }
          }, 8000);

          // ---- Audit & Remediation Loop ----
          let remainingRetries = 1; 
          const collectedTools = new Set<string>();
          
          const toolExecutor = async (
            name: string,
            args: Record<string, unknown>
          ): Promise<string> => {
            console.log(`[GameMaster] 执行工具: ${name}`, JSON.stringify(args).slice(0, 300));
            collectedTools.add(name); 
            
            hasSentRealData = true; 
            await send({ type: "tool_call", data: { tool: name } });

            const result = await executeToolCall(name, args, ctx.playerId);
            console.log(`[GameMaster] 工具执行完成: ${name}, 成功: ${result.success}${result.error ? ', 错误: ' + result.error : ''}`);

            if (result.stateUpdate) {
              await send({ type: "state_update", data: result.stateUpdate });
            }

            await send({
              type: "tool_result",
              data: { tool: name, success: result.success },
            });

            return JSON.stringify(result);
          };


          // 变量用于跨循环保存元数据
          let debugMetadata: Record<string, unknown> | undefined;

          try {
              // We wrap the generation in a loop to allow for self-correction
              while (remainingRetries >= 0) {
                 // 🆕 初始化 JSON 解析器
                 const jsonParser = new StreamingJSONParser();
                 let lastNarrativeLength = 0;

                 let textBuffer = "";
                 let isBuffering = true; // Enable buffering for ALL modes
                 const BUFFER_LIMIT = 120; // [Optimization] 增加缓冲区大小以捕获更长的起手式

                 // 🆕 工具集选择逻辑：
                 // - 战斗模式：使用 BATTLE_TOOLS
                 // - GM指令：仅当消息以 "/gm" 开头时，混合 EXPLORATION + GM 工具
                 // - 普通探索：仅使用 EXPLORATION_TOOLS
                 let tools = isBattle ? BATTLE_TOOLS : EXPLORATION_TOOLS;
                 
                 if (!isBattle && ctx.message?.trim().toLowerCase().startsWith("/gm")) {
                    tools = [...EXPLORATION_TOOLS, ...GM_TOOLS];
                    console.log("[GameMaster] 激活 GM 工具模式");
                 }

                 const stream = client.chatStreamWithTools(
                   {
                     model: config.model,
                     systemPrompt,
                     messages,
                     tools, // 使用动态选择的工具集
                     temperature: config.temperature,
                     maxTokens: config.maxTokens,
                   },
                   toolExecutor
                 );

                 let passText = "";
                 let rawJsonBuffer = ""; // 🆕 原始 JSON 文本缓冲区

                 for await (const event of stream) {
                   if (event.type === "text") {
                     const content = event.content;
                     rawJsonBuffer += content; // 🆕 累积原始 JSON

                     // 🆕 尝试解析 JSON 增量
                     const updates = jsonParser.append(content);

                     if (updates?.narrative) {
                       // 计算新增的叙事文本
                       const currentLength = updates.narrative.length;
                       if (currentLength > lastNarrativeLength) {
                         const newText = updates.narrative.slice(lastNarrativeLength);

                         if (isBuffering) {
                           textBuffer += newText;
                           if (textBuffer.length > BUFFER_LIMIT) {
                             await send({ type: "text", data: { content: textBuffer } });
                             passText += textBuffer;
                             fullText += textBuffer;
                             textBuffer = "";
                             isBuffering = false;
                             hasSentRealData = true; // 文本已发给前端，禁止整体重试
                           }
                         } else {
                           await send({ type: "text", data: { content: newText } });
                           passText += newText;
                           fullText += newText;
                           hasSentRealData = true; // 文本已发给前端，禁止整体重试
                         }

                         lastNarrativeLength = currentLength;
                       }
                     }

                     // 🆕 处理 thought 字段（可选显示）
                     if (updates?.thought) {
                       console.log(`[GameMaster] AI Thought: ${updates.thought}`);
                       // 可选：发送 thinking 事件显示给用户
                       // await send({ type: "thinking", data: { message: updates.thought } });
                     }

                   } else if ("type" in event && event.type === "tool_call_start") {
                     if (isBuffering) {
                       // [Optimization] 关键修复：检测到工具调用时，直接丢弃缓冲区内的"起手式"文本
                       // 这样用户就不会看到 "我准备攻击..." 这种废话
                       console.log(`[GameMaster] 检测到工具调用，清空起手式文本 (${textBuffer.length}字): "${textBuffer.slice(0, 20)}..."`);
                       textBuffer = "";
                       isBuffering = false;
                     } else {
                       console.log(`[GameMaster] 工具调用开始，已输出文本`);
                     }
                   } else if (event.type === "error") {
                     console.error("[GameMaster] 流式错误:", event.message);
                     throw new Error(event.message);
                   } else if (event.type === "done") {
                     if (textBuffer.length > 0) {
                        await send({ type: "text", data: { content: textBuffer } });
                        passText += textBuffer;
                        fullText += textBuffer;
                        textBuffer = "";
                        hasSentRealData = true;
                     }

                     if ("stopReason" in event && (event as any).stopReason === "max_tokens") {
                       console.warn("[GameMaster] 响应被 max_tokens 截断");
                     }
                   }
                 }

                 // 🆕 流结束后，尝试最终解析
                 const finalResponse = jsonParser.finalize();

                 // 保存调试元数据
                 debugMetadata = {
                    rawJson: rawJsonBuffer,
                    structured: finalResponse || null,
                    toolCalls: Array.from(collectedTools)
                 };

                 if (finalResponse) {
                   console.log(`[GameMaster] JSON 解析成功: narrative=${finalResponse.narrative.length}字, suggestions=${finalResponse.suggestions?.length || 0}个`);

                   // 发送 suggestions（如果有）
                   if (finalResponse.suggestions && finalResponse.suggestions.length > 0) {
                     await send({
                       type: "actions",
                       data: {
                         actions: finalResponse.suggestions.map(s => ({ label: s, value: s }))
                       }
                     });
                   }

                   // 使用解析后的 narrative 作为最终文本
                   fullText = finalResponse.narrative;
                 } else {
                   // 🆕 JSON 解析失败，回退到纯文本解析
                   console.warn(`[GameMaster] JSON 解析失败，使用纯文本回退。原始内容: ${rawJsonBuffer.slice(0, 200)}...`);

                   // 1. 先尝试通过正则提取 thought (作为备用)
                   let thoughtContent = null;
                   if (rawJsonBuffer) {
                      const match = rawJsonBuffer.match(/"thought"\s*:\s*"((?:[^"\\]|\\.)*)"/);
                      if (match) {
                          thoughtContent = match[1]; 
                      }
                   }

                   const fallback = parseAsPlainText(rawJsonBuffer || passText);
                   let fallbackText = fallback.narrative;

                   // 2. 检查 fallbackText 是否只是原始 JSON 字符串
                   // 如果 AI 输出了 {"thought": "..."} 但没输出 narrative，parseAsPlainText 会把整个 JSON 当作文本
                   const isRawJSON = fallbackText.trim().startsWith("{") && fallbackText.includes('"thought"');
                   
                   if (isRawJSON && thoughtContent) {
                       console.warn("[GameMaster] 检测到原始 JSON 文本，转换为 thought 显示");
                       fallbackText = `(AI 思考中: ${thoughtContent})`;
                   }

                   // 如果回退解析出了 suggestions，发送它们
                   if (fallback.suggestions && fallback.suggestions.length > 0) {
                     await send({
                       type: "actions",
                       data: {
                         actions: fallback.suggestions.map(s => ({ label: s, value: s }))
                       }
                     });
                   }

                   fullText = fallbackText;
                   
                   // 关键修复：必须将回退的文本发送给前端
                   if (fullText && fullText !== passText) {
                       await send({ type: "text", data: { content: fullText } });
                   } else if (!passText && fullText) {
                       await send({ type: "text", data: { content: fullText } });
                   }
                 }

                 // 🆕 [Fix] 如果最终文本为空（或者上面处理后仍为空），再次检查 thought
                 if (!fullText && finalResponse?.thought) {
                   const thoughtFallback = `(AI 思考中: ${finalResponse.thought})`;
                   console.warn("[GameMaster] 检测到 narrative 为空，使用 thought 回退 (Clean Path)");
                   await send({ type: "text", data: { content: thoughtFallback } });
                   fullText = thoughtFallback;
                 } else if (!fullText && collectedTools.size === 0) {
                     const emptyFallback = "...";
                     await send({ type: "text", data: { content: emptyFallback } });
                     fullText = emptyFallback;
                 }

                 // --- AUDIT PHASE ---
                 const { detectHallucinations } = await import("./hallucination-detector");
                 const audit = detectHallucinations(passText, Array.from(collectedTools), isBattle);

                 // 🆕 检测"思考瘫痪"状态：LLM 说要调用工具但实际没调用
                 const isThinkingParalysis =
                   remainingRetries < 1 && // 已经重试过至少一次
                   collectedTools.size === 0 && // 没有调用任何工具
                   passText.length < 50 && // 几乎没有生成叙事
                   finalResponse?.thought && // 但有 thought 字段
                   (finalResponse.thought.includes("调用") || finalResponse.thought.includes("工具") || finalResponse.thought.includes("tool"));

                 if (isThinkingParalysis) {
                    console.warn(`[GameMaster] ⚠️ 检测到思考瘫痪: LLM 说要调用工具但没有实际执行。强制要求执行...`);

                    await send({ type: "thinking", data: { message: "正在执行操作..." } });

                    messages.push({ role: "assistant", content: fullText });
                    messages.push({
                        role: "user",
                        content: `[CRITICAL ERROR] You said you need to call a tool, but you DID NOT actually call it. You MUST call the tool NOW. Do not just think about it - EXECUTE the tool call immediately.`
                    });

                    remainingRetries--;
                    continue;
                 }

                 if (audit.hasHallucination && remainingRetries > 0) {
                    console.warn(`[GameMaster] ⚠️ 检测到幻觉: ${audit.reason}。启动自我修正...`);

                    // Specific message for battle vs general
                    const fixMsg = isBattle
                      ? "正在核实战斗数据..."
                      : "正在核实道具入库...";

                    await send({ type: "thinking", data: { message: fixMsg } });

                    messages.push({ role: "assistant", content: passText });
                    messages.push({
                        role: "user",
                        content: `[SYSTEM ERROR] ATTENTION: You generated narrative describing a state change, but you DID NOT call the necessary tool. \nReason: ${audit.reason}\n\nREQUIRED ACTION: Immediately call the missing tool now. Do not repeat the narrative, just execute the tool.`
                    });

                    remainingRetries--;
                    continue;
                 } else {
                    break;
                 }
              }
          } finally {
              clearInterval(heartbeat);
          }

          // 6. 清理与保存
          // [Optimization] 防止空白回复：如果 AI 执行了工具但没有生成任何文本，自动补充系统提示
          if (!fullText.trim() && collectedTools.size > 0) {
             const fallback = `*（动作已执行: ${Array.from(collectedTools).join(", ")}）*`;
             await send({ type: "text", data: { content: fallback } });
             fullText = fallback;
          }

          // 7. 保存 AI 回复（独立重试，不影响 LLM 重试循环）
          if (fullText) {
            const DB_SAVE_RETRIES = 3;
            for (let dbAttempt = 1; dbAttempt <= DB_SAVE_RETRIES; dbAttempt++) {
              try {
                await saveChatHistory(ctx.playerId, "assistant", fullText, debugMetadata);
                break; // 保存成功
              } catch (dbErr) {
                console.error(`[GameMaster] 保存AI回复失败 (第${dbAttempt}/${DB_SAVE_RETRIES}次):`, dbErr);
                if (dbAttempt === DB_SAVE_RETRIES) {
                  console.error("[GameMaster] 保存AI回复最终失败，跳过保存（不影响前端显示）");
                } else {
                  await new Promise(r => setTimeout(r, 1000 * dbAttempt)); // 递增延迟重试
                }
              }
            }
          }

          // 8. 结束
          await send({ type: "done", data: {} });
          return; 

        } catch (error) {
          const isAbort =
            (error instanceof Error &&
              (error.name === "AbortError" ||
                error.name === "ResponseAborted" ||
                error.message.includes("ResponseAborted") ||
                error.message.includes("The operation was aborted"))) ||
            // 某些环境中 error 可能不是 Error 实例但具有类似结构
            (typeof error === "object" &&
              error !== null &&
              ((error as any).name === "AbortError" ||
                (error as any).name === "ResponseAborted"));

          if (isAbort) {
            console.log(`[GameMaster] 客户端断开连接，停止处理。`);
            return;
          }

          console.error(
            `[GameMaster] 第 ${attempt} 次执行出错: Name=${(error as Error).name}, Msg=${(error as Error).message}`,
            error
          );

          console.error(`[GameMaster] 第 ${attempt} 次执行出错:`, error);
          
          // 如果已经发送了真实数据，或者已经是最后一次尝试，则报告错误
          if (hasSentRealData || attempt === MAX_RETRIES) {
            try {
              await send({
                type: "error",
                data: {
                  message:
                    error instanceof Error
                      ? `AI 服务错误: ${error.message}`
                      : "（沉思片刻）冒险者，让我整理一下思绪...你可以继续告诉我你想做什么。",
                },
              });
              await send({ type: "done", data: {} });
            } catch {
              // writer 可能已关闭
            }
            return; // 结束处理
          }
          
          // 否则，等待 1 秒后重试
          await new Promise(r => setTimeout(r, 1000));
        }
      }
    } finally {
      // 确保流被关闭，防止连接泄漏
      try {
          await writer.close();
          console.log("[GameMaster] SSE流已关闭");
      } catch (e) {
          console.error("[GameMaster] 关闭流失败 (可能已关闭):", e);
      }
    }
  };

  // 启动后台处理（不 await，让 Response 立即返回）
  process();

  return new Response(readable, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
