"use client";

/**
 * 地图 Tab — 区域列表 + 区域详情（节点/连接/移动）
 *
 * 列表视图：显示所有区域卡片，标注当前位置
 * 详情视图：显示区域节点、连接关系、支持点击移动
 * 操作栏：完整性检查 + 区域扩展
 */

import { useState, useEffect, useCallback, useRef } from "react";

/* ============================
   Types
   ============================ */

interface AreaSummary {
  id: string;
  name: string;
  description: string;
  theme: string;
  recommendedLevel: number;
  nodeCount: number;
  isCurrent: boolean;
}

interface AreaNode {
  id: string;
  name: string;
  type: string;
  description: string;
  data: Record<string, unknown> | null;
}

interface EdgeNodeInfo {
  id: string;
  name: string;
  type: string;
  connectionCount: number;
}

interface AreaDetail {
  id: string;
  name: string;
  description: string;
  theme: string;
  recommendedLevel: number;
  nodes: AreaNode[];
  connections: Array<{ fromId: string; toId: string; from: string; to: string }>;
  currentNodeId: string | null;
  edgeNodes?: EdgeNodeInfo[];
}

/** SSE 操作进度日志条目 */
interface ProgressEntry {
  id: number;
  type: "info" | "issue" | "fix" | "success" | "error" | "node";
  message: string;
  timestamp: number;
}

/* ============================
   Constants
   ============================ */

const THEME_ICONS: Record<string, string> = {
  ocean: "🌊",
  forest: "🌲",
  desert: "🏜️",
  cave: "🕳️",
  city: "🏰",
  mountain: "⛰️",
  swamp: "🪷",
  volcano: "🌋",
  ice: "❄️",
  tea: "🍵",
};

const NODE_TYPE_META: Record<string, { icon: string; label: string; color: string }> = {
  safe: { icon: "🏠", label: "安全区", color: "text-green-600" },
  battle: { icon: "⚔️", label: "战斗区", color: "text-red-500" },
  boss: { icon: "💀", label: "BOSS", color: "text-purple-600" },
  npc: { icon: "🧑", label: "NPC", color: "text-blue-500" },
  shop: { icon: "🛒", label: "商店", color: "text-amber-600" },
  event: { icon: "✨", label: "事件", color: "text-cyan-500" },
};

/* ============================
   Sub-components
   ============================ */

