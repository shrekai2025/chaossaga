/**
 * ChaosSaga - LLM 统一类型定义
 *
 * 所有 LLM 适配器和游戏系统都使用这些标准化类型。
 * 适配器负责将这些类型转换为供应商特定的格式。
 */

// ============================================================
// 渠道商 (Provider)
// ============================================================

/** 渠道商定义 */
export interface ProviderDefinition {
  id: string;              // "tuzi" | "openrouter"
  name: string;            // 显示名
  description: string;
  envApiKeyName: string;   // 对应的环境变量名
  envBaseUrlName: string;
  defaultBaseUrl: string;
  extraHeaders?: Record<string, string>;
}

/** 内置渠道商 */
export const AVAILABLE_PROVIDERS: ProviderDefinition[] = [
  {
    id: "tuzi",
    name: "Tuzi API",
    description: "兔子 API 转发，支持全部主流模型",
    envApiKeyName: "TUZI_API_KEY",
    envBaseUrlName: "TUZI_BASE_URL",
    defaultBaseUrl: "https://api.tu-zi.com",
  },
  {
    id: "openrouter",
    name: "OpenRouter",
    description: "OpenRouter 多模型聚合平台",
    envApiKeyName: "OPENROUTER_API_KEY",
    envBaseUrlName: "OPENROUTER_BASE_URL",
    defaultBaseUrl: "https://openrouter.ai/api",
    extraHeaders: {
      "HTTP-Referer": "https://chaossaga.app",
      "X-Title": "ChaosSaga",
    },
  },
];

// ============================================================
// 模型与配置
// ============================================================

/** API 格式类型 */
export type ApiFormat = "openai" | "anthropic" | "google";

/** 模型定义 */
export interface ModelDefinition {
  id: string;
  name: string;
  provider: string;      // 显示名，如 "OpenAI", "Google", "Anthropic"
  providerId: string;    // 渠道商 ID，如 "tuzi", "openrouter"
  apiFormat: ApiFormat;
  costTier: "low" | "medium" | "high" | "premium";
  description: string;
  supportsTools: boolean;
  supportsStreaming: boolean;
  supportsMultimodal: boolean;
  maxOutputTokens: number;
}

/** LLM 运行时配置 */
export interface LLMConfig {
  apiKey: string;
  baseUrl: string;
  model: string;
  temperature: number;
  maxTokens: number;
  extraHeaders?: Record<string, string>;
}

/** 可用模型列表 */
export const AVAILABLE_MODELS: ModelDefinition[] = [
  // ---- Tuzi 渠道 ----
  {
    id: "gpt-4o-mini",
    name: "GPT-4o Mini",
    provider: "OpenAI",
    providerId: "tuzi",
    apiFormat: "openai",
    costTier: "low",
    description: "最便宜，支持多模态，适合轻量任务",
    supportsTools: true,
    supportsStreaming: true,
    supportsMultimodal: true,
    maxOutputTokens: 4096,
  },
  {
    id: "claude-haiku-4-5-20251001-thinking",
    name: "Claude Haiku 4.5",
    provider: "Anthropic",
    providerId: "tuzi",
    apiFormat: "anthropic",
    costTier: "low",
    description: "低成本 Claude，快速响应",
    supportsTools: true,
    supportsStreaming: true,
    supportsMultimodal: false,
    maxOutputTokens: 4096,
  },
  {
    id: "gemini-3-pro",
    name: "Gemini 3 Pro",
    provider: "Google",
    providerId: "tuzi",
    apiFormat: "google",
    costTier: "medium",
    description: "均衡性能，中等成本",
    supportsTools: true,
    supportsStreaming: true,
    supportsMultimodal: true,
    maxOutputTokens: 4096,
  },
  {
    id: "grok-4.1",
    name: "Grok 4.1",
    provider: "xAI",
    providerId: "tuzi",
    apiFormat: "openai",
    costTier: "medium",
    description: "通用对话，中等成本",
    supportsTools: true,
    supportsStreaming: true,
    supportsMultimodal: false,
    maxOutputTokens: 4096,
  },
  {
    id: "gemini-3-pro-all",
    name: "Gemini 3 Pro All",
    provider: "Google",
    providerId: "tuzi",
    apiFormat: "google",
    costTier: "high",
    description: "Gemini 完整版，更强能力",
    supportsTools: true,
    supportsStreaming: true,
    supportsMultimodal: true,
    maxOutputTokens: 8192,
  },
  {
    id: "gpt-5.1-thinking",
    name: "GPT-5.1 Thinking",
    provider: "OpenAI",
    providerId: "tuzi",
    apiFormat: "openai",
    costTier: "high",
    description: "深度推理，代码能力出色",
    supportsTools: true,
    supportsStreaming: true,
    supportsMultimodal: true,
    maxOutputTokens: 8192,
  },
  {
    id: "gpt-5.1-thinking-all",
    name: "GPT-5.1 Thinking All",
    provider: "OpenAI",
    providerId: "tuzi",
    apiFormat: "openai",
    costTier: "premium",
    description: "GPT-5.1 完整思考模型",
    supportsTools: true,
    supportsStreaming: true,
    supportsMultimodal: true,
    maxOutputTokens: 16384,
  },
  {
    id: "claude-opus-4-5-20251101-thinking",
    name: "Claude Opus 4.5",
    provider: "Anthropic",
    providerId: "tuzi",
    apiFormat: "anthropic",
    costTier: "premium",
    description: "最强模型，创意写作与复杂推理",
    supportsTools: true,
    supportsStreaming: true,
    supportsMultimodal: false,
    maxOutputTokens: 8192,
  },
  // ---- OpenRouter 渠道 ----
  {
    id: "moonshotai/kimi-k2.5",
    name: "Kimi K2.5",
    provider: "Moonshot AI",
    providerId: "openrouter",
    apiFormat: "openai",
    costTier: "medium",
    description: "Moonshot 最新模型，中文能力强，推理与创作兼备",
    supportsTools: true,
    supportsStreaming: true,
    supportsMultimodal: false,
    maxOutputTokens: 8192,
  },
];

