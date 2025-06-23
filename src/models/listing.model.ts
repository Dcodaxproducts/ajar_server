import mongoose, { Schema, Document } from "mongoose";

interface ListingField {
  name: string;
  value: string | number | boolean;
  field: mongoose.Types.ObjectId;
}

export interface IListing extends Document {
  categoryId: mongoose.Types.ObjectId;
  formId: mongoose.Types.ObjectId;
  fields: ListingField[];
  ratings: {
    count: number;
    average: number;
  };
  requiredDocs: ListingField[];
}

const ListingFieldSchema = new Schema<ListingField>(
  {
    name: { type: String, required: true },
    value: { type: Schema.Types.Mixed, required: true },
    field: { type: Schema.Types.ObjectId, ref: "Field", required: true },
  },
  { _id: false }
);

const ListingSchema = new Schema<IListing>(
  {
    categoryId: {
      type: Schema.Types.ObjectId,
      ref: "Category",
      required: true,
    },
    formId: { type: Schema.Types.ObjectId, ref: "Form", required: true },
    ratings: {
      count: { type: Number, default: 0 },
      average: { type: Number, default: 0 },
    },
    fields: { type: [ListingFieldSchema], required: true },
    requiredDocs: { type: [ListingFieldSchema], default: undefined },
  },
  { timestamps: true }
);

export const Listing = mongoose.model<IListing>("Listing", ListingSchema);
