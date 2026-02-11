"use client";

/**
 * 模型设置弹窗
 *
 * 允许玩家选择 LLM 模型、调整温度和最大 token 数。
 * 通过 /api/settings 读写全局配置。
 */

import { useState, useEffect, useCallback } from "react";

interface ModelOption {
  id: string;
  name: string;
  provider: string;
  costTier: string;
  description: string;
}

interface SettingsData {
  currentModel: string;
  temperature: number;
  maxTokens: number;
  hasApiKey: boolean;
  availableModels: ModelOption[];
}

const COST_LABELS: Record<string, { label: string; color: string }> = {
  low: { label: "低成本", color: "text-green-400" },
  medium: { label: "中等", color: "text-yellow-400" },
  high: { label: "较高", color: "text-orange-400" },
  premium: { label: "高级", color: "text-red-400" },
};

export default function SettingsModal({
  isOpen,
  onClose,
}: {
  isOpen: boolean;
  onClose: () => void;
}) {
  const [settings, setSettings] = useState<SettingsData | null>(null);
  const [selectedModel, setSelectedModel] = useState("");
  const [temperature, setTemperature] = useState(0.7);
  const [maxTokens, setMaxTokens] = useState(2000);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const loadSettings = useCallback(async () => {
    try {
      const res = await fetch("/api/settings");
      const data = await res.json();
      if (data.success) {
        setSettings(data.data);
        setSelectedModel(data.data.currentModel);
        setTemperature(data.data.temperature);
        setMaxTokens(data.data.maxTokens);
      }
    } catch {
      setError("加载配置失败");
    }
  }, []);

  useEffect(() => {
    if (isOpen) {
      loadSettings();
    }
  }, [isOpen, loadSettings]);

  const handleSave = async () => {
    setSaving(true);
    setError("");
    try {
      const res = await fetch("/api/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: selectedModel,
          temperature,
          maxTokens,
        }),
      });
      const data = await res.json();
      if (data.success) {
        onClose();
      } else {
        setError(data.error || "保存失败");
      }
    } catch {
      setError("网络错误");
    } finally {
      setSaving(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="w-full max-w-lg rounded-xl border border-gray-700 bg-gray-900 p-6 shadow-2xl">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-bold text-white">AI 模型设置</h2>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-white"
          >
            ✕
          </button>
        </div>

        {!settings ? (
          <div className="py-8 text-center text-gray-400">加载中...</div>
        ) : (
          <div className="space-y-5">
            {/* API Key 状态 */}
            <div className="flex items-center gap-2 text-sm">
              <span
                className={`h-2 w-2 rounded-full ${settings.hasApiKey ? "bg-green-500" : "bg-red-500"}`}
              />
              <span className="text-gray-400">
                {settings.hasApiKey
                  ? "API Key 已配置"
                  : "未配置 API Key（请在 .env 中设置 TUZI_API_KEY）"}
              </span>
            </div>

            {/* 模型选择 */}
            <div>
              <label className="mb-2 block text-sm font-medium text-gray-300">
                选择模型
              </label>
              <div className="space-y-2">
                {settings.availableModels.map((model) => {
                  const cost = COST_LABELS[model.costTier] || COST_LABELS.medium;
                  const isSelected = selectedModel === model.id;
                  return (
                    <button
                      key={model.id}
                      onClick={() => setSelectedModel(model.id)}
                      className={`w-full rounded-lg border p-3 text-left transition-all ${
                        isSelected
                          ? "border-blue-500 bg-blue-500/10"
                          : "border-gray-700 bg-gray-800 hover:border-gray-600"
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <div>
                          <span className="font-medium text-white">
                            {model.name}
                          </span>
                          <span className="ml-2 text-xs text-gray-500">
                            {model.provider}
                          </span>
                        </div>
                        <span className={`text-xs ${cost.color}`}>
                          {cost.label}
                        </span>
                      </div>
                      <p className="mt-1 text-xs text-gray-400">
                        {model.description}
                      </p>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* 温度滑块 */}
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-300">
                创意度 (Temperature): {temperature.toFixed(1)}
              </label>
              <input
                type="range"
                min="0"
                max="2"
                step="0.1"
                value={temperature}
                onChange={(e) => setTemperature(parseFloat(e.target.value))}
                className="w-full accent-blue-500"
              />
              <div className="flex justify-between text-xs text-gray-500">
                <span>精确 (0)</span>
                <span>均衡 (0.7)</span>
                <span>创意 (2.0)</span>
              </div>
            </div>

            {/* 最大 Token */}
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-300">
                最大输出长度: {maxTokens}
              </label>
              <input
                type="range"
                min="500"
                max="8000"
                step="500"
                value={maxTokens}
                onChange={(e) => setMaxTokens(parseInt(e.target.value, 10))}
                className="w-full accent-blue-500"
              />
              <div className="flex justify-between text-xs text-gray-500">
                <span>简短 (500)</span>
                <span>标准 (2000)</span>
                <span>详细 (8000)</span>
              </div>
            </div>

            {/* 错误提示 */}
            {error && (
              <p className="text-sm text-red-400">{error}</p>
            )}

            {/* 操作按钮 */}
            <div className="flex justify-end gap-3">
              <button
                onClick={onClose}
                className="rounded-lg border border-gray-600 px-4 py-2 text-sm text-gray-300 hover:bg-gray-800"
              >
                取消
              </button>
              <button
                onClick={handleSave}
                disabled={saving}
                className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
              >
                {saving ? "保存中..." : "保存设置"}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
