"use client";

import { useState, useRef, useEffect } from "react";
import { useTheme, BRAND_LIST, AI_LIST, PAGE_LIST, SEM_LIST, type BrandId, type AIId, type PageId, type SemId } from "@/contexts/ThemeContext";

/* ═══════════════════════════════════════════
   ThemeSwitcher V3 — 四轴独立主题选择器
   品牌色 · AI 面板色 · 页面肤色 · 语义色
   ═══════════════════════════════════════════ */

interface ThemeSwitcherProps {
  collapsed?: boolean;
}

type AxisTab = "brand" | "ai" | "page" | "sem";

export function ThemeSwitcher({ collapsed = false }: ThemeSwitcherProps) {
  const { brand, ai, page, semantic, setBrand, setAI, setPage, setSemantic, brandMeta, aiMeta, pageMeta, semMeta } = useTheme();
  const [open, setOpen] = useState(false);
  const [axis, setAxis] = useState<AxisTab>("brand");
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    if (open) document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open]);

  const axisTabs: { key: AxisTab; label: string; meta: typeof brandMeta }[] = [
    { key: "brand", label: "品牌", meta: brandMeta },
    { key: "ai", label: "AI", meta: aiMeta },
    { key: "page", label: "页面", meta: pageMeta },
    { key: "sem", label: "语义", meta: semMeta },
  ];

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(!open)}
        title="切换主题"
        className={`flex items-center rounded-lg text-sm transition-all duration-150 ${
          collapsed ? "justify-center p-2.5" : "gap-3 px-3.5 py-2.5"
        } text-white/60 hover:bg-white/6 hover:text-white`}
      >
        <div className="flex items-center gap-0.5 shrink-0">
          <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: brandMeta.color }} />
          <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: aiMeta.color }} />
        </div>
        {!collapsed && (
          <div className="flex flex-col min-w-0 text-left">
            <span className="leading-tight truncate text-sm">主题</span>
            <span className="text-sm leading-tight text-white/35">
              {semMeta.name} · {brandMeta.name}
            </span>
          </div>
        )}
      </button>

      {open && (
        <div className={`absolute bottom-full left-0 mb-1 bg-[var(--page-sidebar)] border border-white/10 rounded-xl shadow-xl z-50 ${collapsed ? "w-48" : "w-56"}`}>
          {/* Axis tabs */}
          <div className="flex border-b border-white/10">
            {axisTabs.map(t => (
              <button
                key={t.key}
                onClick={() => setAxis(t.key)}
                className={`flex-1 text-sm py-2 text-center transition ${
                  axis === t.key ? "text-white font-medium" : "text-white/40 hover:text-white/70"
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>

          {/* Color grid */}
          <div className="p-2">
            {axis === "brand" && (
              <div className="grid grid-cols-4 gap-1.5">
                {BRAND_LIST.map(t => (
                  <button
                    key={t.id}
                    onClick={() => { setBrand(t.id as BrandId); }}
                    title={t.name}
                    className={`w-full aspect-square rounded-lg border-2 transition-all flex items-center justify-center ${
                      brand === t.id ? "border-white scale-110" : "border-transparent hover:scale-105"
                    }`}
                    style={{ backgroundColor: t.color }}
                  >
                    {brand === t.id && (
                      <svg className="w-3.5 h-3.5 text-white drop-shadow" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                      </svg>
                    )}
                  </button>
                ))}
              </div>
            )}

            {axis === "ai" && (
              <div className="grid grid-cols-4 gap-1.5">
                {AI_LIST.map(t => (
                  <button
                    key={t.id}
                    onClick={() => { setAI(t.id as AIId); }}
                    title={t.name}
                    className={`w-full aspect-square rounded-lg border-2 transition-all flex items-center justify-center ${
                      ai === t.id ? "border-white scale-110" : "border-transparent hover:scale-105"
                    }`}
                    style={{ backgroundColor: t.color }}
                  >
                    {ai === t.id && (
                      <svg className="w-3.5 h-3.5 text-white drop-shadow" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                      </svg>
                    )}
                  </button>
                ))}
              </div>
            )}

            {axis === "page" && (
              <div className="space-y-1.5">
                {PAGE_LIST.map(t => (
                  <button
                    key={t.id}
                    onClick={() => { setPage(t.id as PageId); }}
                    className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm transition ${
                      page === t.id ? "bg-white/10 text-white" : "text-white/50 hover:bg-white/5 hover:text-white/80"
                    }`}
                  >
                    <span className="w-5 h-5 rounded-md border border-white/20 shrink-0" style={{ backgroundColor: t.color }} />
                    <span>{t.name}</span>
                    {page === t.id && (
                      <svg className="w-3.5 h-3.5 ml-auto text-brand-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                      </svg>
                    )}
                  </button>
                ))}
              </div>
            )}

            {axis === "sem" && (
              <div className="space-y-1.5">
                {SEM_LIST.map(t => (
                  <button
                    key={t.id}
                    onClick={() => { setSemantic(t.id as SemId); }}
                    className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm transition ${
                      semantic === t.id ? "bg-white/10 text-white" : "text-white/50 hover:bg-white/5 hover:text-white/80"
                    }`}
                  >
                    <span className="w-5 h-5 rounded-md border border-white/20 shrink-0" style={{ backgroundColor: t.color }} />
                    <span>{t.name}</span>
                    {semantic === t.id && (
                      <svg className="w-3.5 h-3.5 ml-auto text-brand-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                      </svg>
                    )}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Current axis label */}
          <div className="px-3 pb-2.5 pt-0.5">
            <p className="text-sm text-white/25">
              {axis === "brand" ? `${brandMeta.name} — 按钮、标签、高亮`
                : axis === "ai" ? `${aiMeta.name} — AI 建议面板`
                : axis === "page" ? `${pageMeta.name} — 页面底色`
                : `${semMeta.name} — 来源、状态、优先级`}
            </p>
          </div>
        </div>
      )}
    </div>
  );
}