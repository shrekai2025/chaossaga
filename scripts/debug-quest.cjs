
require("dotenv").config();
const pg = require("pg");

async function main() {
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

  try {
    // 1. Get Player
    const playerResult = await pool.query(`SELECT id, name FROM "Player" LIMIT 1`);
    if (playerResult.rows.length === 0) {
      console.log("No player found");
      return;
    }
    const player = playerResult.rows[0];
    console.log(`Player: ${player.name} (${player.id})`);

    // 2. Get Quests
    const questsResult = await pool.query(`
      SELECT pq.status, pq.progress, q.name, q.id as "questId"
      FROM "PlayerQuest" pq
      JOIN "Quest" q ON pq."questId" = q.id
      WHERE pq."playerId" = $1
    `, [player.id]);

    console.log("\n=== Player Quests ===");
    questsResult.rows.forEach(q => {
      console.log(`Quest: ${q.name} (${q.questId})`);
      console.log(`Status: ${q.status}`);
      console.log(`Progress:`, JSON.stringify(q.progress));
      console.log("---");
    });

    // 3. Get Recent Chat History with Metadata (to check for tool calls)
    const historyResult = await pool.query(`
      SELECT role, content, metadata, "createdAt"
      FROM "ChatHistory"
      WHERE "playerId" = $1
      ORDER BY "createdAt" DESC
      LIMIT 10
    `, [player.id]);

    console.log("\n=== Recent Chat Logs (checking for tool calls) ===");
    historyResult.rows.forEach(h => {
      let hasToolCall = false;
      if (h.metadata) {
         // Check diverse formats of tool calls in metadata
         if (h.metadata.toolCalls || h.metadata.tool_calls) {
             hasToolCall = true;
         }
      }
      
      console.log(`[${h.role}] ${h.createdAt.toISOString()}`);
      console.log(`Content Preview: ${h.content.substring(0, 50)}...`);
      if (h.metadata) {
        console.log(`Metadata: ${JSON.stringify(h.metadata)}`);
      }
      console.log("---");
    });

  } catch (err) {
    console.error("Error:", err);
  } finally {
    await pool.end();
  }
}

main();
