import express from "express";
import {
  createHelpSupport,
  updateHelpSupportStatus,
  getMyHelpSupportTickets,
  getHelpSupportById,
  deleteHelpSupportById,
} from "../controllers/helpSupport.controller";
import { authMiddleware } from "../middlewares/auth.middleware";

const router = express.Router();

function asyncHandler(fn: any) {
  return function (req: any, res: any, next: any) {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

// Create ticket
router.post("/", authMiddleware, asyncHandler(createHelpSupport));

// Update status (admin or self - you can enhance this logic)
router.patch("/:id", authMiddleware, asyncHandler(updateHelpSupportStatus));

// Get user's own tickets
router.get("/", authMiddleware, asyncHandler(getMyHelpSupportTickets));

router.get("/:id", asyncHandler(getHelpSupportById));

// Delete ticket by ID
router.delete("/:id", asyncHandler(deleteHelpSupportById));

export default router;
