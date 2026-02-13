import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";

const MAX_EQUIPPED_SKILLS = 4;

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const playerId = body.playerId as string | undefined;
    const skillId = body.skillId as string | undefined;
    const enabled = body.enabled as boolean | undefined;
    const slotIndex = body.slotIndex as number | undefined;

    if (!playerId || !skillId || typeof enabled !== "boolean") {
      return NextResponse.json(
        { success: false, error: "缺少必填参数：playerId, skillId, enabled" },
        { status: 400 }
      );
    }

    const skill = await prisma.playerSkill.findFirst({
      where: { id: skillId, playerId },
      select: { id: true, equipped: true, slotIndex: true },
    });

    if (!skill) {
      return NextResponse.json(
        { success: false, error: "技能不存在" },
        { status: 404 }
      );
    }

    if (!enabled) {
      await prisma.playerSkill.update({
        where: { id: skill.id },
        data: { equipped: false, slotIndex: null },
      });
      return NextResponse.json({
        success: true,
        data: { skillId: skill.id, equipped: false, slotIndex: null },
      });
    }

    if (skill.equipped) {
      return NextResponse.json({
        success: true,
        data: { skillId: skill.id, equipped: true, slotIndex: skill.slotIndex },
      });
    }

    const equippedSkills = await prisma.playerSkill.findMany({
      where: { playerId, equipped: true },
      select: { id: true, slotIndex: true },
      orderBy: { slotIndex: "asc" },
    });

    if (equippedSkills.length >= MAX_EQUIPPED_SKILLS) {
      return NextResponse.json(
        { success: false, error: "已装备技能达到上限，请先停用一个技能" },
        { status: 400 }
      );
    }

    const usedSlots = new Set(
      equippedSkills
        .map((s) => s.slotIndex)
        .filter((idx): idx is number => typeof idx === "number")
    );

    let targetSlot: number | null = null;
    if (
      typeof slotIndex === "number" &&
      Number.isInteger(slotIndex) &&
      slotIndex >= 0 &&
      slotIndex < MAX_EQUIPPED_SKILLS
    ) {
      if (usedSlots.has(slotIndex)) {
        return NextResponse.json(
          { success: false, error: "指定槽位已被占用" },
          { status: 400 }
        );
      }
      targetSlot = slotIndex;
    } else {
      for (let i = 0; i < MAX_EQUIPPED_SKILLS; i++) {
        if (!usedSlots.has(i)) {
          targetSlot = i;
          break;
        }
      }
    }

    if (targetSlot === null) {
      return NextResponse.json(
        { success: false, error: "无可用技能槽位，请先停用一个技能" },
        { status: 400 }
      );
    }

    await prisma.playerSkill.update({
      where: { id: skill.id },
      data: { equipped: true, slotIndex: targetSlot },
    });

    return NextResponse.json({
      success: true,
      data: { skillId: skill.id, equipped: true, slotIndex: targetSlot },
    });
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "技能状态切换失败",
      },
      { status: 500 }
    );
  }
}

