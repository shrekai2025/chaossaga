import "dotenv/config";
import { prisma } from "../src/lib/db/prisma";

async function main() {
  const AREA_ID = "cmlgjrxld000icq32s6ztt2n7"; 
  const BBQ_ID = "cmlgjrzbh000kcq32am4dlof3";

  console.log(`Checking connections for BBQ Street (${BBQ_ID})...`);
  
  const connections = await prisma.areaNodeConnection.findMany({
    where: {
      OR: [{ fromId: BBQ_ID }, { toId: BBQ_ID }],
    },
    include: { fromNode: true, toNode: true }, // Correct relation names
  });

  console.log(`Found ${connections.length} connections:`);
  
  const connectedNodes: {id: string, name: string}[] = [];

  connections.forEach(c => {
    const other = c.fromId === BBQ_ID ? c.toNode : c.fromNode;
    console.log(`- Connected to: [${other.name}] (${other.id})`);
    connectedNodes.push({id: other.id, name: other.name});
  });
  
  // Check if Handicraft Stall is in the list
  const handicraft = connectedNodes.find(n => n.name === "手工艺品摊位");
  if (handicraft) {
      console.log("\n✅ BBQ Street IS connected to Handicraft Stall.");
  } else {
      console.log("\n❌ BBQ Street is NOT connected to Handicraft Stall.");
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
