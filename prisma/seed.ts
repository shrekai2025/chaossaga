/**
 * ChaosSaga - 种子数据
 *
 * 创建游戏初始数据：
 * - 新手区域「珊瑚海湾」及其 8 个节点
 * - 节点连接（地图拓扑）
 * - 初始任务「老渔夫的委托」
 *
 * 运行方式：npm run db:seed
 * 幂等设计：可重复运行，不会产生重复数据
 */

import "dotenv/config";
import { PrismaClient } from "../src/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import pg from "pg";

// ============================================================
// 初始化 Prisma 客户端
// ============================================================

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const prisma = new (PrismaClient as any)({ adapter }) as InstanceType<
  typeof PrismaClient
>;

// ============================================================
// 固定 ID（便于跨表引用和幂等操作）
// ============================================================

const IDS = {
  // 区域
  area: "seed-area-coral-bay",
  // 节点
  nodeTownCenter: "seed-node-town-center",
  nodeTavern: "seed-node-tavern",
  nodeShop: "seed-node-shop",
  nodeBeach: "seed-node-beach",
  nodeReef: "seed-node-reef",
  nodeShipwreck: "seed-node-shipwreck",
  nodeCave: "seed-node-cave-entrance",
  nodeBossLair: "seed-node-boss-lair",
  // 任务
  questFisherman: "seed-quest-fisherman",
} as const;

// ============================================================
// 区域：珊瑚海湾
// ============================================================

async function seedArea() {
  console.log("🌊 创建区域：珊瑚海湾...");

  await prisma.area.upsert({
    where: { id: IDS.area },
    update: {},
    create: {
      id: IDS.area,
      name: "珊瑚海湾",
      description:
        "一片宁静的海湾小镇，渔民们世代在此靠海为生。近来海中怪物日渐猖獗，" +
        "渔船频频失踪，村民人心惶惶。海湾深处隐约可见一座被珊瑚覆盖的沉船残骸，" +
        "传说那里藏着古老的秘密。老渔夫阿海正焦急地寻找能帮忙调查的冒险者……",
      theme: "ocean",
      recommendedLevel: 1,
    },
  });
}

// ============================================================
// 节点
// ============================================================

