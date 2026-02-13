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
  currentCooldown: number;
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
  const [togglingSkillId, setTogglingSkillId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadSkills = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/player?id=${playerId}`);
      const data = await res.json();
      if (data.success) {
        setSkills(data.data.skills || []);
      } else {
        setError(data.error || "加载技能失败");
      }
    } catch {
      setError("加载技能失败");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!isOpen) return;
    void loadSkills();
  }, [isOpen, playerId]);

  const toggleSkill = async (skillId: string, enabled: boolean) => {
    setError(null);
    setTogglingSkillId(skillId);
    try {
      const res = await fetch("/api/player/skills/toggle", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ playerId, skillId, enabled }),
      });
      const data = await res.json();
      if (!data.success) {
        setError(data.error || "操作失败");
        return;
      }
      await loadSkills();
    } catch {
      setError("操作失败，请稍后重试");
    } finally {
      setTogglingSkillId(null);
    }
  };

  const equipped = skills.filter((s) => s.equipped);
  const unequipped = skills.filter((s) => !s.equipped);
  const isEquipFull = equipped.length >= 4;

  return (
    <GamePanel title="✨ 技能" isOpen={isOpen} onClose={onClose}>
      {loading ? (
        <p className="text-center text-sm text-muted">加载中...</p>
      ) : skills.length === 0 ? (
        <p className="text-center text-sm text-muted">尚无技能</p>
      ) : (
        <div className="space-y-4">
          {error && (
            <div className="rounded-lg border border-danger/30 bg-danger/5 px-3 py-2 text-xs text-danger">
              {error}
            </div>
          )}
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
                      {skill.currentCooldown > 0 && (
                        <span className="text-warning">剩余 {skill.currentCooldown} 回合</span>
                      )}
                    </div>
                    <div className="mt-2">
                      <button
                        onClick={() => void toggleSkill(skill.id, false)}
                        disabled={togglingSkillId === skill.id}
                        className="rounded border border-border px-2 py-1 text-[10px] text-muted transition hover:border-danger/40 hover:text-danger disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        {togglingSkillId === skill.id ? "处理中..." : "不启用"}
                      </button>
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
                      {skill.currentCooldown > 0 && ` · CD剩余${skill.currentCooldown}`}
                    </div>
                    <button
                      onClick={() => void toggleSkill(skill.id, true)}
                      disabled={isEquipFull || togglingSkillId === skill.id}
                      className="ml-2 rounded border border-border px-2 py-1 text-[10px] text-foreground transition hover:border-accent/40 hover:text-accent disabled:cursor-not-allowed disabled:opacity-50"
                      title={isEquipFull ? "技能已满，请先停用一个技能" : "启用技能"}
                    >
                      {togglingSkillId === skill.id ? "处理中..." : "启用"}
                    </button>
                  </div>
                ))}
              </div>
              {isEquipFull && (
                <p className="mt-2 text-[10px] text-warning">
                  技能已满（4/4），请先在已装备中点“不启用”再启用新技能。
                </p>
              )}
            </div>
          )}
        </div>
      )}
    </GamePanel>
  );
}
