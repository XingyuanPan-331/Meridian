import { NextRequest, NextResponse } from "next/server";
import { getServerSession, unauthorized, badRequest } from "@/lib/api-utils";
import { prisma } from "@/lib/prisma";
import { getAccumStats } from "@/lib/task/accum";
import { createFeedback } from "@/lib/ai/feedback";
import { normalizeThemeColorInput } from "@/lib/task/theme";
import { normalizeEstimateUnit } from "@/lib/task/estimate";

// V3 C7：归属链递归收集（上限 5 级，返回标题数组）
async function buildAncestors(userId: string, taskId: string | null): Promise<string[]> {
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
  return parts;
}

// Focus Card V2：purpose 继承后最终值——自身为空时向上找最近非空祖先的 purpose
async function resolvePurpose(userId: string, task: { purpose: string | null; parentId: string | null }): Promise<string | null> {
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

// GET /api/tasks/[id] — V3 档案面板聚合：+theme/+ancestors/+schedules/+accumStats/+aiFields(只读)；FCV2：+purpose(继承后值)/+departureAt
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession();
  if (!session) return unauthorized();
  const { id } = await params;
  const task = await prisma.task.findFirst({
    where: { id, userId: session.user.id },
    include: { children: { orderBy: { sortOrder: "asc" } }, timeLogs: { orderBy: { createdAt: "desc" } } },
  });
  if (!task) return NextResponse.json({ error: "任务不存在" }, { status: 404 });

  // V3 C7：聚合附加数据（并行）+ FCV2：purpose 继承值
  const [ancestors, schedules, accumStats, purpose] = await Promise.all([
    buildAncestors(session.user.id, task.parentId),
    prisma.schedule.findMany({ where: { taskId: id, userId: session.user.id }, orderBy: { scheduledStart: "asc" } }),
    task.accumulate ? getAccumStats(session.user.id, id).catch(() => null) : null,
    resolvePurpose(session.user.id, task),
  ]);

  // 只读 AI 增强字段（V3 §4.5 红线：仅档案可见）
  const aiFields = {
    complexity: task.complexity ?? null,
    riskLevel: task.riskLevel ?? null,
    dependencies: task.dependencies ?? null,
    scheduleAdvice: task.scheduleAdvice ?? null,
  };

  return NextResponse.json({
    ...task,
    theme: task.theme ?? null,
    purpose,
    departureAt: task.departureAt?.toISOString() ?? null,
    ancestors,
    schedules: schedules.map(s => ({ id: s.id, scheduledStart: s.scheduledStart.toISOString(), scheduledEnd: s.scheduledEnd?.toISOString() ?? null, source: s.source })),
    accumStats,
    aiFields,
  });
}

