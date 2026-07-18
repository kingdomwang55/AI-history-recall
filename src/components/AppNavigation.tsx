"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Activity, Bot, Database, Search, Settings, Upload } from "lucide-react";
import { RecallLensLogo } from "@/components/RecallLensLogo";
import { useLanguage } from "@/components/LanguageProvider";
import type { TranslationKey } from "@/lib/i18n";
import { withApiToken } from "@/lib/client-api";

const navItems = [
  { href: "/", labelKey: "nav.home", icon: Database },
  { href: "/capture", labelKey: "nav.capture", icon: Bot },
  { href: "/search", labelKey: "nav.search", icon: Search },
  { href: "/import", labelKey: "nav.import", icon: Upload },
  { href: "/health", labelKey: "nav.health", icon: Activity },
  { href: "/settings", labelKey: "nav.settings", icon: Settings }
].map((item) => ({ ...item, labelKey: item.labelKey as TranslationKey }));

const globalSearchPages = new Set(["/", "/import", "/health", "/settings"]);

function navLabel(pathname: string) {
  return navItems.find((item) => isActive(pathname, item.href))?.labelKey ?? "nav.home";
}

function languageLabel(language: string) {
  return language === "en-US" ? "EN" : "中";
}

function activeNavItem(pathname: string) {
  return navItems.find((item) => isActive(pathname, item.href)) ?? navItems[0];
}

function isActive(pathname: string, href: string) {
  if (href === "/") return pathname === href;
  return pathname.startsWith(href) || (href === "/search" && pathname.startsWith("/conversations/"));
}

export function AppNavigation() {
  const pathname = usePathname();
  const { language, setLanguage, t } = useLanguage();
  const isSearchPage = pathname === "/search";
  const showGlobalSearch = globalSearchPages.has(pathname);
  const contextItem = activeNavItem(pathname);
  const ContextIcon = isSearchPage ? Search : contextItem.icon;
  const contextLabel = t(isSearchPage ? "nav.search" : navLabel(pathname));
  const nextLanguage = language === "en-US" ? "zh-CN" : "en-US";
  const changeLanguage = async () => {
    setLanguage(nextLanguage);
    try {
      const current = await fetch("/api/desktop/status", { cache: "no-store", headers: withApiToken() });
      if (!current.ok) return;
      const status = await current.json();
      await fetch("/api/desktop/status", {
        method: "POST",
        cache: "no-store",
        headers: withApiToken({ "content-type": "application/json" }),
        body: JSON.stringify({ action: "save-settings", settings: { ...status.settings, language: nextLanguage } })
      });
    } catch {
      // Browser-only development sessions can still use the local language preference.
    }
  };

  return (
    <>
      <aside className="app-sidebar">
        <Link href="/" className="app-brand" aria-label={`AI History Recall ${t("nav.home")}`}>
          <span className="app-brand-mark"><RecallLensLogo /></span>
          <span>AI History Recall</span>
        </Link>
        <nav className="app-nav" aria-label={t("nav.main")}>
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
                <span>{t(item.labelKey)}</span>
              </Link>
            );
          })}
        </nav>
        <div className="app-sidebar-status">
          <span className="status-dot status-dot-success" />
          <div>
            <div className="font-medium text-[var(--foreground)]">{t("nav.localMode")}</div>
            <div>{t("nav.localOnly")}</div>
          </div>
        </div>
      </aside>

      <header className="app-topbar">
        <Link href="/" className="app-mobile-brand" aria-label={`AI History Recall ${t("nav.home")}`}>
          <RecallLensLogo size={19} />
        </Link>
        {showGlobalSearch ? (
          <form action="/search" className="app-global-search" role="search">
            <Search size={16} strokeWidth={1.8} aria-hidden="true" />
            <input name="q" aria-label={t("nav.searchAria")} placeholder={t("nav.searchPlaceholder")} />
          </form>
        ) : (
          <div className="app-topbar-context"><ContextIcon size={16} strokeWidth={1.8} /><span>{contextLabel}</span></div>
        )}
        <button
          type="button"
          className="app-language-toggle"
          aria-label={t("nav.language")}
          title={t("nav.language")}
          onClick={() => void changeLanguage()}
        >
          {languageLabel(language)}
        </button>
        <div className="app-local-status" title={t("nav.localOnly")}>
          <span className="status-dot status-dot-success" />
          <span>{t("nav.localMode")}</span>
        </div>
        <nav className="app-mobile-nav" aria-label={t("nav.mobile")}>
          {navItems.map((item) => {
            const Icon = item.icon;
            const active = isActive(pathname, item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                title={t(item.labelKey)}
                aria-label={t(item.labelKey)}
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
