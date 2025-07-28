import express from "express";
import { createReview, getAllReviews } from "../controllers/review.controller";
import { authMiddleware } from "../middlewares/auth.middleware";

const router = express.Router();

router.post("/", authMiddleware, createReview);
router.get("/", getAllReviews);

export default router;
