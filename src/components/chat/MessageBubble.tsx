"use client";

/**
 * 消息气泡组件
 *
 * 三种样式：
 * - 用户消息：右侧，accent 背景
 * - AI 消息：左侧，白色卡片，Markdown 渲染
 * - 系统消息：居中，淡色
 */

import { useState } from "react";
import ReactMarkdown from "react-markdown";
import type { GameMessage } from "@/hooks/useGameChat";

const TOOL_NAMES: Record<string, string> = {
  get_player_state: "查询状态",
  get_area_info: "查看区域",
  get_battle_state: "查看战斗",
  start_battle: "发起战斗",
  execute_battle_action: "执行战斗",
  use_item: "使用物品",
  move_to_node: "移动",
  interact_npc: "NPC交互",
  enhance_equipment: "强化装备",
  generate_area: "生成区域",
  create_quest: "创建任务",
  update_quest: "更新任务",
  modify_player_data: "修改数据",
  add_item: "添加物品",
  send_narrative: "叙事",
};

/** 可折叠的 JSON 显示组件 */
function CollapsibleJson({ json, charCount }: { json: string; charCount: number }) {
  const [expanded, setExpanded] = useState(false);
  
  return (
    <div className="my-2">
      <button
        onClick={() => setExpanded(!expanded)}
        className="inline-flex items-center gap-1 rounded bg-muted/10 px-2 py-1 text-[11px] text-muted hover:bg-muted/20 transition-colors"
      >
        <span>{expanded ? "▼" : "▶"}</span>
        <span>Json {charCount}字符</span>
      </button>
      {expanded && (
        <pre className="mt-2 overflow-x-auto rounded bg-muted/5 p-2 text-[11px] text-muted border border-border-light">
          {json}
        </pre>
      )}
    </div>
  );
}

/** 
 * 处理消息内容：
 * 1. 提取并折叠 JSON 块
 * 2. 移除末尾的 [选项] 文本（这些会通过 actions 显示）
 */
function processContent(content: string): { 
  textParts: Array<{ type: 'text' | 'json'; content: string; charCount?: number }>;
  cleanContent: string;
} {
  // 匹配 JSON 对象或数组（简单的花括号/方括号匹配，支持嵌套）
  const jsonRegex = /(\{[\s\S]*?\}|\[[\s\S]*?\])/g;
  const parts: Array<{ type: 'text' | 'json'; content: string; charCount?: number }> = [];
  let lastIndex = 0;
  
  // 提取 JSON 块
  let match;
  while ((match = jsonRegex.exec(content)) !== null) {
    const jsonStr = match[1];
    // 验证是否为有效 JSON
    try {
      JSON.parse(jsonStr);
      // 是有效 JSON
      if (match.index > lastIndex) {
        parts.push({ type: 'text', content: content.slice(lastIndex, match.index) });
      }
      parts.push({ type: 'json', content: jsonStr, charCount: jsonStr.length });
      lastIndex = match.index + jsonStr.length;
    } catch {
      // 不是有效 JSON，跳过
    }
  }
  
  // 剩余文本
  if (lastIndex < content.length) {
    parts.push({ type: 'text', content: content.slice(lastIndex) });
  }
  
  // 如果没有找到 JSON，整个内容都是文本
  if (parts.length === 0) {
    parts.push({ type: 'text', content });
  }
  
  // 移除末尾的选项行（与 gamemaster.ts 中 extractActions 使用相同逻辑）
  // 支持：- [选项] — 描述、**[选项]**、纯 [选项1] [选项2] 行
  const listOptionRegex = /^[-*•]\s+(?:\*\*)?[【\[]([^\]】]{1,50})[】\]](?:\*\*)?/;
  const inlineOptionRegex = /(?:\*\*)?[【\[]([^\]】]{1,50})[】\]](?:\*\*)?/g;
  const promptLineRegex = /^\*\*.*[？?：:]\s*\*\*$|^.*[？?：:]$/;

  for (let i = parts.length - 1; i >= 0; i--) {
    if (parts[i].type === 'text') {
      const lines = parts[i].content.split('\n');
      let cutIndex = lines.length;
      let foundOptions = false;

      for (let j = lines.length - 1; j >= 0; j--) {
        const line = lines[j].trim();
        if (!line) continue;

        // 列表选项行
        if (listOptionRegex.test(line)) {
          cutIndex = j;
          foundOptions = true;
          continue;
        }

        // 纯选项行
        const lineMatches = line.match(inlineOptionRegex);
        if (lineMatches && lineMatches.length > 0) {
          const nonOption = line.replace(inlineOptionRegex, '').replace(/[\s*\-—·•]+/g, '').trim();
          if (nonOption.length <= lineMatches.reduce((s, m) => s + m.length, 0)) {
            cutIndex = j;
            foundOptions = true;
            continue;
          }
        }

        // 选项标题行
        if (promptLineRegex.test(line) && foundOptions) {
          cutIndex = j;
          continue;
        }

        break;
      }
      
      parts[i].content = lines.slice(0, cutIndex).join('\n').trim();
      break;
    }
  }
  
  const cleanContent = parts.map(p => p.content).join('');
  return { textParts: parts, cleanContent };
}

