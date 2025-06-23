import { Request, Response, NextFunction } from "express";
import { STATUS_CODES, ERROR_MESSAGES } from "../config/constants";
import { ZodError } from "zod";
import { sendResponse } from "../utils/response";

export const errorHandler = (
  err: any,
  req: Request,
  res: Response,
  next: NextFunction
) => {
  if (err instanceof ZodError) {
    sendResponse(
      res,
      err.errors,
      ERROR_MESSAGES.VALIDATION_ERROR,
      STATUS_CODES.BAD_REQUEST
    );
  } else {
    sendResponse(
      res,
      null,
      err.message || ERROR_MESSAGES.INTERNAL_SERVER_ERROR,
      err.statusCode || STATUS_CODES.INTERNAL_SERVER_ERROR
    );
  }
  next();
};
