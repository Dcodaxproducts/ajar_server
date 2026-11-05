import { localizeField, preserveCanonicalFieldOrder } from "./formLocalization";

type ListingDocument = { name?: unknown; fileUrl?: unknown };
type FieldRecord = Record<string, unknown> & { _id?: unknown };
type FieldSnapshot = FieldRecord & { fieldId?: unknown; key?: unknown };
type ListingRecord = Record<string, unknown> & {
  documents?: ListingDocument[];
  parameterFieldSnapshot?: FieldSnapshot[];
};

export type ListingParameter = {
  fieldId: string;
  key: string;
  label: string;
  type: string;
  value: unknown;
  submitted: boolean;
  configured: boolean;
  order: number;
  isMultiple: boolean;
  options?: unknown[];
  optionItems?: Array<{ value: unknown; label: string }>;
  displayValue?: unknown;
};

const RESERVED_LISTING_KEYS = new Set([
  "_id", "__v", "leaser", "subCategory", "zone", "ratings", "images",
  "rentalImages", "documents", "isAvailable", "currentBookingId",
  "availabilityVersion", "status", "rejectionNote", "isActive", "language",
  "languages", "createdAt", "updatedAt", "parameters", "parameterFieldSnapshot",
  "userDocuments", "leaserDocuments", "adminFee", "tax", "averageRating",
  "totalReviews", "bookings", "reviews", "approvalStatus", "rentalPolicy",
  "name", "subTitle", "description", "address", "currency", "price", "priceUnit",
  "timezone", "refundNote",
]);

const toCamelCase = (value: string): string =>
  value
    .replace(/([-_][a-z])/gi, (match) =>
      match.toUpperCase().replace("-", "").replace("_", "")
    )
    .replace(/^[A-Z]/, (match) => match.toLowerCase());

const humanizeKey = (value: string): string =>
  value.replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/[-_]+/g, " ").replace(/^./, (character) => character.toUpperCase());

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
  if (value === undefined) return null;
  const parsed = parseStructuredValue(value);
  if (isMultiple && !Array.isArray(parsed)) return parsed == null || parsed === "" ? [] : [parsed];
  if (type === "number" || type === "range") {
    if (typeof parsed === "number") return parsed;
    const numeric = typeof parsed === "string" && parsed.trim() ? Number(parsed) : Number.NaN;
    return Number.isNaN(numeric) ? parsed : numeric;
  }
  if (["boolean", "checkbox"].includes(type) && typeof parsed === "string") {
    if (["yes", "true", "1"].includes(parsed.toLowerCase())) return true;
    if (["no", "false", "0"].includes(parsed.toLowerCase())) return false;
  }
  return parsed;
};

const asRecord = (value: unknown): Record<string, unknown> | undefined =>
  value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;

const optionValue = (value: unknown): unknown => asRecord(value)?.value ?? value;
const displayLabel = (value: unknown): string | undefined => {
  if (typeof value === "string" && value.trim()) return value;
  const record = asRecord(value);
  for (const key of ["label", "name", "value"]) {
    if (typeof record?.[key] === "string" && String(record[key]).trim()) return String(record[key]);
  }
  return undefined;
};

const optionItemsFor = (rawOptions: unknown, localizedOptions: unknown) => {
  if (!Array.isArray(rawOptions)) return undefined;
  const localized = Array.isArray(localizedOptions) ? localizedOptions : [];
  return rawOptions.map((raw, index) => ({
    value: optionValue(raw),
    label: displayLabel(localized[index]) || displayLabel(raw) || String(optionValue(raw)),
  }));
};

const optionDisplayValue = (
  value: unknown,
  optionItems: Array<{ value: unknown; label: string }> | undefined
): unknown => {
  if (!optionItems) return value;
  if (Array.isArray(value)) return value.map((item) => optionDisplayValue(item, optionItems));
  return optionItems.find((item) => String(item.value) === String(value))?.label ?? value;
};

const locationAddress = (value: unknown): string | undefined => {
  const record = asRecord(parseStructuredValue(value));
  if (!record) return undefined;
  const nested = locationAddress(record.location);
  if (nested) return nested;
  for (const key of ["address", "formattedAddress", "name", "label"]) {
    if (typeof record[key] === "string" && String(record[key]).trim()) return String(record[key]);
  }
  return undefined;
};

