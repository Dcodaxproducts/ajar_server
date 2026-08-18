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
  // The Stripe webhook is mounted before the i18n middleware, so req.t can be
  // missing here — fall back to the English constants for those requests.
  const translate = (key: string, fallback: string) =>
    typeof req.t === "function" ? req.t(key) : fallback;

  if (err instanceof ZodError) {
    sendResponse(
      res,
      err.errors,
      translate("common:validationError", ERROR_MESSAGES.VALIDATION_ERROR),
      STATUS_CODES.BAD_REQUEST
    );
  } else {
    sendResponse(
      res,
      null,
      err.message ||
        translate(
          "common:somethingWentWrong",
          ERROR_MESSAGES.INTERNAL_SERVER_ERROR
        ),
      err.statusCode || STATUS_CODES.INTERNAL_SERVER_ERROR
    );
  }
  next();
};
