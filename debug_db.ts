import "dotenv/config";
import { PrismaClient } from "./src/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import pg from "pg";

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new (PrismaClient as any)({ adapter }) as InstanceType<typeof PrismaClient>;

async function main() {
  const history = await prisma.chatHistory.findMany({
    take: 5,
    orderBy: { createdAt: "desc" },
    select: { id: true, role: true, content: true, createdAt: true },
  });

  console.log("Recent chat history:");
  history.forEach((msg) => {
    console.log(`[${msg.createdAt.toISOString()}] Role: ${msg.role}, Content: ${msg.content.slice(0, 50)}...`);
  });
}

main()
  .catch((e) => console.error(e))
  .finally(async () => {
    await prisma.$disconnect();
  });
