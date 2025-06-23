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

router.get("/", authMiddleware, getAllPayments);
router.post(
  "/",
  authMiddleware,
  validateRequest({ body: createPaymentSchema }),
  createPayment
);

// attach payment method
router.post(
  "/attach-payment-method",
  //   authMiddleware,
  attachPaymentMethodToCustomer
);

/// verify payment
router.post(
  "/verify",
  authMiddleware,
  validateRequest({ body: verifyPaymentSchema }),
  verifyPayment
);

router.get("/onboarding", authMiddleware, onBoardVendor);
router.get("/onboarding/status", authMiddleware, confirmOnboarding);

// transfrer to connected account

router.post(
  "/transfer",
  authMiddleware,
  validateRequest({ body: transferSchema }),
  transferToVendor
);

// delete connected account
router.delete("/onboarding", authMiddleware, deleteOnboardedAccount);

// refund payment
router.post("/refund", authMiddleware, handleRefund);

/// subscription
router.post("/subscribe", authMiddleware, handleCreateSubscription);

export default router;
