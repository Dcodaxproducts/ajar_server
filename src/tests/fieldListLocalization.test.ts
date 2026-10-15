import assert from "node:assert/strict";
import test from "node:test";
import { localizeFieldForList } from "../utils/localizeFieldForList";

test("requested locale falls back to base field instead of hiding it", () => {
  const field = { _id: "field-1", name: "serialNumber", label: "Serial number", languages: [] };
  const localized = localizeFieldForList(field, "ar");
  assert.equal(localized._id, "field-1");
  assert.equal(localized.label, "Serial number");
});

test("requested translation replaces display text without changing identity", () => {
  const localized = localizeFieldForList({
    _id: "field-1", name: "serialNumber", label: "Serial number",
    languages: [{ locale: "ar", translations: { label: "الرقم التسلسلي" } }],
  }, "ar");
  assert.equal(localized._id, "field-1");
  assert.equal(localized.label, "الرقم التسلسلي");
  assert.equal(localized.name, "serialNumber");
  assert.equal(localized.languages, undefined);
});
