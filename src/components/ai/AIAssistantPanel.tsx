"use client";

import { type ReactNode } from "react";

/* ═══════════════════════════════════════════
   AIAssistantPanel — Task OS Design System
   统一的 AI 助手面板容器
   ═══════════════════════════════════════════ */

interface AIAssistantPanelProps {
  /** 面板标题 */
  title?: string;
  /** 状态指示：idle | thinking | done | error */
  status?: "idle" | "thinking" | "done" | "error";
  /** 面板内容 */
  children: ReactNode;
  /** 底部操作区 */
  footer?: ReactNode;
  /** 关闭回调 */
  onClose?: () => void;
  className?: string;
}

const statusConfig: Record<string, { label: string; dot: string }> = {
  idle:     { label: "待命",   dot: "bg-[var(--sem-status-notstarted)]" },
  thinking: { label: "思考中", dot: "bg-ai-600 animate-pulse" },
  done:     { label: "已完成", dot: "bg-[var(--sem-status-completed)]" },
  error:    { label: "出错了", dot: "bg-red-400" },
};

export function AIAssistantPanel({
  title = "AI 助手",
  status = "idle",
  children,
  footer,
  onClose,
  className = "",
}: AIAssistantPanelProps) {
  const s = statusConfig[status];
  return (
    <div className={`bg-[var(--v2-card)] rounded-2xl border border-[var(--page-border)] sh-card flex flex-col overflow-hidden ${className}`}>
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-3 border-b border-gray-50">
        <div className="flex items-center gap-2.5">
          <span className="text-base">🤖</span>
          <span className="text-sm font-semibold text-gray-800">{title}</span>
          <span className={`w-1.5 h-1.5 rounded-full ${s.dot}`} />
          <span className="text-sm text-gray-400">{s.label}</span>
        </div>
        {onClose && (
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-sm">✕</button>
        )}
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto px-5 py-4 space-y-3">
        {children}
      </div>

      {/* Footer */}
      {footer && (
        <div className="border-t border-gray-50 px-5 py-3 flex items-center gap-2">
          {footer}
        </div>
      )}
    </div>
  );
}
