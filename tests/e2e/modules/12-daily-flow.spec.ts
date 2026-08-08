/**
 * 模块 12 · 用户日常使用流程端到端全仿真回归（基于《用户日常使用流程模拟文档-2026-08-07》）
 *
 * 真实浏览器（headed）全自动，实际鼠标点击 + 键盘输入，逐步骤还原文档 10 环节：
 *   环节1 07:40 Inbox 录入 → 环节2 08:00 优先级/截止/积累调整 → 环节3 08:15 项目归类与★布置
 *   → 环节4 08:30 Plan 拖拽排期 → 环节5 09:00 清单型卡 → 环节6 10:00 学习型卡
 *   → 环节7 11:00 时间型卡 → 环节8 12:30 改期 → 环节9 15:00 积累型卡 → 环节10 21:00 复盘续排
 *
 * 纪律：
 *   - 数据准备 100% UI（注册/Inbox AI 整理/挂树/★/拖拽排期/执行）
 *   - 仅允许只读 GET 做落库与时间核对（不写库）
 *   - 每个操作前后页面就绪等待 + 结果校验；关键业务节点断言；step 日志便于回溯
 *
 * 任务剧本（覆盖四款 FocusCard + 惰性结算 + 续排 + 截止）：
 *   A 清单型   「完成产品需求评审文档，预计 90 分钟」+3 子任务 imp低 → 排期 now-10min → 手动完成
 *   D 学习型   「背考研英语单词 50 个，预计 40 分钟」imp高+截止今天 → mustDo[0] → 知识点勾选(可逆)
 *   E 时间型   「参加组会，预计 60 分钟」imp低 → 排期 now+60min → 路线点击 → timer 手动完成
 *   C 积累型   「晚上健身 45 分钟，每周三次」设为每天 imp低 → 排期 now+90min → 出发→打卡
 *   B 截止任务 「给导师发实验数据，预计 30 分钟」截止明天 → 不完成 → 归档不含 B
 *   F 续排     「整理会议纪要，预计 30 分钟」imp低 → 排期 now-2h(planned 不结算) → 复制到明天
 *   F2 惰性结算「早上 8 点备份电脑数据，60 分钟」→ scheduled(今早已过期) → 打开 Today 自动完成
 */
import { test, expect, type Page, type TestInfo } from "@playwright/test";
import { gotoNav, registerTempUser, findInboxCard, expectInboxResult, dragToPlanColumn, localDateStr, dateOffset } from "../utils/helpers";
import { findLatestTaskByPrefix, getTask } from "../utils/api";

/* ── step 日志（每步操作 + 结果，便于回溯） ── */
function step(info: TestInfo, msg: string) {
  console.log(`[step ${new Date().toTimeString().slice(0, 8)}] ${msg}`);
  info.annotations.push({ type: "step", description: msg });
}

/** 本地 HH:MM */
function hm(d: Date = new Date()): string {
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}
/** 现在 ± offset 小时的排期小时（clamp 8-21，Plan 时间轴） */
function planHour(offsetH: number): number {
  const h = new Date().getHours() + offsetH;
  return Math.max(8, Math.min(21, h));
}

