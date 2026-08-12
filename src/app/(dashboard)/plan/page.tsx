"use client";

import { useEffect, useState, useCallback } from "react";
import { DOMAINS, normalizeCategory, resolveTheme, THEMES } from "@/lib/plan/colors";
import { ThemeBadge } from "@/components/task/ThemeBadge";
import { realTimeToVisualTime } from "@/lib/plan/time";
import { localDateStr } from "@/lib/date";
import { timeStateLabel } from "@/lib/task/time-state";

/* ═══════════════════════════════════════════
   Plan · V2 视觉语言（V3 前端先行：主题徽章 + 图例主题 + 重叠分列）
   · 数据源：/api/views/week-calendar
   · 周历 = 时间轴甘特图（设计稿：8:00 起 · 56px/小时 · 任务块按时间定位）
   · 本周截止 = allActiveTasks.deadline（未来 7 天梯度）
   · 收集箱 = plannedTasks（未排期任务）
   ═══════════════════════════════════════════ */

const cardCls = "bg-[var(--v2-card)] border border-[var(--v2-border)] rounded-xl sh-v2";
const DAYS = ["周一", "周二", "周三", "周四", "周五", "周六", "周日"];
const H = 68;   // 每小时行高（放大：64 → 68，配合字号提升）
const S = 8;    // 起始小时
const TH = 14;  // 默认显示小时数（8:00 - 22:00）
/* 时段分区（设计稿）：上午白 / 下午米黄 / 晚上浅紫 / 凌晨灰 · nm 竖排标签 */
const PS = [
  { s: 8, e: 13, bg: "#ffffff", tx: "var(--color-gray-500)", nm: ["上", "午"] },
  { s: 13, e: 18, bg: "#fef9e7", tx: "#b45309", nm: ["下", "午"] },
  { s: 18, e: 22, bg: "var(--v2-purple-bg)", tx: "var(--v2-purple)", nm: ["晚", "上"] },
  { s: 22, e: 26, bg: "var(--color-gray-100)", tx: "var(--color-gray-500)", nm: ["凌", "晨"] },
];

function dayIndex(date: Date): number { return (date.getDay() + 6) % 7; } // 周一=0

/** 任务的视觉归天：凌晨 0-2 点的任务显示在前一天的凌晨区 */
function visualDayIdx(startTime: string, weekStart: Date): number {
  const st = new Date(startTime);
  const { displayDate } = realTimeToVisualTime(localDateStr(st), st.getHours());
  const [y, m, d] = displayDate.split("-").map(Number);
  const dd = new Date(y, (m || 1) - 1, d || 1);
  return Math.round((dd.getTime() - weekStart.getTime()) / 86400000);
}

/** 任务的视觉小时：凌晨 0-2 点 → 24-26（前一天时间轴延伸） */
function visualHour(startTime: string): number {
  const st = new Date(startTime);
  const { displayHour } = realTimeToVisualTime(localDateStr(st), st.getHours());
  return displayHour + st.getMinutes() / 60;
}
function catStyle(category: string | null): { color: string; bg: string; label: string } {
  const key = normalizeCategory(category);
  const c = DOMAINS[key];
  return { color: c?.border ?? "#CBD5E1", bg: c?.bg ?? "var(--color-gray-50)", label: c?.label ?? "未分类" };
}
function loadColor(load: number) {
  if (load >= 85) return { bar: "#f87171", tx: "var(--color-danger-text)" };
  if (load >= 60) return { bar: "#fbbf24", tx: "#b45309" };
  if (load >= 30) return { bar: "#86efac", tx: "var(--color-success-text)" };
  return { bar: "var(--color-gray-300)", tx: "var(--color-gray-400)" };
}
function durHours(t: { startTime: string; endTime: string | null }): number {
  const st = new Date(t.startTime);
  if (t.endTime) return Math.max(0.25, (new Date(t.endTime).getTime() - st.getTime()) / 3600000);
  return 1.5;
}

interface SchedTask { id: string; scheduleId?: string; title: string; taskType: string; status: string; importance: number; category: string | null; startTime: string; endTime: string | null; estimatedMinutes: number | null; source?: string; deadline?: string | null; description?: string | null; tags?: string | null; theme?: string | null; themeColor?: { color: string; deep: string; bg: string } | null; }
interface ActiveTask { id: string; title: string; taskType: string; status: string; importance: number; category: string | null; deadline: string | null; estimatedMinutes: number | null; tags: string | null; source?: string; theme?: string | null; children?: { id: string; title: string; status: string; completedAt?: string | null }[]; }

/** V3：重叠排期轨道分配——贪心把时间冲突的任务分到不同"轨道"，并排渲染不遮挡 */
function assignLanes(tasks: { startTime: string; endTime: string | null }[]): { lane: number; count: number }[] {
  const sorted = tasks
    .map((t) => ({ t, s: new Date(t.startTime).getTime() / 60000, e: (t.endTime ? new Date(t.endTime).getTime() : new Date(t.startTime).getTime() + 90 * 60000) / 60000 }))
    .sort((a, b) => a.s - b.s);
  const laneEnds: number[] = [];
  return sorted.map((x) => {
    let idx = -1;
    for (let i = 0; i < laneEnds.length; i++) { if (laneEnds[i] <= x.s) { idx = i; break; } }
    if (idx === -1) { laneEnds.push(x.e); idx = laneEnds.length - 1; } else { laneEnds[idx] = x.e; }
    return { lane: idx, count: laneEnds.length };
  });
}

