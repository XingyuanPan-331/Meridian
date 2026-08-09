import { getUserExecutionPattern } from "@/lib/task/execution-feedback";
import { NextResponse } from "next/server";
import { getServerSession, unauthorized } from "@/lib/api-utils";
import { prisma } from "@/lib/prisma";
import { localDateStr } from "@/lib/date";
import { runDailyPipelineOnce } from "@/lib/ai/pipeline-runner";
import { getOrCreateTodaySummary } from "@/lib/ai/daily-summary";
import { analyzeDailyBehavior } from "@/lib/ai/memory-learning";
import { getCurrentState } from "@/lib/ai/user-state";
import { getOrCreateTodayDecision } from "@/lib/ai/today-decision";
import { getTaskExecutionStats, getCompletionPercent, getTodayTimeline } from "@/lib/task/execution";
import { checkOvertime, checkConsecutiveDelay } from "@/lib/task/execution-monitor";
import { getExecutionAdvice } from "@/lib/ai/decision/execution-advisor";
import { getMorningBrief } from "@/lib/ai/daily-brief";
import { getStreak } from "@/lib/task/streak";
import { getAccumStats } from "@/lib/task/accum";
import { themeColor } from "@/lib/task/theme";

// ── V5 层级重构：执行清单构建（就近两级） ──
// 来源优先级：直接子级（真实执行项）> 备注拆行（备忘步骤）> 任务自身
async function buildChecklist(userId: string, taskId: string, title: string, description: string | null) {
  const children = await prisma.task.findMany({
    where: { userId, parentId: taskId },
    select: { id: true, title: true, completedAt: true },
    orderBy: { sortOrder: "asc" },
  });
  if (children.length > 0) {
    return children.map(c => ({ id: c.id, text: c.title, done: !!c.completedAt, group: null, noteStep: false, self: false }));
  }
  // 备注拆行兜底（D1：简单任务清单 = 备注按行拆；done 由前端 localStorage 维护）
  const lines = (description || "").split("\n").map(s => s.trim()).filter(Boolean);
  if (lines.length > 0) {
    return lines.map(t => ({ id: null, text: t, done: false, group: null, noteStep: true, self: false }));
  }
  // 都没有 → 任务自身一行（勾选=完成）
  return [{ id: taskId, text: title, done: false, group: null, noteStep: false, self: true }];
}

// 归属链：递归向上收集（上限 5 级），如 "4轴飞行器 / 硬件设计"
async function buildAncestorChain(userId: string, taskId: string | null): Promise<string | null> {
  const parts: string[] = [];
  let cur = taskId;
  let guard = 0;
  while (cur && guard < 5) {
    const p = await prisma.task.findUnique({ where: { id: cur }, select: { title: true, parentId: true } });
    if (!p) break;
    parts.unshift(p.title);
    cur = p.parentId;
    guard++;
  }
  return parts.length > 0 ? parts.join(" / ") : null;
}

// 当前任务卡片（V5：就近两级 + 积累卡片数据；V3：+theme/themeColor；FCV2：+purpose/+departureAt）
async function buildCurrentTaskCard(
  userId: string,
  task: { id: string; title: string; description: string | null; taskType: string; category: string | null; theme: string | null; purpose: string | null; departureAt: Date | null; parentId: string | null; level: string | null; accumulate: boolean },
  schedule: { scheduledStart: Date; scheduledEnd: Date | null } | undefined,
  extra: { elapsedMinutes: number; plannedMinutes: number; completionPercent: number }
) {
  const [children, ancestorChain, purpose] = await Promise.all([
    buildChecklist(userId, task.id, task.title, task.description),
    buildAncestorChain(userId, task.parentId),
    resolvePurposeFinal(userId, task),
  ]);
  const card: Record<string, unknown> = {
    id: task.id, title: task.title,
    description: task.description,
    taskType: task.taskType, category: task.category,
    // V3 C5：主题 + 配色（档案/Focus Card 消费）
    theme: task.theme,
    themeColor: task.theme ? themeColor(task.theme) : null,
    // FCV2 C4：动机（继承后最终值）+ 出发时刻
    purpose,
    departureAt: task.departureAt?.toISOString() || null,
    level: task.level || "task", accumulate: task.accumulate,
    // parentTitle 值升级为完整归属链（旧前端字段名兼容）
    parentTitle: ancestorChain,
    children,
    scheduledStart: schedule?.scheduledStart?.toISOString() || null,
    scheduledEnd: schedule?.scheduledEnd?.toISOString() || null,
    elapsedMinutes: extra.elapsedMinutes,
    remainingMinutes: Math.max(0, extra.plannedMinutes - extra.elapsedMinutes),
    plannedMinutes: extra.plannedMinutes, completionPercent: extra.completionPercent,
  };
  // V5 积累型：打卡卡片数据（连续天数 + 30 天点阵 + 性质/统计）
  if (task.accumulate) {
    card.streak = await getStreak(userId, task.id).catch(() => null);
    card.accumStats = await getAccumStats(userId, task.id).catch(() => null);
  }
  return card;
}

