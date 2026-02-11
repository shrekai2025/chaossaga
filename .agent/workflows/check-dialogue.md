---
description: 检查游戏对话历史，诊断对话记录问题
---

# 检查对话历史

开发调试时检查玩家对话质量。脚本负责导出原始数据，AI 负责开放性分析。

## 步骤

// turbo

1. 运行对话导出脚本，获取 TestBot 的对话记录和玩家状态：

```bash
cd /Users/uniteyoo/Documents/chaossaga && node scripts/check-history.cjs
```

如果需要完整内容（默认截断 300 字）：`node scripts/check-history.cjs --full`

2. 仔细阅读脚本输出的**玩家状态**和**全部对话记录**，以开放性的视角分析，自主发现任何可能的问题。不要局限于已知问题类型。

3. 将发现的问题报告给用户，包括：
   - 问题描述（是什么）
   - 具体证据（引用哪条消息的哪段内容）
   - 可能的原因（推测为什么）
   - 相关文件（去哪里修）

## 备选方案：通过浏览器 API

如果脚本数据库连接失败，通过运行中的 Next.js 应用查询：

1. 在浏览器中打开 http://localhost:3000/game
2. 在浏览器控制台执行：

```javascript
(async () => {
  const pid = localStorage.getItem("chaossaga_player_id");
  const r = await fetch(`/api/player/history?playerId=${pid}&pageSize=100`);
  const d = await r.json();
  d.data.messages.forEach((m, i) => {
    console.log(`[${i}] ${m.role} | ${m.content.length}字 | ${m.createdAt}`);
    console.log(m.content);
    console.log("---");
  });
})();
```

## 关键文件速查

| 文件                                  | 职责                                   |
| ------------------------------------- | -------------------------------------- |
| `src/hooks/useGameChat.ts`            | 前端对话状态管理、SSE 流、ID 同步      |
| `src/lib/ai/gamemaster.ts`            | 核心处理：保存对话、调用 LLM、SSE 输出 |
| `src/lib/ai/context-builder.ts`       | 构建 AI 上下文（历史 + 状态 + 区域）   |
| `src/lib/ai/system-prompt.ts`         | System Prompt                          |
| `src/lib/ai/tools/`                   | 游戏工具定义和执行                     |
| `src/lib/ai/llm-client.ts`            | LLM 客户端                             |
| `src/lib/ai/adapters/`                | LLM 适配器                             |
| `src/app/api/player/history/route.ts` | 历史 API                               |
| `src/app/api/game/chat/route.ts`      | SSE 端点                               |
| `prisma/schema.prisma`                | ChatHistory 模型                       |

## 数据流

```
用户输入 → useGameChat.sendMessage()
  → POST /api/game/chat { playerId, message }
    → gamemaster.processGameMessage()
      → context-builder.buildGameContext() 加载历史+状态
      → messages = [...history, { role: "user", content }]
      → saveChatHistory("user", message)
      → LLM 调用（带工具）→ 流式文本
      → saveChatHistory("assistant", fullText)
    ← SSE 流: text/tool_call/tool_result/actions/done
  ← 前端渲染 + 同步 DB ID
```
