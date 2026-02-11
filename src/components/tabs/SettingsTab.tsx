"use client";

/**
 * 设置 Tab — AI 模型配置（两级选择：渠道商 → 模型）
 */

import { useState, useEffect, useCallback, useMemo } from "react";

interface ProviderInfo {
  id: string;
  name: string;
  description: string;
  hasApiKey: boolean;
  baseUrl: string;
}

interface ModelOption {
  id: string;
  name: string;
  provider: string;
  providerId: string;
  apiFormat?: string;
  costTier: string;
  description: string;
  isCustom?: boolean;
}

interface SettingsData {
  currentModel: string;
  temperature: number;
  maxTokens: number;
  hasApiKey: boolean;
  providers: ProviderInfo[];
  availableModels: ModelOption[];
}

const COST_LABELS: Record<string, { label: string; color: string }> = {
  low: { label: "低成本", color: "text-success" },
  medium: { label: "中等", color: "text-warning" },
  high: { label: "较高", color: "text-orange-500" },
  premium: { label: "高级", color: "text-danger" },
};

const API_FORMAT_LABELS: Record<string, string> = {
  openai: "OpenAI 兼容",
  anthropic: "Anthropic",
  google: "Google",
};

const EMPTY_FORM: {
  id: string;
  name: string;
  provider: string;
  apiFormat: string;
  costTier: string;
  description: string;
} = {
  id: "",
  name: "",
  provider: "",
  apiFormat: "openai",
  costTier: "medium",
  description: "",
};