async function seedNodes() {
  console.log("📍 创建区域节点...");

  const nodes = [
    // 1. 海边小镇广场 - 安全区 / 出生点
    {
      id: IDS.nodeTownCenter,
      areaId: IDS.area,
      name: "海边小镇广场",
      type: "safe",
      description:
        "小镇的中心广场，咸湿的海风中混着鱼干和海藻的气味。" +
        "广场中央有一口老井，几个孩子在旁边追逐嬉戏。" +
        "告示栏上贴着几张悬赏单，看起来都和近来海上的异变有关。",
      posX: 2,
      posY: 2,
      data: {
        isStartingNode: true,
        ambiance: "peaceful",
        hints: ["告示栏上有悬赏信息", "远处海面上偶尔能看到奇异的光芒"],
      },
    },
    // 2. 浪花酒馆 - NPC（老渔夫阿海，任务发布者）
    {
      id: IDS.nodeTavern,
      areaId: IDS.area,
      name: "浪花酒馆",
      type: "npc",
      description:
        "一间由旧船板搭建的酒馆，墙上挂满了渔网和贝壳。" +
        "角落里坐着一位须发花白的老渔夫，正独自对着一杯浊酒发呆。" +
        "他的眼中满是忧虑——他就是阿海，镇上最有经验的渔夫。",
      posX: 1,
      posY: 1,
      data: {
        npc: {
          id: "npc-fisherman-ahai",
          name: "老渔夫阿海",
          role: "quest_giver",
          personality: "沧桑、正直、焦急",
          greeting:
            "唉，年轻人，你是外地来的冒险者吧？老头子我有件事想请你帮忙……",
          dialogTopics: ["失踪的渔船", "海中的异变", "深海蟹将的传说"],
          questId: IDS.questFisherman,
        },
      },
    },
    // 3. 神秘商人摊位 - 商店
    {
      id: IDS.nodeShop,
      areaId: IDS.area,
      name: "海边杂货摊",
      type: "shop",
      description:
        "码头旁支着一个简陋的布棚，一个蒙面商人正在整理货物。" +
        "他的摊位上摆着各种药水、武器和一些来历不明的奇特物品。" +
        "「嘿嘿，看看就看看，不买也没关系~」他露出一个意味深长的笑容。",
      posX: 3,
      posY: 1,
      data: {
        npc: {
          id: "npc-merchant",
          name: "神秘商人",
          role: "merchant",
          personality: "神秘、圆滑、见钱眼开",
          greeting: "嘿嘿，看看我的好货，保你满意~",
        },
        shopItems: [
          {
            name: "回复药水",
            type: "consumable",
            quality: "common",
            price: 30,
            stats: { hpRestore: 50 },
            description: "恢复50点HP",
          },
          {
            name: "魔力药水",
            type: "consumable",
            quality: "common",
            price: 40,
            stats: { mpRestore: 30 },
            description: "恢复30点MP",
          },
          {
            name: "解毒草",
            type: "consumable",
            quality: "common",
            price: 20,
            stats: { curePoison: true },
            description: "解除中毒状态",
          },
          {
            name: "铁剑",
            type: "weapon",
            quality: "common",
            price: 120,
            stats: { attack: 5 },
            description: "一把普通的铁剑，比木剑可靠多了",
          },
          {
            name: "皮甲",
            type: "armor",
            quality: "common",
            price: 100,
            stats: { defense: 3 },
            description: "简单的皮革护甲，聊胜于无",
          },
          {
            name: "珊瑚戒指",
            type: "accessory",
            quality: "uncommon",
            price: 200,
            stats: { maxMp: 10, attack: 1 },
            description: "用珊瑚打磨的戒指，蕴含微弱的海洋魔力",
          },
        ],
      },
    },
    // 4. 海边浅滩 - 战斗区（低等级）
    {
      id: IDS.nodeBeach,
      areaId: IDS.area,
      name: "海边浅滩",
      type: "battle",
      description:
        "潮水退去后露出的大片浅滩，到处是水洼和礁石。" +
        "一些蟹怪和水母在浅水中游荡，它们虽然不大，但数量不少。" +
        "对新手冒险者来说，这里是磨练技艺的好地方。",
      posX: 2,
      posY: 3,
      data: {
        enemyTemplates: [
          {
            name: "小蟹怪",
            level: 1,
            element: "water",
            minCount: 1,
            maxCount: 2,
            description: "巴掌大的螃蟹，钳子却异常锋利",
          },
          {
            name: "荧光水母",
            level: 1,
            element: "water",
            minCount: 1,
            maxCount: 3,
            description: "透明的水母，触须带有微弱的麻痹毒素",
          },
          {
            name: "海胆兵",
            level: 2,
            element: "water",
            minCount: 1,
            maxCount: 1,
            description: "一只异常大的海胆，浑身是刺",
          },
        ],
        encounterRate: 0.8,
        ambiance: "coastal",
      },
    },
    // 5. 珊瑚礁区 - 战斗区（中等）
    {
      id: IDS.nodeReef,
      areaId: IDS.area,
      name: "珊瑚礁区",
      type: "battle",
      description:
        "五彩斑斓的珊瑚丛中潜伏着危险。海水刚没过膝盖，" +
        "但水下的能见度很低。海蛇在珊瑚间穿梭，偶尔能听到" +
        "水下传来低沉的咕噜声。小心脚下——寄居蟹可不好惹。",
      posX: 3,
      posY: 3,
      data: {
        enemyTemplates: [
          {
            name: "珊瑚海蛇",
            level: 2,
            element: "water",
            minCount: 1,
            maxCount: 2,
            description: "藏身于珊瑚中的毒蛇，速度极快",
          },
          {
            name: "巨螯寄居蟹",
            level: 3,
            element: "earth",
            minCount: 1,
            maxCount: 1,
            description: "背着巨大贝壳的寄居蟹，防御力惊人",
          },
          {
            name: "毒刺海胆群",
            level: 2,
            element: "water",
            minCount: 2,
            maxCount: 3,
            description: "成群的毒海胆，踩上去可不妙",
          },
        ],
        encounterRate: 0.9,
        ambiance: "underwater",
      },
    },
    // 6. 沉船残骸 - 事件/探索区
    {
      id: IDS.nodeShipwreck,
      areaId: IDS.area,
      name: "沉船残骸",
      type: "event",
      description:
        "一艘半沉在水中的破旧渔船，船身上满是藤壶和海藻。" +
        "船舱里似乎还有东西——被海水泡烂的航海日志、锈迹斑斑的渔具，" +
        "以及……一些奇怪的爪痕。这些爪痕不像是普通螃蟹能留下的。",
      posX: 1,
      posY: 3,
      data: {
        events: [
          {
            id: "evt-shipwreck-diary",
            name: "航海日志",
            type: "discovery",
            description: "翻开日志，最后一页潦草写着：'它从深海来……蟹将……洞穴……'",
            reward: { exp: 10 },
            questProgress: { questId: IDS.questFisherman, objectiveIndex: 0 },
          },
          {
            id: "evt-shipwreck-chest",
            name: "船舱宝箱",
            type: "loot",
            description: "在船舱深处发现一个被珊瑚覆盖的小箱子",
            loot: [
              { name: "海之碎片", type: "material", quality: "uncommon", quantity: 1 },
              { name: "金币", type: "gold", quantity: 30 },
            ],
            oneTime: true,
          },
          {
            id: "evt-shipwreck-ambush",
            name: "伏击！",
            type: "battle",
            description: "搜索船舱时，几只蟹怪突然从暗处扑出！",
            enemies: [
              { name: "伏击蟹怪", level: 2, element: "water" },
              { name: "伏击蟹怪", level: 2, element: "water" },
            ],
            chance: 0.4,
          },
        ],
        questRelated: IDS.questFisherman,
        ambiance: "eerie",
      },
    },
    // 7. 海蚀洞穴入口 - 战斗区（较高）
    {
      id: IDS.nodeCave,
      areaId: IDS.area,
      name: "海蚀洞穴入口",
      type: "battle",
      description:
        "海浪经年累月冲刷出的巨大洞穴，入口处弥漫着腥臭的水汽。" +
        "洞壁上爬满了发光的苔藓，幽幽的蓝光照出了地面上密密麻麻的蟹爪印。" +
        "洞穴深处传来沉重的脚步声，越往里走，空气越是压抑。",
      posX: 2,
      posY: 4,
      data: {
        enemyTemplates: [
          {
            name: "洞穴蟹兵",
            level: 3,
            element: "water",
            minCount: 1,
            maxCount: 2,
            description: "蟹将麾下的精锐蟹兵，比普通蟹怪强壮得多",
          },
          {
            name: "暗影海蛇",
            level: 4,
            element: "dark",
            minCount: 1,
            maxCount: 1,
            description: "长期生活在黑暗中的海蛇，带有暗属性",
          },
        ],
        encounterRate: 1.0,
        warningLevel: "dangerous",
        ambiance: "dark_cave",
      },
    },
    // 8. 深海蟹将巢穴 - BOSS
    {
      id: IDS.nodeBossLair,
      areaId: IDS.area,
      name: "深海蟹将巢穴",
      type: "boss",
      description:
        "洞穴的最深处，一个巨大的地下湖泊。水面倒映着洞顶发光苔藓的幽蓝光芒。" +
        "湖中央的岩石平台上，一只体型巨大的螃蟹正沉睡着——" +
        "那就是传说中的深海蟹将，它的一只巨螯比一个成年人还要大。",
      posX: 2,
      posY: 5,
      data: {
        boss: {
          name: "深海蟹将",
          level: 5,
          element: "water",
          description:
            "珊瑚海湾海底洞穴的霸主，拥有坚硬如铁的蟹壳和可怕的巨螯。" +
            "据说它被某种力量驱使，才开始袭击渔船。",
          // 属性展平（与 buildEnemyStats 对齐）
          hp: 300,
          attack: 18,
          defense: 12,
          speed: 6,
          // 技能含 type 字段（与 EnemySkill 对齐）
          skills: [
            { name: "巨螯粉碎", damage: 25, element: "none", type: "attack", description: "用巨大的钳子猛击" },
            { name: "水流护盾", damage: 0, element: "water", type: "buff", healAmount: 0, description: "用水流包裹自身，提高防御" },
            { name: "泡沫风暴", damage: 15, element: "water", type: "aoe", description: "喷出大量泡沫，攻击全体" },
          ],
          // phases 与 BossPhase 接口对齐（hpThreshold 为 0-1 小数，unlockedSkills 为技能名列表）
          phases: [
            { hpThreshold: 0.5, unlockedSkills: ["泡沫风暴"], description: "蟹将狂暴化！它的双眼变得血红，攻击更加凶猛！" },
            { hpThreshold: 0.2, unlockedSkills: ["水流护盾"], description: "蟹将陷入绝望，开始疯狂释放水流护盾和泡沫风暴！" },
          ],
          drops: [
            { name: "蟹将硬壳", type: "armor", quality: "rare", stats: { defense: 8 }, chance: 1.0 },
            { name: "深海蟹螯", type: "weapon", quality: "rare", stats: { attack: 10 }, chance: 0.5 },
            { name: "海洋之心", type: "material", quality: "epic", chance: 0.15 },
          ],
        },
        questRelated: IDS.questFisherman,
        ambiance: "boss_arena",
      },
    },
  ];

  for (const node of nodes) {
    await prisma.areaNode.upsert({
      where: { id: node.id },
      update: {},
      create: node,
    });
  }
}

