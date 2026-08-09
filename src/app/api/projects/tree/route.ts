// V5 项目整理页：读取任务树
// GET /api/projects/tree → { trees: TreeNode[], orphans: TreeNode[] }
// 一次全查 + 内存组装（深度不限），orphans = 未挂树的任务级任务（可拖进任意树）
// Project 页优化（2026-08-04）：+themeColor（project 派生色）/ +suggestion（orphans 建议归属）/ +doneCount/totalCount（完成度）/ +star

import { NextResponse } from "next/server";
import { getServerSession, unauthorized } from "@/lib/api-utils";
import { prisma } from "@/lib/prisma";
import { deriveProjectThemeColor } from "@/lib/project/theme-color";
import { suggestTarget, type Suggestion } from "@/lib/project/suggestion";
import { getStreak } from "@/lib/task/streak";

interface TreeNode {
  id: string;
  title: string;
  level: string;
  status: string;
  accumulate: boolean;
  completedAt: string | null;
  category: string | null;
  theme: string | null;
  themeColor: { pcolor: string; pbg: string; theme: string | null } | null;
  /** B7：原始落库色（自定义主题 JSON，内部聚合用，不进前端契约） */
  themeColorRaw?: string | null;
  estimatedMinutes: number | null;
  deadline: string | null;
  importance: number;
  parentId: string | null;
  star: boolean;
  doneCount: number;
  totalCount: number;
  streak?: { current: number; longest: number; lastDate: string | null; todayChecked: boolean; last30: string[] } | null;
  weekTarget?: number | null;
  weekCount?: number | null;
  children: TreeNode[];
  suggestion?: Suggestion | null; // 仅 orphans 顶层使用
  hasSchedule?: boolean | null;   // 待整理池：是否已排期（与 Plan 共用记录透明化）
}

// 树内原始节点（轻量）
interface RawNode {
  id: string; title: string; level: string | null; status: string; accumulate: boolean;
  completedAt: Date | null; category: string | null; theme: string | null; themeColor: string | null;
  estimatedMinutes: number | null; deadline: Date | null; importance: number;
  parentId: string | null; star: boolean; sortOrder: number;
}

export async function GET() {
  const session = await getServerSession();
  if (!session) return unauthorized();

  const tasks = await prisma.task.findMany({
    where: { userId: session.user.id },
    select: {
      id: true, title: true, level: true, status: true, accumulate: true,
      completedAt: true, category: true, theme: true, themeColor: true, estimatedMinutes: true,
      deadline: true, importance: true, parentId: true, sortOrder: true, star: true,
    },
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
  }) as RawNode[];

  const nodes = new Map<string, TreeNode>();
  for (const t of tasks) {
    nodes.set(t.id, {
      id: t.id, title: t.title, level: t.level || "task", status: t.status,
      accumulate: t.accumulate, completedAt: t.completedAt?.toISOString() ?? null,
      category: t.category, theme: t.theme ?? null,
      themeColor: null, // 阶段 A：project 级派生色（子树聚合后填）
      themeColorRaw: t.themeColor ?? null,
      estimatedMinutes: t.estimatedMinutes,
      deadline: t.deadline?.toISOString() ?? null, importance: t.importance,
      parentId: t.parentId, star: t.star,
      doneCount: 0, totalCount: 0, // 阶段 C：完成度（聚合后填）
      children: [],
    });
  }

  const roots: TreeNode[] = [];
  for (const t of tasks) {
    const node = nodes.get(t.id)!;
    if (t.parentId && nodes.has(t.parentId)) {
      nodes.get(t.parentId)!.children.push(node);
    } else {
      roots.push(node);
    }
  }

  // ── 阶段 C：完成度聚合（自底向上，直接子级统计；cancelled 不计入）──
  function aggregateCompletion(node: TreeNode): { done: number; total: number } {
    let done = node.status === "completed" ? 1 : 0;
    let total = node.status !== "cancelled" ? 1 : 0;
    for (const c of node.children) {
      const sub = aggregateCompletion(c);
      done += sub.done;
      total += sub.total;
    }
    node.doneCount = done;
    node.totalCount = total;
    return { done, total };
  }
  for (const r of roots) aggregateCompletion(r);

  // ── 阶段 A：project 级派生色（子树任务 theme/category 主频聚合）──
  function collectDescendants(node: TreeNode): { theme: string | null; category: string | null; themeColor: string | null }[] {
    const acc: { theme: string | null; category: string | null; themeColor: string | null }[] = [];
    const walk = (n: TreeNode) => {
      for (const c of n.children) {
        acc.push({ theme: c.theme, category: c.category, themeColor: c.themeColorRaw ?? null });
        walk(c);
      }
    };
    walk(node);
    return acc;
  }
  function applyThemeColor(node: TreeNode) {
    if (node.level === "project") {
      const descendants = collectDescendants(node);
      node.themeColor = deriveProjectThemeColor(descendants);
    }
    for (const c of node.children) applyThemeColor(c);
  }
  for (const r of roots) applyThemeColor(r);

  // ── 阶段 B：orphans 建议归属（标题/主题匹配，零 AI，不强猜）──
  const orphans = roots.filter(r => r.level === "task" && r.status !== "cancelled");
  // 候选挂入目标 = project/phase 级节点（含其下各级的 project/phase 节点）
  const candidateTargets: { id: string; title: string; theme: string | null }[] = [];
  const collectTargets = (node: TreeNode) => {
    if (node.level === "project" || node.level === "phase") {
      candidateTargets.push({ id: node.id, title: node.title, theme: node.theme });
    }
    for (const c of node.children) collectTargets(c);
  };
  for (const r of roots) collectTargets(r);

  for (const o of orphans) {
    o.suggestion = suggestTarget({ title: o.title, theme: o.theme }, candidateTargets);
  }

  // 2026-08-06：待整理池排期状态（问题2 透明化 —— 待整理与 Plan 共用同一条任务记录，
  // 被排期的任务仍显示在待整理池，但应明确标注"已排期"避免"拖不进项目"的误解）
  if (orphans.length > 0) {
    const schedCounts = await prisma.schedule.groupBy({
      by: ["taskId"],
      where: { userId: session.user.id, taskId: { in: orphans.map(o => o.id) } },
      _count: { taskId: true },
    });
    const schedMap = new Map(schedCounts.map(s => [s.taskId, s._count.taskId]));
    for (const o of orphans) o.hasSchedule = (schedMap.get(o.id) ?? 0) > 0;
  }

  // ── 积累型：streak 透传（树接口复用，阶段 C 需求：积累型返回连续天数）──
  const accumNodes: TreeNode[] = [];
  const walkAccum = (node: TreeNode) => {
    if (node.accumulate) accumNodes.push(node);
    for (const c of node.children) walkAccum(c);
  };
  for (const r of roots) walkAccum(r);
  if (accumNodes.length > 0) {
    const streaks = await Promise.all(
      accumNodes.map(n => getStreak(session.user.id, n.id).catch(() => null))
    );
    accumNodes.forEach((n, i) => { n.streak = streaks[i]; });
  }

  return NextResponse.json({ trees: roots, orphans });
}
