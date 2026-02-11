"use client";

import { useState, useEffect } from "react";
import GamePanel from "./GamePanel";

interface PlayerLog {
  id: string;
  type: string;
  content: string;
  changes?: Record<string, any>;
  createdAt: string;
}

const TYPE_CONFIG: Record<string, { icon: string; color: string; label: string }> = {
  battle: { icon: "⚔️", color: "text-red-500", label: "战斗" },
  battle_win: { icon: "🏆", color: "text-amber-500", label: "胜利" },
  battle_loss: { icon: "☠️", color: "text-gray-500", label: "失败" },
  item_use: { icon: "🧪", color: "text-blue-500", label: "物品" },
  levelup: { icon: "🆙", color: "text-yellow-500", label: "升级" },
  move: { icon: "🦶", color: "text-emerald-500", label: "移动" },
  quest: { icon: "📜", color: "text-purple-500", label: "任务" },
  info: { icon: "ℹ️", color: "text-muted", label: "信息" },
};

export default function LogPanel({
  isOpen,
  onClose,
  playerId,
}: {
  isOpen: boolean;
  onClose: () => void;
  playerId: string;
}) {
  const [logs, setLogs] = useState<PlayerLog[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!isOpen) return;
    setLoading(true);
    fetch(`/api/player/logs?playerId=${playerId}`)
      .then((r) => r.json())
      .then((data) => {
        if (data.success) setLogs(data.data || []);
      })
      .finally(() => setLoading(false));
  }, [isOpen, playerId]);

  // Format time to HH:mm:ss
  const formatTime = (iso: string) => {
    const d = new Date(iso);
    return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  };

  return (
    <GamePanel title="📝 冒险日志" isOpen={isOpen} onClose={onClose}>
      {loading ? (
        <p className="text-center text-sm text-muted">加载中...</p>
      ) : logs.length === 0 ? (
        <p className="text-center text-sm text-muted">暂无日志</p>
      ) : (
        <div className="space-y-3">
          {logs.map((log) => {
            const config = TYPE_CONFIG[log.type] || TYPE_CONFIG["info"];
            return (
              <div
                key={log.id}
                className="relative flex flex-col gap-1 rounded-lg border border-border bg-background p-2.5 text-sm"
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="text-base" title={config.label}>{config.icon}</span>
                    <span className={`font-medium ${config.color}`}>{config.label}</span>
                  </div>
                  <span className="text-[10px] text-muted">{formatTime(log.createdAt)}</span>
                </div>
                
                <div className="pl-6 text-foreground/90">
                  {log.content}
                </div>

                {log.changes && Object.keys(log.changes).length > 0 && (
                  <div className="mt-1 flex flex-wrap gap-2 pl-6">
                    {Object.entries(log.changes).map(([key, val]) => (
                      <span key={key} className="rounded bg-accent/5 px-1.5 py-0.5 text-[10px] text-muted-foreground border border-border/50">
                        {key}: <span className="font-mono">{String(val)}</span>
                      </span>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </GamePanel>
  );
}