/** 节点数据展示（根据类型展示不同内容） */
function NodeDataView({ node }: { node: AreaNode }) {
  const data = node.data as Record<string, unknown> | null;
  if (!data) return null;

  // 战斗节点：展示敌人模板
  if (node.type === "battle" && data.enemyTemplates) {
    const enemies = data.enemyTemplates as Array<{
      name: string; level: number; element?: string;
      minCount?: number; maxCount?: number; description?: string;
    }>;
    return (
      <div className="mt-2 space-y-1">
        <p className="text-[10px] font-medium text-muted">遭遇敌人：</p>
        {enemies.map((e, i) => (
          <div key={i} className="flex items-center gap-1.5 text-[11px]">
            <span className="text-danger">⚔</span>
            <span className="font-medium">{e.name}</span>
            <span className="text-muted">Lv.{e.level}</span>
            {e.element && e.element !== "none" && (
              <span className="rounded bg-accent/10 px-1 text-[9px] text-accent">{e.element}</span>
            )}
            {(e.minCount || e.maxCount) && (
              <span className="text-muted">×{e.minCount ?? 1}-{e.maxCount ?? 1}</span>
            )}
          </div>
        ))}
        {typeof data.encounterRate === "number" && (
          <p className="text-[10px] text-muted">遭遇率：{Math.round((data.encounterRate as number) * 100)}%</p>
        )}
      </div>
    );
  }

  // BOSS 节点
  if (node.type === "boss" && data.boss) {
    const boss = data.boss as {
      name: string; level: number; element?: string;
      hp?: number; attack?: number; defense?: number; speed?: number;
      skills?: Array<{ name: string; type: string; damage?: number; element?: string }>;
      drops?: Array<{ name: string; quality?: string; chance?: number }>;
    };
    return (
      <div className="mt-2 space-y-1.5">
        <div className="flex items-center gap-2 text-[11px]">
          <span className="font-bold text-purple-600">💀 {boss.name}</span>
          <span className="text-muted">Lv.{boss.level}</span>
          {boss.element && <span className="rounded bg-purple-500/10 px-1 text-[9px] text-purple-500">{boss.element}</span>}
        </div>
        {(boss.hp || boss.attack) && (
          <div className="flex gap-3 text-[10px] text-muted">
            {boss.hp && <span>HP:{boss.hp}</span>}
            {boss.attack && <span>ATK:{boss.attack}</span>}
            {boss.defense && <span>DEF:{boss.defense}</span>}
            {boss.speed && <span>SPD:{boss.speed}</span>}
          </div>
        )}
        {boss.skills && boss.skills.length > 0 && (
          <div className="text-[10px]">
            <span className="text-muted">技能：</span>
            {boss.skills.map((s, i) => (
              <span key={i} className="mr-1 inline-block rounded bg-muted/10 px-1 py-0.5">
                {s.name}{s.damage ? ` (${s.damage})` : ""}
              </span>
            ))}
          </div>
        )}
        {boss.drops && boss.drops.length > 0 && (
          <div className="text-[10px]">
            <span className="text-muted">掉落：</span>
            {boss.drops.map((d, i) => (
              <span key={i} className="mr-1 inline-block rounded bg-warning/10 px-1 py-0.5 text-warning">
                {d.name}{d.chance ? ` ${Math.round(d.chance * 100)}%` : ""}
              </span>
            ))}
          </div>
        )}
      </div>
    );
  }

  // NPC 节点
  if (node.type === "npc" && data.npc) {
    const npc = data.npc as { name: string; role?: string; personality?: string; greeting?: string };
    return (
      <div className="mt-2 space-y-1 text-[11px]">
        <div className="flex items-center gap-1.5">
          <span className="font-medium">{npc.name}</span>
          {npc.role && <span className="rounded bg-info/10 px-1 text-[9px] text-info">{npc.role}</span>}
        </div>
        {npc.greeting && <p className="text-[10px] text-muted italic">&ldquo;{npc.greeting}&rdquo;</p>}
      </div>
    );
  }

  // 商店节点
  if (node.type === "shop") {
    const shopItems = (data.shopItems as Array<{
      name: string; type?: string; price?: number; quality?: string;
    }>) || [];
    const npc = data.npc as { name?: string; greeting?: string } | undefined;
    return (
      <div className="mt-2 space-y-1">
        {npc?.name && (
          <p className="text-[11px] font-medium">{npc.name}</p>
        )}
        {shopItems.length > 0 && (
          <div className="space-y-0.5">
            <p className="text-[10px] text-muted">商品：</p>
            {shopItems.map((item, i) => (
              <div key={i} className="flex items-center gap-1.5 text-[11px]">
                <span>{item.name}</span>
                {item.price && <span className="text-warning">💰{item.price}</span>}
                {item.quality && item.quality !== "common" && (
                  <span className="rounded bg-purple-500/10 px-1 text-[9px] text-purple-500">{item.quality}</span>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }

  // 事件节点
  if (node.type === "event" && data.events) {
    const events = data.events as Array<{ name: string; type?: string; description?: string }>;
    return (
      <div className="mt-2 space-y-1">
        {events.map((evt, i) => (
          <div key={i} className="text-[11px]">
            <span className="font-medium">{evt.name}</span>
            {evt.type && <span className="ml-1 text-[9px] text-muted">({evt.type})</span>}
          </div>
        ))}
      </div>
    );
  }

  // 安全区
  if (node.type === "safe" && data.hints) {
    const hints = data.hints as string[];
    return (
      <div className="mt-2 space-y-0.5">
        {hints.map((h, i) => (
          <p key={i} className="text-[10px] text-muted">💡 {h}</p>
        ))}
      </div>
    );
  }

  return null;
}

/* ============================
   SSE Progress Panel
   ============================ */

const ENTRY_ICONS: Record<ProgressEntry["type"], string> = {
  info: "🔍",
  issue: "⚠️",
  fix: "🔧",
  success: "✅",
  error: "❌",
  node: "📍",
};

function ProgressPanel({
  title,
  entries,
  isRunning,
  onClose,
}: {
  title: string;
  entries: ProgressEntry[];
  isRunning: boolean;
  onClose: () => void;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [entries]);

  return (
    <div
      className="rounded-xl border border-border bg-surface p-4"
      style={{ boxShadow: "var(--shadow-sm)" }}
    >
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-xs font-semibold text-foreground flex items-center gap-2">
          {isRunning && (
            <span className="h-2 w-2 animate-spin rounded-full border border-accent/30 border-t-accent" />
          )}
          {title}
        </h3>
        {!isRunning && (
          <button
            onClick={onClose}
            className="text-[10px] text-muted hover:text-foreground transition-colors"
          >
            关闭
          </button>
        )}
      </div>

      <div
        ref={scrollRef}
        className="max-h-48 overflow-y-auto space-y-1.5"
      >
        {entries.map((entry) => (
          <div
            key={entry.id}
            className={`flex items-start gap-1.5 text-[11px] leading-relaxed animate-in fade-in slide-in-from-bottom-1 duration-200 ${
              entry.type === "error"
                ? "text-red-500"
                : entry.type === "success"
                ? "text-green-600"
                : entry.type === "issue"
                ? "text-amber-600"
                : entry.type === "fix"
                ? "text-blue-500"
                : entry.type === "node"
                ? "text-purple-600"
                : "text-muted"
            }`}
          >
            <span className="shrink-0 mt-0.5">{ENTRY_ICONS[entry.type]}</span>
            <span>{entry.message}</span>
          </div>
        ))}
        {isRunning && entries.length === 0 && (
          <p className="text-[11px] text-muted animate-pulse">正在处理中...</p>
        )}
      </div>
    </div>
  );
}

/* ============================
   SSE Helper Hook
   ============================ */

function useSSEOperation() {
  const [isRunning, setIsRunning] = useState(false);
  const [entries, setEntries] = useState<ProgressEntry[]>([]);
  const [isVisible, setIsVisible] = useState(false);
  const entryIdRef = useRef(0);

  const addEntry = useCallback((type: ProgressEntry["type"], message: string) => {
    const newEntry: ProgressEntry = {
      id: entryIdRef.current++,
      type,
      message,
      timestamp: Date.now(),
    };
    setEntries((prev) => [...prev, newEntry]);
  }, []);

  const startOperation = useCallback(
    async (url: string, body: Record<string, unknown>, handlers: {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      onEvent?: (event: { type: string; [key: string]: any }) => void;
      onDone?: () => void;
    }) => {
      setIsRunning(true);
      setIsVisible(true);
      setEntries([]);
      entryIdRef.current = 0;

      try {
        const res = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });

        if (!res.ok || !res.body) {
          addEntry("error", `请求失败: ${res.statusText}`);
          setIsRunning(false);
          return;
        }

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n\n");
          buffer = lines.pop() || "";

          for (const line of lines) {
            const dataLine = line.trim();
            if (!dataLine.startsWith("data: ")) continue;
            try {
              const event = JSON.parse(dataLine.slice(6));
              handlers.onEvent?.(event);
            } catch {
              // 忽略解析错误
            }
          }
        }
      } catch (error) {
        addEntry("error", `连接错误: ${error instanceof Error ? error.message : "未知错误"}`);
      } finally {
        setIsRunning(false);
        handlers.onDone?.();
      }
    },
    [addEntry]
  );

  const close = useCallback(() => {
    setIsVisible(false);
    setEntries([]);
  }, []);

  return { isRunning, entries, isVisible, addEntry, startOperation, close };
}

/* ============================
   Expand Dialog
   ============================ */

function ExpandDialog({
  onConfirm,
  onCancel,
}: {
  onConfirm: (scale: number, hint: string) => void;
  onCancel: () => void;
}) {
  const [scale, setScale] = useState(0.5);
  const [hint, setHint] = useState("");

  const scaleOptions = [
    { value: 0.5, label: "50%", desc: "小型扩展" },
    { value: 1.0, label: "100%", desc: "中型扩展" },
    { value: 2.0, label: "200%", desc: "大型扩展" },
  ];

  return (
    <div
      className="rounded-xl border border-accent/30 bg-surface p-4 space-y-4"
      style={{ boxShadow: "var(--shadow-sm)" }}
    >
      <h3 className="text-sm font-semibold text-foreground">扩展区域</h3>

      {/* 比例选择 */}
      <div className="space-y-2">
        <p className="text-[11px] text-muted">选择扩展比例</p>
        <div className="flex gap-2">
          {scaleOptions.map((opt) => (
            <button
              key={opt.value}
              onClick={() => setScale(opt.value)}
              className={`flex-1 rounded-lg border px-3 py-2 text-center transition-all ${
                scale === opt.value
                  ? "border-accent bg-accent/10 text-accent"
                  : "border-border bg-background text-muted hover:border-accent/30"
              }`}
            >
              <div className="text-sm font-bold">{opt.label}</div>
              <div className="text-[10px] mt-0.5">{opt.desc}</div>
            </button>
          ))}
        </div>
      </div>

      {/* 方向提示 */}
      <div className="space-y-1.5">
        <p className="text-[11px] text-muted">扩展方向提示（可选）</p>
        <input
          type="text"
          value={hint}
          onChange={(e) => setHint(e.target.value)}
          placeholder="如：向北扩展，增加一个渔村和地下洞穴..."
          className="w-full rounded-lg border border-border bg-background px-3 py-2 text-xs text-foreground placeholder:text-muted/50 focus:border-accent focus:outline-none"
        />
      </div>

      {/* 操作按钮 */}
      <div className="flex gap-2">
        <button
          onClick={onCancel}
          className="flex-1 rounded-lg border border-border px-3 py-2 text-xs text-muted hover:bg-muted/5 transition-colors"
        >
          取消
        </button>
        <button
          onClick={() => onConfirm(scale, hint)}
          className="flex-1 rounded-lg bg-accent px-3 py-2 text-xs font-medium text-white hover:bg-accent-dim transition-colors"
        >
          开始扩展
        </button>
      </div>
    </div>
  );
}

/* ============================
   Area Action Bar
   ============================ */

function AreaActionBar({
  areaId,
  playerId,
  disabled,
  checkOp,
  expandOp,
  onAreaUpdated,
}: {
  areaId: string;
  playerId: string;
  disabled: boolean;
  checkOp: ReturnType<typeof useSSEOperation>;
  expandOp: ReturnType<typeof useSSEOperation>;
  onAreaUpdated: () => void;
}) {
  const [showExpandDialog, setShowExpandDialog] = useState(false);

  const handleCheck = () => {
    checkOp.startOperation("/api/areas/check", { areaId, playerId }, {
      onEvent: (event) => {
        switch (event.type) {
          case "checking":
            checkOp.addEntry("info", event.message);
            break;
          case "issue":
            checkOp.addEntry("issue", event.data?.description || "发现问题");
            break;
          case "fixing":
            checkOp.addEntry("fix", event.message);
            break;
          case "fixed":
            checkOp.addEntry("success", `已修复: ${event.data?.description || "节点数据"}`);
            break;
          case "summary": {
            const s = event.data;
            checkOp.addEntry(
              "success",
              `检查完成: 发现 ${s?.issuesFound ?? 0} 个问题，修复 ${s?.issuesFixed ?? 0} 处`
            );
            break;
          }
          case "error":
            checkOp.addEntry("error", event.message);
            break;
        }
      },
      onDone: onAreaUpdated,
    });
  };

  const handleExpand = (scale: number, hint: string) => {
    setShowExpandDialog(false);
    expandOp.startOperation("/api/areas/expand", { areaId, playerId, scale, hint }, {
      onEvent: (event) => {
        switch (event.type) {
          case "analyzing":
          case "planning":
          case "connecting":
            expandOp.addEntry("info", event.message);
            break;
          case "generating":
            expandOp.addEntry("info", event.message);
            break;
          case "node_created":
            expandOp.addEntry("node", `新节点: ${event.data?.name}（${event.data?.type}）`);
            break;
          case "summary": {
            const s = event.data;
            expandOp.addEntry(
              "success",
              `扩展完成: 新增 ${s?.newNodes ?? 0} 个节点, ${s?.newConnections ?? 0} 条连接`
            );
            break;
          }
          case "error":
            expandOp.addEntry("error", event.message);
            break;
        }
      },
      onDone: onAreaUpdated,
    });
  };

  const anyRunning = checkOp.isRunning || expandOp.isRunning;

  return (
    <div className="space-y-3">
      {/* 操作按钮行 */}
      <div className="flex gap-2">
        <button
          onClick={handleCheck}
          disabled={disabled || anyRunning}
          className="flex-1 flex items-center justify-center gap-1.5 rounded-lg border border-border bg-surface px-3 py-2 text-xs font-medium text-foreground transition-all hover:border-accent/40 hover:bg-accent/5 disabled:opacity-50 disabled:cursor-not-allowed"
          style={{ boxShadow: "var(--shadow-sm)" }}
        >
          {checkOp.isRunning ? (
            <>
              <span className="h-2.5 w-2.5 animate-spin rounded-full border border-accent/30 border-t-accent" />
              检查中...
            </>
          ) : (
            <>🔍 检查完整性</>
          )}
        </button>

        <button
          onClick={() => setShowExpandDialog(!showExpandDialog)}
          disabled={disabled || anyRunning}
          className="flex-1 flex items-center justify-center gap-1.5 rounded-lg border border-border bg-surface px-3 py-2 text-xs font-medium text-foreground transition-all hover:border-accent/40 hover:bg-accent/5 disabled:opacity-50 disabled:cursor-not-allowed"
          style={{ boxShadow: "var(--shadow-sm)" }}
        >
          {expandOp.isRunning ? (
            <>
              <span className="h-2.5 w-2.5 animate-spin rounded-full border border-accent/30 border-t-accent" />
              扩展中...
            </>
          ) : (
            <>🌱 扩展区域</>
          )}
        </button>
      </div>

      {/* 扩展对话框 */}
      {showExpandDialog && !anyRunning && (
        <ExpandDialog
          onConfirm={handleExpand}
          onCancel={() => setShowExpandDialog(false)}
        />
      )}

      {/* 检查进度面板 */}
      {checkOp.isVisible && (
        <ProgressPanel
          title="完整性检查"
          entries={checkOp.entries}
          isRunning={checkOp.isRunning}
          onClose={checkOp.close}
        />
      )}

      {/* 扩展进度面板 */}
      {expandOp.isVisible && (
        <ProgressPanel
          title="区域扩展"
          entries={expandOp.entries}
          isRunning={expandOp.isRunning}
          onClose={expandOp.close}
        />
      )}
    </div>
  );
}

/** 区域详情视图（含移动功能 + 区域操作） */
function AreaDetailView({
  areaId,
  playerId,
  onBack,
  onMoved,
}: {
  areaId: string;
  playerId: string;
  onBack: () => void;
  onMoved?: (msg?: string) => void;
}) {
  const [area, setArea] = useState<AreaDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [expandedNode, setExpandedNode] = useState<string | null>(null);
  const [movingTo, setMovingTo] = useState<string | null>(null);
  const [moveError, setMoveError] = useState<string | null>(null);

  const checkOp = useSSEOperation();
  const expandOp = useSSEOperation();

  const loadArea = useCallback(() => {
    setLoading(true);
    fetch(`/api/areas?id=${areaId}&forPlayerId=${playerId}`)
      .then((r) => r.json())
      .then((data) => {
        if (data.success) setArea(data.data);
      })
      .finally(() => setLoading(false));
  }, [areaId, playerId]);

  useEffect(() => {
    loadArea();
  }, [loadArea]);

  // 计算可达节点 ID 集合
  const reachableNodeIds = new Set<string>();
  if (area?.currentNodeId) {
    for (const conn of area.connections) {
      if (conn.fromId === area.currentNodeId) reachableNodeIds.add(conn.toId);
      if (conn.toId === area.currentNodeId) reachableNodeIds.add(conn.fromId);
    }
  }

  const handleMove = async (nodeId: string) => {
    setMovingTo(nodeId);
    setMoveError(null);
    try {
      const res = await fetch("/api/player/move", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ playerId, nodeId }),
      });
      const data = await res.json();
      if (data.success) {
        loadArea();
        const { nodeName, nodeType, areaName, escapedBattle } = data.data || {};
        const typeStr = nodeType === "safe" ? "安全区" : nodeType === "battle" ? "区域" : "地点";
        const msg = `🤖 你移动到了${areaName || "未知区域"}的${typeStr}「${nodeName || "未知地点"}」。${escapedBattle ? "\n" + escapedBattle : ""}`;
        if (onMoved) {
          onMoved(msg);
        }
      } else {
        setMoveError(data.error || "移动失败");
      }
    } catch {
      setMoveError("网络错误");
    } finally {
      setMovingTo(null);
    }
  };

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center text-muted">
        <span className="animate-pulse">加载中...</span>
      </div>
    );
  }

  if (!area) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 text-muted">
        <p>区域数据加载失败</p>
        <button onClick={onBack} className="text-accent text-sm">返回列表</button>
      </div>
    );
  }

  // 按类型排序：safe → npc → shop → event → battle → boss
  const typeOrder = ["safe", "npc", "shop", "event", "battle", "boss"];
  const sortedNodes = [...area.nodes].sort(
    (a, b) => typeOrder.indexOf(a.type) - typeOrder.indexOf(b.type)
  );

  return (
    <div className="animate-tab-in h-full overflow-y-auto">
      <div className="mx-auto max-w-lg p-4 space-y-3">
        {/* 返回按钮 + 标题 */}
        <div className="flex items-center gap-2">
          <button
            onClick={onBack}
            className="flex items-center gap-1 rounded-lg px-2 py-1 text-xs text-muted hover:bg-muted/10 hover:text-foreground transition-colors"
          >
            ← 返回
          </button>
        </div>

        {/* 区域头部 */}
        <div className="rounded-xl border border-border bg-surface p-4" style={{ boxShadow: "var(--shadow-sm)" }}>
          <div className="flex items-start justify-between">
            <div>
              <h2 className="text-lg font-bold text-foreground">
                {THEME_ICONS[area.theme] || "🗺️"} {area.name}
              </h2>
              <p className="mt-1 text-xs text-muted">推荐等级 Lv.{area.recommendedLevel}</p>
            </div>
            <span className="rounded-full bg-accent/10 px-2 py-0.5 text-[10px] text-accent">
              {area.nodes.length} 个节点
            </span>
          </div>
          <p className="mt-2 text-sm leading-relaxed text-foreground/80">{area.description}</p>
        </div>

        {/* 区域操作栏 */}
        <AreaActionBar
          areaId={areaId}
          playerId={playerId}
          disabled={false}
          checkOp={checkOp}
          expandOp={expandOp}
          onAreaUpdated={loadArea}
        />

        {/* 移动错误提示 */}
        {moveError && (
          <div className="rounded-lg border border-danger/20 bg-danger/5 px-3 py-2 text-xs text-danger">
            ⚠ {moveError}
          </div>
        )}

        {/* 连接关系 */}
        {area.connections.length > 0 && (
          <div className="rounded-xl border border-border bg-surface p-4" style={{ boxShadow: "var(--shadow-sm)" }}>
            <h3 className="mb-2 text-xs font-semibold text-muted">🔗 路径连接</h3>
            <div className="flex flex-wrap gap-1.5">
              {area.connections.map((c, i) => (
                <span key={i} className="inline-flex items-center gap-1 rounded-full bg-muted/8 px-2 py-0.5 text-[10px] text-muted">
                  {c.from} <span className="text-accent">↔</span> {c.to}
                </span>
              ))}
            </div>
          </div>
        )}

        {/* 节点列表 */}
        <div className="space-y-2">
          <h3 className="text-xs font-semibold text-muted px-1">📍 区域节点</h3>
          {sortedNodes.map((node) => {
            const meta = NODE_TYPE_META[node.type] || { icon: "❓", label: node.type, color: "text-muted" };
            const isExpanded = expandedNode === node.id;
            const isCurrent = area.currentNodeId === node.id;
            const isCrossArea = !area.currentNodeId;
            const canTeleport = isCrossArea && node.type === "safe";
            const isReachable = reachableNodeIds.has(node.id) || canTeleport;
            const isMoving = movingTo === node.id;

            return (
              <div
                key={node.id}
                className={`rounded-xl border p-3 transition-colors ${
                  isCurrent
                    ? "border-accent/50 bg-accent/5"
                    : isReachable
                    ? "border-green-500/30 bg-green-500/3"
                    : "border-border bg-surface"
                }`}
                style={{ boxShadow: "var(--shadow-sm)" }}
              >
                <button
                  onClick={() => setExpandedNode(isExpanded ? null : node.id)}
                  className="w-full text-left"
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="text-base">{meta.icon}</span>
                      <div>
                        <span className="text-sm font-medium text-foreground">{node.name}</span>
                        <span className={`ml-2 text-[10px] ${meta.color}`}>{meta.label}</span>
                        {isCurrent && (
                          <span className="ml-2 rounded-full bg-accent px-1.5 py-0.5 text-[9px] font-medium text-white">
                            当前
                          </span>
                        )}
                        {isReachable && !isCurrent && (
                          <span className="ml-2 rounded-full bg-green-500/10 px-1.5 py-0.5 text-[9px] font-medium text-green-600">
                            {canTeleport ? "可传送" : "可前往"}
                          </span>
                        )}
                      </div>
                    </div>
                    <span className="text-[10px] text-muted">{isExpanded ? "▼" : "▶"}</span>
                  </div>
                </button>

                {isExpanded && (
                  <div className="mt-2 border-t border-border-light pt-2">
                    <p className="text-xs leading-relaxed text-foreground/70">{node.description}</p>
                    <NodeDataView node={node} />

                    {/* 移动按钮 */}
                    {isReachable && !isCurrent && (
                      <button
                        onClick={() => handleMove(node.id)}
                        disabled={isMoving}
                        className={`mt-3 w-full rounded-lg px-3 py-2 text-xs font-medium text-white transition-colors disabled:opacity-50 ${
                          canTeleport ? "bg-purple-600 hover:bg-purple-700" : "bg-accent hover:bg-accent-dim"
                        }`}
                      >
                        {isMoving ? (
                          <span className="flex items-center justify-center gap-1.5">
                            <span className="h-2 w-2 animate-spin rounded-full border border-white/30 border-t-white" />
                            {canTeleport ? "传送中..." : "移动中..."}
                          </span>
                        ) : (
                          canTeleport ? `✈️ 传送至「${node.name}」` : `🚶 移动到「${node.name}」`
                        )}
                      </button>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

/* ============================
   Main Component
   ============================ */

export default function MapTab({
  playerId,
  onAction,
}: {
  playerId: string;
  onAction?: (msg?: string) => void;
}) {
  const [areas, setAreas] = useState<AreaSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedAreaId, setSelectedAreaId] = useState<string | null>(null);

  const loadAreas = useCallback(() => {
    setLoading(true);
    fetch(`/api/areas?playerId=${playerId}`)
      .then((r) => r.json())
      .then((data) => {
        if (data.success) setAreas(data.data.areas || []);
      })
      .finally(() => setLoading(false));
  }, [playerId]);

  useEffect(() => {
    loadAreas();
  }, [loadAreas]);

  // 区域详情视图
  if (selectedAreaId) {
    return (
      <AreaDetailView
        areaId={selectedAreaId}
        playerId={playerId}
        onBack={() => {
          setSelectedAreaId(null);
          loadAreas(); // 刷新列表
        }}
        onMoved={(msg) => {
          loadAreas();
          onAction?.(msg); // 触发外部动作（如刷新聊天）
        }}
      />
    );
  }

  // 区域列表视图
  return (
    <div className="animate-tab-in h-full overflow-y-auto">
      <div className="mx-auto max-w-lg p-4 space-y-3">
        <h2 className="text-sm font-semibold text-muted px-1">🗺️ 已探索区域</h2>

        {loading ? (
          <div className="flex items-center justify-center py-12 text-muted">
            <span className="animate-pulse">加载中...</span>
          </div>
        ) : areas.length === 0 ? (
          <div className="text-center py-12">
            <p className="text-2xl mb-2">🌫️</p>
            <p className="text-sm text-muted">还没有探索过任何区域</p>
            <p className="text-xs text-muted mt-1">在游戏中让 AI 生成新区域吧！</p>
          </div>
        ) : (
          <div className="space-y-2">
            {areas.map((area) => (
              <button
                key={area.id}
                onClick={() => setSelectedAreaId(area.id)}
                className={`w-full text-left rounded-xl border p-4 transition-all hover:border-accent/40 ${
                  area.isCurrent
                    ? "border-accent/50 bg-accent/5"
                    : "border-border bg-surface"
                }`}
                style={{ boxShadow: "var(--shadow-sm)" }}
              >
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <div className="flex items-center gap-1.5">
                      <span className="text-base">
                        {THEME_ICONS[area.theme] || "🗺️"}
                      </span>
                      <h3 className="text-sm font-bold text-foreground">
                        {area.name}
                      </h3>
                      {area.isCurrent && (
                        <span className="rounded-full bg-accent px-1.5 py-0.5 text-[9px] font-medium text-white">
                          当前
                        </span>
                      )}
                    </div>
                    <p className="mt-1 text-xs text-muted line-clamp-2">
                      {area.description}
                    </p>
                  </div>
                  <span className="shrink-0 ml-3 text-xs text-muted">▶</span>
                </div>

                <div className="mt-2 flex gap-3 text-[10px] text-muted">
                  <span>Lv.{area.recommendedLevel}</span>
                  <span>{area.nodeCount} 节点</span>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
