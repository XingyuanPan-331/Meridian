"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { signOut } from "next-auth/react";
import { SettingsIcon, LogOutIcon } from "@/components/ui/icons";
import { GlobalSearch } from "@/components/search/GlobalSearch";
import { NAV_ITEMS, isActiveNav } from "@/lib/navigation";
import { getNavLang, listenNavLang, type NavLang } from "@/lib/ui-preferences";
import MeridianLogo from "@/components/auth/MeridianLogo";

/* ═══════════════════════════════════════════
   Sidebar V2 — 工作流顺序（默认导航形态）
   · ①Inbox → ②Plan → ③Today → ④Review，Today 带「默认」徽章
   · 设置降级：底部工具区（不再与主页面平级）
   · 折叠 240px ↔ 64px 保留
   ═══════════════════════════════════════════ */

interface SidebarProps {
  userName: string;
  collapsed: boolean;
  onToggle: () => void;
}

// 展开=双面板 ┌──┬──────┐  收起=仅左框 ┌──┐
function ToggleIcon({ collapsed }: { collapsed: boolean }) {
  return (
    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
      {collapsed ? (
        <rect x="4" y="5" width="6" height="14" rx="2.5" />
      ) : (
        <>
          <rect x="4" y="5" width="16" height="14" rx="2.5" />
          <line x1="10" y1="7" x2="10" y2="17" />
        </>
      )}
    </svg>
  );
}

export function Sidebar({ userName, collapsed, onToggle }: SidebarProps) {
  const pathname = usePathname();
  const w = collapsed ? "w-16" : "w-64";
  const [lang, setLang] = useState<NavLang>("zh");

  useEffect(() => {
    setLang(getNavLang());
    return listenNavLang(setLang);
  }, []);

  return (
    <aside className={`${w} bg-[var(--page-sidebar)] text-[var(--page-sidebar-text)] flex flex-col h-full shrink-0 transition-all duration-200 hidden lg:flex`}>
      {/* Brand row — 64px 与顶栏统一（Meridian 品牌 · C 方案 Logo） */}
      <div className="flex items-center justify-between p-5 border-b border-white/10 h-16 shrink-0">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0" style={{ background: "var(--color-grad-brand)" }}>
            <MeridianLogo size={18} />
          </div>
          {!collapsed && <h1 className="text-lg font-bold tracking-tight">Meridian</h1>}
        </div>
        <button
          onClick={onToggle}
          className={`text-[var(--page-sidebar-text)]/35 hover:text-[var(--page-sidebar-text)]/60 transition ${collapsed ? "mx-auto" : ""}`}
          title={collapsed ? "展开" : "收起"}
        >
          <ToggleIcon collapsed={collapsed} />
        </button>
      </div>

      {/* V3：全局搜索（侧栏模式） */}
      <div className={`shrink-0 ${collapsed ? "px-2 py-2" : "px-4 py-3 border-b border-white/10"}`}>
        <GlobalSearch compact={collapsed} />
      </div>

      {/* 工作流导航（Today 默认徽章） */}
      <nav className={`flex-1 overflow-y-auto ${collapsed ? "px-2 py-3 space-y-1" : "p-4 space-y-1"}`}>
        {NAV_ITEMS.map(({ href, labelZh, labelEn, subZh, subEn, Icon, isDefault }) => {
          const active = isActiveNav(pathname, href);
          const label = lang === "zh" ? labelZh : labelEn;
          const sub = lang === "zh" ? subZh : subEn;
          return (
            <Link key={href} href={href} title={collapsed ? label : undefined}
              className={`flex items-center rounded-lg text-sm transition-all duration-150 ${
                collapsed ? "justify-center p-2.5" : "gap-3 px-3.5 py-2.5"
              } ${
                active
                  ? "bg-brand-600 text-white font-medium sh-glow"
                  : "text-[var(--page-sidebar-text)]/60 hover:bg-white/6 hover:text-[var(--page-sidebar-text)]"
              }`}>
              <span className="shrink-0" style={{ width: 20, height: 20 }}>
                <Icon size={20} className={active ? "text-brand-200" : "text-[var(--page-sidebar-text)]/45"} />
              </span>
              {!collapsed && (
                <div className="flex flex-col min-w-0">
                  <span className="leading-tight truncate flex items-center gap-1.5">
                    {label}
                    {isDefault && <span className="text-xs px-1.5 py-px rounded bg-white/12 text-brand-200 font-normal">{lang === "zh" ? "默认" : "Default"}</span>}
                  </span>
                  <span className={`text-xs leading-tight ${active ? "text-brand-200" : "text-[var(--page-sidebar-text)]/35"}`}>{sub}</span>
                </div>
              )}
            </Link>
          );
        })}
      </nav>

      {/* 底部工具区：设置（主题切换已移除——品牌定稿 D19 决定不做用户自定义配色） */}
      <div className={`${collapsed ? "px-2" : "px-4"} pb-1 space-y-1`}>
        <Link href="/settings" title="设置"
          className={`flex items-center rounded-lg text-sm transition-all duration-150 ${
            collapsed ? "justify-center p-2.5" : "gap-3 px-3.5 py-2.5"
          } ${
            pathname === "/settings"
              ? "bg-brand-600 text-white sh-glow"
              : "text-[var(--page-sidebar-text)]/60 hover:bg-white/6 hover:text-[var(--page-sidebar-text)]"
          }`}>
          <span className="shrink-0" style={{ width: 20, height: 20 }}>
            <SettingsIcon size={20} className={pathname === "/settings" ? "text-brand-200" : "text-[var(--page-sidebar-text)]/45"} />
          </span>
          {!collapsed && <span className="leading-tight">设置</span>}
        </Link>
      </div>

      {/* User */}
      <div className={`border-t border-white/10 ${collapsed ? "p-2 flex justify-center" : "p-3"}`}>
        {collapsed ? (
          <div className="w-8 h-8 rounded-full bg-brand-500 flex items-center justify-center text-sm font-medium" title={userName}>
            {userName.charAt(0).toUpperCase()}
          </div>
        ) : (
          <div className="flex items-center gap-3 px-3 py-1.5">
            <div className="w-8 h-8 rounded-full bg-brand-500 flex items-center justify-center text-sm font-medium shrink-0">
              {userName.charAt(0).toUpperCase()}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium truncate">{userName}</p>
            </div>
            <button onClick={() => signOut({ callbackUrl: "/login" })} className="text-[var(--page-sidebar-text)]/45 hover:text-[var(--page-sidebar-text)]/80 transition p-1" title="退出登录">
              <LogOutIcon size={16} />
            </button>
          </div>
        )}
      </div>
    </aside>
  );
}
