/**
 * /api/settings - 全局游戏配置 API
 *
 * GET  - 获取当前 LLM 配置和可用模型列表
 * POST - 更新 LLM 配置（模型、温度、最大token）/ 添加删除自定义模型
 */

import { NextResponse } from "next/server";
import {
  getLLMConfig,
  getAvailableModels,
  getProviders,
  updateLLMModel,
  updateLLMTemperature,
  updateLLMMaxTokens,
  addCustomModel,
  deleteCustomModel,
} from "@/lib/ai/config";

export async function GET() {
  try {
    const config = await getLLMConfig();
    const models = await getAvailableModels();
    const providers = getProviders();

    return NextResponse.json({
      success: true,
      data: {
        currentModel: config.model,
        temperature: config.temperature,
        maxTokens: config.maxTokens,
        hasApiKey: !!config.apiKey,
        providers,
        availableModels: models,
      },
    });
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "获取配置失败",
      },
      { status: 500 }
    );
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { model, temperature, maxTokens, action, modelData, modelId } = body;

    // 自定义模型操作
    if (action === "addModel" && modelData) {
      await addCustomModel({
        id: modelData.id,
        name: modelData.name,
        provider: modelData.provider || "Custom",
        providerId: modelData.providerId || "tuzi",
        apiFormat: modelData.apiFormat || "openai",
        costTier: modelData.costTier || "medium",
        description: modelData.description || "",
        supportsTools: true,
        supportsStreaming: true,
        supportsMultimodal: false,
        maxOutputTokens: modelData.maxOutputTokens || 4096,
      });
      const models = await getAvailableModels();
      return NextResponse.json({ success: true, data: { availableModels: models } });
    }

    if (action === "deleteModel" && modelId) {
      await deleteCustomModel(modelId);
      const models = await getAvailableModels();
      return NextResponse.json({ success: true, data: { availableModels: models } });
    }

    // 常规配置更新
    if (model !== undefined) {
      await updateLLMModel(model);
    }
    if (temperature !== undefined) {
      await updateLLMTemperature(temperature);
    }
    if (maxTokens !== undefined) {
      await updateLLMMaxTokens(maxTokens);
    }

    // 返回更新后的配置
    const config = await getLLMConfig();
    return NextResponse.json({
      success: true,
      data: {
        currentModel: config.model,
        temperature: config.temperature,
        maxTokens: config.maxTokens,
      },
    });
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "更新配置失败",
      },
      { status: 400 }
    );
  }
}
