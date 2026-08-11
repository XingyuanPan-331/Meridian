"use client";

import Link from "next/link";
import { useEffect, useState, useCallback } from "react";
import { useSession } from "next-auth/react";
import { FocusCardV2, type FocusCardV2Data, type FcV2Phase, type FcV2Type } from "@/components/today/FocusCardV2";

/* ═══════════════════════════════════════════
   Today · V2 视觉语言（阶段 2：对接真实数据）
   · 数据源：/api/views/today + /api/user-state
   · Focus Card 形态由数据推断：有子任务→清单型 / 有排期→计时型 / 否则→学习型
   · 轮播 = 当前任务 + mustDo 真实任务
   色板全部取自设计稿 V2 token（--v2-*）
   ═══════════════════════════════════════════ */

/* ── 真实数据形态 ── */
interface CurrentTask {
  id: string; title: string; description: string | null;
  taskType: string | null; category: string | null; parentTitle: string | null;
  parentId?: string | null; // 收尾批次 C：树匹配优先用 id（后端返回后生效）
  // FCV2：动机（继承后最终值）+ 出发时刻
  purpose?: string | null;
  departureAt?: string | null;
  theme?: string | null;
  accumulate?: boolean;
  streak?: { current: number; longest: number; lastDate: string | null; todayChecked: boolean; last30: string[] } | null;
  accumStats?: {
    freqType: "daily" | "weekly"; weekTarget: number;
    weekDates: string[]; weekCount: number;
    monthDates: string[]; monthCount: number; monthTotalDays: number;
    totalMinutes: number;
  } | null;
  children: { id: string; text: string; done: boolean }[];
  scheduledStart: string | null; scheduledEnd: string | null;
  elapsedMinutes: number; remainingMinutes: number; plannedMinutes: number; completionPercent: number;
}
interface MustDoTask {
  taskId: string; title: string; reasons?: string[];
  estimatedMinutes?: number;
  // 修复：Focus Card 兜底卡真实数据（today view 增强返回 —— children 清单/描述/排期等）
  children?: { id: string; text: string; done: boolean }[];
  description?: string | null;
  taskType?: string | null; status?: string;
  accumulate?: boolean;
  departureAt?: string | null;
  purpose?: string | null;
  category?: string | null;
  scheduledStart?: string | null;
  scheduledEnd?: string | null;
}
interface TimelineItem { taskId: string; title: string; start: string; end: string | null; duration: string; isCurrent: boolean; }
interface TodayResponse {
  currentTask: CurrentTask | null;
  todayTimeline: TimelineItem[];
  mustDo: MustDoTask[];
  recommended: MustDoTask[];
  alerts: { type: string; taskId: string; title: string; message: string }[];
  brief: { greeting: string; topTasks: { taskId: string; title: string; reason: string }[]; stateDescription: string; suggestion: string } | null;
  executionAdvice: { message?: string; reasons?: string[] } | null;
  currentState: { energy: string | null; focus: string | null; mood: string | null; stress: string | null; stateDescription: string | null };
  todayStats: { completedCount: number; totalMinutes: number };
}

function getGreeting(n?: string | null): string {
  const h = new Date().getHours();
  const t = h < 12 ? "早上好" : h < 18 ? "下午好" : "晚上好";
  return n ? `${t}，${n}` : t;
}

const STATE_TEXT: Record<string, Record<string, string>> = {
  energy: { low: "精力不足", medium: "精力正常", high: "精力充沛", normal: "精力正常" },
  focus: { distracted: "容易分心", normal: "准备开始", focused: "专注中" },
  mood: { negative: "情绪低落", neutral: "状态平稳", positive: "感觉很好" },
  stress: { low: "状态轻松", medium: "压力正常", high: "压力偏高", normal: "压力正常" },
};
const STATE_EMOJI: Record<string, Record<string, string>> = {
  energy: { low: "😴", medium: "⚡", high: "⚡", normal: "⚡" },
  focus: { distracted: "💤", normal: "🎯", focused: "🎯" },
  mood: { negative: "😞", neutral: "😌", positive: "😊" },
  stress: { low: "😊", medium: "🧘", high: "😣", normal: "🧘" },
};

const cardCls = "bg-[var(--v2-card)] rounded-xl border border-[var(--v2-border)] sh-v2";
/* ── 真实任务 → 卡片契约映射 ── */
function toCard(t: CurrentTask): { card: FocusCard; extra: { statText: string; tagLabel: string; hint: string } } {
  const children = t.children ?? [];
  const hasChildren = children.length > 0;
  const hasSchedule = !!t.scheduledStart;
  const type: "timer" | "checklist" | "learning" | "accumulate" = t.accumulate ? "accumulate" : hasChildren ? "checklist" : hasSchedule ? "timer" : "learning";
  const doneCount = children.filter((c) => c.done).length;
  const totalCount = children.length || 1;
  const freq = t.accumStats?.freqType;
  const tagLabel = type === "timer" ? "计时型" : type === "checklist" ? "清单型" : type === "learning" ? "学习型" : `积累型 · ${freq === "weekly" ? "频次" : "每日"}`;
  const hint = type === "timer" ? "上课、开会、吃饭 — 时间到了就结束" : type === "checklist" ? "做产品/项目 — 以产出清单为准，计时是辅助" : type === "learning" ? "学书本知识 — 勾好一节继续下一节，可逆" : freq === "weekly" ? "隔天练 · 中断不算断" : "每天点一次打卡，断了就从头数";
  const statText = type === "timer"
    ? `${String(Math.floor(t.elapsedMinutes / 60)).padStart(2, "0")}:${String(t.elapsedMinutes % 60).padStart(2, "0")}`
    : type === "checklist" ? `已完成 ${doneCount}/${totalCount} · 总耗时 ${t.elapsedMinutes} 分钟` : type === "learning" ? `已学 ${doneCount}/${totalCount} 节 · 总耗时 ${t.elapsedMinutes} 分钟` : `已打卡 ${t.accumStats?.weekCount ?? 0} 次 · 连续 ${t.streak?.current ?? 0} 天`;
  return {
    card: {
      id: t.id,
      parent: t.parentTitle || "无归属项目",
      title: t.title,
      description: t.description,
      type,
      plannedMinutes: t.plannedMinutes || 0,
      doneCount,
      totalCount,
      progress: t.completionPercent ?? 0,
      elapsedMinutes: t.elapsedMinutes || 0,
      items: children.map((c) => ({ id: c.id, text: c.text, done: c.done })),
      aiExec: "",
      accumulate: t.accumulate || false,
      streak: t.streak ?? null,
      accumStats: t.accumStats ?? null,
    },
    extra: { statText, tagLabel, hint },
  };
}

