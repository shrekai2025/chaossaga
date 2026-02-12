/**
 * OpenAI 格式适配器
 *
 * 使用原生 fetch 调用 Tuzi API 的 OpenAI 兼容端点 (/v1/chat/completions)。
 * 严格只发送 Tuzi API 文档中列出的参数，避免 SDK 添加额外字段。
 *
 * 支持的模型：GPT、Gemini、Grok 系列。
 */

import type {
  LLMAdapter,
  LLMConfig,
  LLMRequest,
  LLMResponse,
  NormalizedMessage,
  NormalizedTool,
  StreamEvent,
  ToolCall,
  ToolResult,
} from "./types";

// ============================================================
// 格式转换
// ============================================================

/** 消息格式 */
interface OpenAIMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  tool_calls?: Array<{
    id: string;
    type: "function";
    function: { name: string; arguments: string };
  }>;
  tool_call_id?: string;
}

/** 工具格式 */
interface OpenAITool {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

/** 将标准化工具定义转换为 OpenAI 格式 */
function toOpenAITools(tools: NormalizedTool[]): OpenAITool[] {
  return tools.map((tool) => ({
    type: "function" as const,
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters as Record<string, unknown>,
    },
  }));
}

/** 将标准化消息转换为 OpenAI 格式 */
function toOpenAIMessages(
  systemPrompt: string,
  messages: NormalizedMessage[]
): OpenAIMessage[] {
  const result: OpenAIMessage[] = [];

  if (systemPrompt) {
    result.push({ role: "system", content: systemPrompt });
  }

  for (const msg of messages) {
    switch (msg.role) {
      case "system":
        result.push({ role: "system", content: msg.content });
        break;
      case "user":
        result.push({ role: "user", content: msg.content });
        break;
      case "assistant":
        if (msg.toolCalls && msg.toolCalls.length > 0) {
          result.push({
            role: "assistant",
            content: msg.content || null,
            tool_calls: msg.toolCalls.map((tc) => ({
              id: tc.id,
              type: "function" as const,
              function: {
                name: tc.name,
                arguments: JSON.stringify(tc.arguments),
              },
            })),
          });
        } else {
          result.push({ role: "assistant", content: msg.content });
        }
        break;
      case "tool_result":
        result.push({
          role: "tool",
          tool_call_id: msg.toolCallId!,
          content: msg.content,
        });
        break;
    }
  }

  return result;
}

// ============================================================
// Tuzi API 请求体（严格按照文档）
// ============================================================

interface TuziRequestBody {
  model: string;
  messages: OpenAIMessage[];
  temperature?: number;
  max_tokens?: number;
  stream?: boolean;
  tools?: OpenAITool[];
  tool_choice?: string;
  response_format?: { type: "json_object" | "text" };
}

// ============================================================
// 响应类型
// ============================================================

interface TuziChoice {
  index: number;
  message: {
    role: string;
    content: string | null;
    tool_calls?: Array<{
      id: string;
      type: string;
      function: { name: string; arguments: string };
    }>;
  };
  finish_reason: string;
}

interface TuziResponse {
  id: string;
  object: string;
  created: number;
  model: string;
  choices: TuziChoice[];
  usage: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

// ============================================================
// 适配器实现
// ============================================================

export class OpenAIAdapter implements LLMAdapter {
  /** 非流式调用 - 使用原生 fetch，严格控制请求参数 */
  async chat(request: LLMRequest, config: LLMConfig): Promise<LLMResponse> {
    const url = `${config.baseUrl}/v1/chat/completions`;

    // 严格按照 Tuzi API 文档构建请求体
    const body: TuziRequestBody = {
      model: request.model,
      messages: toOpenAIMessages(request.systemPrompt, request.messages),
      temperature: request.temperature ?? config.temperature,
      max_tokens: request.maxTokens ?? config.maxTokens,
      stream: false,
      response_format: { type: "json_object" }, // 强制 JSON 输出
    };

    // 只在有工具时才添加 tools 和 tool_choice
    if (request.tools && request.tools.length > 0) {
      body.tools = toOpenAITools(request.tools);
      body.tool_choice = "auto";
    }

    // 使用 AbortController 实现超时
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 180_000); // 180秒

    const bodyStr = JSON.stringify(body);
    const startTime = Date.now();
    console.log(`[Tuzi API] chat 请求: model=${request.model}, url=${url}, bodySize=${bodyStr.length} bytes, msgCount=${body.messages.length}`);

