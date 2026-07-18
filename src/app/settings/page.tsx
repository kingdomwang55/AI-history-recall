import { DesktopSettings } from "@/components/DesktopSettings";
import { LocalizedPageHeader } from "@/components/LocalizedPageHeader";

export default function SettingsPage() {
  return <>
    <LocalizedPageHeader
      kickerKey="page.settings.kicker"
      titleKey="page.settings.title"
      action={{ href: "/onboarding", labelKey: "page.settings.reopen", icon: "restart" }}
    />
    <DesktopSettings />
  </>;
}