// ============================================================
// 节点连接（地图拓扑）
// ============================================================

async function seedConnections() {
  console.log("🔗 创建节点连接...");

  // 定义双向连接
  const connections: Array<[string, string]> = [
    // 广场 ↔ 酒馆、商店、浅滩
    [IDS.nodeTownCenter, IDS.nodeTavern],
    [IDS.nodeTownCenter, IDS.nodeShop],
    [IDS.nodeTownCenter, IDS.nodeBeach],
    // 浅滩 ↔ 珊瑚礁区、沉船残骸
    [IDS.nodeBeach, IDS.nodeReef],
    [IDS.nodeBeach, IDS.nodeShipwreck],
    // 珊瑚礁区 ↔ 海蚀洞穴
    [IDS.nodeReef, IDS.nodeCave],
    // 沉船残骸 ↔ 海蚀洞穴
    [IDS.nodeShipwreck, IDS.nodeCave],
    // 海蚀洞穴 ↔ BOSS 巢穴
    [IDS.nodeCave, IDS.nodeBossLair],
  ];

  for (const [fromId, toId] of connections) {
    // 正向连接
    const fwdId = `conn-${fromId.replace("seed-node-", "")}-${toId.replace("seed-node-", "")}`;
    await prisma.areaNodeConnection.upsert({
      where: { fromId_toId: { fromId, toId } },
      update: {},
      create: { id: fwdId, fromId, toId },
    });

    // 反向连接
    const revId = `conn-${toId.replace("seed-node-", "")}-${fromId.replace("seed-node-", "")}`;
    await prisma.areaNodeConnection.upsert({
      where: { fromId_toId: { fromId: toId, toId: fromId } },
      update: {},
      create: { id: revId, fromId: toId, toId: fromId },
    });
  }
}

