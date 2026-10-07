import { Request } from "express";
import { DEFAULT_LOCALE, SUPPORTED_LOCALES } from "../config/i18n";

type LocaleRequest = Pick<Request, "headers" | "query"> & {
  language?: string;
};

const firstHeaderValue = (value: string | string[] | undefined): string | undefined =>
  Array.isArray(value) ? value[0] : value;

export const normalizeLocale = (value: unknown): string => {
  const candidate = String(value || "")
    .trim()
    .toLowerCase()
    .split(/[,_-]/)[0];

  return (SUPPORTED_LOCALES as readonly string[]).includes(candidate)
    ? candidate
    : DEFAULT_LOCALE;
};

export const resolveRequestLocale = (req: LocaleRequest): string =>
  normalizeLocale(
    firstHeaderValue(req.headers.localization as string | string[] | undefined) ||
      firstHeaderValue(req.headers.language as string | string[] | undefined) ||
      req.query.language ||
      req.query.locale ||
      req.language
  );
