"use client";

import { useEffect, useRef, useState } from "react";
import type { InboxDraftItem, BreakdownPhase } from "@/types/inbox";
import { DOMAINS, resolveTheme } from "@/lib/plan/colors";
import { ThemeBadge } from "@/components/task/ThemeBadge";
import { parseThemeColor } from "@/lib/task/theme";
import { ESTIMATE_UNITS, ESTIMATE_UNIT_LABEL, formatEstimate, toMinutes, type EstimateUnit } from "@/lib/task/estimate";

/* ═══════════════════════════════════════════
   Inbox · V2 视觉语言（V3 前端先行：主题 chips + 分类 7 类含竞赛提示）
   · 输入画布 → POST /api/inbox/analyze（AI 优先 + 规则降级）
   · AI 整理结果：breakdown → 复杂卡（阶段展开审核）/ 简单卡
   · 确认创建 → POST /api/inbox/confirm
   ═══════════════════════════════════════════ */

const cardCls = "bg-[var(--v2-card)] border border-[var(--v2-border)] rounded-xl sh-v2";
const CAT_LABEL: Record<string, string> = {
  course: "课程", learning: "学习", practice: "实践",
  health: "健康", life: "生活", external: "社团/学校", other: "未分类",
};
const TYPE_LABEL: Record<string, string> = { planned: "截止日", scheduled: "时间块", inbox: "事项" };
const CAT_OPTIONS = Object.entries(DOMAINS).map(([key, d]) => ({ key, label: d.label }));
/* V3 主题预设（考研/竞赛/身材 + 自定义选色） */
const THEME_PRESETS = ["考研", "竞赛", "身材"];
const THEME_SWATCHES = ["#DB2777", "#F97316", "#F59E0B", "#16A34A", "#0D9488", "#2563EB", "#7C3AED", "#E11D48", "#92400E", "#64748B"];
function themeInfo(name: string | null | undefined) {
  if (!name) return null;
  const preset = { 考研: { color: "#F97316", deep: "#C2410C", bg: "#FFF7ED" }, 竞赛: { color: "#DB2777", deep: "#BE185D", bg: "#FDF2F8" }, 身材: { color: "#0D9488", deep: "#0F766E", bg: "#F0FDFA" } } as Record<string, { color: string; deep: string; bg: string }>;
  return preset[name] ?? { color: "#6B7280", deep: "#4B5563", bg: "#F3F4F6" };
}

/* ── 输入画布 ── */
function InputCanvas({ greeting, onSubmit, loading }: {
  greeting: string;
  onSubmit: (content: string) => void;
  loading: boolean;
}) {
  const [value, setValue] = useState("");
  const taRef = useRef<HTMLTextAreaElement>(null);

  const send = () => {
    const v = value.trim();
    if (!v || loading) return;
    onSubmit(v);
    setValue("");
    if (taRef.current) taRef.current.style.height = "auto";
  };

  // P1-4：取消输入 = 清空 + 失焦 + 高度复位（关闭输入框，不只是清空）
  const closeInput = () => {
    setValue("");
    if (taRef.current) {
      taRef.current.style.height = "auto";
      taRef.current.blur();
    }
  };

  return (
    <div className={`${cardCls} mb-4 flex flex-col overflow-hidden`}>
      <div className="flex-1 px-6 sm:px-8 pt-8 pb-2.5">
        <p className="text-[19px] text-[var(--v2-text)] leading-[1.7] mb-4">{greeting}</p>
        <textarea
          ref={taRef}
          value={value}
          onChange={(e) => { setValue(e.target.value); e.target.style.height = "auto"; e.target.style.height = Math.min(e.target.scrollHeight, 200) + "px"; }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); }
            // P1-4：Escape = 关闭输入框（清空 + 失焦），不再只是清空值
            if (e.key === "Escape") { e.preventDefault(); closeInput(); }
          }}
          onBlur={() => {
            // P1-4：失焦关闭 —— 内容为空时收起输入框（视觉关闭）；有内容保留防误丢
            if (!value.trim() && taRef.current) taRef.current.style.height = "auto";
          }}
          rows={1}
          placeholder="把脑子里的事倒进来… 例如：周六上午准备电赛方案，顺便把实验报告写了"
          className="w-full border-none outline-none resize-none text-[15px] leading-relaxed text-[var(--v2-text)] placeholder:text-[var(--v2-text3)] bg-transparent min-h-[24px]"
        />
      </div>
      <div className="border-t border-[var(--v2-border)] px-4 py-2.5 flex items-center justify-between text-sm text-[var(--v2-text3)]">
        <span>
          <kbd className="font-sans text-sm px-1.5 py-0.5 rounded bg-[var(--color-gray-100)] border border-[var(--v2-border)] text-[var(--v2-text2)]">Enter</kbd> 发送
          <kbd className="font-sans text-sm px-1.5 py-0.5 rounded bg-[var(--color-gray-100)] border border-[var(--v2-border)] text-[var(--v2-text2)] ml-1.5">Shift+Enter</kbd> 换行
          <kbd className="font-sans text-sm px-1.5 py-0.5 rounded bg-[var(--color-gray-100)] border border-[var(--v2-border)] text-[var(--v2-text2)] ml-1.5">Esc</kbd> 关闭输入
        </span>
        <div className="flex items-center gap-2">
          {/* P1-4：✕ 取消按钮 —— 任意时刻退出输入，不强制完成 */}
          {value.trim() && (
            <button
              onClick={closeInput}
              className="text-sm px-2.5 py-1.5 rounded border border-[var(--v2-border)] bg-white text-[var(--v2-text3)] hover:text-[var(--v2-amber)] hover:border-[var(--v2-amber)]/50 transition"
              title="取消输入（Esc）"
            >
              ✕ 取消
            </button>
          )}
          <button
            onClick={send}
            disabled={loading || !value.trim()}
            className={`text-sm px-4 py-1.5 rounded font-medium transition ${loading ? "bg-[var(--color-brand-50)] text-[var(--v2-brand)] cursor-wait" : value.trim() ? "bg-[var(--v2-brand)] text-white hover:bg-[var(--v2-brand-deep)]" : "bg-[var(--color-gray-100)] text-[var(--v2-text3)] cursor-not-allowed"}`}
          >
            {loading ? "AI 整理中…" : "AI 整理"}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ── 简单卡 ── */
