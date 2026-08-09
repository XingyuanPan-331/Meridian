"use client";

import { useEffect, useState, useCallback, useRef, useMemo } from "react";
import { DOMAINS, normalizeCategory, resolveTheme, THEMES } from "@/lib/plan/colors";
import { useArchive } from "@/components/task/ArchiveProvider";

/* 收件箱分类短名（与 Review 图例一致） */
const INBOX_SHORT: Record<string, string> = {
  course: "课程", learning: "学习", practice: "实践", competition: "竞赛",
  health: "健康", life: "生活", external: "外部", other: "未分类",
};

/* ═══════════════════════════════════════════
   Project · 项目整理页（大纲式层级树 · 副本 v3.1 视觉）
   · 数据源：GET /api/projects/tree + POST /api/projects/move
   · 树 = 分组头(lvl0) / 阶段·积累(lvl1) / 任务(lvl2)，连接线 + 层级圆点
   · 交互：拖拽(子级/换序) / 新建 / ★ 清单开关 / 展开收起
   · 右栏三区：待整理池(AI 挂入) / 习惯区(打卡唯一入口) / 归档
   · 点节点 → 全局档案面板（useArchive）
   · 派生色：themeColor 契约字段优先，后端未返回时前端按主题/领域推断
   ═══════════════════════════════════════════ */

/* ── 类型 ── */
interface TreeNode {
  id: string;
  title: string;
  level: string; // project | phase | task
  status: string;
  accumulate: boolean;
  completedAt: string | null;
  category: string | null;
  estimatedMinutes: number | null;
  deadline: string | null;
  importance: number;
  parentId: string | null;
  children: TreeNode[];
  star?: boolean;                                                   // ★ 执行清单（后端落库，刷新兜底显示）
  hasSchedule?: boolean | null;                                     // 待整理池：是否已排期（透明化）
  theme?: string | null;                                        // V3 落库主题（契约预留）
  themeColor?: { color: string; deep: string; bg: string } | null; // 后端派生色（契约预留；兼容 {pcolor,pbg,theme}）
  themeColorRaw?: string | null;                                // B7：自定义主题落库色 JSON（原始）
  suggestion?: string | null;                                   // 待整理池 AI 建议（契约预留）
}
interface TreeResponse {
  trees: TreeNode[];
  orphans: TreeNode[];
}
interface StreakInfo {
  current: number;
  longest: number;
  lastDate: string | null;
  todayChecked: boolean;
  last30: string[];
}

/* ── 工具 ── */
function findNode(list: TreeNode[], id: string): TreeNode | null {
  for (const n of list) {
    if (n.id === id) return n;
    const f = findNode(n.children || [], id);
    if (f) return f;
  }
  return null;
}
function findParent(list: TreeNode[], id: string): TreeNode | null {
  for (const n of list) {
    if ((n.children || []).some((c) => c.id === id)) return n;
    const f = findParent(n.children || [], id);
    if (f) return f;
  }
  return null;
}
function isDescendant(node: TreeNode, maybeDesc: string): boolean {
  const stack = [...(node.children || [])];
  while (stack.length) {
    const c = stack.pop()!;
    if (c.id === maybeDesc) return true;
    stack.push(...(c.children || []));
  }
  return false;
}
function flatten(list: TreeNode[]): TreeNode[] {
  const out: TreeNode[] = [];
  for (const n of list) {
    out.push(n);
    out.push(...flatten(n.children || []));
  }
  return out;
}
function treeDone(list: TreeNode[]): { done: number; total: number } {
  return list.reduce(
    (acc, n) => {
      const sub = treeDone(n.children || []);
      return { done: acc.done + (n.status === "completed" ? 1 : 0) + sub.done, total: acc.total + 1 + sub.total };
    },
    { done: 0, total: 0 }
  );
}
const lvlOf = (n: TreeNode) => (n.level === "project" ? 0 : n.level === "phase" ? 1 : 2);

/* 派生色：落库色（themeColorRaw）优先 → 树接口派生色（pcolor/pbg）→ THEMES → 推断（V3 规则：AI 拿不准不强猜） */
function nodeTheme(node: TreeNode): { color: string; deep: string; bg: string; name: string } | null {
  // B7：自定义主题落库色（JSON {"color","deep","bg"}）
  if (node.themeColorRaw) {
    try {
      const raw = JSON.parse(node.themeColorRaw);
      if (raw && typeof raw.color === "string" && typeof raw.bg === "string") {
        return { color: raw.color, deep: raw.deep ?? raw.color, bg: raw.bg, name: node.theme ?? "" };
      }
    } catch { /* 非法 JSON 忽略 */ }
  }
  // 树接口 project 级派生色（{pcolor,pbg,theme} 形态，兼容 {color,deep,bg}）
  const tc = node.themeColor as { color?: string; deep?: string; bg?: string; pcolor?: string; pbg?: string; theme?: string | null } | null;
  if (tc) {
    if (tc.color && tc.deep && tc.bg) return { color: tc.color, deep: tc.deep, bg: tc.bg, name: node.theme ?? "" };
    if (tc.pcolor) return { color: tc.pcolor, deep: tc.pcolor, bg: tc.pbg ?? "#F8FAFC", name: tc.theme ?? node.theme ?? "" };
  }
  if (node.theme && THEMES[node.theme]) return { ...THEMES[node.theme], name: node.theme };
  const th = resolveTheme(null, node.title, node.category);
  if (th && THEMES[th]) return { ...THEMES[th], name: th };
  return null;
}

