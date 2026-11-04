import assert from "node:assert/strict";
import test from "node:test";
import { buildListingParameters, snapshotListingFields } from "../utils/listingParameters";

const field = (id: string, name: string, type: string, extra: Record<string, unknown> = {}) => ({
  _id: id, name, label: name.replace(/-/g, " "), type, visible: true, ...extra,
});

test("includes configured Drop-off Location in canonical template order", () => {
  const fields = [
    field("drop", "drop-off-location", "location", { order: 99 }),
    field("capacity", "capacity", "number", { order: 1 }),
  ];
  const parameters = buildListingParameters({
    dropOffLocation: JSON.stringify({ address: "Doha Airport", lat: 25.27, lng: 51.61 }),
    capacity: "7",
  }, ["drop", "capacity"], fields, "en");
  assert.deepEqual(parameters.map(({ fieldId, key }) => [fieldId, key]), [
    ["drop", "dropOffLocation"], ["capacity", "capacity"],
  ]);
  assert.equal(parameters[0].displayValue, "Doha Airport");
  assert.equal(parameters[1].value, 7);
});

test("normalizes every supported field type without losing false or zero", () => {
  const fields = [
    field("text", "notes", "text"), field("number", "capacity", "number"),
    field("date", "available-date", "date"), field("boolean", "enabled", "boolean"),
    field("select", "fuel", "select", { options: ["gas", "electric"] }),
    field("multi", "features", "multiselect", { isMultiple: true, options: ["gps", "seat"] }),
    field("location", "drop-off-location", "location"), field("file", "proof", "file"),
    field("image", "photo", "image"),
  ];
  const listing = {
    notes: "Clean", capacity: "0", availableDate: "2026-12-01", enabled: "No",
    fuel: "electric", features: '["gps","seat"]',
    dropOffLocation: { lat: 25, lng: 51, address: "Airport" },
    documents: [
      { name: "proof", fileUrl: "/uploads/proof.pdf" },
      { name: "photo", fileUrl: "/uploads/photo.webp" },
    ],
  };
  const parameters = buildListingParameters(listing, fields.map(({ _id }) => _id), fields, "en");
  assert.deepEqual(parameters.map(({ value }) => value), [
    "Clean", 0, "2026-12-01", false, "electric", ["gps", "seat"],
    { lat: 25, lng: 51, address: "Airport" }, ["/uploads/proof.pdf"], ["/uploads/photo.webp"],
  ]);
  assert.ok(parameters.every(({ submitted }) => submitted));
});

test("emits explicit not-submitted state for every configured field", () => {
  const fields = [field("missing", "optional-note", "text"), field("empty", "tags", "multiselect", { isMultiple: true })];
  const parameters = buildListingParameters({}, ["missing", "empty"], fields, "en");
  assert.deepEqual(parameters.map(({ submitted, value }) => ({ submitted, value })), [
    { submitted: false, value: null }, { submitted: false, value: null },
  ]);
});

test("keeps deleted fields from the creation snapshot and localizes with fallback", () => {
  const original = field("deleted", "old-option", "select", {
    label: "Old option", options: ["one", "two"],
    languages: [{ locale: "ar", translations: { label: "الخيار القديم", options: { one: "واحد" } } }],
  });
  const listing = { oldOption: "two", parameterFieldSnapshot: snapshotListingFields([original]) };
  const [parameter] = buildListingParameters(listing, [], [], "ar");
  assert.equal(parameter.fieldId, "deleted");
  assert.equal(parameter.configured, false);
  assert.equal(parameter.label, "الخيار القديم");
  assert.equal(parameter.displayValue, "two");
});

test("joins renamed template fields to submitted values by stable field ID", () => {
  const original = field("stable", "old-key", "text", { label: "Old label" });
  const listing = { oldKey: "preserved", parameterFieldSnapshot: snapshotListingFields([original]) };
  const current = field("stable", "new-key", "text", { label: "New label" });
  const [parameter] = buildListingParameters(listing, ["stable"], [current], "en");
  assert.equal(parameter.key, "newKey");
  assert.equal(parameter.value, "preserved");
  assert.equal(parameter.submitted, true);
});

test("surfaces legacy unknown submitted values without exposing reserved listing fields", () => {
  const parameters = buildListingParameters({
    _id: "listing-a", name: "Rental", leaser: "user-a", legacyCustomValue: { unexpected: true },
  }, [], [], "en");
  assert.deepEqual(parameters.map(({ fieldId, key, configured }) => ({ fieldId, key, configured })), [
    { fieldId: "unknown:legacyCustomValue", key: "legacyCustomValue", configured: false },
  ]);
});

test("malformed structured values remain renderable and do not throw", () => {
  const fields = [field("location", "location", "location"), field("multi", "choices", "multiselect", { isMultiple: true })];
  const parameters = buildListingParameters({ location: "{broken", choices: "[broken" }, ["location", "multi"], fields, "en");
  assert.equal(parameters[0].value, "{broken");
  assert.deepEqual(parameters[1].value, ["[broken"]);
});

test("parameter construction is isolated to the requested listing", () => {
  const fields = [field("secret", "serial-number", "text")];
  const first = buildListingParameters({ serialNumber: "A-1" }, ["secret"], fields, "en");
  const second = buildListingParameters({ serialNumber: "B-2" }, ["secret"], fields, "en");
  assert.equal(first[0].value, "A-1");
  assert.equal(second[0].value, "B-2");
  assert.equal(first.length, 1);
  assert.equal(second.length, 1);
});
