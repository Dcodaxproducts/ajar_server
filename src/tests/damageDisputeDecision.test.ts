import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DamageReport } from "../models/damageReport.model";
import { DAMAGE_DISPUTE_REVIEW_TRANSITIONS, isSafeEvidenceReference, validateDamageDisputeDecision } from "../services/damageDisputeDecision.service";

const valid = { decision: "approved", reason: "Evidence supports repair", approvedAmount: 250, currency: "USD", evidenceReferences: ["/uploads/photo.jpg"], expectedVersion: 0, idempotencyKey: "decision_12345678" };

test("state machine only permits pending to approved or rejected", () => {
  assert.deepEqual(DAMAGE_DISPUTE_REVIEW_TRANSITIONS.pending, ["approved", "rejected"]);
  assert.deepEqual(DAMAGE_DISPUTE_REVIEW_TRANSITIONS.approved, []);
  assert.deepEqual(DAMAGE_DISPUTE_REVIEW_TRANSITIONS.rejected, []);
});

test("admin decision accepts bounded approval and captures audit contract inputs", () => {
  const result = validateDamageDisputeDecision(valid, 300, 500, ["/uploads/photo.jpg"]);
  assert.equal(result.ok, true);
  if (result.ok) assert.deepEqual(result.value, valid);
});

test("approval and rejection amount boundaries are enforced", () => {
  for (const approvedAmount of [0, -1, 300.001, 301, 501]) {
    assert.equal(validateDamageDisputeDecision({ ...valid, approvedAmount }, 300, 500, ["/uploads/photo.jpg"]).ok, false);
  }
  assert.equal(validateDamageDisputeDecision({ ...valid, decision: "rejected", approvedAmount: 1 }, 300, 500, ["/uploads/photo.jpg"]).ok, false);
  assert.equal(validateDamageDisputeDecision({ ...valid, decision: "rejected", approvedAmount: 0 }, 300, 500, ["/uploads/photo.jpg"]).ok, true);
});

test("version, idempotency, currency, reason, and evidence are mandatory", () => {
  const invalid = [
    { ...valid, expectedVersion: -1 }, { ...valid, idempotencyKey: "short" }, { ...valid, currency: "SAR" },
    { ...valid, reason: " " }, { ...valid, evidenceReferences: ["javascript:alert(1)"] },
    { ...valid, evidenceReferences: ["/uploads/not-submitted.jpg"] },
  ];
  invalid.forEach((input) => assert.equal(validateDamageDisputeDecision(input, 300, 500, ["/uploads/photo.jpg"]).ok, false));
});

test("evidence URL policy blocks traversal, credentials, and unsafe schemes", () => {
  assert.equal(isSafeEvidenceReference("/uploads/evidence/photo.webp"), true);
  assert.equal(isSafeEvidenceReference("https://cdn.example.com/evidence.png"), true);
  assert.equal(isSafeEvidenceReference("/uploads/../secret"), false);
  assert.equal(isSafeEvidenceReference("http://cdn.example.com/evidence.png"), false);
  assert.equal(isSafeEvidenceReference("https://user:pass@cdn.example.com/evidence.png"), false);
});

test("schema carries immutable state/version/idempotency and bounded queue indexes", () => {
  const paths = DamageReport.schema.paths;
  assert.ok(paths.version); assert.ok(paths.decisionAudit); assert.ok(paths.decisionIdempotencyKey);
  const indexes = DamageReport.schema.indexes();
  assert.ok(indexes.some(([fields]) => fields.status === 1 && fields.createdAt === -1));
});

test("controller uses atomic pending/version transition, deterministic jobs, and zero payment calls", () => {
  const controller = readFileSync(require.resolve("../controllers/damageReport.controller"), "utf8");
  assert.equal(controller.includes('findOneAndUpdate({ _id: id, status: "pending", ...versionCondition }'), true);
  assert.equal(controller.includes('{ version: { $exists: false } }'), true);
  assert.match(controller, /decisionIdempotencyKey === decision.idempotencyKey/);
  assert.match(controller, /jobId: "damage-dispute-decision-"/);
  assert.equal(["stripe", "refundBookingSecurityDeposit", "createTransaction", "Payment."].some((value) => controller.includes(value)), false);
});

test("queue is bounded and participant reads are user-isolated", () => {
  const controller = readFileSync(require.resolve("../controllers/damageReport.controller"), "utf8");
  assert.equal(controller.includes("Math.min(parsed, 50)"), true);
  assert.equal(controller.includes("$or: [{ renter: userId }, { leaser: userId }]"), true);
  assert.equal(controller.includes("actor: req.user.id"), true);
  assert.equal(controller.includes("at: decidedAt"), true);
});

test("routes expose admin decision and participant read-only status without legacy mutations", () => {
  const routes = readFileSync(require.resolve("../routes/damageReport.routes"), "utf8");
  assert.equal(routes.includes('router.post("/:id/decision", useAuth, adminOnly'), true);
  assert.equal(routes.includes('router.get("/mine/:bookingId", useAuth, userOnly'), true);
  assert.equal(["updateDamageReportStatus", "router.delete", "router.patch"].some((value) => routes.includes(value)), false);
});
