"use client";

/**
 * 快捷操作按钮
 *
 * 渲染 AI 返回的选项按钮（如 [战斗！] [观察] [逃跑]）。
 * 点击后自动发送对应消息。
 */

export default function ActionButtons({
  actions,
  onAction,
  disabled,
}: {
  actions: Array<{ label: string; value: string }>;
  onAction: (value: string) => void;
  disabled?: boolean;
}) {
  if (!actions || actions.length === 0) return null;

  return (
    <div className="animate-message-in my-2 flex flex-wrap gap-2 pl-4">
      {actions.map((action, i) => (
        <button
          key={i}
          onClick={() => onAction(action.value)}
          disabled={disabled}
          className="rounded-lg border border-accent/30 bg-accent/5 px-4 py-1.5 text-sm text-accent transition-all hover:border-accent hover:bg-accent/10 active:scale-95 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {action.label}
        </button>
      ))}
    </div>
  );
}
