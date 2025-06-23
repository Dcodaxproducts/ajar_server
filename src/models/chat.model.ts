import mongoose, { Document } from "mongoose";
import { Schema, model } from "mongoose";

export interface IChat extends Document {
  users: string[];
  messages: string[];
}

const chatSchema = new Schema(
  {
    users: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
        required: true,
      },
    ],
    messages: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Message",
    },
  },
  {
    timestamps: true,
  }
);

export const Chat = model<IChat>("Chat", chatSchema);
