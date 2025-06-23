// models/form.model.ts
import { Schema, model, Document, Types } from "mongoose";

interface IForm extends Document {
  categoryId: Types.ObjectId;
  fields: Types.ObjectId[];
  name?: string;
  description?: string;
}

const FormSchema = new Schema<IForm>(
  {
    categoryId: {
      type: Schema.Types.ObjectId,
      ref: "Category",
      required: true,
      unique: true,
    },
    fields: [{ type: Schema.Types.ObjectId, ref: "Field", required: true }],
    name: { type: String },
    description: { type: String },
  },
  { timestamps: true }
);

export const Form = model<IForm>("Form", FormSchema);
