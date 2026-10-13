type ZoneTranslation = {
  locale?: unknown;
  translations?: { name?: unknown; adminNotes?: unknown };
};

type ZoneRecord = Record<string, unknown> & {
  languages?: unknown;
  toObject?: () => Record<string, unknown>;
};

const translatedText = (value: unknown): string | undefined =>
  typeof value === "string" && value.trim() ? value : undefined;

export const localizeZoneForResponse = (value: unknown, locale: string): Record<string, unknown> => {
  const zone = value as ZoneRecord;
  const localized = typeof zone.toObject === "function" ? zone.toObject() : { ...zone };
  const languages = Array.isArray(zone.languages) ? zone.languages as ZoneTranslation[] : [];
  const match = languages.find((language) => language.locale === locale);
  const translatedName = translatedText(match?.translations?.name);
  const translatedNotes = translatedText(match?.translations?.adminNotes);

  if (translatedName) localized.name = translatedName;
  if (translatedNotes) localized.adminNotes = translatedNotes;
  delete localized.languages;
  return localized;
};
