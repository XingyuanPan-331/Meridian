import { prisma } from "@/lib/prisma";

export interface ExecutionStats {
  plannedMinutes: number;
  actualMinutes: number;
  difference: number;
  completionRate: number;
}

export interface TimelineItem {
  taskId: string;
  title: string;
  start: string;
  end: string | null;
  duration: string;
  isCurrent: boolean;
}

/** Get planned minutes from the latest Schedule only (defensive: single, not sum) */
export async function getPlannedMinutes(taskId: string, userId?: string): Promise<number> {
  const schedule = await prisma.schedule.findFirst({
    where: { taskId, ...(userId ? { userId } : {}) },
    orderBy: { createdAt: "desc" },
  });
  if (schedule?.scheduledStart && schedule?.scheduledEnd) {
    return Math.round((schedule.scheduledEnd.getTime() - schedule.scheduledStart.getTime()) / 60000);
  }
  const task = await prisma.task.findUnique({ where: { id: taskId }, select: { estimatedMinutes: true } });
  return task?.estimatedMinutes || 0;
}

/** Get actual time from TimeLog records */
export async function getActualMinutes(taskId: string): Promise<number> {
  const logs = await prisma.timeLog.findMany({ where: { taskId } });
  return Math.round(logs.reduce((sum, l) => sum + l.durationSeconds, 0) / 60);
}

/** Full execution stats */
export async function getTaskExecutionStats(taskId: string): Promise<ExecutionStats> {
  const [planned, actual] = await Promise.all([getPlannedMinutes(taskId), getActualMinutes(taskId)]);
  return {
    plannedMinutes: planned,
    actualMinutes: actual,
    difference: actual - planned,
    completionRate: planned > 0 ? Math.round((actual / planned) * 100) : 0,
  };
}

/** 完成进度百分比 */
export async function getCompletionPercent(taskId: string): Promise<number> {
  const [planned, actual] = await Promise.all([getPlannedMinutes(taskId), getActualMinutes(taskId)]);
  if (planned === 0) return 0;
  return Math.min(100, Math.round((actual / planned) * 100));
}

/** 生成今日时间轴 */
export async function getTodayTimeline(userId: string): Promise<TimelineItem[]> {
  const now = new Date();
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const tomorrow = new Date(today); tomorrow.setDate(tomorrow.getDate() + 1);

  const schedules = await prisma.schedule.findMany({
    where: { userId, scheduledStart: { gte: today, lt: tomorrow } },
    orderBy: { scheduledStart: "asc" },
    include: { task: { select: { title: true } } },
  });

  return schedules.map(s => ({
    taskId: s.taskId,
    title: s.task.title,
    start: s.scheduledStart.toISOString(),
    end: s.scheduledEnd?.toISOString() || null,
    duration: s.scheduledStart && s.scheduledEnd
      ? `${Math.max(0, Math.round((s.scheduledEnd.getTime() - s.scheduledStart.getTime()) / 60000))}分钟`
      : "—",
    isCurrent: s.scheduledStart <= now && (!s.scheduledEnd || s.scheduledEnd >= now),
  }));
}
