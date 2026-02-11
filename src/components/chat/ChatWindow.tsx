"use client";

/**
 * 聊天窗口主组件
 *
 * 包含：消息列表 + 输入框 + 发送按钮
 * 支持 SSE 流式渲染和快捷按钮。
 */

import { useState, useRef, useEffect } from "react";
import type { GameMessage } from "@/hooks/useGameChat";
import MessageBubble from "./MessageBubble";
import ActionButtons from "./ActionButtons";

export default function ChatWindow({
  messages,
  isLoading,
  onSend,
  onDelete,
  hasMoreHistory,
  loadingHistory,
  onLoadMore,
  onAbort,
}: {
  messages: GameMessage[];
  isLoading: boolean;
  onSend: (text: string) => void;
  onDelete?: (id: string) => void;
  hasMoreHistory?: boolean;
  loadingHistory?: boolean;
  onLoadMore?: () => void;
  onAbort?: () => void;
}) {
  const [input, setInput] = useState("");
  // 追踪哪条消息的 action 已被使用（消息 ID）
  const [actionUsedForMsgId, setActionUsedForMsgId] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  // 自动滚动到底部（仅在新消息时）
  const prevMsgCount = useRef(messages.length);
  useEffect(() => {
    if (messages.length > prevMsgCount.current) {
      const addedAtEnd =
        messages.length > 0 &&
        prevMsgCount.current > 0 &&
        messages[messages.length - 1]?.id !==
          messages[prevMsgCount.current - 1]?.id;
      if (addedAtEnd || prevMsgCount.current === 0) {
        bottomRef.current?.scrollIntoView({ behavior: "smooth" });
      }
    }
    prevMsgCount.current = messages.length;
  }, [messages]);

  // 初次加载时滚到底部
  const initialScrollDone = useRef(false);
  useEffect(() => {
    if (messages.length > 0 && !initialScrollDone.current) {
      bottomRef.current?.scrollIntoView();
      initialScrollDone.current = true;
    }
  }, [messages]);

  // 自动聚焦输入框
  useEffect(() => {
    if (!isLoading) inputRef.current?.focus();
  }, [isLoading]);

  const handleSend = () => {
    const text = input.trim();
    if (!text || isLoading) return;
    setInput("");
    onSend(text);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    // 如果正在加载，不处理 Enter 键发送
    if (isLoading) return;
    
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  // 获取最后一条 AI 消息的 actions
  const lastAiMsg = [...messages].reverse().find((m) => m.role === "assistant");
  // 只有当前消息的 action 未被使用时才显示
  const showActions =
    lastAiMsg?.actions &&
    lastAiMsg.actions.length > 0 &&
    !lastAiMsg.isStreaming &&
    actionUsedForMsgId !== lastAiMsg.id;

  return (
    <div className="flex h-full flex-col">
      {/* 消息列表 */}
      <div ref={scrollContainerRef} className="flex-1 overflow-y-auto px-3 py-3 sm:px-4">
        {/* 加载更多 */}
        {hasMoreHistory && (
          <div className="mb-3 text-center">
            <button
              onClick={onLoadMore}
              disabled={loadingHistory}
              className="rounded-full border border-border bg-surface px-4 py-1.5 text-[11px] text-muted transition-colors hover:text-foreground disabled:opacity-50"
            >
              {loadingHistory ? "加载中..." : "↑ 加载更早的对话"}
            </button>
          </div>
        )}

        {messages.length === 0 && (
          <div className="flex h-full items-center justify-center">
            <div className="text-center text-muted">
              <p className="text-3xl">⚔️</p>
              <p className="mt-2 text-sm">向 Game Master 说点什么吧</p>
              <p className="mt-1 text-[11px] text-muted/60">
                试试：&quot;我在哪？&quot; 或 &quot;带我去冒险&quot;
              </p>
            </div>
          </div>
        )}

        {messages.map((msg) => (
          <MessageBubble key={msg.id} message={msg} onDelete={onDelete} />
        ))}

        {/* 快捷按钮 */}
        {showActions && (
          <ActionButtons
            actions={lastAiMsg!.actions!}
            onAction={(v) => {
              setActionUsedForMsgId(lastAiMsg!.id);
              onSend(v);
            }}
            disabled={isLoading}
          />
        )}

        <div ref={bottomRef} />
      </div>

      {/* 输入区域 */}
      <div className="border-t border-border bg-surface px-3 py-2.5 sm:px-4">
        <div className="flex gap-2">
          <input
            ref={inputRef}
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={isLoading ? "Game Master 正在思考..." : "输入你的行动..."}
            disabled={isLoading}
            className="flex-1 rounded-xl border border-border bg-background px-4 py-2.5 text-sm text-foreground placeholder-muted/50 outline-none transition-colors focus:border-accent disabled:opacity-50"
          />
          {isLoading ? (
            <button
              onClick={onAbort}
              className="rounded-xl bg-danger/10 border border-danger/20 px-5 py-2.5 text-sm font-medium text-danger transition-colors hover:bg-danger/20"
              title="停止生成"
            >
              <span className="flex items-center gap-1.5">
                <span className="h-2.5 w-2.5 rounded-sm bg-danger animate-pulse"></span>
                停止
              </span>
            </button>
          ) : (
            <button
              onClick={handleSend}
              disabled={!input.trim()}
              className="rounded-xl bg-accent px-5 py-2.5 text-sm font-medium text-white transition-colors hover:bg-accent-dim disabled:cursor-not-allowed disabled:opacity-40"
            >
              发送
            </button>
          )}
        </div>
        <p className="mt-1.5 text-center text-[10px] text-muted/40">
          输入自然语言与 AI Game Master 互动 · /gm 进入GM模式
        </p>
      </div>
    </div>
  );
}
