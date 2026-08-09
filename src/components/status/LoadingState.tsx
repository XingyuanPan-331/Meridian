/* ═══════════════════════════════════════════
   LoadingState — Task OS Design System
   统一加载状态（骨架屏）
   ═══════════════════════════════════════════ */

interface LoadingStateProps {
  /** 骨架类型 */
  type?: "card" | "list" | "page";
  count?: number;
  className?: string;
}

function Skeleton({ className = "" }: { className?: string }) {
  return <div className={`animate-pulse bg-gray-100 rounded-lg ${className}`} />;
}

export function LoadingState({ type = "card", count = 3, className = "" }: LoadingStateProps) {
  switch (type) {
    case "card":
      return (
        <div className={`space-y-4 ${className}`}>
          {Array.from({ length: count }).map((_, i) => (
            <div key={i} className="bg-[var(--v2-card)] rounded-2xl border border-[var(--page-border)] sh-card p-5 space-y-3">
              <Skeleton className="h-4 w-1/3" />
              <Skeleton className="h-6 w-2/3" />
              <Skeleton className="h-4 w-1/2" />
            </div>
          ))}
        </div>
      );

    case "list":
      return (
        <div className={`space-y-2 ${className}`}>
          {Array.from({ length: count }).map((_, i) => (
            <div key={i} className="flex items-center gap-3 bg-[var(--v2-card)] rounded-xl border border-[var(--page-border)] sh-card px-4 py-3">
              <Skeleton className="w-5 h-5 rounded-full" />
              <Skeleton className="h-4 flex-1" />
              <Skeleton className="h-3 w-12" />
            </div>
          ))}
        </div>
      );

    case "page":
      return (
        <div className={`space-y-6 ${className}`}>
          <Skeleton className="h-8 w-48" />
          <div className="grid grid-cols-3 gap-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-24 rounded-xl" />
            ))}
          </div>
          <Skeleton className="h-48 rounded-xl" />
        </div>
      );

    default:
      return null;
  }
}
