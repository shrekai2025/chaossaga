"use client";

/**
 * 游戏 Tab — 核心聊天交互
 */

import type { GameMessage } from "@/hooks/useGameChat";
import ChatWindow from "@/components/chat/ChatWindow";

export default function GameTab({
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
  return (
    <div className="animate-tab-in flex h-full flex-col">
      <ChatWindow
        messages={messages}
        isLoading={isLoading}
        onSend={onSend}
        onDelete={onDelete}
        hasMoreHistory={hasMoreHistory}
        loadingHistory={loadingHistory}
        onLoadMore={onLoadMore}
        onAbort={onAbort}
      />
      {/* 临时调试信息 */}
    </div>
  );
}
