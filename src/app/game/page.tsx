"use client";

/**
 * /game — 游戏主界面
 *
 * 布局（移动端优先）：
 *   顶部迷你状态条 (36px)
 *   Tab 内容区 (flex-1)
 *   底部导航栏 (56px)
 *
 * 4 个 Tab：游戏 / 角色 / 图鉴 / 设置
 */

import { useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { useGameStore } from "@/store/gameStore";
import { useGameChat } from "@/hooks/useGameChat";
import MiniStatusBar from "@/components/layout/MiniStatusBar";
import BottomNav from "@/components/layout/BottomNav";
import GameTab from "@/components/tabs/GameTab";
import CharacterTab from "@/components/tabs/CharacterTab";
import MissionTab from "@/components/tabs/MissionTab";
import CodexTab from "@/components/tabs/CodexTab";
import MapTab from "@/components/tabs/MapTab";
import SettingsTab from "@/components/tabs/SettingsTab";
import FloatingToolbar from "@/components/game/FloatingToolbar";

export default function GamePage() {
  const router = useRouter();
  const {
    activeTab,
    setActiveTab,
    isReady,
    setReady,
    playerId,
    setPlayerId
  } = useGameStore();
  
  const {
    messages,
    isLoading,
    playerState,
    loadPlayer,
    loadHistory,
    loadMoreHistory,
    hasMoreHistory,
    loadingHistory,
    sendMessage,
    deleteMessage,
    clearAllMessages,
    triggerResponse,
    abort,
  } = useGameChat();

  // 初始化
  useEffect(() => {
    const storedPlayerId = localStorage.getItem("chaossaga_player_id");
    if (!storedPlayerId) {
      router.push("/");
      return;
    }
    setPlayerId(storedPlayerId);

    async function init() {
      console.log("[GamePage] init called. Loading player and history.");
      const player = await loadPlayer(storedPlayerId!);
      if (!player) {
        localStorage.removeItem("chaossaga_player_id");
        router.push("/");
        return;
      }
      await loadHistory(storedPlayerId!);
      setReady(true);
    }

    init();
  }, [router, loadPlayer, loadHistory, setPlayerId, setReady]);

  const handleLoadMore = useCallback(() => {
    if (playerId) loadMoreHistory(playerId);
  }, [playerId, loadMoreHistory]);

  const handleLogout = useCallback(() => {
    localStorage.removeItem("chaossaga_player_id");
    setPlayerId(null);
    setReady(false);
    router.push("/");
  }, [router, setPlayerId, setReady]);

  const handleClearChat = useCallback(() => {
    if (playerId) {
      clearAllMessages(playerId);
    }
  }, [playerId, clearAllMessages]);

  // 加载态
  if (!isReady) {
    return (
      <div className="flex h-dvh items-center justify-center bg-background">
        <div className="text-center">
          <p className="text-2xl">⚔️</p>
          <p className="mt-2 text-xs text-muted">正在进入游戏世界...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-dvh flex-col bg-background">
      {/* 顶部迷你状态条 */}
      <MiniStatusBar player={playerState} onClearChat={handleClearChat} />

      {/* 全局浮动工具栏 */}
      {playerId && (
        <FloatingToolbar
          playerId={playerId}
          onSendCommand={sendMessage}
          onSystemAction={triggerResponse}
        />
      )}

      {/* Tab 内容区 */}
      <main className="flex-1 overflow-hidden">
        {activeTab === "game" && (
          <GameTab
            messages={messages}
            isLoading={isLoading}
            onSend={sendMessage}
            onDelete={deleteMessage}
            hasMoreHistory={hasMoreHistory}
            loadingHistory={loadingHistory}
            onLoadMore={handleLoadMore}
            onAbort={abort}
            playerState={playerState}
          />
        )}
        {activeTab === "character" && (
          <CharacterTab
            player={playerState}
            onSendCommand={sendMessage}
            onLogout={handleLogout}
          />
        )}
        {activeTab === "mission" && playerId && (
          <MissionTab playerId={playerId} />
        )}
        {activeTab === "codex" && <CodexTab />}
        {activeTab === "map" && playerId && (
          <MapTab playerId={playerId} onAction={triggerResponse} />
        )}
        {activeTab === "settings" && <SettingsTab />}
      </main>

      {/* 底部导航 */}
      <BottomNav activeTab={activeTab} onTabChange={setActiveTab} />
    </div>
  );
}
