import cron from "node-cron";
import { sweepSecurityDepositAuthorizations } from "../services/securityDepositAuthorization.service";

const EVERY_MINUTE = "* * * * *";
let securityDepositReleaseCron: ReturnType<typeof cron.schedule> | null = null;

export const releaseExpiredSecurityDeposits = async () =>
  sweepSecurityDepositAuthorizations(new Date());

export const startSecurityDepositReleaseCron = () => {
  if (process.env.ENABLE_SECURITY_DEPOSIT_HOLD_WORKER !== "true") return null;
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