export default function SettingsTab() {
  const [settings, setSettings] = useState<SettingsData | null>(null);
  const [selectedModel, setSelectedModel] = useState("");
  const [activeProviderId, setActiveProviderId] = useState("");
  const [temperature, setTemperature] = useState(0.7);
  const [maxTokens, setMaxTokens] = useState(4096);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);

  // 添加模型表单
  const [showAddForm, setShowAddForm] = useState(false);
  const [addForm, setAddForm] = useState(EMPTY_FORM);
  const [adding, setAdding] = useState(false);
  const [addError, setAddError] = useState("");

  const loadSettings = useCallback(async () => {
    try {
      const res = await fetch("/api/settings");
      const data = await res.json();
      if (data.success) {
        setSettings(data.data);
        setSelectedModel(data.data.currentModel);
        setTemperature(data.data.temperature);
        setMaxTokens(data.data.maxTokens);
        // 初始化活跃渠道商：优先选当前模型所在渠道
        const currentModelDef = data.data.availableModels.find(
          (m: ModelOption) => m.id === data.data.currentModel
        );
        setActiveProviderId(
          currentModelDef?.providerId || data.data.providers?.[0]?.id || "tuzi"
        );
      }
    } catch {
      setError("加载配置失败");
    }
  }, []);

  useEffect(() => {
    loadSettings();
  }, [loadSettings]);

  // 按渠道商过滤的模型列表
  const filteredModels = useMemo(() => {
    if (!settings) return [];
    return settings.availableModels.filter(
      (m) => m.providerId === activeProviderId
    );
  }, [settings, activeProviderId]);

  const handleSave = async () => {
    setSaving(true);
    setError("");
    setSaved(false);
    try {
      const res = await fetch("/api/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: selectedModel, temperature, maxTokens }),
      });
      const data = await res.json();
      if (data.success) {
        setSaved(true);
        setTimeout(() => setSaved(false), 2000);
      } else {
        setError(data.error || "保存失败");
      }
    } catch {
      setError("网络错误");
    } finally {
      setSaving(false);
    }
  };

  const handleAddModel = async () => {
    if (!addForm.id.trim() || !addForm.name.trim()) {
      setAddError("模型 ID 和名称为必填项");
      return;
    }
    setAdding(true);
    setAddError("");
    try {
      const res = await fetch("/api/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "addModel",
          modelData: {
            ...addForm,
            providerId: activeProviderId, // 添加到当前选中的渠道商
          },
        }),
      });
      const data = await res.json();
      if (data.success) {
        if (settings && data.data?.availableModels) {
          setSettings({ ...settings, availableModels: data.data.availableModels });
        }
        setAddForm(EMPTY_FORM);
        setShowAddForm(false);
      } else {
        setAddError(data.error || "添加失败");
      }
    } catch {
      setAddError("网络错误");
    } finally {
      setAdding(false);
    }
  };

  const handleDeleteModel = async (modelId: string) => {
    try {
      const res = await fetch("/api/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "deleteModel", modelId }),
      });
      const data = await res.json();
      if (data.success && settings && data.data?.availableModels) {
        setSettings({ ...settings, availableModels: data.data.availableModels });
        if (selectedModel === modelId && data.data.availableModels.length > 0) {
          setSelectedModel(data.data.availableModels[0].id);
        }
      }
    } catch {
      setError("删除模型失败");
    }
  };

  return (
    <div className="animate-tab-in h-full overflow-y-auto">
      <div className="mx-auto max-w-lg space-y-4 p-4">
        <h2 className="text-base font-bold text-foreground">AI 模型设置</h2>

        {!settings ? (
          <div className="py-12 text-center text-muted">加载中...</div>
        ) : (
          <>
            {/* ======= 渠道商选择 ======= */}
            <div>
              <label className="mb-2 block text-xs font-semibold text-muted">
                选择渠道商
              </label>
              <div className="flex gap-2">
                {settings.providers.map((p) => {
                  const isActive = activeProviderId === p.id;
                  return (
                    <button
                      key={p.id}
                      onClick={() => setActiveProviderId(p.id)}
                      className={`relative flex-1 rounded-xl border px-3 py-2.5 text-left transition-all ${
                        isActive
                          ? "border-accent bg-accent-light"
                          : "border-border bg-surface hover:border-accent/30"
                      }`}
                      style={{ boxShadow: isActive ? "none" : "var(--shadow-sm)" }}
                    >
                      <div className="flex items-center gap-2">
                        <span
                          className={`h-2 w-2 shrink-0 rounded-full ${
                            p.hasApiKey ? "bg-success" : "bg-border"
                          }`}
                        />
                        <span className="text-xs font-medium text-foreground">
                          {p.name}
                        </span>
                      </div>
                      <p className="mt-0.5 pl-4 text-[10px] text-muted">
                        {p.description}
                      </p>
                      {!p.hasApiKey && (
                        <span className="absolute right-2 top-2 text-[9px] text-muted opacity-70">
                          未配置 Key
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* ======= 模型选择（按渠道商过滤） ======= */}
            <div>
              <label className="mb-2 block text-xs font-semibold text-muted">
                选择模型
                <span className="ml-2 text-[10px] font-normal opacity-60">
                  — {settings.providers.find((p) => p.id === activeProviderId)?.name}
                </span>
              </label>
              <div className="space-y-2">
                {filteredModels.length === 0 ? (
                  <div className="rounded-xl border border-border bg-surface px-4 py-6 text-center text-xs text-muted">
                    该渠道商下暂无模型，可手动添加
                  </div>
                ) : (
                  filteredModels.map((model) => {
                    const cost = COST_LABELS[model.costTier] || COST_LABELS.medium;
                    const isSelected = selectedModel === model.id;
                    return (
                      <div key={model.id} className="relative">
                        <button
                          onClick={() => setSelectedModel(model.id)}
                          className={`w-full rounded-xl border p-3 text-left transition-all ${
                            isSelected
                              ? "border-accent bg-accent-light"
                              : "border-border bg-surface hover:border-accent/30"
                          }`}
                          style={{ boxShadow: isSelected ? "none" : "var(--shadow-sm)" }}
                        >
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2">
                              <span
                                className={`h-2 w-2 rounded-full ${isSelected ? "bg-accent" : "bg-border"}`}
                              />
                              <span className="text-sm font-medium text-foreground">
                                {model.name}
                              </span>
                              <span className="text-[10px] text-muted">
                                {model.provider}
                              </span>
                              {model.isCustom && (
                                <span className="rounded bg-accent/15 px-1.5 py-0.5 text-[9px] font-medium text-accent">
                                  自定义
                                </span>
                              )}
                            </div>
                            <div className="flex items-center gap-2">
                              <span className={`text-[10px] font-medium ${cost.color}`}>
                                {cost.label}
                              </span>
                            </div>
                          </div>
                          <p className="mt-1 pl-4 text-[11px] text-muted">
                            {model.description}
                            {model.apiFormat && (
                              <span className="ml-1 opacity-60">
                                · {API_FORMAT_LABELS[model.apiFormat] || model.apiFormat}
                              </span>
                            )}
                          </p>
                        </button>
                        {model.isCustom && (
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              handleDeleteModel(model.id);
                            }}
                            className="absolute right-2 top-2 flex h-5 w-5 items-center justify-center rounded-full text-[10px] text-muted transition-colors hover:bg-danger/15 hover:text-danger"
                            title="删除此自定义模型"
                          >
                            ✕
                          </button>
                        )}
                      </div>
                    );
                  })
                )}
              </div>
            </div>

            {/* ======= 手动添加模型（绑定到当前渠道商） ======= */}
            <div className="rounded-xl border border-border bg-surface" style={{ boxShadow: "var(--shadow-sm)" }}>
              <button
                onClick={() => setShowAddForm(!showAddForm)}
                className="flex w-full items-center justify-between px-4 py-3 text-xs font-semibold text-foreground transition-colors hover:text-accent"
              >
                <span>
                  ＋ 添加模型到{" "}
                  {settings.providers.find((p) => p.id === activeProviderId)?.name || "当前渠道"}
                </span>
                <span
                  className="text-[10px] text-muted transition-transform"
                  style={{ transform: showAddForm ? "rotate(180deg)" : "rotate(0)" }}
                >
                  ▼
                </span>
              </button>

              {showAddForm && (
                <div className="space-y-3 border-t border-border px-4 pb-4 pt-3">
                  {/* 模型 ID */}
                  <div>
                    <label className="mb-1 block text-[11px] text-muted">
                      模型 ID <span className="text-danger">*</span>
                    </label>
                    <input
                      type="text"
                      value={addForm.id}
                      onChange={(e) => setAddForm({ ...addForm, id: e.target.value })}
                      placeholder="例如: deepseek-chat-v3"
                      className="w-full rounded-lg border border-border bg-background px-3 py-2 text-xs text-foreground placeholder:text-muted/50 focus:border-accent focus:outline-none"
                    />
                  </div>

                  {/* 显示名称 */}
                  <div>
                    <label className="mb-1 block text-[11px] text-muted">
                      显示名称 <span className="text-danger">*</span>
                    </label>
                    <input
                      type="text"
                      value={addForm.name}
                      onChange={(e) => setAddForm({ ...addForm, name: e.target.value })}
                      placeholder="例如: DeepSeek Chat V3"
                      className="w-full rounded-lg border border-border bg-background px-3 py-2 text-xs text-foreground placeholder:text-muted/50 focus:border-accent focus:outline-none"
                    />
                  </div>

                  {/* 提供商 */}
                  <div>
                    <label className="mb-1 block text-[11px] text-muted">提供商</label>
                    <input
                      type="text"
                      value={addForm.provider}
                      onChange={(e) => setAddForm({ ...addForm, provider: e.target.value })}
                      placeholder="例如: DeepSeek"
                      className="w-full rounded-lg border border-border bg-background px-3 py-2 text-xs text-foreground placeholder:text-muted/50 focus:border-accent focus:outline-none"
                    />
                  </div>

                  {/* API 格式 & 成本等级 */}
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="mb-1 block text-[11px] text-muted">API 格式</label>
                      <select
                        value={addForm.apiFormat}
                        onChange={(e) =>
                          setAddForm({ ...addForm, apiFormat: e.target.value as "openai" | "anthropic" | "google" })
                        }
                        className="w-full rounded-lg border border-border bg-background px-3 py-2 text-xs text-foreground focus:border-accent focus:outline-none"
                      >
                        <option value="openai">OpenAI 兼容</option>
                        <option value="anthropic">Anthropic</option>
                        <option value="google">Google</option>
                      </select>
                    </div>
                    <div>
                      <label className="mb-1 block text-[11px] text-muted">成本等级</label>
                      <select
                        value={addForm.costTier}
                        onChange={(e) =>
                          setAddForm({ ...addForm, costTier: e.target.value as "low" | "medium" | "high" | "premium" })
                        }
                        className="w-full rounded-lg border border-border bg-background px-3 py-2 text-xs text-foreground focus:border-accent focus:outline-none"
                      >
                        <option value="low">低成本</option>
                        <option value="medium">中等</option>
                        <option value="high">较高</option>
                        <option value="premium">高级</option>
                      </select>
                    </div>
                  </div>

                  {/* 描述 */}
                  <div>
                    <label className="mb-1 block text-[11px] text-muted">描述</label>
                    <input
                      type="text"
                      value={addForm.description}
                      onChange={(e) => setAddForm({ ...addForm, description: e.target.value })}
                      placeholder="简要描述模型特点"
                      className="w-full rounded-lg border border-border bg-background px-3 py-2 text-xs text-foreground placeholder:text-muted/50 focus:border-accent focus:outline-none"
                    />
                  </div>

                  {addError && (
                    <p className="text-[11px] text-danger">{addError}</p>
                  )}

                  <div className="flex gap-2">
                    <button
                      onClick={handleAddModel}
                      disabled={adding}
                      className="flex-1 rounded-lg bg-accent py-2 text-xs font-medium text-white transition-colors hover:bg-accent-dim disabled:opacity-50"
                    >
                      {adding ? "添加中..." : "添加模型"}
                    </button>
                    <button
                      onClick={() => {
                        setShowAddForm(false);
                        setAddForm(EMPTY_FORM);
                        setAddError("");
                      }}
                      className="rounded-lg border border-border px-4 py-2 text-xs text-muted transition-colors hover:text-foreground"
                    >
                      取消
                    </button>
                  </div>
                </div>
              )}
            </div>

            {/* ======= 温度 ======= */}
            <div className="rounded-xl border border-border bg-surface p-4" style={{ boxShadow: "var(--shadow-sm)" }}>
              <div className="flex items-center justify-between">
                <label className="text-xs font-semibold text-foreground">
                  创意度 (Temperature)
                </label>
                <span className="text-sm font-medium tabular-nums text-accent">
                  {temperature.toFixed(1)}
                </span>
              </div>
              <input
                type="range"
                min="0"
                max="2"
                step="0.1"
                value={temperature}
                onChange={(e) => setTemperature(parseFloat(e.target.value))}
                className="mt-2 w-full accent-accent"
              />
              <div className="mt-1 flex justify-between text-[10px] text-muted">
                <span>精确 (0)</span>
                <span>均衡 (0.7)</span>
                <span>创意 (2.0)</span>
              </div>
            </div>

            {/* ======= 最大 Token ======= */}
            <div className="rounded-xl border border-border bg-surface p-4" style={{ boxShadow: "var(--shadow-sm)" }}>
              <div className="flex items-center justify-between">
                <label className="text-xs font-semibold text-foreground">
                  最大输出长度
                </label>
                <span className="text-sm font-medium tabular-nums text-accent">
                  {maxTokens}
                </span>
              </div>
              <input
                type="range"
                min="1000"
                max="16000"
                step="500"
                value={maxTokens}
                onChange={(e) => setMaxTokens(parseInt(e.target.value, 10))}
                className="mt-2 w-full accent-accent"
              />
              <div className="mt-1 flex justify-between text-[10px] text-muted">
                <span>简短 (1000)</span>
                <span>标准 (4096)</span>
                <span>详细 (16000)</span>
              </div>
            </div>

            {/* ======= 错误 / 成功 ======= */}
            {error && (
              <p className="text-xs text-danger">{error}</p>
            )}
            {saved && (
              <p className="text-xs text-success">✓ 设置已保存</p>
            )}

            {/* ======= 保存 ======= */}
            <button
              onClick={handleSave}
              disabled={saving}
              className="w-full rounded-xl bg-accent py-2.5 text-sm font-medium text-white transition-colors hover:bg-accent-dim disabled:opacity-50"
            >
              {saving ? "保存中..." : "保存设置"}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