const cardCls = "bg-[var(--v2-card)] border border-[var(--v2-border)] rounded-xl sh-v2";

const Ic = {
  check: <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.4" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>,
  plus: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" width="12" height="12"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>,
  up: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" width="12" height="12"><line x1="12" y1="19" x2="12" y2="5" /><polyline points="5 12 12 5 19 12" /></svg>,
  down: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" width="12" height="12"><line x1="12" y1="5" x2="12" y2="19" /><polyline points="19 12 12 19 5 12" /></svg>,
};

function Toast({ msg }: { msg: string | null }) {
  if (!msg) return null;
  return (
    <div className="fixed left-1/2 bottom-8 -translate-x-1/2 z-[99] bg-[#1f2937] text-white text-[13px] px-4 py-2.5 rounded-xl shadow-lg max-w-[80vw] text-center">
      <span dangerouslySetInnerHTML={{ __html: msg }} />
    </div>
  );
}

/* ═══════════════════════════════════════════
   主页面
   ═══════════════════════════════════════════ */
export default function ProjectsPage() {
  const { open: openArchive } = useArchive();
  const [trees, setTrees] = useState<TreeNode[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [toastMsg, setToastMsg] = useState<string | null>(null);
  const [streaks, setStreaks] = useState<Record<string, StreakInfo>>({});
  const [starSet, setStarSet] = useState<Set<string>>(new Set()); // ★ 执行清单开关（乐观）
  const [poolList, setPoolList] = useState<TreeNode[]>([]);
  const [orphanAcc, setOrphanAcc] = useState<TreeNode[]>([]); // 未挂树的积累型习惯
  const [archiveList, setArchiveList] = useState<TreeNode[]>([]);
  const [archiveOpen, setArchiveOpen] = useState(false);

  // 新建 inline input
  const [newOpen, setNewOpen] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [newTarget, setNewTarget] = useState<string | null>(null); // parentId | null=项目根
  const newInputRef = useRef<HTMLInputElement>(null);

  // 拖拽
  const [dragId, setDragId] = useState<string | null>(null);
  const [dragSource, setDragSource] = useState<"tree" | "pool" | null>(null);
  const [dragZone, setDragZone] = useState<{ id: string; zone: "child" | "before" | "after" } | null>(null);

  const showToast = useCallback((html: string) => {
    setToastMsg(html);
    setTimeout(() => setToastMsg(null), 2400);
  }, []);

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    setError(false);
    try {
      const r = await fetch("/api/projects/tree");
      if (!r.ok) throw new Error();
      const d: TreeResponse = await r.json();
      // 2026-08-07 修复（BUG-20260807-017）：★ 乐观状态优先——load 重取树时若某节点
      // 在 starSet 中（用户刚点过 ★，PUT 尚未完成），用 starSet 覆盖接口返回值，
      // 避免"乐观点亮 → 广播 → load 用旧数据覆盖 → 视觉闪回"竞态。
      const applyStarSet = (list: TreeNode[]): TreeNode[] =>
        list.map((t) => ({ ...t, star: starSet.has(t.id) || !!t.star, children: applyStarSet(t.children ?? []) }));
      setTrees(applyStarSet(d.trees || []));
      setExpanded((prev) => {
        const next = new Set(prev);
        (d.trees || []).forEach((t) => next.add(t.id));
        return next;
      });
    } catch { setError(true); }
    finally { setLoading(false); }
  }, [starSet]);

  useEffect(() => { load(); }, [load]);

  // 档案面板数据变更（保存/移出完成/补记/删除）→ 树实时刷新，无需手动刷新页面
  useEffect(() => {
    const h = () => { load(true); };
    window.addEventListener("meridian-task-changed", h);
    return () => window.removeEventListener("meridian-task-changed", h);
  }, [load]);

  // 习惯区 streak 数据（所有积累型任务）
  useEffect(() => {
    if (!trees.length) return;
    const accTasks = flatten(trees).filter((t) => t.accumulate);
    if (!accTasks.length) return;
    let alive = true;
    accTasks.forEach(async (t) => {
      try {
        const r = await fetch(`/api/tasks/${t.id}/streak`);
        if (r.ok) {
          const d = await r.json();
          if (alive) setStreaks((prev) => ({ ...prev, [t.id]: d.streak }));
        }
      } catch { /* 静默 */ }
    });
    return () => { alive = false; };
  }, [trees]);

  // 待整理池 + 归档
  useEffect(() => {
    if (!trees.length) return;
    fetch("/api/projects/tree").then(async (r) => {
      if (!r.ok) return;
      const d: TreeResponse = await r.json();
      const orphans = (d.orphans || []).filter((o) => o.status !== "cancelled");
      // BUG-20260807-042：积累孤儿也进待整理池（可挂树）——原实现排除 accumulate 导致
      // 积累任务无法挂树 → 无法 ★ → 无法排期 → Today 积累卡今日不可达（死链）。
      // 习惯区（orphanAcc）仍保留，挂树后习惯区与树行并存不冲突。
      setPoolList(orphans);
      setOrphanAcc(orphans.filter((o) => o.accumulate));
      const doneInTree = flatten(d.trees || []).filter((t) => t.status === "completed");
      const doneOrphans = (d.orphans || []).filter((o) => o.status === "completed");
      setArchiveList([...doneInTree, ...doneOrphans].filter((v, i, a) => a.findIndex((x) => x.id === v.id) === i));
    }).catch(() => {});
  }, [trees]);

  /* ── API ── */
  const moveNode = useCallback(async (taskId: string, newParentId: string | null, sortOrder?: number) => {
    const r = await fetch("/api/projects/move", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ taskId, newParentId, sortOrder }),
    });
    if (!r.ok) throw new Error("移动失败");
  }, []);

  const updateTask = useCallback(async (id: string, data: Record<string, unknown>) => {
    const r = await fetch(`/api/tasks/${id}`, {
      method: "PUT", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
    if (!r.ok) throw new Error("更新失败");
  }, []);

  const createTask = useCallback(async (data: Record<string, unknown>) => {
    const r = await fetch("/api/tasks", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
    if (!r.ok) throw new Error("创建失败");
    return r.json();
  }, []);

  /* ── ★ 清单开关（乐观 starSet + 本地树同步 + PUT 落库：设置后即时生效，无需刷新） ── */
  const toggleStar = useCallback((node: TreeNode) => {
    const on = !starSet.has(node.id);
    setStarSet((prev) => {
      const n = new Set(prev);
      if (on) n.add(node.id); else n.delete(node.id);
      return n;
    });
    // 本地树同步：直接改对应节点 star，starOn 立即生效（不依赖 load/刷新）
    setTrees((prev) => {
      const walk = (list: TreeNode[]): boolean => {
        for (const t of list) {
          if (t.id === node.id) { t.star = on; return true; }
          if (walk(t.children)) return true;
        }
        return false;
      };
      const next = prev.map((t) => ({ ...t }));
      walk(next);
      return next;
    });
    updateTask(node.id, { star: on }).catch(() => {});
    // Bug3 修复：★ 变更广播 → Plan 收集箱/Today 实时刷新（否则需手动刷新才更新显示）
    window.dispatchEvent(new CustomEvent("meridian-task-changed"));
    showToast(on ? `已设为「执行清单」· Today 可出发勾选` : `已取消清单 · 变为纯结构节点`);
  }, [starSet, updateTask, showToast]);

  /* ── 新建 ── */
  const newNode = useCallback((parentId: string | null) => {
    setNewTarget(parentId);
    setNewTitle("");
    setNewOpen(true);
    setTimeout(() => newInputRef.current?.focus(), 0);
  }, []);

  const createNode = useCallback(async () => {
    const v = newTitle.trim();
    if (!v) return;
    const parent = newTarget ? findNode(trees, newTarget) : null;
    const level = parent ? (parent.level === "project" ? "phase" : "task") : "project";
    try {
      await createTask({ title: v, level, taskType: "task", ...(newTarget ? { parentId: newTarget } : {}) });
      setNewOpen(false);
      showToast(`已创建「${v}」${parent ? ` → 挂入 ${parent.title}` : ""}`);
      await load();
    } catch (err) { showToast(`操作失败：${(err as Error).message || "请重试"}`); }
  }, [newTitle, newTarget, trees, createTask, load, showToast]);

  /* ── 同级排序（↑↓） ── */
  const moveSibling = useCallback(async (node: TreeNode, dir: number) => {
    const parent = findParent(trees, node.id);
    const siblings = parent ? (parent.children || []) : trees;
    const idx = siblings.findIndex((s) => s.id === node.id);
    const ni = idx + dir;
    if (ni < 0 || ni >= siblings.length) return;
    const arr = [...siblings];
    const [n] = arr.splice(idx, 1);
    arr.splice(ni, 0, n);
    try {
      for (let i = 0; i < arr.length; i++) {
        if (arr[i].id !== siblings[i]?.id) await moveNode(arr[i].id, parent?.id || null, i);
      }
      showToast(`已${dir < 0 ? "上移" : "下移"}「${node.title}」`);
      await load(true);
    } catch (err) { showToast(`操作失败：${(err as Error).message || "请重试"}`); }
  }, [trees, moveNode, load, showToast]);

  /* ── 拖拽 ── */
  const clearDrag = useCallback(() => {
    setDragId(null); setDragSource(null); setDragZone(null);
  }, []);

  const onRowDragOver = useCallback((e: React.DragEvent, node: TreeNode) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    if (!dragId) return;
    if (dragId === node.id) { setDragZone(null); return; }
    if (dragSource === "tree") {
      const dn = findNode(trees, dragId);
      if (dn && isDescendant(dn, node.id)) { setDragZone(null); return; }
    }
    // 性能修复（浏览器卡退根因）：待整理池源只支持"挂为子级"，跳过 before/after 计算；
    // 且同值 setState 返回 prev（React 不重渲染）→ 拖动时跨节点才触发一次渲染
    const zone: "child" | "before" | "after" = dragSource === "pool"
      ? "child"
      : (e.clientY - e.currentTarget.getBoundingClientRect().top) < e.currentTarget.getBoundingClientRect().height / 3
        ? "before"
        : (e.clientY - e.currentTarget.getBoundingClientRect().top) > (e.currentTarget.getBoundingClientRect().height * 2) / 3
          ? "after"
          : "child";
    setDragZone((prev) => (prev?.id === node.id && prev.zone === zone ? prev : { id: node.id, zone }));
  }, [dragId, dragSource, trees]);

  const onRowDrop = useCallback(async (e: React.DragEvent, node: TreeNode) => {
    e.preventDefault();
    e.stopPropagation();
    // 拖拽可靠性根治：id/source 优先读 dataTransfer（drag 会话内恒定），React state 兜底
    // （修复：跨容器拖拽时 React state 可能竞态丢失 → 待整理拖入项目始终失败，而树内拖拽正常）
    const id = dragId ?? e.dataTransfer.getData("text/plain");
    const src = dragSource ?? (e.dataTransfer.getData("application/x-task-source") || "tree");
    const zone = dragZone?.id === node.id ? dragZone.zone : "child";
    clearDrag();
    if (!id || !src || id === node.id) return;
    const name = src === "tree" ? findNode(trees, id)?.title ?? "" : "";
    const targetName = node.title;
    try {
      if (zone === "child") {
        // 成为子级（池→树 或 树内）
        await moveNode(id, node.id);
        // 拖入后自动展开目标节点（否则折叠状态下任务"消失"看似拖拽失败）
        setExpanded((prev) => new Set(prev).add(node.id));
        showToast(`${src === "pool" ? "已挂入" : `「${name}」已挂入`}「${targetName}」`);
      } else {
        // 换序：插入到 target 同级前/后（tree 源）
        const parent = findParent(trees, node.id);
        const siblings = parent ? (parent.children || []) : trees;
        const arr = siblings.filter((s) => s.id !== id);
        const ti = arr.findIndex((s) => s.id === node.id);
        if (ti >= 0) {
          arr.splice(zone === "before" ? ti : ti + 1, 0, findNode(trees, id)!);
          for (let i = 0; i < arr.length; i++) {
            if (arr[i].id !== siblings[i]?.id) await moveNode(arr[i].id, parent?.id || null, i);
          }
        }
        showToast(`「${name}」已调整顺序`);
      }
      await load(true);
    } catch (err) { showToast(`操作失败：${(err as Error).message || "请重试"}`); }
  }, [dragId, dragSource, dragZone, trees, moveNode, load, showToast, clearDrag]);

  /* ── 待整理池 drop（问题2：树任务可拖回池 = 解挂载；池项拖回自身忽略） ── */
  const [poolDragOver, setPoolDragOver] = useState(false);
  const onPoolDrop = useCallback(async (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setPoolDragOver(false);
    const id = dragId ?? e.dataTransfer.getData("text/plain");
    const src = dragSource ?? (e.dataTransfer.getData("application/x-task-source") || "tree");
    const name = src === "tree" ? findNode(trees, id ?? "")?.title ?? "" : "";
    clearDrag();
    if (!id || src !== "tree") return;
    try {
      await moveNode(id, null);
      showToast(`「${name}」已移出项目 → 待整理池`);
      await load(true);
    } catch (err) { showToast(`操作失败：${(err as Error).message || "请重试"}`); }
  }, [dragId, dragSource, trees, moveNode, load, showToast, clearDrag]);

  /* ── 树区空白 drop（问题3：待整理 task 拖入空白 = 自动生成项目并挂入） ── */
  const [treeBlankDragOver, setTreeBlankDragOver] = useState(false);
  const onTreeBlankDrop = useCallback(async (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setTreeBlankDragOver(false);
    const id = dragId ?? e.dataTransfer.getData("text/plain");
    const src = dragSource ?? (e.dataTransfer.getData("application/x-task-source") || "tree");
    clearDrag();
    if (!id || src !== "pool") return;
    const o = poolList.find((x) => x.id === id);
    try {
      const th = o ? resolveTheme(null, o.title, o.category) : null;
      // Bug1 修复：POST /api/tasks 直接返回 task 本体（含 id），不是 { task } —— 原 d.task?.id 恒 undefined → moveNode 落空
      const d = await createTask({ title: th ?? o?.title ?? "新项目", level: "project", taskType: "task" });
      await moveNode(id, d?.id ?? "");
      showToast(`已新建项目「${th ?? o?.title ?? "新项目"}」并挂入`);
      await load(true);
    } catch (err) { showToast(`操作失败：${(err as Error).message || "请重试"}`); }
  }, [dragId, dragSource, poolList, createTask, moveNode, load, showToast, clearDrag]);

  /* ── 行渲染（flatten + 连接线重算） ── */
  const visibleRows = useMemo(() => {
    const rows: { node: TreeNode; lvl: number; hasKids: boolean; isOpen: boolean }[] = [];
    const roots = trees.filter((t) => t.level !== "task");
    const walk = (list: TreeNode[], lvl: number) => {
      list.forEach((n) => {
        const kids = n.children || [];
        rows.push({ node: n, lvl: Math.min(lvl, 3), hasKids: kids.length > 0, isOpen: expanded.has(n.id) });
        if (kids.length && expanded.has(n.id)) walk(kids, lvl + 1);
      });
    };
    walk(roots, 0);
    return rows.map((r, i) => {
      const prev = rows[i - 1];
      const next = rows[i + 1];
      return { ...r, noPrev: !prev || prev.lvl >= r.lvl, lastGroup: !next || next.lvl < r.lvl };
    });
  }, [trees, expanded]);

  const renderRow = (row: (typeof visibleRows)[number]) => {
    const { node, lvl, hasKids, isOpen, noPrev, lastGroup } = row;
    const isDone = node.status === "completed";
    const isAccum = node.accumulate;
    const sel = selectedId === node.id;
    const th = nodeTheme(node);
    // ★：乐观 starSet 优先，后端 node.star 兜底（修复刷新后设置丢失）
    const starOn = starSet.has(node.id) || !!node.star;
    const zone = dragZone?.id === node.id ? dragZone.zone : null;
    const zoneCls = zone ? ` drag-over-${zone}` : "";
    const isDragging = dragId === node.id;

    let prog: React.ReactNode;
    if (isAccum) prog = <b>{streaks[node.id]?.current ?? 0}天</b>;
    else if (lvl <= 1) {
      const { done, total } = treeDone(node.children || []);
      prog = <b>{done}/{total}</b>;
    } else prog = <b>{isDone ? "✓" : "…"}</b>;

    return (
      <div
        key={node.id}
        className={`pt-row lvl${lvl}${isAccum ? " is-accum" : ""}${starOn ? " is-list" : ""}${sel ? " sel" : ""}${noPrev ? " no-prev" : ""}${lastGroup ? " last-group" : ""}${zoneCls}${isDragging ? " dragging" : ""}`}
        style={lvl === 0 && th ? ({ "--pcolor": th.color, "--pbg": th.bg } as React.CSSProperties) : undefined}
        draggable
        onDragStart={(e) => { setDragId(node.id); setDragSource("tree"); e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("text/plain", node.id); e.dataTransfer.setData("application/x-task-source", "tree"); }}
        onDragEnd={clearDrag}
        onDragOver={(e) => onRowDragOver(e, node)}
        onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragZone((prev) => (prev?.id === node.id ? null : prev)); }}
        onDrop={(e) => onRowDrop(e, node)}
        onClick={() => { setSelectedId(node.id); openArchive(node.id); }}
      >
        <span className="pt-indent" />
        {hasKids ? (
          <span className="pt-tw" onClick={(e) => { e.stopPropagation(); setExpanded((prev) => { const n = new Set(prev); if (n.has(node.id)) n.delete(node.id); else n.add(node.id); return n; }); }}>{isOpen ? "▾" : "▸"}</span>
        ) : (
          <span className="pt-tw empty">·</span>
        )}
        <span className="pt-hdot"><i /></span>
        {/* 设计改进：完成状态不用删除线，名称旁绿色「✓ 完成」标记 */}
        <span className="pt-name" style={isDone ? { color: "var(--v2-text3)" } : undefined}>{node.title}</span>
        {isDone && <span className="pt-done-tag">✓ 完成</span>}
        {lvl === 0 && <span className="pt-badge b-proj">项目</span>}
        {lvl === 1 && !isAccum && <span className="pt-badge b-stage">阶段</span>}
        {isAccum && <span className="pt-badge b-accum">积累</span>}
        {lvl === 0 && th && <span className="pt-theme">{th.name}</span>}
        {starOn && <span className="pt-check">执行清单</span>}
        {isAccum && (
          <span
            className={`pt-gold-dot${streaks[node.id]?.todayChecked ? "" : " off"}`}
            title={streaks[node.id]?.todayChecked ? "今日已打卡" : "今日未打卡 · 打卡在右侧习惯区"}
          />
        )}
        <span className={`pt-star${starOn ? " on" : ""}`} onClick={(e) => { e.stopPropagation(); toggleStar(node); }}>★</span>
        <span className="pt-prog">{prog}</span>
        <span className="pt-opts">
          {lvl < 3 && <button title="新建子项" onClick={(e) => { e.stopPropagation(); newNode(node.id); }}>{Ic.plus}</button>}
          <button title="上移" onClick={(e) => { e.stopPropagation(); moveSibling(node, -1); }}>{Ic.up}</button>
          <button title="下移" onClick={(e) => { e.stopPropagation(); moveSibling(node, 1); }}>{Ic.down}</button>
        </span>
      </div>
    );
  };

  /* ── 待整理池 AI 建议（后端 suggestion 字段优先，未就绪前端推断） ── */
  const suggestionOf = useCallback((o: TreeNode): { projId: string | null; label: string } | null => {
    if (o.suggestion) return { projId: null, label: o.suggestion };
    const th = resolveTheme(null, o.title, o.category);
    const proj = th ? trees.find((t) => t.level === "project" && resolveTheme(null, t.title, t.category) === th) : null;
    if (proj) return { projId: proj.id, label: `AI 建议 → 挂入 ${proj.title}` };
    if (th) return { projId: null, label: `AI 建议 → 新建项目 ${th}` };
    return null;
  }, [trees]);

  const attachPool = useCallback(async (o: TreeNode, projId: string | null) => {
    try {
      if (projId) {
        await moveNode(o.id, projId);
        showToast(`已挂入「${findNode(trees, projId)?.title ?? "项目"}」· 待整理池 -1`);
      } else {
        const th = resolveTheme(null, o.title, o.category);
        const d = await createTask({ title: th ?? o.title, level: "project", taskType: "task" });
        await moveNode(o.id, d?.id ?? "");
        showToast(`已新建项目「${th ?? o.title}」并挂入`);
      }
      await load(true);
    } catch (err) { showToast(`操作失败：${(err as Error).message || "请重试"}`); }
  }, [trees, moveNode, createTask, load, showToast]);

  /* ── 习惯区打卡 ── */
  const habits = useMemo(() => {
    const inTree = flatten(trees).filter((t) => t.accumulate);
    return [...inTree, ...orphanAcc].filter((v, i, a) => a.findIndex((x) => x.id === v.id) === i);
  }, [trees, orphanAcc]);

  const checkin = useCallback(async (id: string, title: string) => {
    try {
      const r = await fetch(`/api/tasks/${id}/checkin`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({}) });
      if (r.ok) {
        const d = await r.json();
        setStreaks((prev) => ({ ...prev, [id]: d.streak }));
        showToast(`已打卡「${title}」· 连续 ${d.streak?.current ?? 0} 天`);
      }
    } catch (err) { showToast(`操作失败：${(err as Error).message || "请重试"}`); }
  }, [showToast]);

  const weekDots = (t: TreeNode) => {
    const last30 = streaks[t.id]?.last30 || [];
    const days: boolean[] = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const ds = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
      days.push(last30.includes(ds));
    }
    return (
      <span className="flex gap-[3px] flex-shrink-0">
        {days.map((f, i) => <span key={i} className={`pt-hw-dot${f ? " fill" : ""}`} />)}
      </span>
    );
  };

  if (loading) return <div className="space-y-3"><div className="h-8 w-56 rounded bg-[var(--color-gray-100)] animate-pulse" /><div className="h-96 rounded-xl bg-[var(--color-gray-100)] animate-pulse" /></div>;
  if (error) return (
    <div className="text-center py-16">
      <div className="text-[15px] font-medium text-[var(--v2-text)] mb-2">加载项目树失败</div>
      <button onClick={() => load()} className="text-sm px-4 py-2 rounded-lg bg-[var(--v2-brand)] text-white hover:bg-[var(--v2-brand-deep)] transition">重试</button>
    </div>
  );

  const treeCount = trees.filter((t) => t.level === "project").length;
  const nodeCount = visibleRows.length;

  return (
    <div className="max-w-[1080px] mx-auto space-y-4">
      <Toast msg={toastMsg} />

      {/* 页头（副本 v3.1：标题 + 副标题 + 说明 chips） */}
      <div className="flex items-end justify-between flex-wrap gap-2.5">
        <div className="min-w-0">
          <h2 className="text-[22px] font-extrabold tracking-[-0.3px] text-[var(--v2-text)]">Project · 项目整理</h2>
          <div className="text-[12px] text-[var(--v2-text3)] mt-1">项目根 = 分组头（浅底）· 层级圆点 + 连接线 · 打卡统一在右侧习惯区</div>
        </div>
        <div className="flex gap-1.5 flex-wrap">
          <span className="text-[10.5px] font-semibold px-2.5 py-1 rounded-[14px] bg-white border border-[#dfe3ea] text-[var(--v2-text2)]">项目根 = 分组头</span>
          <span className="text-[10.5px] font-semibold px-2.5 py-1 rounded-[14px] bg-white border border-[#dfe3ea] text-[var(--v2-text2)]">圆点分级</span>
          <span className="text-[10.5px] font-semibold px-2.5 py-1 rounded-[14px] bg-[var(--v2-brand-bg)] border border-[#c7d2fe] text-[var(--v2-brand-deep)]">拖拽 / 新建 / ★</span>
        </div>
      </div>

      <div className="pt-main">
        {/* ═══ 左：大纲式树 ═══ */}
        <div className={`${cardCls} overflow-hidden`}>
          <div className="flex items-center gap-2 px-4 py-2.5 border-b border-[var(--v2-border)]">
            <span className="w-[7px] h-[7px] rounded-full bg-[var(--v2-brand)] flex-none" />
            <span className="text-[13px] font-bold text-[var(--v2-text)]">项目树</span>
            <span className="text-[10.5px] text-[var(--v2-text3)] ml-auto">{treeCount} 项目 · {nodeCount} 节点</span>
            <button className="pt-new-btn ml-2 text-[10.5px] font-semibold text-[var(--v2-brand-deep)] bg-[var(--v2-brand-bg)] border-none rounded-md px-2.5 py-1 cursor-pointer hover:bg-[#c7d2fe] transition-colors" onClick={() => newNode(null)}>＋ 新建项目</button>
          </div>
          <input
            ref={newInputRef}
            className={`pt-new-input${newOpen ? " show" : ""}`}
            placeholder="输入名称，回车创建（Esc 取消）"
            value={newTitle}
            onChange={(e) => setNewTitle(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") createNode();
              if (e.key === "Escape") { setNewOpen(false); setNewTitle(""); }
            }}
          />
          <div
            className={`p-[8px_6px_10px] ${treeBlankDragOver ? "ring-2 ring-[var(--v2-brand)] ring-offset-2 rounded-lg" : ""}`}
            onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = "move"; setTreeBlankDragOver((prev) => prev ? prev : true); }}
            onDragLeave={(e) => { if (e.currentTarget.contains(e.relatedTarget as Node)) return; setTreeBlankDragOver(false); }}
            onDrop={onTreeBlankDrop}
          >
            {visibleRows.length === 0 ? (
              <div className="text-center py-12">
                <div className="w-12 h-12 mx-auto rounded-2xl bg-[var(--v2-brand-bg)] flex items-center justify-center mb-3">🗂</div>
                <div className="text-[15px] font-medium text-[var(--v2-text)] mb-1.5">还没有项目</div>
                <div className="text-sm text-[var(--v2-text3)] mb-4">点上方「＋新建项目」创建第一个项目</div>
                <button className="text-sm font-medium rounded-lg bg-[var(--v2-brand)] text-white hover:bg-[var(--v2-brand-deep)] transition-all px-4 py-2.5 min-h-[44px]" onClick={() => newNode(null)}>＋ 新建项目</button>
              </div>
            ) : (
              <div className="flex flex-col">
                {visibleRows.map(renderRow)}
              </div>
            )}
            <div className="pt-tip">
              <b>拖拽</b> 行到节点上 = 成为子级 · <b>拖到两行间</b> = 换序 · 行尾 <b>＋</b> = 新建子项 · <b>★</b> = 设为执行清单
            </div>
          </div>
        </div>

        {/* ═══ 右栏三区 ═══ */}
        <div className="flex flex-col gap-3.5 min-w-0">
          {/* 待整理池 */}
          <div className={`${cardCls} overflow-hidden transition ${poolDragOver ? "ring-2 ring-[var(--pt-gold)]" : ""}`}
            onDragOver={(e) => { if (dragSource === "tree") { e.preventDefault(); e.dataTransfer.dropEffect = "move"; setPoolDragOver((prev) => prev ? prev : true); } }}
            onDragLeave={(e) => { if (e.currentTarget.contains(e.relatedTarget as Node)) return; setPoolDragOver(false); }}
            onDrop={onPoolDrop}
          >
            <div className="flex items-center gap-2 px-4 py-2.5 border-b border-[var(--v2-border)]">
              <span className="w-[7px] h-[7px] rounded-full bg-[var(--pt-gold)] flex-none" />
              <span className="text-[13px] font-bold text-[var(--v2-text)]">待整理 · 今天要归位的</span>
              <span className="text-[10.5px] text-[var(--v2-text3)] ml-auto">{poolList.length} 项</span>
            </div>
            <div className="p-2">
              {poolList.length === 0 ? (
                <div className="text-center text-[11.5px] text-[var(--v2-text3)] py-5 border border-dashed border-[var(--v2-border)] rounded-lg">待整理池已清空 🎉</div>
              ) : (
                poolList.map((o) => {
                  const sug = suggestionOf(o);
                  const poolDragging = dragId === o.id;
                  return (
                    <div
                      key={o.id}
                      className={`pt-pool-item${poolDragging ? " dragging" : ""}`}
                      title="拖拽到左侧项目树 = 挂为子级"
                      draggable
                      onDragStart={(e) => { setDragId(o.id); setDragSource("pool"); e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("text/plain", o.id); e.dataTransfer.setData("application/x-task-source", "pool"); }}
                      onDragEnd={clearDrag}
                    >
                      <div className="flex items-center gap-2">
                        <span className="w-2 h-2 rounded-full flex-none" style={{ background: DOMAINS[normalizeCategory(o.category)].border }} />
                        <span className="text-[13px] font-medium min-w-0 truncate flex-1">{o.title}</span>
                        <span className="text-[9px] text-[var(--v2-text3)] bg-[#f1f5f9] rounded px-1.5 py-px flex-none">{INBOX_SHORT[o.category ?? "other"] ?? "未分类"}</span>
                      </div>
                      {sug && (
                        <div className="flex items-center gap-1.5 mt-2 flex-wrap">
                          <span className="pt-ai-sug"><b>{sug.label}</b></span>
                          <button className="pt-ai-btn" onClick={() => attachPool(o, sug.projId)}>挂入</button>
                        </div>
                      )}
                      <div className="pt-pool-hint text-[9px] text-[var(--v2-text3)] mt-1.5 opacity-60 transition-opacity">⇱ 按住拖拽到左侧任意项目（树内可挂子级/换序）{o.hasSchedule ? " · ⏱ 已排期到 Plan，拖动仍可挂入项目" : ""}</div>
                    </div>
                  );
                })
              )}
            </div>
          </div>

          {/* 习惯区（打卡唯一入口） */}
          <div className={`${cardCls} overflow-hidden`}>
            <div className="flex items-center gap-2 px-4 py-2.5 border-b border-[var(--v2-border)]">
              <span className="w-[7px] h-[7px] rounded-full bg-[var(--pt-gold)] flex-none" />
              <span className="text-[13px] font-bold text-[var(--v2-text)]">习惯 · 打卡</span>
              <span className="text-[10.5px] text-[var(--v2-text3)] ml-auto">唯一入口</span>
            </div>
            <div className="p-2">
              {habits.length === 0 ? (
                <div className="text-center text-[11.5px] text-[var(--v2-text3)] py-5 border border-dashed border-[var(--v2-border)] rounded-lg">暂无积累型习惯</div>
              ) : (
                habits.map((h) => {
                  const st = streaks[h.id];
                  const checked = st?.todayChecked ?? false;
                  return (
                    <div key={h.id} className="pt-habit">
                      <span className="text-[13px] font-medium flex-1 min-w-0 truncate">{h.title}</span>
                      {weekDots(h)}
                      <span className="text-[10px] text-[var(--v2-text3)] whitespace-nowrap">连续 <b className="text-[var(--v2-amber)] font-bold">{st?.current ?? 0}</b> 天</span>
                      <button className={`pt-h-check ${checked ? "done" : "idle"}`} onClick={() => { if (!checked) checkin(h.id, h.title); }}>
                        {checked ? "已打卡 ✓" : "今日打卡"}
                      </button>
                    </div>
                  );
                })
              )}
              <div className="text-[9.5px] text-[var(--v2-text3)] text-center pt-1 pb-0.5">打卡统一在此 · 树行只留金色状态点</div>
            </div>
          </div>

          {/* 归档 */}
          <div className={`${cardCls} overflow-hidden`}>
            <div className={`pt-ar-head${archiveOpen ? " open" : ""}`} onClick={() => setArchiveOpen((v) => !v)}>
              <span className="arr">▸</span>归档
              <span className="cnt">{archiveList.length} 项 · 点开查看</span>
            </div>
            <div className={`pt-ar-body${archiveOpen ? " open" : ""}`}>
              {archiveList.length === 0 ? (
                <div className="text-[11px] text-[var(--v2-text3)] py-2">暂无归档</div>
              ) : (
                archiveList.map((a) => (
                  <div key={a.id} className="pt-ar-item">{a.title}（完成）</div>
                ))
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
