"use client";

/**
 * 游戏视觉区组件
 *
 * 占据游戏 Tab 上方 1/3 区域，根据模式展示不同内容：
 * - 探索模式：区域名-地点名 + NPC 列表
 * - 战斗模式：区域名-地点名 + 敌人列表（含 HP/MP 条）
 */

import { useEffect, useState, useRef, useCallback } from "react";

interface NpcInfo {
  name: string;
  role?: string;
}

interface EnemyInfo {
  name: string;
  level: number;
  hp: number;
  maxHp: number;
  mp: number;
  maxMp: number;
}

interface SkillInfo {
  name: string;
  element: string;
  mpCost: number;
  damage: number;
  effect: unknown;
}

interface VisualData {
  areaName: string;
  nodeName: string;
  nodeType: string;
  isBattle: boolean;
  npcs: NpcInfo[];
  enemies: EnemyInfo[];
  skills: SkillInfo[];
}

/** NPC 角色对应的图标 */
function npcRoleIcon(role?: string): string {
  switch (role) {
    case "shopkeeper":
    case "merchant":
      return "🛒";
    case "quest_giver":
      return "❗";
    case "guard":
      return "🛡️";
    case "healer":
      return "💚";
    case "elder":
    case "chief":
      return "👑";
    case "blacksmith":
      return "🔨";
    case "trainer":
      return "⚔️";
    default:
      return "💬";
  }
}

/** 技能元素对应的图标 */
function elementIcon(element: string): string {
  switch (element) {
    case "water":
      return "💧";
    case "fire":
      return "🔥";
    case "earth":
      return "🪨";
    case "wind":
      return "🌪️";
    case "thunder":
    case "lightning":
      return "⚡";
    case "ice":
      return "❄️";
    case "light":
      return "✨";
    case "dark":
      return "🌑";
    default:
      return "🔮";
  }
}

/** 地点类型对应的图标 */
function nodeTypeIcon(type: string): string {
  switch (type) {
    case "safe":
      return "🏘️";
    case "battle":
      return "⚔️";
    case "npc":
      return "👤";
    case "boss":
      return "💀";
    case "event":
      return "✨";
    case "shop":
      return "🏪";
    default:
      return "📍";
  }
}

export default function GameVisualZone({
  playerId,
  isBattle,
  currentNodeId,
  isLoading,
  onSend,
}: {
  playerId: string;
  isBattle?: boolean;
  currentNodeId?: string;
  /** 聊天是否正在加载（用于在交互结束后刷新视觉数据） */
  isLoading?: boolean;
  /** 发送消息到聊天（用于战斗快捷按钮） */
  onSend?: (text: string) => void;
}) {
  const [data, setData] = useState<VisualData | null>(null);
  const [loading, setLoading] = useState(true);
  const [transitioning, setTransitioning] = useState(false);
  const prevNodeIdRef = useRef(currentNodeId);
  const prevIsBattleRef = useRef(isBattle);
  const prevIsLoadingRef = useRef(isLoading);

  const fetchVisual = useCallback(async () => {
    try {
      const res = await fetch(`/api/game/visual?playerId=${playerId}`, {
        cache: "no-store",
      });
      const json = await res.json();
      if (json.success) {
        setData(json.data);
      }
    } catch {
      // 静默失败
    } finally {
      setLoading(false);
    }
  }, [playerId]);

  // 初始加载 & 当 playerState 关键字段变化时刷新（带过渡动画）
  useEffect(() => {
    const nodeChanged = prevNodeIdRef.current !== currentNodeId;
    const battleChanged = prevIsBattleRef.current !== isBattle;

    if (nodeChanged || battleChanged) {
      setTransitioning(true);
      // 短暂延迟让淡出动画执行
      const timer = setTimeout(() => {
        fetchVisual().then(() => setTransitioning(false));
      }, 200);
      prevNodeIdRef.current = currentNodeId;
      prevIsBattleRef.current = isBattle;
      return () => clearTimeout(timer);
    } else {
      fetchVisual();
    }
  }, [currentNodeId, isBattle, fetchVisual]);

  // 每次聊天交互结束后（isLoading true→false），静默刷新视觉数据
  // 这保证了战斗中敌人 HP/MP 能及时更新
  useEffect(() => {
    const wasLoading = prevIsLoadingRef.current;
    prevIsLoadingRef.current = isLoading;

    // isLoading 从 true 变为 false => 一次交互刚结束，刷新数据
    if (wasLoading && !isLoading) {
      fetchVisual();
    }
  }, [isLoading, fetchVisual]);

  if (loading && !data) {
    return (
      <div className="flex h-full items-center justify-center bg-linear-to-b from-accent-light/50 to-background">
        <p className="text-xs text-muted animate-pulse">加载视觉数据...</p>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="flex h-full items-center justify-center bg-linear-to-b from-accent-light/50 to-background">
        <p className="text-xs text-muted">无法获取场景数据</p>
      </div>
    );
  }

  return (
    <div
      className={`flex h-full flex-col transition-opacity duration-200 ${
        transitioning ? "opacity-0" : "opacity-100"
      }`}
    >
      {data.isBattle ? (
        <BattleView
          areaName={data.areaName}
          nodeName={data.nodeName}
          enemies={data.enemies}
          skills={data.skills}
          onSend={onSend}
          disabled={isLoading}
        />
      ) : (
        <ExploreView
          areaName={data.areaName}
          nodeName={data.nodeName}
          nodeType={data.nodeType}
          npcs={data.npcs}
        />
      )}
    </div>
  );
}

