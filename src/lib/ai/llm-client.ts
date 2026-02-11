/**
 * ChaosSaga - 统一 LLM 客户端
 *
 * 自动根据模型名称路由到正确的适配器（OpenAI / Anthropic）。
 * Game Master 和其他系统通过此客户端与 LLM 交互，无需关心底层 API 差异。
 */

import { OpenAIAdapter } from "./adapters/openai-adapter";
import { AnthropicAdapter } from "./adapters/anthropic-adapter";
import { GoogleAdapter } from "./adapters/google-adapter";
import type {
  LLMAdapter,
  LLMConfig,
  LLMRequest,
  LLMResponse,
  NormalizedMessage,
  StreamEvent,
  ToolCall,
  ToolResult,
} from "./adapters/types";
import { getApiFormat } from "./adapters/types";

// 适配器单例
const openaiAdapter = new OpenAIAdapter();
const anthropicAdapter = new AnthropicAdapter();
const googleAdapter = new GoogleAdapter();

/** 根据模型选择适配器 */
function getAdapter(model: string): LLMAdapter {
  const format = getApiFormat(model);
  switch (format) {
    case "anthropic":
      return anthropicAdapter;
    case "google":
      return googleAdapter;
    default:
      return openaiAdapter;
  }
}

/**
 * 统一 LLM 客户端
 *
 * 用法:
 * ```ts
 * const client = new LLMClient(config);
 *
 * // 非流式
 * const response = await client.chat({ model, systemPrompt, messages, tools });
 *
 * // 流式
 * for await (const event of client.chatStream({ ... })) {
 *   // 处理统一的 StreamEvent
 * }
 *
 * // Tool 调用循环
 * const finalResponse = await client.chatWithTools({ ... }, executeToolFn);
 * ```
 */
export class LLMClient {
  private config: LLMConfig;

  constructor(config: LLMConfig) {
    this.config = config;
  }

  /** 更新配置（如运行时切换模型） */
  updateConfig(partial: Partial<LLMConfig>): void {
    this.config = { ...this.config, ...partial };
  }

  /** 获取当前配置 */
  getConfig(): Readonly<LLMConfig> {
    return this.config;
  }

  /** 非流式调用 */
  async chat(request: Omit<LLMRequest, "stream">): Promise<LLMResponse> {
    const model = request.model || this.config.model;
    const adapter = getAdapter(model);
    return adapter.chat({ ...request, model, stream: false }, this.config);
  }

  /** 流式调用 */
  chatStream(
    request: Omit<LLMRequest, "stream">
  ): AsyncIterable<StreamEvent> {
    const model = request.model || this.config.model;
    const adapter = getAdapter(model);
    return adapter.chatStream({ ...request, model, stream: true }, this.config);
  }

