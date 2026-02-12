/**
 * Check NPCs in player's current location
 */

const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const playerId = process.argv[2] || 'cmlfd0a5p0006g832k3bdkqa3';

  const player = await prisma.player.findUnique({
    where: { id: playerId },
    select: {
      name: true,
      currentNodeId: true,
      currentAreaId: true
    }
  });

  if (!player) {
    console.log('玩家不存在');
    return;
  }

  console.log(`玩家: ${player.name}`);
  console.log(`当前区域ID: ${player.currentAreaId}`);
  console.log(`当前节点ID: ${player.currentNodeId}\n`);

  if (!player.currentNodeId) {
    console.log('玩家不在任何节点');
    return;
  }

  const node = await prisma.areaNode.findUnique({
    where: { id: player.currentNodeId },
    select: {
      name: true,
      type: true,
      description: true,
      data: true
    }
  });

  if (!node) {
    console.log('节点不存在');
    return;
  }

  console.log(`节点名称: ${node.name}`);
  console.log(`节点类型: ${node.type}`);
  console.log(`描述: ${node.description}\n`);

  const nodeData = node.data;

  // Check NPCs
  if (nodeData.npcs && Array.isArray(nodeData.npcs)) {
    console.log(`========== NPCs (${nodeData.npcs.length}个) ==========`);
    nodeData.npcs.forEach((npc, i) => {
      console.log(`\n[${i}] ${npc.name}`);
      console.log(`  ID: ${npc.id}`);
      console.log(`  角色: ${npc.role}`);
      console.log(`  性格: ${npc.personality || '无'}`);
      console.log(`  问候语: ${npc.greeting || '无'}`);
      if (npc.questId) {
        console.log(`  任务ID: ${npc.questId}`);
      }
    });
  } else {
    console.log('========== NPCs ==========');
    console.log('❌ 此节点没有 NPCs');
  }

  // Check shop items
  if (nodeData.shopItems && Array.isArray(nodeData.shopItems)) {
    console.log(`\n========== 商店物品 (${nodeData.shopItems.length}件) ==========`);
    nodeData.shopItems.forEach((item, i) => {
      console.log(`[${i}] ${item.name} - ${item.price}金币 (${item.type})`);
    });
  }

  // Check enemy templates
  if (nodeData.enemyTemplates && Array.isArray(nodeData.enemyTemplates)) {
    console.log(`\n========== 敌人模板 (${nodeData.enemyTemplates.length}个) ==========`);
    nodeData.enemyTemplates.forEach((enemy, i) => {
      console.log(`[${i}] ${enemy.name} Lv.${enemy.level}`);
    });
  }

  await prisma.$disconnect();
}

main().catch(console.error);
