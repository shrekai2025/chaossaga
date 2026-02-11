"use client";

/**
 * 背包面板
 *
 * 通过聊天指令 "打开背包" 或侧栏按钮打开。
 * 物品分类展示，点击可以发送使用指令。
 */

import { useState, useEffect } from "react";
import GamePanel from "./GamePanel";

interface InventoryItem {
  id: string;
  name: string;
  type: string;
  quality: string;
  quantity: number;
  equipped: boolean;
  specialEffect?: string | null;
}

const QUALITY_COLORS: Record<string, string> = {
  common: "text-foreground",
  uncommon: "text-green-600",
  rare: "text-blue-600",
  epic: "text-purple-600",
  legendary: "text-amber-600",
};

const TYPE_LABELS: Record<string, string> = {
  weapon: "武器",
  armor: "护甲",
  accessory: "饰品",
  consumable: "消耗品",
  material: "材料",
  quest_item: "任务物品",
  collectible: "收藏品",
};

export default function InventoryPanel({
  isOpen,
  onClose,
  playerId,
  onUseItem,
}: {
  isOpen: boolean;
  onClose: () => void;
  playerId: string;
  onUseItem: (command: string) => void;
}) {
  const [items, setItems] = useState<InventoryItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!isOpen) return;
    setLoading(true);
    fetch(`/api/player?id=${playerId}`)
      .then((r) => r.json())
      .then((data) => {
        if (data.success) setItems(data.data.inventory || []);
      })
      .finally(() => setLoading(false));
  }, [isOpen, playerId]);

  const grouped = items.reduce(
    (acc, item) => {
      const type = item.type || "other";
      if (!acc[type]) acc[type] = [];
      acc[type].push(item);
      return acc;
    },
    {} as Record<string, InventoryItem[]>
  );

  return (
    <GamePanel title="🎒 背包" isOpen={isOpen} onClose={onClose}>
      {loading ? (
        <p className="text-center text-sm text-muted">加载中...</p>
      ) : items.length === 0 ? (
        <p className="text-center text-sm text-muted">背包空空如也</p>
      ) : (
        <div className="space-y-4">
          {Object.entries(grouped).map(([type, typeItems]) => (
            <div key={type}>
              <h4 className="mb-2 text-xs font-medium text-muted">
                {TYPE_LABELS[type] || type}
              </h4>
              <div className="space-y-1.5">
                {typeItems.map((item) => (
                  <div
                    key={item.id}
                    className="flex items-center justify-between rounded-lg border border-border bg-background p-2.5"
                  >
                    <div className="flex-1">
                      <span
                        className={`text-sm font-medium ${QUALITY_COLORS[item.quality] || "text-foreground"}`}
                      >
                        {item.name}
                        {item.equipped && (
                          <span className="ml-1 text-[10px] text-accent">
                            [装备中]
                          </span>
                        )}
                      </span>
                      {item.specialEffect && (
                        <p className="mt-0.5 text-[10px] text-warning">
                          ✦ {item.specialEffect}
                        </p>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-muted">x{item.quantity}</span>
                      {item.type === "consumable" && (
                        <button
                          onClick={() => {
                            onUseItem(`使用 ${item.name}`);
                            onClose();
                          }}
                          className="rounded bg-accent/10 px-2 py-0.5 text-[10px] text-accent hover:bg-accent/20"
                        >
                          使用
                        </button>
                      )}
                      {["weapon", "armor", "accessory", "helmet", "boots"].includes(item.type) && (
                        <button
                          onClick={() => {
                            onUseItem(item.equipped ? `卸下 ${item.name}` : `装备 ${item.name}`);
                            onClose();
                          }}
                          className={`rounded px-2 py-0.5 text-[10px] ${
                            item.equipped
                              ? "bg-danger/10 text-danger hover:bg-danger/20"
                              : "bg-accent/10 text-accent hover:bg-accent/20"
                          }`}
                        >
                          {item.equipped ? "卸下" : "装备"}
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </GamePanel>
  );
}
