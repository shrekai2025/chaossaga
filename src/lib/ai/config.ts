/**
 * ChaosSaga - LLM 配置管理
 *
 * 配置优先级：
 * 1. 数据库 GameConfig 表（运行时可通过 UI 修改）
 * 2. 环境变量（部署时设置）
 * 3. 默认值
 */

import { prisma } from "@/lib/db/prisma";
import type { LLMConfig, ModelDefinition } from "./adapters/types";
import { AVAILABLE_MODELS, AVAILABLE_PROVIDERS } from "./adapters/types";
import type { ProviderDefinition } from "./adapters/types";

/** 配置键名 */
const CONFIG_KEYS = {
  MODEL: "llm_model",
  TEMPERATURE: "llm_temperature",
  MAX_TOKENS: "llm_max_tokens",
  CUSTOM_MODELS: "custom_models",
} as const;

/** 默认配置值 */
const DEFAULTS = {
  model: "gpt-4o-mini",
  temperature: 0.7,
  maxTokens: 4096,
  baseUrl: "https://api.tu-zi.com",
} as const;

/**
 * 从数据库获取配置值，不存在则返回 null
 */
async function getConfigFromDB(key: string): Promise<string | null> {
  try {
    const config = await prisma.gameConfig.findUnique({ where: { key } });
    return config?.value ?? null;
  } catch {
    // 数据库不可用时静默降级到环境变量
    return null;
  }
}

/**
 * 设置数据库中的配置值
 */
async function setConfigInDB(key: string, value: string): Promise<void> {
  await prisma.gameConfig.upsert({
    where: { key },
    update: { value },
    create: { key, value },
  });
}

/**
 * 获取指定渠道商的凭证配置
 */
function getProviderConfig(provider: ProviderDefinition): {
  apiKey: string;
  baseUrl: string;
  extraHeaders?: Record<string, string>;
} {
  const apiKey = process.env[provider.envApiKeyName] || "";
  const baseUrl = process.env[provider.envBaseUrlName] || provider.defaultBaseUrl;
  return { apiKey, baseUrl, extraHeaders: provider.extraHeaders };
}

/**
 * 获取完整的 LLM 配置
 *
 * 根据当前模型的 providerId 自动解析对应渠道商的凭证。
 */
export async function getLLMConfig(): Promise<LLMConfig> {
  // 模型：数据库 → 环境变量 → 默认
  const dbModel = await getConfigFromDB(CONFIG_KEYS.MODEL);
  const model = dbModel || process.env.LLM_MODEL || DEFAULTS.model;

  // 温度：数据库 → 环境变量 → 默认
  const dbTemp = await getConfigFromDB(CONFIG_KEYS.TEMPERATURE);
  const temperature = parseFloat(
    dbTemp || process.env.LLM_TEMPERATURE || String(DEFAULTS.temperature)
  );

  // 最大 token：数据库 → 环境变量 → 默认
  const dbMaxTokens = await getConfigFromDB(CONFIG_KEYS.MAX_TOKENS);
  const maxTokens = parseInt(
    dbMaxTokens || process.env.LLM_MAX_TOKENS || String(DEFAULTS.maxTokens),
    10
  );

  // 根据模型查找渠道商，解析凭证
  const allModels = await getAllModels();
  const modelDef = allModels.find((m) => m.id === model);
  const providerId = modelDef?.providerId || "tuzi";
  const providerDef = AVAILABLE_PROVIDERS.find((p) => p.id === providerId)
    || AVAILABLE_PROVIDERS[0]; // 兆底 Tuzi
  const { apiKey, baseUrl, extraHeaders } = getProviderConfig(providerDef);

  return { apiKey, baseUrl, model, temperature, maxTokens, extraHeaders };
}

/**
 * 更新 LLM 模型配置（通过前端设置页调用）
 */
export async function updateLLMModel(modelId: string): Promise<void> {
  // 校验模型 ID 是否有效（内置 + 自定义）
  const allModels = await getAllModels();
  const model = allModels.find((m) => m.id === modelId);
  if (!model) {
    throw new Error(`无效的模型 ID: ${modelId}`);
  }
  await setConfigInDB(CONFIG_KEYS.MODEL, modelId);
}

/**
 * 更新 LLM 温度配置
 */
export async function updateLLMTemperature(temp: number): Promise<void> {
  if (temp < 0 || temp > 2) {
    throw new Error("温度值必须在 0-2 之间");
  }
  await setConfigInDB(CONFIG_KEYS.TEMPERATURE, String(temp));
}

/**
 * 更新 LLM 最大 token 配置
 */
export async function updateLLMMaxTokens(tokens: number): Promise<void> {
  if (tokens < 100 || tokens > 32768) {
    throw new Error("最大 token 数必须在 100-32768 之间");
  }
  await setConfigInDB(CONFIG_KEYS.MAX_TOKENS, String(tokens));
}

// ============================================================
// 自定义模型管理
// ============================================================

/**
 * 从数据库获取自定义模型列表
 */
export async function getCustomModels(): Promise<ModelDefinition[]> {
  const raw = await getConfigFromDB(CONFIG_KEYS.CUSTOM_MODELS);
  if (!raw) return [];
  try {
    return JSON.parse(raw) as ModelDefinition[];
  } catch {
    return [];
  }
}

/**
 * 获取所有模型（内置 + 自定义）
 */
export async function getAllModels(): Promise<ModelDefinition[]> {
  const custom = await getCustomModels();
  return [...AVAILABLE_MODELS, ...custom];
}

/**
 * 添加自定义模型
 */
export async function addCustomModel(model: ModelDefinition): Promise<void> {
  // 校验 ID 不与内置模型冲突
  if (AVAILABLE_MODELS.find((m) => m.id === model.id)) {
    throw new Error(`模型 ID "${model.id}" 与内置模型冲突`);
  }
  const existing = await getCustomModels();
  if (existing.find((m) => m.id === model.id)) {
    throw new Error(`模型 ID "${model.id}" 已存在`);
  }
  existing.push(model);
  await setConfigInDB(CONFIG_KEYS.CUSTOM_MODELS, JSON.stringify(existing));
}

/**
 * 删除自定义模型
 */
export async function deleteCustomModel(modelId: string): Promise<void> {
  const existing = await getCustomModels();
  const filtered = existing.filter((m) => m.id !== modelId);
  if (filtered.length === existing.length) {
    throw new Error(`未找到自定义模型: ${modelId}`);
  }
  await setConfigInDB(CONFIG_KEYS.CUSTOM_MODELS, JSON.stringify(filtered));
}

/**
 * 获取所有可用模型列表（前端展示用）
 */
export async function getAvailableModels() {
  const allModels = await getAllModels();
  return allModels.map((m) => ({
    id: m.id,
    name: m.name,
    provider: m.provider,
    providerId: m.providerId,
    apiFormat: m.apiFormat,
    costTier: m.costTier,
    description: m.description,
    isCustom: !AVAILABLE_MODELS.find((b) => b.id === m.id),
  }));
}

/**
 * 获取所有渠道商及其配置状态（前端展示用）
 */
export function getProviders() {
  return AVAILABLE_PROVIDERS.map((p) => ({
    id: p.id,
    name: p.name,
    description: p.description,
    hasApiKey: !!process.env[p.envApiKeyName],
    baseUrl: process.env[p.envBaseUrlName] || p.defaultBaseUrl,
  }));
}
