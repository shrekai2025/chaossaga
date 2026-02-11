"use client";

/**
 * 任务 Tab
 * 展示玩家当前的任务列表（进行中、已完成）
 */

import { useState, useEffect } from "react";

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

export default function MissionTab({ playerId }: { playerId: string }) {
  const [quests, setQuests] = useState<QuestEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedQuestId, setExpandedQuestId] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    fetch(`/api/player?id=${playerId}`)
      .then((r) => r.json())
      .then((data) => {
        if (data.success) {
          setQuests(data.data.quests || []);
        }
      })
      .catch((err) => console.error("Failed to load quests:", err))
      .finally(() => setLoading(false));
  }, [playerId]);

  const toggleExpand = (id: string) => {
    setExpandedQuestId(expandedQuestId === id ? null : id);
  };

  const active = quests.filter((q) => q.status === "active");
  const completed = quests.filter((q) => q.status === "completed");

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center">
        <p className="text-sm text-muted">加载任务中...</p>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col overflow-y-auto bg-background p-4">
      <h2 className="mb-4 text-lg font-bold">任务列表</h2>

      {true ? ( // always render the container for layout consistency
          <div className="space-y-6 pb-20">
          {quests.length === 0 && (
             <div className="flex flex-1 items-center justify-center text-muted py-10">
              暂无任务
            </div>
          )}

          {/* 进行中 */}
          {active.length > 0 && (
          <div>
            <h3 className="mb-3 flex items-center gap-2 text-sm font-medium text-primary">
              <span>🚀</span> 进行中 ({active.length})
            </h3>
              <div className="space-y-3">
                {active.map((q) => (
                  <div
                    key={q.id}
                    onClick={() => toggleExpand(q.id)}
                    className={`cursor-pointer rounded-xl border border-border bg-card p-4 transition-all hover:bg-accent/5 ${
                      expandedQuestId === q.id ? "ring-1 ring-primary/20" : ""
                    }`}
                  >
                    <div className="flex items-start justify-between">
                      <div className="flex items-center gap-3">
                        <div className="flex h-8 w-8 items-center justify-center rounded-full bg-accent/10 text-lg">
                          {TYPE_ICONS[q.quest.type] || "📋"}
                        </div>
                        <div>
                          <h4 className="text-sm font-semibold text-foreground">
                            {q.quest.name}
                          </h4>
                          <p className={`text-xs text-muted ${expandedQuestId === q.id ? "" : "line-clamp-1"}`}>
                            {q.quest.description}
                          </p>
                        </div>
                      </div>
                      <div className="text-xs text-muted shrink-0 ml-2">
                        {expandedQuestId === q.id ? "收起" : "详情"}
                      </div>
                    </div>

                    {/* 详情展开区域 */}
                    {expandedQuestId === q.id && (
                      <div className="mt-4 space-y-3 border-t border-border pt-3 animate-in fade-in slide-in-from-top-1">
                        
                        {/* 目标进度 */}
                        <div className="space-y-3 rounded-lg bg-background/50 p-3">
                          <p className="text-[10px] font-medium text-muted uppercase tracking-wider">
                            任务目标
                          </p>
                          {q.quest.objectives.map((obj, i) => {
                            const prog = q.progress[i];
                            const target = obj.targetCount ?? 1;
                            const current = prog?.currentCount ?? 0;
                            const done = prog?.completed ?? false;
                            
                            // 计算进度百分比
                            const percent = Math.min(100, Math.floor((current / target) * 100));

                            return (
                              <div key={i} className="space-y-1.5">
                                <div className="flex items-center justify-between text-xs">
                                  <span className={done ? "text-muted line-through decoration-muted/50" : "text-foreground"}>
                                    {obj.description}
                                  </span>
                                  <span className={`font-mono text-[10px] ${done ? "text-success" : "text-muted"}`}>
                                    {current}/{target}
                                  </span>
                                </div>
                                {/* 进度条 */}
                                <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted/20">
                                  <div 
                                    className={`h-full transition-all duration-300 ${done ? "bg-success" : "bg-primary"}`}
                                    style={{ width: `${percent}%` }}
                                  />
                                </div>
                              </div>
                            );
                          })}
                        </div>

                        {/* 奖励 */}
                        <div className="flex items-center gap-4 text-xs pt-1">
                          {q.quest.rewards.exp && (
                            <div className="flex items-center gap-1.5 text-blue-400 font-medium">
                              <span>✨</span>
                              <span>+{q.quest.rewards.exp} 经验</span>
                            </div>
                          )}
                          {q.quest.rewards.gold && (
                            <div className="flex items-center gap-1.5 text-yellow-500 font-medium">
                              <span>💰</span>
                              <span>+{q.quest.rewards.gold} 金币</span>
                            </div>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>
          </div>
          )}

          {/* 已完成 */}
          {completed.length > 0 && (
            <div>
              <h3 className="mb-3 flex items-center gap-2 text-sm font-medium text-muted">
                <span>🏁</span> 已完成 ({completed.length})
              </h3>
              <div className="space-y-2">
                {completed.map((q) => (
                  <div
                    key={q.id}
                    onClick={() => toggleExpand(q.id)}
                    className="cursor-pointer rounded-lg border border-border/50 bg-card/30 p-3 hover:bg-card/50 transition-colors"
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className="text-success text-sm">✅</span>
                        <div className="flex flex-col">
                           <span className="text-sm text-muted font-medium decoration-muted/50 line-through">
                             {q.quest.name}
                           </span>
                        </div>
                      </div>
                       <span className="text-[10px] text-muted/50">已完成</span>
                    </div>
                    {/* 展开显示详情 */}
                    {expandedQuestId === q.id && (
                      <div className="mt-2 border-t border-border/50 pt-2 text-xs text-muted/70 animate-in fade-in">
                         <p>{q.quest.description}</p>
                         <div className="mt-2 text-[10px]">
                            奖励已领取
                         </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}
