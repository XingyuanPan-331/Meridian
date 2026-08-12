// Plan Service — unified plan business logic
// All plan queries must go through this service

import { prisma } from "@/lib/prisma";
import { localDateStr } from "@/lib/date";
import { moveSchedule } from "@/lib/schedule/service";
import type { PlanItem, DailyPlan, WeeklyPlan } from "./types";
import type { Prisma } from "@prisma/client";

/** Prisma schedule 查询结果的形状（含 task） */
type ScheduleWithTask = Prisma.ScheduleGetPayload<{
  include: { task: { select: { id: true; title: true; taskType: true; status: true; importance: true } } };
}>;

/** Get weekly plan with consistency check */
export async function getWeeklyPlan(userId: string, weekStart: Date): Promise<WeeklyPlan> {
  const start = new Date(weekStart); start.setHours(0, 0, 0, 0);
  const end = new Date(start); end.setDate(end.getDate() + 7);

  const entries = await prisma.schedule.findMany({
    where: { userId, scheduledStart: { gte: start, lt: end } },
    include: { task: { select: { id: true, title: true, taskType: true, status: true, importance: true } } },
    orderBy: { scheduledStart: "asc" },
  });

  const items = deduplicate(entries).map(toPlanItem);
  return { weekStart: start.toISOString(), weekEnd: end.toISOString(), items };
}

/** Get daily plan */
export async function getDailyPlan(userId: string, date: Date): Promise<DailyPlan> {
  const dayStart = new Date(date); dayStart.setHours(0, 0, 0, 0);
  const dayEnd = new Date(dayStart); dayEnd.setDate(dayEnd.getDate() + 1);

  const entries = await prisma.schedule.findMany({
    where: { userId, scheduledStart: { gte: dayStart, lt: dayEnd } },
    include: { task: { select: { id: true, title: true, taskType: true, status: true, importance: true } } },
    orderBy: { scheduledStart: "asc" },
  });

  const items = deduplicate(entries).map(toPlanItem);
  return { date: localDateStr(dayStart), items };
}

/**
 * Delete a plan item by taskId — removes ALL schedules (task + descendants), keeps the Task.
 * The task will reappear in UnscheduledPool on next Plan load.
 * 修复：原实现只删"最新一条"排期 —— 锚点下沉/历史重复排期挂在子任务上时残留，
 * 导致"移除后任务仍显示已安排、不回收集箱/待整理"（问题3 根因）。
 * 现改为：收集任务及其全部子孙（递归）的排期一并删除。
 */
export async function deletePlanItem(userId: string, taskId: string) {
  // 收集该任务 + 所有子孙 id（锚点下沉可能把排期落在子任务上）
  const ids = [taskId];
  const stack = [taskId];
  let guard = 0;
  while (stack.length > 0 && guard < 50) {
    const cur = stack.pop()!;
    const children = await prisma.task.findMany({ where: { userId, parentId: cur }, select: { id: true } });
    for (const c of children) { ids.push(c.id); stack.push(c.id); }
    guard++;
  }

  const result = await prisma.schedule.deleteMany({ where: { taskId: { in: ids }, userId } });
  return { deleted: result.count, taskId };
}

/**
 * 统一去重规则：同任务 + 同自然日 → 保留最新一条排期（修复 P1-1：三处实现不一致）
 * week-calendar / task-execution-state 复用本函数，保证周历、日计划、执行状态显示一致
 */
export function deduplicateByDay<T extends { taskId: string; scheduledStart: Date; scheduledEnd?: Date | null }>(entries: T[]): T[] {
  // 2026-08-13 修复：添加时段（二次排期）被误去重——同任务同天多条排期（有意多段执行）只留最晚，
  // 旧块消失（用户 P2 添加 (2) 后原块被'移动'）。改为仅完全重复（同任务+同天+同起止时刻）才去重；
  // 同天不同时段全部保留（多段执行语义），重复由后端 moveSchedule（替换/清重复）保证。
  const seen = new Map<string, number>();
  const result: T[] = [];
  for (const e of entries) {
    const key = localDateStr(e.scheduledStart) + "_" + e.taskId + "_" + e.scheduledStart.getTime() + "_" + (e.scheduledEnd?.getTime() ?? 0);
    const idx = seen.get(key);
    if (idx !== undefined) { if (e.scheduledStart > result[idx].scheduledStart) result[idx] = e; }
    else { seen.set(key, result.length); result.push(e); }
  }
  if (result.length !== entries.length) {
    console.warn("[plan] deduped " + (entries.length - result.length) + " duplicate schedules");
  }
  return result;
}

/** 兼容：plan/service 内部用（类型化版本） */
function deduplicate(entries: ScheduleWithTask[]): ScheduleWithTask[] {
  return deduplicateByDay(entries);
}

function toPlanItem(entry: ScheduleWithTask): PlanItem {
  return {
    taskId: entry.task.id,
    title: entry.task.title,
    schedule: { id: entry.id, start: entry.scheduledStart.toISOString(), end: entry.scheduledEnd?.toISOString() || null, source: entry.source },
    status: entry.task.status,
    importance: entry.task.importance,
    taskType: entry.task.taskType,
  };
}
