import mongoose, { Schema, Document, model } from "mongoose";

interface ILanguageTranslation {
  locale: string;
  translations: Record<string, any>; // Flexible translations
}

export interface IBusinessSetting extends Document {
  pageName: string;
  pageSettings: Record<string, any>;
  languages?: ILanguageTranslation[];
}

const BusinessSettingSchema = new Schema<IBusinessSetting>(
  {
    pageName: {
      type: String,

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
    },
    languages: [
      {
        locale: { type: String, required: true },
        translations: { type: Schema.Types.Mixed }, // Dynamic
      },
    ],
  },
  { timestamps: true }
);

export const BusinessSetting = model<IBusinessSetting>(
  "BusinessSetting",
  BusinessSettingSchema
);
