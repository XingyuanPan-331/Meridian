"use client";

import { useEffect, useState } from "react";
import { localDateStr } from "@/lib/date";
import { useSession, signOut } from "next-auth/react";
import { NavLayoutSettings } from "@/components/settings/nav-layout-settings";
import { PERIOD_KEYS, PERIOD_LABELS, DEFAULT_BOUNDARIES } from "@/lib/task/periods";
import { buildExportHeader } from "@/lib/export-version";

/* ═══════════════════════════════════════════
   Settings · 按 Setting 设计稿 v1.1 完整重写
   · 四大分组：我的身份 / 我的时间 / AI 的控制权 / 数据主权
   · 折叠卡默认只开第一组 · 移除外观板块（设计稿 v1.1 决定）
   · 真功能对接：/api/agent/profile · /api/ai-config · /api/agent/memory/dashboard
   ═══════════════════════════════════════════ */

/* ── 原子组件（设计稿样式） ── */
const cardCls = "bg-[var(--v2-card)] border border-[var(--v2-border)] rounded-xl sh-v2 overflow-hidden";
const inputCls = "font-sans text-sm px-2.5 py-1.5 border border-[var(--v2-border)] rounded-lg bg-[var(--v2-card)] text-[var(--v2-text)] w-full transition focus:outline-none focus:border-[var(--v2-brand)] focus:shadow-[0_0_0_3px_rgba(99,102,241,0.12)]";
const btnSm = "text-sm font-medium px-2.5 py-1 rounded-lg border border-[var(--v2-border)] bg-[var(--v2-card)] text-[var(--v2-text2)] hover:border-[var(--color-gray-300)] hover:text-[var(--v2-text)] transition";
const btnPrimary = "text-sm font-medium px-3.5 py-1.5 rounded-lg bg-[var(--v2-brand)] border border-[var(--v2-brand)] text-white hover:bg-[var(--v2-brand-deep)] transition";
const btnDanger = "text-sm font-medium px-2.5 py-1 rounded-lg text-[var(--color-danger-text)] border border-[var(--color-danger-border)] bg-[var(--color-danger-bg)] hover:bg-[var(--color-danger-bg)] transition";

function Group({ icon, title }: { icon: string; title: string }) {
  return (
    <div className="flex items-center gap-2 text-sm font-semibold tracking-[1px] text-[var(--v2-text3)] mt-5 mb-1 px-1">
      <span className="text-sm">{icon}</span>
      {title}
      <span className="flex-1 h-px bg-[#eceef0]" />
    </div>
  );
}

function Card({ title, desc, icon, iconBg, defaultOpen, children }: {
  title: string; desc: string; icon: string; iconBg: string; defaultOpen?: boolean; children: React.ReactNode;
}) {
  const [open, setOpen] = useState(!!defaultOpen);
  return (
    <div className={`${cardCls} ${open ? "open" : ""}`}>
      <button onClick={() => setOpen(!open)} className="w-full flex items-center justify-between px-4 py-3.5 text-left font-sans">
        <div className="flex items-center gap-2.5">
          <span className={`w-8 h-8 rounded-[9px] flex items-center justify-center text-sm shrink-0 ${iconBg}`}>{icon}</span>
          <div>
            <div className="text-sm font-semibold text-[var(--v2-text)]">{title}</div>
            <div className="text-sm text-[var(--v2-text3)] mt-0.5">{desc}</div>
          </div>
        </div>
        <span className={`text-sm text-[var(--v2-text3)] transition-transform duration-200 ${open ? "rotate-180" : ""}`}>▼</span>
      </button>
      {open && <div className="px-4 pb-4 animate-fade-in">{children}</div>}
    </div>
  );
}

function Row({ label, hint, children, right }: { label: React.ReactNode; hint?: string; children?: React.ReactNode; right?: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3.5 py-2.5 border-t border-[var(--color-gray-100)] first:border-t-0">
      <div className="min-w-0">
        <div className="text-sm font-medium text-[var(--v2-text)]">{label}</div>
        {hint && <div className="text-sm text-[var(--v2-text3)] mt-0.5 leading-[1.5]">{hint}</div>}
      </div>
      {right ? <div className="shrink-0 flex items-center gap-2">{right}</div> : children}
    </div>
  );
}

function Switch({ checked, onChange, disabled }: { checked: boolean; onChange?: (v: boolean) => void; disabled?: boolean }) {
  return (
    <label className={`relative w-[38px] h-[22px] shrink-0 inline-block ${disabled ? "opacity-50" : ""}`}>
      <input type="checkbox" className="opacity-0 w-0 h-0" checked={checked} disabled={disabled} onChange={(e) => onChange?.(e.target.checked)} />
      <span className={`absolute inset-0 rounded-full transition-colors duration-200 cursor-pointer ${disabled ? "cursor-not-allowed" : ""} ${checked ? "bg-[var(--v2-brand)]" : "bg-[var(--color-gray-300)]"}`}>
        <span className={`absolute top-[2px] left-[2px] w-[18px] h-[18px] rounded-full bg-white shadow-[0_1px_2px_rgba(0,0,0,0.15)] transition-transform duration-200 ${checked ? "translate-x-4" : ""}`} />
      </span>
    </label>
  );
}