// FCV2：purpose 继承后最终值——自身为空时向上找最近非空祖先（与档案 resolvePurpose 同规则）
async function resolvePurposeFinal(
  userId: string,
  task: { purpose: string | null; parentId: string | null }
): Promise<string | null> {
  if (task.purpose) return task.purpose;
  let cur = task.parentId;
  let guard = 0;
  while (cur && guard < 8) {
    const p = await prisma.task.findUnique({ where: { id: cur }, select: { purpose: true, parentId: true } });
    if (!p) break;
    if (p.purpose) return p.purpose;
    cur = p.parentId;
    guard++;
  }
  return null;
}

// FCV2 C7：固定时间型到点自动完成（惰性结算，无 cron——打开页面时补算）
// taskType=scheduled 且未完成 且 最近排期 scheduledEnd < now → 自动标记 completed
// + 写 TimeLog（时长=计划时长，detail='auto'）+ DecisionLog（action='auto_complete'）
async function lazySettleExpiredScheduled(userId: string, now = new Date()) {
  const candidates = await prisma.task.findMany({
    where: { userId, taskType: "scheduled", status: { in: ["not_started", "in_progress", "delayed"] } },
    select: { id: true, title: true },
  });
  if (candidates.length === 0) return 0;

  let settled = 0;
  for (const task of candidates) {
    // 最近一条排期（含已结束的过去排期）
    const last = await prisma.schedule.findFirst({
      where: { taskId: task.id, userId },
      orderBy: { scheduledStart: "desc" },
    });
    if (!last?.scheduledEnd || last.scheduledEnd >= now) continue;

    // 计划时长（分钟）：排期时长优先，estimatedMinutes 兜底（下限 1）
    const schedMin = last.scheduledEnd
      ? Math.round((last.scheduledEnd.getTime() - last.scheduledStart.getTime()) / 60000)
      : 0;
    const est = await prisma.task.findUnique({ where: { id: task.id }, select: { estimatedMinutes: true } });
    const plannedMin = Math.max(1, schedMin || est?.estimatedMinutes || 60);
    const endedAt = last.scheduledEnd ?? new Date(last.scheduledStart.getTime() + plannedMin * 60000);

    await prisma.$transaction(async (tx) => {
      // 幂等：只结算仍未完成的任务
      const fresh = await tx.task.findUnique({ where: { id: task.id }, select: { status: true } });
      if (!fresh || fresh.status === "completed" || fresh.status === "cancelled") return;
      await tx.task.update({
        where: { id: task.id },
        data: { status: "completed", completedAt: now, snoozeUntil: null, actualMinutes: { increment: plannedMin } },
      });
      await tx.timeLog.create({
        data: {
          userId, taskId: task.id, type: "auto",
          startedAt: last.scheduledStart,
          endedAt,
          durationSeconds: plannedMin * 60,
          detail: "auto", // FCV2：自动完成标记
        },
      });
      await tx.decisionLog.create({
        data: {
          userId, action: "auto_complete",
          targetId: task.id,
          actionDetail: JSON.stringify({ scheduledStart: last.scheduledStart.toISOString(), scheduledEnd: endedAt.toISOString(), plannedMinutes: plannedMin }),
          reasoning: "固定时间型任务到点未确认，惰性结算自动完成",
        },
      });
    });
    settled++;
  }
  return settled;
}

