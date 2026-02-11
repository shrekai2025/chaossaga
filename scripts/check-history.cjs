/**
 * 对话历史导出脚本
 *
 * 干净地导出玩家对话记录，供 AI 工具或人工审查。
 * 不做自动化问题检测——让 LLM 自己判断。
 *
 * 用法: node scripts/check-history.cjs [选项]
 *
 *   --name NAME   玩家名称（默认 TestBot）
 *   --player ID   指定玩家 ID
 *   --limit N     显示最近 N 条（默认全部）
 *   --full        显示完整消息内容（默认截断 300 字）
 */
require("dotenv").config();
const pg = require("pg");

// 解析命令行参数
const args = process.argv.slice(2);
function getArg(name, defaultVal) {
  const idx = args.indexOf("--" + name);
  if (idx === -1) return defaultVal;
  return args[idx + 1] || defaultVal;
}
const hasFlag = (name) => args.includes("--" + name);

const LIMIT = getArg("limit", null);
const PLAYER_ID = getArg("player", null);
const PLAYER_NAME = getArg("name", "TestBot");
const FULL_CONTENT = hasFlag("full");

async function main() {
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

  try {
    // 查找目标玩家
    let playerQuery, playerParams;
    if (PLAYER_ID) {
      playerQuery = `SELECT id, name, level, realm, hp, "maxHp", mp, "maxMp", attack, defense, speed, gold, "spiritStones", exp, "currentAreaId", "currentNodeId" FROM "Player" WHERE id = $1`;
      playerParams = [PLAYER_ID];
    } else {
      playerQuery = `SELECT id, name, level, realm, hp, "maxHp", mp, "maxMp", attack, defense, speed, gold, "spiritStones", exp, "currentAreaId", "currentNodeId" FROM "Player" WHERE name = $1 ORDER BY "createdAt" DESC LIMIT 1`;
      playerParams = [PLAYER_NAME];
    }

    const playerResult = await pool.query(playerQuery, playerParams);
    if (playerResult.rows.length === 0) {
      console.log(`⚠ 未找到玩家: ${PLAYER_ID || PLAYER_NAME}`);
      return;
    }

    const player = playerResult.rows[0];
    const pid = player.id;

    // 输出玩家状态
    console.log(`\n========== 玩家状态 ==========`);
    console.log(`名称: ${player.name} | ID: ${pid}`);
    console.log(`等级: Lv.${player.level} | 境界: ${player.realm}`);
    console.log(`HP: ${player.hp}/${player.maxHp} | MP: ${player.mp}/${player.maxMp}`);
    console.log(`攻击: ${player.attack} | 防御: ${player.defense} | 速度: ${player.speed}`);
    console.log(`金币: ${player.gold} | 灵石: ${player.spiritStones} | 经验: ${player.exp}`);
    console.log(`区域: ${player.currentAreaId || "无"} | 节点: ${player.currentNodeId || "无"}`);

    // 查询活跃战斗
    const battleResult = await pool.query(
      `SELECT id, "roundNumber", enemies, "log" FROM "BattleState" WHERE "playerId" = $1`,
      [pid]
    );

    if (battleResult.rows.length > 0) {
      const battle = battleResult.rows[0];
      console.log(`\n⚔️  活跃战斗: ID=${battle.id} | 回合=${battle.roundNumber}`);
      console.log(`    敌人: ${JSON.stringify(battle.enemies)}`);
      // console.log(`    日志: ${JSON.stringify(battle.log)}`);
    } else {
      console.log(`\n☮️  当前无活跃战斗`);
    }

    // 查询对话历史
    let histQuery = `SELECT id, role, content, metadata, "createdAt" FROM "ChatHistory" WHERE "playerId" = $1 ORDER BY "createdAt" ASC`;
    const histParams = [pid];
    if (LIMIT) {
      // 取最新 N 条：先倒序取再反转
      histQuery = `SELECT * FROM (SELECT id, role, content, metadata, "createdAt" FROM "ChatHistory" WHERE "playerId" = $1 ORDER BY "createdAt" DESC LIMIT $2) sub ORDER BY "createdAt" ASC`;
      histParams.push(parseInt(LIMIT, 10));
    }

    const histResult = await pool.query(histQuery, histParams);
    const msgs = histResult.rows;

    // 总数
    const countResult = await pool.query(
      `SELECT COUNT(*) as total FROM "ChatHistory" WHERE "playerId" = $1`,
      [pid]
    );

    console.log(`\n========== 对话历史 (${msgs.length}/${countResult.rows[0].total} 条) ==========\n`);

    for (let i = 0; i < msgs.length; i++) {
      const m = msgs[i];
      const time = new Date(m.createdAt).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" });
      const content = FULL_CONTENT
        ? m.content
        : m.content.length > 300
          ? m.content.substring(0, 300) + `... [共${m.content.length}字]`
          : m.content;

      console.log(`[${String(i).padStart(2, "0")}] ${m.role.toUpperCase().padEnd(9)} | ${time} | ${m.content.length}字 | id:${m.id}`);
      console.log(content.split("\n").map(l => "     " + l).join("\n"));
      if (m.metadata) {
        console.log(`     META: ${JSON.stringify(m.metadata)}`);
      }
      console.log();
    }

    // 基础统计（不做判断，只提供数据）
    console.log(`========== 基础统计 ==========`);
    const roles = {};
    const lengths = [];
    msgs.forEach(m => {
      roles[m.role] = (roles[m.role] || 0) + 1;
      lengths.push({ role: m.role, len: m.content.length });
    });
    console.log(`角色分布: ${Object.entries(roles).map(([r, c]) => `${r}:${c}`).join(" | ")}`);
    if (msgs.length > 0) {
      const avgLen = Math.round(lengths.reduce((s, l) => s + l.len, 0) / lengths.length);
      const maxMsg = lengths.reduce((a, b) => a.len > b.len ? a : b);
      const minMsg = lengths.reduce((a, b) => a.len < b.len ? a : b);
      console.log(`内容长度: 平均${avgLen}字 | 最长${maxMsg.len}字(${maxMsg.role}) | 最短${minMsg.len}字(${minMsg.role})`);
    }
    if (msgs.length >= 2) {
      const first = new Date(msgs[0].createdAt);
      const last = new Date(msgs[msgs.length - 1].createdAt);
      const span = Math.round((last - first) / 1000 / 60);
      console.log(`时间跨度: ${span}分钟 (${first.toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" })} → ${last.toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" })})`);
    }
    console.log();
  } catch (err) {
    console.error("❌ 查询失败:", err.message);
    console.log("\n如果数据库连接失败，可通过浏览器 API 检查（确保 npm run dev 运行中）:");
    console.log("  打开 http://localhost:3000/game，在控制台执行:");
    console.log(`  fetch('/api/player/history?playerId=xxx&pageSize=50').then(r=>r.json()).then(console.log)`);
  } finally {
    await pool.end();
  }
}

main();
