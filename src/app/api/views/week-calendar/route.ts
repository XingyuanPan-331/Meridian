import { NextRequest, NextResponse } from "next/server";
import { localDateStr } from "@/lib/date";
import { getServerSession, unauthorized } from "@/lib/api-utils";
import { prisma } from "@/lib/prisma";
import { resolveDomain, normalizeCategory } from "@/lib/plan/colors";
import { deduplicateByDay } from "@/lib/plan/service";
import { themeColor, themeColorWithCustom } from "@/lib/task/theme";

/** 分类兜底：数据库为空时按标题/标签推断（旧数据没有 category 字段值） */
function effCategory(task: { category: string | null; tags: string | null; title: string }): string | null {
  const norm = normalizeCategory(task.category);
  if (norm !== "other") return norm;
  const inferred = resolveDomain(task.tags, task.title);
  return inferred === "other" ? null : inferred;
}

export async function GET(req: NextRequest) {
  const session = await getServerSession();
  if (!session) return unauthorized();

  const userId = session.user.id;
  const { searchParams } = new URL(req.url);
  const weekStartStr = searchParams.get("weekStart");

  let weekStart: Date;
  if (weekStartStr) { weekStart = new Date(weekStartStr); }
  else { weekStart = new Date(); const day = weekStart.getDay(); const diff = day === 0 ? -6 : 1 - day; weekStart.setDate(weekStart.getDate() + diff); }
  weekStart.setHours(0, 0, 0, 0);
  const weekEnd = new Date(weekStart); weekEnd.setDate(weekEnd.getDate() + 7);

  const [timeLogs, scheduleEntries, allActiveTasks, userModel] = await Promise.all([
    prisma.timeLog.findMany({ where: { userId, startedAt: { gte: weekStart, lt: weekEnd } }, include: { task: { select: { id: true, title: true, taskType: true, status: true, importance: true, category: true, tags: true, theme: true } } }, orderBy: { startedAt: "asc" } }),
    prisma.schedule.findMany({ where: { userId, scheduledStart: { gte: weekStart, lt: weekEnd } }, include: { task: { select: { id: true, title: true, taskType: true, status: true, importance: true, category: true, tags: true, theme: true, themeColor: true, estimatedMinutes: true, source: true, deadline: true, description: true, level: true, accumulate: true } } }, orderBy: { scheduledStart: "asc" } }),
    prisma.task.findMany({ where: { userId, status: { in: ["not_started", "in_progress", "delayed"] } }, orderBy: [{ importance: "desc" }, { deadline: "asc" }], take: 20, include: { children: { select: { id: true, title: true, status: true, completedAt: true } } } }),
    prisma.userModel.findUnique({ where: { userId }, select: { peakHours: true } }),
  ]);
  const executionRecords = timeLogs.filter(log => log.endedAt && log.durationSeconds > 0).map(log => ({ taskId: log.taskId, taskTitle: log.task.title, taskType: log.task.taskType, status: log.task.status, importance: log.task.importance, category: log.task.category || null, startedAt: log.startedAt.toISOString(), endedAt: log.endedAt!.toISOString(), durationSeconds: log.durationSeconds }));

  // 统一去重（修复 P1-1：与 plan/service 共用同一规则，同任务同自然日取最新）
  const deduped = deduplicateByDay(scheduleEntries);

  const scheduledTasks = deduped.map(entry => ({ id: entry.task.id, scheduleId: entry.id, title: entry.task.title, taskType: entry.task.taskType, status: entry.task.status, importance: entry.task.importance, category: effCategory(entry.task), tags: entry.task.tags ?? null, theme: entry.task.theme ?? null, themeColor: themeColorWithCustom(entry.task.theme, entry.task.themeColor), estimatedMinutes: entry.task.estimatedMinutes ?? null, source: entry.task.source ?? "user", deadline: entry.task.deadline?.toISOString() ?? null, description: entry.task.description ?? null, level: entry.task.level ?? "task", accumulate: entry.task.accumulate ?? false, startTime: entry.scheduledStart.toISOString(), endTime: entry.scheduledEnd?.toISOString() ?? null }));

  // 收集箱 = ★（执行清单）任务的待安排池
  // · 仅放行标记 ★ 的任务（用户主动设为执行清单 = 可安排锚点），无论层级/parentId
  // · 有排期的 ★ 任务在时间轴显示，不重复进收集箱
  // · 修复：原逻辑未 ★ 的顶层 task 也进收集箱（项目A未设 ★ 的任务误现）；★ 的 phase+children 反被 level 条件挡掉（条件取反方向错误）
  const plannedTasks = allActiveTasks.filter(t =>
    t.star && !deduped.some(e => e.taskId === t.id)
  ).map(t => ({ id: t.id, title: t.title, taskType: t.taskType, status: t.status, importance: t.importance, category: effCategory(t), theme: t.theme ?? null, deadline: t.deadline?.toISOString() ?? null, estimatedMinutes: t.estimatedMinutes ?? null, source: t.source ?? "user", children: t.children.map(c => ({ id: c.id, title: c.title, status: c.status, completedAt: c.completedAt?.toISOString() ?? null })) }));
  const activeTasks = allActiveTasks.map(t => ({ id: t.id, title: t.title, taskType: t.taskType, status: t.status, importance: t.importance, category: effCategory(t), theme: t.theme ?? null, deadline: t.deadline?.toISOString() ?? null, estimatedMinutes: t.estimatedMinutes ?? null, tags: t.tags ?? null, source: t.source ?? "user", children: t.children.map(c => ({ id: c.id, title: c.title, status: c.status, completedAt: c.completedAt?.toISOString() ?? null })) }));

  // V3 C6：本周出现的主题图例（去重，含配色）
  const themeCount = new Map<string, number>();
  for (const s of scheduledTasks) if (s.theme) themeCount.set(s.theme, (themeCount.get(s.theme) || 0) + 1);
  for (const p of plannedTasks) if (p.theme) themeCount.set(p.theme, (themeCount.get(p.theme) || 0) + 1);
  const themes = [...themeCount.entries()].map(([name, count]) => ({ name, count, ...(themeColor(name) ?? { color: "#6B7280", deep: "#4B5563", bg: "#F3F4F6" }) }));

  // 高效时段（UserModel 行为数据 → Plan 头部展示）
  let peakHours: string[] = [];
  if (userModel?.peakHours) { try { const parsed = JSON.parse(userModel.peakHours); if (Array.isArray(parsed)) peakHours = parsed.map(String); } catch {} }

  return NextResponse.json({ executionRecords, scheduledTasks, plannedTasks, allActiveTasks: activeTasks, peakHours, themes });
}