function SimpleCard({ item, onConfirm, onDismiss, onEdit, onModify }: {
  item: InboxDraftItem; onConfirm: () => void; onDismiss: () => void; onEdit: () => void;
  onModify?: (patch: Partial<InboxDraftItem>) => void;
}) {
  const confidence = Math.round((item.confidence ?? 0.7) * 100);
  // B8：时间安排动作（加子任务/设每天/设有截止）+ 重要性三档（不叫"选类型"，叫"安排时间"）
  const [childTitle, setChildTitle] = useState("");
  const [addingChild, setAddingChild] = useState(false);
  const [deadlineVal, setDeadlineVal] = useState("");
  const [addingDeadline, setAddingDeadline] = useState(false);
  const addChild = () => {
    const v = childTitle.trim();
    if (!v) return;
    const phases = item.breakdown?.phases?.length ? item.breakdown.phases : [];
    onModify?.({
      breakdown: {
        shouldBreakdown: true,
        reason: item.breakdown?.reason ?? "手动添加子任务",
        phases: [...phases, { title: `清单 ${phases.length + 1}`, phaseOrder: phases.length, tasks: [{ title: v, estimatedMinutes: 0 }] }],
      },
    });
    setChildTitle("");
    setAddingChild(false);
  };
  const impLevels = [1, 2, 3, 4, 5];
  const impLabel = (n: number) => (n <= 2 ? "低" : n === 3 ? "中" : "高");
  return (
    <div className={`${cardCls} p-4 mb-2.5`}>
      <div className="flex items-start gap-2.5 mb-2">
        <div className="w-[30px] h-[30px] rounded bg-[var(--color-gray-100)] flex items-center justify-center text-sm shrink-0">📝</div>
        <div className="flex-1 min-w-0">
          <div className="text-sm font-semibold mb-0.5 text-[var(--v2-text)]">{item.title}</div>
          {item.purpose && (
            <div className="text-[11.5px] text-[#7c3aed] bg-[var(--v2-purple-bg)] rounded px-2 py-0.5 inline-block mb-0.5">🎯 {item.purpose}</div>
          )}
          <div className="text-sm text-[var(--v2-text3)] flex flex-wrap gap-1.5">
            <span className="inline-flex items-center px-[7px] py-[1px] bg-[var(--color-gray-50)] rounded">{CAT_LABEL[item.category] ?? item.category}</span>
            {(() => { const th = item.theme ?? resolveTheme(null, item.title); return th ? <ThemeBadge theme={th} color={parseThemeColor(item.themeColor)} /> : null; })()}
            <span className="inline-flex items-center px-[7px] py-[1px] bg-[var(--color-gray-50)] rounded">{TYPE_LABEL[item.taskType] ?? item.taskType}</span>
            {(() => { const est = formatEstimate(item.estimatedMinutes, item.estimatedUnit); return est ? <span className="inline-flex items-center px-[7px] py-[1px] bg-[var(--color-gray-50)] rounded">约 {est}</span> : null; })()}
            {item.deadline && <span className="inline-flex items-center px-[7px] py-[1px] bg-[var(--color-danger-bg)] text-[var(--color-danger-text)] rounded">截止 {new Date(item.deadline).toLocaleDateString("zh-CN", { month: "2-digit", day: "2-digit" })}</span>}
            <span className="inline-flex items-center px-[7px] py-[1px] bg-[var(--color-gray-50)] rounded">置信度 {confidence}%</span>
          </div>
        </div>
        <div className="flex gap-1.5 items-center shrink-0">
          <button onClick={onConfirm} className="px-3.5 py-1.5 text-sm font-medium rounded bg-[var(--v2-brand)] text-white hover:bg-[var(--v2-brand-deep)] transition">确认</button>
          <button onClick={onEdit} className="px-2.5 py-1.5 text-sm rounded border border-[var(--v2-border)] bg-white text-[var(--v2-text2)] hover:bg-[var(--color-gray-50)] transition">编辑</button>
          <button onClick={onDismiss} className="px-2 py-1.5 text-sm rounded bg-transparent text-[var(--v2-text3)] hover:text-[var(--v2-amber)] transition">忽略</button>
        </div>
      </div>
      {item.aiReason && (
        <div className="text-sm text-[var(--v2-brand-deep)] px-2.5 py-1.5 bg-[var(--v2-brand-bg)] rounded leading-[1.5]">{item.aiReason}</div>
      )}
      {/* B8：时间安排动作 + 重要性三档 */}
      {onModify && (
        <div className="flex items-center gap-1.5 mt-2.5 flex-wrap pt-2.5 border-t border-dashed border-[var(--v2-border)]">
          {addingChild ? (
            <div className="flex items-center gap-1.5 flex-1 min-w-[200px]">
              <input value={childTitle} onChange={(e) => setChildTitle(e.target.value)} autoFocus
                onKeyDown={(e) => { if (e.key === "Enter") addChild(); if (e.key === "Escape") { setAddingChild(false); setChildTitle(""); } }}
                placeholder="子任务标题，回车添加" className="flex-1 min-w-0 px-2 py-1 text-sm border border-[var(--v2-border)] rounded outline-none focus:border-[var(--v2-brand)]" />
              <button onClick={addChild} disabled={!childTitle.trim()} className="text-sm px-2 py-1 rounded bg-[var(--v2-brand)] text-white disabled:opacity-50">确定</button>
            </div>
          ) : addingDeadline ? (
            <div className="flex items-center gap-1.5 flex-1 min-w-[200px]">
              <input type="date" value={deadlineVal} onChange={(e) => setDeadlineVal(e.target.value)} autoFocus
                className="flex-1 min-w-0 px-2 py-1 text-sm border border-[var(--v2-border)] rounded outline-none focus:border-[var(--v2-brand)]" />
              <button onClick={() => { if (deadlineVal) { onModify({ deadline: new Date(deadlineVal + "T23:59:59").toISOString() }); setAddingDeadline(false); setDeadlineVal(""); } }} disabled={!deadlineVal} className="text-sm px-2 py-1 rounded bg-[var(--v2-brand)] text-white disabled:opacity-50">确定</button>
            </div>
          ) : (
            <>
              <button onClick={() => setAddingChild(true)} className="text-xs px-2 py-1 rounded border border-[var(--v2-border)] text-[var(--v2-text2)] hover:border-[var(--v2-brand)] transition">＋ 加子任务</button>
              <button onClick={() => onModify({ accumulate: !item.accumulate, ...(!item.accumulate ? { taskType: "planned" } : {}) })}
                className={`text-xs px-2 py-1 rounded border transition ${item.accumulate ? "border-[var(--v2-brand)] bg-[var(--v2-brand-bg)] text-[var(--v2-brand-deep)]" : "border-[var(--v2-border)] text-[var(--v2-text2)] hover:border-[var(--v2-brand)]"}`}>
                {item.accumulate ? "✓ 每天重复" : "设为每天"}
              </button>
              {item.deadline ? (
                <button onClick={() => onModify({ deadline: undefined })} className="text-xs px-2 py-1 rounded border border-[var(--v2-brand)] bg-[var(--v2-brand-bg)] text-[var(--v2-brand-deep)]">✓ 有截止 · 取消</button>
              ) : (
                <button onClick={() => setAddingDeadline(true)} className="text-xs px-2 py-1 rounded border border-[var(--v2-border)] text-[var(--v2-text2)] hover:border-[var(--v2-brand)] transition">设有截止</button>
              )}
            </>
          )}
          <span className="ml-auto flex items-center gap-0.5">
            {impLevels.map((n) => (
              <button key={n} onClick={() => onModify({ importance: n })}
                className={`text-xs px-1.5 py-0.5 rounded transition ${(item.importance ?? 3) === n ? "bg-[var(--v2-amber)] text-white font-semibold" : "text-[var(--v2-text3)] hover:text-[var(--v2-amber)]"}`}
                title={`重要性：${impLabel(n)}`}>{impLabel(n)}</button>
            ))}
          </span>
        </div>
      )}
    </div>
  );
}

