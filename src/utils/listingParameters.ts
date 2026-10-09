import { localizeField, preserveCanonicalFieldOrder } from "./formLocalization";

type ListingDocument = { name?: unknown; fileUrl?: unknown };
type ListingRecord = Record<string, unknown> & { documents?: ListingDocument[] };
type FieldRecord = Record<string, unknown> & { _id?: unknown };

export type ListingParameter = {
  key: string;
  label: string;
  type: string;
  value: unknown;
  order: number;
  isMultiple: boolean;
  options?: unknown[];
  optionItems?: Array<{ value: unknown; label: string }>;
  displayValue?: unknown;
};

const toCamelCase = (value: string): string =>
  value
    .replace(/([-_][a-z])/gi, (match) =>
      match.toUpperCase().replace("-", "").replace("_", "")
    )
    .replace(/^[A-Z]/, (match) => match.toLowerCase());

const parseStructuredValue = (value: unknown): unknown => {
  if (typeof value !== "string") return value;
  const trimmed = value.trim();
  if (!trimmed.startsWith("[") && !trimmed.startsWith("{")) return value;
  try {
    return JSON.parse(trimmed);
  } catch {
    return value;
  }
};

const normalizeValue = (type: string, isMultiple: boolean, value: unknown): unknown => {
  const parsed = parseStructuredValue(value);
  if (isMultiple && !Array.isArray(parsed)) return [parsed];
  if (type === "number" || type === "range") {
    if (typeof parsed === "number") return parsed;
    const numeric = typeof parsed === "string" ? Number(parsed) : Number.NaN;
    return Number.isNaN(numeric) ? parsed : numeric;
  }
  if (["boolean", "checkbox"].includes(type) && typeof parsed === "string") {
    if (["yes", "true", "1"].includes(parsed.toLowerCase())) return true;
    if (["no", "false", "0"].includes(parsed.toLowerCase())) return false;
  }
  return parsed;
};

const displayLabel = (value: unknown): string | undefined => {
  if (typeof value === "string" && value.trim()) return value;
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  for (const key of ["label", "name"]) {
    if (typeof record[key] === "string" && record[key].trim()) return record[key];
  }
  return undefined;
};

const optionItemsFor = (
  rawOptions: unknown,
  localizedOptions: unknown
): Array<{ value: unknown; label: string }> | undefined => {
  if (!Array.isArray(rawOptions)) return undefined;
  const localized = Array.isArray(localizedOptions) ? localizedOptions : [];
  return rawOptions.map((value, index) => ({
    value,
    label: displayLabel(localized[index]) || displayLabel(value) || String(value),
  }));
};

const optionDisplayValue = (
  value: unknown,
  optionItems: Array<{ value: unknown; label: string }> | undefined
): unknown => {
  if (!optionItems) return value;
  if (Array.isArray(value)) {
    return value.map((item) => optionDisplayValue(item, optionItems));
  }
  const match = optionItems.find((item) => String(item.value) === String(value));
  return match?.label || value;
};

const locationAddress = (value: unknown): string | undefined => {
  const parsed = parseStructuredValue(value);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return undefined;
  const record = parsed as Record<string, unknown>;
  if (record.location !== undefined) {
    const nested = locationAddress(record.location);
    if (nested) return nested;
  }
  for (const key of ["address", "formattedAddress", "name", "label"]) {
    if (typeof record[key] === "string" && record[key].trim()) return record[key];
  }
  return undefined;
};

const persistedLocationLabel = (
  listing: ListingRecord,
  key: string,
  value: unknown
): string | undefined => {
  const structuredAddress = locationAddress(value);
  if (structuredAddress) return structuredAddress;
  const baseKey = key.replace(/(Location|PlaceId|Place|Id)$/i, "");
  const candidateKeys = new Set([
    `${key}Address`,
    `${key}Label`,
    `${baseKey}Address`,
    `${baseKey}Label`,
    ...(key.toLowerCase() === "location" ? ["address"] : []),
  ]);
  for (const candidateKey of candidateKeys) {
    const candidate = listing[candidateKey];
    if (typeof candidate === "string" && candidate.trim()) return candidate;
    const nested = locationAddress(candidate);
    if (nested) return nested;
  }
  return undefined;
};

export const hiddenListingParameterKeys = (fields: FieldRecord[]): string[] =>
  fields
    .filter((field) => field.visible === false && field.isFixed !== true)
    .map((field) => (typeof field.name === "string" ? toCamelCase(field.name) : ""))
    .filter(Boolean);

export const buildListingParameters = (
  listing: ListingRecord,
  canonicalFieldIds: unknown[],
  populatedFields: FieldRecord[],
  locale: string
): ListingParameter[] =>
  preserveCanonicalFieldOrder(canonicalFieldIds, populatedFields).flatMap((field, index) => {
    if (field.visible === false || field.isFixed === true) return [];
    const originalName = typeof field.name === "string" ? field.name : "";
    if (!originalName) return [];
    const key = toCamelCase(originalName);
    const type = typeof field.type === "string" ? field.type.toLowerCase() : "text";
    const isFile = ["file", "document", "image", "images"].includes(type);
    const matchingFiles = isFile
      ? (listing.documents || [])
          .filter((document) => [originalName, key].includes(String(document.name || "")))
          .map((document) => document.fileUrl)
          .filter((fileUrl): fileUrl is string => typeof fileUrl === "string")
      : [];
    const hasStoredValue = Object.prototype.hasOwnProperty.call(listing, key);
    if (!hasStoredValue && matchingFiles.length === 0) return [];

    const localized = localizeField(field, locale);
    const label =
      typeof localized.label === "string" && localized.label.trim()
        ? localized.label
        : originalName;
    const options = Array.isArray(localized.options) ? localized.options : undefined;
    const optionItems = optionItemsFor(field.options, localized.options);
    const isMultiple = field.isMultiple === true || type === "images";
    const value =
      isFile && matchingFiles.length > 0
        ? matchingFiles
        : normalizeValue(type, isMultiple, listing[key]);
    const displayValue =
      type === "location"
        ? persistedLocationLabel(listing, key, value)
        : type === "select"
          ? optionDisplayValue(value, optionItems)
          : undefined;

    return [{
      key,
      label,
      type,
      value,
      order: typeof field.order === "number" ? field.order : index,
      isMultiple,
      ...(options ? { options } : {}),
      ...(optionItems ? { optionItems } : {}),
      ...(displayValue !== undefined ? { displayValue } : {}),
    }];
  });
