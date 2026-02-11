/**
 * Google Gemini 原生格式适配器
 *
 * 使用 Tuzi API 的 Google 兼容端点:
 *   /v1beta/models/{model}:generateContent      (非流式)
 *   /v1beta/models/{model}:streamGenerateContent (流式)
 *
 * 关键格式差异（对比 OpenAI）:
 * - system prompt → systemInstruction
 * - messages → contents, role 用 "user"/"model"
 * - tools → tools.functionDeclarations
 * - tool call → parts[].functionCall
 * - tool result → parts[].functionResponse
 * - temperature/maxTokens → generationConfig
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
// Google Gemini 类型
// ============================================================

interface GeminiPart {
  text?: string;
  functionCall?: { name: string; args: Record<string, unknown> };
  functionResponse?: { name: string; response: Record<string, unknown> };
}

interface GeminiContent {
  role: "user" | "model";
  parts: GeminiPart[];
}

interface GeminiFunctionDeclaration {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

interface GeminiRequestBody {
  contents: GeminiContent[];
  systemInstruction?: { parts: Array<{ text: string }> };
  tools?: Array<{ functionDeclarations: GeminiFunctionDeclaration[] }>;
  generationConfig?: {
    temperature?: number;
    maxOutputTokens?: number;
    topP?: number;
  };
}

interface GeminiResponseCandidate {
  content: {
    parts: GeminiPart[];
    role: string;
  };
  finishReason: string;
}

interface GeminiResponse {
  candidates: GeminiResponseCandidate[];
  usageMetadata?: {
    promptTokenCount?: number;
    candidatesTokenCount?: number;
    totalTokenCount?: number;
  };
}

// ============================================================
// 格式转换
// ============================================================

/** 将标准化工具转为 Gemini functionDeclarations */
function toGeminiTools(
  tools: NormalizedTool[]
): Array<{ functionDeclarations: GeminiFunctionDeclaration[] }> {
  return [
    {
      functionDeclarations: tools.map((t) => ({
        name: t.name,
        description: t.description,
        parameters: t.parameters as Record<string, unknown>,
      })),
    },
  ];
}

/** 将标准化消息转为 Gemini contents（不含 system） */
function toGeminiContents(messages: NormalizedMessage[]): GeminiContent[] {
  const result: GeminiContent[] = [];

  for (const msg of messages) {
    switch (msg.role) {
      case "system":
        // system 在 systemInstruction 中处理，跳过
        break;

      case "user":
        result.push({ role: "user", parts: [{ text: msg.content }] });
        break;

      case "assistant": {
        const parts: GeminiPart[] = [];

        // 文本部分
        if (msg.content) {
          parts.push({ text: msg.content });
        }

        // 工具调用部分
        if (msg.toolCalls && msg.toolCalls.length > 0) {
          for (const tc of msg.toolCalls) {
            parts.push({
              functionCall: { name: tc.name, args: tc.arguments },
            });
          }
        }

        if (parts.length > 0) {
          result.push({ role: "model", parts });
        }
        break;
      }

      case "tool_result": {
        // Gemini 的工具结果作为 user 消息中的 functionResponse
        let parsedResult: Record<string, unknown>;
        try {
          parsedResult = JSON.parse(msg.content);
        } catch {
          parsedResult = { result: msg.content };
        }

        const lastMsg = result[result.length - 1];
        const responsePart: GeminiPart = {
          functionResponse: {
            name: msg.toolCallId || "unknown",
            response: parsedResult,
          },
        };

        // 如果上一条是 user，合并到同一条
        if (lastMsg?.role === "user") {
          lastMsg.parts.push(responsePart);
        } else {
          result.push({ role: "user", parts: [responsePart] });
        }
        break;
      }
    }
  }

  return result;
}

/** 从 Gemini 响应中提取文本 */
function extractText(candidate: GeminiResponseCandidate): string {
  return candidate.content.parts
    .filter((p) => p.text)
    .map((p) => p.text)
    .join("");
}

