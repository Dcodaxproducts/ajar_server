import mongoose, { Schema, Document } from "mongoose";

export interface IHelpSupport extends Document {
  user: mongoose.Schema.Types.ObjectId;
  userName: string;
  title: string;
  status: "pending" | "resolved" | "inprogress";
  createdAt: Date;
}

const HelpSupportSchema: Schema = new Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    title: {
      type: String,
      required: true,
      trim: true,
    },
    status: {
      type: String,
      enum: ["pending", "resolved", "inprogress"],
      default: "pending",
    },
  },
  { timestamps: true }
);

export const HelpSupport = mongoose.model<IHelpSupport>(
  "HelpSupport",
  HelpSupportSchema
);
