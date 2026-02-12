/**
 * ChaosSaga - Structured Response Schema
 *
 * 定义 AI 输出的结构化 JSON 格式，解决正则解析的脆弱性问题。
 *
 * 架构：Hybrid JSON (内容结构化 + 原生工具调用)
 * - Content 部分使用 JSON 格式
 * - Tool Calling 保持原生 Function Calling
 */

// ============================================================
// Schema Definition
// ============================================================

/**
 * AI 响应的结构化格式
 */
export interface StructuredResponse {
  /** AI 的思考过程（可选，用于调试或显示"思考中"） */
  thought?: string;

  /** 叙事文本（主要内容，显示给玩家） */
  narrative: string;

  /** 情绪/氛围标签（可选，未来可用于 UI 效果） */
  mood?: "calm" | "tense" | "excited" | "mysterious" | "sad" | "joyful";

  /** 快捷操作按钮（替代原来的正则提取） */
  suggestions?: string[];

  /** 扩展元数据（未来功能：背景音乐、场景图片提示词等） */
  metadata?: {
    bgm?: string;
    scenePrompt?: string;
    [key: string]: unknown;
  };
}

// ============================================================
// JSON Schema (用于 OpenAI response_format)
// ============================================================

export const STRUCTURED_RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    thought: {
      type: "string",
      description: "AI 的内部思考过程（可选，用于调试）"
    },
    narrative: {
      type: "string",
      description: "叙事文本，显示给玩家的主要内容（50-150字）"
    },
    mood: {
      type: "string",
      enum: ["calm", "tense", "excited", "mysterious", "sad", "joyful"],
      description: "当前场景的情绪氛围（可选）"
    },
    suggestions: {
      type: "array",
      items: { type: "string" },
      description: "快捷操作按钮，2-4个选项（可选）"
    },
    metadata: {
      type: "object",
      description: "扩展元数据（可选）",
      properties: {
        bgm: { type: "string" },
        scenePrompt: { type: "string" }
      }
    }
  },
  required: ["narrative"],
  additionalProperties: false
} as const;

// ============================================================
// Streaming JSON Parser
// ============================================================

/**
 * 流式 JSON 解析器
 *
 * 处理不完整的 JSON 流，尽力提取可用字段。
 * 支持增量解析，边生成边输出。
 */
export class StreamingJSONParser {
  private buffer = "";
  private lastValidState: Partial<StructuredResponse> = {};
  private lastNarrativeLength = 0;

  /**
   * 添加新的文本块
   * @returns 如果成功解析出新字段，返回更新的部分；否则返回 null
   */
  append(chunk: string): Partial<StructuredResponse> | null {
    this.buffer += chunk;

    // 尝试解析当前缓冲区
    const parsed = this.tryParse(this.buffer);
    if (!parsed) return null;

    // 检查是否有新字段或字段更新
    const updates: Partial<StructuredResponse> = {};
    let hasUpdates = false;

    // thought 字段（完整替换）
    if (parsed.thought && parsed.thought !== this.lastValidState.thought) {
      updates.thought = parsed.thought;
      hasUpdates = true;
    }

    // narrative 字段（增量更新）
    if (parsed.narrative) {
      const currentLength = parsed.narrative.length;
      if (currentLength > this.lastNarrativeLength) {
        updates.narrative = parsed.narrative;
        this.lastNarrativeLength = currentLength;
        hasUpdates = true;
      }
    }

    // mood 字段（完整替换）
    if (parsed.mood && parsed.mood !== this.lastValidState.mood) {
      updates.mood = parsed.mood;
      hasUpdates = true;
    }

    // suggestions 字段（完整替换）
    if (parsed.suggestions && JSON.stringify(parsed.suggestions) !== JSON.stringify(this.lastValidState.suggestions)) {
      updates.suggestions = parsed.suggestions;
      hasUpdates = true;
    }

    // metadata 字段（完整替换）
    if (parsed.metadata && JSON.stringify(parsed.metadata) !== JSON.stringify(this.lastValidState.metadata)) {
      updates.metadata = parsed.metadata;
      hasUpdates = true;
    }

    if (hasUpdates) {
      this.lastValidState = { ...this.lastValidState, ...updates };
      return updates;
    }

    return null;
  }

  /**
   * 获取最终完整结果
   */
  finalize(): StructuredResponse | null {
    // 尝试完整解析
    const parsed = this.tryParse(this.buffer);
    if (parsed && parsed.narrative) {
      return parsed as StructuredResponse;
    }

    // 如果有部分有效状态且包含 narrative，返回它
    if (this.lastValidState.narrative) {
      return this.lastValidState as StructuredResponse;
    }

    return null;
  }

  /**
   * 获取当前已解析的 narrative 长度
   */
  getNarrativeLength(): number {
    return this.lastNarrativeLength;
  }