/* ============================
   探索模式视图
   ============================ */
function ExploreView({
  areaName,
  nodeName,
  nodeType,
  npcs,
}: {
  areaName: string;
  nodeName: string;
  nodeType: string;
  npcs: NpcInfo[];
}) {
  return (
    <div className="relative flex h-full flex-col overflow-hidden bg-linear-to-br from-[#eef4ff] via-[#f0f6ff] to-[#f8f9fb]">
      {/* 装饰背景 */}
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute -right-8 -top-8 h-32 w-32 rounded-full bg-accent/5" />
        <div className="absolute -left-4 bottom-0 h-24 w-24 rounded-full bg-accent/3" />
      </div>

      {/* 地点信息 */}
      <div className="relative z-10 flex flex-col items-center px-4 pt-3 pb-2">
        <div className="flex items-center gap-1.5 text-[11px] text-muted/70 uppercase tracking-wider">
          <span>{nodeTypeIcon(nodeType)}</span>
          <span>{areaName}</span>
        </div>
        <h2 className="mt-0.5 text-base font-bold text-foreground tracking-wide">
          {nodeName}
        </h2>
      </div>

      {/* NPC 列表 */}
      {npcs.length > 0 && (
        <div className="relative z-10 flex flex-1 items-center justify-center px-4 pb-3">
          <div className="flex flex-wrap justify-center gap-2">
            {npcs.map((npc) => (
              <div
                key={npc.name}
                className="flex items-center gap-1.5 rounded-full border border-border-light bg-surface/80 px-3 py-1 shadow-(--shadow-sm) backdrop-blur-sm"
              >
                <span className="text-sm">{npcRoleIcon(npc.role)}</span>
                <span className="text-xs font-medium text-foreground">
                  {npc.name}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 无 NPC 时的提示 */}
      {npcs.length === 0 && (
        <div className="relative z-10 flex flex-1 items-center justify-center px-4 pb-3">
          <p className="text-[11px] text-muted/50">四周一片寂静...</p>
        </div>
      )}
    </div>
  );
}

/* ============================
   战斗模式视图
   ============================ */
function BattleView({
  areaName,
  nodeName,
  enemies,
  skills,
  onSend,
  disabled,
}: {
  areaName: string;
  nodeName: string;
  enemies: EnemyInfo[];
  skills: SkillInfo[];
  onSend?: (text: string) => void;
  disabled?: boolean;
}) {
  return (
    <div className="relative flex h-full flex-col overflow-hidden bg-linear-to-br from-[#fff0f0] via-[#fff5f3] to-[#faf8f8]">
      {/* 战斗装饰 */}
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute -right-6 -top-6 h-28 w-28 rounded-full bg-danger/5" />
        <div className="absolute -left-4 bottom-0 h-20 w-20 rounded-full bg-danger/3" />
      </div>

      {/* 战斗标题 */}
      <div className="relative z-10 flex flex-col items-center px-4 pt-2 pb-1">
        <div className="flex items-center gap-1.5 text-[11px] uppercase tracking-wider">
          <span className="inline-block h-1.5 w-1.5 rounded-full bg-danger animate-pulse" />
          <span className="font-semibold text-danger/80">战斗中</span>
          <span className="text-muted/50">·</span>
          <span className="text-muted/70">{areaName} - {nodeName}</span>
        </div>
      </div>

      {/* 敌人列表 */}
      <div className="relative z-10 flex flex-1 items-center justify-center px-3">
        <div className="flex flex-wrap justify-center gap-2.5">
          {enemies.map((enemy, idx) => (
            <EnemyCard key={`${enemy.name}-${idx}`} enemy={enemy} />
          ))}
          {enemies.length === 0 && (
            <p className="text-[11px] text-muted/50">未检测到敌人...</p>
          )}
        </div>
      </div>

      {/* 战斗快捷按钮栏 */}
      <div className="relative z-10 shrink-0 border-t border-danger/10 bg-surface/60 backdrop-blur-sm px-3 py-1.5">
        <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar">
          {/* 普攻按钮 */}
          <button
            onClick={() => onSend?.("普通攻击")}
            disabled={disabled}
            className="shrink-0 flex items-center gap-1 rounded-lg border border-border bg-surface px-2.5 py-1 text-[11px] font-medium text-foreground shadow-sm transition-colors hover:border-accent/40 hover:bg-accent/5 active:scale-95 disabled:opacity-40 disabled:pointer-events-none"
          >
            <span className="text-xs">⚔️</span>
            <span>普攻</span>
          </button>

          {/* 技能按钮 */}
          {skills.map((skill) => {
            const isHeal = skill.damage === 0 && (skill.effect as { type?: string })?.type === "heal";
            return (
              <button
                key={skill.name}
                onClick={() => onSend?.(`使用技能「${skill.name}」`)}
                disabled={disabled}
                className={`shrink-0 flex items-center gap-1 rounded-lg border px-2.5 py-1 text-[11px] font-medium shadow-sm transition-colors active:scale-95 disabled:opacity-40 disabled:pointer-events-none ${
                  isHeal
                    ? "border-emerald-500/20 bg-emerald-500/5 text-emerald-700 hover:bg-emerald-500/10"
                    : "border-accent/20 bg-accent/5 text-accent-dim hover:bg-accent/10"
                }`}
                title={`消耗 ${skill.mpCost} MP`}
              >
                <span className="text-xs">{elementIcon(skill.element)}</span>
                <span>{skill.name}</span>
                <span className="text-[9px] text-muted/60">{skill.mpCost}</span>
              </button>
            );
          })}

          {/* 逃跑按钮 */}
          <button
            onClick={() => onSend?.("尝试逃跑")}
            disabled={disabled}
            className="shrink-0 flex items-center gap-1 rounded-lg border border-warning/20 bg-warning/5 px-2.5 py-1 text-[11px] font-medium text-warning shadow-sm transition-colors hover:bg-warning/10 active:scale-95 disabled:opacity-40 disabled:pointer-events-none"
          >
            <span className="text-xs">🏃</span>
            <span>逃跑</span>
          </button>
        </div>
      </div>
    </div>
  );
}

/* ============================
   单个敌人卡片
   ============================ */
function EnemyCard({ enemy }: { enemy: EnemyInfo }) {
  const hpPercent = enemy.maxHp > 0 ? (enemy.hp / enemy.maxHp) * 100 : 0;
  const mpPercent = enemy.maxMp > 0 ? (enemy.mp / enemy.maxMp) * 100 : 0;

  return (
    <div className="w-[130px] rounded-xl border border-danger/10 bg-surface/90 p-2.5 shadow-(--shadow-sm) backdrop-blur-sm">
      {/* 敌人名称 + 等级 */}
      <div className="mb-1.5 flex items-center justify-between">
        <span className="text-xs font-bold text-foreground truncate">
          {enemy.name}
        </span>
        <span className="ml-1 shrink-0 text-[10px] text-muted/60">
          Lv.{enemy.level}
        </span>
      </div>

      {/* HP 条 */}
      <div className="mb-1">
        <div className="mb-0.5 flex items-center justify-between">
          <span className="text-[9px] font-medium text-danger/70">HP</span>
          <span className="text-[9px] tabular-nums text-muted/60">
            {enemy.hp}/{enemy.maxHp}
          </span>
        </div>
        <div className="h-1.5 w-full overflow-hidden rounded-full bg-danger/10">
          <div
            className="bar-hp h-full rounded-full transition-all duration-500"
            style={{ width: `${hpPercent}%` }}
          />
        </div>
      </div>

      {/* MP 条 */}
      {enemy.maxMp > 0 && (
        <div>
          <div className="mb-0.5 flex items-center justify-between">
            <span className="text-[9px] font-medium text-info/70">MP</span>
            <span className="text-[9px] tabular-nums text-muted/60">
              {enemy.mp}/{enemy.maxMp}
            </span>
          </div>
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-info/10">
            <div
              className="bar-mp h-full rounded-full transition-all duration-500"
              style={{ width: `${mpPercent}%` }}
            />
          </div>
        </div>
      )}
    </div>
  );
}
