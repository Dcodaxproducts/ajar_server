import assert from "node:assert/strict";
import test from "node:test";
import {
  isSecurityDepositReleaseCronEnabled,
  startSecurityDepositReleaseCronWhenEnabled,
} from "../cron/securityDepositReleaseStartup";

test("security deposit release cron is disabled when the setting is absent", () => {
  let starts = 0;

  const started = startSecurityDepositReleaseCronWhenEnabled(
    () => { starts += 1; },
    {}
  );

  assert.equal(isSecurityDepositReleaseCronEnabled({}), false);
  assert.equal(started, false);
  assert.equal(starts, 0);
});

test("security deposit release cron is disabled when explicitly false", () => {
  let starts = 0;
  const environment = { ENABLE_SECURITY_DEPOSIT_RELEASE_CRON: "false" };

  const started = startSecurityDepositReleaseCronWhenEnabled(
    () => { starts += 1; },
    environment
  );

  assert.equal(isSecurityDepositReleaseCronEnabled(environment), false);
  assert.equal(started, false);
  assert.equal(starts, 0);
});

test("security deposit release cron starts only when explicitly true", () => {
  let starts = 0;
  const environment = { ENABLE_SECURITY_DEPOSIT_RELEASE_CRON: "true" };

  const started = startSecurityDepositReleaseCronWhenEnabled(
    () => { starts += 1; },
    environment
  );

  assert.equal(isSecurityDepositReleaseCronEnabled(environment), true);
  assert.equal(started, true);
  assert.equal(starts, 1);
});