function Seg<T extends string>({ value, options, onChange }: { value: T; options: { label: string; value: T }[]; onChange: (v: T) => void }) {
  return (
    <div className="flex gap-0.5 bg-[var(--color-gray-100)] rounded-lg p-[3px]">
      {options.map((o) => (
        <button key={o.value} onClick={() => onChange(o.value)}
          className={`text-sm px-2.5 py-1 rounded-md transition ${value === o.value ? "bg-white text-[var(--v2-text)] font-medium shadow-[0_1px_2px_rgba(0,0,0,0.06)]" : "text-[var(--v2-text2)]"}`}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

/* ════════════ 一 · 我的身份：账户与资料 ════════════ */
function AccountCard() {
  const { data: session, update } = useSession();
  const user = session?.user;
  const [nickname, setNickname] = useState(user?.name || "");
  const [savingNick, setSavingNick] = useState(false);
  const [nickMsg, setNickMsg] = useState<"" | "ok" | "err">("");

  const saveNickname = async () => {
    setSavingNick(true);
    setNickMsg("");
    try {
      const r = await fetch("/api/user", {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nickname }),
      });
      if (!r.ok) throw new Error();
      setNickMsg("ok");
      await update?.(); // 刷新 session（侧边栏昵称同步）
      setTimeout(() => setNickMsg(""), 2500);
    } catch { setNickMsg("err"); }
    finally { setSavingNick(false); }
  };

  return (
    <Card title="账户与资料" desc="你是谁 · 登录信息" icon="👤" iconBg="bg-[var(--v2-brand-bg)] text-[var(--v2-brand)]" defaultOpen>
      <Row label="昵称" hint="显示在侧边栏，AI 称呼你时会用到">
        <div className="flex items-center gap-2">
          <input className={`${inputCls} w-32`} value={nickname} onChange={(e) => setNickname(e.target.value)} placeholder={user?.name || "未设置"} />
          <button onClick={saveNickname} disabled={savingNick || !nickname.trim() || nickname.trim() === (user?.name || "")}
            className={btnSm + " disabled:opacity-50"}>{savingNick ? "保存中…" : "保存"}</button>
          {nickMsg === "ok" && <span className="text-xs text-[var(--v2-green)]">✓ 已保存</span>}
          {nickMsg === "err" && <span className="text-xs text-[var(--color-danger-text)]">保存失败</span>}
        </div>
      </Row>
      <Row label="邮箱" hint="登录账户，暂不支持修改">
        <input className={`${inputCls} w-52 bg-[var(--color-gray-50)] text-[var(--v2-text2)]`} value={user?.email || ""} readOnly />
      </Row>
      <Row label="退出登录" hint="回到登录页，数据保留">
        <button className={btnSm + " !text-[var(--color-danger-text)] !border-[var(--color-danger-border)] !bg-[var(--color-danger-bg)]" } onClick={() => signOut({ callbackUrl: "/login" })}>退出</button>
      </Row>
    </Card>
  );
}

/* ════════════ 二 · 我的时间：时间与作息 ════════════ */
interface BlockItem { day: string; start: string; end: string; name: string; }

function TimeCard() {
  const [wake, setWake] = useState("07:00");
  const [sleep, setSleep] = useState("23:30");
  const [peak, setPeak] = useState("morning");
  const [low, setLow] = useState("afternoon");
  const [blocks, setBlocks] = useState<BlockItem[]>([]);
  const [slots, setSlots] = useState<{ label: string; range: string }[]>([]);
  const [saved, setSaved] = useState(false);
  const [loading, setLoading] = useState(true);

  // 添加固定时间块表单
  const [nbDay, setNbDay] = useState("周一");
  const [nbStart, setNbStart] = useState("08:00");
  const [nbEnd, setNbEnd] = useState("10:00");
  const [nbName, setNbName] = useState("");

  useEffect(() => {
    fetch("/api/agent/profile").then((r) => r.json()).then((d) => {
      if (!d) return;
      if (d.wakeTime) setWake(d.wakeTime);
      if (d.sleepTime) setSleep(d.sleepTime);
      if (d.peakEnergy) setPeak(d.peakEnergy);
      if (d.lowEnergy) setLow(d.lowEnergy);
      try {
        if (d.fixedBlocks) setBlocks(JSON.parse(d.fixedBlocks));
        if (d.availableSlots) setSlots(JSON.parse(d.availableSlots));
        // 时段分组：preferences.periodBoundaries → partitions（带校验）
        const pref = d.preferences ? JSON.parse(d.preferences) : null;
        const pb = pref?.periodBoundaries;
        if (Array.isArray(pb) && pb.length === 4 && pb.every((n: unknown) => typeof n === "number" && n >= 0 && n <= 23)) {
          const ends = ["12", "18", "22", "8"];
          setPartitions((arr) => arr.map((p, i) => ({ ...p, start: String(pb[i]), end: ends[i] })));
        }
      } catch { /* 解析失败忽略 */ }
    }).catch(() => {}).finally(() => setLoading(false));
  }, []);

  const save = async () => {
    setSaved(false);
    const r = await fetch("/api/agent/profile", {
      method: "PUT", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ wakeTime: wake, sleepTime: sleep, peakEnergy: peak, lowEnergy: low, fixedBlocks: JSON.stringify(blocks), availableSlots: JSON.stringify(slots) }),
    });
    if (r.ok) { setSaved(true); setTimeout(() => setSaved(false), 3000); }
  };

  const addBlock = () => {
    if (!nbName.trim()) return;
    setBlocks((b) => [...b, { day: nbDay, start: nbStart, end: nbEnd, name: nbName.trim() }]);
    setNbName("");
  };

  // 可用时段：添加（修复：原来只可删不可加）
  const [addSlotOpen, setAddSlotOpen] = useState(false);
  const [nbSlotLabel, setNbSlotLabel] = useState("");
  const [nbSlotRange, setNbSlotRange] = useState("");
  const addSlot = () => {
    if (!nbSlotLabel.trim() || !nbSlotRange.trim()) return;
    setSlots((s) => [...s, { label: nbSlotLabel.trim(), range: nbSlotRange.trim() }]);
    setNbSlotLabel(""); setNbSlotRange(""); setAddSlotOpen(false);
  };

  // 日分区边界：点击 ✎ 行内编辑（修复：原来 ✎ 无事件）
  const [partitions, setPartitions] = useState<{ key: string; label: string; start: string; end: string; bg: string; tx: string }[]>(() => {
    // 默认分组：上午 8-12 / 下午 12-18 / 晚上 18-22 / 凌晨 22-次日8（跨天）· 与 Review 时段偏好共用
    const b = DEFAULT_BOUNDARIES; // [8, 12, 18, 22]
    const ends = ["12", "18", "22", "8"]; // 凌晨结束 = 次日 8 点（跨天）
    const bg = ["var(--color-plan-task-deadline)", "#e0f2fe", "#ede9fe", "#e2e8f0"];
    const tx = ["var(--color-plan-task-deadline-text)", "#075985", "#5b21b6", "#334155"];
    return PERIOD_KEYS.map((k, i) => ({ key: k, label: PERIOD_LABELS[k], start: String(b[i]), end: ends[i], bg: bg[i], tx: tx[i] }));
  });
  const [editingPart, setEditingPart] = useState<string | null>(null);
  const [partDraft, setPartDraft] = useState({ start: "", end: "" });
  const startEditPart = (key: string) => {
    const p = partitions.find((x) => x.key === key);
    if (!p) return;
    setPartDraft({ start: p.start, end: p.end });
    setEditingPart(key);
  };
  const savePart = () => {
    const next = partitions.map((p) => (p.key === editingPart ? { ...p, start: partDraft.start || p.start, end: partDraft.end || p.end } : p));
    setPartitions(next);
    setEditingPart(null);
    // 持久化：转 boundaries [上午, 下午, 晚上, 凌晨] 写入 preferences.periodBoundaries（保留原字段）
    const b = [8, 12, 18, 22].map((_, i) => {
      const n = parseInt(next[i].start, 10);
      return Number.isFinite(n) && n >= 0 && n <= 23 ? n : DEFAULT_BOUNDARIES[i];
    });
    fetch("/api/agent/profile", { method: "GET" }).then((r) => (r.ok ? r.json() : null)).then((d) => {
      let pref: Record<string, unknown> = {};
      try { pref = d?.preferences ? JSON.parse(d.preferences) : {}; } catch { /* 忽略 */ }
      pref.periodBoundaries = b;
      return fetch("/api/agent/profile", {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ preferences: JSON.stringify(pref) }),
      });
    }).then((r) => { if (r?.ok) { setSaved(true); setTimeout(() => setSaved(false), 3000); } }).catch(() => {});
  };

  const dayNames = ["周一", "周二", "周三", "周四", "周五", "周六", "周日"];

  return (
    <Card title="时间与作息" desc="AI 规划时间的地基 · 你的时间长什么样" icon="🕐" iconBg="bg-[var(--v2-teal-bg,#f0fdfa)] text-[#0d9488]">
      <Row label="起床 / 睡觉" hint="AI 只会在你清醒的时间安排任务">
        <input type="time" className={`${inputCls} !w-24`} value={wake} onChange={(e) => setWake(e.target.value)} />
        <span className="text-sm text-[var(--v2-text3)]">至</span>
        <input type="time" className={`${inputCls} !w-24`} value={sleep} onChange={(e) => setSleep(e.target.value)} />
      </Row>
      <Row label="精力高峰" hint="深度任务排高峰，琐事排低谷">
        <Seg value={peak} onChange={setPeak} options={[{ label: "上午", value: "morning" }, { label: "下午", value: "afternoon" }, { label: "晚上", value: "evening" }]} />
      </Row>
      <Row label="精力低谷">
        <Seg value={low} onChange={setLow} options={[{ label: "上午", value: "morning" }, { label: "下午", value: "afternoon" }, { label: "晚上", value: "evening" }]} />
      </Row>

      <Row label="固定时间块" hint="雷打不动的时间 · 上课、例会、健身课 · AI 排期自动避开" />
      <div className="flex flex-col gap-1.5 mb-2">
        {blocks.map((b, i) => (
          <div key={i} className="flex items-center gap-2 text-sm px-2.5 py-1.5 rounded-lg bg-[var(--color-gray-50)] border border-[var(--color-gray-100)]">
            <span className="font-semibold text-[var(--v2-text)] w-11 shrink-0">{b.day}</span>
            <span className="text-[var(--v2-text2)] tabular-nums flex-1">{b.start} – {b.end}</span>
            <span className="text-sm text-[#2563eb] bg-[#eff6ff] rounded px-1.5 py-0.5">{b.name}</span>
            <button onClick={() => setBlocks((arr) => arr.filter((_, j) => j !== i))} className="text-sm text-[var(--v2-text3)] hover:text-[var(--color-danger-text)] px-1">✕</button>
          </div>
        ))}
        {blocks.length === 0 && <div className="text-sm text-[var(--v2-text3)] px-1 py-1">还没有固定时间块</div>}
      </div>
      <div className="grid grid-cols-[86px_96px_auto_96px_1fr_auto] gap-1.5 items-center mb-2 max-sm:grid-cols-3 max-sm:[&_.ba-dash]:hidden">
        <select className={`${inputCls}`} value={nbDay} onChange={(e) => setNbDay(e.target.value)}>
          {dayNames.map((d) => <option key={d}>{d}</option>)}
        </select>
        <input type="time" className={`${inputCls}`} value={nbStart} onChange={(e) => setNbStart(e.target.value)} />
        <span className="ba-dash text-sm text-[var(--v2-text3)] text-center">至</span>
        <input type="time" className={`${inputCls}`} value={nbEnd} onChange={(e) => setNbEnd(e.target.value)} />
        <input className={`${inputCls}`} placeholder="名称，如：高数课" value={nbName} onChange={(e) => setNbName(e.target.value)} />
        <button onClick={addBlock} className={`${btnPrimary} !text-sm !px-2.5 !py-1 whitespace-nowrap`}>＋ 添加</button>
      </div>

      <Row label="可用时间段" hint="哪些时段愿意接受排期 · 碎片时间也能被利用" />
      <div className="flex gap-1.5 flex-wrap mb-1">
        {slots.map((s, i) => (
          <span key={i} className="inline-flex items-center gap-1.5 text-sm text-[#0d9488] bg-[#f0fdfa] border border-[#99f6e4] rounded-full px-2.5 py-1">
            {s.label} {s.range}
            <button onClick={() => setSlots((arr) => arr.filter((_, j) => j !== i))} className="opacity-60 hover:opacity-100">✕</button>
          </span>
        ))}
        {addSlotOpen && (
          <span className="inline-flex items-center gap-1.5 text-sm rounded-full px-2.5 py-1 bg-white border border-[var(--v2-border)]">
            <input className="w-16 outline-none bg-transparent" placeholder="标签" value={nbSlotLabel} onChange={(e) => setNbSlotLabel(e.target.value)} />
            <input className="w-24 outline-none bg-transparent tabular-nums" placeholder="08:00-10:00" value={nbSlotRange} onChange={(e) => setNbSlotRange(e.target.value)} />
            <button onClick={addSlot} className="text-[var(--v2-brand)] font-medium">✓</button>
            <button onClick={() => setAddSlotOpen(false)} className="text-[var(--v2-text3)]">✕</button>
          </span>
        )}
        <button onClick={() => setAddSlotOpen((v) => !v)} className="text-sm px-2.5 py-1 rounded-full border border-dashed border-[var(--v2-border)] text-[var(--v2-text2)] hover:border-[var(--v2-brand)] hover:text-[var(--v2-brand)] transition">＋ 添加时段</button>
      </div>

      <Row label="日分区边界" hint="Plan 分区 & Review 时段偏好共用 · 凌晨 22-8 跨天 · 点击 ✎ 可修改并保存" />
      <div className="flex gap-1 my-2.5">
        {partitions.map((p) => (
          <div key={p.key} className="flex-1 rounded-lg py-2 text-center relative" style={{ background: p.bg, color: p.tx }}>
            <div className="text-sm font-semibold">{p.label}</div>
            {editingPart === p.key ? (
              <div className="flex items-center justify-center gap-0.5 mt-0.5 text-xs">
                <input className="w-6 bg-white/80 rounded px-0.5 text-center outline-none" value={partDraft.start} onChange={(e) => setPartDraft((d) => ({ ...d, start: e.target.value }))} />
                <span>–</span>
                <input className="w-6 bg-white/80 rounded px-0.5 text-center outline-none" value={partDraft.end} onChange={(e) => setPartDraft((d) => ({ ...d, end: e.target.value }))} />
                <span>点</span>
                <button onClick={savePart} className="ml-0.5 text-xs font-bold">✓</button>
              </div>
            ) : (
              <div className="text-sm opacity-75 tabular-nums mt-0.5">{p.start} – {p.end} 点</div>
            )}
            <button onClick={() => startEditPart(p.key)} className="absolute -top-1.5 -right-1.5 w-4 h-4 rounded-full bg-white border border-[var(--v2-border)] text-[var(--v2-text3)] text-xs flex items-center justify-center hover:border-[var(--v2-brand)] hover:text-[var(--v2-brand)]">✎</button>
          </div>
        ))}
      </div>

      <div className="flex items-center justify-end gap-2 mt-2.5">
        {saved && <span className="text-sm text-[var(--v2-green)]">✓ 已保存</span>}
        <button onClick={save} disabled={loading} className={btnPrimary}>保存作息</button>
      </div>
    </Card>
  );
}

