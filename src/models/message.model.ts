import mongoose, { Schema, Document } from "mongoose";

export interface IMessage extends Document {
  sender: string;
  receiver: string;
  message: string;
  read: boolean;
  chatId: string;
}

const MessageSchema: Schema = new Schema(
  {
    sender: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    receiver: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    message: { type: String, required: true, trim: true },
    read: { type: Boolean, default: false },
    chatId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Chat",
      required: true,
    },
  },
  { timestamps: true }
);

export const Message = mongoose.model<IMessage>("Message", MessageSchema);