/* ── 卡片数据形态（V2 契约） ── */
interface FocusCard {
  id: string;
  parent: string;
  title: string;
  description?: string | null;
  type: "timer" | "checklist" | "learning" | "accumulate";
  plannedMinutes: number;
  doneCount: number;
  totalCount: number;
  progress: number;
  elapsedMinutes: number;
  items: { id: string; text: string; done: boolean }[];
  aiExec: string;
  accumulate?: boolean;
  streak?: { current: number; longest: number; lastDate: string | null; todayChecked: boolean; last30: string[] } | null;
  accumStats?: {
    freqType: "daily" | "weekly"; weekTarget: number;
    weekDates: string[]; weekCount: number;
    monthDates: string[]; monthCount: number; monthTotalDays: number;
    totalMinutes: number;
  } | null;
}

/* ── 真实任务 → V2 卡片映射（FCV2：直读后端 Task.purpose / Task.departureAt） ── */

/* 收尾批次 C：项目树节点（/api/projects/tree · doneCount/totalCount 后端就绪后消费，前端递归兜底） */
interface ProjTreeNode {
  id: string; title: string; level: string; status: string;
  doneCount?: number | null; totalCount?: number | null;
  children: ProjTreeNode[];
}
const countDone = (n: ProjTreeNode): number => (n.status === "completed" ? 1 : 0) + (n.children || []).reduce((s, c) => s + countDone(c), 0);
const countTotal = (n: ProjTreeNode): number => 1 + (n.children || []).reduce((s, c) => s + countTotal(c), 0);
/** 收尾批次 D：monthDates mock 占位（确定性：本月隔天 + 今天，后端未返回该字段时用） */
function mockMonthDates(): string[] {
  const out: string[] = [];
  const now = new Date();
  const y = now.getFullYear();
  const m = now.getMonth();
  const today = now.getDate();
  for (let d = 1; d <= today; d++) {
    if (d % 2 === 1 || d === today) out.push(`${y}-${String(m + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`);
  }
  return out;
}
/** 按 parentTitle 名称链在树中匹配祖先节点（找不到 = 孤儿 → 空链） */
function matchChain(trees: ProjTreeNode[], names: string[]): ProjTreeNode[] {
  let level = trees;
  const chain: ProjTreeNode[] = [];
  for (const name of names) {
    const hit = level.find((n) => n.title === name);
    if (!hit) return [];
    chain.push(hit);
    level = hit.children || [];
  }
  return chain;
}
function buildAncestry(t: CurrentTask, trees: ProjTreeNode[]): { stages: { name: string; done?: boolean; current?: boolean }[] | undefined; projectProgress: { done: number; total: number } | undefined } {  const names = (t.parentTitle || "").split(" / ").map((s) => s.trim()).filter(Boolean);
  if (!names.length) return { stages: undefined, projectProgress: undefined };
  const chain = matchChain(trees, names);
  if (!chain.length) return { stages: undefined, projectProgress: undefined };
  // stages：project/phase 级入链；最后一级 = 直接父级（current）
  const stages = chain.filter((n) => n.level === "project" || n.level === "phase").map((n, i, arr) => ({
    name: n.title,
    done: n.status === "completed",
    current: i === arr.length - 1,
  }));
  // projectProgress：最近一个有子级的祖先（doneCount/totalCount 优先，前端递归兜底）
  let progressNode: ProjTreeNode | null = null;
  for (let i = chain.length - 1; i >= 0; i--) {
    if ((chain[i].children || []).length > 0) { progressNode = chain[i]; break; }
  }
  const projectProgress = progressNode ? {
    done: progressNode.doneCount ?? countDone(progressNode),
    total: progressNode.totalCount ?? countTotal(progressNode),
  } : undefined;
  return { stages: stages.length ? stages : undefined, projectProgress };
}

