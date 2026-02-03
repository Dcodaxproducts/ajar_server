import mongoose, { Schema, Document } from "mongoose";

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
  unit: "Days" | "Weeks" | "Months"; 
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
  translations: Record<string, any>; 
}

export interface IZone extends Document {
  name: string;
  subCategories: mongoose.Types.ObjectId[];
  currency: string;
  language: string;
  languages?: IZoneLanguage[];
  polygons: {
    type: "MultiPolygon";
    coordinates: number[][][][];  // GeoJSON MultiPolygon format
  };
  rentalPolicies: RentalPolicies;
  createdAt: Date;
  updatedAt: Date;
}

// export interface IZone extends Document {
//   name: string;
//   subCategories: mongoose.Types.ObjectId[];
//   currency: string;
//   language: string;
//   languages?: IZoneLanguage[];
//   polygons: { lat: number; lng: number }[][];
//   rentalPolicies: RentalPolicies;
//   createdAt: Date;
//   updatedAt: Date;
// }

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

//Zone Schema
const ZoneSchema = new Schema<IZone>(
  {
    name: { type: String, required: true, trim: true },
    subCategories: [
      { type: mongoose.Schema.Types.ObjectId, ref: "subCategory" },
    ],
    currency: { type: String, required: true, trim: true },
    language: { type: String, default: "en" },
    // Change to GeoJSON format
    polygons: {
      type: {
        type: String,
        enum: ["MultiPolygon"],
        default: "MultiPolygon"
      },
      coordinates: {
        type: [[[[Number]]]],  // MultiPolygon: array of polygons, each polygon is array of linear rings
        default: []
      }
    },
    languages: { type: [ZoneLanguageSchema], default: [] },
    rentalPolicies: { type: RentalPoliciesSchema, default: {} },
  },
  { timestamps: true }
);

// const ZoneSchema = new Schema<IZone>(
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
//     languages: { type: [ZoneLanguageSchema], default: [] },
//     rentalPolicies: { type: RentalPoliciesSchema, default: {} },
//   },
//   { timestamps: true }
// );

// ZoneSchema.index({ polygons: "2dsphere" });

ZoneSchema.index({ name: 1 });

export const Zone = mongoose.model<IZone>("Zone", ZoneSchema);
