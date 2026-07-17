import Link from "next/link";
import { ListRestart } from "lucide-react";
import { DesktopSettings } from "@/components/DesktopSettings";

export default function SettingsPage() {
  return <><header className="page-header"><div><div className="section-kicker">桌面应用</div><h1 className="page-title">设置</h1></div><Link className="desktop-secondary-button" href="/onboarding"><ListRestart size={15} />重新打开设置向导</Link></header><DesktopSettings /></>;
}
