"use client";

/**
 * 首页 — 角色创建 / 找回角色
 *
 * 亮色主题，清爽现代设计。
 */

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";

const RACES = [
  {
    id: "human",
    name: "人族",
    desc: "适应力强，均衡发展，初始金币+50",
    icon: "⚔️",
  },
  {
    id: "elf",
    name: "精灵族",
    desc: "天赋灵敏，亲和自然，初始MP+20",
    icon: "🌿",
  },
  {
    id: "orc",
    name: "兽人族",
    desc: "天生强壮，近战凶猛，初始HP+30",
    icon: "🪓",
  },
];

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

const RACE_NAMES: Record<string, string> = {
  human: "人族",
  elf: "精灵族",
  orc: "兽人族",
};

type Mode = "create" | "find";

interface FoundPlayer {
  id: string;
  name: string;
  race: string;
  level: number;
  realm: string;
  createdAt: string;
}

export default function Home() {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>("create");

  // 创建角色状态
  const [name, setName] = useState("");
  const [race, setRace] = useState("human");
  const [background, setBackground] = useState("");
  const [creating, setCreating] = useState(false);

  // 找回角色状态
  const [searchName, setSearchName] = useState("");
  const [searching, setSearching] = useState(false);
  const [foundPlayers, setFoundPlayers] = useState<FoundPlayer[]>([]);
  const [searchDone, setSearchDone] = useState(false);

  const [error, setError] = useState("");

  // 检查 localStorage 是否有已存在角色
  useEffect(() => {
    const id = localStorage.getItem("chaossaga_player_id");
    if (id) {
      fetch(`/api/player?id=${id}`)
        .then((res) => res.json())
        .then((data) => {
          if (data.success) {
            router.push("/game");
          } else {
            localStorage.removeItem("chaossaga_player_id");
          }
        })
        .catch(() => {});
    }
  }, [router]);

  const handleCreate = async () => {
    if (!name.trim()) {
      setError("请输入角色名称");
      return;
    }
    if (name.trim().length > 12) {
      setError("名称不能超过12个字符");
      return;
    }

    setCreating(true);
    setError("");

    try {
      const res = await fetch("/api/player", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          race,
          background: background.trim(),
        }),
      });

      const data = await res.json();
      if (data.success) {
        localStorage.setItem("chaossaga_player_id", data.data.id);
        router.push("/game");
      } else {
        setError(data.error || "创建失败");
      }
    } catch {
      setError("网络错误，请重试");
    } finally {
      setCreating(false);
    }
  };

  const handleSearch = async () => {
    if (!searchName.trim()) {
      setError("请输入角色名称");
      return;
    }

    setSearching(true);
    setError("");
    setFoundPlayers([]);
    setSearchDone(false);

    try {
      const res = await fetch(
        `/api/player?name=${encodeURIComponent(searchName.trim())}`
      );
      const data = await res.json();

      if (data.success) {
        setFoundPlayers(data.data);
        setSearchDone(true);
      } else {
        setError(data.error || "搜索失败");
      }
    } catch {
      setError("网络错误，请重试");
    } finally {
      setSearching(false);
    }
  };

  const handleSelectPlayer = (playerId: string) => {
    localStorage.setItem("chaossaga_player_id", playerId);
    router.push("/game");
  };

  return (
    <div className="flex min-h-dvh flex-col items-center justify-center bg-background px-4">
      {/* 标题 */}
      <div className="mb-8 text-center">
        <h1 className="mb-1.5 text-4xl font-bold tracking-tight text-foreground">
          Chaos<span className="text-accent">Saga</span>
        </h1>
        <p className="text-sm text-muted">AI 驱动的修仙文字冒险</p>
      </div>

      {/* 主卡片 */}
      <div
        className="w-full max-w-md rounded-2xl border border-border bg-surface p-6"
        style={{ boxShadow: "var(--shadow-md)" }}
      >
        {/* 模式切换 */}
        <div className="mb-5 flex rounded-xl border border-border bg-background p-1">
          <button
            onClick={() => {
              setMode("create");
              setError("");
            }}
            className={`flex-1 rounded-lg py-2 text-sm font-medium transition-all ${
              mode === "create"
                ? "bg-accent text-white shadow-sm"
                : "text-muted hover:text-foreground"
            }`}
          >
            创建角色
          </button>
          <button
            onClick={() => {
              setMode("find");
              setError("");
            }}
            className={`flex-1 rounded-lg py-2 text-sm font-medium transition-all ${
              mode === "find"
                ? "bg-accent text-white shadow-sm"
                : "text-muted hover:text-foreground"
            }`}
          >
            找回角色
          </button>
        </div>

        {mode === "create" ? (
          <>
            {/* 名称 */}
            <div className="mb-4">
              <label className="mb-1.5 block text-xs font-medium text-muted">
                角色名称
              </label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="输入你的角色名..."
                maxLength={12}
                className="w-full rounded-xl border border-border bg-background px-3 py-2.5 text-sm text-foreground placeholder-muted/50 outline-none transition-colors focus:border-accent"
              />
            </div>

            {/* 种族选择 */}
            <div className="mb-4">
              <label className="mb-1.5 block text-xs font-medium text-muted">
                选择种族
              </label>
              <div className="grid grid-cols-3 gap-2">
                {RACES.map((r) => (
                  <button
                    key={r.id}
                    onClick={() => setRace(r.id)}
                    className={`rounded-xl border p-3 text-center transition-all ${
                      race === r.id
                        ? "border-accent bg-accent-light"
                        : "border-border bg-background hover:border-accent/30"
                    }`}
                  >
                    <div className="text-2xl">{r.icon}</div>
                    <div className={`mt-1 text-sm font-medium ${race === r.id ? "text-accent" : "text-foreground"}`}>
                      {r.name}
                    </div>
                    <div className="mt-0.5 text-[10px] leading-tight text-muted">
                      {r.desc}
                    </div>
                  </button>
                ))}
              </div>
            </div>

            {/* 背景故事 */}
            <div className="mb-5">
              <label className="mb-1.5 block text-xs font-medium text-muted">
                背景故事 <span className="text-muted/50">(可选)</span>
              </label>
              <textarea
                value={background}
                onChange={(e) => setBackground(e.target.value)}
                placeholder="你的角色有着怎样的过去？AI会将其融入冒险叙事中..."
                rows={3}
                maxLength={200}
                className="w-full resize-none rounded-xl border border-border bg-background px-3 py-2.5 text-sm text-foreground placeholder-muted/50 outline-none transition-colors focus:border-accent"
              />
            </div>

            {error && (
              <p className="mb-3 text-center text-xs text-danger">{error}</p>
            )}

            <button
              onClick={handleCreate}
              disabled={creating}
              className="w-full rounded-xl bg-accent py-3 text-sm font-semibold text-white transition-colors hover:bg-accent-dim disabled:cursor-not-allowed disabled:opacity-50"
            >
              {creating ? "创建中..." : "开始冒险"}
            </button>
          </>
        ) : (
          <>
            <div className="mb-4">
              <label className="mb-1.5 block text-xs font-medium text-muted">
                输入角色名称搜索
              </label>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={searchName}
                  onChange={(e) => setSearchName(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleSearch()}
                  placeholder="输入你的角色名..."
                  maxLength={12}
                  className="flex-1 rounded-xl border border-border bg-background px-3 py-2.5 text-sm text-foreground placeholder-muted/50 outline-none transition-colors focus:border-accent"
                />
                <button
                  onClick={handleSearch}
                  disabled={searching}
                  className="rounded-xl bg-accent px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-accent-dim disabled:opacity-50"
                >
                  {searching ? "..." : "搜索"}
                </button>
              </div>
            </div>

            {error && (
              <p className="mb-3 text-center text-xs text-danger">{error}</p>
            )}

            {searchDone && foundPlayers.length === 0 && (
              <div className="rounded-xl border border-border bg-background p-4 text-center">
                <p className="text-sm text-muted">
                  未找到名为「{searchName}」的角色
                </p>
                <p className="mt-1 text-[11px] text-muted/50">
                  请检查名称是否正确，或切换到「创建角色」
                </p>
              </div>
            )}

            {foundPlayers.length > 0 && (
              <div className="space-y-2">
                <p className="text-xs text-muted">
                  找到 {foundPlayers.length} 个角色，点击选择：
                </p>
                {foundPlayers.map((p) => (
                  <button
                    key={p.id}
                    onClick={() => handleSelectPlayer(p.id)}
                    className="w-full rounded-xl border border-border bg-background p-3 text-left transition-all hover:border-accent hover:bg-accent-light"
                  >
                    <div className="flex items-center justify-between">
                      <div>
                        <span className="font-medium text-foreground">
                          {p.name}
                        </span>
                        <span className="ml-2 text-xs text-muted">
                          {RACE_NAMES[p.race] || p.race}
                        </span>
                      </div>
                      <div className="text-xs font-medium text-accent">
                        {REALM_NAMES[p.realm] || p.realm} Lv.{p.level}
                      </div>
                    </div>
                    <div className="mt-1 text-[10px] text-muted/50">
                      创建于{" "}
                      {new Date(p.createdAt).toLocaleDateString("zh-CN")}
                    </div>
                  </button>
                ))}
              </div>
            )}
          </>
        )}
      </div>

      {/* 底部说明 */}
      <p className="mt-6 max-w-sm text-center text-[11px] leading-relaxed text-muted/50">
        一切始于混沌之海。平行宇宙中，万物皆从海洋诞生。
        <br />
        从海洋级启程，历经陆地、荒芜、行星……直至元初之巅。
      </p>
    </div>
  );
}
