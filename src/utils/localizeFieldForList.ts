type Translation = {
  locale?: string;
  translations?: { name?: string; label?: string; placeholder?: string };
};

type LocalizableField = {
  name?: string;
  label?: string;
  placeholder?: string;
  languages?: Translation[];
  toObject?: () => Record<string, unknown>;
};

type LocalizedField = Record<string, unknown> & {
  name?: unknown;
  label?: unknown;
  placeholder?: unknown;
  languages?: unknown;
};

/** Locale changes presentation only. Missing translations fall back to base text. */
export const localizeFieldForList = <T extends LocalizableField>(field: T, locale: string | null): LocalizedField => {
  const value: LocalizedField = field.toObject ? field.toObject() : { ...field };
  if (!locale) return value;

  const languages = Array.isArray(value.languages)
    ? (value.languages as Translation[])
    : [];
  const translated = languages.find((item) => item.locale === locale)?.translations;

  return {
    ...value,
    name: translated?.name || value.name,
    label: translated?.label || value.label,
    placeholder: translated?.placeholder || value.placeholder,
    languages: undefined,
  };
};
