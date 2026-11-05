import assert from "node:assert/strict";
import test from "node:test";
import type { NextFunction, Request, Response } from "express";
import { reorderFormFields } from "../controllers/forms.controller";
import { Form } from "../models/form.model";
import {
  MAX_FORM_FIELDS,
  orderedFieldReferences,
  validateFullFormFieldOrder,
} from "../utils/formFieldOrdering";

const formId = "507f1f77bcf86cd799439011";
const fieldA = "507f1f77bcf86cd799439012";
const fieldB = "507f1f77bcf86cd799439013";
const foreignField = "507f1f77bcf86cd799439014";

test("full-order validation rejects duplicate, missing, foreign, and oversized payloads", () => {
  assert.deepEqual(validateFullFormFieldOrder([fieldA, fieldB], [fieldA, fieldA]), {
    ok: false,
    reason: "duplicate",
  });
  assert.deepEqual(validateFullFormFieldOrder([fieldA, fieldB], [fieldA]), {
    ok: false,
    reason: "membership",
  });
  assert.deepEqual(
    validateFullFormFieldOrder([fieldA, fieldB], [fieldA, foreignField]),
    { ok: false, reason: "membership" }
  );
  const many = Array.from({ length: MAX_FORM_FIELDS + 1 }, (_, index) => String(index));
  assert.deepEqual(validateFullFormFieldOrder(many, many), {
    ok: false,
    reason: "too-many",
  });
});

test("canonical field references deterministically repair integer order", () => {
  assert.deepEqual(orderedFieldReferences([fieldB, fieldA]), [
    { fieldId: fieldB, order: 0 },
    { fieldId: fieldA, order: 1 },
  ]);
});

test("reorder persists the exact sequence in one atomic versioned update", async () => {
  const result = await invokeReorder({
    requested: [fieldB, fieldA],
    requestVersion: 2,
    current: [fieldA, fieldB],
    currentVersion: 2,
    updated: [fieldB, fieldA],
  });

  assert.equal(result.statusCode, 200);
  assert.equal(result.updateCalls.length, 1);
  assert.deepEqual(result.updateCalls[0].filter, { _id: formId, __v: 2 });
  assert.deepEqual(result.updateCalls[0].update.$inc, { __v: 1 });
  assert.deepEqual(
    result.updateCalls[0].update.$set.fields.map(String),
    [fieldB, fieldA]
  );
  assert.deepEqual(result.body.data.fields, [
    { fieldId: fieldB, order: 0 },
    { fieldId: fieldA, order: 1 },
  ]);
  assert.equal(result.body.data.version, 3);
});

test("stale retries are idempotent when the requested order is already stored", async () => {
  const result = await invokeReorder({
    requested: [fieldB, fieldA],
    requestVersion: 2,
    current: [fieldB, fieldA],
    currentVersion: 3,
  });

  assert.equal(result.statusCode, 200);
  assert.equal(result.updateCalls.length, 0);
  assert.equal(result.body.data.version, 3);
});

test("concurrent changes reject stale versions without writing", async () => {
  const result = await invokeReorder({
    requested: [fieldB, fieldA],
    requestVersion: 1,
    current: [fieldA, fieldB],
    currentVersion: 2,
  });

  assert.equal(result.statusCode, 409);
  assert.equal(result.updateCalls.length, 0);
});

test("malformed and duplicate IDs are rejected without writing", async () => {
  const malformed = await invokeReorder({
    requested: ["not-an-object-id", fieldB],
    requestVersion: 2,
    current: [fieldA, fieldB],
    currentVersion: 2,
  });
  const duplicate = await invokeReorder({
    requested: [fieldA, fieldA],
    requestVersion: 2,
    current: [fieldA, fieldB],
    currentVersion: 2,
  });

  assert.equal(malformed.statusCode, 400);
  assert.equal(duplicate.statusCode, 400);
  assert.equal(malformed.updateCalls.length, 0);
  assert.equal(duplicate.updateCalls.length, 0);
});

test("foreign IDs are rejected without writing", async () => {
  const result = await invokeReorder({
    requested: [fieldA, foreignField],
    requestVersion: 2,
    current: [fieldA, fieldB],
    currentVersion: 2,
  });

  assert.equal(result.statusCode, 400);
  assert.equal(result.updateCalls.length, 0);
});

type ReorderOptions = {
  requested: string[];
  requestVersion: number;
  current: string[];
  currentVersion: number;
  updated?: string[];
};

type UpdateCall = {
  filter: Record<string, unknown>;
  update: { $set: { fields: unknown[] }; $inc: { __v: number } };
};

async function invokeReorder(options: ReorderOptions) {
  const originalFindById = Form.findById;
  const originalFindOneAndUpdate = Form.findOneAndUpdate;
  const updateCalls: UpdateCall[] = [];
  let statusCode = 0;
  let body: any;

  (Form as any).findById = () => ({
    select: () => ({
      lean: async () => ({ fields: options.current, __v: options.currentVersion }),
    }),
  });
  (Form as any).findOneAndUpdate = (
    filter: Record<string, unknown>,
    update: UpdateCall["update"]
  ) => {
    updateCalls.push({ filter, update });
    return {
      select: () => ({
        lean: async () => ({
          fields: options.updated || options.requested,
          __v: options.currentVersion + 1,
        }),
      }),
    };
  };

  const req = {
    params: { id: formId },
    body: { fieldIds: options.requested, version: options.requestVersion },
    t: (key: string) => key,
  } as unknown as Request;
  const res = {
    status(code: number) {
      statusCode = code;
      return this;
    },
    json(payload: unknown) {
      body = payload;
      return this;
    },
  } as unknown as Response;
  const next = ((error?: unknown) => {
    if (error) throw error;
  }) as NextFunction;

  try {
    await reorderFormFields(req, res, next);
    return { statusCode, body, updateCalls };
  } finally {
    Form.findById = originalFindById;
    Form.findOneAndUpdate = originalFindOneAndUpdate;
  }
}
