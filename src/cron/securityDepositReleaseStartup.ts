type Environment = {
  ENABLE_SECURITY_DEPOSIT_RELEASE_CRON?: string;
};

const runtimeEnvironment = (): Environment => ({
  ENABLE_SECURITY_DEPOSIT_RELEASE_CRON:
    process.env.ENABLE_SECURITY_DEPOSIT_RELEASE_CRON,
});

export const isSecurityDepositReleaseCronEnabled = (
  environment: Environment = runtimeEnvironment()
) => environment.ENABLE_SECURITY_DEPOSIT_RELEASE_CRON === "true";

export const startSecurityDepositReleaseCronWhenEnabled = (
  startCron: () => unknown,
  environment: Environment = runtimeEnvironment()
) => {
  if (!isSecurityDepositReleaseCronEnabled(environment)) return false;

  startCron();
  return true;
};