/** 从 Gemini 响应中提取工具调用 */
function extractToolCalls(candidate: GeminiResponseCandidate): ToolCall[] {
  const calls: ToolCall[] = [];
  for (const part of candidate.content.parts) {
    if (part.functionCall) {
      calls.push({
        id: `call_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        name: part.functionCall.name,
        arguments: part.functionCall.args ?? {},
      });
    }
  }
  return calls;
}

// ============================================================
// 适配器实现
// ============================================================

export class GoogleAdapter implements LLMAdapter {
  /** 非流式调用 */
  async chat(request: LLMRequest, config: LLMConfig): Promise<LLMResponse> {
    const url = `${config.baseUrl}/v1beta/models/${request.model}:generateContent`;

    const body: GeminiRequestBody = {
      contents: toGeminiContents(request.messages),
    };

    // System prompt
    if (request.systemPrompt) {
      body.systemInstruction = {
        parts: [{ text: request.systemPrompt }],
      };
    }

    // 工具
    if (request.tools && request.tools.length > 0) {
      body.tools = toGeminiTools(request.tools);
    }

    // 生成配置
    body.generationConfig = {
      temperature: request.temperature ?? config.temperature,
      maxOutputTokens: request.maxTokens ?? config.maxTokens,
    };

    // 超时控制
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 180_000);

    try {
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${config.apiKey}`,
          ...(config.extraHeaders || {}),
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      if (!res.ok) {
        const errorText = await res.text();
        console.error("[Google Adapter] 错误:", res.status, errorText);
        throw new Error(
          `Gemini API 错误 (${res.status}): ${errorText.slice(0, 200)}`
        );
      }

      const data: GeminiResponse = await res.json();
      const candidate = data.candidates?.[0];

      if (!candidate) {
        throw new Error("Gemini API 返回空结果");
      }

      const text = extractText(candidate);
      const toolCalls = extractToolCalls(candidate);

      return {
        content: text,
        toolCalls,
        usage: {
          inputTokens: data.usageMetadata?.promptTokenCount ?? 0,
          outputTokens: data.usageMetadata?.candidatesTokenCount ?? 0,
        },
        stopReason:
          candidate.finishReason === "MAX_TOKENS"
            ? "max_tokens"
            : toolCalls.length > 0
              ? "tool_use"
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
    const url = `${config.baseUrl}/v1beta/models/${request.model}:streamGenerateContent?alt=sse`;

    const body: GeminiRequestBody = {
      contents: toGeminiContents(request.messages),
    };

    if (request.systemPrompt) {
      body.systemInstruction = {
        parts: [{ text: request.systemPrompt }],
      };
    }

    if (request.tools && request.tools.length > 0) {
      body.tools = toGeminiTools(request.tools);
    }

    body.generationConfig = {
      temperature: request.temperature ?? config.temperature,
      maxOutputTokens: request.maxTokens ?? config.maxTokens,
    };

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 180_000);

    try {
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${config.apiKey}`,
          ...(config.extraHeaders || {}),
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      if (!res.ok || !res.body) {
        const errorText = await res.text();
        yield {
          type: "error",
          message: `Gemini 流式错误: ${res.status} ${errorText.slice(0, 200)}`,
        };
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
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
          if (!trimmed.startsWith("data: ")) continue;
          const dataStr = trimmed.slice(6);
          if (dataStr === "[DONE]") continue;

          let chunk: GeminiResponse;
          try {
            chunk = JSON.parse(dataStr);
          } catch {
            continue;
          }

          const candidate = chunk.candidates?.[0];
          if (!candidate) continue;
          if (candidate.finishReason) lastFinishReason = candidate.finishReason;

          for (const part of candidate.content?.parts ?? []) {
            if (part.text) {
              yield { type: "text", content: part.text };
            }

            if (part.functionCall) {
              const callId = `call_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
              yield {
                type: "tool_call_start",
                id: callId,
                name: part.functionCall.name,
              };
              yield {
                type: "tool_call_end",
                id: callId,
                name: part.functionCall.name,
                arguments: part.functionCall.args ?? {},
              };
            }
          }

          // usage
          if (chunk.usageMetadata) {
            inputTokens = chunk.usageMetadata.promptTokenCount ?? 0;
            outputTokens = chunk.usageMetadata.candidatesTokenCount ?? 0;
          }
        }
      }

      yield {
        type: "done",
        stopReason: lastFinishReason === "MAX_TOKENS" ? "max_tokens" : lastFinishReason === "STOP" ? "end" : "end",
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

    // assistant 消息带 toolCalls
    newMessages.push({
      role: "assistant",
      content: "",
      toolCalls: assistantToolCalls,
    });

    // Gemini 的 tool_result 需要 toolCallId 存工具名（不是 call ID）
    // 因为 functionResponse 用 name 字段对应
    for (let i = 0; i < results.length; i++) {
      const tc = assistantToolCalls[i];
      newMessages.push({
        role: "tool_result",
        content: results[i].content,
        toolCallId: tc?.name || results[i].toolCallId,
      });
    }

    return newMessages;
  }
}
