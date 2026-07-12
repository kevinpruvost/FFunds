// Astro-side i18n: lightweight, no React.
// Elements with data-i18n="key" get textContent set to the translation.
// Elements with data-i18n-html="key" get innerHTML set.
// The toggle button (id="lang-toggle") swaps between fr and en.
// Language persists in localStorage "ffunds:lang".

import { DEFAULT_LANG, LANG_LS_KEY, TRANSLATIONS, type Lang } from "./translations";

export { TRANSLATIONS, DEFAULT_LANG, LANG_LS_KEY };

export function readLang(): Lang {
  if (typeof localStorage === "undefined") return DEFAULT_LANG;
  try {
    const v = localStorage.getItem(LANG_LS_KEY);
    if (v === "fr" || v === "en") return v;
  } catch {}
  return DEFAULT_LANG;
}

function applyLang(lang: Lang) {
  const dict = TRANSLATIONS[lang];
  document.documentElement.lang = lang;

  document.querySelectorAll<HTMLElement>("[data-i18n]").forEach((el) => {
    const key = el.dataset.i18n;
    if (key && key in dict) el.textContent = dict[key];
  });
  document.querySelectorAll<HTMLElement>("[data-i18n-html]").forEach((el) => {
    const key = el.dataset.i18nHtml;
    if (key && key in dict) el.innerHTML = dict[key];
  });

  const toggleLabel = document.getElementById("lang-toggle-label");
  const toggleFlag = document.getElementById("lang-toggle-flag");
  const toggle = document.getElementById("lang-toggle");
  if (toggleLabel) toggleLabel.textContent = lang === "fr" ? "EN" : "FR";
  if (toggleFlag) toggleFlag.textContent = lang === "fr" ? "🇫🇷" : "🇬🇧";
  if (toggle) toggle.setAttribute("aria-label", lang === "fr" ? "Switch to English" : "Passer au français");
}

export function initI18n() {
  const lang = readLang();
  applyLang(lang);

  const toggle = document.getElementById("lang-toggle");
  if (toggle) {
    toggle.addEventListener("click", () => {
      const current = readLang();
      const next: Lang = current === "fr" ? "en" : "fr";
      try { localStorage.setItem(LANG_LS_KEY, next); } catch {}
      applyLang(next);
      // Notify React components (if any) of the change
      window.dispatchEvent(new CustomEvent("ffunds:lang-change", { detail: next }));
    });
  }
}