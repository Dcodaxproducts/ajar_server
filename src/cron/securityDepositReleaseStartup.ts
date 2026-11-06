type Environment = {
  ENABLE_SECURITY_DEPOSIT_SETTLEMENT_WORKER?: string;
  ENABLE_SECURITY_DEPOSIT_HOLD_WORKER?: string;
  ENABLE_SECURITY_DEPOSIT_RELEASE_CRON?: string;
};

const runtimeEnvironment = (): Environment => ({
  ENABLE_SECURITY_DEPOSIT_SETTLEMENT_WORKER:
    process.env.ENABLE_SECURITY_DEPOSIT_SETTLEMENT_WORKER,
  ENABLE_SECURITY_DEPOSIT_HOLD_WORKER:
    process.env.ENABLE_SECURITY_DEPOSIT_HOLD_WORKER,
  ENABLE_SECURITY_DEPOSIT_RELEASE_CRON:
    process.env.ENABLE_SECURITY_DEPOSIT_RELEASE_CRON,
});

const parseBoolean = (name: string, value?: string) => {
  if (value === undefined || value === "") return undefined;
  if (value === "true") return true;
  if (value === "false") return false;
  throw new Error(name + " must be true or false");
};

export const isSecurityDepositReleaseCronEnabled = (
  environment: Environment = runtimeEnvironment()
) => {
  const canonical = parseBoolean(
    "ENABLE_SECURITY_DEPOSIT_SETTLEMENT_WORKER",
    environment.ENABLE_SECURITY_DEPOSIT_SETTLEMENT_WORKER
  );
  const aliases = [
    parseBoolean(
      "ENABLE_SECURITY_DEPOSIT_HOLD_WORKER",
      environment.ENABLE_SECURITY_DEPOSIT_HOLD_WORKER
    ),
    parseBoolean(
      "ENABLE_SECURITY_DEPOSIT_RELEASE_CRON",
      environment.ENABLE_SECURITY_DEPOSIT_RELEASE_CRON
    ),
  ].filter((value): value is boolean => value !== undefined);

  if (aliases.some((value) => value !== aliases[0])) {
    throw new Error("Conflicting legacy security-deposit worker gates");
  }
  if (canonical !== undefined && aliases.some((value) => value !== canonical)) {
    throw new Error("Security-deposit worker gates disagree");
  }
  return canonical ?? aliases[0] ?? false;
};

export const startSecurityDepositReleaseCronWhenEnabled = (
  startCron: () => unknown,
  environment: Environment = runtimeEnvironment()
) => {
  if (!isSecurityDepositReleaseCronEnabled(environment)) return false;
  startCron();
  return true;
};
