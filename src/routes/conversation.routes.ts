import { Router } from "express";
import {
  createConversation,
  getAllConversations,
  getConversationById,
  getConversationMessages,
} from "../controllers/conversation.controller";
import { authMiddleware } from "../middlewares/auth.middleware";
import { sendMessage } from "../controllers/message.controller";

const router = Router();

function asyncHandler(fn: any) {
  return function (req: any, res: any, next: any) {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

const useAuth = authMiddleware as any;

router.use(useAuth);

router.post("/", asyncHandler(createConversation));
router.post("/send-message", useAuth, asyncHandler(sendMessage));
router.get("/", asyncHandler(getAllConversations));
router.get("/:chatId", asyncHandler(getConversationById));
router.get("/:chatId/messages", asyncHandler(getConversationMessages));

export default router;