    try {
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
          Authorization: `Bearer ${config.apiKey}`,
          ...(config.extraHeaders || {}),
        },
        body: bodyStr,
        signal: controller.signal,
      });

      const elapsed = Date.now() - startTime;
      console.log(`[Tuzi API] chat 响应: status=${res.status}, elapsed=${elapsed}ms`);

      if (!res.ok) {
        const errorText = await res.text();
        console.error("[Tuzi API] 错误响应:", res.status, errorText);
        throw new Error(
          `Tuzi API 错误 (${res.status}): ${errorText.slice(0, 200)}`
        );
      }

      const data: TuziResponse = await res.json();
      const choice = data.choices[0];
      const toolCalls = extractToolCalls(choice);

      const totalElapsed = Date.now() - startTime;
      console.log(
        `[Tuzi API] chat 完成: model=${request.model}, ` +
        `inputTokens=${data.usage?.prompt_tokens ?? "?"}, ` +
        `outputTokens=${data.usage?.completion_tokens ?? "?"}, ` +
        `finishReason=${choice?.finish_reason ?? "?"}, ` +
        `contentLen=${(choice?.message?.content ?? "").length}, ` +
        `totalTime=${totalElapsed}ms`
      );

      return {
        content: choice?.message?.content ?? "",
        toolCalls,
        usage: {
          inputTokens: data.usage?.prompt_tokens ?? 0,
          outputTokens: data.usage?.completion_tokens ?? 0,
        },
        stopReason:
          choice?.finish_reason === "tool_calls"
            ? "tool_use"
            : choice?.finish_reason === "length"
              ? "max_tokens"
              : "end",
      };
    } finally {
      clearTimeout(timeout);
    }
  }

  /** 流式调用 - 使用原生 fetch + SSE 解析 */
  async *chatStream(
    request: LLMRequest,
    config: LLMConfig
  ): AsyncIterable<StreamEvent> {
    const url = `${config.baseUrl}/v1/chat/completions`;
    const startTime = Date.now();
    console.log(`[OpenAI Adapter] 开始流式请求: ${request.model}`);
    console.log(`[OpenAI Adapter] 消息数: ${request.messages.length}, 工具数: ${request.tools?.length || 0}`);

    const body: TuziRequestBody = {
      model: request.model,
      messages: toOpenAIMessages(request.systemPrompt, request.messages),
      temperature: request.temperature ?? config.temperature,
      max_tokens: request.maxTokens ?? config.maxTokens,
      stream: true,
      response_format: { type: "json_object" }, // 强制 JSON 输出
    };

    if (request.tools && request.tools.length > 0) {
      body.tools = toOpenAITools(request.tools);
      body.tool_choice = "auto";
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => {
      console.log(`[OpenAI Adapter] 请求超时 (180s), 正在中止...`);
      controller.abort();
    }, 180_000);

    try {
      console.log(`[OpenAI Adapter] 发送请求到 ${url}...`);
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "text/event-stream",
          Authorization: `Bearer ${config.apiKey}`,
          ...(config.extraHeaders || {}),
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      const elapsed = Date.now() - startTime;
      console.log(`[OpenAI Adapter] 收到响应: ${res.status} (耗时 ${elapsed}ms)`);

      if (!res.ok || !res.body) {
        const errorText = await res.text();
        console.error(`[OpenAI Adapter] 错误响应: ${res.status} ${errorText.slice(0, 200)}`);
        yield { type: "error", message: `Tuzi API 流式错误: ${res.status} ${errorText.slice(0, 200)}` };
        return;
      }

      console.log(`[OpenAI Adapter] 开始读取流式响应...`);

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      // 追踪进行中的 tool calls
      const pendingToolCalls: Map<
        number,
        { id: string; name: string; argsStr: string }
      > = new Map();

      let inputTokens = 0;
      let outputTokens = 0;
      let lastFinishReason: string | null = null;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || !trimmed.startsWith("data: ")) continue;
          const dataStr = trimmed.slice(6);
          if (dataStr === "[DONE]") continue;

          let chunk;
          try {
            chunk = JSON.parse(dataStr);
          } catch {
            continue;
          }

          const delta = chunk.choices?.[0]?.delta;
          const finishReason = chunk.choices?.[0]?.finish_reason;
          if (finishReason) lastFinishReason = finishReason;

          // 文本内容
          if (delta?.content) {
            yield { type: "text", content: delta.content };
          }

          // 工具调用
          if (delta?.tool_calls) {
            for (const tc of delta.tool_calls) {
              const idx = tc.index ?? 0;

              if (tc.id) {
                // Feature: kimi-k2.5 sends id in EVERY chunk. 
                // We must check if we're already tracking this id at this index.
                const existing = pendingToolCalls.get(idx);
                if (existing && existing.id === tc.id) {
                    // It's just a continuation with the same ID, treat as delta
                     if (tc.function?.arguments) {
                        existing.argsStr += tc.function.arguments;
                        yield {
                          type: "tool_call_args_delta",
                          id: existing.id,
                          argsDelta: tc.function.arguments,
                        };
                      }
                } else {
                    // It's truly a NEW tool call (or index collision / validation)
                    pendingToolCalls.set(idx, {
                      id: tc.id,
                      name: tc.function?.name ?? "",
                      argsStr: tc.function?.arguments ?? "",
                    });
                    // 只在有 name 时才发 tool_call_start，否则等后续 chunk 补上
                    if (tc.function?.name) {
                      yield {
                        type: "tool_call_start",
                        id: tc.id,
                        name: tc.function.name,
                      };
                    }
                }
              } else {
                const pending = pendingToolCalls.get(idx);
                if (pending) {
                  // 补充 name（有些模型在后续 chunk 中发送 name）
                  if (tc.function?.name && !pending.name) {
                    pending.name = tc.function.name;
                    yield {
                      type: "tool_call_start",
                      id: pending.id,
                      name: pending.name,
                    };
                  }
                  // 累积 args
                  if (tc.function?.arguments) {
                    pending.argsStr += tc.function.arguments;
                    yield {
                      type: "tool_call_args_delta",
                      id: pending.id,
                      argsDelta: tc.function.arguments,
                    };
                  }
                }
              }
            }
          }

          // 工具调用结束（兼容 finish_reason: "tool_calls" 和 "stop"）
          if (finishReason && pendingToolCalls.size > 0) {
            for (const [, tc] of pendingToolCalls) {
              // Fallback: some models (e.g. kimi-k2.5) put the name in the id field
              // Format: "functions.execute_battle_action:0" → extract "execute_battle_action"
              if (!tc.name && tc.id) {
                const idMatch = tc.id.match(/^functions\.([^:]+)/);
                if (idMatch) {
                  tc.name = idMatch[1];
                  console.log(`[OpenAI Adapter] 从 id 字段提取工具名: ${tc.id} → ${tc.name}`);
                }
              }
              if (!tc.name) {
                console.warn(`[OpenAI Adapter] 跳过空名称的 tool call: id=${tc.id}, args=${tc.argsStr.slice(0, 100)}`);
                continue;
              }
              let args: Record<string, unknown> = {};
              try {
                args = JSON.parse(tc.argsStr || "{}");
              } catch {
                args = {};
              }
              yield {
                type: "tool_call_end",
                id: tc.id,
                name: tc.name,
                arguments: args,
              };
            }
            pendingToolCalls.clear();
          }

          // usage
          if (chunk.usage) {
            inputTokens = chunk.usage.prompt_tokens ?? 0;
            outputTokens = chunk.usage.completion_tokens ?? 0;
          }
        }
      }

      const totalElapsed = Date.now() - startTime;
      console.log(`[OpenAI Adapter] 流式响应完成 (总耗时 ${totalElapsed}ms, 输入 ${inputTokens} tokens, 输出 ${outputTokens} tokens)`);

      yield {
        type: "done",
        stopReason: lastFinishReason === "length" ? "max_tokens" : lastFinishReason === "tool_calls" ? "tool_use" : "end",
        usage: { inputTokens, outputTokens },
      };
    } finally {
      clearTimeout(timeout);
    }
  }

  /** 将工具结果追加到消息列表 */
  appendToolResult(
    messages: NormalizedMessage[],
    assistantToolCalls: ToolCall[],
    results: ToolResult[]
  ): NormalizedMessage[] {
    const newMessages = [...messages];

    newMessages.push({
      role: "assistant",
      content: "",
      toolCalls: assistantToolCalls,
    });

    for (const result of results) {
      newMessages.push({
        role: "tool_result",
        content: result.content,
        toolCallId: result.toolCallId,
      });
    }

    return newMessages;
  }
}

// ============================================================
// 辅助函数
// ============================================================

function extractToolCalls(choice: TuziChoice | undefined): ToolCall[] {
  const toolCalls: ToolCall[] = [];
  const tcs = choice?.message?.tool_calls;
  if (tcs) {
    for (const tc of tcs) {
      toolCalls.push({
        id: tc.id,
        name: tc.function.name,
        arguments: JSON.parse(tc.function.arguments || "{}"),
      });
    }
  }
  return toolCalls;
}