  /**
   * 带工具调用的完整对话循环
   *
   * 自动处理 AI → tool_call → execute → tool_result → AI 的递归循环，
   * 直到 AI 返回纯文本响应。
   *
   * @param request 初始请求
   * @param executeTool 工具执行函数
   * @param maxIterations 最大递归次数（防止无限循环）
   * @returns 最终的文本响应和累计的所有工具调用
   */
  async chatWithTools(
    request: Omit<LLMRequest, "stream">,
    executeTool: (
      name: string,
      args: Record<string, unknown>
    ) => Promise<string>,
    maxIterations: number = 10
  ): Promise<{
    content: string;
    allToolCalls: Array<{ name: string; args: Record<string, unknown>; result: string }>;
    usage: { inputTokens: number; outputTokens: number };
  }> {
    const model = request.model || this.config.model;
    const adapter = getAdapter(model);
    let messages = [...request.messages];
    const allToolCalls: Array<{ name: string; args: Record<string, unknown>; result: string }> = [];
    let totalInput = 0;
    let totalOutput = 0;

    for (let i = 0; i < maxIterations; i++) {
      const response = await adapter.chat(
        { ...request, model, messages, stream: false },
        this.config
      );

      totalInput += response.usage.inputTokens;
      totalOutput += response.usage.outputTokens;

      // 如果没有工具调用，返回最终结果
      if (response.toolCalls.length === 0) {
        return {
          content: response.content,
          allToolCalls,
          usage: { inputTokens: totalInput, outputTokens: totalOutput },
        };
      }

      // 执行所有工具调用
      const toolResults: ToolResult[] = [];
      for (const tc of response.toolCalls) {
        let result: string;
        try {
          result = await executeTool(tc.name, tc.arguments);
        } catch (error) {
          result = JSON.stringify({
            success: false,
            error: error instanceof Error ? error.message : "工具执行失败",
          });
        }
        toolResults.push({
          toolCallId: tc.id,
          content: result,
        });
        allToolCalls.push({
          name: tc.name,
          args: tc.arguments,
          result,
        });
      }

      // 将工具结果追加到消息中，继续循环
      messages = adapter.appendToolResult(
        messages,
        response.toolCalls,
        toolResults
      );
    }

    // 超过最大迭代次数
    return {
      content: "（系统：AI 工具调用次数超过限制，已停止）",
      allToolCalls,
      usage: { inputTokens: totalInput, outputTokens: totalOutput },
    };
  }

  /**
   * 带工具调用的流式对话循环
   *
   * 和 chatWithTools 类似，但文本部分是流式输出的。
   * 工具调用期间会暂停流，执行完毕后继续。
   *
   * @param request 初始请求
   * @param executeTool 工具执行函数
   * @param maxIterations 最大递归次数
   */
  async *chatStreamWithTools(
    request: Omit<LLMRequest, "stream">,
    executeTool: (
      name: string,
      args: Record<string, unknown>
    ) => Promise<string>,
    maxIterations: number = 10
  ): AsyncGenerator<StreamEvent | { type: "tool_executed"; name: string; result: string }> {
    const model = request.model || this.config.model;
    const adapter = getAdapter(model);
    let messages = [...request.messages];

    for (let i = 0; i < maxIterations; i++) {
      const stream = adapter.chatStream(
        { ...request, model, messages, stream: true },
        this.config
      );

      // 收集本轮的工具调用
      const completedToolCalls: ToolCall[] = [];
      let hasToolCalls = false;

      for await (const event of stream) {
        yield event;

        if (event.type === "tool_call_end") {
          hasToolCalls = true;
          completedToolCalls.push({
            id: event.id,
            name: event.name,
            arguments: event.arguments,
          });
        }
      }

      // 如果没有工具调用，结束
      if (!hasToolCalls) {
        return;
      }

      // 执行工具并返回结果
      const toolResults: ToolResult[] = [];
      for (const tc of completedToolCalls) {
        let result: string;
        try {
          result = await executeTool(tc.name, tc.arguments);
        } catch (error) {
          result = JSON.stringify({
            success: false,
            error: error instanceof Error ? error.message : "工具执行失败",
          });
        }
        toolResults.push({ toolCallId: tc.id, content: result });

        // 通知前端工具已执行
        yield {
          type: "tool_executed" as const,
          name: tc.name,
          result,
        };
      }

      // 更新消息，继续下一轮
      messages = adapter.appendToolResult(
        messages,
        completedToolCalls,
        toolResults
      );
    }

    yield { type: "error", message: "工具调用次数超过限制" };
  }
}

/**
 * 从环境变量创建默认 LLM 客户端
 */
export function createDefaultLLMClient(): LLMClient {
  return new LLMClient({
    apiKey: process.env.TUZI_API_KEY || "",
    baseUrl: process.env.TUZI_BASE_URL || "https://api.tu-zi.com",
    model: process.env.LLM_MODEL || "gpt-4o-mini",
    temperature: parseFloat(process.env.LLM_TEMPERATURE || "0.7"),
    maxTokens: parseInt(process.env.LLM_MAX_TOKENS || "4096", 10),
  });
}