/** 复制按钮 */
function CopyButton({
  content,
  isStreaming,
}: {
  content: string;
  isStreaming?: boolean;
}) {
  const [copied, setCopied] = useState(false);

  if (isStreaming || !content) return null;

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(content);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error("复制失败:", err);
    }
  };

  return (
    <button
      onClick={handleCopy}
      className={`rounded p-0.5 transition-colors ${
        copied
          ? "text-success"
          : "text-transparent group-hover:text-muted/40 hover:text-accent!"
      }`}
      title={copied ? "已复制" : "复制内容"}
    >
      {copied ? (
        <svg
          width="13"
          height="13"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <polyline points="20 6 9 17 4 12" />
        </svg>
      ) : (
        <svg
          width="13"
          height="13"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
          <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
        </svg>
      )}
    </button>
  );
}

/** 查看原始内容按钮 */
function ViewRawButton({
  content,
  isStreaming,
}: {
  content: string;
  isStreaming?: boolean;
}) {
  const [showRaw, setShowRaw] = useState(false);

  if (isStreaming || !content) return null;

  return (
    <>
      <button
        onClick={() => setShowRaw(!showRaw)}
        className={`rounded p-0.5 transition-colors ${
          showRaw
            ? "text-info"
            : "text-transparent group-hover:text-muted/40 hover:text-info!"
        }`}
        title={showRaw ? "隐藏原始内容" : "查看原始内容"}
      >
        <svg
          width="13"
          height="13"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
          <polyline points="14 2 14 8 20 8" />
          <line x1="16" y1="13" x2="8" y2="13" />
          <line x1="16" y1="17" x2="8" y2="17" />
        </svg>
      </button>
      {showRaw && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => setShowRaw(false)}>
          <div 
            className="max-w-2xl max-h-[80vh] overflow-auto rounded-lg bg-surface border border-border p-4 shadow-lg"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex justify-between items-center mb-3">
              <h3 className="font-medium text-sm text-foreground">原始回复内容</h3>
              <button
                onClick={() => setShowRaw(false)}
                className="text-muted hover:text-foreground"
              >
                ✕
              </button>
            </div>
            <pre className="whitespace-pre-wrap text-xs text-muted bg-muted/5 p-3 rounded border border-border-light overflow-x-auto">
              {content}
            </pre>
          </div>
        </div>
      )}
    </>
  );
}

/** 删除确认按钮 */
function DeleteButton({
  onDelete,
  isStreaming,
}: {
  onDelete: () => void;
  isStreaming?: boolean;
}) {
  const [confirming, setConfirming] = useState(false);

  if (isStreaming) return null;

  if (confirming) {
    return (
      <span className="flex items-center gap-1">
        <button
          onClick={() => {
            onDelete();
            setConfirming(false);
          }}
          className="rounded bg-danger/10 px-1.5 py-0.5 text-[10px] text-danger hover:bg-danger/20"
        >
          确认
        </button>
        <button
          onClick={() => setConfirming(false)}
          className="rounded px-1.5 py-0.5 text-[10px] text-muted hover:text-foreground"
        >
          取消
        </button>
      </span>
    );
  }

  return (
    <button
      onClick={() => setConfirming(true)}
      className="rounded p-0.5 text-transparent transition-colors group-hover:text-muted/40 hover:text-danger!"
      title="删除此消息"
    >
      <svg
        width="13"
        height="13"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M3 6h18" />
        <path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6" />
        <path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" />
      </svg>
    </button>
  );
}