/* ── 通用折叠条（方案 §0：低频区块默认收起，露标题+badge） ── */
function CollapseSection({ title, badge, badgeTone = "gray", children }: {
  title: string; badge?: React.ReactNode; badgeTone?: "gray" | "danger"; children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false); // 默认收起
  return (
    <div className={`${cardCls} mb-4 overflow-hidden`}>
      <button onClick={() => setOpen((v) => !v)} className="w-full flex items-center gap-2 px-4 py-3 text-left hover:bg-[var(--color-gray-50)] transition">
        <span className="text-sm font-semibold text-[var(--v2-text)]">{title}</span>
        {badge && (
          <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${badgeTone === "danger" ? "bg-[var(--color-danger-bg)] text-[var(--color-danger-text)]" : "bg-[var(--color-gray-100)] text-[var(--v2-text2)]"}`}>{badge}</span>
        )}
        <span className={`ml-auto text-[10px] text-[var(--v2-text3)] transition-transform ${open ? "rotate-180" : ""}`}>▼</span>
      </button>
      {open && <div className="px-4 pb-4">{children}</div>}
    </div>
  );
}

/* ── 续排建议（收尾批次 A1：未完成任务 → 明天继续 · GET /api/plan/continuations） ── */
interface ContinuationItem {
  taskId: string;
  title: string;
  lastStart: string | null;
  lastEnd: string | null;
  suggestedStart: string | null;
  estimatedMinutes: number | null;
}

function fmtRange(start: string | null, end: string | null): string {
  if (!start) return "—";
  const s = new Date(start);
  const hm = (d: Date) => `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const dayMs = 86400000;
  const diff = Math.round((s.getTime() - today.getTime()) / dayMs);
  const dayLabel = diff === 0 ? "今天" : diff === -1 ? "昨天" : diff === 1 ? "明天" : `${s.getMonth() + 1}/${s.getDate()}`;
  return `${dayLabel} ${hm(s)}-${end ? hm(new Date(end)) : "--:--"}`;
}

function ContinuationBar({ items, busyId, onContinue }: {
  items: ContinuationItem[];
  busyId: string | null;
  onContinue: (it: ContinuationItem) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className={`${cardCls} mb-4 overflow-hidden`}>
      <button onClick={() => setOpen((v) => !v)} className="w-full flex items-center gap-2 px-4 py-3 text-left hover:bg-[var(--color-gray-50)] transition">
        <span className="text-sm font-semibold text-[var(--v2-text)]">未完成任务 · 明天继续</span>
        {items.length > 0 ? (
          <span className="text-xs px-2 py-0.5 rounded-full font-medium bg-[var(--v2-brand-bg)] text-[var(--v2-brand-deep)]">{items.length} 个续排</span>
        ) : (
          <span className="text-xs px-2 py-0.5 rounded-full font-medium bg-[var(--color-gray-100)] text-[var(--v2-text2)]">无</span>
        )}
        <span className={`ml-auto text-[10px] text-[var(--v2-text3)] transition-transform ${open ? "rotate-180" : ""}`}>▼</span>
      </button>
      {open && (
        <div className="px-4 pb-4">
          {items.length === 0 ? (
            <div className="text-sm text-[var(--v2-text3)] py-2 text-center">没有需要续排的任务 🎉</div>
          ) : (
            <div className="space-y-1.5">
              {items.map((it) => (
                <div key={it.taskId} className="flex items-center gap-2.5 px-3 py-2 rounded-lg bg-[var(--color-gray-50)] border border-[var(--v2-border)]">
                  <span className="text-[13px] font-medium text-[var(--v2-text)] min-w-0 truncate flex-1">{it.title}</span>
                  <span className="text-[11.5px] text-[var(--v2-text3)] whitespace-nowrap">上次 {fmtRange(it.lastStart, it.lastEnd)}</span>
                  <span className="text-[11.5px] text-[var(--v2-text3)] whitespace-nowrap">→ 明天 {it.suggestedStart ? `${String(new Date(it.suggestedStart).getHours()).padStart(2, "0")}:00` : "--:--"}{it.estimatedMinutes ? ` · ${Math.round(it.estimatedMinutes / 60)}h` : ""}</span>
                  <button
                    disabled={busyId === it.taskId}
                    onClick={() => onContinue(it)}
                    className="text-[11.5px] font-semibold px-3 py-1.5 rounded-lg bg-[var(--v2-brand)] text-white hover:bg-[var(--v2-brand-deep)] transition-colors disabled:opacity-50 shrink-0"
                  >{busyId === it.taskId ? "…" : "复制到明天"}</button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* ── 本周截止：统计 + 内容分离（折叠条显示计数，内容区逻辑原样） ── */
function deadlineStats(tasks: ActiveTask[]) {
  const now = new Date();
  const weekEnd = new Date(now); weekEnd.setDate(weekEnd.getDate() + 7);
  const items = tasks
    .filter((t) => t.deadline && new Date(t.deadline) >= now && new Date(t.deadline) <= weekEnd)
    .sort((a, b) => new Date(a.deadline!).getTime() - new Date(b.deadline!).getTime())
    .slice(0, 5)
    .map((t) => {
      const days = Math.max(0, Math.ceil((new Date(t.deadline!).getTime() - now.getTime()) / 86400000));
      const urgent = days <= 1 ? { tx: "var(--color-danger-text)", bg: "var(--color-danger-bg)", label: `${days} 天内` } : days <= 3 ? { tx: "#b45309", bg: "var(--v2-amber-bg)", label: `${days} 天内` } : { tx: "var(--color-gray-500)", bg: "var(--color-gray-100)", label: `${days} 天` };
      const cs = catStyle(t.category);
      return { t, days, urgent, cs };
    });
  return { items, urgentCount: items.filter((i) => i.days <= 1).length };
}

function DeadlineBody({ items }: { items: ReturnType<typeof deadlineStats>["items"] }) {
  const [openId, setOpenId] = useState<string | null>(null);
  if (items.length === 0) return <div className="text-sm text-[var(--v2-text3)] py-3 text-center">未来 7 天没有截止任务</div>;
  return (
    <>
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs text-[var(--v2-text3)]">点击卡片查看子任务</span>
      </div>
      <div className="flex gap-2.5 overflow-x-auto pb-1">
        {items.map(({ t, days, urgent, cs }) => {
          const children = t.children ?? [];
          const doneCount = children.filter((c) => c.status === "completed").length;
          const open = openId === t.id;
          return (
            <div key={t.id} className={`min-w-[200px] flex-1 bg-white border rounded-lg p-3 transition-all ${open ? "border-[var(--v2-brand)]/50 shadow-[var(--shadow-hover)]" : "border-[var(--v2-border)]"}`}>
              <button className="w-full text-left" onClick={() => setOpenId(open ? null : t.id)}>
                <div className="flex items-center gap-1.5 mb-2">
                  <span className="text-sm px-1.5 py-0.5 rounded" style={{ background: cs.bg, color: cs.color }}>{cs.label}</span>
                  <span className="text-sm px-1.5 py-0.5 rounded" style={{ background: urgent.bg, color: urgent.tx }}>{urgent.label}</span>
                  {t.source === "ai" && <span className="text-xs px-1.5 py-0.5 rounded bg-[var(--v2-purple)] text-white">AI</span>}
                </div>
                <div className="text-sm font-medium text-[var(--v2-text)] leading-snug">{t.title}</div>
                <div className="text-sm text-[var(--v2-text3)] mt-1.5">{days === 0 ? "今天到期" : `还剩 ${days} 天`}</div>
              </button>
              {open && (
                <div className="mt-2.5 pt-2.5 border-t border-[var(--v2-border)]">
                  {children.length === 0 && <div className="text-xs text-[var(--v2-text3)]">暂无子任务</div>}
                  <div className="space-y-1.5">
                    {children.map((c) => (
                      <div key={c.id} className="flex items-center gap-1.5 text-sm">
                        <span className={`w-[15px] h-[15px] rounded-[3px] shrink-0 flex items-center justify-center ${c.status === "completed" ? "bg-[var(--v2-check-on)] border border-[var(--v2-check-on)]" : "border border-[var(--v2-check-on)] bg-transparent"}`}>
                          {c.status === "completed" && <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3"><polyline points="20 6 9 17 4 12" /></svg>}
                        </span>
                        <span className={`truncate ${c.status === "completed" ? "line-through text-[var(--v2-check-done)]" : "text-[var(--v2-text2)]"}`}>{c.title}</span>
                      </div>
                    ))}
                  </div>
                  <div className="flex items-center gap-1.5 text-xs text-[var(--v2-text3)] mt-2.5 pt-2 border-t border-[var(--v2-border)]">
                    <span className="text-[var(--v2-green)] font-medium">完成 {doneCount}/{children.length}</span>
                    <span>→</span>
                    <span>待安排</span>
                    <span>→</span>
                    <span className={days <= 1 ? "text-[var(--color-danger-text)] font-medium" : ""}>截止 {days === 0 ? "今天" : `${days} 天后`}</span>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </>
  );
}

/* ── 周历 · 时间轴甘特图（设计稿 1:1：cs-meta 高效时段+周/聚焦胶囊 · dhr 天头 · cb 时段列+时间列+天列 · mt 凌晨展开） ── */
function WeekCalendar({ tasks, focus, weekStart, weekOffset, onTaskClick, onDropTask, peakHours, onToggleFocus }: {
  tasks: SchedTask[]; focus: boolean; weekStart: Date; weekOffset: number;
  onTaskClick?: (t: SchedTask, pos?: { x: number; y: number }) => void;
  onDropTask?: (dayIndex: number, taskId: string, hour?: number) => void;
  peakHours?: string[]; onToggleFocus: () => void;
}) {
  const [midnight, setMidnight] = useState(false);
  const [dragOverDay, setDragOverDay] = useState<number | null>(null);
  // 修复：实时时间线用 state 驱动，每分钟刷新（原来 render 时取一次，红线静止）
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 60000);
    return () => clearInterval(t);
  }, []);
  const totalHours = TH + (midnight ? 4 : 0);
  const totalPx = totalHours * H;
  const todayIdx = dayIndex(now);
  const isThisWeek = weekOffset === 0;
  // 聚焦：真实今天 + 未来两天（用真实日期，不再取模回绕到本周过去的同星期几）
  const focusDates = focus
    ? [0, 1, 2].map((off) => { const dt = new Date(now); dt.setDate(dt.getDate() + off); dt.setHours(12, 0, 0, 0); return dt; })
    : null;
  const visibleDays = focus ? [0, 1, 2] : [0, 1, 2, 3, 4, 5, 6];
  const hours: number[] = [];
  for (let h = S; h < S + totalHours; h++) hours.push(h);
  // 聚焦说明条（设计稿 .fn）
  const fDays = focusDates
    ? focusDates.map((dt) => DAYS[dayIndex(dt)])
    : visibleDays.map((d) => DAYS[d]);
  const fnText = focusDates
    ? `聚焦：今天(${fDays[0]}) + ${fDays[1]} + ${fDays[2]} · 卡片加大 · 实时时间线`
    : `聚焦：${fDays[0]} + ${fDays[1]} + ${fDays[2]} · 卡片加大`;

  return (
    <div className={`${cardCls} p-4 mb-4 overflow-x-auto plan-cal`}>
      {/* cs-meta：左=高效时段徽章（聚焦隐藏） · 右=周/聚焦 胶囊切换（设计稿 .gld + .tgl） */}
      <div className="plan-week-meta flex items-center justify-between mb-3">
        {focus ? (
          <div className="px-3 py-1.5 bg-[var(--v2-purple-bg)] border border-[#c4b5fd] rounded-md text-sm text-[var(--v2-purple-text)]">{fnText}</div>
        ) : (
          <div className="plan-week-gld flex items-center gap-2 px-3 py-1.5 bg-[var(--v2-purple-bg)] border border-[#c4b5fd] rounded-md text-sm text-[var(--v2-purple-text)]">
            <span className="w-3 h-3 rounded-full bg-[var(--v2-brand)] inline-flex items-center justify-center shrink-0"><span className="w-1 h-1 rounded-full bg-white" /></span>
            {peakHours && peakHours.length > 0 ? (
              <><strong className="font-medium">高效时段</strong> {peakHours.join("时 / ")}时 <span className="text-[var(--v2-text3)]">来自你的行为数据</span></>
            ) : (
              <strong className="font-medium">暂无高效时段数据</strong>
            )}
          </div>
        )}
        <div className="inline-flex bg-white border border-[var(--v2-border)] rounded-full p-0.5 shrink-0">
          <button onClick={() => focus && onToggleFocus()} className={`text-sm px-4 py-2.5 rounded-full transition-all min-h-[44px] ${!focus ? "bg-[var(--v2-brand)] text-white font-medium" : "text-[var(--v2-text3)]"}`}>周</button>
          <button onClick={() => !focus && onToggleFocus()} className={`text-sm px-4 py-2.5 rounded-full transition-all min-h-[44px] ${focus ? "bg-[var(--v2-brand)] text-white font-medium" : "text-[var(--v2-text3)]"}`}>聚焦</button>
        </div>
      </div>

      {/* 天头（设计稿 .dhr：dhg 32px 时段占位 + dht 52px 时间占位 + 每天 周几/日期/负荷条/到期badge） */}
      <div className="flex border-b border-[var(--v2-border)]">
        <div className="plan-week-pcol w-9 shrink-0" />
        <div className="plan-week-tcol w-[60px] shrink-0 border-r border-[var(--v2-border)]" />
        {visibleDays.map((d, i) => {
          const colDate = focusDates ? focusDates[i] : (() => { const dt = new Date(weekStart); dt.setDate(dt.getDate() + d); return dt; })();
          const dayTasks = tasks.filter((t) => focusDates ? localDateStr(new Date(t.startTime)) === localDateStr(colDate) : dayIndex(new Date(t.startTime)) === d);
          const load = dayTasks.length === 0 ? 0 : Math.min(100, Math.round(dayTasks.reduce((n, t) => n + durHours(t), 0) / (TH * 0.6) * 100));
          const c = loadColor(load);
          const isTodayCell = focusDates ? i === 0 : isThisWeek && d === todayIdx;
          const ddCount = dayTasks.filter((t) => t.deadline && localDateStr(new Date(t.deadline)) === localDateStr(colDate)).length;
          return (
            <div key={d} className={`plan-week-col plan-week-hd flex-1 min-w-0 text-center px-1 pb-1.5 pt-2 border-l border-[var(--v2-border)] ${isTodayCell ? "bg-[#eef2ff]" : ""}`}>
              <div className={`plan-week-txt text-[13px] ${isTodayCell ? "text-[var(--v2-brand)] font-medium" : "text-[var(--v2-text2)]"}`}>
                {focusDates ? (i === 0 ? "今天" : DAYS[dayIndex(colDate)]) : DAYS[d]}{focusDates && i === 0 ? " · 今天" : ""}
              </div>
              <div className={`plan-week-txt text-sm font-medium tabular-nums mt-0.5 ${isTodayCell ? "text-[var(--v2-brand)]" : "text-[var(--v2-text)]"}`}>{colDate.getMonth() + 1}/{colDate.getDate()}</div>
              <div className="h-1 rounded-sm bg-[var(--color-gray-100)] overflow-hidden mt-1 mx-2">
                <div className="h-full rounded-sm" style={{ width: `${Math.max(3, load)}%`, background: c.bar }} />
              </div>
              <div className="plan-week-txt text-[13px] mt-0.5" style={{ color: c.tx }}>{dayTasks.length === 0 ? "空闲" : `${dayTasks.length}项 · ${load}%`}</div>
              {ddCount > 0 && <span className="plan-week-txt inline-block text-[13px] text-white bg-[var(--color-danger-text)] rounded-full px-1.5 mt-0.5 font-medium">{ddCount}个到期</span>}
            </div>
          );
        })}
      </div>

      {/* 日历主体（设计稿 .cb：pcol 时段标签列 + tcol 时间列 + 天列） */}
      <div className="flex">
        {/* 时段标签列（设计稿 .pcol：36px 竖排双字 · 无圆角铺满） */}
        <div className="plan-week-pcol w-9 shrink-0 relative" style={{ height: totalPx }}>
          {PS.filter((p) => p.s < S + totalHours && p.e > S).map((p) => {
            const top = Math.max(0, (p.s - S) * H);
            const hh = (Math.min(p.e, S + totalHours) - Math.max(p.s, S)) * H;
            if (hh <= 0) return null;
            return (
              <div key={p.s} className="absolute left-0 right-0 flex items-center justify-center" style={{ top, height: hh, background: p.bg, color: p.tx }}>
                <div className="flex flex-col items-center gap-[3px] text-[13px] font-medium leading-none tracking-[0.2em]">
                  <span>{p.nm[0]}</span>
                  <span>{p.nm[1]}</span>
                </div>
              </div>
            );
          })}
        </div>

        {/* 时间列（设计稿 .tcol：60px · 标签左对齐 · 段边界 1.5px 加深线） */}
        <div className="plan-week-tcol w-[60px] shrink-0 relative border-r border-[var(--v2-border)]" style={{ height: totalPx }}>
          {[...hours, S + totalHours].map((h) => (
            <span key={h} className="absolute -translate-y-1/2 text-[13px] font-semibold text-[var(--v2-text2)] tabular-nums z-[1]" style={{ top: (h - S) * H, left: 6, background: "var(--v2-card)", padding: "0 3px" }}>
              {String(h % 24).padStart(2, "0")}:00
            </span>
          ))}
          {hours.map((h) => (
            <div key={`ln${h}`} className="absolute left-0 right-0" style={{ top: (h - S) * H + H, height: PS.some((p) => p.s === h + 1) ? 1.5 : 0.5, background: PS.some((p) => p.s === h + 1) ? "#d1d5db" : "var(--v2-border)" }} />
          ))}
        </div>

        {/* 天列（设计稿 .dc：今天 bg #fafafe · 时段背景 0.4 · 网格线 .5px / 段边界 1.5px） */}
        {visibleDays.map((d, i) => {
          const isTodayCell = focusDates ? i === 0 : isThisWeek && d === todayIdx;
          const dayTasks = tasks.filter((t) => focusDates ? localDateStr(new Date(t.startTime)) === localDateStr(focusDates[i]) : visualDayIdx(t.startTime, weekStart) === d);
          return (
            <div key={d} className={`plan-week-col flex-1 relative border-l ${isTodayCell ? "bg-[#fafafe]" : ""} ${dragOverDay === d ? "ring-2 ring-inset ring-[var(--v2-brand)]/40" : ""}`} style={{ height: totalPx, borderColor: "var(--v2-border)", minWidth: focus ? 140 : 130 }}
              onDragOver={(e) => {
                e.preventDefault();
                // 修复：dropEffect 只接受 none/copy/link/move；"copyMove" 仅 effectAllowed 合法
                // 拖源统一 effectAllowed="copyMove"，此处 dropEffect="move" 与之兼容（move ∈ copyMove）
                e.dataTransfer.dropEffect = "move";
                setDragOverDay(d);
              }}
              onDragLeave={() => setDragOverDay((cur) => (cur === d ? null : cur))}
              onDrop={(e) => {
                e.preventDefault();
                setDragOverDay(null);
                const taskId = e.dataTransfer.getData("text/task-id");
                if (!taskId) return;
                // 精确时间：根据鼠标在列内的 Y 坐标计算目标小时（半小时间隔）
                const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
                const rawHour = S + (e.clientY - rect.top) / H;
                const hour = Math.min(S + totalHours - 0.5, Math.max(S, Math.round(rawHour * 2) / 2));
                onDropTask?.(d, taskId, hour);
              }}>
              {/* 时段分区背景（设计稿 .bgp opacity 0.4，淡化避免与任务块糊色） */}
              {PS.filter((p) => p.s < S + totalHours && p.e > S).map((p) => {
                const top = Math.max(0, (p.s - S) * H);
                const hh = (Math.min(p.e, S + totalHours) - Math.max(p.s, S)) * H;
                return hh > 0 ? <div key={p.s} className="absolute left-0 right-0" style={{ top, height: hh, background: p.bg, opacity: 0.45 }} /> : null;
              })}
              {/* 小时网格线（设计稿 .grl：0.5px / 段边界 .grl.ps：1.5px #d1d5db） */}
              {hours.map((h) => (
                <div key={h} className="absolute left-0 right-0" style={{ top: (h - S) * H, height: PS.some((p) => p.s === h) ? 1.5 : 0.5, background: PS.some((p) => p.s === h) ? "#d1d5db" : "var(--v2-border)" }} />
              ))}
              <div className="absolute left-0 right-0" style={{ top: totalPx, height: PS.some((p) => p.s === S + totalHours) ? 1.5 : 0.5, background: PS.some((p) => p.s === S + totalHours) ? "#d1d5db" : "var(--v2-border)" }} />

              {/* 任务块（设计稿 .tsk：left/right 4px · border-left 4px 分类色 · 0 6px 6px 3px 左直右圆 · 内容分级标题→时间≥46px→时长≥32px→角标 · V3：标题旁主题徽章 + 重叠轨道分列） */}
              {(() => {
                const daySorted = dayTasks.sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime());
                const lanes = assignLanes(daySorted);
                return daySorted.map((t, ti) => {
                  const st = new Date(t.startTime);
                  const sh = visualHour(t.startTime);
                  const dur = durHours(t);
                  const top = (sh - S) * H;
                  // B6 修复：未展开凌晨时跨夜任务块（如 23:00-01:00）截断到时间轴末端，不再溢出被裁剪
                  const axisEndH = S + totalHours;
                  let hh = Math.max(dur * H, 22);
                  const truncated = !midnight && sh + dur > axisEndH;
                  if (truncated) hh = Math.max(22, (axisEndH - sh) * H);
                  const cs = catStyle(t.category);
                  // V3 C6：直读落库 theme（无则 tags/标题推断兜底）
                  const theme = (t as SchedTask).theme ?? resolveTheme(t.tags, t.title, t.category);
                  const tm = `${String(st.getHours()).padStart(2, "0")}:${String(st.getMinutes()).padStart(2, "0")} - ${t.endTime ? new Date(t.endTime).toTimeString().slice(0, 5) : "--:--"}`;
                  const ds = dur >= 1 ? `${Math.floor(dur)}h` : `${Math.round(dur * 60)}m`;
                  // 角标（设计稿 .tbr：AI 浅紫底靛蓝字 / 截止 浅红底红字 + 边框，绝对定位右上；两者同存时上下排）
                  const dlLabel = t.deadline ? (() => { const dl = new Date(t.deadline); return `${dl.getMonth() + 1}/${dl.getDate()} ${String(dl.getHours()).padStart(2, "0")}:${String(dl.getMinutes()).padStart(2, "0")}截止`; })() : null;
                  const dlShort = t.deadline ? (() => { const dl = new Date(t.deadline); return `${dl.getMonth() + 1}/${dl.getDate()}`; })() : null;
                  const hasBadge = t.source === "ai" || dlLabel;
                  const laneInfo = lanes[ti];
                  const laneLeft = laneInfo.count > 1 ? `calc(${(laneInfo.lane * 100) / laneInfo.count}% + 2px)` : 4;
                  const laneRight = laneInfo.count > 1 ? `calc(${100 - (100 / laneInfo.count) * (laneInfo.lane + 1)}% + 2px)` : 4;
                  return (
                    <div key={t.id} className="plan-tsk absolute cursor-pointer hover:shadow-sm transition-shadow z-[1] overflow-hidden"
                      style={{ top, height: hh, left: laneLeft, right: laneRight, borderRadius: "0 6px 6px 3px", borderLeft: `4px solid ${cs.color}`, background: cs.bg, padding: focus ? "8px 10px" : "7px 8px" }}
                      draggable
                      onDragStart={(e) => { e.dataTransfer.setData("text/task-id", t.id); e.dataTransfer.effectAllowed = "copyMove"; }}
                      onClick={(e) => { e.stopPropagation(); onTaskClick?.(t, { x: e.clientX, y: e.clientY }); }}
                      title={`${t.title}\n${tm} · ${cs.label}${theme ? ` · 主题：${theme}` : ""}\n${t.status === "completed" ? "已完成" : t.status === "in_progress" ? "进行中" : "未开始"}\n拖动可移动 · 点击查看详情`}>
                      {/* B10：AI 徽章弱化（灰字小标；手动调整后 source→user 自动消失） */}
                      {t.source === "ai" && <span className="absolute right-1.5 text-[10px] px-1 py-px rounded font-medium leading-[16px] bg-[#f1f5f9] text-[var(--v2-text3)]" style={{ top: 4 }}>AI 建议</span>}
                      {/* 标题行：右侧预留 AI 徽章 / 中矮块的时长角标位，截断不撞角标 */}
                      <div className="flex items-center gap-1.5 min-w-0" style={{ paddingRight: t.source === "ai" ? 30 : hh >= 32 && hh < 46 ? 26 : 0 }}>
                        <div className="plan-tsk-title text-[15px] truncate" style={{ fontWeight: 600, lineHeight: 1.35, color: "#111827", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{t.title}</div>
                        {theme && <ThemeBadge theme={theme} mini={hh < 40} />}
                      </div>
                      {/* 时间行（高块：时间 + 时长同行右对齐，不再与右下角标贴叠） */}
                      {hh >= 46 && (
                        <div className="flex items-center justify-between gap-2 text-[13px] text-[var(--v2-text2)] tabular-nums mt-1 min-w-0">
                          <span className="truncate">{tm}{dlShort && <span className="text-[var(--color-danger-text)] font-medium"> · {dlShort}截止</span>}</span>
                          <span className="shrink-0">{ds}</span>
                        </div>
                      )}
                      {/* 时长角标（中矮块 32-46px：无时间行，右下角独立显示） */}
                      {hh >= 32 && hh < 46 && <div className="absolute right-1.5 text-[13px] text-[var(--v2-text2)]" style={{ bottom: 4 }}>{ds}</div>}
                      {/* B6：截断提示（跨夜 · 未展开凌晨） */}
                      {truncated && <div className="absolute right-1.5 bottom-0.5 text-[11px] font-semibold text-[var(--v2-text3)]" style={{ background: cs.bg, padding: "0 3px" }}>⋯ 跨夜</div>}
                    </div>
                  );
                });
              })()}

              {/* 聚焦模式 + 本周：今天实时时间线（设计稿 .nl/.nd/.nlb：粉色呼吸 + 圆点 + 白底时间标签） */}
              {focus && isThisWeek && isTodayCell && (() => {
                const nh = now.getHours() + now.getMinutes() / 60;
                if (nh < S || nh > S + totalHours) return null;
                return (
                  <>
                    <div className="absolute left-0 right-0 animate-pulse z-[2]" style={{ top: (nh - S) * H, height: 1, background: "#ec4899" }} />
                    <span className="absolute z-[2] animate-pulse" style={{ left: -4, top: (nh - S) * H, transform: "translate(-50%,-50%)", width: 8, height: 8, borderRadius: "50%", background: "#ec4899" }} />
                    <span className="absolute z-[2] animate-pulse" style={{ right: 2, top: (nh - S) * H, transform: "translateY(-50%)", fontSize: 11, color: "#ec4899", fontWeight: 500, background: "#fff", padding: "0 3px" }}>
                      {String(now.getHours()).padStart(2, "0")}:{String(now.getMinutes()).padStart(2, "0")}
                    </span>
                  </>
                );
              })()}
            </div>
          );
        })}
      </div>

      {/* 凌晨折叠（设计稿 .mt：居中 11px 灰） */}
      <div className="flex justify-center mt-1">
        <button onClick={() => setMidnight((m) => !m)} className="w-full text-center py-2.5 min-h-[44px] text-[12px] text-[var(--v2-text3)] hover:text-[var(--v2-text2)] transition">
          {midnight ? "收起凌晨 ▲" : "展开凌晨 22:00 - 02:00 ▼"}
        </button>
      </div>

      {/* 分类行（设计稿 .tp：左色条标签 + 任务统计 · V3：补主题徽章） */}
      <div className="flex gap-2 flex-wrap items-center mt-2 pt-2.5 pb-2.5 px-3.5 border-t border-[var(--v2-border)]">
        <span className="text-[12px] text-[var(--v2-text3)] mr-1">领域：</span>
        {(Object.keys(DOMAINS) as (keyof typeof DOMAINS)[]).filter((k) => tasks.some((t) => normalizeCategory(t.category) === k)).map((k) => (
          <span key={k} className="text-xs px-2 py-0.5 rounded font-medium border-l-[3px]" style={{ borderColor: DOMAINS[k].border, background: DOMAINS[k].bg, color: DOMAINS[k].border }}>{DOMAINS[k].label}</span>
        ))}
        {(() => {
          const themes = [...new Set(tasks.map((t) => (t as ActiveTask).theme ?? resolveTheme(t.tags, t.title, t.category)).filter(Boolean) as string[])];
          if (themes.length === 0) return null;
          return (
            <>
              <span className="text-[12px] text-[var(--v2-text3)] mr-1">主题：</span>
              {themes.map((th) => (
                <ThemeBadge key={th} theme={th} />
              ))}
            </>
          );
        })()}
        <span className="text-xs text-[var(--v2-text2)] ml-auto">{tasks.length} 个任务 · {tasks.filter((t) => t.deadline).length} 个有截止日期</span>
      </div>

      {/* 图例行（设计稿 .lr · V3：补主题说明） */}
      <div className="flex gap-3.5 flex-wrap items-center px-3.5 pb-1 text-xs text-[var(--v2-text2)]">
        {(Object.keys(DOMAINS) as (keyof typeof DOMAINS)[]).filter((k) => tasks.some((t) => normalizeCategory(t.category) === k)).map((k) => (
          <span key={k} className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-[2px] shrink-0" style={{ background: DOMAINS[k].border }} />{DOMAINS[k].label}</span>
        ))}
        <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-[2px] shrink-0 bg-[var(--color-danger-text)]" />红标=截止日期</span>
        {Object.keys(THEMES).length > 0 && (
          <span className="flex items-center gap-2">
            <span className="text-[var(--v2-text3)]">主题（徽章=目标）：</span>
            {Object.entries(THEMES).map(([k, v]) => (
              <span key={k} className="flex items-center gap-1"><span className="w-2 h-2 rounded-full shrink-0" style={{ background: v.color }} />{k}</span>
            ))}
          </span>
        )}
      </div>
    </div>
  );
}

/* ── 收集箱（未排期任务：inbox 事项 + planned 截止日） ── */
function IdeaPool({ ideas, onOpen, onDragStart }: { ideas: ActiveTask[]; onOpen: (idea: ActiveTask) => void; onDragStart: (taskId: string) => void }) {
  return (
    <div className={`${cardCls} p-4`}>
      <div className="flex items-center gap-2 mb-3">
        <span className="text-sm font-semibold text-[var(--v2-text)]">收集箱</span>
        <span className="text-sm px-2 py-0.5 rounded-full bg-[var(--color-success-bg)] text-[var(--color-success-text)]">{ideas.length} 条事项</span>
        {ideas.length > 0 && <span className="text-sm text-[var(--v2-text3)]">点击查看详情 · 拖到日历自动转为时间块</span>}
      </div>
      {ideas.length === 0 && <div className="text-sm text-[var(--v2-text3)] py-3 text-center">没有待安排的 · 去 Inbox 倒进来</div>}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
        {ideas.map((i) => {
          const cs = catStyle(i.category);
          return (
            <div key={i.id} onClick={() => onOpen(i)} draggable onDragStart={(e) => { e.dataTransfer.setData("text/task-id", i.id); e.dataTransfer.effectAllowed = "copyMove"; onDragStart(i.id); }}
              className="border border-[var(--v2-border)] rounded-lg p-3 cursor-pointer hover:shadow-sm hover:border-[var(--v2-brand)]/40 transition group">
              <div className="flex items-center gap-1.5 mb-1.5">
                <span className={`text-sm px-1.5 py-0.5 rounded ${i.source === "ai" ? "bg-[var(--v2-purple-bg)] text-[var(--v2-purple)]" : "bg-[var(--v2-amber-bg)] text-[#b45309]"}`}>
                  {i.source === "ai" ? "AI 解析" : "手动"}
                </span>
                <span className={`text-sm px-1.5 py-0.5 rounded ${i.taskType === "inbox" ? "bg-[var(--color-gray-100)] text-[var(--color-gray-500)]" : "bg-[var(--color-danger-bg)] text-[var(--color-danger-text)]"}`}>
                  {timeStateLabel({ taskType: i.taskType, deadline: i.deadline })}
                </span>
                <span className="ml-auto opacity-50 group-hover:opacity-100 flex gap-0.5 cursor-grab" title="拖到日历排期">
                  <span className="w-[3px] h-[11px] rounded-sm bg-[var(--v2-text3)]" />
                  <span className="w-[3px] h-[11px] rounded-sm bg-[var(--v2-text3)]" />
                </span>
              </div>
              <div className="text-sm font-medium text-[var(--v2-text)] mb-1">{i.title}</div>
              <div className="text-sm flex items-center gap-1.5">
                <span className="px-1.5 py-0.5 rounded" style={{ background: cs.bg, color: cs.color }}>{cs.label}</span>
                {i.estimatedMinutes ? <span className="text-[var(--v2-text3)]">约 {i.estimatedMinutes}min</span> : <span className="text-[var(--v2-text3)]">未评估</span>}
                {i.deadline && <span className="text-[var(--v2-text3)] ml-auto">{new Date(i.deadline).toLocaleDateString("zh-CN", { month: "2-digit", day: "2-digit" })} 截止</span>}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ── 任务详情面板 — 三种类型（点击位置附近弹出，设计稿：共用外壳 + 主视觉区不同） ── */
interface DetailTask {
  id: string; title: string; status: string; taskType: string; importance: number;
  estimatedMinutes: number | null; actualMinutes?: number; deadline: string | null;
  description?: string | null; tags?: string | null; source?: string | null;
  children?: { id: string; title: string; status: string; completedAt: string | null; estimatedMinutes: number | null }[];
  timeLogs?: { durationSeconds: number }[];
}
type DetailSeed = { taskId: string; title: string; startTime?: string; endTime?: string | null; category?: string | null; estimatedMinutes?: number | null; source?: string | null };

function TaskDetailPopover({ seed, pos, onClose, onEditTime, onRemove, busy, onAction }: {
  seed: DetailSeed;
  pos: { x: number; y: number } | null;
  onClose: () => void;
  onEditTime: (taskId: string) => void;
  onRemove: (taskId: string) => void;
  busy: boolean;
  onAction: (taskId: string, action: string) => Promise<void>;
}) {
  const [detail, setDetail] = useState<DetailTask | null>(null);
  const [loadErr, setLoadErr] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [childBusy, setChildBusy] = useState(false);
  const [addingChild, setAddingChild] = useState(false);
  const [newChildTitle, setNewChildTitle] = useState("");

  useEffect(() => {
    let cancelled = false;
    setDetail(null);
    setLoadErr(false);
    fetch(`/api/tasks/${seed.taskId}`).then((r) => (r.ok ? r.json() : Promise.reject())).then((d) => {
      if (!cancelled) setDetail(d);
    }).catch(() => { if (!cancelled) setLoadErr(true); });
    return () => { cancelled = true; };
  }, [seed.taskId, reloadKey]);

  // 子任务勾选（完成 ↔ 重新打开）
  const toggleChild = async (childId: string, isDone: boolean) => {
    setChildBusy(true);
    try {
      await fetch(`/api/tasks/${childId}/action`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: isDone ? "reopen" : "complete" }),
      });
      setReloadKey((k) => k + 1);
    } catch { setLoadErr(true); }
    finally { setChildBusy(false); }
  };

  // 追加子任务
  const addChild = async () => {
    const t = newChildTitle.trim();
    if (!t) return;
    setChildBusy(true);
    try {
      const r = await fetch("/api/tasks", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: t, taskType: "inbox", parentId: seed.taskId, importance: 3 }),
      });
      if (!r.ok) throw new Error();
      setNewChildTitle("");
      setAddingChild(false);
      setReloadKey((k) => k + 1);
    } catch { setLoadErr(true); }
    finally { setChildBusy(false); }
  };

  const cs = catStyle(seed.category ?? null);
  const doneChildren = detail?.children?.filter((c) => c.completedAt).length ?? 0;
  const totalChildren = detail?.children?.length ?? 0;
  const actualMin = detail?.timeLogs?.reduce((s, l) => s + l.durationSeconds, 0) ?? 0;
  const elapsedMin = Math.round(actualMin / 60);
  const deadlineDays = detail?.deadline ? Math.max(0, Math.ceil((new Date(detail.deadline).getTime() - Date.now()) / 86400000)) : null;
  const inProgress = detail?.status === "in_progress";
  const completed = detail?.status === "completed";
  const isAi = (detail?.source ?? seed.source) === "ai";

  // 定位：点击位置附近弹出，超出视口自动翻转（B3 修复：按实际卡高计算，不再硬编码 420）
  const W = 340, M = 8;
  const modalH = Math.min(typeof window !== "undefined" ? window.innerHeight * 0.7 : 520, 520);
  const left = pos ? Math.min(Math.max(M, pos.x - W / 2), (typeof window !== "undefined" ? window.innerWidth : 1200) - W - M) : Math.max(M, (typeof window !== "undefined" ? window.innerWidth : 1200) / 2 - W / 2);
  const top = pos ? Math.min(Math.max(M, pos.y + 12), (typeof window !== "undefined" ? window.innerHeight : 800) - modalH - M) : Math.max(M, ((typeof window !== "undefined" ? window.innerHeight : 800) - modalH) / 2);

  return (
    <div className="fixed inset-0 z-50" onClick={onClose}>
      <div className="absolute bg-white rounded-xl shadow-2xl border border-[var(--v2-border)] flex flex-col overflow-y-auto"
        style={{ left, top, width: W, maxHeight: "min(70vh, 520px)" }}
        onClick={(e) => e.stopPropagation()}>
        {/* 头部 */}
        <div className="px-4 py-3.5 border-b border-[var(--v2-border)] flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="flex items-center gap-1.5 mb-1.5 flex-wrap">
              <span className="text-sm px-1.5 py-0.5 rounded" style={{ background: cs.bg, color: cs.color }}>{cs.label}</span>
              <span className="text-sm px-1.5 py-0.5 rounded bg-[var(--color-gray-100)] text-[var(--color-gray-500)]">
                {timeStateLabel({ taskType: detail?.taskType, deadline: detail?.deadline, startTime: seed.startTime ?? undefined })}
              </span>
              {isAi && <span className="text-sm px-1.5 py-0.5 rounded bg-[var(--v2-purple-bg)] text-[var(--v2-purple)]">AI 生成</span>}
              {completed && <span className="text-sm px-1.5 py-0.5 rounded bg-[var(--color-success-bg)] text-[var(--color-success-text)]">已完成</span>}
              {inProgress && <span className="text-sm px-1.5 py-0.5 rounded bg-[var(--color-brand-50)] text-[var(--v2-brand-deep)]">进行中</span>}
            </div>
            <div className="text-[15px] font-semibold text-[var(--v2-text)] leading-snug">{seed.title}</div>
            {detail?.description && <p className="text-sm text-[var(--v2-text3)] mt-1 leading-relaxed">{detail.description}</p>}
          </div>
          <button onClick={onClose} className="text-[var(--v2-text3)] hover:text-[var(--v2-text)] text-sm shrink-0">✕</button>
        </div>

        {/* 主体 */}
        <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
          {loadErr && <div className="text-sm text-[var(--color-danger-text)]">加载详情失败</div>}

          {/* ── 三种类型主视觉区（设计稿） ── */}
          {detail?.taskType === "scheduled" && (
            <div className="rounded-lg bg-[var(--color-gray-50)] border border-[var(--v2-border)] p-3">
              <div className="text-sm text-[var(--v2-text3)] mb-2">时间块</div>
              {seed.startTime && (
                <div className="text-sm font-medium text-[var(--v2-text)]">
                  {new Date(seed.startTime).toLocaleDateString("zh-CN", { month: "2-digit", day: "2-digit", weekday: "short" })}
                  <span className="ml-1.5">{new Date(seed.startTime).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })}
                    {seed.endTime ? ` — ${new Date(seed.endTime).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })}` : ""}</span>
                </div>
              )}
              <div className="text-sm text-[var(--v2-text3)] mt-1">
                {seed.endTime && seed.startTime ? `时长 ${Math.max(1, Math.round((new Date(seed.endTime).getTime() - new Date(seed.startTime).getTime()) / 60000))} 分钟` : "—"}
                {detail.estimatedMinutes ? ` · 预估 ${detail.estimatedMinutes} 分钟` : ""}
                {elapsedMin > 0 ? ` · 已投入 ${elapsedMin} 分钟` : ""}
              </div>
            </div>
          )}

          {detail?.taskType === "planned" && (
            <div className="rounded-lg bg-[var(--color-danger-bg)] border border-[var(--color-danger-border)] p-3">
              <div className="text-sm text-[var(--color-danger-text)] mb-2">截止日</div>
              {detail.deadline ? (
                <>
                  <div className="text-sm font-medium text-[var(--v2-text)]">
                    {new Date(detail.deadline).toLocaleDateString("zh-CN", { year: "numeric", month: "2-digit", day: "2-digit", weekday: "short" })}
                  </div>
                  <div className="text-sm mt-1 font-medium" style={{ color: (deadlineDays ?? 99) <= 1 ? "var(--color-danger-text)" : (deadlineDays ?? 99) <= 3 ? "#b45309" : "var(--color-gray-500)" }}>
                    {deadlineDays === 0 ? "今天到期！" : deadlineDays === null ? "" : `还剩 ${deadlineDays} 天`}
                  </div>
                </>
              ) : <div className="text-[12px] text-[var(--v2-text2)]">未设置截止日期</div>}
              {seed.startTime && (
                <div className="text-sm text-[var(--v2-text3)] mt-1.5">计划 {new Date(seed.startTime).toLocaleString("zh-CN", { weekday: "short", hour: "2-digit", minute: "2-digit" })}</div>
              )}
              <div className="text-sm text-[var(--v2-text3)] mt-0.5">
                {detail.estimatedMinutes ? `预估 ${detail.estimatedMinutes} 分钟` : "未评估时长"}
              </div>
            </div>
          )}

          {detail?.taskType === "inbox" && (
            <div className="rounded-lg bg-[var(--v2-amber-bg)] border border-[var(--color-warning-border)] p-3">
              <div className="text-sm text-[#b45309] mb-1.5">事项 · 执行清单</div>
              <div className="text-sm text-[var(--color-plan-task-deadline-text)]">未安排时间 · 勾选完成一项，或拖到日历转为时间块</div>
              {detail.estimatedMinutes ? <div className="text-sm text-[var(--color-plan-task-deadline-text)] mt-1">预估 {detail.estimatedMinutes} 分钟</div> : null}
            </div>
          )}

          {/* 执行清单（children）— 设计稿 inbox 主视图，其他类型作子任务区 */}
          {detail && detail.children && detail.children.length > 0 && (
            <div>
              <div className="text-sm font-medium text-[var(--v2-text2)] mb-2">执行清单 · {doneChildren}/{totalChildren}</div>
              <div className="space-y-1">
                {detail.children.map((c) => (
                  <button key={c.id} onClick={() => toggleChild(c.id, !!c.completedAt)} disabled={childBusy}
                    className="w-full flex items-center gap-2 px-2.5 py-2 rounded-lg bg-[var(--color-gray-50)] border border-[var(--v2-border)] hover:border-[var(--v2-brand)]/40 transition text-left disabled:opacity-50">
                    <span className={`w-3.5 h-3.5 rounded-[3px] shrink-0 border flex items-center justify-center ${c.completedAt ? "bg-[var(--v2-check-on)] border-[var(--v2-check-on)]" : "border-[#d4a853]"}`}>
                      {c.completedAt && <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3"><polyline points="20 6 9 17 4 12" /></svg>}
                    </span>
                    <span className={`text-[12px] flex-1 ${c.completedAt ? "line-through text-[var(--v2-check-done)]" : "text-[var(--v2-text)]"}`}>{c.title}</span>
                    {c.estimatedMinutes ? <span className="text-sm text-[var(--v2-text3)]">{c.estimatedMinutes}m</span> : null}
                  </button>
                ))}
              </div>
            </div>
          )}

          {detail && detail.children && detail.children.length === 0 && (
            <div className="text-sm text-[var(--v2-text3)]">暂无子任务 · 点击下方「追加子任务」建立执行清单</div>
          )}

          {/* 追加子任务 */}
          {addingChild ? (
            <div className="flex gap-2">
              <input autoFocus value={newChildTitle} onChange={(e) => setNewChildTitle(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") addChild(); if (e.key === "Escape") setAddingChild(false); }}
                placeholder="子任务标题，Enter 添加"
                className="flex-1 px-2.5 py-1.5 text-sm border border-[var(--v2-border)] rounded outline-none focus:border-[var(--v2-brand)]" />
              <button onClick={addChild} disabled={childBusy || !newChildTitle.trim()}
                className="px-2.5 py-1.5 text-sm rounded bg-[var(--v2-brand)] text-white disabled:opacity-50">添加</button>
              <button onClick={() => setAddingChild(false)} className="px-2 py-1.5 text-sm rounded border border-[var(--v2-border)] text-[var(--v2-text2)]">取消</button>
            </div>
          ) : (
            <button onClick={() => setAddingChild(true)}
              className="w-full text-sm py-2 rounded-lg border border-dashed border-[var(--v2-border)] text-[var(--v2-text3)] hover:border-[var(--v2-brand)] hover:text-[var(--v2-brand)] transition">
              + 追加子任务
            </button>
          )}
        </div>

        {/* 底部操作 */}
        <div className="border-t border-[var(--v2-border)] px-4 py-3 flex gap-2">
          {!completed && (
            <button onClick={() => onAction(seed.taskId, inProgress ? "complete" : "start")} disabled={busy}
              className={`flex-1 text-sm font-medium rounded-lg py-2 disabled:opacity-50 ${inProgress ? "bg-[var(--v2-green)] text-white" : "bg-[var(--v2-brand)] text-white"}`}>
              {busy ? "处理中…" : inProgress ? "完成" : "开始"}
            </button>
          )}
          <button onClick={() => onEditTime(seed.taskId)} disabled={busy}
            className="px-3 py-2 text-sm rounded-lg border border-[var(--v2-border)] bg-white text-[var(--v2-text2)] hover:bg-[var(--color-gray-50)] transition disabled:opacity-50">
            调整时间
          </button>
          {seed.startTime && (
            <button onClick={() => onRemove(seed.taskId)} disabled={busy}
              className="px-3 py-2 text-sm rounded-lg border border-[var(--color-danger-border)] bg-white text-[var(--color-danger-text)] hover:bg-[var(--color-danger-bg)] transition disabled:opacity-50">
              移除
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
export default function PlanPage() {
  const [focus, setFocus] = useState(false); // 默认周视角（设计稿：周/聚焦胶囊，周为默认）

  // 移动端适配（收尾批次）：<860px 自动聚焦 3 列（今天+明+后），列宽自适应不横向溢出
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 860px)");
    const apply = (m: MediaQueryList | MediaQueryListEvent) => { if (m.matches) setFocus(true); };
    apply(mq);
    mq.addEventListener?.("change", apply);
    return () => mq.removeEventListener?.("change", apply);
  }, []);
  const [weekOffset, setWeekOffset] = useState(0);
  const [scheduled, setScheduled] = useState<SchedTask[]>([]);
  const [active, setActive] = useState<ActiveTask[]>([]);
  const [ideas, setIdeas] = useState<ActiveTask[]>([]);
  const [peakHours, setPeakHours] = useState<string[]>([]);
  const [health, setHealth] = useState<{ healthScore: number; issues: { type: string; message: string; severity: string }[] } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [modal, setModal] = useState<{ taskId: string; title: string; initialStart?: string } | null>(null);
  const [detail, setDetail] = useState<{ seed: DetailSeed; pos: { x: number; y: number } | null } | null>(null);
  const [busy, setBusy] = useState(false);

  // 偏移周起点（设计稿 ← 本周 → 切换：0=本周，±N=前后周）
  const weekStartOf = useCallback((offset: number) => {
    const now = new Date();
    const monday = new Date(now);
    monday.setDate(now.getDate() - dayIndex(now) + offset * 7);
    monday.setHours(0, 0, 0, 0);
    return monday;
  }, []);
  const weekStart = weekStartOf(weekOffset);

  const load = useCallback(async (silent = false) => {
    // silent：交互后静默刷新（拖动/排期/移除/完成），不切骨架屏，保住滚动位置（修复拖动后页面跳顶）
    if (!silent) setLoading(true);
    setError(false);
    try {
      const r = await fetch(`/api/views/week-calendar?weekStart=${encodeURIComponent(localDateStr(weekStartOf(weekOffset)))}`);
      if (!r.ok) throw new Error();
      const d = await r.json();
      setScheduled(d.scheduledTasks ?? []);
      setActive(d.allActiveTasks ?? []);
      setIdeas(d.plannedTasks ?? []);
      setPeakHours(d.peakHours ?? []);
      // 修复 P1-2：计划健康分接入前端（原 analyze 死链路，结果无人消费）
      fetch("/api/plan/analyze", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({}) })
        .then((r) => (r.ok ? r.json() : null))
        .then((h) => { if (h && typeof h.healthScore === "number") setHealth(h); })
        .catch(() => {});
    } catch { setError(true); }
    finally { if (!silent) setLoading(false); }
  }, [weekOffset, weekStartOf]);
  useEffect(() => { load(); }, [load]);

  // 收尾批次 A1：续排建议（未完成任务 → 明天继续 · load 之后声明）
  const [continuations, setContinuations] = useState<ContinuationItem[]>([]);
  const [contBusyId, setContBusyId] = useState<string | null>(null);
  const [contToast, setContToast] = useState<string | null>(null);
  const loadContinuations = useCallback(() => {
    fetch("/api/plan/continuations")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (d && Array.isArray(d.suggestions)) setContinuations(d.suggestions); })
      .catch(() => {});
  }, []);
  useEffect(() => { loadContinuations(); }, [loadContinuations]);

  // Bug 修复：档案面板删除/移出完成等变更 → 收集箱/周历实时刷新（不再残留已删任务）
  useEffect(() => {
    const h = () => { load(true); loadContinuations(); };
    window.addEventListener("meridian-task-changed", h);
    return () => window.removeEventListener("meridian-task-changed", h);
  }, [load, loadContinuations]);
  const continueTomorrow = useCallback(async (it: ContinuationItem) => {
    setContBusyId(it.taskId);
    try {
      const r = await fetch(`/api/tasks/${it.taskId}/action`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "continue_tomorrow" }),
      });
      if (!r.ok) throw new Error();
      const d = await r.json();
      const hm = d.nextStart ? new Date(d.nextStart) : null;
      setContToast(`已排到明天 ${hm ? `${String(hm.getHours()).padStart(2, "0")}:00` : ""} · 任务「${it.title}」`);
      setTimeout(() => setContToast(null), 2600);
      setContinuations((prev) => prev.filter((x) => x.taskId !== it.taskId));
      load(); // 周历刷新：明天出现同时间段块
    } catch { setContToast("续排失败，请重试"); setTimeout(() => setContToast(null), 2600); }
    finally { setContBusyId(null); }
  }, [load]);

  // 排期/调整：moveSchedule（修复 P1-4：带 scheduleId 只替换目标那条，防重复任务折叠）
  const saveSchedule = useCallback(async (taskId: string, newStart: string, newEnd: string, scheduleId?: string) => {
    setBusy(true);
    try {
      const r = await fetch("/api/plan/apply-decision", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ changes: [{ taskId, newStart, newEnd, scheduleId }] }),
      });
      if (!r.ok) throw new Error("排期失败");
      setModal(null);
      setDetail(null);
      await load(true);
    } catch { setError(true); }
    finally { setBusy(false); }
  }, [load]);

  // 拖拽到日历：自动转为时间块（目标日按当前偏移周的 weekStart 计算）
  // hour 传入（任务块拖动，鼠标位置精确计算）；未传入（收集箱拖入）→ 当天 10:00 或下一整点
  const dropTask = useCallback(async (dayIndex: number, taskId: string, hour?: number) => {
    setBusy(true);
    try {
      const now = new Date();
      const day = new Date(weekStart); day.setDate(day.getDate() + dayIndex);
      let start: Date;
      if (hour !== undefined) {
        start = new Date(day);
        start.setHours(Math.floor(hour), hour % 1 === 0.5 ? 30 : 0, 0, 0);
      } else {
        start = new Date(day); start.setHours(10, 0, 0, 0);
        const isToday = dayIndex === (now.getDay() + 6) % 7;
        if (isToday && now.getTime() > start.getTime()) {
          start = new Date(now); start.setMinutes(0, 0, 0); start.setHours(start.getHours() + 1);
        }
      }
      const idea = ideas.find((i) => i.id === taskId);
      // 修复 P0：已排期任务拖动必须保留原时长（从 scheduled 找原 start/end），否则 3h 任务被静默改成 1h
      const sched = scheduled.find((s) => s.id === taskId);
      let dur = 60;
      if (idea?.estimatedMinutes && idea.estimatedMinutes > 0) dur = idea.estimatedMinutes;
      else if (sched?.startTime && sched.endTime) dur = Math.max(30, Math.round((new Date(sched.endTime).getTime() - new Date(sched.startTime).getTime()) / 60000));
      const r = await fetch("/api/plan/apply-decision", {
        method: "POST", headers: { "Content-Type": "application/json" },
        // 修复 P1-4：拖动已排期任务带 scheduleId，只替换目标那条（防重复任务被折叠清空）
        body: JSON.stringify({ changes: [{ taskId, newStart: start.toISOString(), newEnd: new Date(start.getTime() + dur * 60000).toISOString(), scheduleId: sched?.scheduleId }] }),
      });
      if (!r.ok) throw new Error("排期失败");
      await load(true);
    } catch { setError(true); }
    finally { setBusy(false); }
  }, [ideas, scheduled, load, weekStart]);

  // 从计划移除（删 schedule 保留任务）
  const removeSchedule = useCallback(async (taskId: string) => {
    if (!window.confirm("从计划中移除该任务？任务本身会保留在收集箱。")) return;
    setBusy(true);
    try {
      const r = await fetch("/api/plan/delete", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ taskId }),
      });
      if (!r.ok) throw new Error("移除失败");
      setModal(null);
      setDetail(null);
      await load(true);
    } catch { setError(true); }
    finally { setBusy(false); }
  }, [load]);

  // 开始/完成
  const doTaskAction = useCallback(async (taskId: string, action: string) => {
    setBusy(true);
    try {
      const r = await fetch(`/api/tasks/${taskId}/action`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      if (!r.ok) throw new Error("操作失败");
      setDetail(null);
      await load(true);
    } catch { setError(true); }
    finally { setBusy(false); }
  }, [load]);

  const weekRange = (() => {
    const f = (d: Date) => `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, "0")}.${String(d.getDate()).padStart(2, "0")}`;
    const we = new Date(weekStart); we.setDate(we.getDate() + 6);
    return `${f(weekStart)} - ${f(we)}`;
  })();

  if (loading) return <div className="space-y-3"><div className="h-8 w-56 rounded bg-[var(--color-gray-100)] animate-pulse" /><div className="h-32 rounded-xl bg-[var(--color-gray-100)] animate-pulse" /><div className="h-72 rounded-xl bg-[var(--color-gray-100)] animate-pulse" /></div>;
  if (error) return (
    <div className="text-center py-16">
      <div className="text-[15px] font-medium text-[var(--v2-text)] mb-2">加载周计划失败</div>
      <button onClick={() => load()} className="text-sm px-4 py-2 rounded-lg bg-[var(--v2-brand)] text-white hover:bg-[var(--v2-brand-deep)] transition">重试</button>
    </div>
  );

  return (
    <div>
      {/* 收尾批次 A1：续排 toast */}
      {contToast && (
        <div className="fixed left-1/2 bottom-8 -translate-x-1/2 z-[99] bg-[#1f2937] text-white text-[13px] px-4 py-2.5 rounded-xl shadow-lg max-w-[80vw] text-center whitespace-nowrap">
          {contToast}
        </div>
      )}

      {/* 页头（方案顺手项 1：副标题弱化 · 窄屏换行） */}
      <div className="flex items-end justify-between mb-4 flex-wrap gap-2">
        <div>
          <h2 className="text-[24px] font-semibold tracking-[-0.3px] text-[var(--v2-text)]">Plan · 规划</h2>
          <p className="text-xs text-[var(--v2-text3)]/70 mt-1">时间放进去，未来才看得见</p>
        </div>
      </div>

      {/* 本周截止（顶部折叠条 · 方案 §2：默认收起，露 badge「N 个截止」） */}
      {(() => { const dl = deadlineStats(active); return (
        <CollapseSection
          title="本周截止"
          badge={dl.items.length > 0 ? `${dl.items.length} 个${dl.urgentCount > 0 ? ` · ${dl.urgentCount} 个紧急` : ""}` : "无"}
          badgeTone={dl.urgentCount > 0 ? "danger" : "gray"}>
          <DeadlineBody items={dl.items} />
        </CollapseSection>
      ); })()}

      {/* 周计划头（设计稿 .plan-header：标题 + 日期范围 + ← 本周 →） */}
      <div className="text-center mb-3">
        <div className="text-[18px] font-semibold text-[var(--v2-text)]">周计划</div>
        <div className="text-[13px] text-[var(--v2-text2)] mt-0.5 mb-1.5 tabular-nums">{weekRange}</div>
        <div className="flex items-center justify-center gap-3">
          <button onClick={() => setWeekOffset((o) => o - 1)} aria-label="上一周"
            className="text-sm text-[var(--v2-text3)] hover:text-[var(--v2-brand)] hover:bg-[var(--v2-brand-bg)] rounded px-1.5 py-0.5 transition">←</button>
          <span className="text-[13px] font-medium text-[var(--v2-text)] min-w-[3em] text-center">{weekOffset === 0 ? "本周" : weekOffset < 0 ? "上周" : "下周"}</span>
          <button onClick={() => setWeekOffset((o) => o + 1)} aria-label="下一周"
            className="text-sm text-[var(--v2-text3)] hover:text-[var(--v2-brand)] hover:bg-[var(--v2-brand-bg)] rounded px-1.5 py-0.5 transition">→</button>
        </div>
      </div>

      <WeekCalendar tasks={scheduled} focus={focus} weekStart={weekStart} weekOffset={weekOffset} peakHours={peakHours}
        onToggleFocus={() => setFocus((f) => !f)} onDropTask={dropTask}
        onTaskClick={(t, pos) => setDetail({ pos: pos ?? null, seed: { taskId: t.id, title: t.title, startTime: t.startTime, endTime: t.endTime, category: t.category, estimatedMinutes: t.estimatedMinutes ?? null, source: t.source } })} />

      {/* 收尾批次 A1：续排建议条（收集箱上方 · 默认收起露 badge） */}
      <ContinuationBar items={continuations} busyId={contBusyId} onContinue={continueTomorrow} />

      {/* 收集箱（贴周历 · 拖拽源） */}
      <IdeaPool ideas={ideas}
        onOpen={(i) => setDetail({ pos: null, seed: { taskId: i.id, title: i.title, category: i.category, estimatedMinutes: i.estimatedMinutes, source: i.source } })}
        onDragStart={() => {}} />

      {/* 计划健康度（沉底折叠条 · 方案 §2：默认收起，展开显示健康分 + 首条问题） */}
      {health && (
        <CollapseSection title="计划健康度" badge={`${health.healthScore} 分`}>
          <div className="flex items-center gap-3 pt-1">
            <div className="flex-1 h-1.5 rounded-full bg-[#f3f4f6] overflow-hidden max-w-[180px]">
              <div className="h-full rounded-full transition-all" style={{ width: `${health.healthScore}%`, background: health.healthScore >= 80 ? "var(--v2-green)" : health.healthScore >= 50 ? "#fbbf24" : "var(--color-danger-text)" }} />
            </div>
            {health.issues.length > 0 ? (
              <span className="text-xs text-[var(--v2-text2)]">{health.issues[0].message}</span>
            ) : (
              <span className="text-xs text-[var(--v2-text2)]">本周计划分布合理</span>
            )}
          </div>
          {health.issues.length > 1 && (
            <div className="mt-2 space-y-1">
              {health.issues.slice(1).map((iss, i) => (
                <div key={i} className="text-xs text-[var(--v2-text3)]">· {iss.message}</div>
              ))}
            </div>
          )}
        </CollapseSection>
      )}

      {modal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30" onClick={() => setModal(null)}>
          <div className="bg-white rounded-xl shadow-xl p-5 w-[340px]" onClick={(e) => e.stopPropagation()}>
            <div className="text-sm font-semibold text-[var(--v2-text)] mb-3 truncate">{modal.title}</div>
            <ScheduleModalInner target={modal} busy={busy}
              onSave={(taskId, start, end) => saveSchedule(taskId, start, end, scheduled.find((s) => s.id === taskId)?.scheduleId)}
              onClose={() => setModal(null)} />
            <div className="flex justify-between items-center mt-4 pt-3 border-t border-[var(--v2-border)]">
              {scheduled.some((s) => s.id === modal.taskId) ? (
                <button onClick={() => removeSchedule(modal.taskId)} disabled={busy}
                  className="text-sm px-2.5 py-1 rounded border border-[var(--color-danger-border)] bg-white text-[var(--color-danger-text)] hover:bg-[var(--color-danger-bg)] transition disabled:opacity-50">
                  从计划移除
                </button>
              ) : <span />}
            </div>
          </div>
        </div>
      )}

      {detail && (
        <TaskDetailPopover
          seed={detail.seed}
          pos={detail.pos}
          busy={busy}
          onClose={() => setDetail(null)}
          onEditTime={(taskId) => {
            const s = scheduled.find((x) => x.id === taskId);
            setDetail(null); // 修复：先关闭浮层再开弹窗，避免两个 fixed 容器互相遮挡
            setModal({ taskId, title: detail.seed.title, initialStart: s?.startTime });
          }}
          onRemove={removeSchedule}
          onAction={doTaskAction}
        />
      )}
    </div>
  );
}

function ScheduleModalInner({ target, busy, onSave, onClose }: {
  target: { taskId: string; title: string; initialStart?: string };
  busy: boolean;
  onSave: (taskId: string, newStart: string, newEnd: string) => void;
  onClose: () => void;
}) {
  // B2 修复：initialStart 是 UTC ISO 串，必须转本地时间再进 datetime-local（原来直接 slice(0,16) 差 8 小时）
  const toLocalInput = (d: Date) => {
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  };
  const [start, setStart] = useState(() => {
    if (target.initialStart) return toLocalInput(new Date(target.initialStart));
    return toLocalInput(new Date(Date.now() + 30 * 60000));
  });
  const [end, setEnd] = useState(() => {
    if (target.initialStart) {
      return toLocalInput(new Date(new Date(target.initialStart).getTime() + 3600000));
    }
    return toLocalInput(new Date(Date.now() + 90 * 60000));
  });

  return (
    <>
      <div className="space-y-2.5">
        <div>
          <label className="text-sm text-[var(--v2-text3)] block mb-1">开始时间</label>
          <input type="datetime-local" value={start} onChange={(e) => setStart(e.target.value)}
            className="w-full px-2.5 py-1.5 text-sm border border-[var(--v2-border)] rounded outline-none focus:border-[var(--v2-brand)]" />
        </div>
        <div>
          <label className="text-sm text-[var(--v2-text3)] block mb-1">结束时间</label>
          <input type="datetime-local" value={end} onChange={(e) => setEnd(e.target.value)}
            className="w-full px-2.5 py-1.5 text-sm border border-[var(--v2-border)] rounded outline-none focus:border-[var(--v2-brand)]" />
        </div>
      </div>
      <div className="flex justify-end gap-2 mt-4">
        <button onClick={onClose} className="px-3 py-1.5 text-sm rounded border border-[var(--v2-border)] bg-white text-[var(--v2-text2)] hover:bg-[var(--color-gray-50)] transition">取消</button>
        {/* 时区根治：datetime-local 是本地无时区值，必须转 UTC ISO 再提交，
            否则后端按服务器时区（Vercel=UTC）解析 → 9 点被存成 UTC 9 点 → 显示 17 点/20 点 */}
        <button onClick={() => onSave(target.taskId, new Date(start).toISOString(), new Date(end).toISOString())} disabled={busy || !start || !end}
          className="px-3.5 py-1.5 text-sm font-medium rounded bg-[var(--v2-brand)] text-white hover:bg-[var(--v2-brand-deep)] transition disabled:opacity-50">
          {busy ? "保存中…" : "排入计划"}
        </button>
      </div>
    </>
  );
}
