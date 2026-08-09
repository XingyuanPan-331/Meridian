import { NextRequest, NextResponse } from "next/server";
import { getServerSession, unauthorized, badRequest } from "@/lib/api-utils";
import { prisma } from "@/lib/prisma";
import { createSchedule } from "@/lib/schedule/service";
import { createAccumulateSchedules } from "@/lib/schedule/service";
import { normalizeCategory } from "@/lib/plan/colors";
import { normalizeThemeColorInput } from "@/lib/task/theme";
import { normalizeEstimateUnit } from "@/lib/task/estimate";
import { localDateStr } from "@/lib/date";

const VALID_TYPES = ["inbox", "planned", "scheduled"];

export async function GET(req: NextRequest) {
  const session = await getServerSession();
  if (!session) return unauthorized();

  const { searchParams } = new URL(req.url);
  const status = searchParams.get("status");
  const taskType = searchParams.get("taskType");

  const where: Record<string, unknown> = { userId: session.user.id };
  if (status) where.status = status;
  if (taskType) where.taskType = taskType;
  if (!status) where.status = { notIn: ["snoozed", "cancelled", "completed"] };

  const tasks = await prisma.task.findMany({
    where,
    orderBy: { createdAt: "desc" },
    include: { children: true, timeLogs: { orderBy: { createdAt: "desc" }, take: 5 } },
  });

  return NextResponse.json(tasks);
}

// POST /api/tasks - create task manually
// Schedule ops via Schedule Service
export async function POST(req: NextRequest) {
  const session = await getServerSession();
  if (!session) return unauthorized();

  try {
    const body = await req.json();
    const { title, description, taskType, importance, startTime, endTime, deadline, estimatedMinutes, tags, parentId, star } = body;
    // BUG-20260808-053：star（★ 执行清单）创建时落库——原实现忽略该字段，
    // 导致 API 直接创建"执行清单"任务时锚点解析失败（排期被 BFS 到子任务，Today 显示细小事项）
    // P1-10：预估单位（min/hour/day，白名单；estimatedMinutes 存分钟）
    const estimatedUnit = normalizeEstimateUnit(body.estimatedUnit);

    if (!title?.trim()) return badRequest("任务标题不能为空");

    let type = VALID_TYPES.includes(taskType) ? taskType : "inbox";
    // B4 修复：子任务创建时继承父级 taskType（前端传 "task" 属非法值会被 fallback 成 inbox，
    // 导致执行清单子项全部变成"想法"混入收集箱 —— level 与 taskType 两维度混淆）
    if (!VALID_TYPES.includes(taskType) && parentId) {
      const parent = await prisma.task.findFirst({ where: { id: parentId, userId: session.user.id }, select: { taskType: true } });
      if (parent?.taskType && VALID_TYPES.includes(parent.taskType)) type = parent.taskType;
    }
    const imp = (typeof importance === "number" && importance >= 1 && importance <= 5) ? importance : 3;
    // 分类归一化：统一为小写 DOMAINS key（兼容历史大写枚举）
    const cat = normalizeCategory(body.category);
    // V3：theme 入参归一化（≤20 字，空则 null）
    const theme = typeof body.theme === "string" && body.theme.trim() ? body.theme.trim().slice(0, 20) : null;
    // B7：自定义主题颜色落库（theme 为空时颜色无意义 → null）
    const themeColor = theme ? normalizeThemeColorInput(body.themeColor).value : null;
    // Focus Card V2：purpose 入参归一化（≤50 字，空则 null）
    const purpose = typeof body.purpose === "string" && body.purpose.trim() ? body.purpose.trim().slice(0, 50) : null;
    // V5 层级重构：level 白名单 + 积累型标记
    const level = ["project", "phase", "task"].includes(body.level) ? body.level : "task";
    const accumulate = !!body.accumulate;

    let calcEstimated = estimatedMinutes;
    if (type === "scheduled" && startTime && endTime) {
      const diff = Math.round((new Date(endTime).getTime() - new Date(startTime).getTime()) / 60000);
      if (diff > 0) calcEstimated = diff;
    }

    // 后端兜底：scheduled 类型缺 endTime 时按预估/1h 自动补（修复：原实现导致任务创建后无排期）
    let calcEnd = endTime;
    if (type === "scheduled" && startTime && !calcEnd) {
      const est = calcEstimated && calcEstimated > 0 ? calcEstimated : 60;
      calcEnd = new Date(new Date(startTime).getTime() + est * 60000).toISOString();
    }

    // 事务化：task + schedule 原子创建，避免中途失败留下无排期任务
    // 2026-08-07：加 timeout 30s（Neon 高延迟下默认 5s 事务超时会导致 accumulate 创建失败）
    const task = await prisma.$transaction(async (tx) => {
      const t = await tx.task.create({
        data: {
          userId: session.user.id,
          title: title.trim(),
          description: description || null,
          taskType: type,
          importance: imp,
          theme,
          themeColor,
          purpose,
          deadline: deadline ? new Date(deadline) : null,
          estimatedMinutes: calcEstimated || null,
          estimatedUnit,
          tags: tags || null,
          parentId: parentId || null,
          category: cat === "other" ? null : cat,
          // V5：层级语义 + 积累型
          level,
          accumulate,
          // BUG-20260808-053：★ 执行清单标记创建时落库（UI 路径经 PUT 落库正常，API 路径此前丢失）
          star: !!star,
        },
        include: { children: true },
      });
      if (type === "scheduled" && startTime && calcEnd) {
        await tx.schedule.create({
          data: { userId: session.user.id, taskId: t.id, scheduledStart: new Date(startTime), scheduledEnd: new Date(calcEnd), source: "user" },
        });
      }
      // V5 积累型：自动生成未来 30 天每日重复排期（事务内）
      if (accumulate) {
        await createAccumulateSchedules(session.user.id, t.id, calcEstimated || 20, 30, 20, tx);
      }
      return t;
    }, { timeout: 30_000 });

    // 修复 P1-16：任务创建写观察（学习闭环数据源）
    prisma.userObservation.create({
      data: { userId: session.user.id, type: "task_create", taskId: task.id, category: task.category, detail: JSON.stringify({ taskType: task.taskType, importance: task.importance }) },
    }).catch(() => {});

    // BUG-20260807-038：新任务创建 → 失效今日决策缓存（today_decision 当天行）。
    // 今日决策（mustDo/recommended）在首次打开 Today 时生成并固化；用户先打开 Today 再录入任务时，
    // 新任务不会进入 mustDo → 无排期任务永远无法成为 Today 主卡（学习型卡不可达）。
    // 删除当天决策行 → 下次打开 Today 重新计算（含新任务）。
    prisma.todayDecision.deleteMany({ where: { userId: session.user.id, date: localDateStr() } }).catch(() => {});

    return NextResponse.json(task, { status: 201 });
  } catch (e) {
    console.error("[tasks] create failed:", e);
    return NextResponse.json({ error: "创建任务失败" }, { status: 500 });
  }
}