const persistedLocationLabel = (listing: ListingRecord, key: string, value: unknown) => {
  const structuredAddress = locationAddress(value);
  if (structuredAddress) return structuredAddress;
  const baseKey = key.replace(/(Location|PlaceId|Place|Id)$/i, "");
  const candidateKeys = new Set([
    `${key}Address`, `${key}Label`, `${baseKey}Address`, `${baseKey}Label`,
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

export const snapshotListingFields = (fields: FieldRecord[]): FieldSnapshot[] =>
  fields.map((field, index) => ({
    fieldId: String(field._id ?? `field-${index}`),
    key: toCamelCase(typeof field.name === "string" ? field.name : `field-${index}`),
    name: field.name,
    label: field.label,
    type: field.type,
    isMultiple: field.isMultiple,
    options: field.options,
    order: index,
    languages: field.languages,
    visible: field.visible,
    isFixed: field.isFixed,
  }));

export const hiddenListingParameterKeys = (fields: FieldRecord[]): string[] =>
  fields
    .filter((field) => field.visible === false && field.isFixed !== true)
    .map((field) => typeof field.name === "string" ? toCamelCase(field.name) : "")
    .filter(Boolean);

const buildParameter = (
  listing: ListingRecord,
  field: FieldRecord,
  index: number,
  locale: string,
  configured: boolean
): ListingParameter | undefined => {
  const originalName = typeof field.name === "string" ? field.name : "";
  const key = typeof field.key === "string" ? field.key : toCamelCase(originalName);
  const valueKey = typeof field.valueKey === "string" ? field.valueKey : key;
  if (!key) return undefined;
  const type = typeof field.type === "string" ? field.type.toLowerCase() : "text";
  const isFile = ["file", "document", "image", "images"].includes(type);
  const matchingFiles = isFile
    ? (listing.documents || [])
        .filter((document) => [originalName, key, valueKey].includes(String(document.name || "")))
        .map((document) => document.fileUrl)
        .filter((fileUrl): fileUrl is string => typeof fileUrl === "string" && Boolean(fileUrl))
    : [];
  const hasStoredValue = Object.prototype.hasOwnProperty.call(listing, valueKey);
  const submitted = hasStoredValue || matchingFiles.length > 0;
  const localized = localizeField(field, locale);
  const label = typeof localized.label === "string" && localized.label.trim()
    ? localized.label
    : originalName || humanizeKey(key);
  const options = Array.isArray(localized.options) ? localized.options : undefined;
  const optionItems = optionItemsFor(field.options, localized.options);
  const isMultiple = field.isMultiple === true || ["images", "multiselect", "multi-select"].includes(type);
  const value = isFile && matchingFiles.length > 0
    ? matchingFiles
    : normalizeValue(type, isMultiple, listing[valueKey]);
  const displayValue = type === "location"
    ? persistedLocationLabel(listing, valueKey, value)
    : ["select", "multiselect", "multi-select"].includes(type)
      ? optionDisplayValue(value, optionItems)
      : undefined;

  return {
    fieldId: String(field._id ?? field.fieldId ?? `unknown:${key}`),
    key,
    label,
    type,
    value,
    submitted,
    configured,
    order: index,
    isMultiple,
    ...(options ? { options } : {}),
    ...(optionItems ? { optionItems } : {}),
    ...(displayValue !== undefined ? { displayValue } : {}),
  };
};

export const buildListingParameters = (
  listing: ListingRecord,
  canonicalFieldIds: unknown[],
  populatedFields: FieldRecord[],
  locale: string
): ListingParameter[] => {
  const currentFields = preserveCanonicalFieldOrder(canonicalFieldIds, populatedFields);
  const currentIds = new Set(currentFields.map((field) => String(field._id)));
  const currentKeys = new Set(currentFields.map((field) =>
    toCamelCase(typeof field.name === "string" ? field.name : "")
  ));
  const allSnapshotFields = Array.isArray(listing.parameterFieldSnapshot)
    ? listing.parameterFieldSnapshot
    : [];
  const snapshotsById = new Map(allSnapshotFields.map((field) => [String(field.fieldId ?? field._id), field]));
  const joinedCurrentFields = currentFields.map((field) => {
    const currentKey = toCamelCase(typeof field.name === "string" ? field.name : "");
    return {
      ...field,
      valueKey: Object.prototype.hasOwnProperty.call(listing, currentKey)
        ? currentKey
        : snapshotsById.get(String(field._id))?.key,
    };
  });
  const snapshotFields = allSnapshotFields.filter(
    (field) => !currentIds.has(String(field.fieldId ?? field._id))
  );
  const knownKeys = new Set([...currentKeys, ...snapshotFields.map((field) => String(field.key || ""))]);
  const legacyUnknownFields: FieldRecord[] = snapshotFields.length > 0
    ? []
    : Object.keys(listing)
        .filter((key) => !RESERVED_LISTING_KEYS.has(key) && !knownKeys.has(key) && !key.endsWith("Address") && !key.endsWith("Label"))
        .map((key) => ({ _id: `unknown:${key}`, key, name: key, label: humanizeKey(key), type: "unknown" }));

  return [...joinedCurrentFields, ...snapshotFields, ...legacyUnknownFields]
    .map((field, index) => buildParameter(listing, field, index, locale, index < joinedCurrentFields.length))
    .filter((parameter): parameter is ListingParameter => Boolean(parameter));
};
