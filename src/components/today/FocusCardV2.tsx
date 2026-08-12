"use client";

import { useEffect, useMemo, useRef, useState } from "react";

/* ═══════════════════════════════════════════════════════════════
   FocusCardV2 — Today 启动台核心卡（规格 docs/FocusCard-V2-UI设计规格.html + UI示例/FocusCard-V2-UI副本.html）
   · 5 区自上而下：A 动机行（紫）→ B 行动区（标题+主按钮）→ C 执行工具（类型专属）→ D 回来确认 → E 元信息行
   · 4 态状态机：未出发 → 出发中 → 回来确认 → 已完成（点出发记 departureAt mock）
   · 5 类型：timer 固定时间 / checklist 清单 / learning 学习 / accum-daily 积累·每日 / accum-weekly 积累·频次
   · 执行清单对齐 v2-memo token：底 #fff9e6 / 左边条 #f5a623 / 标题字 #8b6914 / 勾选框 #d4a853 + 小标题虚线分隔
   · 宽度策略：单栏 min-width 420px；视口 ≥860px 两栏（动机行横跨顶部）；timer/learning 可收窄 360px
   · purpose / departureAt 本轮 mock（待后端 Task.purpose / Task.departureAt）
   ═══════════════════════════════════════════════════════════════ */

export type FcV2Phase = "unstarted" | "going" | "confirm" | "done";
export type FcV2Type = "timer" | "checklist" | "learning" | "accum-daily" | "accum-weekly";

export interface FocusCardV2Item { id: string; text: string; done: boolean; minutes?: number }
export interface FocusCardV2Data {
  id: string;
  type: FcV2Type;
  title: string;
  parent: string;
  purpose?: string;                 // A 动机行（FCV2：直读后端 Task.purpose 继承后值）
  departureAt?: string | null;      // 出发时刻（FCV2：后端 Task.departureAt）
  phase: FcV2Phase;
  // 时间
  scheduledStart?: string | null; scheduledEnd?: string | null; location?: string;
  plannedMinutes: number; elapsedMinutes: number; remainingMinutes?: number; progress: number;
  // 清单（checklist/learning）
  items?: FocusCardV2Item[];
  // 项目阶段（左栏数据区 · 副本 c2-stage-list；真实数据待项目树 API）
  stages?: { name: string; done?: boolean; current?: boolean }[];
  projectProgress?: { done: number; total: number };
  // 积累
  streak?: { current: number; longest: number };
  weekTarget?: number; weekCount?: number; monthCount?: number; monthTotalDays?: number; totalMinutes?: number;
  weekDates?: string[];             // 频次型本周打卡日期
  monthDates?: string[];            // 积累·每日 当月打卡日期 YYYY-MM-DD（收尾批次 D：后端 accumStats 透传）
  aiHint?: string;                  // AI 提醒/执行条
  description?: string | null;
}

interface Props {
  card: FocusCardV2Data;
  /** 真实动作钩子（Today 主卡传入；演示区不传 → 内部模拟）
   *  FCV2 对接：onStart → action start（后端写 departureAt）
   *             onComplete(min) → action complete + durationMinutes（补记）
   *             onCheckin(detail) → checkin + detail（打卡内容）
   *             onPause(reason) → action pause（UserObservation） */
  onStart?: () => void;
  onComplete?: (durationMinutes?: number) => void;
  onItemToggle?: (itemId: string) => void;
  /** P1-11：清单新增项（今日页 → POST /api/tasks 建子任务；不传则隐藏加号） */
  onItemAdd?: (title: string) => void;
  onCheckin?: (detail?: string) => void;
  onSkip?: () => void;
  onPause?: (reason: string) => void;
  /** 收尾批次 A2：明天继续（复制最近排期时段到明天） */
  onContinueTomorrow?: () => void;
  busy?: boolean;
  /** 演示模式：允许点按钮切换状态（不依赖后端） */
  demo?: boolean;
}

/* ── 类型元数据 ── */
const TYPE_TAG: Record<FcV2Type, { label: string; cls: string }> = {
  timer: { label: "固定时间", cls: "bg-[var(--v2-brand-bg)] text-[var(--v2-brand-deep)]" },
  checklist: { label: "清单型", cls: "bg-[#fff0e6] text-[#c2410c]" },
  learning: { label: "学习型", cls: "bg-[var(--v2-purple-bg)] text-[var(--v2-purple)]" },
  "accum-daily": { label: "积累·每日", cls: "bg-[#ecfdf5] text-[#059669]" },
  "accum-weekly": { label: "积累·频次", cls: "bg-[#ecfeff] text-[#0891b2]" },
};
const TYPE_COLOR: Record<FcV2Type, string> = {
  timer: "#4338ca", checklist: "#c2410c", learning: "#7c3aed", "accum-daily": "#059669", "accum-weekly": "#0891b2",
};
const LIST_TITLE: Record<FcV2Type, string> = { checklist: "执行清单", learning: "知识点", "accum-weekly": "今日动作", timer: "", "accum-daily": "" };