/* ── 复杂卡（阶段展开审核） ── */
function ComplexCard({ item, onConfirm, onDismiss, onEdit }: { item: InboxDraftItem; onConfirm: () => void; onDismiss: () => void; onEdit: () => void }) {
  const phases: BreakdownPhase[] = item.breakdown?.phases ?? [];
  const totalChildren = phases.reduce((n, p) => n + p.tasks.length, 0);

  return (
    <div className={`${cardCls} p-4 mb-2.5`}>
      <div className="flex items-start gap-2.5 mb-2">
        <div className="w-[30px] h-[30px] rounded bg-[var(--color-gray-100)] flex items-center justify-center text-sm shrink-0">🎯</div>
        <div className="flex-1 min-w-0">
          <div className="text-sm font-semibold mb-0.5 text-[var(--v2-text)]">{item.title}</div>
          {item.purpose && (
            <div className="text-[11.5px] text-[#7c3aed] bg-[var(--v2-purple-bg)] rounded px-2 py-0.5 inline-block mb-0.5">🎯 {item.purpose}</div>
          )}
          <div className="text-sm text-[var(--v2-text3)] flex flex-wrap gap-1.5">
            <span className="inline-flex items-center px-[7px] py-[1px] bg-[var(--color-gray-50)] rounded">{CAT_LABEL[item.category] ?? item.category}</span>
            {(() => { const th = item.theme ?? resolveTheme(null, item.title); return th ? <ThemeBadge theme={th} color={parseThemeColor(item.themeColor)} /> : null; })()}
            {(() => { const est = formatEstimate(item.estimatedMinutes, item.estimatedUnit); return est ? <span className="inline-flex items-center px-[7px] py-[1px] bg-[var(--color-gray-50)] rounded">约 {est}</span> : null; })()}
            <span className="inline-flex items-center px-[7px] py-[1px] bg-[var(--color-gray-50)] rounded">置信度 {Math.round((item.confidence ?? 0.7) * 100)}%</span>
          </div>
        </div>
        <div className="flex gap-1.5 items-center shrink-0">
          <button onClick={onEdit} className="px-2.5 py-1.5 text-sm rounded border border-[var(--v2-border)] bg-white text-[var(--v2-text2)] hover:bg-[var(--color-gray-50)] transition">编辑</button>
          <button onClick={onDismiss} className="px-2 py-1.5 text-sm rounded bg-transparent text-[var(--v2-text3)] hover:text-[var(--v2-amber)] transition">忽略</button>
        </div>
      </div>
      {item.aiReason && (
        <div className="text-sm text-[var(--v2-brand-deep)] px-2.5 py-1.5 bg-[var(--v2-brand-bg)] rounded leading-[1.5] mb-2.5">{item.aiReason}</div>
      )}

      {/* 阶段展示（编辑统一走「编辑」面板） */}
      {phases.map((phase, pi) => (
        <div key={pi} className="mb-3.5 last:mb-0">
          <div className="text-sm font-medium text-[var(--v2-text2)] mb-1.5 px-2 py-0.5 bg-[var(--v2-brand-bg)] rounded inline-flex items-center gap-1.5">
            Phase {pi + 1}: <span className="text-[var(--v2-text2)]">{phase.title}</span>
          </div>
          {phase.tasks.map((t, ti) => (
            <div key={`${pi}-${ti}`} className="flex items-center gap-2 px-3 py-2 border border-[var(--v2-border)] rounded-lg mb-1.5 bg-white">
              <span className={`w-[22px] h-[22px] rounded-full flex items-center justify-center text-sm font-medium shrink-0 ${ti % 2 === 0 ? "bg-[#DCFCE7] text-[var(--color-complete-text)]" : "bg-[var(--v2-brand-bg)] text-[var(--v2-brand-deep)]"}`}>{ti + 1}</span>
              <span className="flex-1 min-w-0">
                <span className="block text-sm font-medium text-[var(--v2-text)]">{t.title}</span>
                <span className="block text-sm text-[var(--v2-text3)]">{t.estimatedMinutes}min</span>
              </span>
            </div>
          ))}
        </div>
      ))}

      <div className="flex gap-1.5 mt-3 pt-3 border-t border-[var(--v2-border)]">
        <button onClick={onConfirm} className="px-4 py-1.5 text-sm font-medium rounded bg-[var(--v2-brand)] text-white hover:bg-[var(--v2-brand-deep)] transition ml-auto">确认创建 {totalChildren} 个子任务</button>
        <button onClick={onDismiss} className="px-2.5 py-1.5 text-sm rounded bg-transparent text-[var(--v2-text3)] hover:text-[var(--v2-amber)] transition">取消</button>
      </div>
    </div>
  );
}