/* ════════════ 三 · AI 的控制权 ════════════ */
const AI_ROLE_KEYS = ["inbox", "plan", "today", "review"] as const;
const AI_ROLE_LABELS: Record<string, { label: string; desc: string; icon: string }> = {
  inbox: { label: "Inbox 解析", desc: "自然语言 → 结构化任务", icon: "💭" },
  plan: { label: "Plan 规划建议", desc: "冲突检测 · 优化排期", icon: "🗓️" },
  today: { label: "Today 决策助手", desc: "今日 must-do / 动态调整", icon: "🏠" },
  review: { label: "Review 归因分析", desc: "复盘洞察 · 行为分析", icon: "📈" },
};

function AiControlCard() {
  const [master, setMaster] = useState(true);
  const [roles, setRoles] = useState<Record<string, boolean>>({ inbox: true, plan: true, today: true, review: true });
  const [level, setLevel] = useState<"保守" | "平衡" | "主动">("平衡");
  const [confirmChange, setConfirmChange] = useState(true);

  useEffect(() => {
    try {
      const m = localStorage.getItem("taskos.ai.master");
      if (m !== null) setMaster(m === "1");
      const lv = localStorage.getItem("taskos.ai.level");
      if (lv === "保守" || lv === "平衡" || lv === "主动") setLevel(lv);
      const cc = localStorage.getItem("taskos.ai.confirm");
      if (cc !== null) setConfirmChange(cc === "1");
      const stored = localStorage.getItem("taskos.ai.roles");
      if (stored) { try { setRoles({ ...roles, ...JSON.parse(stored) }); } catch { /* ignore */ } }
    } catch { /* ignore */ }
  }, []);

  const persist = (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* ignore */ } };

  return (
    <Card title="AI 控制中心" desc="总开关 · AI 只建议不强制" icon="🎛️" iconBg="bg-[var(--v2-purple-bg)] text-[var(--v2-purple)]">
      <Row label="AI 总开关" hint="关闭后所有 AI 建议暂停 · 系统退回纯规则引擎，核心功能不受影响">
        <Switch checked={master} onChange={(v) => { setMaster(v); persist("taskos.ai.master", v ? "1" : "0"); }} />
      </Row>
      <div className="text-sm text-[var(--v2-text3)] py-0.5 pb-2">各页面 AI 角色（总开关关闭时全部失效）：</div>
      {AI_ROLE_KEYS.map((k) => (
        <Row key={k} label={<span className="text-sm font-medium text-[var(--v2-text)]">{AI_ROLE_LABELS[k].icon} {AI_ROLE_LABELS[k].label}<span className="text-sm text-[var(--v2-text3)] font-normal ml-1.5">{AI_ROLE_LABELS[k].desc}</span></span>}>
          <Switch checked={roles[k] && master} disabled={!master} onChange={(v) => { const next = { ...roles, [k]: v }; setRoles(next); persist("taskos.ai.roles", JSON.stringify(next)); }} />
        </Row>
      ))}
      <Row label="建议力度" hint="保守 = 只在必要时提醒 · 主动 = 频繁给建议">
        <Seg value={level} onChange={(v) => { setLevel(v); persist("taskos.ai.level", v); }} options={[{ label: "保守", value: "保守" }, { label: "平衡", value: "平衡" }, { label: "主动", value: "主动" }]} />
      </Row>
      <Row label="AI 改动计划前需确认" hint="所有 AI 排期改动先给你方案，你点头才执行">
        <Switch checked={confirmChange} onChange={(v) => { setConfirmChange(v); persist("taskos.ai.confirm", v ? "1" : "0"); }} />
      </Row>
    </Card>
  );
}

