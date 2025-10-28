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

const useAuth = authMiddleware as any;

// Create ticket
router.post("/", useAuth, asyncHandler(createHelpSupport));

// Update status
router.patch("/:id", useAuth, asyncHandler(updateHelpSupportStatus));

// Get user's own tickets
router.get("/", useAuth, asyncHandler(getMyHelpSupportTickets));

router.get("/:id", asyncHandler(getHelpSupportById));

// Delete ticket by ID
router.delete("/:id", asyncHandler(deleteHelpSupportById));

export default router;
