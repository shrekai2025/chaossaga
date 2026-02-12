/**
 * Check specific node data structure
 */

const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  // Find the "神秘茶铺" node
  const node = await prisma.areaNode.findFirst({
    where: {
      name: { contains: '神秘茶铺' }
    },
    select: {
      id: true,
      name: true,
      type: true,
      data: true,
      area: { select: { name: true } }
    }
  });

  if (!node) {
    console.log('❌ 未找到"神秘茶铺"节点');
    return;
  }

  console.log(`节点: ${node.name} (${node.type})`);
  console.log(`区域: ${node.area.name}`);
  console.log(`节点ID: ${node.id}\n`);

  const data = node.data;

  console.log('========== 节点数据结构 ==========');
  console.log(JSON.stringify(data, null, 2));

  console.log('\n========== NPCs 检查 ==========');
  if (data.npcs && Array.isArray(data.npcs)) {
    console.log(`✅ 有 npcs 数组，包含 ${data.npcs.length} 个 NPC:`);
    data.npcs.forEach((npc, i) => {
      console.log(`  [${i}] 名称: ${npc.name}, ID: ${npc.id}, 角色: ${npc.role}`);
    });
  } else if (data.npc) {
    console.log('⚠️ 使用旧格式 npc (单个对象):');
    console.log(`  名称: ${data.npc.name}, ID: ${data.npc.id}, 角色: ${data.npc.role}`);
  } else {
    console.log('❌ 没有 NPCs 配置！');
  }

  console.log('\n========== 商店物品检查 ==========');
  if (data.shopItems && Array.isArray(data.shopItems)) {
    console.log(`✅ 有 ${data.shopItems.length} 件商店物品:`);
    data.shopItems.forEach((item, i) => {
      console.log(`  [${i}] ${item.name} - ${item.price}金币 (${item.type})`);
    });
  } else {
    console.log('❌ 没有商店物品配置');
  }

  await prisma.$disconnect();
}

main().catch(console.error);