function AiMemoryCard() {
  const [memories, setMemories] = useState<any[]>([]);
  const [trust, setTrust] = useState(0);
  const [loading, setLoading] = useState(true);

  const load = () => {
    fetch("/api/agent/memory/dashboard").then((r) => r.json()).then((d) => {
      if (d.topMemories) setMemories(d.topMemories);
      if (d.trustScore) setTrust(d.trustScore);
    }).catch(() => {}).finally(() => setLoading(false));
  };
  useEffect(load, []);

  const act = async (action: string, id: string) => {
    await fetch("/api/agent/memory/dashboard", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, memoryId: id }) });
    load();
  };

  const sourceLabels: Record<string, string> = { user_declaration: "你说的", user_correction: "你的习惯", pattern_mining: "数据发现", ai_analysis: "AI 推测", system_baseline: "系统默认" };
  const statusLabels: Record<string, string> = { active: "活跃", dormant: "休眠", retired: "退休", blocked: "已关闭" };
  const memIcon = (m: any) => m.dimension === "ability" ? "⭐" : m.memoryType === "hard_constraint" ? "📌" : "💡";
  const memIconBg = (m: any) => m.status === "blocked" ? "bg-[var(--color-gray-100)] text-[var(--v2-text2)]" : m.memoryType === "hard_constraint" ? "bg-[var(--v2-purple-bg)] text-[var(--v2-purple)]" : m.dimension === "ability" ? "bg-[var(--color-gray-100)] text-[var(--v2-text2)]" : "bg-[var(--v2-brand-bg)] text-[var(--v2-brand)]";

  return (
    <Card title="AI 对我的理解" desc="它记住了什么 · 你有权关闭任何一条" icon="🧠" iconBg="bg-[var(--v2-purple-bg)] text-[var(--v2-purple)]">
      <div className="flex items-center justify-between mb-2">
        <div>
          <div className="text-xl font-semibold text-[var(--v2-brand-deep)]">{Math.round(trust * 100)}<span className="text-sm">%</span></div>
          <div className="text-sm text-[var(--v2-text3)]">信任分 · AI 建议的可靠程度</div>
        </div>
      </div>
      <div className="h-[7px] bg-[var(--color-gray-100)] rounded overflow-hidden">
        <div className="h-full rounded bg-gradient-to-r from-[#a5b4fc] to-[var(--v2-brand)] transition-all" style={{ width: `${Math.round(trust * 100)}%` }} />
      </div>

      <div className="text-sm text-[var(--v2-text3)] mt-3.5 mb-1">最近记住的（按置信度）</div>
      {!loading && memories.length === 0 && <div className="text-sm text-[var(--v2-text3)] py-3 text-center">AI 还不够了解你，多使用几天后会有更多发现</div>}
      {memories.slice(0, 10).map((m) => (
        <div key={m.id} className={`flex items-start gap-2.5 py-2 border-t border-[var(--color-gray-100)] first:border-t-0 ${m.status === "blocked" ? "opacity-55" : ""}`}>
          <span className={`w-[26px] h-[26px] rounded-lg shrink-0 flex items-center justify-center text-sm ${memIconBg(m)}`}>{memIcon(m)}</span>
          <div className="flex-1 min-w-0">
            <div className="text-sm text-[var(--v2-text)] leading-[1.5]">{m.content}</div>
            <div className="text-sm text-[var(--v2-text3)] mt-0.5">{sourceLabels[m.source] || m.source} · 置信度 {Math.round((m.confidence ?? 0) * 100)}% · {statusLabels[m.status] || m.status}</div>
          </div>
          <div className="flex gap-1 shrink-0">
            {m.status !== "blocked"
              ? <button onClick={() => act("block", m.id)} className={btnDanger + " !text-sm !px-2 !py-1"}>关闭</button>
              : <button onClick={() => act("unblock", m.id)} className={btnSm + " !text-sm !px-2 !py-1"}>恢复</button>}
          </div>
        </div>
      ))}
    </Card>
  );
}

