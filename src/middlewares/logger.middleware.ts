import { Request, Response, NextFunction } from "express";
import morgan from "morgan";
import { logger } from "../utils/logger";

const stream = {
  write: (message: string) => logger.info(message.trim()),
};

export const requestLogger = morgan(
  ":method :url :status :res[content-length] - :response-time ms",
  { stream }
);

export const logRequest = (req: Request, res: Response, next: NextFunction) => {
  logger.info(`[${req.method}] ${req.originalUrl} - IP: ${req.ip}`);
  next();
};
