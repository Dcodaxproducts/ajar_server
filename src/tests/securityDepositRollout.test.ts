import test from "node:test";
import assert from "node:assert/strict";
import mongoose from "mongoose";
import { readFileSync } from "node:fs";
import { Payment } from "../models/payment.model";
import { Transaction } from "../models/transaction.model";
import { createTransaction } from "../utils/transactionLedger";
import {
  resolveSecurityDepositPaymentMode,
  SEPARATE_DEPOSIT_CAPABILITY,
} from "../services/securityDepositRollout.service";
import { isSecurityDepositReleaseCronEnabled } from "../cron/securityDepositReleaseStartup";

const source = (path: string) => readFileSync(require.resolve(path), "utf8");

test("separate deposit defaults off and requires an explicit compatible client", () => {
  assert.equal(resolveSecurityDepositPaymentMode([SEPARATE_DEPOSIT_CAPABILITY], {}), "legacy_combined");
  assert.equal(resolveSecurityDepositPaymentMode([], { ENABLE_SEPARATE_SECURITY_DEPOSIT: "true" }), "legacy_combined");
  assert.equal(
    resolveSecurityDepositPaymentMode(
      [SEPARATE_DEPOSIT_CAPABILITY],
      { ENABLE_SEPARATE_SECURITY_DEPOSIT: "true" }
    ),
    "separate_authorization"
  );
  assert.equal(
    resolveSecurityDepositPaymentMode(
      "other, separate-security-deposit-v1",
      { ENABLE_SEPARATE_SECURITY_DEPOSIT: "true" }
    ),
    "separate_authorization"
  );
});

test("legacy checkout remains combined while capable checkout receives a separate intent", () => {
  const booking = source("../controllers/booking.controller");
  const payments = source("../utils/bookingStripePayments");
  assert.match(booking, /securityDepositPaymentMode === "separate_authorization"/);
  assert.match(booking, /depositIntent = securityDepositPaymentMode/);
  assert.match(payments, /legacyCombinedDeposit/);
  assert.match(payments, /DEPOSIT_AUTHORIZATION_REQUIRED/);
});

test("worker gate is fail-closed, canonical, backwards compatible, and rejects disagreement", () => {
  assert.equal(isSecurityDepositReleaseCronEnabled({}), false);
  assert.equal(isSecurityDepositReleaseCronEnabled({ ENABLE_SECURITY_DEPOSIT_SETTLEMENT_WORKER: "true" }), true);
  assert.equal(isSecurityDepositReleaseCronEnabled({ ENABLE_SECURITY_DEPOSIT_HOLD_WORKER: "true", ENABLE_SECURITY_DEPOSIT_RELEASE_CRON: "true" }), true);
  assert.throws(() => isSecurityDepositReleaseCronEnabled({ ENABLE_SECURITY_DEPOSIT_HOLD_WORKER: "true", ENABLE_SECURITY_DEPOSIT_RELEASE_CRON: "false" }));
  assert.throws(() => isSecurityDepositReleaseCronEnabled({ ENABLE_SECURITY_DEPOSIT_SETTLEMENT_WORKER: "yes" }));
});

test("legacy bookings can complete and open disputes without an authorization record", () => {
  const authorization = source("../services/securityDepositAuthorization.service");
  const legacy = source("../services/legacySecurityDeposit.service");
  assert.doesNotMatch(authorization, /DEPOSIT_AUTHORIZATION_NOT_FOUND/);
  assert.ok(authorization.includes("if (!existing) return null"));
  assert.match(legacy, /releaseExpiredLegacySecurityDeposits/);
  assert.match(legacy, /settleLegacyDamageDecision/);
});

test("ticket read route is active", () => {
  const routes = source("../routes/damageReport.routes");
  assert.ok(routes.includes('router.get("/:id", useAuth, adminOnly'));
});

test("financial side effects have unique identities", () => {
  assert.ok(Payment.schema.indexes().some(([fields, options]) => fields.paymentIntentId === 1 && options.unique));
  assert.ok(Transaction.schema.indexes().some(([fields, options]) => fields.paymentId === 1 && fields.userId === 1 && fields.source === 1 && options.unique));
});

test("duplicate-key payment ledger races converge on the winning record", async () => {
  const originalUpdate = Transaction.findOneAndUpdate;
  const originalFind = Transaction.findOne;
  const paymentId = new mongoose.Types.ObjectId();
  const userId = new mongoose.Types.ObjectId();
  const winner = {
    paymentId,
    userId,
    amount: 12.5,
    type: "credit",
    source: "damage_charge",
    status: "succeeded",
  };
  let calls = 0;
  try {
    (Transaction as unknown as { findOneAndUpdate: typeof Transaction.findOneAndUpdate }).findOneAndUpdate = (async () => {
      calls += 1;
      if (calls === 1) return winner;
      throw Object.assign(new Error("duplicate"), { code: 11000 });
    }) as typeof Transaction.findOneAndUpdate;
    (Transaction as unknown as { findOne: typeof Transaction.findOne }).findOne = (() => ({
      session: async () => winner,
    })) as unknown as typeof Transaction.findOne;

    const input = {
      paymentId,
      userId,
      amount: 12.5,
      type: "credit" as const,
      source: "damage_charge" as const,
    };
    const [first, second] = await Promise.all([
      createTransaction(input),
      createTransaction(input),
    ]);
    assert.equal(first, winner);
    assert.equal(second, winner);
  } finally {
    Transaction.findOneAndUpdate = originalUpdate;
    Transaction.findOne = originalFind;
  }
});
