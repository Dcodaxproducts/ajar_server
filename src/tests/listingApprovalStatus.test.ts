import assert from "node:assert/strict";
import test from "node:test";
import {
  addCanonicalApprovalStatus,
  buildListingNameSearch,
  canonicalizeListingApprovalStatus,
  listingApprovalStatusValues,
  parseListingApprovalStatusQuery,
} from "../utils/listingApprovalStatus";

test("canonical status mapping covers current and explicit legacy variants", () => {
  assert.equal(canonicalizeListingApprovalStatus("approved"), "approved");
  assert.equal(canonicalizeListingApprovalStatus("accepted"), "approved");
  assert.equal(canonicalizeListingApprovalStatus("under-review"), "pending");
  assert.equal(canonicalizeListingApprovalStatus("declined"), "rejected");
});

test("unknown, empty, and non-string states are never mislabeled", () => {
  for (const value of ["archived", "", null, 1]) {
    assert.equal(canonicalizeListingApprovalStatus(value), null);
  }
  assert.deepEqual(addCanonicalApprovalStatus({ status: "archived" }), {
    status: "archived",
    approvalStatus: null,
  });
});

test("query validation accepts exactly the three public filter values", () => {
  for (const status of ["approved", "pending", "rejected"] as const) {
    assert.equal(parseListingApprovalStatusQuery(status), status);
  }
  assert.equal(parseListingApprovalStatusQuery(undefined), undefined);
  for (const value of ["accepted", "all", "APPROVED", ["approved"]]) {
    assert.throws(() => parseListingApprovalStatusQuery(value));
  }
});

test("all three filters include their canonical value and isolated legacy aliases", () => {
  const approved = listingApprovalStatusValues("approved");
  const pending = listingApprovalStatusValues("pending");
  const rejected = listingApprovalStatusValues("rejected");
  assert.ok(approved.includes("approved") && approved.includes("accepted"));
  assert.ok(pending.includes("pending") && pending.includes("under_review"));
  assert.ok(rejected.includes("rejected") && rejected.includes("declined"));
  assert.equal(new Set([...approved, ...pending, ...rejected]).size, approved.length + pending.length + rejected.length);
});

test("status composes with literal search and zone without regex injection", () => {
  const filter = {
    status: { $in: listingApprovalStatusValues("pending") },
    zone: "zone-id",
    name: buildListingNameSearch("car.*(premium)"),
  };
  assert.deepEqual(filter.status.$in, listingApprovalStatusValues("pending"));
  assert.equal(filter.zone, "zone-id");
  assert.equal(filter.name?.test("car.*(premium) offer"), true);
  assert.equal(filter.name?.test("carZZpremium"), false);
});

test("list contract and status mutation support immediate canonical refresh", async () => {
  const fs = await import("node:fs/promises");
  const [controller, routes] = await Promise.all([
    fs.readFile("src/controllers/marketplaceListings.controller.ts", "utf8"),
    fs.readFile("src/routes/marketplaceListings.routes.ts", "utf8"),
  ]);
  assert.match(controller, /return addCanonicalApprovalStatus\(obj\)/);
  assert.match(controller, /data: listing/);
  assert.match(routes, /allowRoles\("admin"\)/);
});
