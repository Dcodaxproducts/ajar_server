import express from "express";
import {
  getAllDropdowns,
  getDropdownByName,
  createDropdown,
  addValueToDropdown,
  removeValueFromDropdown,
  deleteDropdown,
} from "../controllers/dropdown.controller";

const router = express.Router();

router.get("/", getAllDropdowns);
router.get("/:name", getDropdownByName);
router.post("/", createDropdown);
router.post("/:name/value", addValueToDropdown);
router.delete("/:name/value/:value", removeValueFromDropdown);
router.delete("/:name", deleteDropdown);

export default router;
