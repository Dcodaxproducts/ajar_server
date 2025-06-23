import { NextFunction, Request, Response } from "express";
import { Chat } from "../models/chat.model";
import { sendResponse } from "../utils/response";
import { STATUS_CODES } from "../config/constants";
import { AuthRequest } from "../types/express";
import { RentRequest } from "../models/rentRequest.model";
// import { redis } from "../utils/redis.client";

export const getAllRentRequests = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
  } catch (error) {
    next(error);
  }
};

export const createRentRequest = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const { submissionId, bookingDates } = req.body;
    const userId = req.user?.id;

    if (!submissionId || !bookingDates) {
      sendResponse(res, {
        statusCode: STATUS_CODES.BAD_REQUEST,
        message: "Submission ID and booking dates are required",
      });
      return;
    }

    const rentRequest = new RentRequest({
      submission: submissionId,
      user: userId,
      bookingDates,
    });

    const requestService = await rentRequest.save();

    sendResponse(res, {
      statusCode: STATUS_CODES.CREATED,
      message: "Rent request created successfully",
      data: requestService,
    });

    // const chat = await Chat.findOne({
    //   members: { $all: [userId, submissionId] },
    // });
    // if (!chat) {
    //   const newChat = new Chat({
    //     members: [userId, submissionId],
    //   });
    //   await newChat.save();
    // }

    // redis.del("chats");
  } catch (error) {
    next(error);
  }
};
