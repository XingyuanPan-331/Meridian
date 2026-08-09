import { NextRequest, NextResponse } from "next/server";
import { getServerSession, unauthorized, badRequest } from "@/lib/api-utils";
import { prisma } from "@/lib/prisma";
import { recordAcceptFeedback } from "@/lib/ai/feedback";
import { getTaskExecutionStats } from "@/lib/task/execution";
import { moveSchedule, deleteFutureSchedules, addSchedule } from "@/lib/schedule/service";
import { resolveAnchorTask } from "@/lib/task/anchor";
import { refreshTodaySummary } from "@/lib/ai/daily-summary";
import { localDateStr } from "@/lib/date";

// V5 D2：完成联动 —— 兄弟全完成 → 父自动完成（递归向上；cancelled 不阻塞；上限 5 级）
async function autoCompleteParents(userId: string, childTaskId: string) {
  let current = childTaskId;
  let guard = 0;
  while (current && guard < 5) {
    const node = await prisma.task.findUnique({ where: { id: current }, select: { parentId: true } });
    if (!node?.parentId) break;
    const pid = node.parentId;
    const siblings = await prisma.task.findMany({
      where: { userId, parentId: pid, status: { not: "cancelled" } },
      select: { status: true },
    });
    if (siblings.length === 0) break;
    if (!siblings.every(s => s.status === "completed")) break;
    await prisma.task.update({
      where: { id: pid },
      data: { status: "completed", completedAt: new Date(), snoozeUntil: null },
    });
    current = pid;
    guard++;
  }
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession();
  if (!session) return unauthorized();
  const { id } = await params;
  const existing = await prisma.task.findFirst({ where: { id, userId: session.user.id } });
  if (!existing) return NextResponse.json({ error: "任务不存在" }, { status: 404 });

  let action: string, snoozeUntil: string | undefined, postponeDays: number | undefined, rescheduleDate: string | undefined, reason: string | undefined, newStart: string | undefined, newEnd: string | undefined, durationMinutes: number | undefined;
  try { const body = await req.json(); action = body.action; snoozeUntil = body.snoozeUntil; postponeDays = body.postponeDays; rescheduleDate = body.rescheduleDate; reason = body.reason; newStart = body.newStart; newEnd = body.newEnd; durationMinutes = body.durationMinutes; } catch { return badRequest("请求格式错误"); }

  const data: Record<string, unknown> = {};
  switch (action) {
    case "start":
      // 修复 P0-3：completed/cancelled 不可复活；复活必须清 completedAt/snoozeUntil
      if (existing.status === "completed" || existing.status === "cancelled") {
        return badRequest("已完成/已取消的任务不可重新开始");
      }
      // 锚点下沉：出发容器（项目/大阶段）→ 落到第一个 task 锚点子级（Today 按用户设置的任务层级执行）
      const anchorId = await resolveAnchorTask(session.user.id, id);
      // 互斥：同一时刻只允许一个 in_progress（事务内把其他进行中任务置回）
      // FCV2 C5：出发——departureAt 为空则写当前时间（出发时刻；补记时长默认值来源 + 忘记确认兜底）
      // BUG-20260807-025：并发竞态修复——start 事务与并发 complete 竞争时（Neon 高延迟下 start 事务后提交），
      //   无条件 update 会把刚 complete 的同一任务覆盖回 in_progress（E2E T2 首跑复现：complete 200 已 completed，
      //   但 start 事务 3.5s 后提交将其覆盖）。→ 条件更新：任务已终态（completed/cancelled）时跳过覆盖。
      const startAffected = await prisma.$transaction(async (tx) => {
        await tx.task.updateMany({ where: { userId: session.user.id, status: "in_progress" }, data: { status: "not_started" } });
        return tx.task.updateMany({
          where: { id: anchorId, status: { notIn: ["completed", "cancelled"] } },
          data: {
            status: "in_progress", completedAt: null, snoozeUntil: null,
            ...(existing.departureAt ? {} : { departureAt: new Date() }),
          },
        }).then((r) => r.count);
      });
      // 任务已被并发操作（complete/cancel）置为终态 → 不覆盖，前端 load() 后自然展示终态
      if (startAffected === 0) return NextResponse.json({ started: false, reason: "already_finished" });
      // 如果任务的排期是 AI 生成的，记录"采纳"反馈（学习闭环）
      const aiSch = await prisma.schedule.findFirst({ where: { taskId: anchorId, source: "ai" }, orderBy: { createdAt: "desc" } });
      if (aiSch) recordAcceptFeedback(session.user.id, anchorId, aiSch.scheduledStart.toISOString(), aiSch.scheduledEnd?.toISOString() || aiSch.scheduledStart.toISOString()).catch(() => {});
      return NextResponse.json({ started: true });
    case "pause":
      if (existing.status === "completed" || existing.status === "cancelled") return badRequest("已完成/已取消的任务不可暂停");
      data.status = "not_started"; data.snoozeUntil = null;
      if (reason) { await prisma.taskExecutionFeedback.create({ data: { userId: session.user.id, taskId: id, reason } }).catch(() => {}); }
      // Phase 3: write UserObservation
      prisma.userObservation.create({
        data: { userId: session.user.id, type: "pause", taskId: id, category: existing.category, detail: JSON.stringify({ reason: reason || "unknown" }) },
      }).catch(() => {});
      break;
    case "complete":
      if (existing.status === "cancelled") return badRequest("已取消的任务不可完成");
      // 修复 P1-10：离开 snoozed 统一清 snoozeUntil
      data.status = "completed"; data.completedAt = new Date(); data.snoozeUntil = null;
      // 修复 P1-16：完成写观察（学习闭环数据源）
      prisma.userObservation.create({
        data: { userId: session.user.id, type: "task_complete", taskId: id, category: existing.category, detail: JSON.stringify({ actualMinutes: existing.actualMinutes, estimatedMinutes: existing.estimatedMinutes }) },
      }).catch(() => {});
      break;
    case "cancel":
      if (existing.status === "completed") return badRequest("已完成的任务不可取消");
      data.status = "cancelled"; data.snoozeUntil = null; // 修复 P1-10
      break;
    case "reopen": data.status = "not_started"; data.completedAt = null; data.snoozeUntil = null; break;
    case "snooze": {
      if (!snoozeUntil) return badRequest("请设置暂缓日期");
      const snoozeDate = new Date(snoozeUntil);
      if (isNaN(snoozeDate.getTime())) return badRequest("暂缓日期格式错误");
      data.status = "snoozed"; data.snoozeUntil = snoozeDate;
      break;
    }
    case "delay":
      if (existing.status === "completed" || existing.status === "cancelled") return badRequest("已完成/已取消的任务不可延期");
      data.status = "delayed"; data.snoozeUntil = null; // 修复 P1-10
      break;
    case "postpone": {
      // 修复 P0-2：类型 + 边界校验（防 NaN / 超大偏移）
      if (typeof postponeDays !== "number" || !Number.isInteger(postponeDays) || postponeDays < 1 || postponeDays > 365) {
        return badRequest("延期天数需为 1-365 的整数");
      }
      // 核心规则：Schedule 是唯一时间数据源 —— 延期必须同步后移排期
      const daysMs = postponeDays * 86400000;
      await prisma.$transaction(async (tx) => {
        // 1. 未来排期整体后移（含 scheduledEnd=null 的全天事件）
        const future = await tx.schedule.findMany({
          where: { taskId: id, userId: session.user.id, OR: [{ scheduledEnd: { gt: new Date() } }, { scheduledEnd: null }] },
        });
        for (const s of future) {
          await tx.schedule.update({
            where: { id: s.id },
            data: {
              scheduledStart: new Date(s.scheduledStart.getTime() + daysMs),
              scheduledEnd: s.scheduledEnd ? new Date(s.scheduledEnd.getTime() + daysMs) : null,
            },
          });
        }
        // 2. deadline 后移 + 腐化计数
        await tx.task.update({
          where: { id },
          data: {
            ...(existing.deadline ? { deadline: new Date(existing.deadline.getTime() + daysMs) } : {}),
            postponedCount: { increment: 1 },
            ...(existing.status === "snoozed" ? { status: "not_started", snoozeUntil: null } : {}),
          },
        });
      });
      return NextResponse.json({ postponed: true });
    }
    case "adjust_time": {
      if (!newStart) return badRequest("请提供新时间");
      const adjStart = new Date(newStart);
      const adjEnd = newEnd ? new Date(newEnd) : new Date(adjStart.getTime() + 3600000);
      if (isNaN(adjStart.getTime()) || isNaN(adjEnd.getTime())) return badRequest("时间格式错误");
      if (adjEnd <= adjStart) return badRequest("结束时间必须晚于开始时间");
      await moveSchedule(session.user.id, id, adjStart, adjEnd);
      await prisma.taskExecutionFeedback.create({ data: { userId: session.user.id, taskId: id, reason: reason || "user_adjust" } }).catch(() => {});
      return NextResponse.json({ adjusted: true });
    }
    case "skip_item": {
      // Bug3 修复：跳过 = 把当前执行清单项顺延到末尾（仅调整执行顺序）
      // 不删除任务、不动排期、不触发项目完成联动（原 reschedule 会 deleteFutureSchedules + 误伤项目状态）
      const children = await prisma.task.findMany({
        where: { userId: session.user.id, parentId: id, status: { notIn: ["completed", "cancelled"] } },
        orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
        select: { id: true, sortOrder: true },
      });
      const next = children[0];
      if (next && children.length > 1) {
        const maxOrder = Math.max(...children.map(c => c.sortOrder ?? 0));
        await prisma.task.update({ where: { id: next.id }, data: { sortOrder: maxOrder + 1 } });
      }
      prisma.userObservation.create({
        data: { userId: session.user.id, type: "skip", taskId: id, category: existing.category, detail: JSON.stringify({ reason: reason || "user_skip_item" }) },
      }).catch(() => {});
      return NextResponse.json({ skipped: true });
    }
    case "reschedule":
      await deleteFutureSchedules(session.user.id, id);
      await prisma.taskExecutionFeedback.create({ data: { userId: session.user.id, taskId: id, reason: reason || "user_reschedule" } }).catch(() => {});
      // Phase 3: write skip observation
      prisma.userObservation.create({
        data: { userId: session.user.id, type: "skip", taskId: id, category: existing.category, detail: JSON.stringify({ reason: reason || "user_skip" }) },
      }).catch(() => {});
      return NextResponse.json({ rescheduled: true });
    case "continue_tomorrow": {
      // V5 D4：明天继续 —— 复制最近一次排期的时段到明天（保留时长）
      const last = await prisma.schedule.findFirst({ where: { taskId: id, userId: session.user.id }, orderBy: { scheduledStart: "desc" } });
      const dur = last?.scheduledEnd && last.scheduledEnd > last.scheduledStart
        ? Math.round((last.scheduledEnd.getTime() - last.scheduledStart.getTime()) / 60000)
        : (existing.estimatedMinutes || 60);
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      const baseHour = last ? last.scheduledStart.getHours() : 20;
      const start = new Date(tomorrow);
      start.setHours(baseHour, 0, 0, 0);
      const end = new Date(start.getTime() + Math.max(10, dur) * 60000);
      await addSchedule(session.user.id, id, start, end, "user");
      prisma.userObservation.create({
        data: { userId: session.user.id, type: "continue_tomorrow", taskId: id, category: existing.category, detail: JSON.stringify({ from: last?.scheduledStart.toISOString() || null, to: start.toISOString() }) },
      }).catch(() => {});
      return NextResponse.json({ continued: true, nextStart: start.toISOString() });
    }
    case "delete":
      // 放开已完成任务的删除（用户最终控制权红线；事务内级联删子任务）
      // 原实现拒绝 completed → 用户误触完成后无法删除，被困在已完成状态
      await prisma.$transaction(async (tx) => {
        await tx.task.deleteMany({ where: { parentId: id } });
        await tx.task.delete({ where: { id } });
      });
      return NextResponse.json({ success: true });
    default: return badRequest("未知操作: " + action);
  }

  // BUG-20260807-035：complete 的 actualMinutes 基于 timeLogs 聚合，补记 TimeLog 必须先于
  // getTaskExecutionStats 执行——原顺序 stats 先算（无 TimeLog → actualMinutes=0）、补记后建
  // → 补记时长永远不进 actualMinutes（档案面板"实际用时"显示 0）。
  // BUG-20260807-037：departureAt 缺失兜底——UI 快速"出发→完成"时 complete 可能先于 start 事务
  // 提交（Neon 高延迟下 start 3-5s），此时 existing.departureAt 为 null 且无 start TimeLog；
  // 若因此跳过补记 → actualMinutes 仍为 0。→ startRef 兜底为当前时刻（补记时长为用户确认值，
  // 起点精度不影响"实际用时"统计）。
  if (action === "complete" && typeof durationMinutes === "number" && durationMinutes > 0 && Number.isFinite(durationMinutes)) {
    console.error("[action] complete debug:", JSON.stringify({ id, durationMinutes, dep: existing.departureAt ? "yes" : "no" }));
    // FCV2 C5：回来确认——body 带 durationMinutes 时补记 TimeLog
    // 起点 = departureAt（出发时刻）或最近一条 start 类型日志的 startedAt；都缺失 → 当前时刻兜底
    const startRef = existing.departureAt
      ? existing.departureAt
      : (await prisma.timeLog.findFirst({ where: { taskId: id, type: "start" }, orderBy: { startedAt: "desc" }, select: { startedAt: true } }).then(l => l?.startedAt ?? null)) ?? new Date();
    await prisma.timeLog.create({
      data: {
        userId: session.user.id, taskId: id, type: "manual",
        startedAt: startRef,
        endedAt: new Date(startRef.getTime() + Math.round(durationMinutes) * 60000),
        durationSeconds: Math.round(durationMinutes) * 60,
      },
    }).catch((e) => { console.error("[action] complete 补记 TimeLog 失败:", e); });
  }

  const task = await prisma.task.update({ where: { id }, data, include: { children: true } });

  if (action === "complete") {
    const stats = await getTaskExecutionStats(id);
    await prisma.task.update({ where: { id }, data: { actualMinutes: stats.actualMinutes } });

    // Bug2 修复：完成父任务时同步完成第一个未完成子任务（执行清单当前高亮项），
    // 保证"标记完成"时执行清单与专注时间一起更新（原实现只补记时长，清单项不勾选）
    const nextChild = await prisma.task.findFirst({
      where: { userId: session.user.id, parentId: id, status: { notIn: ["completed", "cancelled"] } },
      orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
      select: { id: true },
    });
    if (nextChild) {
      await prisma.task.update({ where: { id: nextChild.id }, data: { status: "completed", completedAt: new Date() } });
    }

    // V5 D2：完成联动（兄弟全完成 → 父递归自动完成）
    await autoCompleteParents(session.user.id, id);
    if (reason) { await prisma.taskExecutionFeedback.create({ data: { userId: session.user.id, taskId: id, reason } }).catch(() => {}); }
    // BUG-20260807-027：完成后强制刷新今日摘要（否则当天 Review 统计恒 0）
    refreshTodaySummary(session.user.id).catch(() => {});
    // BUG-20260807-047：任务完成 → 失效今日决策缓存——否则 mustDo[0] 长期指向已完成任务，
    // 无排期任务（学习型）在主卡永远不可达（决策是"存在即返回"的静态快照）。
    prisma.todayDecision.deleteMany({ where: { userId: session.user.id, date: localDateStr() } }).catch(() => {});
  }

  return NextResponse.json(task);
}