export default function MessageBubble({
  message,
  onDelete,
}: {
  message: GameMessage;
  onDelete?: (id: string) => void;
}) {
  // 系统消息
  if (message.role === "system") {
    return (
      <div className="group animate-message-in my-2 flex items-center justify-center gap-1">
        <span className="inline-block rounded-lg border border-border-light bg-muted/15 px-3 py-1.5 text-[11px] text-muted shadow-sm">
          {message.content}
        </span>
        <CopyButton content={message.content} />
        {onDelete && (
          <DeleteButton onDelete={() => onDelete(message.id)} />
        )}
      </div>
    );
  }

  // 用户消息
  if (message.role === "user") {
    return (
      <div className="group animate-message-in my-2 flex items-start justify-end gap-1.5">
        <div className="shrink-0 pt-2 flex items-center gap-0.5">
          <CopyButton content={message.content} />
          {onDelete && (
            <DeleteButton onDelete={() => onDelete(message.id)} />
          )}
        </div>
        <div className="max-w-[75%] rounded-2xl rounded-br-md bg-accent px-4 py-2.5 text-sm text-white">
          {message.content}
        </div>
      </div>
    );
  }

  // AI 消息
  return (
    <div className="group animate-message-in my-2 flex items-start justify-start gap-1.5">
      <div className="max-w-[88%] sm:max-w-[80%]">
        {/* 工具调用指示 */}
        {message.toolCalls && message.toolCalls.length > 0 && (
          <div className="mb-1.5 flex flex-wrap gap-1">
            {message.toolCalls.map((tc, i) => (
              <span
                key={i}
                className={`inline-flex items-center gap-0.5 rounded-full px-2 py-0.5 text-[10px] font-medium ${
                  tc.success === undefined
                    ? "bg-info/8 text-info"
                    : tc.success
                      ? "bg-success/8 text-success"
                      : "bg-danger/8 text-danger"
                }`}
              >
                {tc.success === undefined ? "⏳" : tc.success ? "✓" : "✗"}
                {TOOL_NAMES[tc.tool] || tc.tool}
              </span>
            ))}
          </div>
        )}

        {/* 消息内容 */}
        <div
          className={`rounded-2xl rounded-bl-md border border-border-light bg-surface px-4 py-3 text-sm leading-relaxed text-foreground ${
            message.isStreaming ? "streaming-cursor" : ""
          }`}
          style={{ boxShadow: "var(--shadow-sm)" }}
        >
          {message.content ? (
            (() => {
              const { textParts } = processContent(message.content);
              return (
                <div className="prose-game">
                  {textParts.map((part, idx) => (
                    part.type === 'json' ? (
                      <CollapsibleJson 
                        key={idx} 
                        json={part.content} 
                        charCount={part.charCount!} 
                      />
                    ) : (
                      <ReactMarkdown key={idx}>{part.content}</ReactMarkdown>
                    )
                  ))}
                  
                  {/* 战斗奖励展示 */}
                  {message.toolCalls?.map((tc, i) => {
                    // 只处理战斗执行工具且有 rewards 数据的情况
                    if (tc.tool === "execute_battle_action" && tc.data?.rewards) {
                      const r = tc.data.rewards;
                      return (
                        <div key={i} className="mt-3 rounded-xl border border-warning/20 bg-warning/5 p-3">
                          <div className="mb-2 flex items-center gap-2 text-xs font-bold text-warning-dark">
                            <span>🎉</span>
                            <span>战斗胜利！获得奖励：</span>
                          </div>
                          <div className="flex flex-wrap gap-3 text-xs">
                            {r.exp > 0 && (
                              <span className="flex items-center gap-1 font-medium text-foreground">
                                <span className="text-info">Exp</span> +{r.exp}
                              </span>
                            )}
                            {r.gold > 0 && (
                              <span className="flex items-center gap-1 font-medium text-foreground">
                                <span className="text-warning">Gold</span> +{r.gold}
                              </span>
                            )}
                            {r.items && r.items.length > 0 && (
                              <div className="flex items-center gap-1">
                                <span className="text-muted">物品:</span>
                                {r.items.map((item: any, idx: number) => (
                                  <span key={idx} className={`rounded px-1.5 py-0.5 bg-background border border-border text-[10px] ${
                                    item.quality === 'uncommon' ? 'text-success border-success/30' :
                                    item.quality === 'rare' ? 'text-info border-info/30' :
                                    item.quality === 'epic' ? 'text-purple-500 border-purple-500/30' :
                                    item.quality === 'legendary' ? 'text-warning border-warning/30' :
                                    'text-foreground'
                                  }`}>
                                    {item.name}
                                  </span>
                                ))}
                              </div>
                            )}
                          </div>
                          {r.levelUp && (
                            <div className="mt-2 text-xs font-bold text-success animate-pulse">
                              ✨ 恭喜升级！Lv.{r.levelUp.from} → Lv.{r.levelUp.to}
                            </div>
                          )}
                        </div>
                      );
                    }

                    // 任务完成奖励展示
                    if (tc.tool === "update_quest" && tc.data?.status === "completed" && tc.data?.rewards) {
                      const r = tc.data.rewards;
                      return (
                        <div key={i} className="mt-3 rounded-xl border border-success/20 bg-success/5 p-3">
                          <div className="mb-2 flex items-center gap-2 text-xs font-bold text-success-dark">
                            <span>✅</span>
                            <span>任务完成！获得奖励：</span>
                          </div>
                          <div className="flex flex-wrap gap-3 text-xs">
                            {r.exp > 0 && (
                              <span className="flex items-center gap-1 font-medium text-foreground">
                                <span className="text-info">Exp</span> +{r.exp}
                              </span>
                            )}
                            {r.gold > 0 && (
                              <span className="flex items-center gap-1 font-medium text-foreground">
                                <span className="text-warning">Gold</span> +{r.gold}
                              </span>
                            )}
                            {r.spiritStones > 0 && (
                              <span className="flex items-center gap-1 font-medium text-foreground">
                                <span className="text-purple-500">灵石</span> +{r.spiritStones}
                              </span>
                            )}
                            {r.items && r.items.length > 0 && (
                              <div className="flex items-center gap-1">
                                <span className="text-muted">物品:</span>
                                {r.items.map((item: any, idx: number) => (
                                  <span key={idx} className={`rounded px-1.5 py-0.5 bg-background border border-border text-[10px] ${
                                    item.quality === 'uncommon' ? 'text-success border-success/30' :
                                    item.quality === 'rare' ? 'text-info border-info/30' :
                                    item.quality === 'epic' ? 'text-purple-500 border-purple-500/30' :
                                    item.quality === 'legendary' ? 'text-warning border-warning/30' :
                                    'text-foreground'
                                  }`}>
                                    {item.name}
                                  </span>
                                ))}
                              </div>
                            )}
                          </div>
                        </div>
                      );
                    }

                    return null;
                  })}
                </div>
              );
            })()
          ) : (
            <div className="flex flex-col gap-2 min-w-[120px]">
              {/* 阶段 1: 整理数据 */}
              {message.loadingStage === "preparing" && (
                <div className="flex items-center gap-2 text-muted text-xs animate-pulse">
                  <span className="text-lg">📂</span>
                  <span>正在整理记忆与状态...</span>
                </div>
              )}

              {/* 阶段 2: AI 思考 */}
              {(message.loadingStage === "thinking" || !message.loadingStage) && (
                <div className="flex items-center gap-2 text-muted text-xs">
                  <span className="animate-spin text-lg">⏳</span>
                  <span className="animate-thinking">
                    Game Master 正在思考<span>.</span><span>.</span><span>.</span>
                  </span>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
      <div className="shrink-0 pt-2 flex items-center gap-0.5">
        <CopyButton content={message.content} isStreaming={message.isStreaming} />
        <ViewRawButton content={message.content} isStreaming={message.isStreaming} />
        {onDelete && (
          <DeleteButton
            onDelete={() => onDelete(message.id)}
            isStreaming={message.isStreaming}
          />
        )}
      </div>
    </div>
  );
}
