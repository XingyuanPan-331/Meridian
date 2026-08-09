"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { DOMAINS, normalizeCategory, resolveTheme, THEMES, THEME_FALLBACK, themeColor } from "@/lib/plan/colors";
import { parseThemeColor } from "@/lib/task/theme";
import { normalizeEstimateUnit, ESTIMATE_UNITS, ESTIMATE_UNIT_LABEL, toMinutes, type EstimateUnit } from "@/lib/task/estimate";
import { ThemeBadge } from "@/components/task/ThemeBadge";

/* ═══════════════════════════════════════════
   TaskArchivePanel — V3 任务档案面板（宽面板 560px，五区块）
   ① 身份（可编辑）② 结构（去 Project）③ 时间（去 Plan）④ 执行（只读）⑤ AI（折叠只读）
   数据源：GET /api/tasks/[id]（V3 阶段 C 将扩展 +theme/+ancestors/+schedules/+accumStats/+aiFields）
   ═══════════════════════════════════════════ */

interface ArchiveTask {
  id: string; title: string; description: string | null; taskType: string; status: string;
  category: string | null; tags: string | null; deadline: string | null; parentId: string | null;
  estimatedMinutes: number | null; importance: number; source: string | null;
  theme?: string | null;
  // FCV2：动机（继承后最终值）+ 出发时刻
  purpose?: string | null;
  departureAt?: string | null;
  // V3 C7 档案聚合：+ancestors/+schedules/+accumStats/+aiFields
  ancestors?: string[];
  schedules?: { id: string; scheduledStart: string; scheduledEnd: string | null; source: string }[];
  accumStats?: { days?: number; streak?: number; targetLabel?: string } | null;
  aiFields?: { complexity?: string | null; riskLevel?: string | null; dependencies?: string | null; scheduleAdvice?: string | null };
  accumulate?: boolean; level?: string | null;
  completedAt?: string | null;
  children?: { id: string; title: string; status: string; completedAt: string | null; estimatedMinutes: number | null }[];
  timeLogs?: { durationSeconds: number; type?: string | null }[];
}

const THEME_PRESETS = ["考研", "竞赛", "身材"];
const THEME_SWATCHES = ["#DB2777", "#F97316", "#F59E0B", "#16A34A", "#0D9488", "#2563EB", "#7C3AED", "#E11D48", "#92400E", "#64748B"];

const TYPE_LABEL: Record<string, { label: string; desc: string }> = {
  inbox: { label: "事项", desc: "未安排时间，先收着" },
  planned: { label: "截止日", desc: "定 deadline，Plan 排期" },
  scheduled: { label: "时间块", desc: "占日历，直接执行" },
};

