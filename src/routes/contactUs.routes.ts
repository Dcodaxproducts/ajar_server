import express from "express";
import {
  createContact,
  getAllContacts,
  updateContact,
  deleteContact,
  getContactById,
} from "../controllers/contactUs.controller";
import { authMiddleware } from "../middlewares/auth.middleware";
import { allowRoles } from "../middlewares/allowRoles";


const router = express.Router();


const useAuth = authMiddleware as any;
const adminOnly = allowRoles(["admin"]) as unknown as express.RequestHandler;

router.post("/", useAuth, adminOnly, createContact);
router.get("/", getAllContacts);
router.get("/:id", getContactById);
router.patch("/:id", useAuth, adminOnly, updateContact);
router.delete("/:id", useAuth, adminOnly, deleteContact);

export default router;
