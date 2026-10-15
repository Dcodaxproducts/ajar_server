import express from "express";
import {
  getMyRefundRequests,
  updateRefundStatus,
  getRefundRequestById,
} from "../controllers/refundRequest.controller";
import { authMiddleware } from "../middlewares/auth.middleware";
import { allowRoles } from "../middlewares/allowRoles";

function asyncHandler(
  fn: (req: express.Request, res: express.Response, next: express.NextFunction) => unknown
): express.RequestHandler {
  return function (req, res, next) {
    Promise.resolve(fn(req, res, next)).then(() => undefined).catch(next);
  };
}

const router = express.Router();
const useAuth = authMiddleware as express.RequestHandler;
const adminOnly = allowRoles(["admin"]) as unknown as express.RequestHandler;

router.use(useAuth, adminOnly);
router.get("/", getMyRefundRequests);
router.get("/:id", getRefundRequestById);
router.patch("/:id/status", asyncHandler(updateRefundStatus));

export default router;
