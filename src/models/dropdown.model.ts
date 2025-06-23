import mongoose, { Document, Schema } from "mongoose";

interface IDropdownValue {
  name: string;
  value: string;
  // category?: string; // optional for now
}

interface IDropdown extends Document {
  name: string; // Dropdown key name (ex: professions, inputTypes etc.)
  values: IDropdownValue[]; // Array of value-name pairs
  createdAt: Date;
  updatedAt: Date;
}

const DropdownValueSchema = new Schema<IDropdownValue>(
  {
    name: { type: String, required: true },
    value: { type: String, required: true },
    // category: { type: String, default: null },
  },
  { _id: false }
); // ⚠ important: disable _id for subdocuments to avoid unnecessary id creation

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
  },
  { timestamps: true }
);

// delete models.Dropdown;

const Dropdown = mongoose.model<IDropdown>("Dropdown", DropdownSchema);
export { Dropdown, IDropdown };
