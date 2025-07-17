import express from "express";
import { validateRequest } from "../middlewares/validateRequest";
import { createChat, getAllChats } from "../controllers/chat.controller";
import { authMiddleware } from "../middlewares/auth.middleware";

const router = express.Router();

router.get("/", getAllChats);
router.post(
  "/",
  authMiddleware,
  createChat
);
export default router;
