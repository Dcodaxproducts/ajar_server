import express from "express";
import {
  createFAQ,
  getAllFAQs,
  getFAQById,
  updateFAQ,
  deleteFAQ,
} from "../controllers/faq.controller";
import { authMiddleware } from "../middlewares/auth.middleware";

const router = express.Router();

router.post("/", authMiddleware, createFAQ);
router.get("/", getAllFAQs);
router.get("/:id", getFAQById);
router.patch("/:id", authMiddleware, updateFAQ);
router.delete("/:id", authMiddleware, deleteFAQ);

export default router;
