
import { prisma } from "./src/lib/db/prisma";

async function main() {
  console.log("Searching for NPC with ID or Name containing 'village' or 'chief'...");

  // 1. Find the quest first to get npcId
  const quest = await prisma.quest.findFirst({
    where: { name: { contains: "蓝泪珍珠" } } // The quest from screenshot
  });

  if (quest) {
    console.log("Found Quest:", quest.name, "NPC ID:", quest.npcId);

    if (quest.npcId) {
      // 2. Try to find the node containing this NPC
      // Note: Prisma JSON filter syntax depends on DB, assuming Postgres here
      const node = await prisma.areaNode.findFirst({
        where: {
          data: {
            path: ['npc', 'id'],
            equals: quest.npcId
          }
        },
        include: { area: true }
      });

      if (node) {
        console.log(`Found NPC in Area: ${node.area.name}, Node: ${node.name}`);
      } else {
        console.log("NPC ID found in quest, but no AreaNode found with this NPC ID.");
        // Try searching by name in all nodes if ID search fails (maybe ID mismatch?)
         const allNodes = await prisma.areaNode.findMany();
         const found = allNodes.find(n => {
             const d = n.data as any;
             return d?.npc?.id === quest.npcId;
         });
         if (found) {
             console.log("Found via manual scan:", found.name);
         }
      }
    }
  } else {
    console.log("Quest not found.");
  }
}

main()
  .catch(e => console.error(e))
  .finally(async () => await prisma.$disconnect());
