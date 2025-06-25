// models/field.model.ts
import { Schema, model, Document } from "mongoose";

interface IField extends Document {
  name: string;
  type: string;
  placeholder?: string;
  label?: string;
  isMultiple?: boolean;
  options?: string[];
  order?: number;
  tooltip?: string;
  visible?: boolean;
  defaultValue?: string | number | boolean;
  readonly?: boolean;
  dependencies?: Record<string, any>;
  validation?: {
    required: boolean;
    pattern?: string;
    min?: number;
    max?: number;
  };
}

const FieldSchema = new Schema<IField>(
  {
    name: { type: String, required: true },
    type: { type: String, required: true },
    placeholder: { type: String, required: true },
    label: { type: String, required: true },
    isMultiple: { type: Boolean, default: false },
    options: { type: [String], default: undefined },
    order: { type: Number, default: 0 },
    tooltip: { type: String },
    visible: { type: Boolean, default: true },
    defaultValue: { type: Schema.Types.Mixed }, // mixed because can be string/number/boolean
    readonly: { type: Boolean, default: false },
    dependencies: { type: Object },
    validation: {
      required: { type: Boolean, default: false },
      pattern: { type: String },
      min: { type: Number },
      max: { type: Number },
    },
  },
  { timestamps: true }
);

export const Field = model<IField>("Field", FieldSchema);
