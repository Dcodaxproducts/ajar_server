import { Request, Response } from "express";
import { Chat } from "../models/chat.model";

export const getMessagesByRoomId = async (req: Request, res: Response) => {
  const { roomId } = req.params;
  const messages = await Chat.find({ roomId }).sort({ createdAt: 1 });
  res.json(messages);
};