  /**
   * 尝试解析 JSON（容错）
   */
  private tryParse(text: string): Partial<StructuredResponse> | null {
    // 移除可能的前导/尾随空白
    text = text.trim();

    // 尝试直接解析
    try {
      return JSON.parse(text);
    } catch {
      // 继续尝试修复
    }

    // 尝试修复不完整的 JSON
    try {
      // 如果缺少结尾的 }，尝试补全
      if (text.startsWith("{") && !text.endsWith("}")) {
        // 检查是否在字符串中（简单判断：引号数量）
        const quoteCount = (text.match(/"/g) || []).length;
        let fixed = text;

        // 如果引号数量是奇数，说明字符串未闭合
        if (quoteCount % 2 === 1) {
          fixed += '"';
        }

        // 补全对象闭合
        fixed += "}";

        const result = JSON.parse(fixed);
        return result;
      }

      // 如果 suggestions 数组未闭合，尝试修复
      if (text.includes('"suggestions":[') && !text.includes('"suggestions":[]')) {
        const match = text.match(/"suggestions":\[([^\]]*?)$/);
        if (match) {
          const fixed = text.replace(/"suggestions":\[([^\]]*?)$/, '"suggestions":[$1]}');
          return JSON.parse(fixed);
        }
      }
    } catch {
      // 修复失败
    }

    return null;
  }

  /** 重置解析器 */
  reset(): void {
    this.buffer = "";
    this.lastValidState = {};
    this.lastNarrativeLength = 0;
  }
}

// ============================================================
// Fallback: Plain Text Parser
// ============================================================

/**
 * 回退方案：从纯文本中提取结构
 *
 * 当 JSON 解析完全失败时使用，兼容旧的文本格式。
 * 使用原有的 extractActions 逻辑。
 */
export function parseAsPlainText(text: string): StructuredResponse {
  const suggestions: string[] = [];
  const lines = text.split("\n");

  // 列表选项行：- [xxx] 或 - **[xxx]** 开头（后面可跟描述）
  const listOptionRegex = /^[-*•]\s+(?:\*\*)?[【\[]?([^\]】]{1,50})[】\]]?(?:\*\*)?/;
  // 纯选项行：整行主要由 [xxx] 或 **[xxx]** 组成
  const inlineOptionRegex = /(?:\*\*)?[【\[]([^\]】]{1,50})[】\]](?:\*\*)?/g;
  // 选项标题行（如「你想做什么？」「请选择：」）—— 跳过但继续扫描
  const promptLineRegex = /^\*\*.*[？?：:]\s*\*\*$|^.*[？?：:]$/;

  let cutIndex = lines.length; // 将要截断的行索引

  // 从末尾向前扫描
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i].trim();
    if (!line) continue; // 跳过空行

    // 优先匹配列表选项（- [xxx] — 描述）
    const listMatch = line.match(listOptionRegex);
    if (listMatch && (line.startsWith("-") || line.startsWith("*") || line.startsWith("•"))) {
       // 确保是列表项
      suggestions.unshift(listMatch[1]);
      cutIndex = i;
      continue;
    }
    
    // 匹配 "建议：" 或 "选项：" 开头的行
    if (line.match(/^(?:建议|选项|Actions)[:：]/)) {
        cutIndex = i;
        continue;
    }

    // 匹配行内所有 [xxx] 或 **[xxx]**
    const lineMatches: string[] = [];
    let m;
    const regex = new RegExp(inlineOptionRegex.source, 'g');
    while ((m = regex.exec(line)) !== null) {
      lineMatches.push(m[1]);
    }

    if (lineMatches.length > 0) {
      // 移除所有选项后，检查剩余内容
      const nonOptionContent = line.replace(new RegExp(inlineOptionRegex.source, 'g'), '').replace(/[\s*-—·•]+/g, '').trim();
      // 如果剩余内容很少，说明这行主要是选项
      if (nonOptionContent.length <= lineMatches.reduce((s, o) => s + o.length, 0)) {
        suggestions.unshift(...lineMatches);
        cutIndex = i;
        continue;
      }
    }

    // 选项标题行（继续向上扫描）
    if (promptLineRegex.test(line) && suggestions.length > 0) {
      cutIndex = i;
      continue;
    }

    // 其他内容行，停止扫描
    break;
  }

  // 构建去掉选项行后的正文
  const narrative = lines.slice(0, cutIndex).join("\n").trimEnd() || text;

  return {
    narrative: narrative || "...", // 防止空内容
    suggestions: suggestions.length > 0 ? suggestions : undefined
  };
}

// ============================================================
// Validation
// ============================================================

/**
 * 验证结构化响应是否有效
 */
export function validateStructuredResponse(data: unknown): data is StructuredResponse {
  if (typeof data !== "object" || data === null) return false;

  const obj = data as Record<string, unknown>;

  // narrative 是必需的
  if (typeof obj.narrative !== "string" || obj.narrative.length === 0) {
    return false;
  }

  // 可选字段类型检查
  if (obj.thought !== undefined && typeof obj.thought !== "string") {
    return false;
  }

  if (obj.mood !== undefined) {
    const validMoods = ["calm", "tense", "excited", "mysterious", "sad", "joyful"];
    if (typeof obj.mood !== "string" || !validMoods.includes(obj.mood)) {
      return false;
    }
  }

  if (obj.suggestions !== undefined) {
    if (!Array.isArray(obj.suggestions)) return false;
    if (!obj.suggestions.every(s => typeof s === "string")) return false;
  }

  return true;
}
