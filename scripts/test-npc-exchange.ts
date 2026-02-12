
console.log("DATABASE_URL:", process.env.DATABASE_URL);
import { prisma } from "../src/lib/db/prisma";
import { interactNpc } from "../src/lib/ai/tools/action-tools";

// Mock environment for resolving aliases if needed (tsx handles this usually)

async function main() {
  console.log("Starting Barter Test...");

  // 1. Find a node with an NPC
  // Using raw query or finding all because JSON filter syntax varies
  const allNodes = await prisma.areaNode.findMany({ select: { id: true, data: true, areaId: true } });
  const nodeWithNpc = allNodes.find(n => (n.data as any)?.npc?.id || (n.data as any)?.npc?.name);

  if (!nodeWithNpc) {
    console.error("No NPC found in any node. Cannot test.");
    return;
  }
  
  const npcData = (nodeWithNpc.data as any).npc;
  // Use defined ID or fallback to node ID (as per resolveNpc logic)
  const npcId = npcData.id || nodeWithNpc.id; 
  const area = await prisma.area.findUnique({ where: { id: nodeWithNpc.areaId } });
  
  console.log(`Found NPC: ${npcData.name} (ID: ${npcId}) in Area: ${area?.name}`);

  // 2. Setup Player
  let player = await prisma.player.findFirst({ where: { name: "TestBarterBot" } });
  if (!player) {
    player = await prisma.player.create({
      data: {
        name: "TestBarterBot",
        // userId: "test-user-id", // Removed: not in schema
        hp: 100, maxHp: 100,
        mp: 50, maxMp: 50,
        attack: 10, defense: 5, speed: 5,
        level: 1,
        currentAreaId: nodeWithNpc.areaId,
        currentNodeId: nodeWithNpc.id
      }
    });
    console.log("Created Test Player:", player.id);
  } else {
    player = await prisma.player.update({
      where: { id: player.id },
      data: {
        currentAreaId: nodeWithNpc.areaId,
        currentNodeId: nodeWithNpc.id
      }
    });
    console.log("Updated Test Player Position:", player.id);
  }

  // 3. Clear Inventory & Add Item
  await prisma.inventoryItem.deleteMany({ where: { playerId: player.id } });
  
  const giveItem = await prisma.inventoryItem.create({
    data: {
      playerId: player.id,
      name: "Broken Crab Shell",
      type: "material",
      quantity: 1
    }
  });
  console.log("Added Item:", giveItem.name);

  // 4. Perform Exchange
  console.log("Executing Exchange...");
  
  // Need to mock context that resolveNpc checks player position
  // We already updated player position above.
  
  const result = await interactNpc({
    npcId: npcId,
    action: "exchange",
    data: {
      give: [{ itemId: giveItem.id, quantity: 1 }],
      receive: [{
        name: "Dried Mushroom",
        type: "consumable",
        quality: "common",
        quantity: 3,
        specialEffect: "Delicious"
      }]
    }
  }, player.id);

  // 5. Verify Result
  console.log("Exchange Result:", JSON.stringify(result, null, 2));

  if (!result.success) {
    console.error("Exchange Failed!");
    // Clean up test player
    await prisma.player.delete({ where: { id: player.id } });
    return;
  }

  // Check Inventory
  const remainingGive = await prisma.inventoryItem.findUnique({ where: { id: giveItem.id } });
  const receivedItems = await prisma.inventoryItem.findFirst({ 
    where: { playerId: player.id, name: "Dried Mushroom" } 
  });

  console.log("Inventory Check:");
  if (!remainingGive || remainingGive.quantity === 0) {
    console.log("✅ Broken Crab Shell removed (or qty 0).");
  } else {
    console.log(`❌ Broken Crab Shell remains: ${remainingGive.quantity}`);
  }

  if (receivedItems && receivedItems.quantity === 3) {
    console.log("✅ Received 3 Dried Mushrooms.");
  } else {
    console.log(`❌ Dried Mushroom count incorrect: ${receivedItems?.quantity}`);
  }

  // Clean up
  await prisma.player.delete({ where: { id: player.id } });
  console.log("Cleaned up test player.");
}

main()
  .catch(e => console.error(e))
  .finally(async () => await prisma.$disconnect());