export function TaskArchivePanel({ taskId, seed, onClose }: {
  taskId: string;
  seed?: { title?: string; category?: string | null; startTime?: string; endTime?: string | null };
  onClose: () => void;
}) {
  const router = useRouter();
  const [task, setTask] = useState<ArchiveTask | null>(null);
  const [err, setErr] = useState(false);
  const [saving, setSaving] = useState(false);
  const [aiOpen, setAiOpen] = useState(false);
  // 编辑态
  const [title, setTitle] = useState("");
  const [category, setCategory] = useState<string>("other");
  const [theme, setTheme] = useState<string | null>(null);
  // B7：当前主题落库色（自定义主题的颜色不再丢失；预设主题为 null 用 THEMES 派生）
  const [customThemeColor, setCustomThemeColor] = useState<{ color: string; deep: string; bg: string } | null>(null);
  const [themeEdit, setThemeEdit] = useState(false);
  const [customName, setCustomName] = useState("");
  const [customColor, setCustomColor] = useState(THEME_SWATCHES[5]);
  // FCV2：动机（purpose，≤50 字，档案可改）
  const [purpose, setPurpose] = useState("");
  const [estimatedMinutes, setEstimatedMinutes] = useState("");
  const [savedTip, setSavedTip] = useState<string | null>(null);
  // 实际用时手动补记（完成未计时时）
  const [timeEdit, setTimeEdit] = useState(false);
  const [timeMin, setTimeMin] = useState("");
  const [timeBusy, setTimeBusy] = useState(false);
  // P1-10：预估单位（分钟/小时/天）
  const [estUnit, setEstUnit] = useState<EstimateUnit>("min");

  // 加载任务（V3 C7 聚合：theme/ancestors/schedules/accumStats/aiFields + FCV2 purpose/departureAt 后端已返回）
  // 2026-08-07 修复（BUG-20260807-016）：异步 GET 返回后若直接 setTheme(...) 会【覆盖用户在加载期间已做的编辑】
  // （Neon 高延迟下 GET 需 2-5s，用户先点主题/改标题 → 加载完成后被重置）。
  // 改用函数式 setState：仅填充"用户尚未编辑"的字段。
  // BUG-20260807-026：Escape 关闭——面板无键盘关闭路径（GlobalSearch 的 Escape 只关搜索结果），
  // 遮罩盖住侧栏导致后续导航被拦截（E2E L2 复现：180s 点不动"蓝图"链接）。补全局 Escape 监听。
  const loadTask = useCallback(() => {
    setErr(false);
    fetch(`/api/tasks/${taskId}`)
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((d) => {
        setTask(d);
        setTitle((prev) => prev || (d.title ?? ""));
        setCategory((prev) => prev ?? normalizeCategory(d.category));
        setTheme((prev) => prev ?? d.theme ?? resolveTheme(d.tags, d.title ?? "", d.category));
        setCustomThemeColor((prev) => prev ?? parseThemeColor(d.themeColor));
        setPurpose((prev) => prev ?? (d.purpose ?? ""));
        setEstimatedMinutes((prev) => prev || (d.estimatedMinutes ? String(d.estimatedMinutes) : ""));
        setEstUnit((prev) => prev ?? (normalizeEstimateUnit(d.estimatedUnit) ?? "min"));
      })
      .catch(() => setErr(true));
  }, [taskId]);
  useEffect(() => { loadTask(); }, [loadTask]);

  // BUG-20260807-026：Escape 关闭面板（与 ✕/遮罩一致的关闭路径）
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [onClose]);

  // 补记实际用时（POST /api/tasks/[id]/time-log → 刷新）
  const addTimeLog = async () => {
    const min = Number(timeMin);
    if (!Number.isFinite(min) || min < 1 || min > 1440) return;
    setTimeBusy(true);
    try {
      const r = await fetch(`/api/tasks/${taskId}/time-log`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ durationMinutes: Math.round(min) }),
      });
      if (!r.ok) throw new Error();
      setSavedTip(`已补记 ${Math.round(min)} 分钟 ✓`);
      setTimeEdit(false);
      setTimeMin("");
      loadTask();
      window.dispatchEvent(new CustomEvent("meridian-task-changed"));
    } catch { setSavedTip("补记失败，请重试"); }
    finally { setTimeBusy(false); }
  };

  // 移出完成（reopen → 未开始；解决"完成后被困住"）
  const [reopenBusy, setReopenBusy] = useState(false);
  const reopenTask = async () => {
    setReopenBusy(true);
    try {
      const r = await fetch(`/api/tasks/${taskId}/action`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "reopen" }),
      });
      if (!r.ok) throw new Error();
      setSavedTip("已移出完成 ✓ 状态恢复为「未开始」");
      loadTask();
      window.dispatchEvent(new CustomEvent("meridian-task-changed"));
    } catch { setSavedTip("操作失败，请重试"); }
    finally { setReopenBusy(false); }
  };

  // 删除任务（全站唯一删除入口；危险操作需确认；成功后关闭面板并广播刷新）
  const [deleteBusy, setDeleteBusy] = useState(false);
  const deleteTask = async () => {
    if (!window.confirm(`确定删除「${task?.title ?? "该任务"}」？\n子任务会一并删除，此操作不可撤销。`)) return;
    setDeleteBusy(true);
    try {
      const r = await fetch(`/api/tasks/${taskId}/action`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "delete" }),
      });
      if (!r.ok) throw new Error();
      window.dispatchEvent(new CustomEvent("meridian-task-changed"));
      onClose();
    } catch { setSavedTip("删除失败，请重试"); }
    finally { setDeleteBusy(false); }
  };

  // 归属链：直读后端 ancestors（C7 已返回标题数组）；本地 idMeta 不再需要
  const ancestry = useMemo(() => (task?.ancestors ?? []), [task]);

  const cs = DOMAINS[category as keyof typeof DOMAINS] ?? DOMAINS.other;
  // 三态标签（派生态）：有 deadline → 截止日（即使创建意图是 inbox）；否则按 taskType 映射
  const typeInfo = task ? (task.deadline ? TYPE_LABEL.planned : (TYPE_LABEL[task.taskType] ?? TYPE_LABEL.inbox)) : TYPE_LABEL.inbox;
  const actualMin = Math.round((task?.timeLogs ?? []).reduce((s, l) => s + (l.durationSeconds ?? 0), 0) / 60);

  const save = async () => {
    if (!task) return;
    setSaving(true);
    setSavedTip(null);
    try {
      const body: Record<string, unknown> = {
        title: title.trim() || task.title,
        category,
        // V3 阶段 C3：PUT 白名单已支持 theme（null 清除）→ 真实持久化；B7：自定义主题颜色一并落库
        ...(theme ? { theme, ...(customThemeColor ? { themeColor: JSON.stringify(customThemeColor) } : { themeColor: null }) } : { theme: null, themeColor: null }),
        // FCV2：purpose（≤50 字；空 → null 清除）
        ...(purpose.trim() ? { purpose: purpose.trim().slice(0, 50) } : { purpose: null }),
        // P1-10：预估按单位换算成分钟（estimatedMinutes 内部标准）+ 记录单位
        ...(estimatedMinutes ? { estimatedMinutes: toMinutes(Number(estimatedMinutes), estUnit), estimatedUnit: estUnit } : { estimatedMinutes: null, estimatedUnit: null }),
      };
      const r = await fetch(`/api/tasks/${taskId}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      if (!r.ok) throw new Error();
      setTask((prev) => prev ? { ...prev, ...body, category: normalizeCategory(category), purpose: (body.purpose as string) ?? null } : prev);
      setSavedTip(`已保存 ✓ 领域/主题/动机修改已回流 AI 记忆（AgentFeedback）`);
      setThemeEdit(false);
      window.dispatchEvent(new CustomEvent("meridian-task-changed"));
    } catch { setSavedTip("保存失败，请重试"); }
    finally { setSaving(false); }
  };

  const gotoProject = () => { onClose(); router.push(`/projects?highlight=${taskId}`); };
  const gotoPlan = () => { onClose(); router.push(`/plan?highlight=${taskId}`); };

  const themePreset = theme ? themeColor(theme) : null;

  return (
    <>
      {/* 遮罩 */}
      <div className="fixed inset-0 z-[90] bg-black/30" onClick={onClose} />
      {/* 面板：右侧滑入 560px */}
      <aside className="fixed top-0 right-0 bottom-0 z-[91] w-[560px] max-w-full bg-white shadow-2xl flex flex-col animate-[slideIn_.3s_cubic-bezier(.16,1,.3,1)]" style={{ animation: "archiveIn .3s cubic-bezier(.16,1,.3,1)" }}>
        <style>{`@keyframes archiveIn{from{transform:translateX(100%)}to{transform:none}}`}</style>
        {/* 头部 */}
        <div className="px-5 py-4 border-b border-[var(--v2-border)] shrink-0">
          <div className="flex items-start gap-2">
            <div className="flex-1 min-w-0">
              {err ? (
                <div className="text-sm text-[var(--color-danger-text)]">加载档案失败</div>
              ) : (
                <>
                  <input
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    className="w-full text-[17px] font-semibold text-[var(--v2-text)] bg-transparent outline-none border-b border-transparent focus:border-[var(--v2-brand)] transition"
                    placeholder="任务标题"
                  />
                  <div className="flex items-center gap-1.5 flex-wrap mt-2">
                    <span className="text-sm px-1.5 py-0.5 rounded" style={{ background: cs.bg, color: cs.border }}>{cs.label}</span>
                    {theme && <ThemeBadge theme={theme} color={customThemeColor} />}
                    <span className="text-sm px-1.5 py-0.5 rounded bg-[var(--color-gray-100)] text-[var(--color-gray-500)]">{typeInfo.label}</span>
                    {task && (
                      <span className={`text-sm px-1.5 py-0.5 rounded ${task.status === "completed" ? "bg-[var(--color-success-bg)] text-[var(--color-success-text)]" : task.status === "in_progress" ? "bg-[var(--color-brand-50)] text-[var(--v2-brand-deep)]" : "bg-[var(--color-gray-100)] text-[var(--color-gray-500)]"}`}>
                        {task.status === "completed" ? "已完成" : task.status === "in_progress" ? "进行中" : "未开始"}
                      </span>
                    )}
                    {/* 修复：已完成任务提供「移出完成」入口（reopen → 未开始，状态可逆） */}
                    {task?.status === "completed" && (
                      <button
                        onClick={reopenTask}
                        disabled={reopenBusy}
                        className="text-sm px-2 py-0.5 rounded border border-[var(--v2-border)] text-[var(--v2-text2)] hover:border-[var(--v2-brand)] hover:text-[var(--v2-brand)] transition disabled:opacity-50"
                        title="把任务移出已完成状态（恢复为未开始）"
                      >移出完成</button>
                    )}
                  </div>
                </>
              )}
            </div>
            <button onClick={onClose} className="w-7 h-7 rounded-md bg-[var(--color-gray-100)] text-[var(--v2-text2)] hover:bg-[var(--color-danger-bg)] hover:text-[var(--color-danger-text)] transition shrink-0 flex items-center justify-center text-sm">✕</button>
          </div>
          {savedTip && <div className="text-sm text-[var(--v2-brand-deep)] bg-[var(--v2-brand-bg)] rounded px-2.5 py-1.5 mt-2">{savedTip}</div>}
        </div>

        {/* 主体：五区块 */}
        <div className="flex-1 overflow-y-auto px-5 py-3">
          {/* ① 身份（可编辑） */}
          <Section num="1" name="身份" tag="可编辑 · PUT tasks/[id]" color="#6366f1">
            <div className="space-y-2.5">
              <div>
                <div className="text-sm text-[var(--v2-text3)] mb-1">领域（7 类封顶）</div>
                <div className="flex flex-wrap gap-1.5">
                  {(Object.entries(DOMAINS) as [string, { label: string; border: string; bg: string }][]).map(([k, d]) => (
                    <button key={k} onClick={() => setCategory(k)}
                      className={`text-sm px-2 py-1 rounded-md border transition ${category === k ? "border-[var(--v2-brand)] shadow-[0_0_0_1px_var(--v2-brand)]" : "border-[var(--v2-border)] hover:border-[var(--v2-brand)]/50"}`}
                      style={{ background: category === k ? d.bg : "#fff", color: category === k ? d.border : "var(--v2-text2)" }}>
                      {d.label}{k === "practice" && <span className="text-[11px] opacity-70">（含竞赛）</span>}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <div className="flex items-center justify-between mb-1">
                  <span className="text-sm text-[var(--v2-text3)]">主题（考研/竞赛/身材 + 自定义选色）</span>
                  <button onClick={() => setThemeEdit((v) => !v)} className="text-sm text-[var(--v2-brand)] font-medium hover:underline">＋ 自定义</button>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {THEME_PRESETS.map((t) => {
                    const c = themeColor(t) ?? THEME_FALLBACK;
                    return (
                      <button key={t} onClick={() => { setTheme(theme === t ? null : t); setCustomThemeColor(null); }}
                        className="inline-flex items-center gap-1.5 text-sm px-2 py-1 rounded-md border transition"
                        style={{ background: theme === t ? c.bg : "#fff", color: theme === t ? c.deep : "var(--v2-text2)", borderColor: theme === t ? c.color : "var(--v2-border)" }}>
                        <span className="w-2 h-2 rounded-full" style={{ background: c.color }} />{t}
                      </button>
                    );
                  })}
                  <button onClick={() => { setTheme(null); setCustomThemeColor(null); }} className={`text-sm px-2 py-1 rounded-md border transition ${theme === null ? "border-[var(--v2-brand)] bg-[var(--v2-brand-bg)] text-[var(--v2-brand-deep)]" : "border-[var(--v2-border)] text-[var(--v2-text3)]"}`}>无主题</button>
                </div>
                {themeEdit && (
                  <div className="mt-2 border border-[var(--v2-brand-border)] bg-[var(--v2-brand-bg)] rounded-lg p-2.5">
                    <div className="flex gap-2 mb-2">
                      <input value={customName} onChange={(e) => setCustomName(e.target.value)} placeholder="主题名称（≤20 字）" maxLength={20}
                        className="flex-1 px-2 py-1 text-sm border border-[var(--v2-border)] rounded outline-none focus:border-[var(--v2-brand)] bg-white" />
                      <button onClick={() => {
                        const name = customName.trim();
                        if (!name) return;
                        // B7：确定即保存（theme + 选色落库，不再两步操作丢颜色）
                        setTheme(name);
                        setCustomThemeColor({ color: customColor, deep: customColor, bg: "#F8FAFC" });
                        setThemeEdit(false);
                        setCustomName("");
                      }} className="px-2.5 py-1 text-sm font-medium rounded bg-[var(--v2-brand)] text-white hover:bg-[var(--v2-brand-deep)]">确定</button>
                    </div>
                    <div className="flex gap-1.5 flex-wrap">
                      {THEME_SWATCHES.map((c) => (
                        <button key={c} onClick={() => setCustomColor(c)}
                          className={`w-5 h-5 rounded-full transition ${customColor === c ? "ring-2 ring-offset-1 ring-[var(--v2-brand)]" : ""}`} style={{ background: c }} />
                      ))}
                    </div>
                  </div>
                )}
              </div>
              <div className="grid grid-cols-2 gap-2.5">
                <div>
                  <span className="text-sm text-[var(--v2-text3)] block mb-1">预估（分钟/小时/天）</span>
                  <div className="flex gap-1.5">
                    <input type="number" min={1} value={estimatedMinutes} onChange={(e) => setEstimatedMinutes(e.target.value)}
                      className="flex-1 min-w-0 w-full px-2 py-1 text-sm border border-[var(--v2-border)] rounded outline-none focus:border-[var(--v2-brand)] bg-white" />
                    <select value={estUnit} onChange={(e) => setEstUnit(e.target.value as EstimateUnit)}
                      className="shrink-0 px-1.5 py-1 text-sm border border-[var(--v2-border)] rounded outline-none focus:border-[var(--v2-brand)] bg-white">
                      {ESTIMATE_UNITS.map((u) => <option key={u} value={u}>{ESTIMATE_UNIT_LABEL[u]}</option>)}
                    </select>
                  </div>
                </div>
                <div>
                  <span className="text-sm text-[var(--v2-text3)] block mb-1">计划状态</span>
                  <div className="px-2 py-1 text-sm rounded border border-[var(--v2-border)] bg-[var(--color-gray-50)] text-[var(--v2-text2)]">{typeInfo.label} · {typeInfo.desc}</div>
                </div>
              </div>
              {/* FCV2：动机（purpose，≤50 字；空=无动机） */}
              <div>
                <span className="text-sm text-[var(--v2-text3)] block mb-1">动机（Focus Card 动机行 · ≤50 字）</span>
                <input value={purpose} onChange={(e) => setPurpose(e.target.value)} maxLength={50} placeholder="例如：为四轴飞行器打好电路基础"
                  className="w-full px-2 py-1 text-sm border border-[var(--v2-border)] rounded outline-none focus:border-[var(--v2-brand)] bg-white" />
              </div>
              <div className="flex justify-end">
                <button onClick={save} disabled={saving} className="text-sm font-medium px-3.5 py-1.5 rounded-lg bg-[var(--v2-brand)] text-white hover:bg-[var(--v2-brand-deep)] transition disabled:opacity-50">
                  {saving ? "保存中…" : "保存修改"}
                </button>
              </div>
              {/* 实际用时（手动补记 · 完成未计时时） */}
              <div className="flex items-center gap-2">
                <span className="text-sm text-[var(--v2-text3)]">实际用时</span>
                <b className="text-sm text-[var(--v2-text)]">{actualMin > 0 ? `${actualMin} 分钟` : "—"}</b>
                {timeEdit ? (
                  <div className="flex items-center gap-1.5 ml-auto">
                    <input type="number" min={1} max={1440} value={timeMin} onChange={(e) => setTimeMin(e.target.value)}
                      onKeyDown={(e) => { if (e.key === "Enter") addTimeLog(); if (e.key === "Escape") { e.stopPropagation(); setTimeEdit(false); setTimeMin(""); } }}
                      placeholder="分钟" className="w-16 px-2 py-1 text-sm border border-[var(--v2-border)] rounded outline-none focus:border-[var(--v2-brand)]" autoFocus />
                    <button onClick={addTimeLog} disabled={timeBusy || !(Number(timeMin) > 0)} className="text-sm px-2 py-1 rounded bg-[var(--v2-brand)] text-white disabled:opacity-50">确定</button>
                    <button onClick={() => { setTimeEdit(false); setTimeMin(""); }} className="text-sm px-2 py-1 rounded border border-[var(--v2-border)] text-[var(--v2-text2)]">✕</button>
                  </div>
                ) : (
                  <button onClick={() => setTimeEdit(true)} className="text-sm ml-auto text-[var(--v2-brand)] font-medium hover:underline">＋ 补记</button>
                )}
              </div>
              {/* 删除任务（全站唯一删除入口 · 危险操作确认后执行） */}
              <div className="flex justify-end pt-1">
                <button onClick={deleteTask} disabled={deleteBusy}
                  className="text-sm px-3 py-1.5 rounded-lg border border-[var(--color-danger-border)] text-[var(--color-danger-text)] hover:bg-[var(--color-danger-bg)] transition disabled:opacity-50">
                  {deleteBusy ? "删除中…" : "删除任务"}
                </button>
              </div>
            </div>
          </Section>

          {/* ② 结构（去 Project） */}
          <Section num="2" name="结构" tag="项目树归属" color="#0ea5e9">
            <div className="flex items-center gap-2 flex-wrap mb-2.5">
              {ancestry.length === 0 && <span className="text-sm text-[var(--v2-text3)]">{task?.parentId ? "父任务未加载" : "未挂载项目树"}</span>}
              {ancestry.map((p, i) => (
                <span key={i} className="text-sm px-2 py-1 rounded bg-[var(--color-gray-50)] border border-[var(--v2-border)] text-[var(--v2-text2)]">{i > 0 && <span className="mr-1 text-[var(--v2-text3)]">›</span>}{p}</span>
              ))}
              {task && <span className="text-sm px-2 py-1 rounded bg-[var(--v2-brand-bg)] border border-[var(--v2-brand-border)] text-[var(--v2-brand-deep)] font-medium">{task.title}</span>}
            </div>
            <button onClick={gotoProject} className="inline-flex items-center gap-1.5 text-sm font-medium px-3 py-1.5 rounded-lg bg-[var(--v2-brand-bg)] text-[var(--v2-brand-deep)] border border-[var(--v2-brand-border)] hover:bg-[#e0e7ff] transition">📍 去 Project 定位 ›</button>
          </Section>

          {/* ③ 时间（去 Plan · V3 C7 schedules） */}
          <Section num="3" name="时间" tag="唯一时间源 = Schedule" color="#f59e0b">
            <div className="space-y-1.5 mb-2.5 text-sm text-[var(--v2-text2)]">
              {task && task.schedules && task.schedules.length > 0 ? (
                task.schedules.map((s) => (
                  <div key={s.id} className="flex items-center gap-2"><span className="w-5 h-5 rounded bg-[var(--v2-brand-bg)] flex items-center justify-center text-[11px]">🕐</span>
                    时间块 <b className="text-[var(--v2-text)]">{new Date(s.scheduledStart).toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", weekday: "short", hour: "2-digit", minute: "2-digit" })}{s.scheduledEnd ? ` — ${new Date(s.scheduledEnd).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })}` : ""}</b>
                  </div>
                ))
              ) : seed?.startTime ? (
                <div className="flex items-center gap-2"><span className="w-5 h-5 rounded bg-[var(--v2-brand-bg)] flex items-center justify-center text-[11px]">🕐</span>
                  时间块 <b className="text-[var(--v2-text)]">{new Date(seed.startTime).toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", weekday: "short", hour: "2-digit", minute: "2-digit" })}{seed.endTime ? ` — ${new Date(seed.endTime).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })}` : ""}</b>
                </div>
              ) : (
                <div className="flex items-center gap-2"><span className="w-5 h-5 rounded bg-[var(--color-gray-100)] flex items-center justify-center text-[11px]">🕐</span>未排期</div>
              )}
              {task?.deadline ? (
                <div className="flex items-center gap-2"><span className="w-5 h-5 rounded bg-[var(--color-danger-bg)] flex items-center justify-center text-[11px]">⏳</span>
                  截止 <b className="text-[var(--v2-text)]">{new Date(task.deadline).toLocaleDateString("zh-CN", { year: "numeric", month: "2-digit", day: "2-digit", weekday: "short" })}</b>
                </div>
              ) : (
                <div className="flex items-center gap-2"><span className="w-5 h-5 rounded bg-[var(--color-gray-100)] flex items-center justify-center text-[11px]">⏳</span>未设置截止日期</div>
              )}
              {task?.accumStats?.streak ? (
                <div className="flex items-center gap-2"><span className="w-5 h-5 rounded bg-[var(--v2-green-bg)] flex items-center justify-center text-[11px]">🔁</span>
                  续排 <b className="text-[var(--v2-text)]">{task.accumStats.targetLabel ?? "积累型"}</b> · 已连续 <b className="text-[var(--v2-text)]">{task.accumStats.streak} 天</b>
                </div>
              ) : null}
            </div>
            <button onClick={gotoPlan} className="inline-flex items-center gap-1.5 text-sm font-medium px-3 py-1.5 rounded-lg bg-[var(--v2-brand-bg)] text-[var(--v2-brand-deep)] border border-[var(--v2-brand-border)] hover:bg-[#e0e7ff] transition">📅 去 Plan 定位 ›</button>
          </Section>

          {/* ④ 执行（只读） */}
          <Section num="4" name="执行" tag="只读 · 执行时产生" color="#10b981">
            {task && task.children && task.children.length > 0 && (
              <div className="mb-2.5 space-y-1">
                {task.children.map((c) => (
                  <div key={c.id} className="flex items-center gap-2 text-sm">
                    <span className={`w-3.5 h-3.5 rounded border flex items-center justify-center shrink-0 ${c.completedAt ? "bg-[var(--v2-check-on)] border-[var(--v2-check-on)]" : "border-[var(--v2-border)]"}`}>
                      {c.completedAt && <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3"><polyline points="20 6 9 17 4 12" /></svg>}
                    </span>
                    <span className={c.completedAt ? "line-through text-[var(--v2-text3)]" : "text-[var(--v2-text2)]"}>{c.title}</span>
                  </div>
                ))}
              </div>
            )}
            {task && task.children && task.children.length === 0 && <div className="text-sm text-[var(--v2-text3)] mb-2.5">无执行清单</div>}
            <div className="text-sm text-[var(--v2-text2)]">已投入 <b className="text-[var(--v2-text)]">{actualMin > 0 ? `${Math.floor(actualMin / 60)}h ${actualMin % 60}m` : "0m"}</b></div>
            {task?.accumulate && <div className="text-sm text-[var(--v2-text3)] mt-1">🔁 积累型任务（打卡制）</div>}
          </Section>

          {/* ⑤ AI 增强（折叠只读 · V3 C7 aiFields） */}
          <Section num="5" name="AI 增强" tag="只读 · planner 消费" color="#6366f1" collapsible open={aiOpen} onToggle={() => setAiOpen((v) => !v)}>
            {task && task.aiFields && (task.aiFields.complexity || task.aiFields.riskLevel || task.aiFields.dependencies || task.aiFields.scheduleAdvice) ? (
              <div className="space-y-2">
                {task.aiFields.complexity && <AiItem k="COMPLEXITY · 复杂度" v={task.aiFields.complexity} />}
                {task.aiFields.riskLevel && <AiItem k="RISK · 风险" v={task.aiFields.riskLevel} />}
                {task.aiFields.dependencies && <AiItem k="DEPENDENCIES · 依赖" v={task.aiFields.dependencies} />}
                {task.aiFields.scheduleAdvice && <AiItem k="SCHEDULE ADVICE · 排期建议" v={task.aiFields.scheduleAdvice} />}
              </div>
            ) : (
              <div className="text-sm text-[var(--v2-text3)]">无 AI 增强数据</div>
            )}
            <div className="text-[11px] text-[var(--v2-text3)] mt-2 flex items-center gap-1">🔒 红线：AI 增强字段仅档案可见，任何卡片不展示</div>
          </Section>
        </div>
      </aside>
    </>
  );
}

function Section({ num, name, tag, color, children, collapsible, open, onToggle }: {
  num: string; name: string; tag: string; color: string; children: React.ReactNode;
  collapsible?: boolean; open?: boolean; onToggle?: () => void;
}) {
  const head = (
    <div className={`flex items-center gap-2 px-3 py-2 bg-[var(--color-gray-50)] border-b border-[var(--v2-border)] ${collapsible ? "cursor-pointer select-none" : ""}`} onClick={onToggle}>
      <span className="w-5 h-5 rounded-md flex items-center justify-center text-[11px] font-bold text-white shrink-0" style={{ background: color }}>{num}</span>
      <span className="text-sm font-semibold text-[var(--v2-text)]">{name}</span>
      <span className="text-[11px] text-[var(--v2-text3)] ml-auto">{tag}</span>
      {collapsible && <span className={`text-[10px] text-[var(--v2-text3)] transition-transform ${open ? "rotate-180" : ""}`}>▼</span>}
    </div>
  );
  return (
    <div className="border border-[var(--v2-border)] rounded-xl overflow-hidden mb-3">
      {head}
      {(!collapsible || open) && <div className="p-3">{children}</div>}
    </div>
  );
}

function AiItem({ k, v }: { k: string; v: string }) {
  return (
    <div className="bg-[var(--v2-brand-bg)] border border-[var(--v2-brand-border)] rounded-lg px-3 py-2">
      <div className="text-[10px] font-bold tracking-[0.3px] text-[var(--v2-brand-deep)]">{k}</div>
      <div className="text-sm text-[var(--v2-text2)] mt-0.5">{v}</div>
    </div>
  );
}
