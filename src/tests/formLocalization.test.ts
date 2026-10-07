import assert from "node:assert/strict";
import test from "node:test";
import { extractTranslatableFields } from "../middlewares/languageTranslation.middleware";
import {
  localizeDropdownValue,
  localizeField,
  preserveCanonicalFieldOrder,
} from "../utils/formLocalization";
import { resolveRequestLocale } from "../utils/locale";

test("Form translation allowlist never consumes structural patch fields", () => {
  const body = {
    name: "نموذج",
    description: "وصف",
    fields: ["field-b", "field-a"],
    order: 9,
    setting: { tax: 15 },
    zone: "zone-id",
  };

  assert.deepEqual(extractTranslatableFields("Form", body), {
    name: "نموذج",
    description: "وصف",
  });
});

test("canonical field order follows Form.fields instead of global field order", () => {
  const fields = [
    { _id: "field-a", order: 100 },
    { _id: "field-b", order: 1 },
  ];

  assert.deepEqual(
    preserveCanonicalFieldOrder(["field-b", "field-a"], fields).map(
      (field) => field._id
    ),
    ["field-b", "field-a"]
  );
});

test("field localization translates display and validation content with fallback", () => {
  const field = {
    _id: "field-a",
    name: "serialNumber",
    label: "Serial number",
    placeholder: "Enter serial number",
    tooltip: "Found on the product",
    validation: { required: true, error: "Serial number is required" },
    languages: [
      {
        locale: "ar",
        translations: {
          label: "الرقم التسلسلي",
          tooltip: "موجود على المنتج",
          validation: { error: "الرقم التسلسلي مطلوب" },
        },
      },
    ],
  };

  const localized = localizeField(field, "ar");
  assert.equal(localized.label, "الرقم التسلسلي");
  assert.equal(localized.placeholder, "Enter serial number");
  assert.equal(localized.tooltip, "موجود على المنتج");
  assert.equal(
    (localized.validation as Record<string, unknown>).error,
    "الرقم التسلسلي مطلوب"
  );
});

test("dropdown labels localize when value translation data exists", () => {
  const localized = localizeDropdownValue(
    {
      value: "passport",
      name: "Passport",
      languages: [
        { locale: "ar", translations: { name: "جواز السفر" } },
      ],
    },
    "ar"
  );
  assert.equal(localized.name, "جواز السفر");
});

test("mobile localization header wins while language query remains compatible", () => {
  assert.equal(
    resolveRequestLocale({
      headers: { localization: "ar", language: "en" },
      query: { language: "en" },
    }),
    "ar"
  );
  assert.equal(
    resolveRequestLocale({ headers: {}, query: { language: "ar" } }),
    "ar"
  );
});

