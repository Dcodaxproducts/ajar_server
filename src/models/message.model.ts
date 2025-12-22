import mongoose, { Schema, Document } from "mongoose";

export interface IMessage extends Document {
  chatId: mongoose.Types.ObjectId;
  sender: mongoose.Types.ObjectId;
  receiver: mongoose.Types.ObjectId;
  text: string;
  attachments?: string[];
  seen: boolean;
  deliveredAt?: Date;
  readAt?: Date;
  deletedAt?: Date;
  deletedBy?: mongoose.Types.ObjectId[];
  editedAt?: Date;
}

const MessageSchema: Schema<IMessage> = new Schema(
  {
    chatId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Conversation",
      required: true,
    },
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
    text: { type: String, trim: true },
    attachments: [{ type: String }],
    seen: { type: Boolean, default: false },

    deliveredAt: { type: Date },
    readAt: { type: Date },
    deletedAt: { type: Date },
    deletedBy: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],
    editedAt: { type: Date },
  },
  { timestamps: true }
);

export const Message = mongoose.model<IMessage>("Message", MessageSchema);
