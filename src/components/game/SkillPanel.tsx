"use client";

/**
 * 技能面板
 */

import { useState, useEffect } from "react";
import GamePanel from "./GamePanel";

interface Skill {
  id: string;
  name: string;
  element: string;
  damage: number;
  mpCost: number;
  cooldown: number;
  equipped: boolean;
  slotIndex: number | null;
}

const ELEMENT_COLORS: Record<string, string> = {
  water: "text-blue-600",
  fire: "text-red-500",
  earth: "text-amber-700",
  wind: "text-emerald-600",
  dark: "text-purple-600",
  light: "text-yellow-500",
  none: "text-muted",
};

export default function SkillPanel({
  isOpen,
  onClose,
  playerId,
}: {
  isOpen: boolean;
  onClose: () => void;
  playerId: string;
}) {
  const [skills, setSkills] = useState<Skill[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!isOpen) return;
    setLoading(true);
    fetch(`/api/player?id=${playerId}`)
      .then((r) => r.json())
      .then((data) => {
        if (data.success) setSkills(data.data.skills || []);
      })
      .finally(() => setLoading(false));
  }, [isOpen, playerId]);

  const equipped = skills.filter((s) => s.equipped);
  const unequipped = skills.filter((s) => !s.equipped);

  return (
    <GamePanel title="✨ 技能" isOpen={isOpen} onClose={onClose}>
      {loading ? (
        <p className="text-center text-sm text-muted">加载中...</p>
      ) : skills.length === 0 ? (
        <p className="text-center text-sm text-muted">尚无技能</p>
      ) : (
        <div className="space-y-4">
          {/* 装备栏 */}
          {equipped.length > 0 && (
            <div>
              <h4 className="mb-2 text-xs font-medium text-muted">
                已装备 ({equipped.length}/4)
              </h4>
              <div className="grid grid-cols-2 gap-2">
                {equipped.map((skill) => (
                  <div
                    key={skill.id}
                    className="rounded-lg border border-accent/30 bg-accent/5 p-3"
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-medium text-foreground">
                        {skill.name}
                      </span>
                      <span
                        className={`text-[10px] ${ELEMENT_COLORS[skill.element]}`}
                      >
                        {skill.element}
                      </span>
                    </div>
                    <div className="mt-1 flex gap-3 text-[10px] text-muted">
                      {skill.damage > 0 && <span>伤害 {skill.damage}</span>}
                      <span>MP {skill.mpCost}</span>
                      {skill.cooldown > 0 && <span>CD {skill.cooldown}回合</span>}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* 未装备 */}
          {unequipped.length > 0 && (
            <div>
              <h4 className="mb-2 text-xs font-medium text-muted">未装备</h4>
              <div className="space-y-1.5">
                {unequipped.map((skill) => (
                  <div
                    key={skill.id}
                    className="flex items-center justify-between rounded-lg border border-border bg-background p-2.5"
                  >
                    <div>
                      <span className="text-sm text-foreground">{skill.name}</span>
                      <span
                        className={`ml-2 text-[10px] ${ELEMENT_COLORS[skill.element]}`}
                      >
                        {skill.element}
                      </span>
                    </div>
                    <div className="text-[10px] text-muted">
                      {skill.damage > 0 && `${skill.damage}伤害 · `}MP{skill.mpCost}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </GamePanel>
  );
}