/* ── 编辑面板（受控，真编辑 · V3：分类 7 类 chips（含竞赛提示）+ 主题 chips + 自定义选色） ── */
function EditPanel({ item, onSave, onCancel }: { item: InboxDraftItem; onSave: (updated: InboxDraftItem) => void; onCancel: () => void }) {
  const [title, setTitle] = useState(item.title);
  const [description, setDescription] = useState(item.description || "");
  const [category, setCategory] = useState(item.category || "other");
  const [theme, setTheme] = useState<string | null>(item.theme ?? resolveTheme(null, item.title));
  const [themeEdit, setThemeEdit] = useState(false);
  const [customName, setCustomName] = useState("");
  const [customColor, setCustomColor] = useState(THEME_SWATCHES[5]);
  // B7：当前主题落库色（自定义主题颜色不再丢失；预设主题为 null 用 THEMES 派生）
  const [themeColor, setThemeColor] = useState<{ color: string; deep: string; bg: string } | null>(() => {
    try { return item.themeColor ? JSON.parse(item.themeColor) : null; } catch { return null; }
  });
  // FCV2：动机（AI 推断可改，≤50 字）
  const [purpose, setPurpose] = useState(item.purpose ?? "");
  const [estimatedMinutes, setEstimatedMinutes] = useState(item.estimatedMinutes ? String(item.estimatedMinutes) : "");
  // P1-10：预估单位（分钟/小时/天）
  const [estUnit, setEstUnit] = useState<EstimateUnit>(item.estimatedUnit ?? "min");
  // B8：重要性（小事/大事，1-5）
  const [importance, setImportance] = useState(item.importance ?? 3);
  const [children, setChildren] = useState<{ title: string; estimatedMinutes: number }[]>(
    item.breakdown?.phases.flatMap((p) => p.tasks.map((t) => ({ title: t.title, estimatedMinutes: t.estimatedMinutes }))) ?? []
  );

  const save = () => {
    const updated: InboxDraftItem = {
      ...item,
      title: title.trim() || item.title,
      description: description.trim() || undefined,
      category,
      theme,
      importance,
      // B7：自定义主题颜色落库（主题为空或预设 → null）
      themeColor: theme && themeColor ? JSON.stringify(themeColor) : null,
      // FCV2：动机（空 → null；≤50 字）
      purpose: purpose.trim() ? purpose.trim().slice(0, 50) : null,
      estimatedMinutes: estimatedMinutes ? (toMinutes(Number(estimatedMinutes), estUnit) ?? undefined) : undefined,
      estimatedUnit: estimatedMinutes ? estUnit : undefined,
    };
    if (item.breakdown?.shouldBreakdown && children.length > 0) {
      let ci = 0;
      updated.breakdown = {
        ...item.breakdown,
        phases: item.breakdown.phases.map((p) => ({
          ...p,
          tasks: p.tasks.map((t) => { const c = children[ci++]; return c ? { ...t, title: c.title, estimatedMinutes: c.estimatedMinutes } : t; }),
        })),
      };
    }
    onSave(updated);
  };

  return (
    <div className={`${cardCls} p-4 mb-2.5 border-[var(--v2-brand)]/40`}>
      <div className="text-sm font-semibold text-[var(--v2-text)] mb-3">编辑任务</div>
      <div className="space-y-2.5">
        <div>
          <label className="text-sm text-[var(--v2-text3)] block mb-1">标题</label>
          <input value={title} onChange={(e) => setTitle(e.target.value)}
            className="w-full px-2.5 py-1.5 text-sm border border-[var(--v2-border)] rounded outline-none focus:border-[var(--v2-brand)] bg-white" />
        </div>
        <div>
          <label className="text-sm text-[var(--v2-text3)] block mb-1">备注</label>
          <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2}
            className="w-full px-2.5 py-1.5 text-sm border border-[var(--v2-border)] rounded outline-none focus:border-[var(--v2-brand)] bg-white resize-none" />
        </div>
        <div>
          <label className="text-sm text-[var(--v2-text3)] block mb-1.5">领域（7 类封顶）</label>
          <div className="flex flex-wrap gap-1.5">
            {CAT_OPTIONS.map((o) => (
              <button key={o.key} onClick={() => setCategory(o.key)}
                className={`text-sm px-2.5 py-1 rounded-md border transition ${category === o.key ? "border-[var(--v2-brand)] shadow-[0_0_0_1px_var(--v2-brand)] font-medium" : "border-[var(--v2-border)] hover:border-[var(--v2-brand)]/50"}`}
                style={{ background: category === o.key ? DOMAINS[o.key as keyof typeof DOMAINS].bg : "#fff", color: category === o.key ? DOMAINS[o.key as keyof typeof DOMAINS].border : "var(--v2-text2)" }}>
                {o.label}{o.key === "practice" && <span className="text-[11px] opacity-70">（含竞赛）</span>}
              </button>
            ))}
          </div>
        </div>
        <div>
          <div className="flex items-center justify-between mb-1.5">
            <label className="text-sm text-[var(--v2-text3)]">主题（为了什么目标 · 不强猜）</label>
            <button onClick={() => setThemeEdit((v) => !v)} className="text-sm text-[var(--v2-brand)] font-medium hover:underline">＋ 自定义</button>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {THEME_PRESETS.map((t) => {
              const c = themeInfo(t)!;
              return (
                <button key={t} onClick={() => { setTheme(theme === t ? null : t); setThemeColor(null); }}
                  className="inline-flex items-center gap-1.5 text-sm px-2.5 py-1 rounded-md border transition"
                  style={{ background: theme === t ? c.bg : "#fff", color: theme === t ? c.deep : "var(--v2-text2)", borderColor: theme === t ? c.color : "var(--v2-border)" }}>
                  <span className="w-2 h-2 rounded-full" style={{ background: c.color }} />{t}
                </button>
              );
            })}
            <button onClick={() => { setTheme(null); setThemeColor(null); }} className={`text-sm px-2.5 py-1 rounded-md border transition ${theme === null ? "border-[var(--v2-brand)] bg-[var(--v2-brand-bg)] text-[var(--v2-brand-deep)]" : "border-[var(--v2-border)] text-[var(--v2-text3)]"}`}>无主题</button>
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
                  setThemeColor({ color: customColor, deep: customColor, bg: "#F8FAFC" });
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
              <div className="text-[11px] text-[var(--v2-text2)] mt-1.5">💡 个人事务/生活琐事可不设主题（记录但不背目标）；想追踪社交、休息等再自定义</div>
            </div>
          )}
        </div>
        <div>
          <label className="text-sm text-[var(--v2-text3)] block mb-1">动机（Focus Card 动机行 · 为什么做，≤50 字）</label>
          <input value={purpose} onChange={(e) => setPurpose(e.target.value)} maxLength={50}
            placeholder="例如：为四轴飞行器打好电路基础（AI 拿不准会留空，可不填）"
            className="w-full px-2.5 py-1.5 text-sm border border-[var(--v2-border)] rounded outline-none focus:border-[var(--v2-brand)] bg-white" />
        </div>
        <div className="grid grid-cols-2 gap-2.5">
          <div>
            <label className="text-sm text-[var(--v2-text3)] block mb-1">预估（分钟/小时/天）</label>
            <div className="flex gap-1.5">
              <input type="number" min={1} value={estimatedMinutes} onChange={(e) => setEstimatedMinutes(e.target.value)}
                className="flex-1 min-w-0 px-2.5 py-1.5 text-sm border border-[var(--v2-border)] rounded outline-none focus:border-[var(--v2-brand)] bg-white" />
              <select value={estUnit} onChange={(e) => setEstUnit(e.target.value as EstimateUnit)}
                className="shrink-0 px-1.5 py-1.5 text-sm border border-[var(--v2-border)] rounded outline-none focus:border-[var(--v2-brand)] bg-white">
                {ESTIMATE_UNITS.map((u) => <option key={u} value={u}>{ESTIMATE_UNIT_LABEL[u]}</option>)}
              </select>
            </div>
          </div>
          <div>
            <label className="text-sm text-[var(--v2-text3)] block mb-1">重要性（小事/大事）</label>
            <div className="flex gap-1">
              {[1, 2, 3, 4, 5].map((n) => (
                <button key={n} onClick={() => setImportance(n)}
                  className={`flex-1 text-sm px-1 py-1.5 rounded border transition ${importance === n ? "bg-[var(--v2-amber)] text-white border-[var(--v2-amber)] font-semibold" : "bg-white text-[var(--v2-text2)] border-[var(--v2-border)]"}`}>
                  {n <= 2 ? "低" : n === 3 ? "中" : "高"}
                </button>
              ))}
            </div>
          </div>
        </div>
        {children.length > 0 && (
          <div>
            <label className="text-sm text-[var(--v2-text3)] block mb-1">子任务（标题 / 分钟）</label>
            <div className="space-y-1.5">
              {children.map((c, i) => (
                <div key={i} className="flex gap-2">
                  <input value={c.title} onChange={(e) => setChildren((arr) => arr.map((x, xi) => xi === i ? { ...x, title: e.target.value } : x))}
                    className="flex-1 px-2.5 py-1.5 text-sm border border-[var(--v2-border)] rounded outline-none bg-white" />
                  <input type="number" min={1} value={c.estimatedMinutes} onChange={(e) => setChildren((arr) => arr.map((x, xi) => xi === i ? { ...x, estimatedMinutes: Number(e.target.value) || 1 } : x))}
                    className="w-20 px-2.5 py-1.5 text-sm border border-[var(--v2-border)] rounded outline-none bg-white" />
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
      <div className="flex justify-end gap-2 mt-3">
        <button onClick={onCancel} className="px-3 py-1.5 text-sm rounded border border-[var(--v2-border)] bg-white text-[var(--v2-text2)] hover:bg-[var(--color-gray-50)] transition">取消</button>
        <button onClick={save} className="px-3.5 py-1.5 text-sm font-medium rounded bg-[var(--v2-brand)] text-white hover:bg-[var(--v2-brand-deep)] transition">保存修改</button>
      </div>
    </div>
  );
}

/* ── 页面 ── */
const DRAFT_KEY = "taskos.inbox.draft"; // 未确认草稿持久化（切换页面不丢失）

/* 同步读取草稿（useState 惰性初始化，避免 StrictMode 双挂载下 effect 竞争删除） */
function loadDraft(): { draftId: string; understanding: string; items: InboxDraftItem[] } | null {
  try {
    const raw = localStorage.getItem(DRAFT_KEY);
    if (!raw) return null;
    const d = JSON.parse(raw);
    if (d?.savedAt && Date.now() - d.savedAt < 24 * 3600 * 1000 && d.data?.items?.length > 0) return d.data;
    localStorage.removeItem(DRAFT_KEY);
  } catch { /* 草稿损坏则忽略 */ }
  return null;
}

export default function InboxPage() {
  const draftInitial = loadDraft(); // 挂载即恢复，与持久化 effect 无竞争
  const [result, setResult] = useState<{ draftId: string; understanding: string; items: InboxDraftItem[] } | null>(draftInitial);
  const [loading, setLoading] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [done, setDone] = useState<{ title: string; count: number; taskIds: string[] }[]>([]);
  const [error, setError] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [restored, setRestored] = useState(!!draftInitial); // 从草稿恢复的标记

  // 草稿变化时持久化（为空即清除）
  useEffect(() => {
    try {
      if (result && result.items.length > 0) {
        localStorage.setItem(DRAFT_KEY, JSON.stringify({ savedAt: Date.now(), data: result }));
      } else {
        localStorage.removeItem(DRAFT_KEY);
      }
    } catch { /* 存储不可用时静默 */ }
  }, [result]);

  const analyze = async (content: string) => {
    setLoading(true);
    setError("");
    try {
      const r = await fetch("/api/inbox/analyze", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ content }) });
      const d = await r.json();
      if (!r.ok || !d.success) throw new Error(d.error?.message || "分析失败");
      setResult(d.data);
    } catch (e) {
      setError(e instanceof Error ? e.message : "分析失败，请重试");
    } finally { setLoading(false); }
  };

  const doConfirm = async (items: InboxDraftItem[], label: string) => {
    if (!result) return;
    setConfirming(true);
    setError("");
    try {
      const r = await fetch("/api/inbox/confirm", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ draftId: result.draftId, confirmed: items }) });
      const d = await r.json();
      if (!r.ok || !d.success) throw new Error(d.error?.message || "创建失败");
      const created: { id: string }[] = d.data?.created ?? [];
      const ids = created.map((c) => c.id);
      setDone((prev) => [...prev, { title: label, count: d.data.total ?? ids.length, taskIds: ids }]);
      setResult((prev) => prev ? { ...prev, items: prev.items.filter((i) => !items.some((ci) => ci.id === i.id)) } : prev);
    } catch (e) {
      setError(e instanceof Error ? e.message : "创建失败，请重试");
    } finally { setConfirming(false); }
  };

  const confirmAll = () => { if (result) doConfirm(result.items, "AI 整理"); };
  const confirmOne = (item: InboxDraftItem) => doConfirm([item], item.title);

  const dismiss = (item: InboxDraftItem) => {
    setResult((prev) => prev ? { ...prev, items: prev.items.filter((i) => i.id !== item.id) } : prev);
    // 修复 P0-3：忽略 AI 解析结果 = 拒绝反馈（负反馈采集，之前零采集）
    fetch("/api/agent/feedback", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ agentAction: "inbox_analyze", userResponse: "rejected", agentSuggestion: item.title }),
    }).catch(() => {});
  };

  // 保存编辑结果
  const saveEdit = (updated: InboxDraftItem) => {
    setResult((prev) => prev ? { ...prev, items: prev.items.map((i) => i.id === updated.id ? updated : i) } : prev);
    setEditingId(null);
  };

  // B8：时间安排动作/重要性 → 局部更新草稿项
  const modifyItem = (id: string, patch: Partial<InboxDraftItem>) => {
    setResult((prev) => prev ? { ...prev, items: prev.items.map((i) => (i.id === id ? { ...i, ...patch } : i)) } : prev);
  };

  // 撤销：删除刚创建的任务（已完成的不删）
  const undo = async (entry: { title: string; count: number; taskIds: string[] }) => {
    setConfirming(true);
    setError("");
    try {
      let deleted = 0;
      for (const id of entry.taskIds) {
        const r = await fetch(`/api/tasks/${id}/action`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "delete" }) });
        if (r.ok) deleted++;
      }
      setDone((prev) => prev.filter((d) => d !== entry));
      if (deleted === 0) setError("没有可撤销的任务（可能已完成）");
    } catch {
      setError("撤销失败，请重试");
    } finally { setConfirming(false); }
  };

  return (
    <div>
      <h2 className="text-[24px] font-semibold tracking-[-0.3px] text-[var(--v2-text)] mb-1">Inbox · 收集箱</h2>
      <p className="text-xs text-[var(--v2-text3)]/70 mb-4">把脑子里的事倒进来，AI 帮你理解、归类、排期</p>

      <InputCanvas greeting={`${new Date().getHours() < 12 ? "早上好" : new Date().getHours() < 18 ? "下午好" : "晚上好"}。你现在脑子里有什么？`} onSubmit={analyze} loading={loading} />

      {error && <div className="text-sm text-[var(--color-danger-text)] bg-[var(--color-danger-bg)] border border-[var(--color-danger-border)] rounded-lg px-3 py-2 mb-3">{error}</div>}

      {result && result.items.length > 0 && (
        <>
          <div className="flex items-center justify-between mb-2.5">
            <div>
              <span className="text-sm font-semibold text-[var(--v2-text)]">AI 整理结果</span>
              <span className="text-sm text-[var(--v2-text3)] ml-1">{result.items.length} 项</span>
              {restored && <span className="text-xs px-1.5 py-0.5 rounded bg-[var(--v2-amber-bg)] text-[var(--v2-amber)] ml-2">上次未完成</span>}
            </div>
            <div className="flex gap-1.5">
              <button onClick={confirmAll} disabled={confirming} className="text-sm px-2.5 py-1 rounded border border-[var(--v2-brand)] bg-[var(--v2-brand)] text-white hover:bg-[var(--v2-brand-deep)] transition disabled:opacity-50">
                {confirming ? "创建中…" : "全部创建"}
              </button>
              <button onClick={() => setResult(null)} className="text-sm px-2.5 py-1 rounded border border-[var(--v2-border)] bg-white text-[var(--v2-text2)] hover:bg-[var(--color-gray-50)] transition">全部忽略</button>
            </div>
          </div>
          <div className="text-sm text-[var(--v2-brand-deep)] px-3.5 py-2.5 bg-[var(--v2-brand-bg)] rounded mb-4 leading-[1.5] font-medium">
            {result.understanding || "以下是整理后的建议："}
          </div>

          {result.items.map((item) => (
            editingId === item.id ? (
              <EditPanel key={item.id} item={item} onSave={saveEdit} onCancel={() => setEditingId(null)} />
            ) : (
              item.breakdown?.shouldBreakdown
                ? <ComplexCard key={item.id} item={item} onConfirm={() => confirmOne(item)} onDismiss={() => dismiss(item)} onEdit={() => setEditingId(item.id)} />
                : <SimpleCard key={item.id} item={item} onConfirm={() => confirmOne(item)} onDismiss={() => dismiss(item)} onEdit={() => setEditingId(item.id)} onModify={(patch) => modifyItem(item.id, patch)} />
            )
          ))}
        </>
      )}

      {result && result.items.length === 0 && (
        <div className={`${cardCls} py-8 text-center text-sm text-[var(--v2-text3)]`}>全部处理完毕 · 已确认 {done.reduce((n, d) => n + d.count, 0)} 个任务</div>
      )}

      {/* 最近处理 + 撤销 */}
      {done.length > 0 && (
        <div className="mt-4">
          <div className="text-sm font-semibold text-[var(--v2-text2)] mb-1">最近处理</div>
          {done.map((d, i) => (
            <div key={i} className="text-sm text-[var(--v2-text2)] py-1 flex items-center justify-between">
              <span>{d.title} · 创建 {d.count} 个任务</span>
              <button onClick={() => undo(d)} disabled={confirming} className="text-sm text-[var(--v2-brand)] font-medium hover:underline disabled:opacity-50">
                {confirming ? "处理中…" : "撤销"}
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
