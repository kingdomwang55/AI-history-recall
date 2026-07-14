import type { Metadata } from "next";
import Link from "next/link";
import { Archive, Bot, Database, Search, Upload } from "lucide-react";
import "./globals.css";

export const metadata: Metadata = {
  title: "AI History Recall",
  description: "Local-first AI conversation recall tool"
};

const navItems = [
  { href: "/", label: "首页", icon: Database },
  { href: "/import", label: "导入", icon: Upload },
  { href: "/capture", label: "采集", icon: Bot },
  { href: "/search", label: "搜索", icon: Search }
];

export default function RootLayout({
  children
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN">
      <body>
        <div className="min-h-[100dvh]">
          <header className="border-b border-[var(--line)] bg-[var(--background)]/90 backdrop-blur">
            <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4 sm:px-6">
              <Link href="/" className="flex items-center gap-2 font-semibold">
                <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-[var(--accent)] text-white">
                  <Archive size={18} strokeWidth={1.8} />
                </span>
                <span>AI History Recall</span>
              </Link>
              <nav className="flex items-center gap-1">
                {navItems.map((item) => {
                  const Icon = item.icon;
                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      className="inline-flex items-center gap-2 rounded-lg px-3 py-2 text-sm text-[var(--muted)] transition hover:bg-[var(--surface-subtle)] hover:text-[var(--foreground)]"
                    >
                      <Icon size={16} strokeWidth={1.8} />
                      <span>{item.label}</span>
                    </Link>
                  );
                })}
              </nav>
            </div>
          </header>
          <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:py-10">{children}</main>
        </div>
      </body>
    </html>
  );
}