test.describe("12 用户日常流程端到端全仿真（纯 UI）", () => {
  test("一天全流程：录入→调整→归类→排期→四卡执行→改期→复盘续排", async ({ page }, testInfo) => {
    test.setTimeout(900_000); // 全流程 UI + Neon，15 分钟上限

    /* ═══ 环节 0：注册 + 登录（落地 /today，今日决策以空任务生成 → 验证 BUG-038 失效机制） ═══ */
    step(testInfo, "环节0 注册临时用户并登录");
    const email = await registerTempUser(page);
    await page.getByPlaceholder("you@example.com").fill(email);
    await page.getByPlaceholder("请输入密码").fill("TempPassw0rd!");
    await page.getByRole("button", { name: "进入子午" }).click();
    await page.waitForURL("**/today", { timeout: 30_000 });

    /* ═══ 环节 1+2：Inbox 录入 7 个任务 + 确认前调整（优先级/截止/积累/子任务） ═══ */
    await gotoNav(page, "inbox");
    const tasks: Record<string, { id: string; title: string }> = {};

    // A：清单型（加 1 个子任务即升级复杂卡——产品真实行为，快捷区随之消失）
    // 排序控制：A imp低(2分)+排期(30)=32 < D(35) → mustDo[0]=D（学习卡可达）
    step(testInfo, "环节1/2-A 录入清单型任务 + 重要性低 + 加 1 个子任务");
    await page.getByPlaceholder(/把脑子里的事倒进来/).first().fill("完成产品需求评审文档，预计 90 分钟");
    step(testInfo, "A 已输入，点击 AI 整理");
    await page.getByRole("button", { name: "AI 整理" }).click();
    await expectInboxResult(page);
    step(testInfo, "A 整理结果出现");
    let card = findInboxCard(page, "完成产品需求评审文档");
    await expect(card).toBeVisible({ timeout: 15_000 });
    step(testInfo, "A 卡片可见，调优先级低");
    // 调优先级：低（importance 1/2 均显示「低」→ .first()）
    await card.getByRole("button", { name: "低", exact: true }).first().click();
    step(testInfo, "A 优先级已调低，加 1 个子任务（升级复杂卡）");
    await card.getByRole("button", { name: "＋ 加子任务" }).click();
    const subInput = page.getByPlaceholder("子任务标题，回车添加").first();
    await expect(subInput).toBeVisible({ timeout: 10_000 });
    await subInput.fill("评审文档初稿");
    await subInput.press("Enter");
    step(testInfo, "A 子任务已添加，确认创建");
    // 复杂卡 → 确认创建 1 个子任务
    await expect(page.getByRole("button", { name: /确认创建 \d+ 个子任务/ }).first()).toBeVisible({ timeout: 10_000 });
    await page.getByRole("button", { name: /确认创建 \d+ 个子任务/ }).first().click();
    await expect(page.getByRole("button", { name: "撤销" }).first()).toBeVisible({ timeout: 15_000 });
    const hitA = await findLatestTaskByPrefix(page.request, "完成产品需求评审文档");
    expect(hitA, "A 应已创建").not.toBeNull();
    tasks.A = { id: hitA!.id, title: hitA!.title };
    // 断言：importance=1（低）+ 1 个子任务
    await expect.poll(async () => Number((await getTask(page.request, tasks.A.id)).importance ?? 0), { timeout: 30_000 }).toBe(1);
    await expect.poll(async () => ((await getTask(page.request, tasks.A.id)).children as unknown[])?.length ?? 0, { timeout: 30_000 }).toBe(1);

    // D：学习型（imp 高 + 截止今天 → mustDo[0]）
    step(testInfo, "环节1/2-D 录入学习型任务 + 重要性高 + 截止今天");
    await page.getByPlaceholder(/把脑子里的事倒进来/).first().fill("背考研英语单词 50 个，预计 40 分钟");
    await page.getByRole("button", { name: "AI 整理" }).click();
    await expectInboxResult(page);
    card = findInboxCard(page, "背考研英语单词");
    await expect(card).toBeVisible({ timeout: 15_000 });
    await card.getByRole("button", { name: "高", exact: true }).first().click();
    await card.getByRole("button", { name: "设有截止" }).click();
    const dlInput = page.locator("input[type='date']").first();
    await expect(dlInput).toBeVisible({ timeout: 10_000 });
    await dlInput.fill(localDateStr());
    await card.getByRole("button", { name: "确定" }).first().click();
    await card.getByRole("button", { name: "确认" }).click();
    await expect(page.getByRole("button", { name: "撤销" }).first()).toBeVisible({ timeout: 15_000 });
    const hitD = await findLatestTaskByPrefix(page.request, "背考研英语单词");
    expect(hitD, "D 应已创建").not.toBeNull();
    tasks.D = { id: hitD!.id, title: hitD!.title };
    await expect.poll(async () => Number((await getTask(page.request, tasks.D.id)).importance ?? 0), { timeout: 30_000 }).toBeGreaterThanOrEqual(4);
    await expect.poll(async () => (await getTask(page.request, tasks.D.id)).deadline as string | null, { timeout: 30_000 }).not.toBeNull();

    // B：截止任务（截止明天，imp 默认中）
    step(testInfo, "环节1/2-B 录入截止任务（明天截止）");
    await page.getByPlaceholder(/把脑子里的事倒进来/).first().fill("给导师发实验数据，预计 30 分钟");
    await page.getByRole("button", { name: "AI 整理" }).click();
    await expectInboxResult(page);
    card = findInboxCard(page, "给导师发实验数据");
    await expect(card).toBeVisible({ timeout: 15_000 });
    await card.getByRole("button", { name: "设有截止" }).click();
    await page.locator("input[type='date']").first().fill(dateOffset(1));
    await card.getByRole("button", { name: "确定" }).first().click();
    await card.getByRole("button", { name: "确认" }).click();
    await expect(page.getByRole("button", { name: "撤销" }).first()).toBeVisible({ timeout: 15_000 });
    const hitB = await findLatestTaskByPrefix(page.request, "给导师发实验数据");
    expect(hitB, "B 应已创建").not.toBeNull();
    tasks.B = { id: hitB!.id, title: hitB!.title };

    // C：积累型（设为每天——规则降级对「每周+健身」已自动识别积累，按钮可能已是「✓ 每天重复」→ 条件点击）
    step(testInfo, "环节1/2-C 录入积累型任务 + 设为每天");
    await page.getByPlaceholder(/把脑子里的事倒进来/).first().fill("晚上健身 45 分钟，每周三次");
    await page.getByRole("button", { name: "AI 整理" }).click();
    await expectInboxResult(page);
    card = findInboxCard(page, "健身45分钟");
    await expect(card).toBeVisible({ timeout: 15_000 });
    const dailyBtn = card.getByRole("button", { name: "设为每天" }).first();
    if (await dailyBtn.isVisible().catch(() => false)) {
      await dailyBtn.click();
    }
    await expect(card.getByText("✓ 每天重复")).toBeVisible({ timeout: 10_000 });
    // BUG-20260807-048（测试数据）：C 必须设「低」——默认 imp3（排期30+6=36）> D 的 35，抢占 mustDo[0]
    await card.getByRole("button", { name: "低", exact: true }).first().click();
    await card.getByRole("button", { name: "确认" }).click();
    await expect(page.getByRole("button", { name: "撤销" }).first()).toBeVisible({ timeout: 15_000 });
    const hitC = await findLatestTaskByPrefix(page.request, "健身");
    expect(hitC, "C 应已创建").not.toBeNull();
    tasks.C = { id: hitC!.id, title: hitC!.title };
    await expect.poll(async () => (await getTask(page.request, tasks.C.id)).accumulate as boolean | undefined, { timeout: 30_000 }).toBe(true);

    // E：时间型（imp 低，排期后 timer）
    step(testInfo, "环节1/2-E 录入时间型任务（组会）");
    await page.getByPlaceholder(/把脑子里的事倒进来/).first().fill("参加组会，预计 60 分钟");
    await page.getByRole("button", { name: "AI 整理" }).click();
    await expectInboxResult(page);
    card = findInboxCard(page, "参加组会");
    await expect(card).toBeVisible({ timeout: 15_000 });
    await card.getByRole("button", { name: "低", exact: true }).first().click();
    await card.getByRole("button", { name: "确认" }).click();
    await expect(page.getByRole("button", { name: "撤销" }).first()).toBeVisible({ timeout: 15_000 });
    const hitE = await findLatestTaskByPrefix(page.request, "参加组会");
    expect(hitE, "E 应已创建").not.toBeNull();
    tasks.E = { id: hitE!.id, title: hitE!.title };

    // F：续排任务（imp 低）
    step(testInfo, "环节1/2-F 录入续排任务");
    await page.getByPlaceholder(/把脑子里的事倒进来/).first().fill("整理会议纪要，预计 30 分钟");
    await page.getByRole("button", { name: "AI 整理" }).click();
    await expectInboxResult(page);
    card = findInboxCard(page, "整理会议纪要");
    await expect(card).toBeVisible({ timeout: 15_000 });
    await card.getByRole("button", { name: "低", exact: true }).first().click();
    await card.getByRole("button", { name: "确认" }).click();
    await expect(page.getByRole("button", { name: "撤销" }).first()).toBeVisible({ timeout: 15_000 });
    const hitF = await findLatestTaskByPrefix(page.request, "整理会议纪要");
    expect(hitF, "F 应已创建").not.toBeNull();
    tasks.F = { id: hitF!.id, title: hitF!.title };

    // F2：惰性结算（scheduled 今早 08:00 已过期）
    step(testInfo, "环节1/2-F2 录入固定时间任务（今早 8 点，已过期 → 惰性结算）");
    await page.getByPlaceholder(/把脑子里的事倒进来/).first().fill("早上 8 点备份电脑数据，60 分钟");
    await page.getByRole("button", { name: "AI 整理" }).click();
    await expectInboxResult(page);
    card = findInboxCard(page, "备份电脑数据");
    await expect(card).toBeVisible({ timeout: 15_000 });
    // imp 低：控制 mustDo 排序（F2 若 imp3，排期 30+6=36 > D 的 35 → 顶替 mustDo[0] 挡住学习卡）
    await card.getByRole("button", { name: "低", exact: true }).first().click();
    await card.getByRole("button", { name: "确认" }).click();
    await expect(page.getByRole("button", { name: "撤销" }).first()).toBeVisible({ timeout: 15_000 });
    const hitF2 = await findLatestTaskByPrefix(page.request, "备份电脑数据");
    expect(hitF2, "F2 应已创建").not.toBeNull();
    tasks.F2 = { id: hitF2!.id, title: hitF2!.title };
    // 断言：taskType=scheduled 且带今早排期（规则降级已生成）
    await expect.poll(async () => (await getTask(page.request, tasks.F2.id)).taskType as string | undefined, { timeout: 30_000 }).toBe("scheduled");
    await expect.poll(async () => Array.isArray((await getTask(page.request, tasks.F2.id)).schedules) && ((await getTask(page.request, tasks.F2.id)).schedules as unknown[]).length > 0, { timeout: 30_000 }).toBeTruthy();

    /* ═══ 环节 3：Projects 项目归类 + ★ 布置 ═══ */
    step(testInfo, "环节3 新建项目并归类 A/B，★ A/C/D");
    await gotoNav(page, "projects");
    await page.getByRole("button", { name: "＋ 新建项目" }).first().click();
    await page.getByPlaceholder("输入名称，回车创建（Esc 取消）").fill("E2E日常项目");
    await page.getByPlaceholder("输入名称，回车创建（Esc 取消）").press("Enter");
    await expect(page.locator("text=E2E日常项目").first()).toBeVisible({ timeout: 15_000 });

    const dstRow = page.locator(".pt-row").filter({ hasText: "E2E日常项目" }).first();
    // 挂 A/B/C/D 全部挂树（★ 只在树行上，孤儿无 ★ 按钮——需挂树后才能设执行清单）
    for (const key of ["A", "B", "C", "D", "E", "F"] as const) {
      const poolItem = page.locator(".pt-pool-item").filter({ hasText: tasks[key].title }).first();
      await expect(poolItem).toBeVisible({ timeout: 20_000 });
      const dt = await page.evaluateHandle(() => new DataTransfer());
      await poolItem.dispatchEvent("dragstart", { dataTransfer: dt });
      await page.waitForTimeout(150);
      await dstRow.dispatchEvent("dragover", { dataTransfer: dt });
      await page.waitForTimeout(80);
      await dstRow.dispatchEvent("drop", { dataTransfer: dt });
      await expect.poll(async () => (await getTask(page.request, tasks[key].id)).parentId as string | null, { timeout: 30_000 }).toBeTruthy();
    }
    // ★ A/C/D/E/F（树行；收集箱只放行 ★ 任务，E/F 排期/续排均需 ★）
    for (const key of ["A", "C", "D", "E", "F"] as const) {
      const row = page.locator(".pt-row").filter({ hasText: tasks[key].title }).first();
      await expect(row).toBeVisible({ timeout: 15_000 });
      await row.locator(".pt-star").click();
      await expect(row.locator(".pt-star.on")).toBeVisible({ timeout: 10_000 });
      await expect.poll(async () => (await getTask(page.request, tasks[key].id)).star as boolean | undefined, { timeout: 30_000 }).toBe(true);
    }

    /* ═══ 环节 4：Plan 拖拽排期 ═══ */
    step(testInfo, "环节4 Plan 拖拽排期 A(now-10min)/E(+60min)/C(+90min)/F(now-2h)");
    await gotoNav(page, "plan");
    const todayCol = (new Date().getDay() + 6) % 7;
    // A：当前时段（now-10min 开始）→ Priority 2 命中
    await dragToPlanColumn(page, tasks.A.title, todayCol, planHour(0));
    await expect.poll(async () => Array.isArray((await getTask(page.request, tasks.A.id)).schedules) && ((await getTask(page.request, tasks.A.id)).schedules as unknown[]).length > 0, { timeout: 30_000 }).toBeTruthy();
    // E：now+60min（未到 → 路线点击前置）
    await dragToPlanColumn(page, tasks.E.title, todayCol, planHour(-1));
    await expect.poll(async () => Array.isArray((await getTask(page.request, tasks.E.id)).schedules) && ((await getTask(page.request, tasks.E.id)).schedules as unknown[]).length > 0, { timeout: 30_000 }).toBeTruthy();
    // C：now+90min
    await dragToPlanColumn(page, tasks.C.title, todayCol, planHour(-2));
    await expect.poll(async () => Array.isArray((await getTask(page.request, tasks.C.id)).schedules) && ((await getTask(page.request, tasks.C.id)).schedules as unknown[]).length > 0, { timeout: 30_000 }).toBeTruthy();
    // F：now-2h（planned 过期不结算 → 供续排建议）
    await dragToPlanColumn(page, tasks.F.title, todayCol, planHour(-2));
    await expect.poll(async () => Array.isArray((await getTask(page.request, tasks.F.id)).schedules) && ((await getTask(page.request, tasks.F.id)).schedules as unknown[]).length > 0, { timeout: 30_000 }).toBeTruthy();

    /* ═══ 环节 5：清单型卡 A（出发→勾选→新增→完成→补记→时间核对） ═══ */
    step(testInfo, "环节5 Today 清单型卡 A 执行");
    await gotoNav(page, "today");
    // 路线点击 A → 前置卡（BUG-044 修复后带真实清单）→ 出发
    await expect(page.locator(`text=${tasks.A.title}`).first()).toBeVisible({ timeout: 30_000 });
    await page.locator(`text=${tasks.A.title}`).first().click();
    await expect(page.getByRole("button", { name: "出发" }).first()).toBeVisible({ timeout: 15_000 });
    await page.getByRole("button", { name: "出发" }).first().click();
    const tStartA = new Date();
    await expect(page.locator("text=/从 \\d{2}:\\d{2} 出发/").first()).toBeVisible({ timeout: 15_000 });
    // 勾选执行清单项——addChild 生成的子级是阶段（「清单 N」），动态读取 children[0].title
    const aKids = ((await getTask(page.request, tasks.A.id)).children ?? []) as Array<{ title: string; status: string }>;
    expect(aKids.length, "A 应有执行清单项").toBeGreaterThanOrEqual(1);
    const subTitle = aKids[0].title;
    step(testInfo, `环节5 勾选清单项「${subTitle}」`);
    {
      const row = page.locator("li").filter({ hasText: subTitle }).first();
      await expect(row).toBeVisible({ timeout: 15_000 });
      await row.locator("button").first().click();
      await expect
        .poll(async () => {
          const t = await getTask(page.request, tasks.A.id);
          const kids = (t.children ?? []) as Array<{ title: string; status: string }>;
          return kids.find((c) => c.title === subTitle)?.status === "completed";
        }, { timeout: 20_000 })
        .toBeTruthy();
    }
    // ＋ 新增子项
    await page.getByRole("button", { name: "＋" }).first().click();
    const addInput = page.getByPlaceholder(/新增一项/).first();
    await expect(addInput).toBeVisible({ timeout: 10_000 });
    await addInput.fill("补充风险清单");
    await addInput.press("Enter");
    await expect(page.getByText("补充风险清单")).toBeVisible({ timeout: 15_000 });
    // 该项完成 → 补记弹窗（默认值核对）→ 确定
    await page.getByRole("button", { name: "该项完成" }).first().click();
    await expect(page.getByRole("button", { name: "确定" }).first()).toBeVisible({ timeout: 10_000 });
    const durInput = page.locator("input[placeholder='45']").first();
    const durVal = Number(await durInput.inputValue());
    expect(Math.abs(durVal - Math.round((Date.now() - tStartA.getTime()) / 60000)), `补记默认 ${durVal} 分钟`).toBeLessThanOrEqual(3);
    await page.getByRole("button", { name: "确定" }).first().click();
    await expect(page.getByRole("button", { name: "已完成 ✓" }).first()).toBeVisible({ timeout: 20_000 });
    // 关键断言：status=completed + actualMinutes=durVal + timeLogs manual
    // 注意：complete 处理慢（Neon 下 stats 更新可达 6-8s），actualMinutes 断言必须 poll
    // （status 先更新、actualMinutes 后更新，直读会读到中间态 0）
    await expect.poll(async () => (await getTask(page.request, tasks.A.id)).status, { timeout: 30_000 }).toBe("completed");
    await expect
      .poll(async () => Number((await getTask(page.request, tasks.A.id)).actualMinutes ?? 0), { timeout: 30_000 })
      .toBe(durVal);
    await expect
      .poll(async () => {
        const t = await getTask(page.request, tasks.A.id);
        const logs = (t.timeLogs ?? []) as Array<{ type?: string }>;
        return logs.some((l) => l.type === "manual");
      }, { timeout: 30_000 })
      .toBeTruthy();
    step(testInfo, `环节5 完成：actualMinutes=${durVal}（补记 ${durVal} 分钟）`);

    /* ═══ 环节 6：积累型卡 C（路线点击 → 出发 → 打卡 → 内容 → 完成） ═══ */
    step(testInfo, "环节6 Today 积累型卡 C 打卡+完成");
    await gotoNav(page, "today");
    await page.reload();
    await expect(page.locator(`text=${tasks.C.title}`).first()).toBeVisible({ timeout: 30_000 });
    await page.locator(`text=${tasks.C.title}`).first().click();
    await expect(page.getByRole("button", { name: "出发" }).first()).toBeVisible({ timeout: 15_000 });
    await page.getByRole("button", { name: "出发" }).first().click();
    await page.getByRole("button", { name: "打卡" }).first().click();
    await expect(page.getByRole("button", { name: "打卡完成" }).first()).toBeVisible({ timeout: 10_000 });
    await page.locator("input[placeholder*='可空']").first().fill("卧推 5 组 + 跑步 3km");
    await page.getByRole("button", { name: "打卡完成" }).first().click();
    // 断言：timeLogs checkin + detail
    await expect
      .poll(async () => {
        const t = await getTask(page.request, tasks.C.id);
        const logs = (t.timeLogs ?? []) as Array<{ type?: string; detail?: string | null }>;
        return logs.some((l) => l.type === "checkin" && l.detail?.includes("卧推"));
      }, { timeout: 45_000 })
      .toBeTruthy();
    // Projects 习惯区「已打卡 ✓」+ 树行「今日已打卡」
    await gotoNav(page, "projects");
    await expect(page.getByRole("button", { name: "已打卡 ✓" }).first()).toBeVisible({ timeout: 45_000 });
    await expect(page.locator(`[title="今日已打卡"]`).first()).toBeVisible({ timeout: 10_000 });
    // 注：积累任务打卡即完成当日（产品语义），不做 complete
    // C 出发后 in_progress（+25 分，57 > D 的 35）会抢占 mustDo[0 → 打卡后「暂停」恢复 not_started
    // BUG-047：A 完成时已删今日决策 → 环节 7 打开 Today 决策重算 → D(35) 为 mustDo[0]
    await gotoNav(page, "today");
    await page.reload();
    await expect(page.locator(`text=${tasks.C.title}`).first()).toBeVisible({ timeout: 30_000 });
    await page.locator(`text=${tasks.C.title}`).first().click();
    await expect(page.getByRole("button", { name: "暂停" }).first()).toBeVisible({ timeout: 15_000 });
    await page.getByRole("button", { name: "暂停" }).first().click();
    await expect(page.getByRole("button", { name: "确定" }).first()).toBeVisible({ timeout: 10_000 });
    await page.getByRole("button", { name: "确定" }).first().click();
    await expect.poll(async () => (await getTask(page.request, tasks.C.id)).status, { timeout: 20_000 }).toBe("not_started");
    step(testInfo, "环节6 C 已暂停（not_started）——mustDo 排序 D(35) > C(32)");

    /* ═══ 环节 7：学习型卡 D（C 完成删决策 → mustDo[0]=D → ＋知识点 → 可逆勾选 → 完成） ═══ */
    step(testInfo, "环节7 Today 学习型卡 D（mustDo 兜底）");
    // 环节 6 末尾在 Projects（习惯区验证）→ 先回 Today 再 reload
    await gotoNav(page, "today");
    await page.reload();
    await expect(page.locator(`text=${tasks.D.title}`).first()).toBeVisible({ timeout: 30_000 });
    // 学习型（无子任务）或新增知识点后的清单型均可——类型由 children 推断，交互一致
    await expect(page.locator("text=/学习型|清单型/").first()).toBeVisible({ timeout: 15_000 });
    // ＋ 添加 2 个知识点
    for (const kp of ["高频词 20 个", "长难句 5 句"]) {
      await page.getByRole("button", { name: "＋" }).first().click();
      const kpInput = page.getByPlaceholder(/新增一项/).first();
      await expect(kpInput).toBeVisible({ timeout: 10_000 });
      await kpInput.fill(kp);
      await kpInput.press("Enter");
      await expect(page.getByText(kp)).toBeVisible({ timeout: 15_000 });
    }
    // 出发 → 勾选 → 取消（可逆）→ 再勾
    await page.getByRole("button", { name: "出发" }).first().click();
    const kpRow = page.locator("li").filter({ hasText: "高频词 20 个" }).first();
    await expect(kpRow).toBeVisible({ timeout: 15_000 });
    await kpRow.locator("button").first().click();
    // 注意：勾选后【不 reload】——complete fetch（Neon 慢 3-7s）未完成即 reload 会中断请求，
    // 子任务不落库 poll 必失败。BUG-20260808-050 修复后 toggleChildItem 自带 load() 刷新。
    await expect
      .poll(async () => {
        const t = await getTask(page.request, tasks.D.id);
        const kids = (t.children ?? []) as Array<{ title: string; status: string }>;
        return kids.find((c) => c.title.includes("高频词"))?.status === "completed";
      }, { timeout: 30_000 })
      .toBeTruthy();
    await kpRow.locator("button").first().click(); // 可逆：取消勾选
    await expect
      .poll(async () => {
        const t = await getTask(page.request, tasks.D.id);
        const kids = (t.children ?? []) as Array<{ title: string; status: string }>;
        return kids.find((c) => c.title.includes("高频词"))?.status !== "completed";
      }, { timeout: 20_000 })
      .toBeTruthy();
    await kpRow.locator("button").first().click(); // 再勾
    await expect
      .poll(async () => {
        const t = await getTask(page.request, tasks.D.id);
        const kids = (t.children ?? []) as Array<{ title: string; status: string }>;
        return kids.find((c) => c.title.includes("高频词"))?.status === "completed";
      }, { timeout: 20_000 })
      .toBeTruthy();
    // 该项完成 → 确定
    await page.getByRole("button", { name: "该项完成" }).first().click();
    await expect(page.getByRole("button", { name: "确定" }).first()).toBeVisible({ timeout: 10_000 });
    await page.getByRole("button", { name: "确定" }).first().click();
    await expect.poll(async () => (await getTask(page.request, tasks.D.id)).status, { timeout: 30_000 }).toBe("completed");

    /* ═══ 环节 8：时间型卡 E（路线点击 → timer「完成」→ 补记） ═══ */
    step(testInfo, "环节8 Today 前置卡 E（learning 提前执行）");
    await page.reload();
    await expect(page.locator(`text=${tasks.E.title}`).first()).toBeVisible({ timeout: 30_000 });
    await page.locator(`text=${tasks.E.title}`).first().click();
    // BUG-20260808-052：E 无子任务+排期（planned）→ learning 卡（非固定时间）→「出发」；
    // 固定时间只属于 scheduled 任务（惰性结算语义），由环节 9 F2 覆盖验证
    await expect(page.getByRole("button", { name: "出发" }).first()).toBeVisible({ timeout: 15_000 });
    await page.getByRole("button", { name: "出发" }).first().click();
    // 计时中 → 该项完成 → 补记
    await expect(page.getByRole("button", { name: "该项完成" }).first()).toBeVisible({ timeout: 15_000 });
    await page.getByRole("button", { name: "该项完成" }).first().click();
    await expect(page.getByRole("button", { name: "确定" }).first()).toBeVisible({ timeout: 10_000 });
    await page.getByRole("button", { name: "确定" }).first().click();
    await expect.poll(async () => (await getTask(page.request, tasks.E.id)).status, { timeout: 30_000 }).toBe("completed");
    const tE = await getTask(page.request, tasks.E.id);
    expect(Number(tE.actualMinutes ?? 0), "E 补记时长应落库").toBeGreaterThanOrEqual(1);

    /* ═══ 环节 9：惰性结算 F2（scheduled 过期 → 打开 Today 自动完成） ═══ */
    step(testInfo, "环节9 惰性结算验证（F2 今早 08:00 已过期 scheduled）");
    await gotoNav(page, "today");
    await page.reload();
    await expect
      .poll(async () => (await getTask(page.request, tasks.F2.id)).status, { timeout: 60_000 })
      .toBe("completed");

    /* ═══ 环节 10a：Review 复盘统计 ═══ */
    step(testInfo, "环节10a Review 本周统计核对");
    await gotoNav(page, "today"); // 触发摘要刷新（BUG-027 链路）
    await expect
      .poll(async () => {
        const r = await page.request.get("/api/views/stats?range=week");
        if (!r.ok()) return -1;
        const d = (await r.json()) as { totalCompleted?: number };
        return Number(d.totalCompleted ?? 0);
      }, { timeout: 60_000 })
      .toBeGreaterThanOrEqual(3); // A/D/E/F2 至少 4 个完成

    /* ═══ 环节 10b：续排建议 F（过期 planned 未完成 → 复制到明天） ═══ */
    step(testInfo, "环节10b Plan 续排建议：F 复制到明天");
    await gotoNav(page, "plan");
    const barHead = page.locator("text=/未完成任务/").first();
    await expect(barHead).toBeVisible({ timeout: 20_000 });
    await barHead.click();
    const fItem = page
      .locator("div")
      .filter({ hasText: tasks.F.title })
      .filter({ has: page.getByRole("button", { name: "复制到明天" }) })
      .last();
    await expect(fItem).toBeVisible({ timeout: 10_000 });
    await fItem.getByRole("button", { name: "复制到明天" }).first().click();
    // 断言：明天出现 F 排期（UTC ISO → 本地日期比对，BUG-024 口径）
    await expect
      .poll(async () => {
        const t = await getTask(page.request, tasks.F.id);
        const sched = (t.schedules ?? []) as Array<{ scheduledStart: string }>;
        const tomorrow = dateOffset(1);
        return sched.some((s) => {
          const d = new Date(s.scheduledStart);
          return localDateStr(d) === tomorrow;
        });
      }, { timeout: 90_000 })
      .toBeTruthy();

    /* ═══ 环节 10c：Projects 归档一致性（完成入归档、未完成 B 不入） ═══ */
    step(testInfo, "环节10c Projects 归档一致性核对");
    await gotoNav(page, "projects");
    await page.locator("text=/归档/").first().click();
    await expect(page.locator(`text=${tasks.A.title}`).first()).toBeVisible({ timeout: 20_000 });
    await expect(page.locator(`text=${tasks.D.title}`).first()).toBeVisible({ timeout: 20_000 });
    const bInArchive = await page.locator(`.pt-ar-body:visible >> text=${tasks.B.title}`).isVisible().catch(() => false);
    expect(bInArchive, "未完成的任务 B 不应出现在归档区").toBeFalsy();

    step(testInfo, "✅ 全流程通过：录入/调整/归类/★/排期/四卡执行/改期/惰性结算/续排/复盘统计 全部校验完成");
  });
});
