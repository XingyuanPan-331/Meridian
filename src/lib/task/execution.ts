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
  /** 2026-08-09：任务状态（今日路线保留已完成任务展示，前端据此显示"已完成"而非"进行中"） */
  status: string;
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
  // 2026-08-12 日界对齐 plan：凌晨 2:00 = 新的一天开始（深夜 22-2 归前一天、凌晨 2-8 归当天）。
  // 今日路线 = 排期覆盖 [今天 2:00, 明天 2:00) 的任务——跨夜任务（如 8/11 21:20 → 8/12 02:40）
  // 的凌晨部分归今天，今日路线应显示（原按 scheduledStart 0:00 起算被排除）
  const dayStart = new Date(); dayStart.setHours(2, 0, 0, 0);
  const dayEnd = new Date(dayStart); dayEnd.setDate(dayEnd.getDate() + 1);

  // 2026-08-09：今日路线保留已完成任务（排期是既定事实，完成的任务也应展示）；
  // 任务状态随 timeline 返回，前端据此显示"已完成"而非"进行中"（不再用过滤掩盖）。
  const schedules = await prisma.schedule.findMany({
    where: {
      userId,
      scheduledStart: { lt: dayEnd },
      OR: [{ scheduledEnd: { gt: dayStart } }, { scheduledEnd: null }],
    },
    orderBy: { scheduledStart: "asc" },
    include: { task: { select: { title: true, status: true } } },
  });

  return schedules.filter((s) => s.task).map(s => ({
    taskId: s.taskId,
    title: s.task.title,
    start: s.scheduledStart.toISOString(),
    end: s.scheduledEnd?.toISOString() || null,
    duration: s.scheduledStart && s.scheduledEnd
      ? `${Math.max(0, Math.round((s.scheduledEnd.getTime() - s.scheduledStart.getTime()) / 60000))}分钟`
      : "—",
    isCurrent: s.scheduledStart <= now && (!s.scheduledEnd || s.scheduledEnd >= now),
    status: s.task.status,
  }));
}
