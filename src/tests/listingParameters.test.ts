import assert from "node:assert/strict";
import test from "node:test";
import {
  buildListingParameters,
  hiddenListingParameterKeys,
} from "../utils/listingParameters";

test("listing review parameters include Drop-off Location in template order", () => {
  const fields = [
    { _id: "drop-off", name: "drop-off-location", label: "Drop-off Location", type: "location", order: 99, visible: true },
    { _id: "capacity", name: "capacity", label: "Capacity", type: "number", order: 1, visible: true },
  ];
  const listing = {
    dropOffLocation: JSON.stringify({ address: "Doha Airport", lat: 25.27, lng: 51.61 }),
    capacity: "7",
  };
  const parameters = buildListingParameters(listing, ["drop-off", "capacity"], fields, "en");
  assert.deepEqual(parameters.map(({ key }) => key), ["dropOffLocation", "capacity"]);
  assert.deepEqual(parameters[0].value, { address: "Doha Airport", lat: 25.27, lng: 51.61 });
  assert.equal(parameters[1].value, 7);
});

test("listing review parameters preserve field types, false values, and Arabic labels", () => {
  const fields = [
    { _id: "enabled", name: "is-enabled", label: "Enabled", type: "boolean", visible: true, languages: [{ locale: "ar", translations: { label: "مفعّل" } }] },
    { _id: "features", name: "features", label: "Features", type: "select", isMultiple: true, options: ["GPS", "Child seat"], visible: true },
    { _id: "proof", name: "ownership-proof", label: "Ownership Proof", type: "file", visible: true },
  ];
  const listing = {
    isEnabled: "No",
    features: '["GPS","Child seat"]',
    documents: [{ name: "ownershipProof", fileUrl: "/uploads/proof.pdf" }],
  };
  const parameters = buildListingParameters(listing, ["enabled", "features", "proof"], fields, "ar");
  assert.equal(parameters[0].label, "مفعّل");
  assert.equal(parameters[0].value, false);
  assert.deepEqual(parameters[1].value, ["GPS", "Child seat"]);
  assert.deepEqual(parameters[2].value, ["/uploads/proof.pdf"]);
});

test("listing review parameters exclude hidden, fixed, and unsubmitted fields", () => {
  const fields = [
    { _id: "secret", name: "secret", label: "Secret", type: "text", visible: false },
    { _id: "name", name: "name", label: "Name", type: "text", isFixed: true },
    { _id: "empty", name: "empty", label: "Empty", type: "text", visible: true },
  ];
  assert.deepEqual(buildListingParameters({ secret: "private", name: "Fixed listing name" }, ["secret", "name", "empty"], fields, "en"), []);
  assert.deepEqual(hiddenListingParameterKeys(fields), ["secret"]);
});
