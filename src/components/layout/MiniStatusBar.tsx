"use client";

/**
 * 顶部迷你状态条
 *
 * 始终显示：角色名 + HP/MP 迷你条 + 清除聊天按钮
 * 高度 36px，紧凑信息展示。
 */

import { useState } from "react";
import type { PlayerState } from "@/hooks/useGameChat";

export default function MiniStatusBar({
  player,
  onClearChat,
}: {
  player: PlayerState | null;
  onClearChat?: () => void;
}) {
  const [confirmingClear, setConfirmingClear] = useState(false);

  if (!player) return null;

  const hpPct = player.maxHp > 0 ? (player.hp / player.maxHp) * 100 : 0;
  const mpPct = player.maxMp > 0 ? (player.mp / player.maxMp) * 100 : 0;

  const handleClear = () => {
    if (onClearChat) {
      onClearChat();
    }
    setConfirmingClear(false);
  };

  return (
    <div className="flex h-9 items-center gap-3 border-b border-border bg-surface px-4">
      {/* 角色名 + 等级 */}
      <span className="shrink-0 text-xs font-semibold text-foreground">
        {player.name}
      </span>
      <span className="shrink-0 text-[10px] text-muted">
        Lv.{player.level}
      </span>

      {/* HP 迷你条 */}
      <div className="flex items-center gap-1.5">
        <span className="text-[10px] font-medium text-danger">HP</span>
        <div className="h-1.5 w-16 overflow-hidden rounded-full bg-border-light">
          <div
            className="h-full rounded-full bar-hp transition-all duration-500"
            style={{ width: `${hpPct}%` }}
          />
        </div>
        <span className="text-[10px] tabular-nums text-muted">
          {player.hp}/{player.maxHp}
        </span>
      </div>

      {/* MP 迷你条 */}
      <div className="flex items-center gap-1.5">
        <span className="text-[10px] font-medium text-accent">MP</span>
        <div className="h-1.5 w-12 overflow-hidden rounded-full bg-border-light">
          <div
            className="h-full rounded-full bar-mp transition-all duration-500"
            style={{ width: `${mpPct}%` }}
          />
        </div>
        <span className="text-[10px] tabular-nums text-muted">
          {player.mp}/{player.maxMp}
        </span>
      </div>

      {/* 右端：金币 + 清除聊天按钮 */}
      <div className="ml-auto flex items-center gap-2">
        <span className="text-[10px] text-warning">{player.gold}G</span>

        {/* 清除聊天按钮 */}
        {onClearChat && (
          confirmingClear ? (
            <span className="flex items-center gap-1">
              <button
                onClick={handleClear}
                className="rounded bg-danger/10 px-1.5 py-0.5 text-[10px] text-danger hover:bg-danger/20"
              >
                确认清除
              </button>
              <button
                onClick={() => setConfirmingClear(false)}
                className="rounded px-1.5 py-0.5 text-[10px] text-muted hover:text-foreground"
              >
                取消
              </button>
            </span>
          ) : (
            <button
              onClick={() => setConfirmingClear(true)}
              className="rounded p-1 text-muted transition-colors hover:bg-danger/10 hover:text-danger"
              title="清除聊天记录，重新开始冒险"
            >
              <svg
                width="14"
                height="14"
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
                <line x1="10" y1="11" x2="10" y2="17" />
                <line x1="14" y1="11" x2="14" y2="17" />
              </svg>
            </button>
          )
        )}
      </div>
    </div>
  );
}

