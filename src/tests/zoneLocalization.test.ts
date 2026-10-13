import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { localizeZoneForResponse } from "../utils/zoneLocalization";

test("new zones without translations remain visible for localized requests", () => {
  const zone = { _id: "zone-new", name: "North Zone", currency: "SAR", languages: [] };
  assert.deepEqual(localizeZoneForResponse(zone, "en"), {
    _id: "zone-new", name: "North Zone", currency: "SAR",
  });
});

test("zone localization uses a matching translation and canonical fallback", () => {
  const zone = {
    _id: "zone-1", name: "Canonical", adminNotes: "Canonical notes",
    languages: [{ locale: "ar", translations: { name: "المنطقة", adminNotes: "ملاحظات" } }],
  };
  assert.equal(localizeZoneForResponse(zone, "ar").name, "المنطقة");
  assert.equal(localizeZoneForResponse(zone, "ar").adminNotes, "ملاحظات");
  assert.equal(localizeZoneForResponse(zone, "en").name, "Canonical");
});

test("zone list and details localize without filtering untranslated zones", () => {
  const controller = readFileSync(join(__dirname, "../controllers/zone.controller.ts"), "utf8");
  assert.match(controller, /filteredData = filteredData\.map/);
  assert.doesNotMatch(controller, /zone\.languages\?\.some/);
  assert.match(controller, /localizeZoneForResponse\(zone, locale\)/);
  assert.doesNotMatch(controller, /Zone\.countDocuments\(\)/);
});
