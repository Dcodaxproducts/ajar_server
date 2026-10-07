type TranslationEntry = {
  locale?: string;
  translations?: Record<string, unknown>;
};

type LocalizableRecord = Record<string, unknown> & {
  _id?: unknown;
  languages?: TranslationEntry[];
};

const asRecord = (value: unknown): Record<string, unknown> | undefined =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;

export const translationFor = (
  value: LocalizableRecord | null | undefined,
  locale: string
): Record<string, unknown> => {
  if (locale === "en" || !Array.isArray(value?.languages)) return {};

  return (
    value.languages.find(
      (entry) => entry.locale?.toLowerCase() === locale.toLowerCase()
    )?.translations || {}
  );
};

const translatedString = (
  translation: Record<string, unknown>,
  key: string,
  fallback: unknown
): unknown => {
  const value = translation[key];
  return typeof value === "string" && value.trim() ? value : fallback;
};

const localizeNamedItems = (
  items: unknown,
  translatedItems: unknown
): unknown => {
  if (!Array.isArray(items)) return items;

  return items.map((item, index) => {
    if (typeof item === "string") {
      if (Array.isArray(translatedItems)) {
        const translated = translatedItems[index];
        if (typeof translated === "string" && translated.trim()) return translated;
        const translatedRecord = asRecord(translated);
        return translatedRecord?.label || translatedRecord?.name || item;
      }
      return asRecord(translatedItems)?.[item] || item;
    }

    const itemRecord = asRecord(item);
    if (!itemRecord) return item;
    const key = String(itemRecord.value || itemRecord.name || itemRecord._id || index);
    const candidate = Array.isArray(translatedItems)
      ? translatedItems.find((entry) => {
          const record = asRecord(entry);
          return record && String(record.value || record.name || record._id) === key;
        }) || translatedItems[index]
      : asRecord(translatedItems)?.[key];
    const translatedRecord = asRecord(candidate);

    return translatedRecord
      ? {
          ...itemRecord,
          name: translatedRecord.name || translatedRecord.label || itemRecord.name,
          label: translatedRecord.label || translatedRecord.name || itemRecord.label,
        }
      : item;
  });
};

export const localizeField = (
  field: LocalizableRecord,
  locale: string
): LocalizableRecord => {
  const translation = translationFor(field, locale);
  const validation = asRecord(field.validation);
  const translatedValidation = asRecord(translation.validation);
  const translatedValidationError =
    translatedValidation?.error || translation.validationError;
  const conditional = asRecord(field.conditional);
  const dependsOn = asRecord(conditional?.dependsOn);

  return {
    ...field,
    name: translatedString(translation, "name", field.name),
    label: translatedString(translation, "label", field.label),
    placeholder: translatedString(translation, "placeholder", field.placeholder),
    tooltip: translatedString(translation, "tooltip", field.tooltip),
    options: localizeNamedItems(field.options, translation.options),
    documentConfig: localizeNamedItems(
      field.documentConfig,
      translation.documentConfig
    ),
    validation: validation
      ? {
          ...validation,
          error:
            (typeof translatedValidationError === "string" &&
              translatedValidationError.trim()
              ? translatedValidationError
              : validation.error) || undefined,
        }
      : field.validation,
    conditional: conditional
      ? {
          ...conditional,
          dependsOn: dependsOn ? localizeField(dependsOn, locale) : conditional.dependsOn,
        }
      : field.conditional,
  };
};

export const localizeNamedRecord = <T extends LocalizableRecord>(
  value: T | null | undefined,
  locale: string
): T | null => {
  if (!value) return null;
  const translation = translationFor(value, locale);
  const localized = {
    ...value,
    name: translatedString(translation, "name", value.name),
    description: translatedString(
      translation,
      "description",
      value.description
    ),
  } as T;

  const category = asRecord(value.category) as T | undefined;
  if (category) {
    (localized as LocalizableRecord).category = localizeNamedRecord(category, locale);
  }
  return localized;
};

export const preserveCanonicalFieldOrder = <T extends { _id?: unknown }>(
  canonicalIds: unknown[],
  populatedFields: T[]
): T[] => {
  const byId = new Map(
    populatedFields.map((field) => [String(field._id), field] as const)
  );
  return canonicalIds
    .map((id) => byId.get(String(id)))
    .filter((field): field is T => Boolean(field));
};

export const localizeDropdownValue = <T extends LocalizableRecord>(
  value: T,
  locale: string,
  dropdownTranslation?: Record<string, unknown>
): T => {
  const ownTranslation = translationFor(value, locale);
  const key = String(value.value || value.name || value._id || "");
  const parentCandidate = asRecord(dropdownTranslation?.values)?.[key];
  const parentRecord = asRecord(parentCandidate);
  const name =
    translatedString(ownTranslation, "name", undefined) ||
    parentRecord?.name ||
    parentRecord?.label ||
    value.name;
  return { ...value, name } as T;
};

