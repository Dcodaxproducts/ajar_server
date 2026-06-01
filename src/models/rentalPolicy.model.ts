import mongoose, { Schema, Document, Types } from "mongoose";

export type PriceUnit = "hour" | "day" | "month" | "year";

export interface ISecurityDepositRules {
  depositRequired: boolean;
  depositAmount: number;
  depositConditions: string;
}

export interface IDamageLiabilityTerms {
  responsibilityClause: string;
  inspectionRequired: boolean;
  insuranceRequired: boolean;
}

export interface IRentalDuration {
  value: number;
  unit: PriceUnit;
}

export interface IRentalDurationLimits {
  appliesToPriceUnit: PriceUnit;
  minimumDuration: IRentalDuration;
  maximumDuration: IRentalDuration;
}

// Interface for the standalone document
export interface IRentalPolicies extends Document {
  securityDepositRules: ISecurityDepositRules;
  damageLiabilityTerms: IDamageLiabilityTerms;
  rentalDurationLimits: IRentalDurationLimits[];
  extensionAllowed: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const SecurityDepositRulesSchema = new Schema<ISecurityDepositRules>(
  {
    depositRequired: { type: Boolean, default: false },
    depositAmount: { type: Number, default: 0 },
    depositConditions: { type: String, default: "" },
  },
  { _id: false }
);

const DamageLiabilityTermsSchema = new Schema<IDamageLiabilityTerms>(
  {
    responsibilityClause: { type: String, default: "" },
    inspectionRequired: { type: Boolean, default: false },
    insuranceRequired: { type: Boolean, default: false },
  },
  { _id: false }
);

const RentalDurationSchema = new Schema<IRentalDuration>(
  {
    value: { type: Number, default: 1 },
    unit: {
      type: String,
      enum: ["hour", "day", "month", "year"],
      default: "day",
    },
  },
  { _id: false }
);

const RentalDurationLimitsSchema = new Schema<IRentalDurationLimits>(
  {
    appliesToPriceUnit: {
      type: String,
      enum: ["hour", "day", "month", "year"],
      required: true,
    },
    minimumDuration: { type: RentalDurationSchema, default: {} },
    maximumDuration: { type: RentalDurationSchema, default: {} },
  },
  { _id: false }
);

const RentalPoliciesSchema = new Schema<IRentalPolicies>(
  {
    securityDepositRules: { type: SecurityDepositRulesSchema, default: {} },
    damageLiabilityTerms: { type: DamageLiabilityTermsSchema, default: {} },
    rentalDurationLimits: { type: [RentalDurationLimitsSchema], default: [] },
    extensionAllowed: { type: Boolean, default: true },
  },
  { timestamps: true }
);

export const RentalPolicy = mongoose.model<IRentalPolicies>("RentalPolicy", RentalPoliciesSchema);