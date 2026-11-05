export const MAX_FORM_FIELDS = 200;

export type FormFieldOrderValidation =
  | { ok: true; fieldIds: string[]; unchanged: boolean }
  | {
      ok: false;
      reason: "invalid" | "duplicate" | "membership" | "too-many";
    };

export const validateFullFormFieldOrder = (
  currentIds: readonly string[],
  requestedIds: unknown
): FormFieldOrderValidation => {
  if (!Array.isArray(requestedIds) || !requestedIds.every((id) => typeof id === "string")) {
    return { ok: false, reason: "invalid" };
  }
  if (requestedIds.length > MAX_FORM_FIELDS) {
    return { ok: false, reason: "too-many" };
  }
  if (new Set(requestedIds).size !== requestedIds.length) {
    return { ok: false, reason: "duplicate" };
  }
  if (
    requestedIds.length !== currentIds.length ||
    requestedIds.some((id) => !currentIds.includes(id))
  ) {
    return { ok: false, reason: "membership" };
  }
  return {
    ok: true,
    fieldIds: requestedIds,
    unchanged: requestedIds.every((id, index) => id === currentIds[index]),
  };
};

export const orderedFieldReferences = (fieldIds: readonly string[]) =>
  fieldIds.map((fieldId, order) => ({ fieldId, order }));
