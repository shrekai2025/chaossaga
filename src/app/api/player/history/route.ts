/**
 * /api/player/history - 对话历史 API
 *
 * GET - 获取玩家对话历史（分页）
 *
 * 默认加载最新的 N 条（before 模式），也支持传统分页（page 模式）。
 *
 * before 模式（默认）：
 *   ?playerId=xx&pageSize=50            → 最新50条
 *   ?playerId=xx&pageSize=50&before=id  → 早于 id 的50条（向上加载更多）
 *
 * page 模式：
 *   ?playerId=xx&page=1&pageSize=50     → 传统分页（正序，第1页 = 最早）
 */

import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const playerId = searchParams.get("playerId");
  const before = searchParams.get("before"); // cursor ID
  const page = searchParams.get("page");
  const pageSize = parseInt(searchParams.get("pageSize") || "50", 10);

  if (!playerId) {
    return NextResponse.json({ error: "缺少 playerId" }, { status: 400 });
  }

  // ============ before 模式（默认）：加载最新 N 条 ============
  if (!page) {
    const where: Record<string, unknown> = { playerId };

    // 如果传了 before cursor，获取该记录的时间作为游标
    if (before) {
      const cursor = await prisma.chatHistory.findUnique({
        where: { id: before },
        select: { createdAt: true },
      });
      if (cursor) {
        where.createdAt = { lt: cursor.createdAt };
      }
    }

    // 倒序取 pageSize 条，再反转为正序
    const records = await prisma.chatHistory.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: pageSize,
    });

    records.reverse();

    const total = await prisma.chatHistory.count({ where: { playerId } });
    const hasMore = before
      ? records.length === pageSize
      : total > records.length;

    return NextResponse.json({
      success: true,
      data: {
        messages: records,
        pagination: { total, hasMore },
      },
    });
  }

  // ============ page 模式（兼容旧调用） ============
  const pageNum = parseInt(page, 10);
  const skip = (pageNum - 1) * pageSize;

  const [records, total] = await Promise.all([
    prisma.chatHistory.findMany({
      where: { playerId },
      orderBy: { createdAt: "asc" },
      skip,
      take: pageSize,
    }),
    prisma.chatHistory.count({ where: { playerId } }),
  ]);

  return NextResponse.json({
    success: true,
    data: {
      messages: records,
      pagination: {
        page: pageNum,
        pageSize,
        total,
        totalPages: Math.ceil(total / pageSize),
      },
    },
  });
}

/**
 * DELETE - 清除玩家所有聊天历史（重新开始冒险）
 *
 *   ?playerId=xx → 删除该玩家全部对话记录
 */
export async function DELETE(req: Request) {
  const { searchParams } = new URL(req.url);
  const playerId = searchParams.get("playerId");

  if (!playerId) {
    return NextResponse.json({ error: "缺少 playerId" }, { status: 400 });
  }

  try {
    const result = await prisma.chatHistory.deleteMany({
      where: { playerId },
    });

    return NextResponse.json({
      success: true,
      data: { deleted: result.count },
    });
  } catch (error) {
    console.error("清除聊天历史失败:", error);
    return NextResponse.json(
      { error: "清除聊天历史失败" },
      { status: 500 }
    );
  }
}
