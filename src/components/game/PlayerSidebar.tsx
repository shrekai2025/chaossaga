"use client";

/**
 * 玩家状态侧栏
 *
 * 显示：基础属性、HP/MP条、位置信息、快捷入口。
 * 响应 state_update 事件实时更新。
 */

import type { PlayerState } from "@/hooks/useGameChat";

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

function ProgressBar({
  value,
  max,
  className,
  label,
}: {
  value: number;
  max: number;
  className: string;
  label: string;
}) {
  const pct = max > 0 ? Math.min(100, (value / max) * 100) : 0;
  return (
    <div className="mb-2">
      <div className="mb-0.5 flex justify-between text-[10px] text-muted">
        <span>{label}</span>
        <span>
          {value}/{max}
        </span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-border">
        <div
          className={`h-full rounded-full transition-all duration-500 ${className}`}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

/** 经验需求公式（与 formulas.ts 一致） */
function expToNextLevel(level: number): number {
  return Math.floor(100 * Math.pow(level, 1.5));
}

export default function PlayerSidebar({
  player,
  onOpenPanel,
  onOpenSettings,
  onLogout,
}: {
  player: PlayerState | null;
  onOpenPanel: (panel: "inventory" | "skills" | "quests") => void;
  onOpenSettings: () => void;
  onLogout?: () => void;
}) {
  if (!player) {
    return (
      <div className="flex h-full w-60 flex-col items-center justify-center border-l border-border bg-surface text-muted">
        <p className="text-sm">加载中...</p>
      </div>
    );
  }

  return (
    <div className="flex h-full w-60 flex-col border-l border-border bg-surface">
      {/* 头部：名称 + 境界 */}
      <div className="border-b border-border p-4">
        <h3 className="text-sm font-bold text-white">{player.name}</h3>
        <p className="text-xs text-muted">
          {REALM_NAMES[player.realm] || player.realm} · Lv.{player.level}
        </p>
      </div>

      {/* HP/MP/EXP */}
      <div className="border-b border-border p-4">
        <ProgressBar
          value={player.hp}
          max={player.maxHp}
          className="bar-hp"
          label="HP"
        />
        <ProgressBar
          value={player.mp}
          max={player.maxMp}
          className="bar-mp"
          label="MP"
        />
        <ProgressBar
          value={player.exp}
          max={expToNextLevel(player.level)}
          className="bar-exp"
          label={`EXP (→ Lv.${player.level + 1})`}
        />
      </div>

      {/* 属性 */}
      <div className="border-b border-border p-4">
        <div className="grid grid-cols-2 gap-y-1.5 text-xs">
          <div className="text-muted">攻击</div>
          <div className="text-right text-white">{player.attack}</div>
          <div className="text-muted">防御</div>
          <div className="text-right text-white">{player.defense}</div>
          <div className="text-muted">速度</div>
          <div className="text-right text-white">{player.speed}</div>
        </div>
      </div>

      {/* 货币 */}
      <div className="border-b border-border p-4">
        <div className="flex items-center justify-between text-xs">
          <span className="text-muted">金币</span>
          <span className="font-medium" style={{ color: "var(--gold)" }}>
            {player.gold}
          </span>
        </div>
        <div className="mt-1 flex items-center justify-between text-xs">
          <span className="text-muted">灵石</span>
          <span className="font-medium text-info">{player.spiritStones}</span>
        </div>
      </div>

      {/* 位置 */}
      <div className="border-b border-border p-4">
        <div className="text-xs text-muted">当前位置</div>
        <div className="mt-0.5 text-xs text-white">
          {player.location || "未知区域"}
        </div>
      </div>

      {/* 快捷面板按钮 */}
      <div className="flex-1 p-4">
        <div className="space-y-2">
          <button
            onClick={() => onOpenPanel("inventory")}
            className="w-full rounded-lg border border-border py-2 text-xs text-muted transition-colors hover:border-accent/50 hover:text-white"
          >
            🎒 背包
          </button>
          <button
            onClick={() => onOpenPanel("skills")}
            className="w-full rounded-lg border border-border py-2 text-xs text-muted transition-colors hover:border-accent/50 hover:text-white"
          >
            ✨ 技能
          </button>
          <button
            onClick={() => onOpenPanel("quests")}
            className="w-full rounded-lg border border-border py-2 text-xs text-muted transition-colors hover:border-accent/50 hover:text-white"
          >
            📜 任务
          </button>
        </div>
      </div>

      {/* 底部按钮 */}
      <div className="border-t border-border p-3 space-y-1">
        <button
          onClick={onOpenSettings}
          className="w-full rounded-lg py-1.5 text-xs text-muted transition-colors hover:text-white"
        >
          ⚙️ AI 设置
        </button>
        {onLogout && (
          <button
            onClick={onLogout}
            className="w-full rounded-lg py-1.5 text-xs text-muted/60 transition-colors hover:text-danger"
          >
            退出角色
          </button>
        )}
      </div>
    </div>
  );
}
