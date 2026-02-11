/**
 * Anthropic 格式适配器
 *
 * 使用原生 fetch 调用 Tuzi API 的 Anthropic 兼容端点 (/v1/messages)。
 * 支持的模型：Claude 系列。
 *
 * 注意：Tuzi API 对 Anthropic 的兼容可能有限，
 * 实际上 Claude 模型也可能走 OpenAI 兼容端点。
 * 如果 Anthropic 端点不通，会自动降级为 OpenAI 格式。
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
// 类型定义
// ============================================================

interface AnthropicMessage {
  role: "user" | "assistant";
  content: string | AnthropicContentBlock[];
}

type AnthropicContentBlock =
  | { type: "text"; text: string }
  | { type: "tool_use"; id: string; name: string; input: Record<string, unknown> }
  | { type: "tool_result"; tool_use_id: string; content: string };

interface AnthropicTool {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
}

interface AnthropicRequestBody {
  model: string;
  max_tokens: number;
  system?: string;
  messages: AnthropicMessage[];
  temperature?: number;
  tools?: AnthropicTool[];
  stream?: boolean;
}

interface AnthropicResponseBlock {
  type: string;
  text?: string;
  id?: string;
  name?: string;
  input?: Record<string, unknown>;
}

interface AnthropicResponse {
  id: string;
  type: string;
  role: string;
  content: AnthropicResponseBlock[];
  stop_reason: string;
  usage: { input_tokens: number; output_tokens: number };
}

// ============================================================
// 格式转换
// ============================================================

function toAnthropicTools(tools: NormalizedTool[]): AnthropicTool[] {
  return tools.map((tool) => ({
    name: tool.name,
    description: tool.description,
    input_schema: tool.parameters as Record<string, unknown>,
  }));
}

function toAnthropicMessages(messages: NormalizedMessage[]): AnthropicMessage[] {
  const result: AnthropicMessage[] = [];

  for (const msg of messages) {
    switch (msg.role) {
      case "system":
        break; // system 在单独的参数中
      case "user":
        result.push({ role: "user", content: msg.content });
        break;
      case "assistant":
        if (msg.toolCalls && msg.toolCalls.length > 0) {
          const contentBlocks: AnthropicContentBlock[] = [];
          if (msg.content) {
            contentBlocks.push({ type: "text", text: msg.content });
          }
          for (const tc of msg.toolCalls) {
            contentBlocks.push({
              type: "tool_use",
              id: tc.id,
              name: tc.name,
              input: tc.arguments,
            });
          }
          result.push({ role: "assistant", content: contentBlocks });
        } else {
          result.push({ role: "assistant", content: msg.content });
        }
        break;
      case "tool_result": {
        const toolResultBlock: AnthropicContentBlock = {
          type: "tool_result",
          tool_use_id: msg.toolCallId!,
          content: msg.content,
        };
        const lastMsg = result[result.length - 1];
        if (lastMsg?.role === "user" && Array.isArray(lastMsg.content)) {
          (lastMsg.content as AnthropicContentBlock[]).push(toolResultBlock);
        } else {
          result.push({ role: "user", content: [toolResultBlock] });
        }
        break;
      }
    }
  }

  return result;
}

// ============================================================
// 适配器实现
// ============================================================

export class AnthropicAdapter implements LLMAdapter {
  /** 非流式调用 */
  async chat(request: LLMRequest, config: LLMConfig): Promise<LLMResponse> {
    const url = `${config.baseUrl}/v1/messages`;

    const body: AnthropicRequestBody = {
      model: request.model,
      max_tokens: request.maxTokens ?? config.maxTokens,
      system: request.systemPrompt,
      messages: toAnthropicMessages(request.messages),
      temperature: request.temperature ?? config.temperature,
      stream: false,
    };

    if (request.tools && request.tools.length > 0) {
      body.tools = toAnthropicTools(request.tools);
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 180_000);

    try {
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": config.apiKey,
          "anthropic-version": "2023-06-01",
          ...(config.extraHeaders || {}),
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      if (!res.ok) {
        const errorText = await res.text();
        throw new Error(`Anthropic API 错误 (${res.status}): ${errorText.slice(0, 200)}`);
      }

      const data: AnthropicResponse = await res.json();

      const toolCalls: ToolCall[] = [];
      let text = "";

      for (const block of data.content) {
        if (block.type === "text" && block.text) {
          text += block.text;
        } else if (block.type === "tool_use" && block.id && block.name) {
          toolCalls.push({
            id: block.id,
            name: block.name,
            arguments: block.input ?? {},
          });
        }
      }

      return {
        content: text,
        toolCalls,
        usage: {
          inputTokens: data.usage?.input_tokens ?? 0,
          outputTokens: data.usage?.output_tokens ?? 0,
        },
        stopReason:
          data.stop_reason === "tool_use"
            ? "tool_use"
            : data.stop_reason === "max_tokens"
              ? "max_tokens"
              : "end",
      };
    } finally {
      clearTimeout(timeout);
    }
  }

  /** 流式调用 */
  async *chatStream(
    request: LLMRequest,
    config: LLMConfig
  ): AsyncIterable<StreamEvent> {
    const url = `${config.baseUrl}/v1/messages`;

    const body: AnthropicRequestBody = {
      model: request.model,
      max_tokens: request.maxTokens ?? config.maxTokens,
      system: request.systemPrompt,
      messages: toAnthropicMessages(request.messages),
      temperature: request.temperature ?? config.temperature,
      stream: true,
    };

    if (request.tools && request.tools.length > 0) {
      body.tools = toAnthropicTools(request.tools);
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 180_000);

    try {
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": config.apiKey,
          "anthropic-version": "2023-06-01",
          ...(config.extraHeaders || {}),
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      if (!res.ok || !res.body) {
        const errorText = await res.text();
        yield { type: "error", message: `Anthropic 流式错误: ${res.status} ${errorText.slice(0, 200)}` };
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let inputTokens = 0;
      let outputTokens = 0;
      let lastStopReason: string | null = null;
      let currentToolUseId = "";
      let currentToolUseName = "";
      let currentToolUseArgs = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed.startsWith("data: ")) continue;
          const dataStr = trimmed.slice(6);
          if (dataStr === "[DONE]") continue;

          let event;
          try {
            event = JSON.parse(dataStr);
          } catch {
            continue;
          }

          switch (event.type) {
            case "message_start":
              if (event.message?.usage) {
                inputTokens = event.message.usage.input_tokens ?? 0;
              }
              break;

            case "content_block_start":
              if (event.content_block?.type === "tool_use") {
                currentToolUseId = event.content_block.id;
                currentToolUseName = event.content_block.name;
                currentToolUseArgs = "";
                yield {
                  type: "tool_call_start",
                  id: currentToolUseId,
                  name: currentToolUseName,
                };
              }
              break;

            case "content_block_delta":
              if (event.delta?.type === "text_delta") {
                yield { type: "text", content: event.delta.text };
              } else if (event.delta?.type === "input_json_delta") {
                currentToolUseArgs += event.delta.partial_json;
                yield {
                  type: "tool_call_args_delta",
                  id: currentToolUseId,
                  argsDelta: event.delta.partial_json,
                };
              }
              break;

            case "content_block_stop":
              if (currentToolUseId && currentToolUseName) {
                let args: Record<string, unknown> = {};
                try {
                  args = JSON.parse(currentToolUseArgs || "{}");
                } catch {
                  args = {};
                }
                yield {
                  type: "tool_call_end",
                  id: currentToolUseId,
                  name: currentToolUseName,
                  arguments: args,
                };
                currentToolUseId = "";
                currentToolUseName = "";
                currentToolUseArgs = "";
              }
              break;

            case "message_delta":
              if (event.usage) {
                outputTokens = event.usage.output_tokens ?? 0;
              }
              if (event.delta?.stop_reason) {
                lastStopReason = event.delta.stop_reason;
              }
              break;
          }
        }
      }

      yield {
        type: "done",
        stopReason: lastStopReason === "max_tokens" ? "max_tokens" : lastStopReason === "tool_use" ? "tool_use" : "end",
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