function AiConfigCard() {
  const [provider, setProvider] = useState("openai");
  const [baseUrl, setBaseUrl] = useState("https://api.openai.com/v1");
  const [apiKey, setApiKey] = useState("");
  const [model, setModel] = useState("gpt-4o");
  const [configured, setConfigured] = useState(false);
  const [saved, setSaved] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; msg: string } | null>(null);

  const PRESETS = [
    { name: "OpenAI", provider: "openai", baseUrl: "https://api.openai.com/v1", model: "gpt-4o" },
    { name: "通义千问", provider: "qwen", baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1", model: "qwen-max" },
    // DeepSeek-V4（2026-07-31 正式版）：旧别名 deepseek-chat/deepseek-reasoner 已于 2026-07-24 退役
    { name: "DeepSeek V4", provider: "deepseek", baseUrl: "https://api.deepseek.com", model: "deepseek-v4-flash" },
    { name: "自定义", provider: "custom", baseUrl: "", model: "" },
  ];

  useEffect(() => {
    fetch("/api/ai-config").then((r) => r.json()).then((d) => {
      if (d.configured) { setConfigured(true); setProvider(d.provider); setBaseUrl(d.baseUrl); setModel(d.model); }
    }).catch(() => {});
  }, []);

  const save = async () => {
    setSaved(false);
    const r = await fetch("/api/ai-config", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ provider, baseUrl, apiKey, model }) });
    if (r.ok) { setSaved(true); setConfigured(true); setTimeout(() => setSaved(false), 3000); }
  };

  const test = async () => {
    setTesting(true); setTestResult(null);
    try {
      const r = await fetch("/api/ai-config/test", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ provider, baseUrl, apiKey, model }) });
      const d = await r.json().catch(() => ({}));
      if (r.ok && d.ok !== false) setTestResult({ ok: true, msg: d.latency ? `✓ 连接成功 · 延迟 ${d.latency}ms` : "✓ 连接成功" });
      else setTestResult({ ok: false, msg: d.error?.message || "连接失败" });
    } catch { setTestResult({ ok: false, msg: "连接失败" }); }
    finally { setTesting(false); }
  };

  return (
    <Card title="AI 服务配置" desc="不配置也能用 · 配了更懂你" icon="🔌" iconBg="bg-[var(--v2-purple-bg)] text-[var(--v2-purple)]">
      <Row label="快速选择" hint="一键填入官方参数" />
      <div className="flex gap-1.5 flex-wrap mb-2.5">
        {PRESETS.map((p) => (
          <button key={p.name} onClick={() => { setProvider(p.provider); setBaseUrl(p.baseUrl); setModel(p.model); }}
            className={`text-sm px-3 py-1.5 rounded-full border transition ${provider === p.provider ? "bg-[var(--v2-brand)] border-[var(--v2-brand)] text-white font-medium" : "border-[var(--v2-border)] bg-[var(--v2-card)] text-[var(--v2-text2)] hover:border-[var(--v2-brand)] hover:text-[var(--v2-brand)]"}`}>
            {p.name}
          </button>
        ))}
      </div>
      <Row label="API 地址" right={<input className={`${inputCls} w-64 max-w-full`} value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} />} />
      <Row label="API Key" right={<input type="password" className={`${inputCls} w-64 max-w-full`} value={apiKey} onChange={(e) => setApiKey(e.target.value)} placeholder={configured ? "已保存（输入新值覆盖）" : "sk-..."} />} />
      <Row label="模型名称" right={<input className={`${inputCls} w-64 max-w-full`} value={model} onChange={(e) => setModel(e.target.value)} />} />
      <div className="flex items-center justify-end gap-2 mt-2.5">
        {testResult && <span className={`text-sm ${testResult.ok ? "text-[var(--v2-green)]" : "text-[var(--color-danger-text)]"}`}>{testResult.msg}</span>}
        {saved && <span className="text-sm text-[var(--v2-green)]">✓ 已保存</span>}
        <button onClick={test} disabled={testing} className={btnSm}>{testing ? "测试中…" : "测试连接"}</button>
        <button onClick={save} className={btnPrimary}>保存配置</button>
      </div>
    </Card>
  );
}

