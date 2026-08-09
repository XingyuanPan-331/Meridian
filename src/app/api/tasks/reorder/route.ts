// 2026-08-09：同级执行清单重排（today 上移/下移/拖拽 + project 树换序统一走这里）
// POST /api/tasks/reorder { parentId: string, ids: string[] }
// 按 ids 顺序把该父级下所有子任务的 sortOrder 重写为 0..n-1（事务）

import { NextRequest, NextResponse } from "next/server";
import { getServerSession, unauthorized, badRequest } from "@/lib/api-utils";
import { prisma } from "@/lib/prisma";

export async function POST(req: NextRequest) {
  const session = await getServerSession();
  if (!session) return unauthorized();

  let parentId: string, ids: string[];
  try {
    const body = await req.json();
    parentId = body.parentId;
    ids = Array.isArray(body.ids) ? body.ids.filter((x: unknown) => typeof x === "string") : [];
  } catch { return badRequest("请求格式错误"); }
  if (!parentId || ids.length < 2) return badRequest("缺少 parentId 或有效子任务列表");

  // 归属校验（项目铁律：查 id 必须带 userId）
  const parent = await prisma.task.findFirst({ where: { id: parentId, userId: session.user.id }, select: { id: true } });
  if (!parent) return NextResponse.json({ error: "任务不存在" }, { status: 404 });

  // 校验 ids 全部是 parentId 的直接子任务
  const kids = await prisma.task.findMany({
    where: { userId: session.user.id, parentId },
    select: { id: true },
  });
  const kidSet = new Set(kids.map((k) => k.id));
  for (const id of ids) {
    if (!kidSet.has(id)) return badRequest("列表中存在非该清单的子任务");
  }

  // 事务重排：sortOrder = 数组下标
  await prisma.$transaction(
    ids.map((id, i) =>
      prisma.task.update({ where: { id }, data: { sortOrder: i } })
    )
  );

  return NextResponse.json({ success: true, count: ids.length });
}
