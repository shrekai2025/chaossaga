import { PrismaClient } from "@/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import pg from "pg";

async function main() {
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  const adapter = new PrismaPg(pool);
  const prisma = new (PrismaClient as any)({ adapter }) as InstanceType<typeof PrismaClient>;
  
  const player = await prisma.player.findFirst({ where: { name: "TestBot" } });
  if (!player) {
    console.log("No TestBot found");
    await prisma.$disconnect();
    return;
  }
  
  console.log("Player:", player.name, "ID:", player.id);
  console.log("---");
  
  const history = await prisma.chatHistory.findMany({
    where: { playerId: player.id },
    orderBy: { createdAt: "desc" },
    take: 8,
    select: { role: true, content: true, metadata: true, createdAt: true },
  });
  
  for (const h of history.reverse()) {
    console.log("=== " + h.role + " === " + h.createdAt.toISOString());
    const c = (h.content || "").substring(0, 800);
    console.log(c);
    if (h.metadata) {
      console.log("META:", JSON.stringify(h.metadata).substring(0, 600));
    }
    console.log("");
  }
  
  await pool.end();
}

main().catch(console.error);
