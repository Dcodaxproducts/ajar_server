import { Response, NextFunction } from "express";
import mongoose from "mongoose";
import { Conversation } from "../models/conversation.model";
import { Message } from "../models/message.model";
import { AuthRequest } from "../middlewares/auth.middleware";
import { paginateQuery } from "../utils/paginate";
import { sendResponse } from "../utils/response";
import { STATUS_CODES } from "../config/constants";
import { User } from "../models/user.model";

// Create or get existing conversation
// Create or get existing conversation
export const createConversation = async (req: AuthRequest, res: Response) => {
  try {
    // ✅ UPDATED: Support "receiverId" instead of "receiver"
    const receiverStr = req.body.receiverId || req.body.receiver;

    if (!receiverStr) {
      return sendResponse(
        res,
        null,
        "Receiver ID is required",
        STATUS_CODES.BAD_REQUEST
      );
    }

    if (!mongoose.Types.ObjectId.isValid(receiverStr)) {
      return sendResponse(
        res,
        null,
        "Invalid receiver ID",
        STATUS_CODES.BAD_REQUEST
      );
    }

    const sender = new mongoose.Types.ObjectId(req.user!.id);
    const receiver = new mongoose.Types.ObjectId(receiverStr); // ✅ uses correct receiver id
    const adId = req.body.adId
      ? new mongoose.Types.ObjectId(req.body.adId)
      : undefined;

    // Check if conversation already exists
    let conversation = await Conversation.findOne({
      participants: { $all: [sender, receiver] },
      adId: adId || null,
    });

    if (!conversation) {
      conversation = await Conversation.create({
        participants: [sender, receiver],
        adId,
      });
    }

    // ✅ Only show participant IDs in response
    const responseData = {
      participants: conversation.participants,
      _id: conversation._id,
      createdAt: conversation.createdAt,
      updatedAt: conversation.updatedAt,
      __v: conversation.__v,
    };

    sendResponse(
      res,
      responseData,
      "Conversation fetched/created successfully",
      STATUS_CODES.OK
    );
  } catch (error) {
    console.error("Create conversation error:", error);
    sendResponse(
      res,
      null,
      "Failed to create conversation",
      STATUS_CODES.INTERNAL_SERVER_ERROR
    );
  }
};


// Create or get existing conversation
// export const createConversation = async (req: AuthRequest, res: Response) => {
//   try {
//     // ✅ Accept multiple possible keys (receiver, receiverId, receiver_id)
//     const receiverStr =
//       req.body.receiver ||
//       req.body.receiverId ||
//       req.body.receiver_id ||
//       req.body.to; // optional aliases

//     // ✅ Validate input presence
//     if (!receiverStr) {
//       return sendResponse(
//         res,
//         null,
//         "Receiver id is required (body: { receiver: '<id>' })",
//         STATUS_CODES.BAD_REQUEST
//       );
//     }

//     // ✅ Validate as ObjectId
//     if (!mongoose.Types.ObjectId.isValid(receiverStr)) {
//       return sendResponse(
//         res,
//         null,
//         "Invalid receiver id",
//         STATUS_CODES.BAD_REQUEST
//       );
//     }

//     const sender = new mongoose.Types.ObjectId(req.user!.id);
//     const receiver = new mongoose.Types.ObjectId(receiverStr);

//     // Prevent creating conversation with self
//     if (sender.equals(receiver)) {
//       return sendResponse(
//         res,
//         null,
//         "You cannot start a conversation with yourself",
//         STATUS_CODES.BAD_REQUEST
//       );
//     }

//     const adId = req.body.adId ? new mongoose.Types.ObjectId(req.body.adId) : null;

//     // ✅ Ensure receiver exists in users collection
//     const receiverUser = await User.findById(receiver).select("_id name email");
//     if (!receiverUser) {
//       return sendResponse(
//         res,
//         null,
//         "Receiver user not found",
//         STATUS_CODES.NOT_FOUND
//       );
//     }

