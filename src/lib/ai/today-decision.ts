import { prisma } from "@/lib/prisma";
import { getCurrentState } from "./user-state";
import { createDecisionLog } from "./decision-log";
import { localDateStr } from "@/lib/date";

export interface TodayDecisionResult {
  mustDo: { taskId: string; title: string; importance: number; deadline: string | null; estimatedMinutes: number | null; reasons: string[]; status: string }[];
  recommended: { taskId: string; title: string; importance: number; deadline: string | null; estimatedMinutes: number | null; reasons: string[]; status: string }[];
  later: string[];
}

export async function generateTodayDecision(userId: string): Promise<TodayDecisionResult> {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const tomorrow = new Date(today); tomorrow.setDate(tomorrow.getDate() + 1);
  const dayAfter = new Date(today); dayAfter.setDate(dayAfter.getDate() + 2);

  const [allTasks, schedules, userState] = await Promise.all([
    prisma.task.findMany({
      // BUG-20260808-054：mustDo 候选只考虑【顶层任务】（parentId=null）——
      // ① 子任务（清单项）由父任务承载执行，永不直接进 mustDo；
      // ② 孤儿子任务（父已删）自然排除；③ inbox 类型（未确认想法）排除。
      where: {
        userId,
        status: { in: ["not_started", "in_progress", "delayed"] },
        taskType: { not: "inbox" },
        parentId: null,
      },
      orderBy: [{ importance: "desc" }, { deadline: "asc" }],
    }),
    prisma.schedule.findMany({
      where: { userId, scheduledStart: { gte: today, lt: dayAfter } },
      include: { task: { select: { title: true } } },
    }),
    getCurrentState(userId),
  ]);

  const todayScheduledIds = new Set(schedules.map(s => s.taskId));

  const scored: any[] = [];

  for (const task of allTasks) {
    const reasons: string[] = [];
    let score = 0;

    if (todayScheduledIds.has(task.id)) { score += 30; reasons.push("Scheduled today"); }

    if (task.deadline) {
      const dl = new Date(task.deadline);
      if (dl.getTime() <= tomorrow.getTime()) { score += 25; reasons.push("Deadline urgent"); }
      else if (dl.getTime() <= dayAfter.getTime()) { score += 15; reasons.push("Deadline soon"); }
    }

    if (task.status === "delayed") { score += 20; reasons.push("Delayed"); }
    if (task.status === "in_progress") { score += 25; reasons.push("In progress"); }

    score += task.importance * 2;

    if (userState.stress === "high" && task.importance >= 4) {
      score += 5; reasons.push("High stress: prioritize important");
    }
    // V3 D12：cognitiveLoad 已删，高认知负荷判定改用保留的 complexity
    if (userState.energy === "low" && task.complexity === "high") {
      score -= 10; reasons.push("Low energy: reduce high-load tasks");
    }

    if (score > 0) {
      scored.push({ taskId: task.id, title: task.title, importance: task.importance, deadline: task.deadline, estimatedMinutes: task.estimatedMinutes, score, reasons });
    }
  }

  scored.sort((a, b) => b.score - a.score);

  // BUG-20260807-047：mustDo/recommended 项带 status（前端兜底需跳过已完成）
  const mustDo = scored.slice(0, 3).map(t => ({ taskId: t.taskId, title: t.title, importance: t.importance, deadline: t.deadline ? t.deadline.toISOString() : null, estimatedMinutes: t.estimatedMinutes, reasons: t.reasons, status: t.status }));
  const recommended = scored.slice(3, 5).map(t => ({ taskId: t.taskId, title: t.title, importance: t.importance, deadline: t.deadline ? t.deadline.toISOString() : null, estimatedMinutes: t.estimatedMinutes, reasons: t.reasons, status: t.status }));
  const later = scored.slice(5).map(t => t.title);

  for (const t of mustDo) {
    createDecisionLog({ userId, action: "today_selection", targetId: t.taskId, reasoning: JSON.stringify(t.reasons), actionDetail: "mustDo" }).catch(() => {});
  }

  return { mustDo, recommended, later };
}

export async function getOrCreateTodayDecision(userId: string) {
  const today = localDateStr();
  const existing = await prisma.todayDecision.findUnique({ where: { userId_date: { userId, date: today } } });
  if (existing) {
    return {
      mustDo: JSON.parse(existing.mustDo),
      recommended: JSON.parse(existing.recommended),
      later: JSON.parse(existing.reason),
    } as TodayDecisionResult;
  }
  const result = await generateTodayDecision(userId);
  await prisma.todayDecision.upsert({
    where: { userId_date: { userId, date: today } },
    create: { userId, date: today, mustDo: JSON.stringify(result.mustDo), recommended: JSON.stringify(result.recommended), reason: JSON.stringify(result.later) },
    update: { mustDo: JSON.stringify(result.mustDo), recommended: JSON.stringify(result.recommended), reason: JSON.stringify(result.later) },
  });
  return result;
}

export async function refreshTodayDecision(userId: string) {
  const today = localDateStr();
  const result = await generateTodayDecision(userId);
  await prisma.todayDecision.upsert({
    where: { userId_date: { userId, date: today } },
    create: { userId, date: today, mustDo: JSON.stringify(result.mustDo), recommended: JSON.stringify(result.recommended), reason: JSON.stringify(result.later) },
    update: { mustDo: JSON.stringify(result.mustDo), recommended: JSON.stringify(result.recommended), reason: JSON.stringify(result.later) },
  });
  return result;
}

/** 纯代码主动建议，不调LLM */
export async function generateProactiveSuggestion(userId: string): Promise<{ title: string; reasons: string[]; estimatedMinutes: number } | null> {
  const inProgress = await prisma.task.findFirst({ where: { userId, status: "in_progress" } });
  if (inProgress) return null;
  const decision = await getOrCreateTodayDecision(userId);
  if (decision.mustDo.length === 0) return null;
  const first = decision.mustDo[0];
  const now = new Date();
  const scheds = await prisma.schedule.findMany({ where: { userId, taskId: first.taskId, scheduledStart: { lte: new Date(now.getTime() + 30 * 60000) } }, orderBy: { scheduledStart: "desc" }, take: 1 });
  if (scheds.length === 0) return null;
  const reasons = first.reasons.length > 0 ? first.reasons : ["优先级较高"];
  return { title: "现在应该开始" + first.title, reasons: reasons.slice(0, 3), estimatedMinutes: first.estimatedMinutes || 60 };
}