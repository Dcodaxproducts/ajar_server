import path from "path";
import i18next from "i18next";
import Backend from "i18next-fs-backend";
import * as i18nextMiddleware from "i18next-http-middleware";

export const SUPPORTED_LOCALES = ["en", "ar"] as const;
export const DEFAULT_LOCALE = "en";

// Namespaces map to the files under src/locales/<locale>/. "common" holds the
// shared responses (not found, unauthorized, …) so modules don't repeat them.
export const NAMESPACES = [
  "common",
  "booking",
  "user",
  "payment",
  "damage",
  "refund",
  "listing",
  "catalog",
  "favourite",
  "chat",
  "twofa",
  "article",
  "support",
  "dropdown",
  "access",
  "contact",
  "setting",
  "faq",
  "notification",
  "reminder",
  "rental",
  "review",
];

export const initI18n = async () => {
  await i18next
    .use(Backend)
    .use(i18nextMiddleware.LanguageDetector)
    .init({
      backend: {
        loadPath: path.join(__dirname, "../locales/{{lng}}/{{ns}}.json"),
      },
      detection: {
        // "language" is what the existing clients already send, so it wins;
        // Accept-Language is the standard fallback for anything newer
        order: ["header"],
        lookupHeader: "language",
        caches: false,
      },
      fallbackLng: DEFAULT_LOCALE,
      supportedLngs: SUPPORTED_LOCALES as unknown as string[],
      preload: SUPPORTED_LOCALES as unknown as string[],
      ns: NAMESPACES,
      defaultNS: "common",
      // A missing Arabic string falls back to English rather than showing the key
      returnEmptyString: false,
      interpolation: { escapeValue: false },
    });

  return i18next;
};

export const i18nMiddleware = i18nextMiddleware.handle(i18next);