//     // Build query (only include adId if provided)
//     const query: any = { participants: { $all: [sender, receiver] } };
//     if (adId) query.adId = adId;

//     // Check if conversation already exists
//     let conversation = await Conversation.findOne(query);

//     if (!conversation) {
//       conversation = await Conversation.create({
//         participants: [sender, receiver],
//         adId,
//       });
//     }

//     // ✅ Populate participants so response contains user objects not raw ids
//     await conversation.populate({
//       path: "participants",
//       select: "name email profilePicture",
//     });

//     sendResponse(
//       res,
//       conversation,
//       "Conversation fetched/created successfully",
//       STATUS_CODES.OK
//     );
//   } catch (error) {
//     console.error("Create conversation error:", error);
//     sendResponse(
//       res,
//       null,
//       "Failed to create conversation",
//       STATUS_CODES.INTERNAL_SERVER_ERROR
//     );
//   }
// };


// Get all conversations for logged-in user
export const getAllConversations = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    const { page = 1, limit = 10 } = req.query;
    const userId = new mongoose.Types.ObjectId(req.user!.id);

    const baseQuery = Conversation.find({ participants: { $in: [userId] } })
      .populate("participants", "name email profilePicture")
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
          chatId: conv._id,
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
      },
      "Conversations fetched successfully",
      STATUS_CODES.OK
    );
  } catch (error) {
    next(error);
  }
};

// Get conversation by ID
export const getConversationById = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    const chatId = req.params.chatId;
    const userId = new mongoose.Types.ObjectId(req.user!.id);

    const conversation = await Conversation.findOne({
      _id: new mongoose.Types.ObjectId(chatId),
      participants: { $in: [userId] },
    })
      .populate("participants", "name email profilePicture")
      .populate({
        path: "lastMessage",
        populate: [
          { path: "sender", select: "name email profilePicture" },
          { path: "receiver", select: "name email profilePicture" },
        ],
      });

    if (!conversation) {
      return sendResponse(
        res,
        null,
        "Conversation not found or you are not a participant",
        STATUS_CODES.NOT_FOUND
      );
    }

    sendResponse(
      res,
      conversation,
      "Conversation fetched successfully",
      STATUS_CODES.OK
    );
  } catch (error) {
    next(error);
  }
};

// Get all messages of a conversation
export const getConversationMessages = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    const chatId = req.params.chatId;
    const { page = 1, limit = 20 } = req.query;
    const userId = new mongoose.Types.ObjectId(req.user!.id);

    // Check if user is a participant
    const conversation = await Conversation.findById(chatId);

    if (!conversation) {
      return sendResponse(
        res,
        null,
        "Not authorised or conversation not found",
        STATUS_CODES.FORBIDDEN
      );
    }
    const { participants = [] } = conversation;

    const receiverId = participants.find(
      (p: mongoose.Types.ObjectId) => p.toString() !== userId.toString()
    );
    if (!receiverId) {
      return sendResponse(
        res,
        null,
        "Not authorised or conversation not found",
        STATUS_CODES.FORBIDDEN
      );
    }

    // Fetch receiver details safely
    const receiver = await User.findById(receiverId).select(
      "name email profilePicture"
    );

    if (!receiver) {
      return sendResponse(
        res,
        null,
        "Receiver not found or deleted",
        STATUS_CODES.NOT_FOUND
      );
    }

    const baseQuery = Message.find({ chatId: conversation._id })
      .populate("sender", "name email profilePicture")
      .populate("receiver", "name email profilePicture")
      .sort({ createdAt: -1 });

    const { data: messages, total } = await paginateQuery(baseQuery, {
      page: Number(page),
      limit: Number(limit),
    });

    sendResponse(
      res,
      { messages, receiver, total, page: Number(page), limit: Number(limit) },
      "Messages fetched successfully",
      STATUS_CODES.OK
    );
  } catch (error) {
    next(error);
  }
};