function toCardV2(t: CurrentTask, trees: ProjTreeNode[] = []): FocusCardV2Data {
  const children = t.children ?? [];
  const hasChildren = children.length > 0;
  const hasSchedule = !!t.scheduledStart;
  // BUG-20260808-052：timer（固定时间·到点自动完成）只属于 taskType=scheduled 的任务——
  // planned 任务被用户拖拽排期后并不"到点自动完成"（惰性结算仅对 scheduled 生效），
  // 原判定 hasSchedule→timer 导致无子任务的 planned 任务误显示固定时间卡（无「出发」按钮，提前执行不可达）。
  const isScheduled = t.taskType === "scheduled";
  const type: FcV2Type = t.accumulate ? (t.accumStats?.freqType === "weekly" ? "accum-weekly" : "accum-daily") : hasChildren ? "checklist" : hasSchedule && isScheduled ? "timer" : "learning";
  const freq = t.accumStats?.freqType;
  const purposeHint = type === "timer" ? "固定时间 · 到点自动完成" : type === "checklist" ? "做产品/项目" : type === "learning" ? "学书本知识" : freq === "weekly" ? "隔天练 · 中断不算断" : "每天坚持一点点";
  const parent = t.parentTitle || "无归属项目";
  // 收尾批次 C：左栏项目阶段（树接口直读）
  const ancestry = buildAncestry(t, trees);
  // FCV2 phase：出发时刻 + 状态推导（in_progress=going，completed=done，有 departureAt 未完成=confirm）
  const departureAt = t.departureAt ?? null;
  const phase: FcV2Phase = t.taskType === "completed" ? "done" : departureAt ? "going" : "unstarted";
  return {
    id: t.id,
    type,
    title: t.title,
    parent,
    purpose: t.purpose || undefined,  // FCV2：直读后端（含父级继承后值；空则不显示）
    departureAt,                          // FCV2：直读后端出发时刻
    phase,
    scheduledStart: t.scheduledStart,
    scheduledEnd: t.scheduledEnd,
    plannedMinutes: t.plannedMinutes || 0,
    elapsedMinutes: t.elapsedMinutes || 0,
    remainingMinutes: t.remainingMinutes || 0,
    progress: t.completionPercent ?? 0,
    items: children.map((c) => ({ id: c.id, text: c.text, done: c.done })),
    streak: t.streak ? { current: t.streak.current ?? 0, longest: t.streak.longest ?? 0 } : undefined,
    weekTarget: t.accumStats?.weekTarget,
    weekCount: t.accumStats?.weekCount,
    monthCount: t.accumStats?.monthCount,
    monthTotalDays: t.accumStats?.monthTotalDays,
    totalMinutes: t.accumStats?.totalMinutes,
    weekDates: t.accumStats?.weekDates,
    // 收尾批次 D：mini-cal 当月打卡日期（后端 accumStats.monthDates 已就绪；undefined 时 mock 占位保证验收）
    monthDates: t.accumStats?.monthDates ?? mockMonthDates(),
    aiHint: undefined,
    description: t.description,
    // 收尾批次 C：左栏项目阶段直读树接口（去 mock）
    stages: ancestry.stages,
    projectProgress: ancestry.projectProgress,
  };
}

/* ── 今日状态（沉底折叠条 · 方案 §1：自我汇报低频交互，默认收起；逻辑不动只包折叠） ── */
const STATE_OPTIONS: Record<string, { key: string; label: string }[]> = {
  energy: [{ key: "high", label: "充沛" }, { key: "medium", label: "正常" }, { key: "low", label: "不足" }],
  focus: [{ key: "focused", label: "专注" }, { key: "normal", label: "一般" }, { key: "distracted", label: "分心" }],
  mood: [{ key: "positive", label: "好" }, { key: "neutral", label: "平稳" }, { key: "negative", label: "低落" }],
  stress: [{ key: "low", label: "轻松" }, { key: "medium", label: "正常" }, { key: "high", label: "偏高" }],
};

