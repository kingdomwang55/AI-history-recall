import { CapturePlanner } from "@/components/CapturePlanner";
import { LocalizedPageHeader } from "@/components/LocalizedPageHeader";

export default function CapturePage() {
  return (
    <div>
      <LocalizedPageHeader
        titleKey="page.capture.title"
        descriptionKey="page.capture.description"
        action={{ href: "/onboarding", labelKey: "page.capture.setup", icon: "settings" }}
      />

      <CapturePlanner />
    </div>
  );
}