/** 根据模型 ID 获取模型定义（支持自定义模型列表） */
export function getModelDefinition(
  modelId: string,
  customModels: ModelDefinition[] = []
): ModelDefinition | undefined {
  return (
    AVAILABLE_MODELS.find((m) => m.id === modelId) ??
    customModels.find((m) => m.id === modelId)
  );
}

/** 根据模型 ID 判断 API 格式（支持自定义模型列表） */
export function getApiFormat(
  modelId: string,
  customModels: ModelDefinition[] = []
): ApiFormat {
  // 先查自定义模型列表
  const custom = customModels.find((m) => m.id === modelId);
  if (custom) return custom.apiFormat;

  // 再查内置模型列表
  const builtin = AVAILABLE_MODELS.find((m) => m.id === modelId);
  if (builtin) return builtin.apiFormat;

  // 兜底：前缀推断
  if (modelId.startsWith("claude-")) return "anthropic";
  return "openai";
}

// ============================================================
// 消息
// ============================================================

/** 标准化消息角色 */
export type MessageRole = "system" | "user" | "assistant" | "tool_result";

/** 标准化消息 */
export interface NormalizedMessage {
  role: MessageRole;
  content: string;
  /** tool_result 消息需要 */
  toolCallId?: string;
  /** assistant 消息中的工具调用 */
  toolCalls?: ToolCall[];
}

// ============================================================
// 工具 (Function Calling)
// ============================================================

/** JSON Schema 类型 (简化) */
export type JSONSchema = {
  type: string;
  properties?: Record<string, JSONSchema & { description?: string; enum?: string[]; items?: JSONSchema; default?: unknown }>;
  required?: string[];
  description?: string;
  items?: JSONSchema;
  enum?: string[];
  default?: unknown;
  anyOf?: JSONSchema[];
};

/** 标准化工具定义 - 所有工具都用这个格式 */
export interface NormalizedTool {
  name: string;
  description: string;
  parameters: JSONSchema;
}

/** 工具调用 (AI 返回的) */
export interface ToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

/** 工具执行结果 */
export interface ToolResult {
  toolCallId: string;
  content: string; // JSON.stringify 后的结果
  isError?: boolean;
}

// ============================================================
// 流式事件
// ============================================================

/** 统一流式事件 - 适配器将供应商特定格式转换为这些事件 */
export type StreamEvent =
  | { type: "text"; content: string }
  | { type: "tool_call_start"; id: string; name: string }
  | { type: "tool_call_args_delta"; id: string; argsDelta: string }
  | { type: "tool_call_end"; id: string; name: string; arguments: Record<string, unknown> }
  | { type: "done"; stopReason?: string; usage?: { inputTokens: number; outputTokens: number } }
  | { type: "error"; message: string };

// ============================================================
// 适配器接口
// ============================================================

/** LLM 请求参数 */
export interface LLMRequest {
  model: string;
  systemPrompt: string;
  messages: NormalizedMessage[];
  tools?: NormalizedTool[];
  temperature?: number;
  maxTokens?: number;
  stream?: boolean;
}

/** 非流式响应 */
export interface LLMResponse {
  content: string;
  toolCalls: ToolCall[];
  usage: { inputTokens: number; outputTokens: number };
  stopReason: "end" | "tool_use" | "max_tokens" | "error";
}

/** 适配器接口 - 每个供应商实现这个接口 */
export interface LLMAdapter {
  /** 非流式调用 */
  chat(request: LLMRequest, config: LLMConfig): Promise<LLMResponse>;

  /** 流式调用 - 返回异步迭代器 */
  chatStream(request: LLMRequest, config: LLMConfig): AsyncIterable<StreamEvent>;

  /** 将工具结果添加到消息列表中（格式因供应商而异） */
  appendToolResult(
    messages: NormalizedMessage[],
    assistantToolCalls: ToolCall[],
    results: ToolResult[]
  ): NormalizedMessage[];
}
