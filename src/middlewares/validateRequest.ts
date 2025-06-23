import { Request, Response, NextFunction } from "express";
import { ZodSchema, ZodError } from "zod";
import { STATUS_CODES, ERROR_MESSAGES } from "../config/constants";

interface ValidationSchemas {
  body?: ZodSchema;
  params?: ZodSchema;
  query?: ZodSchema;
}

export const validateRequest =
  (schemas: ValidationSchemas) =>
  (req: Request, res: Response, next: NextFunction) => {
    try {
      if (schemas.body) {
        schemas.body.parse(req.body);
      }
      if (schemas.params) {
        schemas.params.parse(req.params);
      }
      if (schemas.query) {
        schemas.query.parse(req.query);
      }
      next();
    } catch (error) {
      if (error instanceof ZodError) {
        res.status(STATUS_CODES.BAD_REQUEST).json({
          success: false,
          message: ERROR_MESSAGES.VALIDATION_ERROR,
          errors: error.errors,
        });
      } else {
        next(error);
      }
    }
  };
