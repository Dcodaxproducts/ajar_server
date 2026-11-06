export const SEPARATE_DEPOSIT_CAPABILITY = "separate-security-deposit-v1";

type RolloutEnvironment = {
  ENABLE_SEPARATE_SECURITY_DEPOSIT?: string;
};

const runtimeEnvironment = (): RolloutEnvironment => ({
  ENABLE_SEPARATE_SECURITY_DEPOSIT:
    process.env.ENABLE_SEPARATE_SECURITY_DEPOSIT,
});

export const isSeparateDepositFeatureEnabled = (
  environment: RolloutEnvironment = runtimeEnvironment()
) => environment.ENABLE_SEPARATE_SECURITY_DEPOSIT === "true";

export const parseClientCapabilities = (value: unknown): Set<string> => {
  const values = Array.isArray(value)
    ? value
    : typeof value === "string"
      ? value.split(",")
      : [];
  return new Set(
    values
      .filter((item): item is string => typeof item === "string")
      .map((item) => item.trim().toLowerCase())
      .filter(Boolean)
  );
};

export const resolveSecurityDepositPaymentMode = (
  capabilities: unknown,
  environment: RolloutEnvironment = runtimeEnvironment()
): "legacy_combined" | "separate_authorization" =>
  isSeparateDepositFeatureEnabled(environment) &&
  parseClientCapabilities(capabilities).has(SEPARATE_DEPOSIT_CAPABILITY)
    ? "separate_authorization"
    : "legacy_combined";
