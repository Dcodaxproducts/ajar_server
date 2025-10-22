import express from "express";
import {
  createContact,
  getAllContacts,
  updateContact,
  deleteContact,
  getContactById,
} from "../controllers/contactUs.controller";
import { authMiddleware, AuthRequest } from "../middlewares/auth.middleware";


const router = express.Router();

// Only admin can create/update/delete
const adminOnly = (
  req: AuthRequest,
  res: express.Response,
  next: express.NextFunction
): void => {
  if (req.user?.role !== "admin") {
    res.status(403).json({ success: false, message: "Forbidden: Admins only" });
    return;
  }
  next();
};

router.post("/", authMiddleware, adminOnly, createContact);
router.get("/", getAllContacts);
router.get("/:id", getContactById);
router.patch("/:id", authMiddleware, adminOnly, updateContact);
router.delete("/:id", authMiddleware, adminOnly, deleteContact);

export default router;
