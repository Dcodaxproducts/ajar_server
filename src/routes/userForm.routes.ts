import { Router } from "express";
import {
  createUserForm,
  getUserForms,
  getUserFormById,
  updateUserForm,
  deleteUserForm,
} from "../controllers/userForm.controller";

const router = Router();

function asyncHandler(fn: any) {
  return function (req: any, res: any, next: any) {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

router.post("/", asyncHandler(createUserForm));
router.get("/", asyncHandler(getUserForms));
router.get("/:id", asyncHandler(getUserFormById));
router.put("/:id", asyncHandler(updateUserForm));
router.delete("/:id", asyncHandler(deleteUserForm));

export default router;
