import { Response } from "express";
import mongoose from "mongoose";
import { Conversation } from "../models/conversation.model";
import { Message } from "../models/message.model";
import { AuthRequest } from "../middlewares/auth.middleware";

// ✅ Send message
export const sendMessage = async (req: AuthRequest, res: Response) => {
  try {
    const { conversationId, receiver, text, attachments } = req.body;
    const sender = new mongoose.Types.ObjectId(req.user!.id);

    // Ensure sender is part of the conversation
    const conversation = await Conversation.findById(conversationId);
    if (
      !conversation ||
      !conversation.participants.some((p) => p.equals(sender))
    ) {
      return res.status(403).json({ error: "Not part of this conversation" });
    }

    const message = await Message.create({
      conversationId,
      sender,
      receiver,
      text,
      attachments,
      status: "sent",
    });

    // Update lastMessage in conversation
    conversation.lastMessage = message._id as mongoose.Types.ObjectId;
    await conversation.save();

    res.status(201).json(message);
  } catch (error) {
    res.status(500).json({ error: "Failed to send message" });
  }
};

// ✅ Get all messages in a conversation
export const getMessages = async (req: AuthRequest, res: Response) => {
  try {
    const { conversationId } = req.params;
    const userId = new mongoose.Types.ObjectId(req.user!.id);

    // Verify user is part of the conversation
    const conversation = await Conversation.findById(conversationId);
    if (
      !conversation ||
      !conversation.participants.some((p) => p.equals(userId))
    ) {
      return res.status(403).json({ error: "Not part of this conversation" });
    }

    const messages = await Message.find({ conversationId })
      .populate("sender", "name email")
      .populate("receiver", "name email")
      .sort({ createdAt: 1 });

    res.status(200).json(messages);
  } catch (error) {
    res.status(500).json({ error: "Failed to fetch messages" });
  }
};

// ✅ Mark message as read
export const markAsRead = async (req: AuthRequest, res: Response) => {
  try {
    const { messageId } = req.params;
    const userId = req.user!.id;

    const message = await Message.findById(messageId);
    if (!message) return res.status(404).json({ error: "Message not found" });

    // Only receiver can mark as read
    if (message.receiver.toString() !== userId) {
      return res.status(403).json({ error: "Not authorized" });
    }

    message.seen = true;
    message.readAt = new Date();
    message.status = "read";
    await message.save();

    res.status(200).json(message);
  } catch (error) {
    res.status(500).json({ error: "Failed to mark as read" });
  }
};

// ✅ Delete message (soft delete)
export const deleteMessage = async (req: AuthRequest, res: Response) => {
  try {
    const { messageId } = req.params;
    const userId = new mongoose.Types.ObjectId(req.user!.id);

    const message = await Message.findById(messageId);
    if (!message) return res.status(404).json({ error: "Message not found" });

    // Only sender or receiver can delete
    if (
      message.sender.toString() !== userId.toString() &&
      message.receiver.toString() !== userId.toString()
    ) {
      return res.status(403).json({ error: "Not authorized" });
    }

    message.deletedAt = new Date();
    message.status = "deleted";
    message.deletedBy = [...(message.deletedBy || []), userId];
    await message.save();

    res.status(200).json(message);
  } catch (error) {
    res.status(500).json({ error: "Failed to delete message" });
  }
};
