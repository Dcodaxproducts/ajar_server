// import mongoose, { Schema, Document } from "mongoose";

// interface IZoneLanguage {
//   locale: string;
//   translations: Record<string, any>; //Flexible translations
// }

// interface IZone extends Document {
//   name: string;
//   subCategories: string[];
//   currency: string;
//   language: string;
//   languages?: IZoneLanguage[];
//   polygons: { lat: number; lng: number }[];
//   createdAt: Date;
//   updatedAt: Date;
// }

// const ZoneSchema = new Schema(
//   {
//     name: { type: String, required: true, trim: true },
//     subCategories: [
//       { type: mongoose.Schema.Types.ObjectId, ref: "subCategory" },
//     ],
//     currency: { type: String, required: true, trim: true },
//     language: { type: String, default: "en" },
//     polygons: {
//       type: [
//         [
//           {
//             lat: { type: Number, required: true },
//             lng: { type: Number, required: true },
//           },
//         ],
//       ],
//       default: [],
//     },
//     // polygons: [{ type: [{ lat: Number, lng: Number }], default: [] }],
//     languages: [
//       {
//         locale: { type: String },
//         translations: { type: Schema.Types.Mixed },
//       },
//     ],
//     // Rental Policies
//     rentalPolicies: {
//       securityDepositRules: {
//         depositRequired: { type: Boolean, default: false },
//         depositAmount: { type: Number, default: 0 },
//         depositConditions: { type: String, default: "" },
//       },
//       damageLiabilityTerms: {
//         responsibilityClause: { type: String, default: "" },
//         inspectionRequired: { type: Boolean, default: false },
//         insuranceRequired: { type: Boolean, default: false },
//       },
//       rentalDurationLimits: {
//         minimumDuration: {
//           value: { type: Number, default: 1 },
//           unit: { type: String, default: "Days" },
//         },
//         maximumDuration: {
//           value: { type: Number, default: 1 },
//           unit: { type: String, default: "Days" },
//         },
//         extensionAllowed: { type: Boolean, default: true },
//       },
//     },
//   },
//   { timestamps: true }
// );

// ZoneSchema.index({ name: 1 });

// const Zone = mongoose.model<IZone>("Zone", ZoneSchema);

// export { Zone, IZone };

// models/zone.model.ts
import mongoose, { Schema, Document } from "mongoose";

// ---------------- Interfaces ----------------

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
  unit: "Days" | "Weeks" | "Months"; // You can expand units if needed
}

export interface IRentalDurationLimits {
  minimumDuration: IRentalDuration;
  maximumDuration: IRentalDuration;
  extensionAllowed: boolean;
}

export interface RentalPolicies {
  securityDepositRules: ISecurityDepositRules;
  damageLiabilityTerms: IDamageLiabilityTerms;
  rentalDurationLimits: IRentalDurationLimits;
}

export interface IZoneLanguage {
  locale: string;
  translations: Record<string, any>; // flexible translations
}

export interface IZone extends Document {
  name: string;
  subCategories: mongoose.Types.ObjectId[];
  currency: string;
  language: string;
  languages?: IZoneLanguage[];
  polygons: { lat: number; lng: number }[][];
  rentalPolicies: RentalPolicies;
  createdAt: Date;
  updatedAt: Date;
}

// ---------------- Schemas ----------------

// Rental Policies
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
    unit: { type: String, default: "Days" },
  },
  { _id: false }
);

const RentalDurationLimitsSchema = new Schema<IRentalDurationLimits>(
  {
    minimumDuration: { type: RentalDurationSchema, default: {} },
    maximumDuration: { type: RentalDurationSchema, default: {} },
    extensionAllowed: { type: Boolean, default: true },
  },
  { _id: false }
);

const RentalPoliciesSchema = new Schema<RentalPolicies>(
  {
    securityDepositRules: { type: SecurityDepositRulesSchema, default: {} },
    damageLiabilityTerms: { type: DamageLiabilityTermsSchema, default: {} },
    rentalDurationLimits: { type: RentalDurationLimitsSchema, default: {} },
  },
  { _id: false }
);

// Zone Languages
const ZoneLanguageSchema = new Schema<IZoneLanguage>(
  {
    locale: { type: String, required: true },
    translations: { type: Schema.Types.Mixed, default: {} },
  },
  { _id: false }
);

// ---------------- Zone Schema ----------------

const ZoneSchema = new Schema<IZone>(
  {
    name: { type: String, required: true, trim: true },
    subCategories: [
      { type: mongoose.Schema.Types.ObjectId, ref: "subCategory" },
    ],
    currency: { type: String, required: true, trim: true },
    language: { type: String, default: "en" },
    polygons: {
      type: [
        [
          {
            lat: { type: Number, required: true },
            lng: { type: Number, required: true },
          },
        ],
      ],
      default: [],
    },
    languages: { type: [ZoneLanguageSchema], default: [] },
    rentalPolicies: { type: RentalPoliciesSchema, default: {} },
  },
  { timestamps: true }
);

ZoneSchema.index({ name: 1 });

// ---------------- Model ----------------
export const Zone = mongoose.model<IZone>("Zone", ZoneSchema);
