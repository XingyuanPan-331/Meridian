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
   Topbar — 顶栏导航（可选形态 B）
   · 网格三栏：Brand 左 / Tab 严格居中 / 设置+用户右
   · 四 Tab 组整体居中于屏幕正中（grid 1fr auto 1fr）
   ═══════════════════════════════════════════ */

interface TopbarProps {
  userName: string;
}

export function Topbar({ userName }: TopbarProps) {
  const pathname = usePathname();
  const [lang, setLang] = useState<NavLang>("zh");

  useEffect(() => {
    setLang(getNavLang());
    return listenNavLang(setLang);
  }, []);

  return (
    <header className="h-14 shrink-0 bg-[var(--page-sidebar)] text-[var(--page-sidebar-text)] grid grid-cols-[1fr_auto_1fr] items-center px-5 gap-4">
      {/* Brand（左）· Meridian · C 方案 Logo */}
      <div className="flex items-center gap-3">
        <div className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0" style={{ background: "var(--color-grad-brand)" }}>
          <MeridianLogo size={15} />
        </div>
        <h1 className="text-base font-bold tracking-tight hidden md:inline">Meridian</h1>
        {/* V3：全局搜索 */}
        <div className="w-[220px] lg:w-[260px]">
          <GlobalSearch />
        </div>
      </div>

      {/* 五页面 Tab（严格居中 · 中英切换） */}
      <nav className="flex items-center gap-1">
        {NAV_ITEMS.map(({ href, labelZh, labelEn, Icon, isDefault }) => {
          const active = isActiveNav(pathname, href);
          const label = lang === "zh" ? labelZh : labelEn;
          return (
            <Link key={href} href={href}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm transition-all duration-150 ${
                active
                  ? "bg-brand-600 text-white font-medium sh-glow"
                  : "text-[var(--page-sidebar-text)]/60 hover:bg-white/6 hover:text-[var(--page-sidebar-text)]"
              }`}>
              <span className="shrink-0" style={{ width: 18, height: 18 }}>
                <Icon size={18} className={active ? "text-brand-200" : "text-[var(--page-sidebar-text)]/45"} />
              </span>
              <span className="leading-none">{label}</span>
              {isDefault && !active && <span className="text-xs px-1.5 py-px rounded bg-white/12 text-[var(--page-sidebar-text)]/60">{lang === "zh" ? "默认" : "Default"}</span>}
            </Link>
          );
        })}
      </nav>

      {/* 设置 + 用户（右，占位对称） */}
      <div className="flex items-center gap-3 justify-end">
        <Link href="/settings" title="设置"
          className={`p-2 rounded-lg transition ${pathname === "/settings" ? "bg-brand-600 text-white" : "text-[var(--page-sidebar-text)]/45 hover:bg-white/6 hover:text-[var(--page-sidebar-text)]"}`}>
          <SettingsIcon size={18} />
        </Link>
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-full bg-brand-500 flex items-center justify-center text-sm font-medium shrink-0">
            {userName.charAt(0).toUpperCase()}
          </div>
          <span className="text-sm hidden xl:inline">{userName}</span>
          <button onClick={() => signOut({ callbackUrl: "/login" })} className="text-[var(--page-sidebar-text)]/45 hover:text-[var(--page-sidebar-text)]/80 transition p-1" title="退出登录">
            <LogOutIcon size={15} />
          </button>
        </div>
      </div>
    </header>
  );
}
