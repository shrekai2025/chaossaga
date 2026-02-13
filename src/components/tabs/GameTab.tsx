"use client";

/**
 * 游戏 Tab — 核心聊天交互
 *
 * 布局：上 1/3 视觉区 + 下 2/3 对话区
 */

import type { GameMessage, PlayerState } from "@/hooks/useGameChat";
import ChatWindow from "@/components/chat/ChatWindow";
import GameVisualZone from "@/components/game/GameVisualZone";

export default function GameTab({
  messages,
  isLoading,
  onSend,
  onQuickBattleAction,
  onDelete,
  hasMoreHistory,
  loadingHistory,
  onLoadMore,
  onAbort,
  playerState,
}: {
  messages: GameMessage[];
  isLoading: boolean;
  onSend: (text: string) => void;
  onQuickBattleAction?: (
    userText: string,
    action: { type: "attack" | "skill"; skillId?: string; targetIndex?: number }
  ) => void;
  onDelete?: (id: string) => void;
  hasMoreHistory?: boolean;
  loadingHistory?: boolean;
  onLoadMore?: () => void;
  onAbort?: () => void;
  playerState?: PlayerState | null;
}) {
  return (
    <div className="animate-tab-in flex h-full flex-col">
      {/* 上 1/3 — 视觉区 */}
      <div className="h-1/3 shrink-0 border-b border-border">
        {playerState?.id ? (
          <GameVisualZone
            playerId={playerState.id}
            isBattle={playerState.isBattle}
            currentNodeId={playerState.currentNodeId}
            isLoading={isLoading}
            onSend={onSend}
            onQuickBattleAction={onQuickBattleAction}
          />
        ) : (
          <div className="flex h-full items-center justify-center bg-linear-to-b from-accent-light/50 to-background">
            <p className="text-xs text-muted">等待玩家数据...</p>
          </div>
        )}
      </div>

      {/* 下 2/3 — 对话区 */}
      <div className="flex-1 overflow-hidden">
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
      </div>
    </div>
  );
}
