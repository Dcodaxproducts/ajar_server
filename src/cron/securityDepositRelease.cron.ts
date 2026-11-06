import cron from "node-cron";
import { sweepSecurityDepositAuthorizations } from "../services/securityDepositAuthorization.service";
import {
  reconcileLegacyDamageDecisions,
  releaseExpiredLegacySecurityDeposits,
} from "../services/legacySecurityDeposit.service";

const EVERY_MINUTE = "* * * * *";
let securityDepositReleaseCron: ReturnType<typeof cron.schedule> | null = null;

export const releaseExpiredSecurityDeposits = async () => {
  const now = new Date();
  await releaseExpiredLegacySecurityDeposits(now);
  await reconcileLegacyDamageDecisions();
  return sweepSecurityDepositAuthorizations(now);
};
export const startSecurityDepositReleaseCron = () => {
  if (securityDepositReleaseCron) return securityDepositReleaseCron;

  releaseExpiredSecurityDeposits().catch((error) => {
    console.error("Security deposit reconciliation startup failed:", error);
  });
  securityDepositReleaseCron = cron.schedule(EVERY_MINUTE, () => {
    releaseExpiredSecurityDeposits().catch((error) => {
      console.error("Security deposit reconciliation failed:", error);
    });
  });
  return securityDepositReleaseCron;
};

export const stopSecurityDepositReleaseCron = () => {
  securityDepositReleaseCron?.stop();
  securityDepositReleaseCron = null;
};
