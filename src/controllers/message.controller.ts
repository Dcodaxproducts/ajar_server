import { Response } from "express";
import mongoose from "mongoose";
import { Conversation } from "../models/conversation.model";
import { Message } from "../models/message.model";
import { AuthRequest } from "../middlewares/auth.middleware";
import { getReceiverSocketId, getIO } from "../socket/socket";

// Send message
export const sendMessage = async (req: AuthRequest, res: Response) => {
  try {
    const { chatId, receiver, text, attachments } = req.body;
    const sender = new mongoose.Types.ObjectId(req.user!.id);

    // Ensure conversation exists
    const conversation = await Conversation.findById(chatId);
    if (!conversation) {
      return res.status(404).json({ error: "Conversation not found" });
    }

    // Ensure sender or receiver is participant
    if (
      !conversation.participants.some(
        (p) => p.equals(sender) || p.equals(receiver)
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
      receiver,
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

    // 🔹 Emit with new event name
    const receiverSocketId = getReceiverSocketId(receiver.toString());
    if (receiverSocketId) {
      getIO().to(receiverSocketId).emit("message:new", populatedMessage);
    }

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

// Mark a message as delivered
export const markMessageDelivered = async (req: AuthRequest, res: Response) => {
  try {
    const { messageId } = req.params;
    const userId = new mongoose.Types.ObjectId(req.user!.id);

    const message = await Message.findById(messageId);
    if (!message) {
      return res.status(404).json({ error: "Message not found" });
    }

    // Only the intended receiver can mark delivered
    if (!message.receiver.equals(userId)) {
      return res.status(403).json({ error: "Not authorised" });
    }

    // Only set delivered once
    if (!message.deliveredAt) {
      message.deliveredAt = new Date();
      await message.save();

      // Notify sender
      const senderSocketId = getReceiverSocketId(message.sender.toString());
      if (senderSocketId) {
        getIO().to(senderSocketId).emit("messageDelivered", {
          messageId: message._id,
          chatId: message.chatId,
          deliveredAt: message.deliveredAt,
        });
      }
    }

    res.status(200).json({
      success: true,
      message: "Message marked as delivered",
      data: message,
    });
  } catch (error) {
    console.error("Deliver error:", error);
    res.status(500).json({ error: "Failed to mark delivered" });
  }
};

// Mark all unseen messages in a chat as seen/read
export const markMessagesSeen = async (req: AuthRequest, res: Response) => {
  try {
    const { chatId } = req.params;
    const userId = new mongoose.Types.ObjectId(req.user!.id);

    // Find only unseen messages
    const unseenMessages = await Message.find({
      chatId,
      receiver: userId,
      seen: false,
    });

    if (unseenMessages.length === 0) {
      return res
        .status(200)
        .json({ success: true, message: "No unseen messages" });
    }

    // ✅ Update each unseen message
    const now = new Date();
    await Message.updateMany(
      { _id: { $in: unseenMessages.map((m) => m._id) } },
      { $set: { seen: true, readAt: now } }
    );

    // ✅ Notify senders only for newly seen messages
    unseenMessages.forEach((msg) => {
      const senderSocketId = getReceiverSocketId(msg.sender.toString());
      if (senderSocketId) {
        getIO().to(senderSocketId).emit("messageSeen", {
          messageId: msg._id,
          chatId,
          readAt: now,
        });
      }
    });

    res.status(200).json({
      success: true,
      message: "Messages marked as seen",
      count: unseenMessages.length,
    });
  } catch (error) {
    console.error("Seen error:", error);
    res.status(500).json({ error: "Failed to mark messages seen" });
  }
};
