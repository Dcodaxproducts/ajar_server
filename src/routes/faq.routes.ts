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

router.post("/", authMiddleware, createFAQ);
router.get("/", getAllFAQs);
router.get("/:id", getFAQById);


router.patch(
  "/:id",
  authMiddleware,
  asyncHandler(languageTranslationMiddleware(FAQ)),
  updateFAQ
);

router.delete("/:id", authMiddleware, deleteFAQ);

export default router;
