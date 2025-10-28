import express from "express";

import { authMiddleware } from "../middlewares/auth.middleware";
import { validateRequest } from "../middlewares/validateRequest";
import {
  attachPaymentMethodToCustomer,
  confirmOnboarding,
  createPayment,
  deleteOnboardedAccount,
  getAllPayments,
  handleCreateSubscription,
  handleRefund,
  onBoardVendor,
  transferToVendor,
  verifyPayment,
} from "../controllers/payment.controller";
import {
  createPaymentSchema,
  transferSchema,
  verifyPaymentSchema,
} from "../schemas/payment.schema";
import {
  attachPaymentMethod,
  refundPayment,
} from "../helpers/stripe-functions";

const router = express.Router();

function asyncHandler(fn: any) {
  return function (req: any, res: any, next: any) {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

const useAuth = authMiddleware as any;

router.get("/", useAuth, asyncHandler(getAllPayments));
router.post(
  "/",
  useAuth,
  validateRequest({ body: createPaymentSchema }),
  asyncHandler(createPayment)
);

// attach payment method
router.post(
  "/attach-payment-method",
  //   authMiddleware,
  asyncHandler(attachPaymentMethodToCustomer)
);

/// verify payment
router.post(
  "/verify",
  useAuth,
  validateRequest({ body: verifyPaymentSchema }),
  asyncHandler(verifyPayment)
);

router.get("/onboarding", useAuth, asyncHandler(onBoardVendor));
router.get("/onboarding/status", useAuth, asyncHandler(confirmOnboarding));

router.post(
  "/transfer",
  useAuth,
  validateRequest({ body: transferSchema }),
  asyncHandler(transferToVendor)
);

// delete connected account
router.delete("/onboarding", useAuth, asyncHandler(deleteOnboardedAccount));

// refund payment
router.post("/refund", useAuth, asyncHandler(handleRefund));

/// subscription
router.post("/subscribe", useAuth, asyncHandler(handleCreateSubscription));

export default router;
