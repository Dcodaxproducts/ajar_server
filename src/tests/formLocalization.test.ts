import assert from "node:assert/strict";
import test from "node:test";
import type { NextFunction, Request, Response } from "express";
import {
  extractTranslatableFields,
  languageTranslationMiddleware,
} from "../middlewares/languageTranslation.middleware";
import {
  getFormByZoneAndSubCategory,
  getFormDetails,
  updateForm,
} from "../controllers/forms.controller";
import { Form } from "../models/form.model";
import {
  filterFieldsForAudience,
  localizeDropdownValue,
  localizeField,
  preserveCanonicalFieldOrder,
} from "../utils/formLocalization";
import { resolveRequestLocale } from "../utils/locale";
import { isMissingRequiredValue } from "../utils/requiredFieldValidation";

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

test("Form translations are staged while structural fields continue to the controller", async () => {
  const req = {
    params: { id: "507f1f77bcf86cd799439011" },
    body: {
      locale: "ar",
      name: "نموذج",
      description: "وصف",
      fields: ["507f1f77bcf86cd799439012"],
    },
    t: (key: string) => key,
  } as unknown as Request;
  const res = { locals: {} } as Response;
  let nextCalls = 0;
  const next = (() => {
    nextCalls += 1;
  }) as NextFunction;

  await languageTranslationMiddleware(Form)(req, res, next);

  assert.equal(nextCalls, 1);
  assert.deepEqual(req.body, { fields: ["507f1f77bcf86cd799439012"] });
  assert.deepEqual(res.locals.pendingTranslation, {
    locale: "ar",
    translations: { name: "نموذج", description: "وصف" },
  });
});

test("touched form endpoints reject malformed ObjectIds with 400", async () => {
  const invoke = async (
    handler: (req: Request, res: Response, next: NextFunction) => Promise<void>,
    request: Partial<Request>
  ) => {
    let statusCode = 0;
    const res = {
      locals: {},
      status(code: number) {
        statusCode = code;
        return this;
      },
      json() {
        return this;
      },
    } as unknown as Response;
    const req = {
      body: {},
      headers: {},
      query: {},
      params: {},
      t: (key: string) => key,
      ...request,
    } as unknown as Request;
    const next = ((error?: unknown) => {
      if (error) throw error;
    }) as NextFunction;

    await handler(req, res, next);
    return statusCode;
  };

  assert.equal(await invoke(getFormDetails, { params: { id: "bad-id" } }), 400);
  assert.equal(await invoke(updateForm, { params: { id: "bad-id" } }), 400);
  assert.equal(
    await invoke(getFormByZoneAndSubCategory, {
      query: { zone: "bad-id", subCategory: "also-bad" },
    }),
    400
  );
});

test("mobile form validation uses the existing zone/subcategory locale key", async () => {
  let message = "";
  const req = {
    body: {},
    headers: {},
    params: {},
    query: {},
    t: (key: string) => key,
  } as unknown as Request;
  const res = {
    locals: {},
    status() {
      return this;
    },
    json(payload: { message: string }) {
      message = payload.message;
      return this;
    },
  } as unknown as Response;

  await getFormByZoneAndSubCategory(req, res, (() => undefined) as NextFunction);
  assert.equal(message, "catalog:validation.zoneAndSubCategoryRequired");
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

test("mobile audience filtering preserves the existing admin/non-admin contract", () => {
  const fields = [
    { _id: "child", conditional: { dependsOn: { _id: "parent" } } },
    { _id: "parent" },
    { _id: "independent" },
  ];

  assert.deepEqual(
    filterFieldsForAudience(fields, false).map((field) => field._id),
    ["child", "independent"]
  );
  assert.deepEqual(
    filterFieldsForAudience(fields, true).map((field) => field._id),
    ["child", "parent", "independent"]
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

test("malformed option and document translations keep string fallbacks", () => {
  const localized = localizeField(
    {
      _id: "field-a",
      options: ["One"],
      documentConfig: [{ name: "Passport", filesUrl: [] }],
      languages: [
        {
          locale: "ar",
          translations: {
            options: { One: { label: "not-a-string" } },
            documentConfig: [{ name: { malformed: true } }],
          },
        },
      ],
    },
    "ar"
  );

  assert.deepEqual(localized.options, ["One"]);
  assert.equal(
    (localized.documentConfig as Array<Record<string, unknown>>)[0].name,
    "Passport"
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

test("malformed dropdown translations keep the original non-empty name", () => {
  const localized = localizeDropdownValue(
    { value: "passport", name: "Passport" },
    "ar",
    { values: { passport: { name: { malformed: true }, label: " " } } }
  );
  assert.equal(localized.name, "Passport");
});

test("required values reject null, whitespace, and empty arrays", () => {
  assert.equal(isMissingRequiredValue(null), true);
  assert.equal(isMissingRequiredValue("   "), true);
  assert.equal(isMissingRequiredValue([]), true);
  assert.equal(isMissingRequiredValue(0), false);
  assert.equal(isMissingRequiredValue(false), false);
  assert.equal(isMissingRequiredValue(["value"]), false);
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
