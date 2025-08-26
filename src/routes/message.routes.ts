import { Router } from "express";
import {
  sendMessage,
  getMessages,
  markAsRead,
  deleteMessage,
} from "../controllers/message.controller";
import { authMiddleware } from "../middlewares/auth.middleware";

const router = Router();

function asyncHandler(fn: any) {
  return function (req: any, res: any, next: any) {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}
// Send a new message
router.post("/", authMiddleware, asyncHandler(sendMessage));

// Get all messages in a conversation
router.get("/:conversationId", authMiddleware, asyncHandler(getMessages));

// Mark a message as read
router.patch("/read/:messageId", authMiddleware, asyncHandler(markAsRead));

// Delete a message (soft delete)
router.delete("/:messageId", authMiddleware, asyncHandler(deleteMessage));

export default router;