function StatusBar({ state, onSave }: { state: TodayResponse["currentState"]; onSave: (data: Record<string, string>) => Promise<void> }) {
  const [open, setOpen] = useState(false); // 折叠条：默认收起
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const items = (["energy", "focus", "mood", "stress"] as const)
    .map((k) => ({ key: k, emoji: STATE_EMOJI[k][state[k] ?? "normal"] ?? "🙂", text: STATE_TEXT[k][state[k] ?? "normal"] ?? "未知" }))
    .filter((i) => i.text !== "未知");

  const openEdit = () => {
    setOpen(true);
    setDraft({
      energy: state.energy || "medium",
      focus: state.focus || "normal",
      mood: state.mood || "neutral",
      stress: state.stress || "medium",
    });
    setEditing(true);
  };

  const save = async () => {
    setSaving(true);
    try { await onSave(draft); setEditing(false); } finally { setSaving(false); }
  };

  return (
    <div className="rounded-lg bg-[var(--v2-card)] border border-[var(--v2-border)] sh-v2 text-sm text-[var(--v2-text2)] overflow-hidden">
      {/* 折叠头：点击展开/收起（"调整"独立按钮不触发折叠） */}
      <div className="flex items-center px-4 py-2.5 cursor-pointer select-none" onClick={() => setOpen((v) => !v)}>
        <span className="text-sm font-semibold text-[var(--v2-text2)] mr-2 whitespace-nowrap">今日状态</span>
        <span className="flex-1 truncate min-w-0">{items.length > 0 ? items.map((s) => `${s.emoji} ${s.text}`).join(" · ") : "暂无状态"}</span>
        <span className="text-xs text-[var(--v2-brand)] cursor-pointer whitespace-nowrap ml-2" onClick={(e) => { e.stopPropagation(); openEdit(); }}>调整</span>
        <span className={`text-[10px] text-[var(--v2-text3)] ml-2 transition-transform ${open ? "rotate-180" : ""}`}>▼</span>
      </div>
      {/* 展开体：状态展示 + 内联调整（逻辑原样） */}
      {open && (
        <div className="px-4 pb-3 border-t border-[var(--v2-border)]">
          {editing ? (
            <div className="bg-[var(--color-gray-50)] -mx-4 px-4 pb-3 pt-2.5">
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                {(Object.keys(STATE_OPTIONS) as (keyof typeof STATE_OPTIONS)[]).map((k) => (
                  <div key={k}>
                    <div className="text-sm text-[var(--v2-text3)] mb-1">{k === "energy" ? "精力" : k === "focus" ? "专注" : k === "mood" ? "情绪" : "压力"}</div>
                    <div className="flex gap-1">
                      {STATE_OPTIONS[k].map((opt) => (
                        <button key={opt.key} onClick={() => setDraft((d) => ({ ...d, [k]: opt.key }))}
                          className={`flex-1 text-sm px-1.5 py-1 rounded border transition ${draft[k] === opt.key ? "bg-[var(--v2-brand)] text-white border-[var(--v2-brand)]" : "bg-white text-[var(--v2-text2)] border-[var(--v2-border)] hover:border-[var(--v2-brand)]"}`}>
                          {opt.label}
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
              <div className="flex justify-end gap-2 pt-2.5">
                <button onClick={() => setEditing(false)} className="text-sm px-3 py-1 rounded bg-white border border-[var(--v2-border)] text-[var(--v2-text2)]">取消</button>
                <button onClick={save} disabled={saving} className="text-sm px-3 py-1 rounded bg-[var(--v2-brand)] text-white disabled:opacity-50">
                  {saving ? "保存中…" : "保存状态"}
                </button>
              </div>
            </div>
          ) : (
            <div className="pt-2.5 text-sm text-[var(--v2-text3)]">今天状态有变化时，点「调整」更新（精力 / 专注 / 情绪 / 压力）</div>
          )}
        </div>
      )}
    </div>
  );
}

/* ── 今日路线（B5：点击项切换 Focus Card + hover「提前执行」） ── */
function RouteCard({ route, onSelect, onStartNow, busy }: {
  route: TimelineItem[];
  onSelect?: (taskId: string) => void;
  onStartNow?: (taskId: string) => void;
  busy?: boolean;
}) {
  return (
    <div className="bg-[var(--v2-card)] border border-[var(--v2-border)] rounded-xl sh-v2 overflow-hidden mb-2">
      <div className="px-3.5 pt-2.5 pb-1 text-sm font-semibold text-[var(--v2-text2)]">今日路线</div>
      {route.length === 0 && <div className="px-3.5 pb-3 text-sm text-[var(--v2-text3)]">今天还没有安排</div>}
      {route.map((r) => (
        <div key={r.taskId + r.start} onClick={() => onSelect?.(r.taskId)}
          className={`group flex items-center gap-2 px-3.5 py-[5px] ${onSelect ? "cursor-pointer hover:bg-[var(--v2-brand-bg)]/50 transition" : ""}`}>
          <span className="text-sm text-[var(--v2-text3)] min-w-[36px] tabular-nums">{new Date(r.start).toTimeString().slice(0, 5)}</span>
          <span className="w-[7px] h-[7px] rounded-full shrink-0" style={{ background: r.isCurrent ? "#3B82F6" : "var(--color-gray-300)" }} />
          <span className={`text-sm flex-1 min-w-0 truncate ${r.isCurrent ? "font-medium text-[var(--v2-text)]" : "text-[var(--v2-text2)]"}`}>{r.title}</span>
          {r.isCurrent && <span className="text-xs px-1.5 py-px rounded-lg font-medium bg-[#DBEAFE] text-[#1E40AF]">进行中</span>}
          {!r.isCurrent && onStartNow && (
            <button
              onClick={(e) => { e.stopPropagation(); onStartNow(r.taskId); }}
              disabled={busy}
              className="text-xs px-2 py-1 rounded-lg font-medium bg-[var(--v2-brand)] text-white opacity-0 group-hover:opacity-100 transition disabled:opacity-50 shrink-0"
              title="提前执行：开始该任务并切入 Focus Card"
            >提前执行</button>
          )}
        </div>
      ))}
    </div>
  );
}

/* ── AI 调整助手（设计稿：建议列表 + 底部对话输入"排期与重规划"） ── */
function AiPanel({ text, recommendations, onAdopt, busy }: { text: string; recommendations: MustDoTask[]; onAdopt: (task: MustDoTask) => void; busy?: boolean }) {
  const [input, setInput] = useState("");
  const [reply, setReply] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const send = async () => {
    const q = input.trim();
    if (!q || sending) return;
    setSending(true);
    try {
      const r = await fetch("/api/agent/chat", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ input: q }),
      });
      const d = await r.json();
      setReply(d.message || "已收到你的安排，正在调整排期…");
    } catch { setReply("AI 服务暂不可用，稍后再试"); }
    finally { setSending(false); setInput(""); }
  };
  return (
    <div className="bg-[var(--v2-card)] border border-[#C7D2FE] rounded-xl sh-v2 overflow-hidden">
      <div className="bg-[var(--v2-purple-bg)] px-3.5 py-2 flex items-center justify-between border-b border-[#DDD6FE]">
        <span className="text-sm font-semibold text-[var(--v2-purple)]">AI 调整助手</span>
        <span className="text-xs text-[#A78BFA]">排期与重规划</span>
      </div>
      {/* 输入框上移（V3 §7.1：先输入/提问，再浏览建议；从面板底部移到紫色标题栏正下方） */}
      <div className="flex gap-2 p-3 border-b border-[#DDD6FE] bg-white">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") send(); }}
          placeholder="告诉 AI 你的新安排，帮你重排…"
          className="flex-1 text-sm px-3 py-1.5 rounded-md border border-[#DDD6FE] bg-white focus:outline-none focus:border-[var(--v2-purple)] min-w-0"
        />
        <button onClick={send} disabled={sending || !input.trim()}
          className="text-sm px-4 py-2.5 min-h-[44px] rounded-md bg-[var(--v2-purple)] text-white font-medium disabled:opacity-50 shrink-0">
          {sending ? "…" : "发送"}
        </button>
      </div>
      <div className="p-3.5">
        {text && <p className="text-sm text-[#5B21B6] mb-2 leading-[1.5]">{text}</p>}
        {recommendations.length === 0 && <p className="text-sm text-[#A78BFA]">暂无建议 · 今天没有需要调整的安排</p>}
        {recommendations.map((r, i) => (
          <div key={r.taskId + i} className="px-2.5 py-1.5 bg-[var(--v2-purple-bg)] rounded-md flex items-center justify-between mb-1">
            <div className="min-w-0 mr-2">
              <div className="text-sm font-medium text-[#5B21B6] truncate">{r.title}</div>
              <div className="text-xs text-[#A78BFA] truncate">{r.reasons?.[0] || "建议优先处理"}</div>
            </div>
            <button onClick={() => onAdopt(r)} disabled={busy} className="text-sm px-3 py-1.5 rounded font-medium whitespace-nowrap bg-[var(--v2-purple)] text-white disabled:opacity-50">
              {busy ? "…" : "采纳"}
            </button>
          </div>
        ))}
        {reply && (
          <div className="mt-2 px-3 py-2 rounded-md bg-[var(--v2-purple-bg)] text-sm text-[#5B21B6] leading-[1.5]">{reply}</div>
        )}
      </div>
    </div>
  );
}

/* ── 页面 ── */
export default function TodayPage() {
  const { data: session } = useSession();
  const [cardIdx, setCardIdx] = useState(0);
  const [data, setData] = useState<TodayResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [busy, setBusy] = useState(false);

  // 收尾批次 C：项目树缓存（页面级 fetch 一次，不随卡片刷新重复请求）
  const [treeCache, setTreeCache] = useState<ProjTreeNode[]>([]);
  useEffect(() => {
    fetch("/api/projects/tree")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (d && Array.isArray(d.trees)) setTreeCache(d.trees as ProjTreeNode[]); })
      .catch(() => {});
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError(false);
    try {
      const r = await fetch("/api/views/today");
      if (!r.ok) throw new Error();
      const d = await r.json();
      setData(d);
    } catch { setError(true); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  // Bug 修复：档案面板删除/移出完成等变更 → 今日卡片/路线实时刷新
  useEffect(() => {
    const h = () => { load(); };
    window.addEventListener("meridian-task-changed", h);
    return () => window.removeEventListener("meridian-task-changed", h);
  }, [load]);

  // 任务操作：完成 / 跳过
  const doAction = useCallback(async (taskId: string, action: string, extra: Record<string, unknown> = {}) => {
    setBusy(true);
    try {
      const r = await fetch(`/api/tasks/${taskId}/action`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, ...extra }),
      });
      if (!r.ok) throw new Error("操作失败");
      // BUG-20260807-043：完成当前前置卡后清除 routeSel——否则静态"未出发"前置卡占位，
      // currentTask 为空时 mustDo 兜底卡（学习型等无排期任务）永不显示。
      if (action === "complete") setRouteSel(null);
      await load();
    } catch { setError(true); }
    finally { setBusy(false); }
  }, [load]);

  // 收尾批次 A2：明天继续（复制最近排期时段到明天 · Focus Card 次级按钮）
  const [contToast, setContToast] = useState<string | null>(null);
  const continueTomorrow = useCallback(async (taskId: string) => {
    setBusy(true);
    try {
      const r = await fetch(`/api/tasks/${taskId}/action`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "continue_tomorrow" }),
      });
      if (!r.ok) throw new Error("续排失败");
      const d = await r.json();
      const hm = d.nextStart ? new Date(d.nextStart) : null;
      setContToast(`已排到明天 ${hm ? `${String(hm.getHours()).padStart(2, "0")}:00` : ""} · 明天见`);
      setTimeout(() => setContToast(null), 2600);
      await load();
    } catch { setContToast("续排失败，请重试"); setTimeout(() => setContToast(null), 2600); }
    finally { setBusy(false); }
  }, [load]);

  // 积累型打卡（checkin TimeLog；FCV2：detail 打卡内容可选）
  const checkin = useCallback(async (taskId: string, detail?: string) => {
    setBusy(true);
    try {
      const r = await fetch(`/api/tasks/${taskId}/checkin`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(detail ? { detail } : {}),
      });
      if (!r.ok) throw new Error("打卡失败");
      await load();
    } catch { setError(true); }
    finally { setBusy(false); }
  }, [load]);

  // 保存状态
  const saveState = useCallback(async (data: Record<string, string>) => {
    const r = await fetch("/api/user-state", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
    if (!r.ok) throw new Error("状态保存失败");
    await load();
  }, [load]);

  // 采纳建议：把推荐任务排到今天（5 分钟后开始）
  const adopt = useCallback(async (task: MustDoTask) => {
    setBusy(true);
    try {
      const start = new Date(Date.now() + 5 * 60000);
      const dur = (task.estimatedMinutes && task.estimatedMinutes > 0 ? task.estimatedMinutes : 60) * 60000;
      const r = await fetch("/api/plan/apply-decision", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ changes: [{ taskId: task.taskId, newStart: start.toISOString(), newEnd: new Date(start.getTime() + dur).toISOString() }] }),
      });
      if (!r.ok) throw new Error("采纳失败");
      await load();
    } catch { setError(true); }
    finally { setBusy(false); }
  }, [load]);

  // P1-11：清单新增项（乐观更新 → POST /api/tasks 建子任务 → 刷新落库）
  const addChildItem = useCallback(async (parentId: string, title: string) => {
    const tmp: { id: string; text: string; done: boolean } = { id: `tmp-${Date.now()}`, text: title, done: false };
    // 乐观：立即出现在清单（仅当前任务卡可本地写；mustDo 兜底卡无 children 源则跳过）
    setData((prev) => (prev?.currentTask ? { ...prev, currentTask: { ...prev.currentTask, children: [...(prev.currentTask.children ?? []), tmp] } } : prev));
    try {
      const r = await fetch("/api/tasks", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, parentId, level: "task", taskType: "task" }),
      });
      if (!r.ok) throw new Error("创建失败");
      await load();
    } catch {
      setError(true);
      await load(); // 回滚乐观项
    }
  }, [load]);

  // 保存备注（Focus Card → 任务 description）
  const saveNote = useCallback(async (taskId: string, note: string) => {
    const r = await fetch(`/api/tasks/${taskId}`, {
      method: "PUT", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ description: note }),
    });
    if (!r.ok) throw new Error("保存失败");
    await load();
  }, [load]);

  // B5：今日路线点击选中的任务（切到 Focus Card 展示；null = 默认当前任务）
  const [routeSel, setRouteSel] = useState<string | null>(null);
  // BUG-20260807-044：路线选中任务详情（点击时 fetch）——前置卡不再写死 checklist+空清单，
  // 用真实 children/类型构造（清单型可勾选、学习型可加知识点、时间型显示固定时间）。
  const [routeSelTask, setRouteSelTask] = useState<CurrentTask | null>(null);

  // 子任务勾选（完成 ↔ 取消完成；Bug1 修复：已勾选的再次点击 = reopen 取消完成）
  // BUG-20260808-050：item 查找源从 currentTask 扩大到 currentTask/routeSelTask/mustDo/recommended
  // ——mustDo 兜底卡场景 currentTask 为 null，原实现 item 缺失 → 误判 reopen → 子任务永不变更
  const toggleChildItem = useCallback(async (childId: string) => {
    setBusy(true);
    try {
      const pool = [
        ...(data?.currentTask?.children ?? []),
        ...(routeSelTask?.children ?? []),
        ...(data?.mustDo ?? []).flatMap((m) => m.children ?? []),
        ...(data?.recommended ?? []).flatMap((m) => m.children ?? []),
      ];
      const item = pool.find((c) => c.id === childId);
      // done 判断兼容两种序列化：{text,done}（views/today）与 {title,status}（GET /api/tasks/:id）
      const done = item
        ? typeof (item as { done?: unknown }).done === "boolean"
          ? (item as { done: boolean }).done
          : (item as { status?: string }).status === "completed"
        : false;
      const action = done ? "reopen" : "complete";
      const r = await fetch(`/api/tasks/${childId}/action`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      if (!r.ok) throw new Error("操作失败");
      await load();
    } catch { setError(true); }
    finally { setBusy(false); }
  }, [data, routeSelTask, load]);

  // BUG-20260807-046：data（load 结果）变化时同步刷新 routeSelTask——否则勾选/新增子项后
  // 前置卡清单停留在点击时的旧快照（新增项不出现、勾选态不更新）。
  useEffect(() => {
    if (!routeSel) return;
    let alive = true;
    fetch(`/api/tasks/${routeSel}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (alive && d && d.id) setRouteSelTask(d as CurrentTask); })
      .catch(() => {});
    return () => { alive = false; };
  }, [routeSel, data]);

  // 卡片：路线选中优先 → 当前任务；无当前任务时显示第一个必做任务；都没有则空态
  // 修复：每张卡都生成完整 cardV2（Focus Card 渲染直用），mustDo 兜底卡带真实清单，
  // 避免 children=[] 被 toCardV2 误判为"知识点"且清单消失
  const cards = useCallback((): { card: FocusCard; tagLabel: string; statText: string; hint: string; cardV2: FocusCardV2Data }[] => {
    if (!data) return [];
    const list: { card: FocusCard; tagLabel: string; statText: string; hint: string; cardV2: FocusCardV2Data }[] = [];
    const curId = data.currentTask?.id ?? null;
    // 路线选中（非当前任务）→ 前置该任务的基础卡（含提前执行语义）
    if (routeSel && routeSel !== curId) {
      const tl = data.todayTimeline.find((t) => t.taskId === routeSel);
      if (tl) {
        // BUG-20260807-044：优先用点击时 fetch 的真实任务数据构造（children/类型正确）；
        // fetch 未返回前用时间线字段兜底（items 空，随后 routeSelTask 就绪自动补全）
        const rt = routeSelTask && routeSelTask.id === routeSel ? routeSelTask : null;
        const base = rt ?? ({
          id: tl.taskId, title: tl.title, description: null, taskType: null, category: null,
          parentTitle: null, children: [], scheduledStart: tl.start, scheduledEnd: tl.end,
          elapsedMinutes: 0, remainingMinutes: 0, plannedMinutes: 0, completionPercent: 0,
          purpose: null, departureAt: null, accumulate: false,
        } as CurrentTask);
        // BUG-20260807-045：GET /api/tasks/:id 的 children 字段是 title，toCardV2 期待 text →
        // 归一化（title → text），否则清单项文本为空（li 无字，勾选/显示均失效）。
        const normBase = {
          ...base,
          children: ((base as { children?: Array<Record<string, unknown>> }).children ?? []).map((c) => ({
            ...c, text: (c as { text?: string }).text ?? (c as { title?: string }).title ?? "",
          })),
        } as CurrentTask;
        const v2 = toCardV2(normBase, treeCache);
        const tagLabel = v2.type === "learning" ? "学习型" : v2.type === "timer" ? "时间型" : v2.type === "accum-daily" || v2.type === "accum-weekly" ? "积累型" : "清单型";
        list.push({
          card: {
            id: tl.taskId, parent: "今日路线", title: tl.title,
            type: v2.type === "accum-daily" || v2.type === "accum-weekly" ? "accumulate" : v2.type,
            plannedMinutes: 0, doneCount: v2.items?.filter((i) => i.done).length ?? 0, totalCount: v2.items?.length || 1,
            progress: v2.progress, elapsedMinutes: 0, items: v2.items ?? [], aiExec: "",
          },
          tagLabel, statText: "待开始", hint: "提前执行 · 点「出发」开始计时",
          cardV2: v2,
        });
      }
    }
    if (data.currentTask) {
      const { card, extra } = toCard(data.currentTask);
      list.push({ card, ...extra, cardV2: toCardV2(data.currentTask, treeCache) });
    } else {
      // BUG-20260807-047：mustDo 兜底跳过已完成任务——决策是静态快照（完成动作已删决策，
      // 但打开页面期间完成的场景仍可能命中旧快照），已完成任务不再占主卡。
      const m = data.mustDo.find((x) => x.status !== "completed" && x.status !== "cancelled") ?? data.mustDo[0];
      if (m) {
        // 修复：mustDo 卡用后端增强数据（真实清单 children）构造完整卡
        const v2 = toCardV2({ id: m.taskId, title: m.title, description: m.description ?? null, taskType: m.taskType ?? null, category: m.category ?? null, parentTitle: null, children: m.children ?? [], scheduledStart: m.scheduledStart ?? null, scheduledEnd: m.scheduledEnd ?? null, elapsedMinutes: 0, remainingMinutes: 0, plannedMinutes: m.estimatedMinutes || 0, completionPercent: 0, purpose: m.purpose ?? null, departureAt: m.departureAt ?? null, accumulate: m.accumulate ?? false } as CurrentTask, treeCache);
        list.push({
          card: {
            id: m.taskId, parent: "今日必做", title: m.title,
            type: v2.type === "accum-daily" || v2.type === "accum-weekly" ? "accumulate" : v2.type,
            plannedMinutes: m.estimatedMinutes || 0, doneCount: v2.items?.filter((i) => i.done).length ?? 0, totalCount: v2.items?.length || 1,
            progress: v2.progress, elapsedMinutes: v2.elapsedMinutes, items: v2.items ?? [], aiExec: "",
          },
          tagLabel: v2.type === "learning" ? "学习型" : v2.type === "timer" ? "时间型" : "清单型",
          statText: "待开始", hint: "做产品/项目 — 以产出清单为准，计时是辅助",
          cardV2: v2,
        });
      }
    }
    return list;
  }, [data, routeSel, routeSelTask, treeCache]);

  const cardList = cards();
  const cur = cardList[Math.min(cardIdx, Math.max(0, cardList.length - 1))];
  const userName = session?.user?.name || null;

  // V3 §7.1 弹性双态：渲染后测量「问候语 + 主卡」实际高度判定（不写死清单条数阈值）
  // 滞回带宽 40px 防 max-w 切换引起高度回振（>560 进复杂态 / ≤520 回简单态）
  // D-新3：Today 全宽，删除弹性双态测量逻辑（原 2026-08-03 V3 §7.1）
  if (loading) return <div className="space-y-3"><div className="h-8 w-56 rounded bg-[var(--color-gray-100)] animate-pulse" /><div className="h-64 rounded-xl bg-[var(--color-gray-100)] animate-pulse" /><div className="h-10 rounded-lg bg-[var(--color-gray-100)] animate-pulse" /></div>;
  if (error) return (
    <div className="text-center py-16">
      <div className="text-[15px] font-medium text-[var(--v2-text)] mb-2">加载今日数据失败</div>
      <button onClick={load} className="text-sm px-4 py-2 rounded-lg bg-[var(--v2-brand)] text-white hover:bg-[var(--v2-brand-deep)] transition">重试</button>
    </div>
  );

  const aiPanelText = data?.brief?.suggestion || "暂无建议";

  return (
    <div className="space-y-4">
      {/* 收尾批次 A2：明天继续 toast */}
      {contToast && (
        <div className="fixed left-1/2 bottom-8 -translate-x-1/2 z-[99] bg-[#1f2937] text-white text-[13px] px-4 py-2.5 rounded-xl shadow-lg max-w-[80vw] text-center whitespace-nowrap">
          {contToast}
        </div>
      )}
      {/* D-新3：Today 全宽（推翻 V3 §7.1 弹性双态 · 与其他页面统一宽度体系） */}
      <div className="mx-auto max-w-[1080px]">
      <div className="space-y-4">
      {/* 页头：问候独立行 + 统计徽章（布局提示移入设置页，不再占位 · 窄屏换行） */}
      <div className="flex items-center justify-between mb-1 flex-wrap gap-2">
        <div>
          <h2 className="text-[24px] font-semibold tracking-[-0.3px] text-[var(--v2-text)]">{getGreeting(userName)}</h2>
          <div className="text-[13px] text-[var(--v2-text3)] mt-1">
            {new Date().toLocaleDateString("zh-CN", { year: "numeric", month: "2-digit", day: "2-digit", weekday: "long" })}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1.5 text-sm text-[var(--v2-text2)] bg-[var(--v2-card)] border border-[var(--v2-border)] rounded-lg px-3 py-1.5 sh-v2">
            <span className="text-[var(--v2-brand)] font-semibold tabular-nums">{data?.todayStats.completedCount ?? 0}</span> 完成
          </div>
          <div className="flex items-center gap-1.5 text-sm text-[var(--v2-text2)] bg-[var(--v2-card)] border border-[var(--v2-border)] rounded-lg px-3 py-1.5 sh-v2">
            <span className="text-[var(--v2-green)] font-semibold tabular-nums">{data?.todayStats.totalMinutes ?? 0}</span> 专注分钟
          </div>
        </div>
      </div>

      {/* Focus Card V2（真实 currentTask + mock purpose/departureAt；完成/勾选/打卡走真实 API） */}
      {cur ? (
        <div className="relative">
          {cardList.length > 1 && (
            <>
              <div className="absolute -left-9 top-1/2 -translate-y-1/2 z-10 hidden sm:block">
                <button onClick={() => setCardIdx((i) => (i - 1 + cardList.length) % cardList.length)} className="w-[30px] h-[30px] rounded-full border border-[var(--v2-border)] bg-white flex items-center justify-center text-[var(--v2-text2)] hover:border-[var(--v2-brand)] hover:text-[var(--v2-brand)] shadow-sm text-sm transition" aria-label="上一张">←</button>
              </div>
              <div className="absolute -right-9 top-1/2 -translate-y-1/2 z-10 hidden sm:block">
                <button onClick={() => setCardIdx((i) => (i + 1) % cardList.length)} className="w-[30px] h-[30px] rounded-full border border-[var(--v2-border)] bg-white flex items-center justify-center text-[var(--v2-text2)] hover:border-[var(--v2-brand)] hover:text-[var(--v2-brand)] shadow-sm text-sm transition" aria-label="下一张">→</button>
              </div>
            </>
          )}
          <FocusCardV2
            // 修复：直接使用 cards() 生成的完整 cardV2（含真实清单），不再用空 children 重包
            card={cur.cardV2}
            onStart={() => doAction(cur.card.id, "start")}
            onComplete={(min) => doAction(cur.card.id, "complete", min && min > 0 ? { durationMinutes: min } : {})}
            onSkip={() => doAction(cur.card.id, "skip_item", { reason: "user_skip_item" })}
            onCheckin={(detail) => checkin(cur.card.id, detail)}
            onPause={(reason) => doAction(cur.card.id, "pause", { reason })}
            onItemToggle={toggleChildItem}
            onItemAdd={(title) => addChildItem(cur.card.id, title)}
            onContinueTomorrow={() => continueTomorrow(cur.card.id)}
            busy={busy}
          />
          {cardList.length > 1 && (
            <div className="flex justify-center gap-1.5 mt-3">
              {cardList.map((c, i) => (
                <button key={c.card.id} onClick={() => setCardIdx(i)} className={`h-[6px] rounded-full transition-all ${i === cardIdx ? "w-5 bg-[var(--v2-brand)]" : "w-[6px] bg-[var(--color-gray-300)]"}`} aria-label={c.card.title} />
              ))}
            </div>
          )}
        </div>
      ) : (
        <div className={`${cardCls} py-12 px-6 text-center`}>
          <div className="w-12 h-12 mx-auto rounded-2xl bg-[var(--v2-brand-bg)] flex items-center justify-center text-xl mb-3">🎯</div>
          <div className="text-[15px] font-medium text-[var(--v2-text)] mb-1.5">当前没有正在执行的任务</div>
          <div className="text-sm text-[var(--v2-text3)] mb-5">把脑子里的事倒进 Inbox，或在 Plan 里排上今天</div>
          <div className="flex justify-center gap-2">
            <Link href="/inbox" className="text-sm px-4 py-2 rounded-lg bg-[var(--v2-brand)] text-white hover:bg-[var(--v2-brand-deep)] transition">去 Inbox 收集</Link>
            <Link href="/plan" className="text-sm px-4 py-2 rounded-lg border border-[var(--v2-border)] text-[var(--v2-text2)] hover:bg-[var(--color-gray-50)] transition">去 Plan 排期</Link>
          </div>
        </div>
      )}

      {/* 今日路线 | AI 调整助手（today-row2：900px 断点双栏 · 核心决策链之后） */}
      <div className="today-row2">
        <RouteCard route={data?.todayTimeline ?? []} busy={busy}
          onSelect={(taskId) => { setRouteSel(taskId); setCardIdx(0); setRouteSelTask(null); fetch(`/api/tasks/${taskId}`).then((r) => (r.ok ? r.json() : null)).then((d) => { if (d && d.id) setRouteSelTask(d as CurrentTask); }).catch(() => {}); }}
          onStartNow={(taskId) => { setRouteSel(taskId); setCardIdx(0); doAction(taskId, "start"); }} />
        <AiPanel text={aiPanelText} recommendations={data?.recommended ?? []} onAdopt={adopt} busy={busy} />
      </div>

      {/* 今日状态（沉底折叠条 · 方案 §1：默认收起，低频自我汇报） */}
      <StatusBar state={data?.currentState ?? { energy: null, focus: null, mood: null, stress: null, stateDescription: null }} onSave={saveState} />
      </div>{/* /space-y-4：内容区结束 */}
      </div>{/* /max-w-1080：全宽容器结束 */}
    </div>
  );
}