/* ════════════ 四 · 数据主权 ════════════ */
function DataCard() {
  const [stats, setStats] = useState<{ tasks: number; memories: number; streak: number } | null>(null);

  useEffect(() => {
    Promise.all([
      fetch("/api/views/stats").then((r) => r.json()).catch(() => null),
      fetch("/api/agent/memory/dashboard").then((r) => r.json()).catch(() => null),
    ]).then(([s, m]) => {
      let streak = 0;
      if (s?.dailyBreakdown) {
        for (let i = s.dailyBreakdown.length - 1; i >= 0; i--) {
          if ((s.dailyBreakdown[i].completedCount ?? 0) > 0) streak++;
          else break;
        }
      }
      setStats({ tasks: s?.totalCompleted ?? 0, memories: m?.topMemories?.length ?? 0, streak });
    });
  }, []);

  const exportJson = async () => {
    const [s, m, w] = await Promise.all([
      fetch("/api/views/stats").then((r) => r.json()).catch(() => null),
      fetch("/api/agent/memory/dashboard").then((r) => r.json()).catch(() => null),
      fetch("/api/views/week-calendar").then((r) => r.json()).catch(() => null),
    ]);
    // V3 D5 数据主权（总控 R4 红线）：导出必须带 schemaVersion + 迁移映射表
    const payload = {
      ...buildExportHeader(new Date().toISOString()),
      stats: s,
      memories: m,
      week: w,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `taskos-backup-${localDateStr()}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000); // 修复：立即 revoke 可能中断下载
  };

  return (
    <Card title="数据与隐私" desc="你的数据属于你" icon="🗂️" iconBg="bg-[var(--color-gray-100)] text-[var(--v2-text2)]">
      <div className="grid grid-cols-3 gap-2 mb-3 max-sm:grid-cols-1">
        <div className="bg-[var(--color-gray-50)] border border-[var(--color-gray-100)] rounded-lg py-2.5 text-center">
          <div className="text-[18px] font-bold text-[var(--v2-brand-deep)]">{stats?.tasks ?? "—"}</div>
          <div className="text-sm text-[var(--v2-text3)] mt-0.5">本周任务</div>
        </div>
        <div className="bg-[var(--color-gray-50)] border border-[var(--color-gray-100)] rounded-lg py-2.5 text-center">
          <div className="text-[18px] font-bold text-[#0d9488]">{stats?.memories ?? "—"}</div>
          <div className="text-sm text-[var(--v2-text3)] mt-0.5">AI 记忆</div>
        </div>
        <div className="bg-[var(--color-gray-50)] border border-[var(--color-gray-100)] rounded-lg py-2.5 text-center">
          <div className="text-[18px] font-bold text-[var(--v2-amber)]">{stats?.streak ?? "—"} 天</div>
          <div className="text-sm text-[var(--v2-text3)] mt-0.5">连续使用</div>
        </div>
      </div>
      <Row label="导出全部数据" hint="任务 · 时间安排 · 复盘 · AI 记忆 · JSON 全量备份">
        <button onClick={exportJson} className={btnSm}>导出 JSON</button>
      </Row>
      <Row label="清理学习数据" hint="清空行为记录与 AI 记忆 · 任务本身不受影响">
        <button className={btnDanger} onClick={async () => {
          if (!confirm("确认清理全部学习数据（行为记录/记忆/决策日志）？任务不会受影响。")) return;
          try {
            const r = await fetch("/api/user?action=cleanup", { method: "POST" });
            if (r.ok) alert("已清理：行为记录 / AI 记忆 / 决策日志");
            else alert("清理失败，请重试");
          } catch { alert("清理失败，请重试"); }
        }}>清理</button>
      </Row>
      <div className="flex items-center justify-between gap-3 border border-[var(--color-danger-border)] rounded-lg bg-[var(--color-danger-bg)] px-3.5 py-3 mt-3">
        <div>
          <div className="text-sm font-semibold text-[#991b1b]">删除账户</div>
          <div className="text-sm text-[#b91c1c] opacity-80 mt-0.5">永久删除全部数据 · 不可恢复</div>
        </div>
        <button className="text-sm px-2.5 py-1 rounded-lg bg-white border border-[var(--color-danger-border)] text-[var(--color-danger-text)]" onClick={async () => {
          if (!confirm("此操作将永久删除账户和全部数据，不可恢复。确定继续？")) return;
          if (!confirm("再次确认：真的要删除吗？")) return;
          try {
            const r = await fetch("/api/user", { method: "DELETE" });
            if (r.ok) { await signOut({ callbackUrl: "/login" }); }
            else alert("删除失败，请重试");
          } catch { alert("删除失败，请重试"); }
        }}>删除</button>
      </div>
    </Card>
  );
}

function AboutCard() {
  return (
    <Card title="关于" desc="Meridian · 子午" icon="ℹ️" iconBg="bg-[var(--color-gray-100)] text-[var(--v2-text2)]">
      <div className="text-center py-2">
        <div className="text-sm font-semibold text-[var(--v2-text)]">Meridian · 子午 · AI 驱动的个人时间操作系统</div>
        <div className="text-sm text-[var(--v2-text2)] mt-1.5 leading-[1.7]">
          一天有万千事物，总有一条中轴。<br />帮用户过滤未来，而不是堆积未来。
        </div>
        <div className="text-sm text-[var(--v2-text3)] mt-2.5">版本 V1.0.0 · 2026-08</div>
      </div>
    </Card>
  );
}

/* ── 页面 ── */
export default function SettingsPage() {
  return (
    <div className="max-w-[620px] mx-auto flex flex-col gap-3">
      <div className="mb-1">
        <h2 className="text-[24px] font-semibold tracking-[-0.3px] text-[var(--v2-text)]">设置</h2>
        <p className="text-sm text-[var(--v2-text3)] mt-1">控制面板 + 信任校准 · 你拥有最终控制权</p>
      </div>

      {/* 界面（用户点名：导航与版式切换放设置里） */}
      <Group icon="🧭" title="界面" />
      <NavLayoutSettings />

      {/* 一 · 我的身份 */}
      <Group icon="👤" title="我的身份" />
      <AccountCard />

      {/* 二 · 我的时间 · 项目灵魂 */}
      <Group icon="🕐" title="我的时间 · 项目灵魂" />
      <TimeCard />

      {/* 三 · AI 的控制权 */}
      <Group icon="🤖" title="AI 的控制权" />
      <AiControlCard />
      <AiMemoryCard />
      <AiConfigCard />

      {/* 四 · 数据主权 */}
      <Group icon="🔐" title="数据主权" />
      <DataCard />
      <AboutCard />

      <p className="text-sm text-[var(--v2-text3)] text-center mt-5 leading-[1.6]">
        折叠卡默认只开第一组 · 窄屏响应式已适配 · 外观主题预设已按设计稿 v1.1 移除
      </p>
    </div>
  );
}
