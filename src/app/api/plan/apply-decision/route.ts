import { NextRequest, NextResponse } from "next/server";
import { getServerSession, unauthorized, badRequest } from "@/lib/api-utils";
import { moveSchedule } from "@/lib/schedule/service";
import { prisma } from "@/lib/prisma";
import { createFeedback } from "@/lib/ai/feedback";

/**
 * POST /api/plan/apply-decision
 * Execute a user-confirmed decision by calling moveSchedule for each change.
 */
export async function POST(req: NextRequest) {
  const session = await getServerSession();
  if (!session) return unauthorized();

  try {
    const body = await req.json();
    const changes: { taskId: string; newStart: string; newEnd: string; scheduleId?: string }[] = body.changes;

    if (!Array.isArray(changes) || changes.length === 0) {
      return badRequest("需要提供 changes 数组");
    }

    const results: { taskId: string; success: boolean; error?: string }[] = [];

    // 修复 P1-9：预校验全部日期，非法直接 400（不让坏数据进逐条事务）
    for (const c of changes) {
      if (isNaN(new Date(c.newStart).getTime()) || isNaN(new Date(c.newEnd).getTime())) {
        return badRequest("存在非法时间格式");
      }
      if (new Date(c.newEnd) <= new Date(c.newStart)) {
        return badRequest("结束时间必须晚于开始时间");
      }
    }

    const moveResults: { oldStart: string | null }[] = [];
    for (const c of changes) {
      try {
        // 修复 P1-4：重复任务拖动时传 scheduleId → moveSchedule(targetScheduleId)，
        // 只替换目标那条排期，不再清空该任务的全部重复排期
        const r = await moveSchedule(
          session.user.id,
          c.taskId,
          new Date(c.newStart),
          new Date(c.newEnd),
          c.scheduleId
        );
        moveResults.push({ oldStart: r.oldStart });
        results.push({ taskId: c.taskId, success: true });
      } catch (e) {
        moveResults.push({ oldStart: null });
        results.push({ taskId: c.taskId, success: false, error: (e as Error).message });
      }
    }

    const allSuccess = results.every(r => r.success);
    if (!allSuccess) {
      // 修复 P1-9：部分失败时返回 422（原返回 200 业务失败，前端难区分）
      return NextResponse.json({ success: false, error: { code: "PARTIAL_FAILURE", message: "部分排期失败", results } }, { status: 422 });
    }

    // 修复 P0-4/P0-5：采纳 AI 推荐是最强正反馈，必须采集（否则 trustScore 数据源枯竭）
    if (allSuccess) {
      for (let i = 0; i < changes.length; i++) {
        const c = changes[i];
        // B10：用户手动调整排期（拖动/改时间）= 手动接管，AI 来源取消（Plan 不再显示失真 AI 徽章）
        prisma.task.updateMany({ where: { id: c.taskId, userId: session.user.id, source: "ai" }, data: { source: "user" } }).catch(() => {});
        createFeedback({
          userId: session.user.id,
          taskId: c.taskId,
          agentAction: "apply_decision",
          userResponse: "accepted",
          context: "user_adopt",
          agentSuggestion: JSON.stringify({ start: c.newStart, end: c.newEnd }),
        }).catch(() => {});
        // 采集迁移（原 plan/move 路由的 time_modification 观察，删除死路由后收口到这里）
        try {
          const newDate = new Date(c.newStart);
          const oldDate = moveResults[i]?.oldStart ? new Date(moveResults[i]!.oldStart!) : new Date();
          await prisma.userObservation.create({
            data: {
              userId: session.user.id,
              type: "time_modification",
              taskId: c.taskId,
              detail: JSON.stringify({
                fromHour: String(oldDate.getHours()),
                toHour: String(newDate.getHours()),
                fromDate: oldDate.toISOString(),
                toDate: newDate.toISOString(),
              }),
            },
          });
        } catch {}
        prisma.decisionLog.create({
          data: {
            userId: session.user.id,
            action: "user_adopt_schedule",
            targetId: c.taskId,
            actionDetail: JSON.stringify({ newStart: c.newStart, newEnd: c.newEnd }),
            reasoning: "用户采纳排期建议",
            userAccepted: true,
          },
        }).catch(() => {});
      }
    }

    return NextResponse.json({ success: allSuccess, results });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message || "执行失败" }, { status: 500 });
  }
}
