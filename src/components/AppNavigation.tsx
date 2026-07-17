"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Activity, Bot, Database, Search, Settings, Upload } from "lucide-react";
import { RecallLensLogo } from "@/components/RecallLensLogo";

const navItems = [
  { href: "/", label: "首页", icon: Database },
  { href: "/capture", label: "采集", icon: Bot },
  { href: "/search", label: "搜索", icon: Search },
  { href: "/import", label: "导入", icon: Upload },
  { href: "/health", label: "健康", icon: Activity },
  { href: "/settings", label: "设置", icon: Settings }
];

function isActive(pathname: string, href: string) {
  if (href === "/") return pathname === href;
  return pathname.startsWith(href) || (href === "/search" && pathname.startsWith("/conversations/"));
}

export function AppNavigation() {
  const pathname = usePathname();
  const isSearchPage = pathname === "/search";

  return (
    <>
      <aside className="app-sidebar">
        <Link href="/" className="app-brand" aria-label="AI History Recall 首页">
          <span className="app-brand-mark"><RecallLensLogo /></span>
          <span>AI History Recall</span>
        </Link>
        <nav className="app-nav" aria-label="主要导航">
          {navItems.map((item) => {
            const Icon = item.icon;
            const active = isActive(pathname, item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                className="app-nav-link"
                data-active={active ? "true" : undefined}
                aria-current={active ? "page" : undefined}
              >
                <Icon size={17} strokeWidth={1.8} />
                <span>{item.label}</span>
              </Link>
            );
          })}
        </nav>
        <div className="app-sidebar-status">
          <span className="status-dot status-dot-success" />
          <div>
            <div className="font-medium text-[var(--foreground)]">本地模式</div>
            <div>数据仅保存在本机</div>
          </div>
        </div>
      </aside>

      <header className="app-topbar">
        <Link href="/" className="app-mobile-brand" aria-label="AI History Recall 首页">
          <RecallLensLogo size={19} />
        </Link>
        {isSearchPage ? (
          <div className="app-topbar-context"><Search size={16} strokeWidth={1.8} /><span>搜索</span></div>
        ) : (
          <form action="/search" className="app-global-search" role="search">
            <Search size={16} strokeWidth={1.8} aria-hidden="true" />
            <input name="q" aria-label="搜索历史对话" placeholder="搜索历史对话" />
          </form>
        )}
        <div className="app-local-status" title="所有数据仅保存在本机">
          <span className="status-dot status-dot-success" />
          <span>本地模式</span>
        </div>
        <nav className="app-mobile-nav" aria-label="移动端导航">
          {navItems.map((item) => {
            const Icon = item.icon;
            const active = isActive(pathname, item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                title={item.label}
                aria-label={item.label}
                aria-current={active ? "page" : undefined}
                data-active={active ? "true" : undefined}
              >
                <Icon size={17} strokeWidth={1.8} />
              </Link>
            );
          })}
        </nav>
      </header>
    </>
  );
}