// ============================================================
// 任务：老渔夫的委托
// ============================================================

async function seedQuests() {
  console.log("📜 创建初始任务...");

  await prisma.quest.upsert({
    where: { id: IDS.questFisherman },
    update: {},
    create: {
      id: IDS.questFisherman,
      name: "老渔夫的委托",
      description:
        "老渔夫阿海的儿子出海打鱼后一去不返，近日海边频繁出现怪物。" +
        "阿海怀疑是海蚀洞穴深处的「深海蟹将」在作祟。" +
        "请前往沉船残骸调查线索，然后深入洞穴击败深海蟹将！",
      type: "kill",
      npcId: "npc-fisherman-ahai",
      objectives: [
        {
          index: 0,
          description: "调查沉船残骸，寻找失踪渔船的线索",
          type: "explore",
          target: IDS.nodeShipwreck,
          current: 0,
          required: 1,
        },
        {
          index: 1,
          description: "击败深海蟹将",
          type: "kill",
          target: "深海蟹将",
          current: 0,
          required: 1,
        },
        {
          index: 2,
          description: "向老渔夫阿海复命",
          type: "talk",
          target: "npc-fisherman-ahai",
          current: 0,
          required: 1,
        },
      ],
      rewards: {
        exp: 200,
        gold: 150,
        items: [
          {
            name: "阿海的感谢信",
            type: "quest_item",
            quality: "uncommon",
            description: "老渔夫写给你的感谢信，或许对你今后的旅途有用",
          },
        ],
        unlocks: "解锁前往下一区域的航路",
      },
    },
  });
}

// ============================================================
// 主函数
// ============================================================

async function main() {
  console.log("🌱 开始播种 ChaosSaga 初始数据...\n");

  await seedArea();
  await seedNodes();
  await seedConnections();
  await seedQuests();

  console.log("\n✅ 种子数据创建完毕！");
  console.log("   - 区域: 珊瑚海湾（8 个节点）");
  console.log("   - 任务: 老渔夫的委托");
  console.log("   - 连接: 8 条双向连接（16 条单向）");
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error("❌ 播种失败:", e);
    await prisma.$disconnect();
    process.exit(1);
  });
