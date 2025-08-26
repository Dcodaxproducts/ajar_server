import { Router } from "express";
import {
  createConversation,
  getUserConversations,
  getConversationById,
} from "../controllers/conversation.controller";
import { authMiddleware } from "../middlewares/auth.middleware";

const router = Router();

// All conversation routes require authentication
router.use(authMiddleware);

// Create or get existing conversation
router.post("/", createConversation);

// Get all conversations for the logged-in user
router.get("/", getUserConversations);

// Get a single conversation by ID
router.get("/:conversationId", getConversationById);

export default router;
