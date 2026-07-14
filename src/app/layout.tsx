import type { Metadata } from "next";
import { AppNavigation } from "@/components/AppNavigation";
import "./globals.css";

export const metadata: Metadata = {
  title: "AI History Recall",
  description: "Local-first AI conversation recall tool"
};

export default function RootLayout({
  children
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN">
      <body>
        <div className="app-shell">
          <AppNavigation />
          <main className="app-content">{children}</main>
        </div>
      </body>
    </html>
  );
}
