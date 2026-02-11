"use client";

/**
 * 任务面板
 */

import { useState, useEffect } from "react";
import GamePanel from "./GamePanel";

interface QuestEntry {
  id: string;
  status: string;
  progress: Array<{ currentCount: number; completed: boolean }>;
  quest: {
    id: string;
    name: string;
    description: string;
    type: string;
    objectives: Array<{
      description: string;
      targetCount?: number;
    }>;
    rewards: {
      exp?: number;
      gold?: number;
    };
  };
}

const TYPE_ICONS: Record<string, string> = {
  fetch: "📦",
  kill: "⚔️",
  riddle: "🧩",
  escort: "🛡️",
  explore: "🗺️",
};

export default function QuestPanel({
  isOpen,
  onClose,
  playerId,
}: {
  isOpen: boolean;
  onClose: () => void;
  playerId: string;
}) {
  const [quests, setQuests] = useState<QuestEntry[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!isOpen) return;
    setLoading(true);
    fetch(`/api/player?id=${playerId}`)
      .then((r) => r.json())
      .then((data) => {
        if (data.success) setQuests(data.data.quests || []);
      })
      .finally(() => setLoading(false));
  }, [isOpen, playerId]);

  const active = quests.filter((q) => q.status === "active");
  const completed = quests.filter((q) => q.status === "completed");

  return (
    <GamePanel title="📜 任务" isOpen={isOpen} onClose={onClose}>
      {loading ? (
        <p className="text-center text-sm text-muted">加载中...</p>
      ) : quests.length === 0 ? (
        <p className="text-center text-sm text-muted">暂无任务</p>
      ) : (
        <div className="space-y-4">
          {/* 进行中 */}
          {active.length > 0 && (
            <div>
              <h4 className="mb-2 text-xs font-medium text-muted">
                进行中 ({active.length})
              </h4>
              <div className="space-y-2">
                {active.map((q) => (
                  <div
                    key={q.id}
                    className="rounded-lg border border-border bg-background p-3"
                  >
                    <div className="flex items-center gap-1.5">
                      <span>{TYPE_ICONS[q.quest.type] || "📋"}</span>
                      <span className="text-sm font-medium text-foreground">
                        {q.quest.name}
                      </span>
                    </div>
                    <p className="mt-1 text-xs text-muted">
                      {q.quest.description}
                    </p>
                    {/* 目标进度 */}
                    <div className="mt-2 space-y-1">
                      {q.quest.objectives.map((obj, i) => {
                        const prog = q.progress[i];
                        const target = obj.targetCount ?? 1;
                        const current = prog?.currentCount ?? 0;
                        const done = prog?.completed ?? false;
                        return (
                          <div
                            key={i}
                            className={`flex items-center gap-1.5 text-[11px] ${done ? "text-success" : "text-muted"}`}
                          >
                            <span>{done ? "✓" : "○"}</span>
                            <span>{obj.description}</span>
                            {target > 1 && (
                              <span className="ml-auto">
                                {current}/{target}
                              </span>
                            )}
                          </div>
                        );
                      })}
                    </div>
                    {/* 奖励 */}
                    <div className="mt-2 flex gap-3 text-[10px] text-muted">
                      {q.quest.rewards.exp && (
                        <span>经验 +{q.quest.rewards.exp}</span>
                      )}
                      {q.quest.rewards.gold && (
                        <span style={{ color: "var(--gold)" }}>
                          金币 +{q.quest.rewards.gold}
                        </span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* 已完成 */}
          {completed.length > 0 && (
            <div>
              <h4 className="mb-2 text-xs font-medium text-muted">
                已完成 ({completed.length})
              </h4>
              <div className="space-y-1.5">
                {completed.map((q) => (
                  <div
                    key={q.id}
                    className="flex items-center gap-2 rounded-lg border border-border/50 bg-background/50 p-2.5 opacity-60"
                  >
                    <span className="text-success">✓</span>
                    <span className="text-xs text-muted">{q.quest.name}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </GamePanel>
  );
}
