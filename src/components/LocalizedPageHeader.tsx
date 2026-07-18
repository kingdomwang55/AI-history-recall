"use client";

import Link from "next/link";
import { ListRestart, Settings } from "lucide-react";
import { useLanguage } from "@/components/LanguageProvider";
import type { TranslationKey } from "@/lib/i18n";

const actionIcons = {
  restart: ListRestart,
  settings: Settings
};

interface LocalizedPageHeaderProps {
  titleKey: TranslationKey;
  descriptionKey?: TranslationKey;
  kickerKey?: TranslationKey;
  action?: {
    href: string;
    labelKey: TranslationKey;
    icon: keyof typeof actionIcons;
  };
}

export function LocalizedPageHeader({
  titleKey,
  descriptionKey,
  kickerKey,
  action
}: LocalizedPageHeaderProps) {
  const { t } = useLanguage();
  const ActionIcon = action ? actionIcons[action.icon] : null;

  return (
    <header className="page-header">
      <div>
        {kickerKey ? <div className="section-kicker">{t(kickerKey)}</div> : null}
        <h1 className="page-title">{t(titleKey)}</h1>
        {descriptionKey ? <p className="page-description">{t(descriptionKey)}</p> : null}
      </div>
      {action && ActionIcon ? (
        <Link className="desktop-secondary-button" href={action.href}>
          <ActionIcon size={15} />
          {t(action.labelKey)}
        </Link>
      ) : null}
    </header>
  );
}
