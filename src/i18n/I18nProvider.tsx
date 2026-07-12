"use client";

import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { DEFAULT_LANG, LANG_LS_KEY, TRANSLATIONS, type Lang } from "./translations";

export interface I18nContextValue {
  lang: Lang;
  setLang: (lang: Lang) => void;
  t: (key: string, params?: Record<string, string | number>) => string;
}

const I18nContext = createContext<I18nContextValue | null>(null);

function detectInitialLang(): Lang {
  if (typeof document === "undefined") return DEFAULT_LANG;
  try {
    const stored = localStorage.getItem(LANG_LS_KEY);
    if (stored === "fr" || stored === "en") return stored;
  } catch {}
  return DEFAULT_LANG;
}

export function I18nProvider({ children }: { children: React.ReactNode }) {
  const [lang, setLangState] = useState<Lang>(detectInitialLang);

  const setLang = useCallback((next: Lang) => {
    setLangState(next);
    try {
      localStorage.setItem(LANG_LS_KEY, next);
    } catch {}
  }, []);

  // Sync with the Astro-side toggle button (sidebar lang-toggle).
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<Lang>).detail;
      if (detail === "fr" || detail === "en") setLangState(detail);
    };
    window.addEventListener("ffunds:lang-change", handler);
    return () => window.removeEventListener("ffunds:lang-change", handler);
  }, []);

  useEffect(() => {
    document.documentElement.lang = lang;
  }, [lang]);

  const t = useCallback(
    (key: string, params?: Record<string, string | number>) => {
      const dict = TRANSLATIONS[lang];
      let s = dict[key] ?? key;
      if (params) {
        for (const [k, v] of Object.entries(params)) {
          s = s.replaceAll(`{${k}}`, String(v));
        }
      }
      return s;
    },
    [lang],
  );

  const value = useMemo(() => ({ lang, setLang, t }), [lang, setLang, t]);
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nContextValue {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error("useI18n must be used within an I18nProvider");
  return ctx;
}

/* Convenience hook returning just the `t` function. */
export function useT() {
  return useI18n().t;
}