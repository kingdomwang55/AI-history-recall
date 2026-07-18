"use client";

import { createContext, useContext, useEffect, useMemo, useState } from "react";
import {
  defaultLanguage,
  normalizeLanguage,
  translate,
  type Language,
  type TranslationKey
} from "@/lib/i18n";
import { withApiToken } from "@/lib/client-api";

interface LanguageContextValue {
  language: Language;
  setLanguage: (language: Language) => void;
  t: (key: TranslationKey) => string;
}

const languageStorageKey = "aihr:language";
const LanguageContext = createContext<LanguageContextValue | null>(null);

export function LanguageProvider({ children }: { children: React.ReactNode }) {
  const [language, setLanguageState] = useState<Language>(() => {
    if (typeof window === "undefined") return defaultLanguage;
    return normalizeLanguage(window.localStorage.getItem(languageStorageKey));
  });

  useEffect(() => {
    document.documentElement.lang = language;
  }, [language]);

  useEffect(() => {
    const stored = normalizeLanguage(window.localStorage.getItem(languageStorageKey));

    fetch("/api/desktop/status", { cache: "no-store", headers: withApiToken() })
      .then((response) => (response.ok ? response.json() : null))
      .then((status) => {
        const nextLanguage = normalizeLanguage(status?.settings?.language ?? stored);
        setLanguageState(nextLanguage);
        window.localStorage.setItem(languageStorageKey, nextLanguage);
        document.documentElement.lang = nextLanguage;
      })
      .catch(() => undefined);
  }, []);

  const setLanguage = (nextLanguage: Language) => {
    setLanguageState(nextLanguage);
    window.localStorage.setItem(languageStorageKey, nextLanguage);
    document.documentElement.lang = nextLanguage;
  };

  const value = useMemo(
    () => ({
      language,
      setLanguage,
      t: (key: TranslationKey) => translate(language, key)
    }),
    [language]
  );

  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>;
}

export function useLanguage() {
  const context = useContext(LanguageContext);
  if (!context) throw new Error("useLanguage must be used within LanguageProvider");
  return context;
}
