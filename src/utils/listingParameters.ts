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
    const isMultiple = field.isMultiple === true || type === "images";
    const value =
      isFile && matchingFiles.length > 0
        ? matchingFiles
        : normalizeValue(type, isMultiple, listing[key]);

    return [{
      key,
      label,
      type,
      value,
      order: typeof field.order === "number" ? field.order : index,
      isMultiple,
      ...(options ? { options } : {}),
    }];
  });
