import express from "express";
import {
  getAllDropdowns,
  getDropdownByName,
  createDropdown,
  addValueToDropdown,
  removeValueFromDropdown,
  deleteDropdown,
} from "../controllers/dropdown.controller";
import { authMiddleware } from "../middlewares/auth.middleware";
import { allowRoles } from "../middlewares/allowRoles";

const router = express.Router();

const useAuth = authMiddleware as any;
const adminOnly = allowRoles(["admin"]) as unknown as express.RequestHandler;

router.get("/", useAuth, adminOnly, getAllDropdowns);
router.get("/:name", useAuth, getDropdownByName);
router.post("/", useAuth, adminOnly, createDropdown);
router.post("/:name/value", useAuth, adminOnly, addValueToDropdown);
router.delete("/:name/value/:value", useAuth, adminOnly, removeValueFromDropdown);
router.delete("/:name", useAuth, adminOnly, deleteDropdown);

export default router;
