import express from "express";
import { getMessagesByRoomId } from "../controllers/chat.controller";

const router = express.Router();

router.get("/:roomId", getMessagesByRoomId);

export default router;
