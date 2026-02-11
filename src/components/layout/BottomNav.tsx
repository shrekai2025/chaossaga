"use client";

/**
 * 底部导航栏
 *
 * 4 个 Tab：游戏 / 角色 / 图鉴 / 设置
 * 移动端安全区域自适应。
 */

export type TabId = "game" | "character" | "mission" | "codex" | "map" | "settings";

const TABS: { id: TabId; label: string; icon: string }[] = [
  { id: "game", label: "游戏", icon: "💬" },
  { id: "mission", label: "任务", icon: "📜" },
  { id: "character", label: "角色", icon: "👤" },
  { id: "codex", label: "图鉴", icon: "📖" },
  { id: "map", label: "地图", icon: "🗺️" },
  { id: "settings", label: "设置", icon: "⚙️" },
];

export default function BottomNav({
  activeTab,
  onTabChange,
}: {
  activeTab: TabId;
  onTabChange: (tab: TabId) => void;
}) {
  return (
    <nav className="bottom-nav flex h-14 items-center border-t border-border bg-surface">
      {TABS.map((tab) => {
        const isActive = activeTab === tab.id;
        return (
          <button
            key={tab.id}
            onClick={() => onTabChange(tab.id)}
            className={`flex flex-1 flex-col items-center justify-center gap-0.5 transition-colors ${
              isActive
                ? "text-accent"
                : "text-muted hover:text-foreground"
            }`}
          >
            <span className="text-base leading-none">{tab.icon}</span>
            <span
              className={`text-[10px] leading-none ${
                isActive ? "font-semibold" : "font-normal"
              }`}
            >
              {tab.label}
            </span>
          </button>
        );
      })}
    </nav>
  );
}
