"use client";

/**
 * 角色 Tab — 完整角色信息卡片式布局
 *
 * 含：基础属性、HP/MP/EXP、攻防速、货币、位置、背包/技能/任务入口
 */

import { useState } from "react";
import type { PlayerState } from "@/hooks/useGameChat";
import InventoryPanel from "@/components/game/InventoryPanel";
import SkillPanel from "@/components/game/SkillPanel";
import QuestPanel from "@/components/game/QuestPanel";

const REALM_NAMES: Record<string, string> = {
  ocean: "海洋级",
  land: "陆地级",
  barren: "荒芜级",
  planetary: "行星级",
  stellar: "恒星级",
  galactic: "银河级",
  transcend: "超越级",
  primordial: "洪荒级",
  ethereal: "空灵级",
  origin: "元初级",
};

function expToNextLevel(level: number): number {
  return Math.floor(100 * Math.pow(level, 1.5));
}

function StatBar({
  label,
  value,
  max,
  colorClass,
}: {
  label: string;
  value: number;
  max: number;
  colorClass: string;
}) {
  const pct = max > 0 ? Math.min(100, (value / max) * 100) : 0;
  return (
    <div>
      <div className="mb-0.5 flex justify-between text-xs">
        <span className="font-medium text-foreground">{label}</span>
        <span className="tabular-nums text-muted">
          {value}/{max}
        </span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-border-light">
        <div
          className={`h-full rounded-full transition-all duration-500 ${colorClass}`}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

type SubPanel = "inventory" | "skills" | "quests" | null;

export default function CharacterTab({
  player,
  onSendCommand,
  onLogout,
}: {
  player: PlayerState | null;
  onSendCommand: (cmd: string) => void;
  onLogout?: () => void;
}) {
  const [subPanel, setSubPanel] = useState<SubPanel>(null);

  if (!player) {
    return (
      <div className="flex h-full items-center justify-center text-muted">
        加载中...
      </div>
    );
  }

  return (
    <div className="animate-tab-in h-full overflow-y-auto">
      <div className="mx-auto max-w-lg space-y-3 p-4">
        {/* 头部卡片：名字 + 境界 */}
        <div className="rounded-xl border border-border bg-surface p-4" style={{ boxShadow: "var(--shadow-sm)" }}>
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-lg font-bold text-foreground">{player.name}</h2>
              <p className="text-xs text-muted">
                {REALM_NAMES[player.realm] || player.realm} · Lv.{player.level}
              </p>
            </div>
            <div className="text-right text-xs">
              <div className="text-muted">位置</div>
              <div className="mt-0.5 font-medium text-foreground">
                {player.location || "未知区域"}
              </div>
            </div>
          </div>
        </div>

        {/* 生命值 */}
        <div className="rounded-xl border border-border bg-surface p-4 space-y-2.5" style={{ boxShadow: "var(--shadow-sm)" }}>
          <StatBar label="HP" value={player.hp} max={player.maxHp} colorClass="bar-hp" />
          <StatBar label="MP" value={player.mp} max={player.maxMp} colorClass="bar-mp" />
          <StatBar
            label={`EXP → Lv.${player.level + 1}`}
            value={player.exp}
            max={expToNextLevel(player.level)}
            colorClass="bar-exp"
          />
        </div>

        {/* 属性 + 货币 */}
        <div className="grid grid-cols-2 gap-3">
          <div className="rounded-xl border border-border bg-surface p-4" style={{ boxShadow: "var(--shadow-sm)" }}>
            <h4 className="mb-2 text-xs font-semibold text-muted">战斗属性</h4>
            <div className="space-y-1.5 text-sm">
              <div className="flex justify-between">
                <span className="text-muted">攻击</span>
                <span className="font-medium tabular-nums">{player.attack}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted">防御</span>
                <span className="font-medium tabular-nums">{player.defense}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted">速度</span>
                <span className="font-medium tabular-nums">{player.speed}</span>
              </div>
            </div>
          </div>

          <div className="rounded-xl border border-border bg-surface p-4" style={{ boxShadow: "var(--shadow-sm)" }}>
            <h4 className="mb-2 text-xs font-semibold text-muted">货币</h4>
            <div className="space-y-1.5 text-sm">
              <div className="flex justify-between">
                <span className="text-muted">金币</span>
                <span className="font-medium tabular-nums text-warning">{player.gold}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted">灵石</span>
                <span className="font-medium tabular-nums text-info">{player.spiritStones}</span>
              </div>
            </div>
          </div>
        </div>

        {/* 快捷面板入口 */}
        <div className="grid grid-cols-3 gap-2">
          {[
            { key: "inventory" as SubPanel, label: "背包", icon: "🎒" },
            { key: "skills" as SubPanel, label: "技能", icon: "✨" },
            { key: "quests" as SubPanel, label: "任务", icon: "📜" },
          ].map((item) => (
            <button
              key={item.key}
              onClick={() => setSubPanel(item.key)}
              className="flex flex-col items-center gap-1 rounded-xl border border-border bg-surface py-3 text-sm transition-colors hover:border-accent/40 hover:bg-accent-light"
              style={{ boxShadow: "var(--shadow-sm)" }}
            >
              <span className="text-lg">{item.icon}</span>
              <span className="text-xs text-muted">{item.label}</span>
            </button>
          ))}
        </div>

        {/* 退出按钮 */}
        {onLogout && (
          <button
            onClick={onLogout}
            className="w-full rounded-xl border border-border py-2.5 text-xs text-muted transition-colors hover:border-danger/40 hover:text-danger"
          >
            退出角色
          </button>
        )}
      </div>

      {/* 子面板弹窗 */}
      <InventoryPanel
        isOpen={subPanel === "inventory"}
        onClose={() => setSubPanel(null)}
        playerId={player.id}
        onUseItem={(cmd) => {
          onSendCommand(cmd);
          setSubPanel(null);
        }}
      />
      <SkillPanel
        isOpen={subPanel === "skills"}
        onClose={() => setSubPanel(null)}
        playerId={player.id}
      />
      <QuestPanel
        isOpen={subPanel === "quests"}
        onClose={() => setSubPanel(null)}
        playerId={player.id}
      />
    </div>
  );
}
