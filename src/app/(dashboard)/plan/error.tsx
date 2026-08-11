"use client";

// 2026-08-11：Plan 页渲染错误兜底——避免"整个页面停掉"白屏（错误显示可刷新提示）
export default function PlanError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="p-8 max-w-[1080px] mx-auto">
      <div className="bg-white border border-[var(--color-danger-border)] rounded-xl p-6">
        <div className="text-[15px] font-semibold text-[var(--color-danger-text)] mb-2">时间轴渲染出错了</div>
        <div className="text-[13px] text-[var(--v2-text2)] mb-4 whitespace-pre-wrap break-all">{error.message || String(error)}</div>
        <button onClick={reset} className="px-4 py-2 text-sm font-medium rounded bg-[var(--v2-brand)] text-white hover:bg-[var(--v2-brand-deep)]">重试</button>
      </div>
    </div>
  );
}
