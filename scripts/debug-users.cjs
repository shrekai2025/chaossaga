
require("dotenv").config();
const pg = require("pg");

async function main() {
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

  try {
    const players = await pool.query(`SELECT id, name, "createdAt" FROM "Player" ORDER BY "createdAt" DESC`);
    
    console.log(`Found ${players.rows.length} players.`);
    
    for (const p of players.rows) {
        const qCount = await pool.query(`SELECT COUNT(*) FROM "PlayerQuest" WHERE "playerId" = $1`, [p.id]);
        const cCount = await pool.query(`SELECT COUNT(*) FROM "ChatHistory" WHERE "playerId" = $1`, [p.id]);
        
        console.log(`Player: ${p.name} (ID: ${p.id})`);
        console.log(`  Created: ${p.createdAt}`);
        console.log(`  Quests: ${qCount.rows[0].count}`);
        console.log(`  Chats: ${cCount.rows[0].count}`);
        
        if (parseInt(qCount.rows[0].count) > 0 || parseInt(cCount.rows[0].count) > 0) {
            console.log("  >>> checking details <<<");
            const quests = await pool.query(`
                SELECT pq.status, q.name 
                FROM "PlayerQuest" pq 
                JOIN "Quest" q ON pq."questId" = q.id 
                WHERE pq."playerId" = $1
            `, [p.id]);
            quests.rows.forEach(q => {
                console.log(`    Quest: ${q.name} - Status: ${q.status}`);
            });
        }
        console.log("---");
    }

  } catch (err) {
    console.error("Error:", err);
  } finally {
    await pool.end();
  }
}

main();
