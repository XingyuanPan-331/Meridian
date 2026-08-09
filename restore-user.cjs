// 从迁移备份恢复真实用户 3345835109@qq.com 的全部数据（拓扑重试）
// 运行方式：TZ=UTC node restore-user.cjs
require("dotenv").config();
const { Client } = require("pg");
const fs = require("fs");

const BACKUP = "neon-backup-2026-08-09.json";
const EMAIL = "3345835109@qq.com";

const TABLES = [
  "users",
  "ai_configs", "user_profiles", "user_states",
  "tasks",
  "schedules", "time_logs", "task_execution_feedback",
  "decision_logs", "today_decisions", "agent_memories", "agent_feedbacks",
  "user_observations", "user_patterns",
  "daily_briefs", "daily_summaries", "daily_notes",
  "task_drafts", "task_draft_items",
];

(async () => {
  const d = JSON.parse(fs.readFileSync(BACKUP, "utf-8"));
  const data = d.data || d;
  const target = (data.users || []).find((u) => u.email === EMAIL);
  if (!target) { console.log("备份中无此用户"); process.exit(1); }
  const uid = target.id;
  console.log("== 恢复用户:", EMAIL, "| id:", uid);

  const c = new Client({ connectionString: process.env.DATABASE_URL });
  await c.connect();

  const insertRow = async (table, row) => {
    const cols = [];
    const vals = [];
    for (const [k, v] of Object.entries(row)) {
      if (v === null || v === undefined) continue;
      if (typeof v === "object") continue;
      cols.push(`"${k}"`);
      // 2026-08-09 时区事故修复：裸 pg 对 Date/ISO 参数按【客户端本地时区】序列化 timestamp
      // → 列值写成"本地钟面"（与 Prisma UTC 不一致，错 8h）。ISO 字符串先转 UTC 钟面纯文本
      // （YYYY-MM-DD HH:mm:ss），pg 对纯文本直存无转换，与 Prisma 写入一致。
      if (typeof v === "string" && /^\d{4}-\d{2}-\d{2}T/.test(v)) {
        const d = new Date(v);
        if (!isNaN(d.getTime())) {
          vals.push(`${String(d.getUTCFullYear()).padStart(4, "0")}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")} ${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}:${String(d.getUTCSeconds()).padStart(2, "0")}.${String(d.getUTCMilliseconds()).padStart(3, "0")}`);
          continue;
        }
      }
      vals.push(v);
    }
    if (cols.length === 0) return "fail";
    const placeholders = cols.map((_, i) => `$${i + 1}`).join(", ");
    const sql = `INSERT INTO "${table}" (${cols.join(", ")}) VALUES (${placeholders}) ON CONFLICT DO NOTHING`;
    try {
      const r = await c.query(sql, vals);
      return r.rowCount > 0 ? "ok" : "skip";
    } catch {
      return "fail";
    }
  };

  let total = 0;
  for (const table of TABLES) {
    let rows = (data[table] || []).filter((r) => r.userId === uid || r.id === uid);
    if (rows.length === 0) continue;
    const attempts = table === "tasks" ? 6 : 1;
    let ok = 0, skip = 0;
    let remaining = rows;
    for (let round = 0; round < attempts; round++) {
      const next = [];
      for (const row of remaining) {
        const r = await insertRow(table, row);
        if (r === "ok") ok++;
        else if (r === "skip") skip++;
        else next.push(row);
      }
      if (next.length === 0) { remaining = []; break; }
      if (next.length === remaining.length) { remaining = next; break; }
      remaining = next;
    }
    const fail = remaining.length;
    if (fail > 0 && table === "tasks") {
      console.log("  [tasks] 仍失败:", remaining.slice(0, 5).map((r) => r.title).join(", "));
    }
    console.log(`  ${table}: 恢复 ${ok} / 跳过 ${skip} / 失败 ${fail}`);
    total += ok;
  }
  console.log("== 共恢复行数:", total);

  const u = await c.query('SELECT id, email FROM users WHERE email = $1', [EMAIL]);
  console.log("== 验证用户:", u.rows.length ? "恢复成功 OK" : "失败 X");
  if (u.rows.length) {
    const t = await c.query('SELECT count(*) FROM tasks WHERE "userId" = $1', [uid]);
    console.log("== 任务数:", t.rows[0].count);
  }
  await c.end();
})().catch((e) => { console.error("ERR:", e.message.slice(0, 200)); process.exit(1); });
