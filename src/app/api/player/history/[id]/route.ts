/**
 * /api/player/history/[id] - 单条对话记录操作
 *
 * DELETE - 删除指定对话记录（从数据库中移除，避免影响后续上下文）
 */

import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    if (!id) {
      return NextResponse.json({ error: "缺少记录 ID" }, { status: 400 });
    }

    // 确认记录存在
    const record = await prisma.chatHistory.findUnique({ where: { id } });
    if (!record) {
      return NextResponse.json({ error: "记录不存在" }, { status: 404 });
    }

    // 删除
    await prisma.chatHistory.delete({ where: { id } });

    return NextResponse.json({ success: true, deletedId: id });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "删除失败" },
      { status: 500 }
    );
  }
}
