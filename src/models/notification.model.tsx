import mongoose, { Schema, Document } from "mongoose";

export interface INotiffication extends Document {
  title: string;
  description: string;
  user: string;
  read: boolean;
}

const notificationSchema: Schema = new Schema(
  {
    title: { type: String, required: true, trim: true },
    description: { type: String, required: true, trim: true },
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },
    read: { type: Boolean, default: false },
  },
  { timestamps: true }
);

export const User = mongoose.model<INotiffication>(
  "Notification",
  notificationSchema
);
