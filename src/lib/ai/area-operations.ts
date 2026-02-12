/**
 * ChaosSaga - 区域操作模块
 *
 * 提供两大核心功能：
 * 1. checkAreaIntegrity() - 区域数据完整性检查与 LLM 语义补全
 * 2. expandArea() - 基于拓扑感知的区域智能扩展
 *
 * 两者均不复用 gamemaster.ts 的聊天流程，直接使用 LLMClient 发起
 * 非对话式的结构化生成请求。
 */

import { prisma } from "@/lib/db/prisma";
import { LLMClient } from "./llm-client";
import { getLLMConfig } from "./config";
import { logPlayerAction } from "@/lib/game/logger";

// ============================================================
// LLM 调用超时工具
// ============================================================

const LLM_TIMEOUT_MS = 120_000; // 120 秒超时

/** 给 Promise 包装超时，防止 LLM API 无响应导致永久挂起 */
function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`[${label}] LLM 调用超时（${ms / 1000}s），请检查网络连接或 API 密钥`));
    }, ms);
    promise
      .then((val) => { clearTimeout(timer); resolve(val); })
      .catch((err) => { clearTimeout(timer); reject(err); });
  });
}

// ============================================================
// LLM JSON 输出修复工具
// ============================================================

/**
 * 尝试修复 LLM 生成的不规范 JSON
 * 常见问题：尾逗号、缺少逗号、未闭合的括号、截断输出等
 */
