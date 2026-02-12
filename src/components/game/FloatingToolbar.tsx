"use client";

/**
 * 全局浮动工具栏 — 移动/背包/技能/任务
 *
 * 位于屏幕右上角, 4个图标按钮并排。
 * 点击各按钮打开对应面板。
 * 设计为全局组件, 可在游戏页面或未来3D场景中复用。
 */

import { useState, useEffect, useCallback } from "react";
import InventoryPanel from "@/components/game/InventoryPanel";
import SkillPanel from "@/components/game/SkillPanel";
import QuestPanel from "@/components/game/QuestPanel";
import LogPanel from "@/components/game/LogPanel";

/* ============================
   Types
   ============================ */

interface NodeInfo {
  id: string;
  name: string;
  type: string;
}

interface MoveData {
  currentNode: NodeInfo | null;
  areaName: string;
  reachableNodes: NodeInfo[];
}

type PanelId = "move" | "inventory" | "skills" | "quests" | "logs" | null;

const NODE_ICONS: Record<string, string> = {
  safe: "🏠",
  battle: "⚔️",
  boss: "💀",
  npc: "🧑",
  shop: "🛒",
  event: "✨",
};

const TOOLBAR_BUTTONS: { id: PanelId; icon: string; label: string }[] = [
  { id: "move", icon: "🧭", label: "移动" },
  { id: "inventory", icon: "🎒", label: "背包" },
  { id: "skills", icon: "⚡", label: "技能" },
  { id: "quests", icon: "📜", label: "任务" },
  { id: "logs", icon: "📝", label: "日志" },
];

/* ============================
   Quick Move Popup (inline)
   ============================ */

function QuickMovePopup({
  playerId,
  onClose,
  onMoveComplete,
}: {
  playerId: string;
  onClose: () => void;
  onMoveComplete?: (nodeName: string, nodeType: string, areaName: string) => void;
}) {
  const [data, setData] = useState<MoveData | null>(null);
  const [loading, setLoading] = useState(true);
  const [movingTo, setMovingTo] = useState<string | null>(null);
  const [moveResult, setMoveResult] = useState<string | null>(null);

  const loadMoveData = useCallback(async () => {
    setLoading(true);
    try {
      const pRes = await fetch(`/api/player?id=${playerId}`);
      const pData = await pRes.json();
      if (!pData.success) return;

      const { currentAreaId, currentNodeId } = pData.data;
      if (!currentAreaId) {
        setData({ currentNode: null, areaName: "未知", reachableNodes: [] });
        return;
      }

      const aRes = await fetch(`/api/areas?id=${currentAreaId}&forPlayerId=${playerId}`);
      const aData = await aRes.json();
      if (!aData.success) return;

      const area = aData.data;
      const currentNode = area.nodes.find((n: NodeInfo) => n.id === currentNodeId) || null;

      const reachableIds = new Set<string>();
      for (const conn of area.connections) {
        if (conn.fromId === currentNodeId) reachableIds.add(conn.toId);
        if (conn.toId === currentNodeId) reachableIds.add(conn.fromId);
      }

      const reachableNodes = area.nodes
        .filter((n: NodeInfo) => reachableIds.has(n.id))
        .map((n: NodeInfo) => ({ id: n.id, name: n.name, type: n.type }));

      setData({ currentNode, areaName: area.name, reachableNodes });
    } catch {
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [playerId]);

  useEffect(() => {
    loadMoveData();
  }, [loadMoveData]);

  const handleMove = async (nodeId: string) => {
    setMovingTo(nodeId);
    setMoveResult(null);
    try {
      const res = await fetch("/api/player/move", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ playerId, nodeId }),
      });
      const result = await res.json();
      if (result.success) {
        setMoveResult(`已到达「${result.data.nodeName}」`);
        loadMoveData();
        // 自动触发 LLM 叙述新位置
        if (onMoveComplete) {
          setTimeout(() => {
            onMoveComplete(result.data.nodeName, result.data.nodeType || "normal", data?.areaName || "未知区域");
          }, 600); // 略微延迟，让玩家看到移动结果
        }
      } else {
        setMoveResult(result.error || "移动失败");
      }
    } catch {
      setMoveResult("网络错误");
    } finally {
      setMovingTo(null);
    }
  };

  return (
    <>
      {/* 遮罩层 */}
      <div className="fixed inset-0 z-30" onClick={onClose} />

      <div
        className="fixed top-[80px] right-3 z-40 w-64 rounded-xl border border-border bg-surface shadow-lg animate-tab-in"
        style={{ boxShadow: "0 10px 25px rgba(0,0,0,0.15)" }}
      >
        {loading ? (
          <div className="p-4 text-center text-xs text-muted animate-pulse">加载中...</div>
        ) : !data ? (
          <div className="p-4 text-center text-xs text-muted">无法加载位置</div>
        ) : (
          <div className="p-3 space-y-2">
            {/* 当前位置 */}
            <div className="text-[10px] text-muted">{data.areaName}</div>
            <div className="flex items-center gap-1.5 text-sm font-medium text-foreground">
              <span>{data.currentNode ? NODE_ICONS[data.currentNode.type] || "📍" : "📍"}</span>
              <span>{data.currentNode?.name || "未知位置"}</span>
              <span className="rounded-full bg-accent/10 px-1.5 text-[9px] text-accent">当前</span>
            </div>

            {/* 移动结果 */}
            {moveResult && (
              <div className={`rounded-lg px-2 py-1 text-[11px] ${
                moveResult.startsWith("已到达")
                  ? "bg-green-500/10 text-green-600"
                  : "bg-danger/10 text-danger"
              }`}>
                {moveResult}
              </div>
            )}

            {/* 可达节点 */}
            {data.reachableNodes.length > 0 ? (
              <div className="space-y-1 pt-1 border-t border-border-light">
                <div className="text-[10px] text-muted">可前往</div>
                {data.reachableNodes.map((node) => (
                  <button
                    key={node.id}
                    onClick={() => handleMove(node.id)}
                    disabled={movingTo !== null}
                    className="flex w-full items-center justify-between rounded-lg border border-border px-2.5 py-1.5 text-left transition-colors hover:border-accent/40 hover:bg-accent/5 disabled:opacity-50"
                  >
                    <span className="flex items-center gap-1.5 text-xs">
                      <span>{NODE_ICONS[node.type] || "❓"}</span>
                      <span className="font-medium text-foreground">{node.name}</span>
                    </span>
                    {movingTo === node.id ? (
                      <span className="h-3 w-3 animate-spin rounded-full border border-accent/30 border-t-accent" />
                    ) : (
                      <span className="text-[10px] text-accent">前往 →</span>
                    )}
                  </button>
                ))}
              </div>
            ) : (
              <div className="pt-1 border-t border-border-light text-[11px] text-muted">
                没有可直接到达的节点
              </div>
            )}
          </div>
        )}
      </div>
    </>
  );
}

