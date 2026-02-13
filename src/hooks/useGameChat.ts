"use client";

/**
 * 游戏聊天 Hook
 *
 * 管理与 AI Game Master 的对话状态：
 * - 消息列表（最新 N 条 + 向上滚动加载更早的）
 * - SSE 流式接收
 * - 玩家状态更新
 * - 快捷操作按钮
 */

import { useState, useCallback, useRef } from "react";

/** 消息类型 */
export interface GameMessage {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  timestamp: number;
  isStreaming?: boolean;
  loadingStage?: "preparing" | "thinking";
  toolCalls?: Array<{ tool: string; success?: boolean; data?: any }>;
  actions?: Array<{ label: string; value: string }>;
}

/** 玩家状态 */
export interface PlayerState {
  id: string;
  name: string;
  race: string;
  level: number;
  realm: string;
  hp: number;
  maxHp: number;
  mp: number;
  maxMp: number;
  attack: number;
  defense: number;
  speed: number;
  gold: number;
  spiritStones: number;
  exp: number;
  currentAreaId?: string;
  currentNodeId?: string;
  location?: string;
  isBattle?: boolean;
}

export interface QuickBattleAction {
  type: "attack" | "skill";
  skillId?: string;
  targetIndex?: number;
}

export function useGameChat() {
  const [messages, setMessages] = useState<GameMessage[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [playerState, setPlayerState] = useState<PlayerState | null>(null);
  /** 是否还有更早的历史可加载 */
  const [hasMoreHistory, setHasMoreHistory] = useState(false);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  /** 生成唯一ID */
  const genId = () => `msg_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

  /** 加载玩家状态 */
  const loadPlayer = useCallback(async (playerId: string) => {
    try {
      const res = await fetch(`/api/player?id=${playerId}`, { cache: "no-store" });
      const data = await res.json();
      if (data.success) {
        setPlayerState(data.data);
      }
      return data.data;
    } catch {
      return null;
    }
  }, []);

  /** 加载历史对话（最新 50 条，使用 before 模式） */
  const loadHistory = useCallback(async (playerId: string) => {
    console.log("[useGameChat] loadHistory called for:", playerId);
    try {
      const res = await fetch(`/api/player/history?playerId=${playerId}&pageSize=50`);
      const data = await res.json();
      if (data.success && data.data.messages.length > 0) {
        console.log("[useGameChat] loadHistory success, count:", data.data.messages.length);
        const historyMsgs: GameMessage[] = data.data.messages.map(
          (m: { id: string; role: string; content: string; createdAt: string }) => ({
            id: m.id,
            role: m.role as GameMessage["role"],
            content: m.content,
            timestamp: new Date(m.createdAt).getTime(),
          })
        );
        setMessages(historyMsgs);
        setHasMoreHistory(data.data.pagination.hasMore ?? false);
      }
    } catch {
      // 静默失败
    }
  }, []);

  /** 向上加载更早的历史（在列表顶部插入） */
  const loadMoreHistory = useCallback(async (playerId: string) => {
    if (loadingHistory || !hasMoreHistory) return;
    setLoadingHistory(true);
    try {
      // 取当前消息列表中最早的一条的 ID 作为 cursor
      const oldestMsg = messages.find((m) => !m.id.startsWith("msg_"));
      if (!oldestMsg) {
        setHasMoreHistory(false);
        return;
      }
      const res = await fetch(
        `/api/player/history?playerId=${playerId}&pageSize=30&before=${oldestMsg.id}`
      );
      const data = await res.json();
      if (data.success && data.data.messages.length > 0) {
        const olderMsgs: GameMessage[] = data.data.messages.map(
          (m: { id: string; role: string; content: string; createdAt: string }) => ({
            id: m.id,
            role: m.role as GameMessage["role"],
            content: m.content,
            timestamp: new Date(m.createdAt).getTime(),
          })
        );
        setMessages((prev) => [...olderMsgs, ...prev]);
        setHasMoreHistory(data.data.messages.length === 30);
      } else {
        setHasMoreHistory(false);
      }
    } catch {
      // 静默失败
    } finally {
      setLoadingHistory(false);
    }
  }, [messages, loadingHistory, hasMoreHistory]);

  /** 处理 SSE 事件 */
  const handleSSEEvent = useCallback(
    (
      aiMsgId: string,
      event: {
        type: string;
        data: Record<string, unknown>;
      }
    ) => {
      switch (event.type) {
        case "preparing":
          setMessages((prev) =>
            prev.map((m) =>
              m.id === aiMsgId
                ? { ...m, loadingStage: "preparing" }
                : m
            )
          );
          break;

        case "thinking":
          setMessages((prev) =>
            prev.map((m) =>
              m.id === aiMsgId
                ? { ...m, loadingStage: "thinking" }
                : m
            )
          );
          break;

        case "text":
          setMessages((prev) =>
            prev.map((m) =>
              m.id === aiMsgId
                ? { ...m, content: m.content + (event.data.content as string) }
                : m
            )
          );
          break;

        case "tool_call":
          setMessages((prev) =>
            prev.map((m) =>
              m.id === aiMsgId
                ? {
                    ...m,
                    toolCalls: [
                      ...(m.toolCalls || []),
                      { tool: event.data.tool as string },
                    ],
                  }
                : m
            )
          );
          break;

        case "tool_result":
          setMessages((prev) =>
            prev.map((m) => {
              if (m.id !== aiMsgId) return m;
              const calls = [...(m.toolCalls || [])];
              let last = calls.findLast(
                (c) => c.tool === (event.data.tool as string)
              );
              
              // 如果没找到对应的 tool_call（可能事件丢失），则补全一个
              if (!last) {
                last = { tool: event.data.tool as string };
                calls.push(last);
              }

              last.success = event.data.success as boolean;
              // 保存工具返回的数据（如果存在）
              if (event.data.result) {
                last.data = event.data.result;
              }
              
              return { ...m, toolCalls: calls };
            })
          );
          break;

        case "state_update":
          setPlayerState((prev) =>
            prev ? { ...prev, ...event.data } : prev
          );
          break;

        case "actions":
          setMessages((prev) =>
            prev.map((m) =>
              m.id === aiMsgId
                ? {
                    ...m,
                    actions: event.data.actions as Array<{
                      label: string;
                      value: string;
                    }>,
                  }
                : m
            )
          );
          break;

        case "error": {
          const errMsg = (event.data.message as string) || "发生未知错误";
          setMessages((prev) =>
            prev.map((m) =>
              m.id === aiMsgId
                ? {
                    ...m,
                    content: m.content
                      ? m.content + "\n\n⚠️ " + errMsg
                      : "⚠️ " + errMsg,
                  }
                : m
            )
          );
          break;
        }
      }
    },
    []
  );

  /** 发送消息并处理 SSE 流 */
  const sendMessage = useCallback(
    async (text: string) => {
      if (!playerState || isLoading) return;

      // 添加用户消息
      const userMsg: GameMessage = {
        id: genId(),
        role: "user",
        content: text,
        timestamp: Date.now(),
      };

      // 添加 AI 占位消息
      const aiMsgId = genId();
      const aiMsg: GameMessage = {
        id: aiMsgId,
        role: "assistant",
        content: "",
        timestamp: Date.now(),
        isStreaming: true,
        loadingStage: "preparing",
        toolCalls: [],
      };

      setMessages((prev) => [...prev, userMsg, aiMsg]);
      setIsLoading(true);

      // 发起 SSE 请求
      const controller = new AbortController();
      abortRef.current = controller;

      try {
        const res = await fetch("/api/game/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            playerId: playerState.id,
            message: text,
          }),
          signal: controller.signal,
        });

        if (!res.ok || !res.body) throw new Error("请求失败");

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";

        let streamDone = false;
        while (!streamDone) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n\n");
          buffer = lines.pop() || "";

          for (const line of lines) {
            if (!line.startsWith("data: ")) continue;
            try {
              const event = JSON.parse(line.slice(6));
              handleSSEEvent(aiMsgId, event);
              
              if (event.type === "done" || event.type === "error") {
                streamDone = true;
                break;
              }
            } catch {
              // 跳过解析失败的行
            }
          }
        }
      } catch (err) {
        if ((err as Error).name !== "AbortError") {
          setMessages((prev) =>
            prev.map((m) =>
              m.id === aiMsgId
                ? {
                    ...m,
                    content: m.content || "（连接中断，请重试）",
                    isStreaming: false,
                  }
                : m
            )
          );
        }
      } finally {
        // 结束流
        setMessages((prev) =>
          prev.map((m) =>
            m.id === aiMsgId ? { ...m, isStreaming: false } : m
          )
        );
        setIsLoading(false);
        abortRef.current = null;

        // 刷新玩家状态
        loadPlayer(playerState.id);

        // 同步前端临时 ID 为数据库真实 ID（确保删除和加载更多功能正常）
        try {
          const syncRes = await fetch(
            `/api/player/history?playerId=${playerState.id}&pageSize=2`
          );
          const syncData = await syncRes.json();
          if (syncData.success && syncData.data.messages.length >= 2) {
            const dbMsgs = syncData.data.messages;
            // 最后两条应该是本次的 user + assistant
            const dbUser = dbMsgs[dbMsgs.length - 2];
            const dbAssistant = dbMsgs[dbMsgs.length - 1];
            setMessages((prev) => {
              // 检查 ID 是否已存在于列表中（防止将当前消息 ID 更新为已存在的旧消息 ID）
              const existingIds = new Set(prev.map((m) => m.id));

              return prev.map((m) => {
                // 尝试同步用户消息 ID
                if (m.id === userMsg.id && dbUser?.role === "user") {
                  // 只有当 DB 中的 ID 不在当前列表中（除了它自己），或者它就是对应的旧消息（不太可能）时才更新
                  // 其实最重要的是：不要把 userMsg.id 更新成一个已存在的 ID
                  if (!existingIds.has(dbUser.id)) {
                    return { ...m, id: dbUser.id };
                  }
                }
                // 尝试同步 AI 消息 ID
                if (m.id === aiMsgId && dbAssistant?.role === "assistant") {
                  if (!existingIds.has(dbAssistant.id)) {
                    return { ...m, id: dbAssistant.id };
                  }
                }
                return m;
              });
            });
          }
        } catch {
          // 同步失败不影响主流程
        }
      } // End of finally
    },
    [playerState, isLoading, loadPlayer, handleSSEEvent]
  );

  /** 视觉区极速战斗动作（非流式）：直算 + LLM 包装叙事 */
  const sendQuickBattleAction = useCallback(
    async (userText: string, action: QuickBattleAction) => {
      if (!playerState || isLoading) return;

      const userMsg: GameMessage = {
        id: genId(),
        role: "user",
        content: userText,
        timestamp: Date.now(),
      };

      const aiMsgId = genId();
      const aiMsg: GameMessage = {
        id: aiMsgId,
        role: "assistant",
        content: "",
        timestamp: Date.now(),
        isStreaming: true,
        loadingStage: "thinking",
      };

      setMessages((prev) => [...prev, userMsg, aiMsg]);
      setIsLoading(true);

      try {
        const res = await fetch("/api/game/quick-action", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            playerId: playerState.id,
            userText,
            action,
          }),
        });
        const data = await res.json();

        const content =
          data.narrative ||
          (data.success
            ? "动作已执行。"
            : `⚠️ ${data.error || "动作执行失败"}`);

        // 构建 toolCalls 以便原始内容弹窗能显示 JSON
        const toolCalls: Array<{ tool: string; success?: boolean; data?: unknown }> = [];
        if (data.toolResult) {
          toolCalls.push({
            tool: "execute_battle_action",
            success: data.toolResult.success,
            data: data.toolResult.data,
          });
        }

        setMessages((prev) =>
          prev.map((m) =>
            m.id === aiMsgId
              ? { ...m, content, isStreaming: false, loadingStage: undefined, toolCalls }
              : m
          )
        );

        // 立即更新数值状态
        if (data.toolResult?.stateUpdate) {
          setPlayerState((prev) =>
            prev ? { ...prev, ...data.toolResult.stateUpdate } : prev
          );
        }

        // 立即更新战斗状态（不用等 loadPlayer）
        if (typeof data.isBattle === "boolean") {
          setPlayerState((prev) =>
            prev ? { ...prev, isBattle: data.isBattle } : prev
          );
        }
      } catch {
        setMessages((prev) =>
          prev.map((m) =>
            m.id === aiMsgId
              ? {
                  ...m,
                  content: "⚠️ 极速战斗执行失败，请稍后重试。",
                  isStreaming: false,
                  loadingStage: undefined,
                }
              : m
          )
        );
      } finally {
        setMessages((prev) =>
          prev.map((m) =>
            m.id === aiMsgId ? { ...m, isStreaming: false } : m
          )
        );
        setIsLoading(false);
        await loadPlayer(playerState.id);
      }
    },
    [playerState, isLoading, loadPlayer]
  );
  /** 触发 AI 响应（不发送用户消息，仅触发 AI 根据当前上下文生成） */
  const triggerResponse = useCallback(async (systemContent?: string) => {
    if (!playerState || isLoading) return;

    // 添加 AI 占位消息
    const aiMsgId = genId();
    const aiMsg: GameMessage = {
      id: aiMsgId,
      role: "assistant", 
      content: "",
      timestamp: Date.now(),
      isStreaming: true,
      loadingStage: "preparing",
      toolCalls: [],
    };

    // 一次性添加消息（系统消息 + AI占位）
    setMessages((prev) => {
      const newMsgs = [...prev];
      
      if (systemContent) {
        newMsgs.push({
          id: genId(),
          role: "system",
          content: systemContent,
          timestamp: Date.now(),
        });
      }

      newMsgs.push(aiMsg);
      return newMsgs;
    });

    setIsLoading(true);

    // 发起 SSE 请求
    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const res = await fetch("/api/game/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          playerId: playerState.id,
          // message: undefined // 不传 message，触发系统行为
        }),
        signal: controller.signal,
      });

      if (!res.ok || !res.body) throw new Error("请求失败");

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      let streamDone = false;
      while (!streamDone) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          try {
            const event = JSON.parse(line.slice(6));
            handleSSEEvent(aiMsgId, event);
            
            if (event.type === "done" || event.type === "error") {
              streamDone = true;
              break;
            }
          } catch {
            // 跳过解析失败的行
          }
        }
      }
    } catch (err) {
      if ((err as Error).name !== "AbortError") {
        setMessages((prev) =>
          prev.map((m) =>
            m.id === aiMsgId
              ? {
                  ...m,
                  content: m.content || "（连接中断，请重试）",
                  isStreaming: false,
                }
              : m
          )
        );
      }
    } finally {
      // 结束流
      setMessages((prev) =>
        prev.map((m) =>
          m.id === aiMsgId ? { ...m, isStreaming: false } : m
        )
      );
      setIsLoading(false);
      abortRef.current = null;

      // 刷新玩家状态
      loadPlayer(playerState.id);
    }
  }, [playerState, isLoading, loadPlayer, handleSSEEvent]);



  /** 删除单条消息（从前端列表和数据库中同时移除） */
  const deleteMessage = useCallback(
    async (messageId: string) => {
      // 先从前端列表移除（即时反馈）
      setMessages((prev) => prev.filter((m) => m.id !== messageId));

      // 再从数据库删除（messageId 可能是 cuid 格式的数据库 ID）
      try {
        await fetch(`/api/player/history/${messageId}`, {
          method: "DELETE",
        });
      } catch {
        // 如果是前端临时生成的 ID（msg_ 开头），数据库里没有，静默忽略
      }
    },
    []
  );

  /** 清除所有聊天历史（重新开始冒险） */
  const clearAllMessages = useCallback(
    async (playerId: string) => {
      // 先清空前端消息列表
      setMessages([]);
      setHasMoreHistory(false);

      // 再从数据库删除所有记录
      try {
        await fetch(`/api/player/history?playerId=${playerId}`, {
          method: "DELETE",
        });
      } catch (err) {
        console.error("清除聊天历史失败:", err);
      }
    },
    []
  );

  /** 中止当前请求 */
  const abort = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  return {
    messages,
    isLoading,
    playerState,
    setPlayerState,
    loadPlayer,
    loadHistory,
    loadMoreHistory,
    hasMoreHistory,
    loadingHistory,
    sendMessage,
    sendQuickBattleAction,
    deleteMessage,
    clearAllMessages,
    triggerResponse,
    abort,
  };
}
