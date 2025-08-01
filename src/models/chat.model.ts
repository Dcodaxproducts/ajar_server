import mongoose, { Document, Schema } from "mongoose";

export interface IChatMessage extends Document {
  senderId: string;
  receiverId: string;
  message: string;
  roomId: string;
  createdAt: Date;
}

const ChatSchema = new Schema<IChatMessage>({
  senderId: { type: String, required: true },
  receiverId: { type: String, required: true },
  message: { type: String, required: true },
  roomId: { type: String, required: true },
  createdAt: { type: Date, default: Date.now },
});

export const Chat = mongoose.model<IChatMessage>("Chat", ChatSchema);
