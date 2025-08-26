import mongoose, { Schema, Document } from "mongoose";

export interface IMessage extends Document {
  conversationId: mongoose.Types.ObjectId;
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
  status: "sent" | "delivered" | "read" | "deleted";
}

const MessageSchema: Schema<IMessage> = new Schema(
  {
    conversationId: {
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

    // Extra fields
    deliveredAt: { type: Date },
    readAt: { type: Date },
    deletedAt: { type: Date },
    deletedBy: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],
    editedAt: { type: Date },
  },
  { timestamps: true }
);

export const Message = mongoose.model<IMessage>("Message", MessageSchema);
