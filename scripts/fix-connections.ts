import "dotenv/config";
import { prisma } from "../src/lib/db/prisma";

async function main() {
  const BBQ_ID = "cmlgjrzbh000kcq32am4dlof3";
  const HANDICRAFT_ID = "cmlgjrzky000lcq32vru1bc4p"; // From Step 473 output

  console.log(`Adding connection: BBQ (${BBQ_ID}) <-> Handicraft (${HANDICRAFT_ID})...`);

  // Check if connection exists
  const existing = await prisma.areaNodeConnection.findFirst({
    where: {
      OR: [
        { fromId: BBQ_ID, toId: HANDICRAFT_ID },
        { fromId: HANDICRAFT_ID, toId: BBQ_ID },
      ],
    },
  });

  if (existing) {
    console.log("Connection already exists!");
    return;
  }

  // Create bidirectional connection (stored as two rows or one? 
  // Schema says @@unique([fromId, toId]). Usually graph connections are one way or represented twice.
  // ChaosSaga logic in moveToNode uses: OR: [{fromId: current}, {toId: current}].
  // So one row is enough for bidirectional logic in app, but let's see how others are stored.
  // Debug output showed 4 connections for BBQ: 
  // - Night Market (x2) ? No, "Found 4 connections".
  // - Connected to [Night Market] (id)...
  // - Connected to [Night Market] (id)... 
  // It seems they are duplicated or stored as two rows?
  // Let's create one row first.

  await prisma.areaNodeConnection.create({
    data: {
      fromId: BBQ_ID,
      toId: HANDICRAFT_ID,
    },
  });

  console.log("Connection created successfully.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
