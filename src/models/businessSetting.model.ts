import { model, Schema } from "mongoose";

interface CompanyInformation {
  companyName: string;
  companyEmail: string;
  phone: string;
  country: string;
  address: string;
  lat: number;
  long: number;
  logo: string;
  favicon: string;
}

interface GeneralSettings {
  timeZone: string;
  timeFormat: string;
  currencySymbol: string;
  currencyPosition: "left" | "right";
  decimalPoints: number;
  copyrightText: string;
}

interface BusinessRulesSetup {
  defaultCommissionRate: number;
  commissionRatePurchaseCharge: number;
  confirmOrderBy: "store" | "delivery_man";
  includeTaxAmount: boolean;
  customerPreference: boolean;
  orderInfoForAdmin: boolean;
  orderNotificationType: "firebase" | "manual";
  freeServiceOnOrderOver: boolean;
  guestCheckout: boolean;
}

interface AdditionalCharges {
  additionalChargesEnabled: boolean;
  chargeNameEnabled: boolean;
  chargeAmountEnabled: boolean;
}

interface PaymentOptions {
  partialPayment: boolean;
  restAmountPayMethod: "cod" | "digital_payment" | "both";
}

export interface IBusiness extends Document {
  companyInfo: CompanyInformation;
  generalSettings: GeneralSettings;
  businessRules: BusinessRulesSetup;
  additionalCharges: AdditionalCharges;
  payment: PaymentOptions;
}


const CompanyInfoSchema = new Schema<CompanyInformation>({
  companyName: { type: String, required: true },
  companyEmail: { type: String, required: true },
  phone: { type: String, required: true },
  country: { type: String, required: true },
  address: { type: String, required: true },
  lat: { type: Number, required: true },
  long: { type: Number, required: true },
  logo: { type: String, required: true },
  favicon: { type: String, required: true },
}, { _id: false });

const GeneralSettingsSchema = new Schema<GeneralSettings>({
  timeZone: { type: String, required: true },
  timeFormat: { type: String, required: true },
  currencySymbol: { type: String, required: true },
  currencyPosition: { type: String, enum: ["left", "right"], required: true },
  decimalPoints: { type: Number, required: true },
  copyrightText: { type: String, required: true },
}, { _id: false });

const BusinessRulesSchema = new Schema<BusinessRulesSetup>({
  defaultCommissionRate: { type: Number, required: true },
  commissionRatePurchaseCharge: { type: Number, required: true },
  confirmOrderBy: { type: String, enum: ["store", "delivery_man"], required: true },
  includeTaxAmount: { type: Boolean, required: true },
  customerPreference: { type: Boolean, required: true },
  orderInfoForAdmin: { type: Boolean, required: true },
  orderNotificationType: { type: String, enum: ["firebase", "manual"], required: true },
  freeServiceOnOrderOver: { type: Boolean, required: true },
  guestCheckout: { type: Boolean, required: true },
}, { _id: false });

const AdditionalChargesSchema = new Schema<AdditionalCharges>({
  additionalChargesEnabled: { type: Boolean, required: true },
  chargeNameEnabled: { type: Boolean, required: true },
  chargeAmountEnabled: { type: Boolean, required: true },
}, { _id: false });

const PaymentOptionsSchema = new Schema<PaymentOptions>({
  partialPayment: { type: Boolean, required: true },
  restAmountPayMethod: {
    type: String,
    enum: ["cod", "digital_payment", "both"],
    required: true,
  },
}, { _id: false });

const BusinessSchema = new Schema<IBusiness>({
  companyInfo: { type: CompanyInfoSchema, required: true },
  generalSettings: { type: GeneralSettingsSchema, required: true },
  businessRules: { type: BusinessRulesSchema, required: true },
  additionalCharges: { type: AdditionalChargesSchema, required: true },
  payment: { type: PaymentOptionsSchema, required: true },
}, { timestamps: true });

export const Business = model<IBusiness>("Business", BusinessSchema);