/* 收尾批次 D：当月小日历（accum-daily · 周一开头 7 列） */
function MonthCal({ monthDates }: { monthDates?: string[] }) {
  const now = new Date();
  const y = now.getFullYear();
  const m = now.getMonth();
  const daysInMonth = new Date(y, m + 1, 0).getDate();
  const firstDow = (new Date(y, m, 1).getDay() + 6) % 7; // 周一=0
  const today = now.getDate();
  const set = new Set(monthDates ?? []);
  const cells: React.ReactNode[] = [];
  for (let i = 0; i < firstDow; i++) cells.push(<span key={`p${i}`} className="w-[22px] h-[22px]" />);
  for (let d = 1; d <= daysInMonth; d++) {
    const ds = `${y}-${String(m + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    const checked = set.has(ds);
    const isToday = d === today;
    cells.push(
      <span
        key={d}
        className={`w-[22px] h-[22px] rounded-full flex items-center justify-center text-[9.5px] tabular-nums ${
          checked
            ? "bg-[var(--v2-brand-gold)] text-white font-semibold"
            : isToday
              ? "border border-[var(--v2-brand)] text-[var(--v2-brand-deep)] font-medium"
              : "text-[var(--v2-text3)]"
        }`}
        title={checked ? `${ds} 已打卡` : ds}
      >{d}</span>
    );
  }
  return (
    <div>
      <div className="flex items-center justify-between mt-2 mb-1">
        <span className="text-[9.5px] text-[var(--v2-text3)]">本月 {y} 年 {m + 1} 月</span>
        <span className="text-[9px] text-[var(--v2-text3)]">打卡 {monthDates?.length ?? 0} 天</span>
      </div>
      <div className="grid grid-cols-7 gap-[3px] justify-items-center">{cells}</div>
    </div>
  );
}
const PAUSE_REASONS = ["太难了", "注意力下降", "临时有事", "估时错误", "其他"];

/* ── 补记时长弹窗 ── */
function DurationModal({ departureAt, onConfirm, onClose }: { departureAt: string | null; onConfirm: (min: number) => void; onClose: () => void }) {
  const defaultMin = useMemo(() => {
    if (!departureAt) return 30;
    const diff = Math.round((Date.now() - new Date(departureAt).getTime()) / 60000);
    return Math.max(1, diff);
  }, [departureAt]);
  const [sel, setSel] = useState<number | "custom">(defaultMin <= 60 ? defaultMin : "custom");
  const [custom, setCustom] = useState(String(defaultMin));
  const depLabel = departureAt ? new Date(departureAt).toTimeString().slice(0, 5) : "--:--";
  return (
    <Modal title="刚才做了多久？" onClose={onClose}>
      <div className="text-sm text-[var(--v2-text2)]">从 <b className="text-[var(--v2-text)]">{depLabel}</b> 出发 · 默认按到现在计算</div>
      <div className="flex gap-2 mt-2.5">
        {[30, 60].map((m) => (
          <button key={m} onClick={() => setSel(m)}
            className={`flex-1 text-center border-[1.5px] rounded-lg py-2 text-sm font-semibold transition ${sel === m ? "border-[var(--v2-brand)] bg-[var(--v2-brand-bg)] text-[var(--v2-brand-deep)]" : "border-[var(--v2-border)] text-[var(--v2-text2)]"}`}>
            {m === 30 ? "30 分钟" : "1 小时"}
          </button>
        ))}
        <button onClick={() => setSel("custom")}
          className={`flex-1 text-center border-[1.5px] rounded-lg py-2 text-sm font-semibold transition ${sel === "custom" ? "border-[var(--v2-brand)] bg-[var(--v2-brand-bg)]" : "border-[var(--v2-border)]"}`}>
          <input value={custom} onChange={(e) => { setCustom(e.target.value); setSel("custom"); }}
            onClick={(e) => e.stopPropagation()}
            className="w-10 bg-transparent outline-none text-center text-sm font-semibold text-[var(--v2-text)]" placeholder="45" /> 分
        </button>
      </div>
      <div className="text-[10px] text-[var(--v2-text3)] mt-2">默认 = 现在 − 出发时刻，可修改</div>
      <ModalFoot onOk={() => onConfirm(sel === "custom" ? Math.max(1, Number(custom) || 1) : sel)} onCancel={onClose} okText="确定" />
    </Modal>
  );
}

/* ── 暂停原因弹窗 ── */
function PauseModal({ onConfirm, onClose }: { onConfirm: (reason: string) => void; onClose: () => void }) {
  const [sel, setSel] = useState(PAUSE_REASONS[0]);
  return (
    <Modal title="为什么暂停？" onClose={onClose}>
      <ul className="mt-1.5">
        {PAUSE_REASONS.map((r) => (
          <li key={r} onClick={() => setSel(r)}
            className={`flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-sm cursor-pointer transition ${sel === r ? "bg-[var(--v2-brand-bg)] text-[var(--v2-brand-deep)] font-medium" : "text-[var(--v2-text2)]"}`}>
            <span className={`w-3.5 h-3.5 rounded-full border-[1.5px] flex items-center justify-center shrink-0 ${sel === r ? "border-[var(--v2-brand)]" : "border-[var(--v2-border)]"}`}>
              {sel === r && <span className="w-2 h-2 rounded-full bg-[var(--v2-brand)]" />}
            </span>
            {r}
          </li>
        ))}
      </ul>
      <div className="text-[10px] text-[var(--v2-text3)] mt-1.5">记录为暂停观察（UserObservation · Rule9 已有链路）</div>
      <ModalFoot onOk={() => onConfirm(sel)} onCancel={onClose} okText="确定" />
    </Modal>
  );
}

/* ── 打卡内容输入（积累·每日） ── */
function CheckinModal({ card, onConfirm, onClose }: { card: FocusCardV2Data; onConfirm: (detail: string) => void; onClose: () => void }) {
  const [v, setV] = useState("");
  return (
    <Modal title={`打卡 · ${card.title}`} onClose={onClose}>
      <input value={v} onChange={(e) => setV(e.target.value)} placeholder={card.type === "accum-daily" ? "今天背了哪些词？（可空）" : "今日完成情况（可空）"}
        className="w-full border-[1.5px] border-[var(--v2-border)] rounded-lg px-3 py-2.5 text-sm outline-none focus:border-[var(--v2-brand)]" />
      <div className="text-[10px] text-[var(--v2-text3)] mt-2">填写内容 → TimeLog.detail · Review 可回顾「这周打卡了：xxx」</div>
      <ModalFoot onOk={() => onConfirm(v.trim())} onCancel={onClose} okText="打卡完成" />
    </Modal>
  );
}

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-[130] flex items-center justify-center bg-black/30 px-4" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-[0_12px_32px_rgba(16,24,40,0.16)] w-full max-w-[340px] overflow-hidden" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-4 py-3 text-sm font-semibold text-[var(--v2-text)]">
          <span>{title}</span>
          <button onClick={onClose} className="text-[var(--v2-text3)] hover:text-[var(--v2-text)] text-[15px] leading-none">✕</button>
        </div>
        <div className="px-4 pb-3">{children}</div>
      </div>
    </div>
  );
}
function ModalFoot({ onOk, onCancel, okText = "确定" }: { onOk: () => void; onCancel: () => void; okText?: string }) {
  return (
    <div className="flex gap-2 mt-3">
      <button onClick={onOk} className="flex-1 text-sm font-semibold rounded-lg py-2 bg-[var(--v2-brand)] text-white hover:bg-[var(--v2-brand-deep)] transition">{okText}</button>
      <button onClick={onCancel} className="flex-1 text-sm font-semibold rounded-lg py-2 bg-[var(--color-gray-100)] text-[var(--v2-text2)] hover:bg-[var(--color-gray-200)] transition">取消</button>
    </div>
  );
}

/* ── 清单（v2-memo 样式：底 #fff9e6 / 左边条 #f5a623 / 标题字 #8b6914 / 勾选框 #d4a853 + 小标题虚线） ── */
function MemoList({ card, onItemToggle, onItemAdd, going }: { card: FocusCardV2Data; onItemToggle?: (id: string) => void; onItemAdd?: (title: string) => void; going: boolean }) {
  const items = card.items ?? [];
  const nextIdx = items.findIndex((it) => !it.done);
  const title = LIST_TITLE[card.type];
  // P1-11：加号展开 inline 输入 → 回车/确定提交（标题空或重复时不提交）
  const [adding, setAdding] = useState(false);
  const [addTitle, setAddTitle] = useState("");
  const addInputRef = useRef<HTMLInputElement>(null);
  const submitAdd = () => {
    const v = addTitle.trim();
    if (!v) return;
    onItemAdd?.(v);
    setAddTitle("");
    setAdding(false);
  };
  return (
    <div className="rounded-lg mt-1.5" style={{ background: "#fff9e6", borderLeft: "3px solid #f5a623", padding: "7px 6px" }}>
      <div className="flex items-center text-[10.5px] font-semibold tracking-[0.3px] px-1 pb-1.5 mb-1" style={{ color: "#8b6914", borderBottom: "1px dashed rgba(139,105,20,0.3)" }}>
        <span>{title}</span>
        {onItemAdd && (
          <button
            onClick={() => { setAdding((v) => !v); if (!adding) setTimeout(() => addInputRef.current?.focus(), 0); }}
            className="ml-auto w-[18px] h-[18px] rounded flex items-center justify-center text-[12px] leading-none transition"
            style={{ color: "#8b6914", background: "rgba(245,166,35,0.12)" }}
            title={`新增${title}项`}
          >＋</button>
        )}
      </div>
      {adding && (
        <div className="flex items-center gap-1.5 px-1 pb-1.5">
          <input
            ref={addInputRef}
            value={addTitle}
            onChange={(e) => setAddTitle(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") { e.preventDefault(); submitAdd(); }
              if (e.key === "Escape") { setAdding(false); setAddTitle(""); }
            }}
            onBlur={() => { if (!addTitle.trim()) setAdding(false); }}
            placeholder={`新增一项…`}
            maxLength={100}
            className="flex-1 min-w-0 px-2 py-1 text-[12px] rounded border outline-none bg-white"
            style={{ borderColor: "#f5a623", color: "var(--v2-text)" }}
          />
          <button
            onClick={submitAdd}
            disabled={!addTitle.trim()}
            className="text-[11px] font-semibold px-2 py-1 rounded disabled:opacity-40 transition"
            style={{ background: "#f5a623", color: "#fff" }}
          >确定</button>
        </div>
      )}
      {items.length === 0 && !adding ? (
        <div className="text-sm px-2 py-2 text-[var(--v2-text3)]">暂无{title} · 点右上「＋」拆成小节</div>
      ) : (
        <ul className="space-y-[2px]">
          {items.map((it, i) => {
            const isNext = i === nextIdx;
            return (
              <li key={it.id} className="flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm" style={{ background: "rgba(255,255,255,0.55)", ...(isNext && going ? { background: "var(--v2-brand-bg)", borderLeft: "4px solid var(--v2-brand)", fontWeight: 600, color: "var(--v2-text)" } : {}), ...(it.done ? { color: "var(--v2-text3)", opacity: 0.65 } : {}) }}>
                <button
                  onClick={() => onItemToggle?.(it.id)}
                  disabled={!onItemToggle}
                  className="w-[15px] h-[15px] rounded flex items-center justify-center shrink-0 transition"
                  style={{ border: `1.5px solid ${it.done ? "#16a34a" : isNext && going ? "var(--v2-brand)" : "#d4a853"}`, background: it.done ? "#16a34a" : "#fff" }}>
                  {it.done && <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3"><polyline points="20 6 9 17 4 12" /></svg>}
                </button>
                <span className={it.done ? "line-through" : ""} style={{ color: it.done ? "var(--v2-text3)" : undefined }}>{it.text}</span>
                {it.minutes != null && <span className="ml-auto text-[10px] tabular-nums text-[var(--v2-text3)]">{it.minutes}分</span>}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

/* ── 主组件 ── */
export function FocusCardV2({ card, onStart, onComplete, onItemToggle, onItemAdd, onCheckin, onSkip, onPause, onContinueTomorrow, busy, demo }: Props) {
  // 内部状态机：demo 模式或真实卡（出发/暂停为本地模拟）
  // 收尾批次 B：忘记确认提示条（session 级关闭，不持久化）
  const [reminderDismissed, setReminderDismissed] = useState(false);
  const [phase, setPhase] = useState<FcV2Phase>(card.phase);
  const [departureAt, setDepartureAt] = useState<string | null>(card.departureAt ?? null);
  const [durModal, setDurModal] = useState(false);
  const [pauseModal, setPauseModal] = useState(false);
  const [checkinModal, setCheckinModal] = useState(false);
  const [checkinDetail, setCheckinDetail] = useState("");
  const [doneFlash, setDoneFlash] = useState(false);

  // 收尾批次 B：忘记确认提醒（出发 ≥4 小时未确认 · 未完成）
  const departedHours = departureAt ? Math.floor((Date.now() - new Date(departureAt).getTime()) / 3600000) : 0;
  const needReminder = !reminderDismissed && !!departureAt && phase !== "done" && departedHours >= 4;

  // 卡片 prop 变化（如真实数据刷新）→ 同步 phase
  useEffect(() => { setPhase(card.phase); }, [card.phase]);
  useEffect(() => { setDepartureAt(card.departureAt ?? null); }, [card.departureAt]);

  const isAccum = card.type === "accum-daily" || card.type === "accum-weekly";
  const isTimer = card.type === "timer";
  const isList = card.type === "checklist" || card.type === "learning";

  const go = () => {
    const now = new Date().toISOString();
    setDepartureAt(now);
    setPhase("going");
    // FCV2 对接：真实卡 → action start（后端写 Task.departureAt）；演示区内部模拟
    if (onStart) { onStart(); return; }
  };
  const finishFlow = () => {
    // 回来确认：非积累型弹补记时长；积累型弹打卡输入
    if (isAccum) { setCheckinModal(true); return; }
    setDurModal(true);
  };
  const confirmDuration = (min: number) => {
    setDurModal(false);
    setDoneFlash(true);
    setPhase("done");
    // FCV2 对接：真实卡 → action complete + durationMinutes（补记时长）
    onComplete?.(min);
    setTimeout(() => setDoneFlash(false), 600);
  };
  const confirmCheckin = (detail: string) => {
    setCheckinModal(false);
    setCheckinDetail(detail);
    setDoneFlash(true);
    setPhase("done");
    // FCV2 对接：真实卡 → checkin + detail（打卡内容存 TimeLog.detail）
    onCheckin?.(detail);
    setTimeout(() => setDoneFlash(false), 600);
  };
  const pauseConfirm = (reason: string) => {
    setPauseModal(false);
    setPhase("unstarted");
    // FCV2 对接：真实卡 → action pause（UserObservation 落库）；演示区 console
    if (onPause) { onPause(reason); return; }
    console.log("[FocusCardV2] pause reason:", reason);
  };
  const skip = () => { if (demo) setPhase("unstarted"); onSkip?.(); };

  const going = phase === "going";
  const done = phase === "done";
  const meta = TYPE_TAG[card.type];
  const color = TYPE_COLOR[card.type];
  const nextIdx = (card.items ?? []).findIndex((it) => !it.done);
  const doneCount = (card.items ?? []).filter((it) => it.done).length;
  const totalCount = (card.items ?? []).length || 1;
  const depLabel = departureAt ? new Date(departureAt).toTimeString().slice(0, 5) : null;
  // P1-2：无排期不显示「预计 0 分钟」→ 待排期（灰字弱化）；未开始且 0 用时 → 「—」
  const plannedLabel = card.plannedMinutes > 0 ? `${card.plannedMinutes} 分钟` : null;
  const elapsedLabel = card.elapsedMinutes > 0 ? `${card.elapsedMinutes} 分钟` : going ? "0 分钟" : "—";

  const mainBtn = done
    ? { text: "已完成 ✓", cls: "bg-[#d1d5db] text-[#6b7280] cursor-default" }
    : phase === "confirm"
      ? { text: isAccum ? "打卡" : "完成", cls: "bg-[var(--v2-brand)] text-white hover:bg-[var(--v2-brand-deep)]", action: finishFlow }
      : going
        ? { text: "进行中…", cls: "bg-[var(--v2-brand)] text-white opacity-85" }
        : { text: isTimer ? "完成" : "出发", cls: `bg-[var(--v2-brand)] text-white hover:bg-[var(--v2-brand-deep)]`, action: isTimer ? finishFlow : go };

  const stateTag = done
    ? { txt: "已完成", cls: "bg-[#ecfdf5] text-[#059669]" }
    : phase === "confirm" || going
      ? { txt: isTimer ? "自动计时" : "进行中", cls: "bg-[var(--v2-brand-bg)] text-[var(--v2-brand-deep)]" }
      : { txt: "未出发", cls: "bg-[#f3f4f6] text-[var(--v2-text3)]" };

  return (
    /* 全宽与页面其他卡片对齐（规格宽度策略：单栏 min 420px / timer·learning 360px，窄屏 min(px,100%) 防溢出；两栏由视口 ≥860px 控制） */
    <div className="w-full" style={{ minWidth: card.type === "timer" || card.type === "learning" ? "min(360px, 100%)" : "min(420px, 100%)" }}>
      <div className="bg-white rounded-[14px] border border-[var(--v2-border)] overflow-hidden shadow-[0_1px_3px_rgba(16,24,40,0.05)]" style={doneFlash ? { boxShadow: "0 0 0 2px #16a34a" } : undefined}>
        {/* A 动机行（紫 · 横跨两栏顶部 · V3 §7.1：11.5px → 12.5px） */}
        <div className="flex items-center gap-2 px-4 py-[7px] text-[13px]" style={{ background: "var(--v2-purple-bg)", color: "#7c3aed", borderBottom: "1px solid #ede9fe" }}>
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="#7c3aed" strokeWidth="2" className="shrink-0"><circle cx="12" cy="12" r="9" /><circle cx="12" cy="12" r="4.5" /><circle cx="12" cy="12" r="1" fill="#7c3aed" /></svg>
          <span className="min-w-0 truncate">{card.purpose || (isList ? "清单型 · 做产品/项目" : isTimer ? "固定时间 · 到点自动完成" : isAccum ? "积累型 · 每天坚持" : "学习型 · 学书本知识")}</span>
        </div>

        {/* 收尾批次 B：忘记确认警示条（出发 ≥4 小时未确认 · 琥珀底 + 金左边条） */}
        {needReminder && (
          <div className="flex items-center gap-2.5 px-4 py-2.5 text-[13px]" style={{ background: "#FFFBEB", borderLeft: "3px solid var(--v2-brand-gold)", borderBottom: "1px solid #fde68a" }}>
            <span className="shrink-0">⏰</span>
            <span className="text-[var(--v2-text)] min-w-0 flex-1">已出发 <b className="text-[#b45309]">{departedHours}</b> 小时没回来确认 —— 做完了？</span>
            <button onClick={finishFlow} className="text-[12px] font-semibold px-3 py-1.5 rounded-lg bg-[var(--v2-brand)] text-white hover:bg-[var(--v2-brand-deep)] transition shrink-0">补记完成</button>
            <button onClick={() => setReminderDismissed(true)} className="text-[12px] font-semibold px-3 py-1.5 rounded-lg bg-white text-[var(--v2-text2)] border border-[#fde68a] hover:bg-[var(--v2-brand-bg)] transition shrink-0">还在做，继续</button>
          </div>
        )}

        {/* 两栏主体：≥860px 两栏（媒体查询），否则单栏（单栏时右栏 order:1 在前，左栏 order:3 沉底） */}
        <div className="fcv2-grid">
          {/* ═══ 左栏 · 数据区（副本 col2-left 灰底）：归属 + 项目阶段 + 时段/预计 + AI ═══ */}
          <div className="fcv2-left px-4 py-3 space-y-2.5 min-w-0">
            <div>
              <div className="text-[9px] tracking-[0.4px] text-[var(--v2-text3)] mb-0.5">所属项目</div>
              <div className="text-[15px] font-semibold text-[var(--v2-text)]">{card.parent}</div>
            </div>

            {/* 项目阶段（副本 c2-proj-progress + c2-stage-list） */}
            {isList && card.stages && card.stages.length > 0 && (
              <div>
                {card.projectProgress && (
                  <div className="mb-1.5">
                    <div className="flex justify-between text-[9.5px] text-[var(--v2-text3)] mb-0.5">
                      <span>项目进度</span><b className="text-[var(--v2-text2)]">{card.projectProgress.done}/{card.projectProgress.total} 阶段</b>
                    </div>
                    <div className="h-1 rounded-full bg-[#f1f5f9] overflow-hidden">
                      <div className="h-full rounded-full bg-[var(--v2-brand)]" style={{ width: `${Math.round((card.projectProgress.done / card.projectProgress.total) * 100)}%` }} />
                    </div>
                  </div>
                )}
                <div className="text-[9px] tracking-[0.4px] text-[var(--v2-text3)] mb-1">项目阶段</div>
                <ul className="space-y-px">
                  {card.stages.map((s) => (
                    <li key={s.name} className={`flex items-center gap-1.5 text-[10.5px] px-1.5 py-1 rounded-md ${
                      s.current ? "bg-[var(--v2-brand-bg)] border-l-[3px] border-[var(--v2-brand)] font-semibold text-[var(--v2-text)] text-[11.5px]" :
                      s.done ? "line-through text-[var(--v2-text3)]" : "text-[var(--v2-text2)]"
                    }`}>
                      {s.done && <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><polyline points="20 6 9 17 4 12" /></svg>}
                      {!s.done && !s.current && <span className="w-[9px]" />}
                      {s.current && <span className="w-[9px] h-[9px] rounded-full border-[1.5px] border-[var(--v2-brand)] shrink-0" />}
                      <span className="truncate">{s.name}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {isList && (!card.stages || card.stages.length === 0) && (
              <div className="text-[10px] text-[var(--v2-text3)]">项目阶段 · 未挂载项目树</div>
            )}

            <div className="h-px bg-[#f0f0f0]" />

            {/* 元信息（副本 c2-meta-line） */}
            <div className="text-[10.5px] text-[var(--v2-text3)] space-y-0.5">
              {isTimer && card.scheduledStart && (
                <div><b className="text-[var(--v2-text2)]">时段</b> {new Date(card.scheduledStart).toTimeString().slice(0, 5)} - {card.scheduledEnd ? new Date(card.scheduledEnd).toTimeString().slice(0, 5) : "--"}</div>
              )}
              {isTimer && card.location && <div><b className="text-[var(--v2-text2)]">地点</b> {card.location}</div>}
              <div><b className="text-[var(--v2-text2)]">预计</b> {plannedLabel ?? <span className="text-[var(--v2-text3)]">待排期</span>}</div>
              <div><b className="text-[var(--v2-text2)]">已用</b> {elapsedLabel}</div>
            </div>

            {/* 积累统计（副本两栏：统计三格在左栏） */}
            {isAccum && (
              <div className="grid grid-cols-3 gap-2">
                <div className="text-center rounded-lg py-2 bg-[#fffbeb] border border-[#fde68a]">
                  <div className="text-lg font-semibold tabular-nums text-[#b45309]">{card.streak?.current ?? 0} 天</div>
                  <div className="text-[10px] text-[var(--v2-text3)] mt-0.5">{card.type === "accum-daily" ? "连续天数" : "本周完成"}</div>
                </div>
                <div className="text-center rounded-lg py-2 bg-[#eff6ff] border border-[#bfdbfe]">
                  <div className="text-lg font-semibold tabular-nums text-[#2563eb]">{card.streak?.longest ?? 0} 天</div>
                  <div className="text-[10px] text-[var(--v2-text3)] mt-0.5">最长记录</div>
                </div>
                <div className="text-center rounded-lg py-2 bg-[#f0fdf4] border border-[#bbf7d0]">
                  <div className="text-lg font-semibold tabular-nums text-[#16a34a]">{card.type === "accum-daily" ? `${card.weekCount ?? 0}/7` : `${card.weekCount ?? 0}/${card.weekTarget ?? 1}`}</div>
                  <div className="text-[10px] text-[var(--v2-text3)] mt-0.5">{card.type === "accum-daily" ? "本周打卡" : "本周目标"}</div>
                </div>
              </div>
            )}
            {card.type === "accum-weekly" && (
              <div className="flex items-center gap-2">
                <span className="text-[10.5px] text-[var(--v2-text3)]">周目标 <b className="text-[var(--v2-text2)]">{card.weekCount ?? 0}/{card.weekTarget ?? 1}</b></span>
                <div className="flex gap-1 ml-auto">
                  {(card.weekDates ?? []).map((d, i) => (
                    <span key={d} className="w-4 h-4 rounded-full text-[8px] flex items-center justify-center font-semibold" style={i < (card.weekCount ?? 0) ? { background: "#0891b2", color: "#fff" } : { border: "1px solid var(--v2-border)", color: "var(--v2-text3)" }}>{i + 1}</span>
                  ))}
                </div>
              </div>
            )}
            {card.type === "accum-daily" && <div className="text-[10px] text-[var(--v2-text3)]"><b className="text-[var(--v2-text2)]">频率</b> 每日</div>}
            {/* 收尾批次 D：当月小日历（accum-daily · 打卡日金点 / 今天品牌描边） */}
            {card.type === "accum-daily" && <MonthCal monthDates={card.monthDates} />}

            {/* AI 条（副本 c2-ai） */}
            {card.aiHint && (
              <div className="flex items-center gap-1.5 text-[10px] text-[#7c3aed] bg-[var(--v2-purple-bg)] rounded-md px-2 py-1.5">
                <span className="font-semibold text-[8.5px] shrink-0">{isAccum ? "AI 提醒" : "AI 执行"}</span>
                <span className="min-w-0">{card.aiHint}</span>
              </div>
            )}
          </div>

          {/* ═══ 右栏 · 执行区（副本 col2-right 白底）：任务名称 + 执行工具 + 确认 ═══ */}
          <div className="fcv2-right px-4 py-3 min-w-0">
            {/* B 行动区 */}
            <div className="flex items-center justify-between gap-2.5">
              <h3 className="text-[22px] font-bold tracking-[-0.3px] text-[var(--v2-text)] leading-[1.3] min-w-0">{card.title}</h3>
              <div className="flex items-center gap-1.5 shrink-0">
                <span className={`text-[9.5px] font-semibold px-2 py-0.5 rounded-full ${meta.cls}`}>{meta.label}</span>
                {going && !isTimer && (
                  <button onClick={() => setPauseModal(true)} className="text-sm font-semibold rounded-lg px-3 py-2 bg-[#f3f4f6] text-[var(--v2-text3)] hover:bg-[var(--color-gray-200)] transition shrink-0">暂停</button>
                )}
                {!done && (
                  <>
                    {/* 收尾批次 A2：明天继续（未出发/进行中态 · 次级弱化样式） */}
                    {(phase === "unstarted" || phase === "going") && onContinueTomorrow && (
                      <button onClick={onContinueTomorrow} disabled={busy} className="text-sm font-semibold rounded-lg px-3 py-2.5 min-h-[44px] bg-white text-[var(--v2-brand)] border border-[var(--v2-brand)] hover:bg-[var(--v2-brand-bg)] transition shrink-0 disabled:opacity-50">明天继续</button>
                    )}
                    <button onClick={mainBtn.action} disabled={busy} className={`text-sm font-semibold rounded-lg px-4 py-2.5 min-h-[44px] transition shrink-0 disabled:opacity-50 ${mainBtn.cls}`}>
                      {busy ? "处理中…" : mainBtn.text}
                    </button>
                  </>
                )}
                {done && (
                  <button disabled className={`text-sm font-semibold rounded-lg px-4 py-2.5 min-h-[44px] shrink-0 ${mainBtn.cls}`}>{mainBtn.text}</button>
                )}
              </div>
            </div>
            <div className="flex items-center gap-1.5 mt-1">
              <span className={`text-[9.5px] font-semibold px-2 py-0.5 rounded-full ${stateTag.cls}`}>{stateTag.txt}</span>
              {depLabel && <span className="text-[10px] text-[var(--v2-text3)]">从 {depLabel} 出发{demo ? "（mock departureAt）" : ""}</span>}
            </div>

            {/* ═══ C 执行工具（副本 col2-right：任务名称下即清单/时间块/打卡） ═══ */}
            {isTimer && (
              <div className="mt-2">
                <div className="flex items-baseline gap-2">
                  <span className="text-[26px] font-bold tabular-nums tracking-[-0.5px] text-[var(--v2-text)]">{card.scheduledStart ? new Date(card.scheduledStart).toTimeString().slice(0, 5) : "--:--"}</span>
                  <span className="text-[13px] text-[var(--v2-text2)]">— {card.scheduledEnd ? new Date(card.scheduledEnd).toTimeString().slice(0, 5) : "--:--"}</span>
                </div>
                <div className="flex items-center justify-between mt-1.5">
                  <span className="inline-flex items-center gap-1 text-[9.5px] text-[#059669] bg-[#ecfdf5] rounded-full px-2 py-0.5 font-medium"><svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="#059669" strokeWidth="2.5"><polyline points="20 6 9 17 4 12" /></svg>到点自动完成</span>
                  <span className="text-[10px] text-[var(--v2-text3)]">进度 {card.progress}%{going ? ` · 剩余 ${card.remainingMinutes ?? 0} 分` : ""}</span>
                </div>
                <div className="h-[5px] rounded-full bg-[#f1f5f9] overflow-hidden mt-1.5">
                  <div className="h-full rounded-full" style={{ width: `${card.progress}%`, background: color }} />
                </div>
              </div>
            )}

            {isList && (
              <div className="mt-2">
                <div className="flex items-center text-[10.5px] text-[var(--v2-text3)]">
                  {card.type === "checklist" ? "执行清单" : "知识点"} <b className="text-[var(--v2-text2)] ml-1.5">{doneCount}/{totalCount} {card.type === "checklist" ? "已完成" : "已学"}</b>
                  <span className="ml-auto">总耗时 {elapsedLabel}</span>
                </div>
                <div className="h-[5px] rounded-full bg-[#f1f5f9] overflow-hidden mt-1">
                  <div className="h-full rounded-full" style={{ width: `${(doneCount / totalCount) * 100}%`, background: color }} />
                </div>
                {/* 执行清单（v2-memo）——始终在右栏执行区 */}
                <MemoList card={card} onItemToggle={onItemToggle} onItemAdd={onItemAdd} going={going} />
              </div>
            )}

            {card.type === "accum-weekly" && (
              <div className="mt-2">
                <div className="flex items-center text-[10.5px] text-[var(--v2-text3)] mb-1">今日练 <b className="text-[var(--v2-text2)] ml-1">{(card.items ?? []).length} 个动作</b></div>
                <MemoList card={card} onItemToggle={onItemToggle} onItemAdd={onItemAdd} going={going} />
              </div>
            )}

            {/* D 回来确认 */}
            <div className="mt-2.5">
              {done ? (
                <div className="flex items-center gap-2 text-[11px] text-[var(--v2-text3)] bg-[#f8fafc] rounded-lg px-3 py-2 border border-dashed border-[var(--v2-border)]">
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#16a34a" strokeWidth="2.5"><polyline points="20 6 9 17 4 12" /></svg>
                  {isAccum ? (checkinDetail ? `已打卡 · ${checkinDetail}` : "已打卡 ✓") : "已完成 ✓"} · 已记 {elapsedLabel}
                </div>
              ) : going || phase === "confirm" ? (
                isAccum ? (
                  <div className="space-y-1.5">
                    <button onClick={finishFlow} className="w-full text-sm font-semibold rounded-lg py-2 bg-[var(--v2-brand)] text-white hover:bg-[var(--v2-brand-deep)] transition">打卡</button>
                    <div className="text-[10px] text-[var(--v2-text3)] text-center">{card.type === "accum-daily" ? "打卡时弹「今天背了哪些词？」（可选）→ 存 TimeLog.detail" : "勾选内容存 TimeLog.detail · 默认全勾可改"}</div>
                  </div>
                ) : (
                  <div className="space-y-1.5">
                    <div className="flex gap-2">
                      <button onClick={finishFlow} className="flex-1 text-sm font-semibold rounded-lg py-2 bg-[var(--v2-brand)] text-white hover:bg-[var(--v2-brand-deep)] transition">该项完成</button>
                      <button onClick={skip} className="flex-1 text-sm font-semibold rounded-lg py-2 bg-[#f3f4f6] text-[var(--v2-text3)] hover:bg-[var(--color-gray-200)] transition">{demo ? "跳过" : "跳过后一项"}</button>
                    </div>
                    <div className="text-[10px] text-[var(--v2-text3)] text-center">完成该项 → 自动高亮下一项 · 回来弹补记时长</div>
                  </div>
                )
              ) : (
                <div className="flex items-center gap-2 text-[11px] text-[var(--v2-text3)] bg-[#f8fafc] rounded-lg px-3 py-2 border border-dashed border-[var(--v2-border)]">
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#9ca3af" strokeWidth="2"><path d="M12 16v-4m0-4h.01M12 22a10 10 0 100-20 10 10 0 000 20z" /></svg>
                  {isTimer ? "到点自动完成 · 提前结束可手动完成" : "出发后回来点「该项完成」→ 自动高亮下一节"}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* E 元信息行 */}
        <div className="flex items-center gap-1.5 flex-wrap px-4 py-2.5 border-t border-[#f1f5f9] text-[10.5px] text-[var(--v2-text3)]">
          <span>{card.parent}</span><span className="text-[#e5e7eb]">·</span>
          <span>{plannedLabel ? `预计 ${plannedLabel}` : "待排期"}</span><span className="text-[#e5e7eb]">·</span>
          <span>已用 {elapsedLabel}</span>
          {card.description ? <><span className="text-[#e5e7eb]">·</span><span className="min-w-0 truncate max-w-[160px]">{card.description}</span></> : null}
        </div>
      </div>

      {/* 弹窗 */}
      {durModal && <DurationModal departureAt={departureAt} onConfirm={confirmDuration} onClose={() => setDurModal(false)} />}
      {pauseModal && <PauseModal onConfirm={pauseConfirm} onClose={() => setPauseModal(false)} />}
      {checkinModal && <CheckinModal card={card} onConfirm={confirmCheckin} onClose={() => setCheckinModal(false)} />}
    </div>
  );
}
