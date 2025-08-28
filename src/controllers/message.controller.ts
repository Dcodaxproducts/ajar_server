import { Response } from "express";
import mongoose from "mongoose";
import { Conversation } from "../models/conversation.model";
import { Message } from "../models/message.model";
import { AuthRequest } from "../middlewares/auth.middleware";

// Send message
export const sendMessage = async (req: AuthRequest, res: Response) => {
  try {
    const { chatId, receiver, text, attachments } = req.body;
    const sender = new mongoose.Types.ObjectId(req.user!.id);
    const receiverId = new mongoose.Types.ObjectId(receiver);

    // Ensure conversation exists
    const conversation = await Conversation.findById(chatId);
    if (!conversation) {
      return res.status(404).json({ error: "Conversation not found" });
    }

    // Ensure sender or receiver is participant
    if (
      !conversation.participants.some(
        (p) => p.equals(sender) || p.equals(receiverId)
      )
    ) {
      return res
        .status(403)
        .json({ error: "You are not allowed in this chat" });
    }

    // Create message
    const newMessage = await Message.create({
      chatId: conversation._id,
      sender,
      receiver: receiverId,
      text,
      attachments,
      seen: false,
    });

    // Update lastMessage
    conversation.lastMessage = newMessage._id as mongoose.Types.ObjectId;
    await conversation.save();

    // Populate sender and receiver before sending response
    const populatedMessage = await Message.findById(newMessage._id)
      .populate("sender", "name email profilePicture")
      .populate("receiver", "name email profilePicture");

    res.status(201).json({
      success: true,
      message: "Message sent successfully",
      data: populatedMessage,
    });
  } catch (error) {
    console.error("Send message error:", error);
    res.status(500).json({ error: "Failed to send message" });
  }
};
