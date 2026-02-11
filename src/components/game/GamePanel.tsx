"use client";

/**
 * 通用游戏面板弹窗容器
 *
 * 背包、技能、任务面板的外壳组件。
 * 亮色主题：白色卡片 + 微阴影。
 */

export default function GamePanel({
  title,
  isOpen,
  onClose,
  children,
}: {
  title: string;
  isOpen: boolean;
  onClose: () => void;
  children: React.ReactNode;
}) {
  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-40 flex items-end justify-center sm:items-center"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      {/* 半透明遮罩 */}
      <div className="absolute inset-0 bg-black/20 backdrop-blur-[2px]" />

      {/* 面板 */}
      <div
        className="relative w-full max-w-lg rounded-t-2xl border border-border bg-surface sm:rounded-2xl"
        style={{ boxShadow: "var(--shadow-lg)" }}
      >
        {/* 标题栏 */}
        <div className="flex items-center justify-between border-b border-border px-5 py-3">
          <h3 className="text-sm font-bold text-foreground">{title}</h3>
          <button
            onClick={onClose}
            className="rounded-lg p-1 text-muted transition-colors hover:bg-surface-hover hover:text-foreground"
          >
            ✕
          </button>
        </div>
        {/* 内容 */}
        <div className="max-h-[65vh] overflow-y-auto p-5">{children}</div>
      </div>
    </div>
  );
}
