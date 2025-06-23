import { Response } from "express";
import { STATUS_CODES } from "../config/constants";

export const sendResponse = (
  res: Response,
  data: any = null,
  message: string = "Success",
  statusCode: number = STATUS_CODES.OK
) => {
  return res.status(statusCode).json({
    success: statusCode < 400,
    message,
    data,
  });
};
