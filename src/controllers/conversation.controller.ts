import { Response, NextFunction } from "express";
import { Conversation } from "../models/conversation.model";
import { AuthRequest } from "../middlewares/auth.middleware";
import mongoose from "mongoose";
import { Message } from "../models/message.model";
import { paginateQuery } from "../utils/paginate";
import { sendResponse } from "../utils/response";
import { STATUS_CODES } from "../config/constants";

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

// Get all conversations for logged-in user with pagination
export const getAllConversations = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    const { page = 1, limit = 10 } = req.query;
    const userId = new mongoose.Types.ObjectId(req.user!.id);

    const baseQuery = Conversation.find({ participants: userId })
      .populate("participants", "name email ")
      .populate({
        path: "lastMessage",
        populate: [
          { path: "sender", select: "name email profilePicture" },
          { path: "receiver", select: "name email profilePicture" },
        ],
      })
      .sort({ updatedAt: -1 });

    const { data: conversations, total } = await paginateQuery(baseQuery, {
      page: Number(page),
      limit: Number(limit),
    });

    // Add unread count for each conversation
    const conversationsWithUnread = await Promise.all(
      conversations.map(async (conv) => {
        const unreadCount = await Message.countDocuments({
          conversationId: conv._id,
          receiver: userId,
          seen: false,
        });

        const convObj = conv.toObject() as any;
        convObj.unreadCount = unreadCount;
        return convObj;
      })
    );

    sendResponse(
      res,
      {
        chats: conversationsWithUnread,
        total,
        page: Number(page),
        limit: Number(limit),
        // totalPages: Math.ceil(total / Number(limit)),
      },
      "Conversations fetched successfully",
      STATUS_CODES.OK
    );
  } catch (error) {
    next(error);
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
