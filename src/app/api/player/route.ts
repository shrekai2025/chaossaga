/**
 * /api/player - 玩家 CRUD API
 *
 * GET  - 获取玩家完整状态
 * POST - 创建新角色（自动分配初始区域、使用公式计算属性）
 */

import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { calcBaseStats } from "@/lib/game/formulas";

/** 种子数据中的初始区域和起始节点 ID */
const SEED_STARTING_AREA = "seed-area-coral-bay";
const SEED_STARTING_NODE = "seed-node-town-center";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const playerId = searchParams.get("id");
  const playerName = searchParams.get("name");

  // 按 ID 查找（精确）
  if (playerId) {
    const player = await prisma.player.findUnique({
      where: { id: playerId },
      include: {
        skills: true,
        inventory: true,
        equipment: true,
        quests: { include: { quest: true } },
      },
    });

    if (!player) {
      return NextResponse.json({ error: "玩家不存在" }, { status: 404 });
    }

    // 解析可读位置名称
    let location = "未知区域";
    if (player.currentAreaId) {
      const area = await prisma.area.findUnique({
        where: { id: player.currentAreaId },
        select: { name: true },
      });
      if (area) {
        location = area.name;
        if (player.currentNodeId) {
          const node = await prisma.areaNode.findUnique({
            where: { id: player.currentNodeId },
            select: { name: true },
          });
          if (node) location = `${area.name} - ${node.name}`;
        }
      }
    }

    // 检查战斗状态
    const battle = await prisma.battleState.findUnique({
      where: { playerId: player.id },
      select: { status: true },
    });
    const isBattle = battle?.status === "active";

    console.log(`[API /player] ID=${player.id} Name=${player.name} isBattle=${isBattle} (Status=${battle?.status})`);

    return NextResponse.json({
      success: true,
      data: { ...player, location, isBattle },
    });
  }

  // 按名称查找（用于跨浏览器恢复角色）
  if (playerName) {
    const players = await prisma.player.findMany({
      where: { name: playerName },
      select: {
        id: true,
        name: true,
        race: true,
        level: true,
        realm: true,
        createdAt: true,
      },
      orderBy: { createdAt: "desc" },
      take: 5,
    });

    return NextResponse.json({ success: true, data: players });
  }

  return NextResponse.json({ error: "缺少 id 或 name 参数" }, { status: 400 });
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { name, race = "human", background = "" } = body;

    if (!name) {
      return NextResponse.json({ error: "名称为必填" }, { status: 400 });
    }

    // 使用 formulas.ts 计算 Lv.1 海洋级初始属性
    const baseStats = calcBaseStats(1, "ocean");

    // 查找初始区域是否存在（种子数据中的珊瑚海湾）
    const startingArea = await prisma.area.findUnique({
      where: { id: SEED_STARTING_AREA },
    });

    const player = await prisma.player.create({
      data: {
        name,
        race,
        background,
        level: 1,
        realm: "ocean",
        hp: baseStats.maxHp,
        maxHp: baseStats.maxHp,
        mp: baseStats.maxMp,
        maxMp: baseStats.maxMp,
        attack: baseStats.attack,
        defense: baseStats.defense,
        speed: baseStats.speed,
        gold: 100,
        exp: 0,
        // 如果种子区域存在，将玩家放置在初始区域的起始节点
        currentAreaId: startingArea ? SEED_STARTING_AREA : null,
        currentNodeId: startingArea ? SEED_STARTING_NODE : null,
      },
    });

    // 如果种子区域存在，创建玩家区域探索记录
    if (startingArea) {
      await prisma.playerArea.create({
        data: {
          playerId: player.id,
          areaId: SEED_STARTING_AREA,
          exploredNodes: JSON.stringify([SEED_STARTING_NODE]),
        },
      });
    }

    // 给初始技能
    await prisma.playerSkill.createMany({
      data: [
        {
          playerId: player.id,
          name: "水弹术",
          element: "water",
          damage: 15,
          mpCost: 5,
          cooldown: 0,
          equipped: true,
          slotIndex: 0,
        },
        {
          playerId: player.id,
          name: "治愈术",
          element: "water",
          damage: 0,
          mpCost: 10,
          cooldown: 2,
          effect: { type: "heal", value: 30 },
          equipped: true,
          slotIndex: 1,
        },
      ],
    });

    // 给初始物品
    await prisma.inventoryItem.createMany({
      data: [
        {
          playerId: player.id,
          name: "回复药水",
          type: "consumable",
          quality: "common",
          quantity: 3,
          stats: { hpRestore: 50 },
        },
        {
          playerId: player.id,
          name: "魔力药水",
          type: "consumable",
          quality: "common",
          quantity: 2,
          stats: { mpRestore: 30 },
        },
        {
          playerId: player.id,
          name: "新手木剑",
          type: "weapon",
          quality: "common",
          quantity: 1,
          stats: { attack: 3 },
          equipped: true,
        },
      ],
    });

    // 重新查询完整玩家数据（含刚创建的技能和物品）
    const fullPlayer = await prisma.player.findUnique({
      where: { id: player.id },
      include: {
        skills: true,
        inventory: true,
        equipment: true,
      },
    });

    // 附加可读位置名称
    const playerWithLocation = {
      ...fullPlayer,
      location: startingArea ? `珊瑚海湾 - 海边小镇广场` : undefined,
    };

    return NextResponse.json({ success: true, data: playerWithLocation }, { status: 201 });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "创建失败" },
      { status: 500 }
    );
  }
}
