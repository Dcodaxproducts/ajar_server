import { NextFunction, Request, Response } from "express";
import { Chat } from "../models/chat.model";
import { sendResponse } from "../utils/response";
import { STATUS_CODES } from "../config/constants";
import { AuthRequest } from "../types/express";
// import { redis } from "../utils/redis.client";

export const getAllChats = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    // console.time("API Execution Time");
    // console.time("Redis Fetch");
    // const cachedChats = await redis.get("chats");
    // console.timeEnd("Redis Fetch");
    // if (cachedChats) {
    //   console.timeEnd("API Execution Time");
    //   res
    //     .status(200)
    //     .json({ message: "Cached chats", data: JSON.parse(cachedChats) });
    // }
    // console.time("DB Fetch");
    // const allChats = await Chat.find().populate("users", "name email").lean();
    // console.timeEnd("DB Fetch");
    // console.time("Redis Store");
    // await redis.setex("chats", 300, JSON.stringify(allChats));
    // console.timeEnd("Redis Store");
    // console.timeEnd("API Execution Time");
    // res.status(200).json({ message: "Fetched from DB", data: allChats });
  } catch (error) {
    next(error);
  }
};

export const createChat = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const { createdFor } = req.body;
    const userId = req.user?.id;

    const existingChat = await Chat.findOne({
      users: { $all: [userId, createdFor] },
    })
      .select("_id")
      .lean();

    if (existingChat) {
      sendResponse(res, req.body, "Chat already exists", STATUS_CODES.CONFLICT);
      return;
    }
    const chatData = new Chat({
      users: [userId, createdFor],
    });
    console.log({ chatData });
    await chatData.save();
    sendResponse(
      res,
      req.body,
      "Chat created successfully",
      STATUS_CODES.CREATED
    );
  } catch (error) {
    next(error);
  }
};