function repairJSON(raw: string): string {
  let s = raw;

  // 1. 去除可能的 markdown 代码块标记
  s = s.replace(/^```(?:json)?\s*\n?/i, "").replace(/\n?```\s*$/i, "");

  // 2. 移除 JSON 中的行注释 (// ...)
  s = s.replace(/\/\/[^\n]*/g, "");

  // 3. 移除尾逗号 — ,] 或 ,}
  s = s.replace(/,\s*([\]}])/g, "$1");

  // 4. 修复缺少逗号的情况：} { 或 } "  或 ] { 或 ] " (两个值之间)
  s = s.replace(/(\})\s*(\{)/g, "$1,$2");
  s = s.replace(/(\})\s*(")/g, "$1,$2");
  s = s.replace(/(\])\s*(\{)/g, "$1,$2");
  s = s.replace(/(\")\s*\n\s*(\{)/g, "$1,$2");
  // 修复数组元素间缺少逗号: "..." \n "..."
  s = s.replace(/(\")\s*\n\s*(\")/g, "$1,$2");

  // 5. 尝试闭合未完成的括号
  let braces = 0, brackets = 0;
  let inString = false, escape = false;
  for (const ch of s) {
    if (escape) { escape = false; continue; }
    if (ch === "\\") { escape = true; continue; }
    if (ch === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (ch === "{") braces++;
    else if (ch === "}") braces--;
    else if (ch === "[") brackets++;
    else if (ch === "]") brackets--;
  }
  // 补齐缺失的闭合符号
  while (brackets > 0) { s += "]"; brackets--; }
  while (braces > 0) { s += "}"; braces--; }

  return s;
}

/**
 * 处理截断的 JSON — 当 LLM 因 max_tokens 输出被截断时，
 * 回退到最后一个完整的数组元素，截掉不完整的尾部
 */
function truncateToLastComplete(raw: string): string {
  // 策略：找到 "fixes" 数组内最后一个完整的 } 并截断后面的内容
  // 从后往前找到最后一个 },  或 }] 模式
  // 先找到 "fixes" 的位置
  const fixesIdx = raw.indexOf('"fixes"');
  if (fixesIdx === -1) return raw;

  // 从 fixes 位置开始，逐字符扫描找到所有完整的 {} 对象
  let depth = 0;
  let inStr = false;
  let esc = false;
  let lastCompleteObjEnd = -1;
  let arrayStart = -1;

  for (let i = fixesIdx; i < raw.length; i++) {
    const ch = raw[i];
    if (esc) { esc = false; continue; }
    if (ch === "\\") { esc = true; continue; }
    if (ch === '"') { inStr = !inStr; continue; }
    if (inStr) continue;

    if (ch === "[" && arrayStart === -1) {
      arrayStart = i;
      continue;
    }
    if (arrayStart === -1) continue;

    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) {
        // 完成了一个顶级对象
        lastCompleteObjEnd = i;
      }
    }
  }

  if (lastCompleteObjEnd > arrayStart) {
    // 截断到最后一个完整对象，关闭数组和外层对象
    const truncated = raw.slice(0, lastCompleteObjEnd + 1) + "]}";
    console.log(`[json-repair] 截断到最后完整对象, pos=${lastCompleteObjEnd}, 原长=${raw.length}`);
    return truncated;
  }

  return raw;
}

/** 从 LLM 输出中提取并解析 JSON，带修复重试和截断恢复 */
function extractJSON(content: string, label: string): { parsed: Record<string, unknown> | null; error: string | null; truncated?: boolean } {
  const trimmed = content.trim();

  // 对于截断的输出，可能没有完整的 {...}，尝试找到 { 开头即可
  let raw: string;
  const jsonMatch = trimmed.match(/\{[\s\S]*\}/);
  if (jsonMatch) {
    raw = jsonMatch[0];
  } else {
    // 没有完整的 {}，可能被截断 — 找到第一个 { 取到末尾
    const firstBrace = trimmed.indexOf("{");
    if (firstBrace === -1) {
      console.error(`[${label}] 无法从 LLM 输出中提取 JSON 块, 前 200 字符:`, trimmed.slice(0, 200));
      return { parsed: null, error: "LLM 返回内容中未找到 JSON" };
    }
    raw = trimmed.slice(firstBrace);
    console.warn(`[${label}] JSON 未闭合（可能被截断），尝试修复`);
  }

  // 第一次尝试：直接解析
  try {
    return { parsed: JSON.parse(raw), error: null };
  } catch (e1) {
    console.warn(`[${label}] 直接 JSON.parse 失败，尝试修复:`, (e1 as Error).message);
  }

  // 第二次尝试：基本修复（逗号、闭合等）
  try {
    const repaired = repairJSON(raw);
    const parsed = JSON.parse(repaired);
    console.log(`[${label}] JSON 基本修复成功`);
    return { parsed, error: null };
  } catch (e2) {
    console.warn(`[${label}] 基本修复失败，尝试截断恢复:`, (e2 as Error).message);
  }

  // 第三次尝试：截断恢复 — 找最后一个完整对象
  try {
    const truncated = truncateToLastComplete(raw);
    const repaired = repairJSON(truncated);
    const parsed = JSON.parse(repaired);
    console.log(`[${label}] JSON 截断恢复成功`);
    return { parsed, error: null, truncated: true };
  } catch (e3) {
    console.error(`[${label}] 所有 JSON 修复策略均失败:`, (e3 as Error).message);
    console.error(`[${label}] 原始内容末尾 200 字符:`, raw.slice(-200));
    return { parsed: null, error: `LLM 返回的 JSON 被截断且无法恢复（finishReason=length）` };
  }
}

// ============================================================
// 类型定义
// ============================================================

/** 完整性检查发现的问题 */
export interface IntegrityIssue {
  nodeId?: string;
  nodeName?: string;
  type:
    | "missing_safe_node"
    | "missing_boss_node"
    | "missing_data"
    | "incomplete_data"
    | "orphan_node"
    | "theme_mismatch"
    | "level_mismatch"
    | "weak_narrative"
    | "missing_npc"
    | "missing_shop_items"
    | "missing_enemy_templates"
    | "boss_missing_skill_drop";
  severity: "error" | "warning" | "info";
  description: string;
}

/** 完整性修复操作 */
export interface IntegrityFix {
  nodeId: string;
  nodeName: string;
  description: string;
  changes: Record<string, unknown>;
}

/** SSE 事件（完整性检查） */
export type CheckSSEEvent =
  | { type: "checking"; message: string }
  | { type: "issue"; data: IntegrityIssue }
  | { type: "fixing"; message: string }
  | { type: "fixed"; data: IntegrityFix }
  | { type: "summary"; data: { issuesFound: number; issuesFixed: number; details: string[] } }
  | { type: "error"; message: string }
  | { type: "done" };

/** SSE 事件（区域扩展） */
export type ExpandSSEEvent =
  | { type: "analyzing"; message: string }
  | { type: "planning"; message: string }
  | { type: "generating"; message: string }
  | { type: "node_created"; data: { id: string; name: string; type: string; description: string } }
  | { type: "connecting"; message: string }
  | { type: "summary"; data: { newNodes: number; newConnections: number; details: string[] } }
  | { type: "error"; message: string }
  | { type: "done" };

// ============================================================
// 主题→元素映射
// ============================================================

const THEME_ELEMENT_MAP: Record<string, string[]> = {
  ocean: ["water", "ice"],
  forest: ["wood", "wind", "earth"],
  desert: ["fire", "earth"],
  cave: ["earth", "dark"],
  city: ["light", "dark"],
  mountain: ["earth", "wind"],
  swamp: ["water", "dark", "wood"],
  volcano: ["fire"],
  ice: ["water", "ice", "wind"],
};

// ============================================================
// 区域数据加载
// ============================================================

interface LoadedArea {
  id: string;
  name: string;
  description: string;
  theme: string;
  recommendedLevel: number;
  nodes: Array<{
    id: string;
    name: string;
    type: string;
    description: string;
    data: Record<string, unknown> | null;
    posX: number;
    posY: number;
  }>;
  connections: Array<{ fromId: string; toId: string }>;
}

async function loadAreaFull(areaId: string): Promise<LoadedArea | null> {
  const area = await prisma.area.findUnique({
    where: { id: areaId },
    include: {
      nodes: {
        select: {
          id: true,
          name: true,
          type: true,
          description: true,
          data: true,
          posX: true,
          posY: true,
        },
      },
    },
  });

  if (!area) return null;

  const nodeIds = area.nodes.map((n) => n.id);
  const connections = await prisma.areaNodeConnection.findMany({
    where: { fromId: { in: nodeIds } },
    select: { fromId: true, toId: true },
  });

  // 去重（只保留一个方向）
  const seen = new Set<string>();
  const uniqueConnections = connections.filter((c) => {
    const key = [c.fromId, c.toId].sort().join("-");
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  return {
    id: area.id,
    name: area.name,
    description: area.description,
    theme: area.theme,
    recommendedLevel: area.recommendedLevel,
    nodes: area.nodes.map((n) => ({
      ...n,
      data: n.data as Record<string, unknown> | null,
    })),
    connections: uniqueConnections,
  };
}

// ============================================================
// 1. 完整性检查 — 程序化快速检查
// ============================================================

function programmaticCheck(area: LoadedArea): IntegrityIssue[] {
  const issues: IntegrityIssue[] = [];

  // 1.1 结构完整性：是否有 safe 入口节点
  const hasSafe = area.nodes.some((n) => n.type === "safe");
  if (!hasSafe) {
    issues.push({
      type: "missing_safe_node",
      severity: "error",
      description: `区域「${area.name}」缺少安全区（safe）入口节点`,
    });
  }

  // 1.2 结构完整性：是否有 boss 节点（5+ 节点的区域应有 boss）
  if (area.nodes.length >= 5) {
    const hasBoss = area.nodes.some((n) => n.type === "boss");
    if (!hasBoss) {
      issues.push({
        type: "missing_boss_node",
        severity: "warning",
        description: `区域有 ${area.nodes.length} 个节点但缺少 BOSS 节点`,
      });
    }
  }

  // 1.3 数据完整性：按类型检查 data 字段
  for (const node of area.nodes) {
    const data = node.data || {};

    switch (node.type) {
      case "battle": {
        const templates = data.enemyTemplates as unknown[] | undefined;
        if (!templates || !Array.isArray(templates) || templates.length === 0) {
          issues.push({
            nodeId: node.id,
            nodeName: node.name,
            type: "missing_enemy_templates",
            severity: "error",
            description: `战斗节点「${node.name}」缺少 enemyTemplates`,
          });
        }
        break;
      }
      case "npc": {
        const npcs = data.npcs as unknown[] | undefined;
        const npc = data.npc;
        if ((!npcs || !Array.isArray(npcs) || npcs.length === 0) && !npc) {
          issues.push({
            nodeId: node.id,
            nodeName: node.name,
            type: "missing_npc",
            severity: "error",
            description: `NPC 节点「${node.name}」缺少 npcs 数组`,
          });
        }
        break;
      }
      case "shop": {
        const npcs = data.npcs as unknown[] | undefined;
        const npc = data.npc;
        if ((!npcs || !Array.isArray(npcs) || npcs.length === 0) && !npc) {
          issues.push({
            nodeId: node.id,
            nodeName: node.name,
            type: "missing_npc",
            severity: "error",
            description: `商店节点「${node.name}」缺少掌柜 NPC`,
          });
        }
        const shopItems = data.shopItems as unknown[] | undefined;
        if (!shopItems || !Array.isArray(shopItems) || shopItems.length === 0) {
          issues.push({
            nodeId: node.id,
            nodeName: node.name,
            type: "missing_shop_items",
            severity: "error",
            description: `商店节点「${node.name}」缺少商品列表 shopItems`,
          });
        }
        break;
      }
      case "boss": {
        const boss = data.boss as Record<string, unknown> | undefined;
        if (!boss) {
          issues.push({
            nodeId: node.id,
            nodeName: node.name,
            type: "missing_data",
            severity: "error",
            description: `BOSS 节点「${node.name}」缺少 boss 数据`,
          });
        } else {
          // 检查 BOSS 是否有技能掉落
          const drops = boss.drops as Array<Record<string, unknown>> | undefined;
          const hasSkillDrop = drops?.some((d) => d.type === "skill");
          if (!hasSkillDrop) {
            issues.push({
              nodeId: node.id,
              nodeName: node.name,
              type: "boss_missing_skill_drop",
              severity: "warning",
              description: `BOSS「${boss.name || node.name}」缺少技能掉落（drops 中无 type='skill' 项）`,
            });
          }
          // 检查技能元素是否匹配主题
          if (hasSkillDrop && drops) {
            const expectedElements = THEME_ELEMENT_MAP[area.theme] || [];
            if (expectedElements.length > 0) {
              for (const drop of drops) {
                if (drop.type !== "skill") continue;
                const skillData = drop.skillData as Record<string, unknown> | undefined;
                const element = (skillData?.element as string) || "";
                if (element && !expectedElements.includes(element)) {
                  issues.push({
                    nodeId: node.id,
                    nodeName: node.name,
                    type: "theme_mismatch",
                    severity: "warning",
                    description: `BOSS 技能掉落元素「${element}」与区域主题「${area.theme}」不匹配（期望: ${expectedElements.join("/")}）`,
                  });
                }
              }
            }
          }
        }
        break;
      }
    }

    // 1.4 叙事丰富度：描述过短
    if (node.description && node.description.length < 10) {
      issues.push({
        nodeId: node.id,
        nodeName: node.name,
        type: "weak_narrative",
        severity: "info",
        description: `节点「${node.name}」的描述过短（${node.description.length} 字），建议丰富环境描写`,
      });
    }
  }

  // 1.5 连通性检查：BFS 检测孤岛节点
  if (area.nodes.length > 1) {
    const adjMap = new Map<string, Set<string>>();
    for (const node of area.nodes) {
      adjMap.set(node.id, new Set());
    }
    for (const conn of area.connections) {
      adjMap.get(conn.fromId)?.add(conn.toId);
      adjMap.get(conn.toId)?.add(conn.fromId);
    }

    const visited = new Set<string>();
    const queue = [area.nodes[0].id];
    visited.add(area.nodes[0].id);

    while (queue.length > 0) {
      const current = queue.shift()!;
      const neighbors = adjMap.get(current);
      if (!neighbors) continue;
      for (const neighbor of neighbors) {
        if (!visited.has(neighbor)) {
          visited.add(neighbor);
          queue.push(neighbor);
        }
      }
    }

    for (const node of area.nodes) {
      if (!visited.has(node.id)) {
        issues.push({
          nodeId: node.id,
          nodeName: node.name,
          type: "orphan_node",
          severity: "error",
          description: `节点「${node.name}」与入口不连通（孤岛节点）`,
        });
      }
    }
  }

  // 1.6 等级匹配检查：战斗节点敌人等级与推荐等级差异过大
  for (const node of area.nodes) {
    if (node.type !== "battle" && node.type !== "boss") continue;
    const data = node.data || {};
    const templates = (data.enemyTemplates as Array<{ level?: number }>) || [];
    const boss = data.boss as { level?: number } | undefined;

    const levels = [
      ...templates.map((t) => t.level).filter(Boolean) as number[],
      ...(boss?.level ? [boss.level] : []),
    ];

    for (const lvl of levels) {
      if (Math.abs(lvl - area.recommendedLevel) > 5) {
        issues.push({
          nodeId: node.id,
          nodeName: node.name,
          type: "level_mismatch",
          severity: "warning",
          description: `节点「${node.name}」中有等级 ${lvl} 的敌人，与推荐等级 ${area.recommendedLevel} 差距较大`,
        });
        break; // 每个节点只报一次
      }
    }
  }

  return issues;
}

// ============================================================
// 1. 完整性检查 — LLM 语义检查 + 修复
// ============================================================

/** 单节点修复的 system prompt — 只处理一个节点，输出紧凑 */
const CHECK_NODE_SYSTEM_PROMPT = `你是一个游戏区域质量审计员。你将收到一个游戏区域中某个节点的数据和已知问题，你需要修复它。

你必须以纯 JSON 格式输出，不要包含任何 markdown 标记或解释文字。
JSON 格式：
{
  "issue": "发现的问题简述",
  "fixDescription": "修复说明",
  "fixedData": { ... 修复后的完整 data 字段 ... }
}

【各节点类型的 data 字段完整规范】

battle 节点:
{ "enemyTemplates": [{ "name": "敌人名", "level": 数字, "element": "fire/water/wood/earth/metal/lightning/ice/dark/light", "minCount": 1, "maxCount": 3, "description": "描述" }] }

npc 节点:
{ "npcs": [{ "id": "唯一ID", "name": "NPC名", "role": "角色", "personality": "性格描述", "greeting": "问候语", "dialogTopics": ["话题1", "话题2"] }] }

shop 节点:
{ "npcs": [{ "id": "唯一ID", "name": "掌柜名", "role": "shopkeeper", "greeting": "问候语" }], "shopItems": [{ "name": "物品名", "type": "weapon|armor|consumable|material", "quality": "common|uncommon|rare|epic", "price": 数字, "stats": {"attack": 数字} 或 null, "description": "描述" }] }

boss 节点（特别重要，drops 必须包含 type="skill" 的技能掉落！）:
{ "boss": { "name": "BOSS名", "level": 数字, "element": "元素", "description": "描述", "hp": 数字, "attack": 数字, "defense": 数字, "speed": 数字, "skills": [{ "name": "技能名", "damage": 数字, "element": "元素", "type": "attack|heal|buff|aoe", "description": "描述" }], "phases": [{ "hpThreshold": 0.5, "unlockedSkills": ["技能名"], "description": "阶段描述" }], "drops": [{ "name": "物品名", "type": "material|equipment|skill", "quality": "rare|epic", "chance": 0.5, "stats": {}, "skillData": { "element": "元素", "damage": 数字, "mpCost": 数字, "cooldown": 数字 } }] } }
⚠️ BOSS 的 drops 数组中 **必须** 包含至少一个 type="skill" 的条目，该条目必须有完整的 skillData 字段！

event 节点:
{ "events": [{ "id": "唯一ID", "name": "事件名", "type": "treasure|trap|puzzle|story", "description": "描述" }] }

safe 节点:
{ "hints": ["提示1", "提示2"] }

注意：
- fixedData 必须包含该节点 data 字段的完整内容（不是增量，而是完整替换内容）
- 严格遵循上述规范，不要遗漏任何必需字段
- 保持与区域主题和风格一致，使用中国奇幻/仙侠风格
- 商店物品价格参考推荐等级 * 10 ~ * 50
- BOSS 数值参考：HP=等级*100~200, 攻击=等级*8~15, 防御=等级*5~10, 速度=等级*3~8
- 保持 JSON 紧凑，不要添加不必要的空白`;

type NodeFix = { nodeId: string; nodeName: string; issue: string; fixDescription: string; fixedData: Record<string, unknown> };

/**
 * 分段 LLM 语义检查 — 逐节点处理，每个有问题的节点单独一次 LLM 调用
 * 优势：payload 小、输出少、不会超时、用户可看到逐节点进度
 */
async function llmSemanticCheck(
  area: LoadedArea,
  programmaticIssues: IntegrityIssue[],
  onProgress?: (msg: string) => void
): Promise<{
  fixes: NodeFix[];
  error: string | null;
}> {
  // 按节点分组问题
  const issuesByNode = new Map<string, IntegrityIssue[]>();
  for (const issue of programmaticIssues) {
    if (!issue.nodeId) continue;
    const list = issuesByNode.get(issue.nodeId) || [];
    list.push(issue);
    issuesByNode.set(issue.nodeId, list);
  }

  if (issuesByNode.size === 0) {
    onProgress?.("没有需要 AI 修复的节点");
    return { fixes: [], error: null };
  }

  const config = await getLLMConfig();
  const client = new LLMClient({
    ...config,
    temperature: 0.3,
    maxTokens: 8192, // boss 节点数据较大，需要更多 token
  });

  // 获取主题对应的元素列表
  const themeElements = THEME_ELEMENT_MAP[area.theme] || [];

  const allFixes: NodeFix[] = [];
  const errors: string[] = [];
  const nodeEntries = Array.from(issuesByNode.entries());

  for (let i = 0; i < nodeEntries.length; i++) {
    const [nodeId, issues] = nodeEntries[i];
    const node = area.nodes.find((n) => n.id === nodeId);
    if (!node) continue;

    const progress = `(${i + 1}/${nodeEntries.length})`;
    onProgress?.(`${progress} 正在修复节点「${node.name}」(${node.type})...`);

    // 构建基础消息
    const payload: Record<string, unknown> = {
      area: { name: area.name, theme: area.theme, recommendedLevel: area.recommendedLevel, description: area.description },
      node: { id: node.id, name: node.name, type: node.type, description: node.description, data: node.data },
      issues: issues.map((i) => `[${i.severity}] ${i.description}`),
    };

    // 对 boss 节点追加强制约束，确保 LLM 生成技能掉落
    let extraInstruction = "";
    if (node.type === "boss") {
      const elemStr = themeElements.length > 0 ? themeElements.join("/") : "与主题一致的元素";
      extraInstruction = `\n\n⚠️ 极其重要：你生成的 fixedData.boss.drops 数组中【必须】包含一个 {"name":"技能名","type":"skill","quality":"rare","chance":0.5,"stats":{},"skillData":{"element":"${themeElements[0] || "earth"}","damage":数字,"mpCost":数字,"cooldown":数字}} 的条目！元素必须是 ${elemStr} 之一。没有 type="skill" 的 drops 会被系统拒绝！`;
    }

    const userMessage = JSON.stringify(payload) + extraInstruction;

    try {
      const t0 = Date.now();
      console.log(`[area-check] ${progress} 修复节点「${node.name}」, model: ${config.model}`);

      const response = await withTimeout(
        client.chat({
          model: config.model,
          systemPrompt: CHECK_NODE_SYSTEM_PROMPT,
          messages: [{ role: "user", content: userMessage }],
        }),
        LLM_TIMEOUT_MS,
        `area-check-node-${node.name}`
      );

      console.log(`[area-check] ${progress}「${node.name}」完成, 长度: ${response.content.length}, 耗时: ${Date.now() - t0}ms`);

      const { parsed, error } = extractJSON(response.content, `area-check-${node.name}`);
      if (parsed && parsed.fixedData) {
        allFixes.push({
          nodeId: node.id,
          nodeName: node.name,
          issue: (parsed.issue as string) || issues.map((i) => i.description).join("; "),
          fixDescription: (parsed.fixDescription as string) || "AI 自动修复",
          fixedData: parsed.fixedData as Record<string, unknown>,
        });
        onProgress?.(`${progress} ✅ 节点「${node.name}」修复方案已生成`);
      } else {
        errors.push(`节点「${node.name}」: ${error || "无修复数据"}`);
        onProgress?.(`${progress} ⚠️ 节点「${node.name}」修复失败: ${error || "无修复数据"}`);
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : "未知错误";
      console.error(`[area-check] ${progress}「${node.name}」失败:`, msg);
      errors.push(`节点「${node.name}」: ${msg}`);
      onProgress?.(`${progress} ❌ 节点「${node.name}」失败: ${msg}`);
    }
  }

  return {
    fixes: allFixes,
    error: errors.length > 0 ? `部分节点修复失败: ${errors.join("; ")}` : null,
  };
}

// ============================================================
// 1. 完整性检查 — 主函数
// ============================================================

const MAX_FIX_ROUNDS = 10;

/**
 * 对单个修复执行写入前验证
 * 返回 null 表示通过，返回 string 表示验证失败原因
 */
function validateFixBeforeWrite(node: { name: string; type: string }, fixedData: Record<string, unknown>): string | null {
  if (node.type === "boss") {
    const bossObj = fixedData.boss as Record<string, unknown> | undefined;
    if (!bossObj) return "fixedData 中缺少 boss 字段";
    const drops = bossObj.drops as Array<Record<string, unknown>> | undefined;
    const hasSkillDrop = drops?.some((d) => d.type === "skill");
    if (!hasSkillDrop) return "boss drops 中缺少 type='skill' 的技能掉落";
  }
  return null;
}

/**
 * 执行单轮检查 + 修复，返回本轮发现的问题数和修复数
 */
async function runOneCheckRound(
  areaId: string,
  round: number,
  onEvent: (event: CheckSSEEvent) => void
): Promise<{
  area: LoadedArea | null;
  issuesFound: number;
  fixedCount: number;
  fixDetails: string[];
  skipCount: number;
}> {
  const prefix = MAX_FIX_ROUNDS > 1 ? `[轮次 ${round}] ` : "";

  // 每轮重新加载数据（因为上一轮可能已修改）
  onEvent({ type: "checking", message: `${prefix}正在加载区域数据...` });
  const area = await loadAreaFull(areaId);
  if (!area) {
    onEvent({ type: "error", message: "区域不存在" });
    return { area: null, issuesFound: 0, fixedCount: 0, fixDetails: [], skipCount: 0 };
  }

  // 程序化检查
  onEvent({ type: "checking", message: `${prefix}正在进行结构化检查...` });
  const programmaticIssues = programmaticCheck(area);

  for (const issue of programmaticIssues) {
    onEvent({ type: "issue", data: issue });
  }

  if (programmaticIssues.length === 0) {
    onEvent({ type: "checking", message: `${prefix}结构化检查通过，无问题` });
    return { area, issuesFound: 0, fixedCount: 0, fixDetails: [], skipCount: 0 };
  }

  // LLM 修复
  onEvent({ type: "checking", message: `${prefix}正在进行 AI 语义分析...` });
  const llmResult = await llmSemanticCheck(area, programmaticIssues, (msg) => {
    onEvent({ type: "checking", message: `${prefix}${msg}` });
  });

  if (llmResult.error) {
    onEvent({ type: "error", message: `${prefix}${llmResult.error}` });
  }

  // 执行修复
  let fixedCount = 0;
  let skipCount = 0;
  const fixDetails: string[] = [];

  for (const fix of llmResult.fixes) {
    const node = area.nodes.find((n) => n.id === fix.nodeId);
    if (!node) {
      console.warn(`[area-check] LLM 返回的 nodeId ${fix.nodeId} 不属于区域 ${area.name}`);
      continue;
    }

    onEvent({ type: "fixing", message: `${prefix}正在修复节点「${fix.nodeName || node.name}」: ${fix.fixDescription}` });

    // 写入前验证
    const validationError = validateFixBeforeWrite(node, fix.fixedData);
    if (validationError) {
      console.warn(`[area-check] 修复「${node.name}」验证失败: ${validationError}`);
      onEvent({ type: "error", message: `${prefix}节点「${node.name}」修复数据验证失败: ${validationError}` });
      skipCount++;
      continue;
    }

    try {
      console.log(`[area-check] 写入节点「${node.name}」fixedData:`, JSON.stringify(fix.fixedData).slice(0, 300));
      await prisma.areaNode.update({
        where: { id: fix.nodeId },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        data: { data: fix.fixedData as any },
      });

      fixedCount++;
      const detail = `修复「${fix.nodeName || node.name}」: ${fix.fixDescription}`;
      fixDetails.push(detail);

      onEvent({
        type: "fixed",
        data: {
          nodeId: fix.nodeId,
          nodeName: fix.nodeName || node.name,
          description: fix.fixDescription,
          changes: fix.fixedData,
        },
      });
    } catch (error) {
      console.error(`[area-check] 修复节点 ${fix.nodeId} 失败:`, error);
      onEvent({
        type: "error",
        message: `${prefix}修复节点「${fix.nodeName || node.name}」失败: ${error instanceof Error ? error.message : "未知错误"}`,
      });
    }
  }

  return {
    area,
    issuesFound: programmaticIssues.length,
    fixedCount,
    fixDetails,
    skipCount,
  };
}

/**
 * 执行区域完整性检查并自动修复（多轮循环）
 *
 * 修复完成后自动重新检测，如果仍有问题则继续修复，
 * 最多执行 MAX_FIX_ROUNDS 轮，最后统一汇报。
 *
 * @param areaId 区域 ID
 * @param playerId 操作玩家 ID（用于日志）
 * @param onEvent SSE 事件回调
 */
export async function checkAreaIntegrity(
  areaId: string,
  playerId: string,
  onEvent: (event: CheckSSEEvent) => void
): Promise<void> {
  let totalIssuesFound = 0;
  let totalFixed = 0;
  let totalSkipped = 0;
  const allFixDetails: string[] = [];
  let areaName = "";
  let round = 0;

  for (round = 1; round <= MAX_FIX_ROUNDS; round++) {
    onEvent({ type: "checking", message: `━━━ 第 ${round} 轮检查 ━━━` });

    const result = await runOneCheckRound(areaId, round, onEvent);

    if (!result.area) {
      onEvent({ type: "done" });
      return;
    }
    areaName = result.area.name;
    totalIssuesFound += result.issuesFound;
    totalFixed += result.fixedCount;
    totalSkipped += result.skipCount;
    allFixDetails.push(...result.fixDetails);

    // 本轮没有发现问题 → 完全通过，退出循环
    if (result.issuesFound === 0) {
      onEvent({ type: "checking", message: `✅ 第 ${round} 轮检查通过，所有问题已修复！` });
      break;
    }

    // 本轮有问题但没有任何修复（全部跳过或失败） → 无法继续
    if (result.fixedCount === 0) {
      onEvent({ type: "checking", message: `⚠️ 第 ${round} 轮发现 ${result.issuesFound} 个问题但未能修复，停止重试` });
      break;
    }

    // 本轮有修复，继续下一轮重新检测
    if (round < MAX_FIX_ROUNDS) {
      onEvent({ type: "checking", message: `第 ${round} 轮修复了 ${result.fixedCount} 处，重新检测中...` });
    }
  }

  if (round > MAX_FIX_ROUNDS) {
    onEvent({ type: "error", message: `已达最大修复轮次 ${MAX_FIX_ROUNDS}，部分问题可能仍未解决` });
  }

  // 最终重新检测残余问题
  const finalArea = await loadAreaFull(areaId);
  const remainingIssues = finalArea ? programmaticCheck(finalArea) : [];

  // 记录操作日志
  await logPlayerAction(
    playerId,
    "area_check",
    `检查区域「${areaName}」完整性：${round} 轮，初始问题 ${totalIssuesFound}，修复 ${totalFixed} 处，残余 ${remainingIssues.length}`,
    { areaId, rounds: round, issuesFound: totalIssuesFound, issuesFixed: totalFixed, remaining: remainingIssues.length }
  );

  // 发送统一总结
  onEvent({
    type: "summary",
    data: {
      issuesFound: totalIssuesFound,
      issuesFixed: totalFixed,
      details: [
        `📊 共执行 ${round} 轮检查`,
        `🔍 累计发现 ${totalIssuesFound} 个问题`,
        `🔧 成功修复 ${totalFixed} 处`,
        ...(totalSkipped > 0 ? [`⏭️ 跳过 ${totalSkipped} 处（验证不通过）`] : []),
        ...(remainingIssues.length > 0
          ? [`⚠️ 残余 ${remainingIssues.length} 个问题:`, ...remainingIssues.map((i) => `  - [${i.severity}] ${i.description}`)]
          : [`✅ 所有问题已修复`]),
        "",
        "修复详情:",
        ...allFixDetails.map((d) => `  ✓ ${d}`),
      ],
    },
  });

  onEvent({ type: "done" });
}

// ============================================================
// 2. 区域扩展 — 边缘节点分析
// ============================================================

interface EdgeNode {
  id: string;
  name: string;
  type: string;
  connectionCount: number;
}

function findEdgeNodes(area: LoadedArea): EdgeNode[] {
  // 统计每个节点的连接数
  const connectionCounts = new Map<string, number>();
  for (const node of area.nodes) {
    connectionCounts.set(node.id, 0);
  }
  for (const conn of area.connections) {
    connectionCounts.set(conn.fromId, (connectionCounts.get(conn.fromId) || 0) + 1);
    connectionCounts.set(conn.toId, (connectionCounts.get(conn.toId) || 0) + 1);
  }

  // 找到连接数最少的节点（边缘节点），排除 boss 节点（不适合作为扩展锚点）
  return area.nodes
    .filter((n) => n.type !== "boss")
    .map((n) => ({
      id: n.id,
      name: n.name,
      type: n.type,
      connectionCount: connectionCounts.get(n.id) || 0,
    }))
    .sort((a, b) => a.connectionCount - b.connectionCount);
}

// ============================================================
// 2. 区域扩展 — LLM 生成新节点
// ============================================================

const EXPAND_SYSTEM_PROMPT = `你是一个游戏世界构建师。你的职责是为现有游戏区域生成新的探索节点，使区域更加丰富。

你需要生成新节点并指定它们与现有节点的连接关系。

你必须以纯 JSON 格式输出，不要包含任何 markdown 标记或解释文字。
JSON 格式：
{
  "nodes": [
    {
      "id": "逻辑ID（如 new-fishing-village）",
      "name": "节点名称",
      "type": "safe|battle|npc|boss|event|shop",
      "description": "节点环境描述（30-60字，注重感官描写，中国奇幻风格）",
      "data": {
        "按节点类型填充完整数据"
      },
      "connectTo": "要连接的现有节点的数据库 ID"
    }
  ],
  "internalConnections": [["new-node-a", "new-node-b"]]
}

节点 data 字段规范：
- battle: { "enemyTemplates": [{ "name": "...", "level": N, "element": "...", "minCount": N, "maxCount": N, "description": "..." }] }
- npc: { "npcs": [{ "id": "唯一ID", "name": "NPC名", "role": "角色", "personality": "性格", "greeting": "问候语", "dialogTopics": ["话题1", "话题2"] }] }
- shop: { "npcs": [{ "id": "唯一ID", "name": "掌柜名", "role": "shopkeeper", "greeting": "问候语" }], "shopItems": [{ "name": "物品名", "type": "weapon|armor|consumable|material", "quality": "common|uncommon|rare|epic", "price": N, "stats": {"attack": N} 或 null, "description": "描述" }] }
- boss: { "boss": { "name": "BOSS名", "level": N, "element": "...", "description": "描述", "hp": N, "attack": N, "defense": N, "speed": N, "skills": [{ "name": "技能名", "damage": N, "element": "...", "type": "attack|heal|buff|aoe", "description": "描述" }], "phases": [{ "hpThreshold": 0.5, "unlockedSkills": ["技能名"], "description": "描述" }], "drops": [{ "name": "物品名", "type": "material|equipment|skill", "quality": "...", "chance": 0.5, "stats": {}, "skillData": { "element": "...", "damage": N, "mpCost": N, "cooldown": N } }] } }
- event: { "events": [{ "id": "唯一ID", "name": "事件名", "type": "treasure|trap|puzzle|story", "description": "描述" }] }
- safe: { "hints": ["提示1", "提示2"] }

注意：
- 新节点的 connectTo 必须使用现有节点的实际数据库 ID（不要编造）
- 新节点之间的连接用 internalConnections（使用逻辑 ID）
- 如果有 boss 节点，drops 必须包含至少一个 type='skill' 的技能掉落
- 所有内容必须与原区域主题一致
- 保持中国奇幻/仙侠风格`;

async function llmExpandArea(
  area: LoadedArea,
  edgeNodes: EdgeNode[],
  newNodeCount: number,
  hint: string,
  onProgress?: (msg: string) => void
): Promise<{
  result: {
    nodes: Array<{
      id: string;
      name: string;
      type: string;
      description: string;
      data: Record<string, unknown>;
      connectTo: string;
    }>;
    internalConnections: string[][];
  } | null;
  error: string | null;
}> {
  const config = await getLLMConfig();
  const client = new LLMClient({
    ...config,
    temperature: 0.7,
    maxTokens: 20480,
  });

  // 构建 LLM 请求
  const existingSummary = area.nodes.map((n) => `- ${n.name}（${n.type}）: ${n.description}`).join("\n");
  const edgeNodesSummary = edgeNodes
    .slice(0, 5)
    .map((n) => `- ID: ${n.id}, 名称: ${n.name}, 类型: ${n.type}, 连接数: ${n.connectionCount}`)
    .join("\n");

  const needBoss = newNodeCount >= 5;
  const themeElements = THEME_ELEMENT_MAP[area.theme] || [];

  const userMessage = `请为以下区域生成 ${newNodeCount} 个新节点。

【区域信息】
名称: ${area.name}
主题: ${area.theme}
推荐等级: ${area.recommendedLevel}
描述: ${area.description}
元素倾向: ${themeElements.join("、") || "无特定"}

【现有节点】
${existingSummary}

【边缘节点（可连接新节点的位置）】
${edgeNodesSummary}

【要求】
- 生成 ${newNodeCount} 个新节点
- 从边缘节点自然延伸
- 至少包含 1 个 safe 节点和 1 个 battle 节点
${needBoss ? `- 必须包含 1 个 boss 节点（掉落技能元素应为: ${themeElements.join("/")}）` : "- 不需要 boss 节点"}
- 新节点之间也要有合理的连接
${hint ? `\n【玩家扩展方向提示】\n${hint}` : ""}`;

  try {
    console.log("[area-expand] 开始 LLM 生成新节点, model:", config.model, ", nodeCount:", newNodeCount);
    onProgress?.(`正在等待 AI 生成 ${newNodeCount} 个节点（最长等待 ${LLM_TIMEOUT_MS / 1000}s）...`);

    const t0 = Date.now();
    const chatPromise = client.chat({
      model: config.model,
      systemPrompt: EXPAND_SYSTEM_PROMPT,
      messages: [{ role: "user", content: userMessage }],
    });

    // 每 15 秒推送一次心跳
    const heartbeat = setInterval(() => {
      const elapsed = Math.round((Date.now() - t0) / 1000);
      onProgress?.(`AI 生成中... 已等待 ${elapsed}s`);
    }, 15_000);

    let response;
    try {
      response = await withTimeout(chatPromise, LLM_TIMEOUT_MS, "area-expand");
    } finally {
      clearInterval(heartbeat);
    }
    console.log(`[area-expand] LLM 返回成功, 长度: ${response.content.length}, 耗时: ${Date.now() - t0}ms`);

    // 使用带修复能力的 JSON 提取
    const { parsed, error } = extractJSON(response.content, "area-expand");
    if (!parsed) {
      return { result: null, error: error || "LLM 返回内容格式异常" };
    }

    return { result: parsed as any, error: null };
  } catch (error) {
    const msg = error instanceof Error ? error.message : "未知错误";
    console.error("[area-expand] LLM 生成新节点失败:", msg);
    return { result: null, error: `AI 生成节点失败: ${msg}` };
  }
}

// ============================================================
// 2. 区域扩展 — 主函数
// ============================================================

/**
 * 扩展区域，生成新的探索节点
 *
 * @param areaId 区域 ID
 * @param playerId 操作玩家 ID
 * @param scale 扩展比例（0.5 / 1.0 / 2.0）
 * @param hint 用户提供的扩展方向提示
 * @param onEvent SSE 事件回调
 */
export async function expandArea(
  areaId: string,
  playerId: string,
  scale: number,
  hint: string,
  onEvent: (event: ExpandSSEEvent) => void
): Promise<void> {
  // 加载区域数据
  onEvent({ type: "analyzing", message: "正在加载区域数据..." });
  const area = await loadAreaFull(areaId);
  if (!area) {
    onEvent({ type: "error", message: "区域不存在" });
    onEvent({ type: "done" });
    return;
  }

  // 分析边缘节点
  onEvent({ type: "analyzing", message: "正在分析区域拓扑结构，寻找边缘节点..." });
  const edgeNodes = findEdgeNodes(area);

  if (edgeNodes.length === 0) {
    onEvent({ type: "error", message: "未找到可扩展的边缘节点" });
    onEvent({ type: "done" });
    return;
  }

  // 计算新增节点数
  const minNodes = scale <= 0.5 ? 2 : scale <= 1.0 ? 3 : 5;
  const newNodeCount = Math.max(minNodes, Math.ceil(area.nodes.length * scale));

  onEvent({
    type: "planning",
    message: `规划生成 ${newNodeCount} 个新节点（当前 ${area.nodes.length} 个，扩展 ${Math.round(scale * 100)}%）`,
  });

  // LLM 生成新节点
  onEvent({ type: "generating", message: "AI 正在构思新区域内容（可能需要 60-120 秒）..." });
  const llmResponse = await llmExpandArea(area, edgeNodes, newNodeCount, hint, (msg) => {
    onEvent({ type: "generating", message: msg });
  });

  if (llmResponse.error) {
    onEvent({ type: "error", message: llmResponse.error });
  }

  const llmResult = llmResponse.result;
  if (!llmResult || !llmResult.nodes || llmResult.nodes.length === 0) {
    onEvent({ type: "error", message: "AI 生成新节点失败，请重试" });
    onEvent({ type: "done" });
    return;
  }

  // 使用事务写入数据库
  onEvent({ type: "generating", message: `正在写入 ${llmResult.nodes.length} 个新节点...` });

  try {
    const logicalIdToRealId: Record<string, string> = {};
    const createdNodes: Array<{ id: string; name: string; type: string; description: string }> = [];
    let newConnectionCount = 0;

    // 计算新节点的坐标（在现有节点之后排列）
    const maxPosY = Math.max(...area.nodes.map((n) => n.posY), 0);

    // 事务内完成所有数据库写入，SSE 推送在事务成功后进行（避免回滚后前端已收到虚假事件）
    await prisma.$transaction(async (tx) => {
      // 创建新节点
      for (let i = 0; i < llmResult.nodes.length; i++) {
        const n = llmResult.nodes[i];

        // 确保 shop 和 npc 类型有 npcs 数组
        let nodeData = n.data || {};
        if ((n.type === "shop" || n.type === "npc") && !nodeData.npcs) {
          if (nodeData.npc && typeof nodeData.npc === "object") {
            nodeData = { ...nodeData, npcs: [nodeData.npc] };
          } else {
            const defaultNpc = {
              id: `${n.id}_npc`,
              name: n.type === "shop" ? `${n.name}掌柜` : `${n.name}的居民`,
              role: n.type === "shop" ? "shopkeeper" : "villager",
              greeting: n.type === "shop" ? "欢迎光临，看看有什么需要的。" : "你好，旅行者。",
            };
            nodeData = { ...nodeData, npcs: [defaultNpc] };
          }
        }

        const node = await tx.areaNode.create({
          data: {
            areaId: area.id,
            name: n.name,
            type: n.type,
            description: n.description,
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            data: nodeData as any,
            posX: i % 4,
            posY: maxPosY + 1 + Math.floor(i / 4),
          },
        });

        logicalIdToRealId[n.id] = node.id;
        createdNodes.push({
          id: node.id,
          name: n.name,
          type: n.type,
          description: n.description,
        });
      }

      // 创建新节点到现有节点的连接
      for (const n of llmResult.nodes) {
        if (!n.connectTo) continue;
        const newId = logicalIdToRealId[n.id];
        const existingId = n.connectTo;

        // 验证目标节点确实存在
        const targetExists = area.nodes.some((node) => node.id === existingId);
        if (!newId || !targetExists) continue;

        // 双向连接
        await tx.areaNodeConnection.create({ data: { fromId: newId, toId: existingId } });
        await tx.areaNodeConnection
          .create({ data: { fromId: existingId, toId: newId } })
          .catch(() => {/* 忽略重复 */});
        newConnectionCount++;
      }

      // 创建新节点之间的内部连接
      const internalConns = llmResult.internalConnections || [];
      for (const [fromLogical, toLogical] of internalConns) {
        const fromId = logicalIdToRealId[fromLogical];
        const toId = logicalIdToRealId[toLogical];
        if (!fromId || !toId) continue;

        await tx.areaNodeConnection.create({ data: { fromId, toId } });
        await tx.areaNodeConnection
          .create({ data: { fromId: toId, toId: fromId } })
          .catch(() => {/* 忽略重复 */});
        newConnectionCount++;
      }
    });

    // 事务成功后，推送所有节点创建事件
    onEvent({ type: "connecting", message: "正在建立节点连接..." });
    for (const n of createdNodes) {
      onEvent({
        type: "node_created",
        data: { id: n.id, name: n.name, type: n.type, description: n.description },
      });
    }

    // 记录操作日志
    await logPlayerAction(
      playerId,
      "area_expand",
      `扩展区域「${area.name}」: 新增 ${createdNodes.length} 个节点, ${newConnectionCount} 条连接`,
      {
        areaId,
        scale,
        hint,
        newNodes: createdNodes.map((n) => ({ id: n.id, name: n.name, type: n.type })),
      }
    );

    // 发送总结
    onEvent({
      type: "summary",
      data: {
        newNodes: createdNodes.length,
        newConnections: newConnectionCount,
        details: createdNodes.map((n) => `${n.name}（${n.type}）: ${n.description}`),
      },
    });
  } catch (error) {
    console.error("[area-expand] 写入数据库失败:", error);
    onEvent({
      type: "error",
      message: `写入数据库失败: ${error instanceof Error ? error.message : "未知错误"}`,
    });
  }

  onEvent({ type: "done" });
}
