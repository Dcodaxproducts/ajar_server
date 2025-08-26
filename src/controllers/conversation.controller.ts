import { Response } from "express";
import { Conversation } from "../models/conversation.model";
import { AuthRequest } from "../middlewares/auth.middleware";

// Create or get existing conversation
export const createConversation = async (req: AuthRequest, res: Response) => {
  try {
    const senderId = req.user!.id; // logged-in user
    const { receiverId, adId } = req.body;

    let conversation = await Conversation.findOne({
      participants: { $all: [senderId, receiverId] },
      adId: adId || null,
    });

    if (!conversation) {
      conversation = await Conversation.create({
        participants: [senderId, receiverId],
        adId,
      });
    }

    res.status(200).json(conversation);
  } catch (error) {
    res.status(500).json({ error: "Failed to create conversation" });
  }
};

// Get all conversations for logged-in user
export const getUserConversations = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user!.id;

    const conversations = await Conversation.find({
      participants: userId,
    })
      .populate("participants", "name email")
      .populate("lastMessage")
      .sort({ updatedAt: -1 });

    res.status(200).json(conversations);
  } catch (error) {
    res.status(500).json({ error: "Failed to fetch conversations" });
  }
};

// Get conversation by ID
export const getConversationById = async (
  req: AuthRequest,
  res: Response
): Promise<void> => {
  try {
    const { conversationId } = req.params;
    const userId = req.user!.id;

    const conversation = await Conversation.findById(conversationId)
      .populate("participants", "name email")
      .populate("lastMessage");

    if (!conversation) {
      res.status(404).json({ error: "Conversation not found" });
      return;
    }

    // Ensure logged-in user is part of the conversation
    if (!conversation.participants.some((id) => id.toString() === userId)) {
      res.status(403).json({ error: "Access denied" });
      return;
    }

    res.status(200).json(conversation);
  } catch (error) {
    res.status(500).json({ error: "Failed to fetch conversation" });
  }
};