export async function GET() {
  const session = await getServerSession();
  if (!session) return unauthorized();
  const userId = session.user.id;

  // FCV2 C7：惰性结算——过期 scheduled 任务自动完成（无 cron，打开页面补算；幂等）
  await lazySettleExpiredScheduled(userId).catch(() => {});

  const today = new Date(); today.setHours(0, 0, 0, 0);
  const tomorrow = new Date(today); tomorrow.setDate(tomorrow.getDate() + 1);
  const now = new Date();
  const todayStr = localDateStr(today);

  getOrCreateTodaySummary(userId).catch(() => {});
  analyzeDailyBehavior(userId).catch(() => {});

  // Phase 3: daily AI pipeline — 统一走 pipeline-runner（in-flight 锁 + lastUpdated 检查）
  // 修复：原"先写 lastUpdated 再跑"导致 pipeline 失败后当天不重跑（假成功）
  runDailyPipelineOnce(userId).catch(() => {});

  const [inProgress, decision, currentState, todayCompleted, todayTimeLogs, todaySchedules, todayTimeline] = await Promise.all([
    prisma.task.findFirst({ where: { userId, status: "in_progress" } }),
    getOrCreateTodayDecision(userId),
    getCurrentState(userId),
    prisma.task.count({ where: { userId, status: "completed", completedAt: { gte: today, lt: tomorrow } } }),
    prisma.timeLog.findMany({ where: { userId, startedAt: { gte: today, lt: tomorrow } } }),
    prisma.schedule.findMany({ where: { userId, scheduledStart: { gte: today, lt: tomorrow } }, orderBy: { scheduledStart: "asc" } }),
    getTodayTimeline(userId),
  ]);

  const todayTotalMinutes = Math.round(todayTimeLogs.reduce((sum, log) => sum + log.durationSeconds, 0) / 60);

  let currentTask: any = null;

  // Priority 1: 正在执行的任务 (Task.status = in_progress)
  if (inProgress) {
    const schedule = todaySchedules.find(s => s.taskId === inProgress.id);
    const tLogs = todayTimeLogs.filter(l => l.taskId === inProgress.id);
    const elapsedSeconds = tLogs.reduce((s, l) => s + l.durationSeconds, 0);
    const stats = await getTaskExecutionStats(inProgress.id);
    const pct = await getCompletionPercent(inProgress.id);
    currentTask = await buildCurrentTaskCard(userId, inProgress, schedule, {
      elapsedMinutes: Math.round(elapsedSeconds / 60),
      plannedMinutes: stats.plannedMinutes,
      completionPercent: pct,
    });
  }

  // Priority 2: 当前时段排期任务 (scheduledStart ≤ now ≤ scheduledEnd or no end)
  // BUG-20260807-031：必须过滤任务状态——completed/cancelled 任务只要今天有时段排期
  // 就会顶替 currentTask（E2E T10 复现：前序用例完成的 T2 任务排期 11:31-12:31 仍在窗口内，
  // 打开 Today 被选为 currentTask，显示"未出发"）。遍历窗口内排期，跳过已终态任务。
  if (!currentTask) {
    for (const cs of todaySchedules) {
      if (cs.scheduledStart > now || (cs.scheduledEnd && cs.scheduledEnd < now)) continue;
      const t = await prisma.task.findFirst({
        where: { id: cs.taskId, userId, status: { notIn: ["completed", "cancelled"] } },
        select: { id: true, title: true, description: true, taskType: true, category: true, theme: true, purpose: true, departureAt: true, parentId: true, level: true, accumulate: true },
      });
      if (t) {
        // 修复：Priority 2 的"预计"必须按排期时长算（原硬编码 0 → Focus Card 显示待排期/0 分钟）
        const plannedMin = cs.scheduledEnd && cs.scheduledEnd > cs.scheduledStart
          ? Math.round((cs.scheduledEnd.getTime() - cs.scheduledStart.getTime()) / 60000)
          : 0;
        currentTask = await buildCurrentTaskCard(userId, t, cs, {
          elapsedMinutes: 0, plannedMinutes: plannedMin, completionPercent: 0,
        });
        break;
      }
    }
  }

  // ★ DELETED: Priority 3 mustDo[0] fallback
  // No more auto-promoting future tasks to currentTask

  let nextTask: any = null;
  const nextTaskIdx = decision.recommended.length > 0 ? 0 : (decision.mustDo.length > 1 ? 1 : -1);
  if (nextTaskIdx >= 0 && currentTask) {
    const src = decision.recommended.length > 0 ? decision.recommended : decision.mustDo;
    const nt = src[decision.recommended.length > 0 ? 0 : 1];
    if (nt && nt.taskId !== currentTask.id) { const sched = todaySchedules.find(s => s.taskId === nt.taskId); nextTask = { id: nt.taskId, title: nt.title, plannedStart: sched?.scheduledStart?.toISOString() || null }; }
  }

  const alerts: any[] = [];
  if (currentTask?.id) { const ot = await checkOvertime(currentTask.id).catch(() => null); if (ot) alerts.push(ot); const dl = await checkConsecutiveDelay(userId, currentTask.id).catch(() => null); if (dl) alerts.push(dl); }

  let brief: any = null;
  try {
    const eb = await prisma.dailyBrief.findUnique({ where: { userId_date: { userId, date: todayStr } } });
    if (eb) { brief = JSON.parse(eb.content); } else { const b = await getMorningBrief(userId); await prisma.dailyBrief.create({ data: { userId, date: todayStr, content: JSON.stringify(b) } }).catch(() => {}); brief = b; }
  } catch { brief = { greeting: "早上好", topTasks: [], stateDescription: "暂无状态", suggestion: "开始今天的工作吧" }; }

  const advice = await getExecutionAdvice(userId).catch(() => null);
  const execPattern = await getUserExecutionPattern(userId).catch(() => null);

  // 修复：mustDo/recommended 补完整卡字段（Focus Card 兜底卡需要真实清单；
  // 否则 currentTask 为空时前端 children=[] → hasChildren=false → 误判"知识点"且清单消失）
  const enhanceCard = async (m: { taskId: string; title: string }) => {
    // BUG-20260808-054：三查询并行（Neon 跨洋延迟下串行 3 次 = 每卡 +600ms）
    const [task, children, purpose] = await Promise.all([
      prisma.task.findUnique({
        where: { id: m.taskId },
        select: { id: true, title: true, description: true, taskType: true, category: true, theme: true, purpose: true, departureAt: true, parentId: true, level: true, accumulate: true, status: true },
      }),
      // BUG-20260807-049：mustDo 兜底卡的 children 只取【真实子任务】——原实现用 buildChecklist
      // （含 description 按行拆分的兜底清单），无子任务的"学习型"任务（如背单词）description 单行
      // 被拆成 1 个清单项 → 前端 hasChildren=true → 误判为清单型卡。真实无子任务 → learning 卡。
      prisma.task.findMany({
        where: { userId, parentId: m.taskId },
        select: { id: true, title: true, completedAt: true },
        orderBy: { sortOrder: "asc" },
      }).then((list) => list.map((c) => ({ id: c.id, text: c.title, done: !!c.completedAt, group: null, noteStep: false, self: false }))),
      resolvePurposeFinal(userId, { purpose: null, parentId: m.taskId }).catch(() => null),
    ]);
    if (!task) return m;
    const sched = todaySchedules.find((s) => s.taskId === m.taskId);
    return {
      ...m,
      children,
      description: task.description,
      taskType: task.taskType,
      category: task.category,
      status: task.status,
      accumulate: task.accumulate,
      departureAt: task.departureAt?.toISOString() || null,
      purpose: purpose ?? task.purpose,
      scheduledStart: sched?.scheduledStart?.toISOString() || null,
      scheduledEnd: sched?.scheduledEnd?.toISOString() || null,
    };
  };
  const [mustDoCards, recommendedCards] = await Promise.all([
    Promise.all(decision.mustDo.map(enhanceCard)),
    Promise.all(decision.recommended.map(enhanceCard)),
  ]);

  return NextResponse.json({
    executionPattern: execPattern, executionAdvice: advice,
    currentTask, nextTask, todayTimeline,
    mustDo: mustDoCards, recommended: recommendedCards,
    alerts, brief,
    currentState: { energy: currentState.energy, focus: currentState.focusLevel, mood: currentState.mood, stress: currentState.stress, stateDescription: currentState.stateDescription },
    todayStats: { completedCount: todayCompleted, totalMinutes: todayTotalMinutes },
    later: decision.later, remainingCount: 0, timeBlocks: [], overdueTasks: [],
  });
}
