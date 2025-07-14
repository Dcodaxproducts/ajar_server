import mongoose, { Schema, Document, model } from "mongoose";

export interface IBusinessSetting extends Document {
  pageName: string;
  pageSettings: Record<string, any>;
}

const BusinessSettingSchema = new Schema<IBusinessSetting>(
  {
    pageName: {
      type: String,
      required: true,
      enum: [
        "businessInfo",
        "paymentMethods",
        "smsModule",
        "mailConfig",
        "mapAPI",
        "socialLogins",
        "recaptcha",
        "firebase",
      ],
      unique: true,
    },
    pageSettings: {
      type: Schema.Types.Mixed,
      required: true,
    },
  },
  { timestamps: true }
);

export const BusinessSetting = model<IBusinessSetting>(
  "BusinessSetting",
  BusinessSettingSchema
);
