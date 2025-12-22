import express from "express";
import {
  createFAQ,
  getAllFAQs,
  getFAQById,
  updateFAQ,
  deleteFAQ,
} from "../controllers/faq.controller";
import { authMiddleware } from "../middlewares/auth.middleware";
import { languageTranslationMiddleware } from "../middlewares/languageTranslation.middleware";
import { FAQ } from "../models/faq.model";

const router = express.Router();

function asyncHandler(fn: any) {
  return function (req: any, res: any, next: any) {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

const useAuth = authMiddleware as any;

router.post("/", useAuth, createFAQ);
router.get("/", getAllFAQs);
router.get("/:id", getFAQById);
router.patch(
  "/:id",
  useAuth,
  asyncHandler(languageTranslationMiddleware(FAQ)),
  updateFAQ
);
router.delete("/:id", useAuth, deleteFAQ);

export default router;
