import mongoose, { Document, Schema } from "mongoose";

interface IDropdownValue {
  _id?: mongoose.Types.ObjectId;
  name: string;
  value: string;
  // Added new toggles
  hasExpiry: boolean;
  autoApproval: boolean;
  languages?: Array<{
    locale: string;
    translations: { name?: string; label?: string };
  }>;
}

interface IDropdown extends Document {
  name: string; 
  values: IDropdownValue[]; 
  languages?: Array<{
    locale: string;
    translations: Record<string, unknown>;
  }>;
  createdAt: Date;
  updatedAt: Date;
}

const DropdownValueSchema = new Schema<IDropdownValue>(
  {
    name: { type: String, required: true },
    value: { type: String, required: true },
    // New fields with defaults
    hasExpiry: { type: Boolean, default: false },
    autoApproval: { type: Boolean, default: false },
    languages: [
      {
        locale: { type: String, required: true },
        translations: { type: Schema.Types.Mixed, default: {} },
      },
    ],
  },
  { _id: true }
); 

const DropdownSchema = new Schema<IDropdown>(
  {
    name: { type: String, required: true, unique: true },
    values: {
      type: [DropdownValueSchema],
      default: [],
      validate: {
        validator: function (values: IDropdownValue[]) {
          const uniqueValues = new Set(values.map((v) => v.value));
          return uniqueValues.size === values.length;
        },
        message: "Duplicate values are not allowed inside dropdown values.",
      },
    },
    languages: [
      {
        locale: { type: String, required: true },
        translations: { type: Schema.Types.Mixed, default: {} },
      },
    ],
  },
  { timestamps: true }
);

const Dropdown = mongoose.model<IDropdown>("Dropdown", DropdownSchema);
export { Dropdown, IDropdown };
