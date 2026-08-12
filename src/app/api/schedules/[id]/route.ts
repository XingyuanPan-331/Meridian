import { NextRequest, NextResponse } from "next/server";
import { getServerSession, unauthorized, badRequest } from "@/lib/api-utils";
import { prisma } from "@/lib/prisma";

// PUT /api/schedules/[id] — 2026-08-13 多段执行：分别修改某时间块的开始/结束/出发/完成
// （任务分多块完成时，每块独立编辑时间——project/搜索点开任务卡档案后操作）
export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession();
  if (!session) return unauthorized();
  const { id } = await params;

  const sched = await prisma.schedule.findFirst({ where: { id, userId: session.user.id } });
  if (!sched) return NextResponse.json({ error: "时间块不存在" }, { status: 404 });

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return badRequest("请求格式错误"); }

  const data: Record<string, unknown> = {};
  const parseTime = (v: unknown, field: string): Date | undefined => {
    if (v === undefined || v === null) return undefined;
    const d = new Date(v as string);
    if (isNaN(d.getTime())) throw new Error(`${field} 时间格式非法`);
    return d;
  };
  try {
    const start = parseTime(body.scheduledStart, "开始时间");
    const end = parseTime(body.scheduledEnd, "结束时间");
    const dep = parseTime(body.departureAt, "出发时间");
    const done = parseTime(body.completedAt, "完成时间");
    if (start) data.scheduledStart = start;
    if (end) data.scheduledEnd = end;
    if (dep) data.departureAt = dep;
    else if (body.departureAt === null) data.departureAt = null;
    if (done) data.completedAt = done;
    else if (body.completedAt === null) data.completedAt = null;
  } catch (e) { return badRequest((e as Error).message); }

  if (Object.keys(data).length === 0) return badRequest("没有可更新的字段");

  const updated = await prisma.schedule.update({ where: { id }, data: data as never });
  return NextResponse.json({ success: true, id: updated.id });
}
