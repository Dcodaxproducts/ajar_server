import express from "express";
import { createReview, getAllReviews } from "../controllers/review.controller";
import { authMiddleware } from "../middlewares/auth.middleware";

const router = express.Router();

const useAuth = authMiddleware as any;

router.post("/", useAuth, createReview);
router.get("/", getAllReviews);

export default router;