// PUT /api/tasks/[id]
export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession();
  if (!session) return unauthorized();
  const { id } = await params;

  const existing = await prisma.task.findFirst({ where: { id, userId: session.user.id } });
  if (!existing) return NextResponse.json({ error: "任务不存在" }, { status: 404 });

  try {
    const body = await req.json();
    const data: Record<string, unknown> = {};

    if (body.title !== undefined) data.title = body.title.trim();
    if (body.description !== undefined) data.description = body.description || null;
    if (body.taskType !== undefined) data.taskType = body.taskType;
    if (body.deadline !== undefined) data.deadline = body.deadline ? new Date(body.deadline) : null;
    if (body.estimatedMinutes !== undefined) data.estimatedMinutes = body.estimatedMinutes || null;
    // P1-10：预估单位（min/hour/day；null/空 清除；非法拒绝）
    if (body.estimatedUnit !== undefined) {
      if (body.estimatedUnit === null || body.estimatedUnit === "") {
        data.estimatedUnit = null;
      } else {
        const unit = normalizeEstimateUnit(body.estimatedUnit);
        if (!unit) return badRequest("estimatedUnit 需为 min/hour/day");
        data.estimatedUnit = unit;
      }
    }
    if (body.tags !== undefined) data.tags = body.tags || null;
    if (body.parentId !== undefined) data.parentId = body.parentId || null;
    // V3 C3：theme 白名单（≤20 字；null/空 清除主题）
    if (body.theme !== undefined) {
      if (body.theme === null || body.theme === "") {
        data.theme = null;
        // B7：清主题时同步清落库色
        data.themeColor = null;
      } else if (typeof body.theme === "string") {
        const theme = body.theme.trim();
        if (theme.length > 20) return badRequest("主题名称不能超过 20 字");
        data.theme = theme;
      } else {
        return badRequest("theme 需为字符串或 null");
      }
    }
    // B7：自定义主题颜色落库（JSON {"color","deep","bg"}；null/空 清除；theme 为空时颜色无意义）
    if (body.themeColor !== undefined) {
      if (body.themeColor === null || body.themeColor === "") {
        data.themeColor = null;
      } else {
        const norm = normalizeThemeColorInput(body.themeColor);
        if (!norm.ok) return badRequest("themeColor 需为 {\"color\",\"deep\",\"bg\"} #hex JSON 或 null");
        data.themeColor = norm.value;
      }
    }
    // Focus Card V2：purpose 白名单（≤50 字；null/空 清除动机）
    if (body.purpose !== undefined) {
      if (body.purpose === null || body.purpose === "") {
        data.purpose = null;
      } else if (typeof body.purpose === "string") {
        const purpose = body.purpose.trim();
        if (purpose.length > 50) return badRequest("动机文案不能超过 50 字");
        data.purpose = purpose;
      } else {
        return badRequest("purpose 需为字符串或 null");
      }
    }
    // Focus Card V2：departureAt 出发时刻写回（null/空 清除）
    if (body.departureAt !== undefined) {
      if (body.departureAt === null || body.departureAt === "") {
        data.departureAt = null;
      } else {
        const d = new Date(body.departureAt);
        if (isNaN(d.getTime())) return badRequest("departureAt 需为合法时间或 null");
        data.departureAt = d;
      }
    }
    // V5：层级语义 + 积累型标记（白名单）
    if (body.level !== undefined) {
      if (!["project", "phase", "task"].includes(body.level)) return badRequest("level 需为 project/phase/task");
      data.level = body.level;
    }
    if (body.accumulate !== undefined) data.accumulate = !!body.accumulate;
    // Project 页优化 · 阶段 D：★ 执行清单开关持久化（布尔白名单）
    if (body.star !== undefined) {
      if (typeof body.star !== "boolean") return badRequest("star 需为布尔值");
      data.star = body.star;
    }
    // 修复 P0-2：不允许直接写 category 之外的任意字段；category 走归一化
    if (body.category !== undefined) {
      const { normalizeCategory } = await import("@/lib/plan/colors");
      const cat = normalizeCategory(body.category);
      data.category = cat === "other" ? null : cat;
    }

    if (body.importance !== undefined) {
      // 修复 P1-16：类型 + 边界校验（防 "abc" → NaN 误导报错）
      if (typeof body.importance !== "number" || !Number.isInteger(body.importance) || body.importance < 1 || body.importance > 5) {
        return badRequest("importance 需为 1-5 的整数");
      }
      data.importance = body.importance;
    }

    // 修复 P0-2：startTime/endTime/status 禁止在此直写——
    // 时间变更必须走 Schedule Service（唯一时间源），状态变更必须走 /action 白名单
    // （原实现产生第二个时间事实源 + 状态任意字符串污染）

    const task = await prisma.task.update({
      where: { id }, data,
      include: { children: true },
    });

    // V3 D2 + FCV2：领域/主题/动机修改 → AgentFeedback 回流（计入 trustScore；档案面板编辑也触发）
    if (data.category !== undefined || data.theme !== undefined || data.purpose !== undefined) {
      const catChanged = data.category !== undefined && (existing.category ?? null) !== (data.category ?? null);
      const themeChanged = data.theme !== undefined && (existing.theme ?? null) !== (data.theme ?? null);
      const purposeChanged = data.purpose !== undefined && (existing.purpose ?? null) !== (data.purpose ?? null);
      if (catChanged) {
        await createFeedback({
          userId: session.user.id,
          taskId: id,
          agentAction: "inbox_classify",
          userResponse: "modified",
          modifiedField: "category",
          originalValue: existing.category ?? "",
          userValue: (data.category as string) ?? "",
          context: "archive_panel",
          agentSuggestion: JSON.stringify({ category: existing.category ?? null }),
        });
      }
      if (themeChanged) {
        await createFeedback({
          userId: session.user.id,
          taskId: id,
          agentAction: "inbox_classify",
          userResponse: "modified",
          modifiedField: "theme",
          originalValue: existing.theme ?? "",
          userValue: (data.theme as string) ?? "",
          context: "archive_panel",
          agentSuggestion: JSON.stringify({ theme: existing.theme ?? null }),
        });
      }
      if (purposeChanged) {
        await createFeedback({
          userId: session.user.id,
          taskId: id,
          agentAction: "inbox_classify",
          userResponse: "modified",
          modifiedField: "purpose",
          originalValue: existing.purpose ?? "",
          userValue: (data.purpose as string) ?? "",
          context: "archive_panel",
          agentSuggestion: JSON.stringify({ purpose: existing.purpose ?? null }),
        });
      }
    }

    return NextResponse.json(task);
  } catch {
    return badRequest("更新任务失败");
  }
}

// DELETE /api/tasks/[id]
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession();
  if (!session) return unauthorized();
  const { id } = await params;

  const existing = await prisma.task.findFirst({ where: { id, userId: session.user.id } });
  if (!existing) return NextResponse.json({ error: "任务不存在" }, { status: 404 });
  if (existing.status === "completed") {
    return badRequest("已完成的任务不可删除（成长记录永久保留）");
  }

  // BUG-20260808-054（原 BUG-051）：递归收集全部子孙（多级），显式级联删除——
  // 数据库外键级联不可靠（实测父删子孙残留为孤儿 → 孤儿子任务混入 mustDo 抢占主卡）。
  const allIds: string[] = [id];
  const queue = [id];
  while (queue.length > 0) {
    const cur = queue.shift()!;
    const kids = await prisma.task.findMany({
      where: { parentId: cur },
      select: { id: true },
    });
    for (const k of kids) {
      allIds.push(k.id);
      queue.push(k.id);
    }
  }

  await prisma.$transaction([
    prisma.timeLog.deleteMany({ where: { taskId: { in: allIds } } }),
    prisma.schedule.deleteMany({ where: { taskId: { in: allIds } } }),
    prisma.taskExecutionFeedback.deleteMany({ where: { taskId: { in: allIds } } }),
    prisma.task.deleteMany({ where: { id: { in: allIds } } }),
  ]);
  return NextResponse.json({ success: true });
}