// GET /api/themes — 聚合用户已用主题（预设 + 自定义含配色与任务数）
// PATCH /api/themes — 管理自定义主题（rename / recolor / delete，批量更新该用户任务）
// 2026-08-09：主题可管理（用户反馈：自定义主题不在可选列表，无法改名/改色/删除）
import { NextRequest, NextResponse } from "next/server";
import { getServerSession, unauthorized, badRequest } from "@/lib/api-utils";
import { prisma } from "@/lib/prisma";
import { THEMES, THEME_FALLBACK } from "@/lib/plan/colors";

export async function GET() {
  const session = await getServerSession();
  if (!session) return unauthorized();
  try {
    const tasks = await prisma.task.findMany({
      where: { userId: session.user.id, theme: { not: null } },
      select: { theme: true, themeColor: true },
    });
    const counts = new Map<string, number>();
    const colors = new Map<string, string | null>();
    for (const t of tasks) {
      const name = t.theme as string;
      counts.set(name, (counts.get(name) ?? 0) + 1);
      if (t.themeColor && !colors.has(name)) colors.set(name, t.themeColor);
    }
    const custom: { name: string; color: string; deep: string; bg: string; count: number }[] = [];
    for (const [name, count] of counts) {
      if (THEMES[name]) continue; // 预设单独给
      let c = { ...THEME_FALLBACK };
      const raw = colors.get(name);
      if (raw) {
        try {
          const p = JSON.parse(raw);
          if (p?.color) c = { color: p.color, deep: p.deep || p.color, bg: p.bg || "#F8FAFC" };
        } catch {}
      }
      custom.push({ name, ...c, count });
    }
    custom.sort((a, b) => b.count - a.count);
    return NextResponse.json({ presets: Object.entries(THEMES).map(([name, c]) => ({ name, ...c })), custom });
  } catch (e) {
    console.error("[themes] GET failed:", e);
    return NextResponse.json({ error: "主题聚合失败" }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  const session = await getServerSession();
  if (!session) return unauthorized();
  try {
    const body = await req.json();
    const action = body.action;
    const oldName = typeof body.oldName === "string" ? body.oldName.trim() : "";
    if (!oldName) return badRequest("需要 oldName");
    const userId = session.user.id;

    if (action === "rename") {
      const newName = typeof body.newName === "string" ? body.newName.trim() : "";
      if (!newName || newName.length > 20) return badRequest("新主题名需 1-20 字");
      if (oldName === newName) return badRequest("新旧名称相同");
      const color = typeof body.color === "string" && /^#[0-9a-fA-F]{6}$/.test(body.color) ? body.color : null;
      const deep = typeof body.deep === "string" && /^#[0-9a-fA-F]{6}$/.test(body.deep) ? body.deep : color;
      const bg = typeof body.bg === "string" && /^#[0-9a-fA-F]{6}$/.test(body.bg) ? body.bg : "#F8FAFC";
      const r = await prisma.task.updateMany({
        where: { userId, theme: oldName },
        data: { theme: newName, ...(color ? { themeColor: JSON.stringify({ color, deep: deep ?? color, bg }) } : {}) },
      });
      return NextResponse.json({ success: true, affected: r.count });
    }
    if (action === "recolor") {
      const color = typeof body.color === "string" && /^#[0-9a-fA-F]{6}$/.test(body.color) ? body.color : null;
      if (!color) return badRequest("需要 color");
      const deep = typeof body.deep === "string" && /^#[0-9a-fA-F]{6}$/.test(body.deep) ? body.deep : color;
      const bg = typeof body.bg === "string" && /^#[0-9a-fA-F]{6}$/.test(body.bg) ? body.bg : "#F8FAFC";
      const r = await prisma.task.updateMany({
        where: { userId, theme: oldName },
        data: { themeColor: JSON.stringify({ color, deep, bg }) },
      });
      return NextResponse.json({ success: true, affected: r.count });
    }
    if (action === "delete") {
      const r = await prisma.task.updateMany({ where: { userId, theme: oldName }, data: { theme: null, themeColor: null } });
      return NextResponse.json({ success: true, affected: r.count });
    }
    return badRequest("未知操作: " + action);
  } catch (e) {
    console.error("[themes] PATCH failed:", e);
    return NextResponse.json({ error: "主题管理失败" }, { status: 500 });
  }
}
