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

function asyncHandler(fn: any) {
  return function (req: any, res: any, next: any) {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}


const useAuth = authMiddleware as any;

router.post("/", useAuth, asyncHandler(adminOnly), createContact);
router.get("/", getAllContacts);
router.get("/:id", getContactById);
router.patch("/:id", useAuth, asyncHandler(adminOnly), updateContact);
router.delete("/:id", useAuth, asyncHandler(adminOnly), deleteContact);

export default router;
