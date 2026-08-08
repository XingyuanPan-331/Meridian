// Neon 跨区迁移脚本（两阶段：dump 导出 → load 导入）
// 用法:
//   node scripts/neon-migrate.mjs dump <输出.json>          # 从旧库（.env DATABASE_URL）导出
//   node scripts/neon-migrate.mjs load <输入.json> <新库连接串>  # 导入新库
import pg from "pg";
import { config } from "dotenv";
import fs from "fs";
config();
const { Client } = pg;

const [mode, arg1, arg2] = process.argv.slice(2);

async function dump(outFile) {
  const db = new Client({ connectionString: process.env.DATABASE_URL });
  await db.connect();
  const tablesRes = await db.query(
    `SELECT table_name FROM information_schema.tables
     WHERE table_schema='public' AND table_type='BASE TABLE' ORDER BY table_name`
  );
  const tables = tablesRes.rows.map((r) => r.table_name);
  const data = {};
  let total = 0;
  for (const t of tables) {
    const rows = await db.query(`SELECT * FROM "${t}"`);
    data[t] = rows.rows;
    total += rows.rows.length;
    console.log(`  ${t}: ${rows.rows.length} 行`);
  }
  // 序列
  const seqs = await db.query(
    `SELECT s.relname AS seq, c.relname AS tbl, a.attname AS col
     FROM pg_class s, pg_depend d, pg_class c, pg_attribute a
     WHERE s.relkind='S' AND s.oid=d.objid AND d.refobjid=c.oid AND d.refobjsubid=a.attnum AND a.attrelid=c.oid`
  );
  const seqMap = {};
  for (const s of seqs.rows) {
    const mx = await db.query(`SELECT COALESCE(MAX("${s.col}"),0) AS m FROM "${s.tbl}"`);
    seqMap[s.seq] = mx.rows[0].m;
  }
  fs.writeFileSync(outFile, JSON.stringify({ tables, data, seqMap }, null, 1));
  console.log(`\n导出完成：${tables.length} 表 ${total} 行 → ${outFile}`);
  await db.end();
}

async function load(inFile, newUrl) {
  const { tables, data, seqMap } = JSON.parse(fs.readFileSync(inFile, "utf-8"));
  const db = new Client({ connectionString: newUrl });
  await db.connect();
  if (tables.length > 0) {
    await db.query(`TRUNCATE TABLE ${tables.map((t) => `"${t}"`).join(", ")} RESTART IDENTITY CASCADE`);
  }
  let total = 0;
  // task 表自引用（parentId）→ 行级循环插入（父先子后，收敛）
  async function insertRowwise(t) {
    const rows = data[t] || [];
    if (!rows.length) return;
    const cols = Object.keys(rows[0]);
    const ph = cols.map((_, i) => `$${i + 1}`).join(", ");
    const pending = rows.map((r, i) => ({ r, i }));
    let round = 0;
    while (pending.length && round < 30) {
      round++;
      let progress = false;
      const still = [];
      for (const { r, i } of pending) {
        try {
          await db.query(`INSERT INTO "${t}" (${cols.map((c) => `"${c}"`).join(", ")}) VALUES (${ph})`, cols.map((c) => r[c]));
          total++; progress = true;
        } catch (e) {
          if (String(e.code) === "23503" || String(e.message).includes("foreign key")) still.push({ r, i });
          else throw new Error(`${t} 行${i} 插入失败: ${e.message}`);
        }
      }
      pending.length = 0; pending.push(...still);
      if (!progress) throw new Error(`${t} 存在无法满足的外键依赖（可能有环）: 剩 ${still.length} 行`);
    }
    if (pending.length) throw new Error(`${t} 仍有 ${pending.length} 行未解决`);
  }
  // 其他表：批量插入（每批 300 行）；FK 冲突整体重试（INSERT 语句事务性，失败整批回滚）
  async function insertBatched(t) {
    const rows = data[t] || [];
    if (!rows.length) return;
    const cols = Object.keys(rows[0]);
    let remaining = rows.length;
    const batch = 300;
    for (let i = 0; i < rows.length; i += batch) {
      const chunk = rows.slice(i, i + batch);
      const ph = chunk.map((_, rIdx) => `(${cols.map((_, cIdx) => `$${rIdx * cols.length + cIdx + 1}`).join(", ")})`).join(", ");
      const values = [];
      for (const row of chunk) for (const c of cols) values.push(row[c]);
      await db.query(`INSERT INTO "${t}" (${cols.map((c) => `"${c}"`).join(", ")}) VALUES ${ph}`, values);
      remaining -= chunk.length;
    }
    total += rows.length;
  }
  // users 无外键依赖 → 最先批量插入（tasks/schedules 等全部引用它）
  if (data.users && data.users.length) await insertBatched("users");
  // 再插 tasks（行级，父先子后收敛；schedules/time_logs 等都依赖它）
  await insertRowwise("tasks");
  // 再批量其他表：FK 冲突的表留待下轮（如 agent_feedbacks 依赖 users）
  const toBatch = tables.filter((t) => t !== "tasks" && t !== "users");
  let round = 0;
  while (toBatch.length && round < 40) {
    round++;
    let progress = false;
    for (let idx = 0; idx < toBatch.length; idx++) {
      const t = toBatch[idx];
      try { await insertBatched(t); toBatch.splice(idx, 1); idx--; progress = true; }
      catch (e) {
        if (!(String(e.code) === "23503" || String(e.message).includes("foreign key"))) throw e;
        // FK 冲突 → 留待下轮（依赖表先插入）
      }
    }
    if (!progress) throw new Error(`存在无法满足的外键依赖（可能有环）: ${toBatch.join(", ")}`);
  }
  if (toBatch.length) throw new Error(`仍有表未解决: ${toBatch.join(", ")}`);
  for (const t of tables) console.log(`  ${t}: ${(data[t] || []).length} 行`);
  for (const [seq, v] of Object.entries(seqMap)) {
    try { await db.query(`SELECT setval('${seq}', ${v})`); console.log(`  序列 ${seq} → ${v}`); } catch {}
  }
  console.log(`\n导入完成：${tables.length} 表 ${total} 行`);
  await db.end();
}

(async () => {
  if (mode === "dump" && arg1) return dump(arg1);
  if (mode === "load" && arg1 && arg2) return load(arg1, arg2);
  console.error("用法: dump <out.json> | load <in.json> <新库连接串>");
  process.exit(1);
})().catch((e) => { console.error("失败:", e.message); process.exit(1); });
