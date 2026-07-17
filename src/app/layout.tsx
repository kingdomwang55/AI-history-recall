import type { Metadata } from "next";
import { AppNavigation } from "@/components/AppNavigation";
import { KnowledgeHeartbeat } from "@/components/KnowledgeHeartbeat";
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
        <KnowledgeHeartbeat />
        <div className="app-shell">
          <AppNavigation />
          <main className="app-content">{children}</main>
        </div>
      </body>
    </html>
  );
}