/* ============================
   Main Toolbar Component
   ============================ */

export default function FloatingToolbar({
  playerId,
  onSendCommand,
  onSystemAction,
}: {
  playerId: string;
  onSendCommand?: (cmd: string) => void;
  onSystemAction?: (msg?: string) => void;
}) {
  const [activePanel, setActivePanel] = useState<PanelId>(null);

  const toggle = (id: PanelId) => {
    setActivePanel((prev) => (prev === id ? null : id));
  };

  return (
    <>
      {/* 工具栏按钮组 */}
      <div className="fixed top-[46px] right-3 z-40 flex items-center gap-2">
        <div className="flex items-center gap-1">
          {TOOLBAR_BUTTONS.map((btn) => (
            <button
              key={btn.id}
              onClick={() => toggle(btn.id)}
              className={`flex h-8 items-center gap-0.5 rounded-full border px-2 text-xs font-medium shadow-sm transition-all ${
                activePanel === btn.id
                  ? "border-accent bg-accent text-white shadow-accent/20"
                  : "border-border bg-surface text-foreground hover:border-accent/40"
              }`}
              title={btn.label}
            >
              <span className="text-sm">{btn.icon}</span>
              <span className="hidden sm:inline text-[11px]">{btn.label}</span>
            </button>
          ))}
        </div>
      </div>

      {activePanel === "move" && (
        <QuickMovePopup
          playerId={playerId}
          onClose={() => setActivePanel(null)}
          onMoveComplete={(nodeName, nodeType, areaName) => {
            setActivePanel(null); // 关闭弹窗
            // 使用系统消息触发（与 MapTab 保持一致）
            const typeStr = nodeType === "safe" ? "安全区" : nodeType === "battle" ? "区域" : "地点";
            const msg = `🤖 你移动到了${areaName || "未知区域"}的${typeStr}「${nodeName}」。`;
            
            if (onSystemAction) {
              onSystemAction(msg);
            } else {
              onSendCommand?.(`（我到达了「${nodeName}」，描述一下周围环境）`);
            }
          }}
        />
      )}

      {/* 背包面板 (全屏 modal) */}
      <InventoryPanel
        isOpen={activePanel === "inventory"}
        onClose={() => setActivePanel(null)}
        playerId={playerId}
        onUseItem={(cmd) => {
          onSendCommand?.(cmd);
          setActivePanel(null);
        }}
      />

      {/* 技能面板 */}
      <SkillPanel
        isOpen={activePanel === "skills"}
        onClose={() => setActivePanel(null)}
        playerId={playerId}
      />

      {/* 任务面板 */}
      <QuestPanel
        isOpen={activePanel === "quests"}
        onClose={() => setActivePanel(null)}
        playerId={playerId}
      />

      {/* 日志面板 */}
      <LogPanel
        isOpen={activePanel === "logs"}
        onClose={() => setActivePanel(null)}
        playerId={playerId}
      />
    </>
  );
}
