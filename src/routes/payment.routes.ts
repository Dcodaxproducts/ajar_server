import express from "express";
import { createBookingPayment, verifyPayment } from "../controllers/payment.controller";
import { authMiddleware } from "../middlewares/auth.middleware";

const router = express.Router();
const useAuth = authMiddleware as any;

function asyncHandler(fn: any) {
  return function (req: any, res: any, next: any) {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

//Create Payment Intent for a Booking
router.post("/stripe/intent", useAuth, createBookingPayment as express.RequestHandler);

router.post("/stripe/verify", useAuth, asyncHandler(verifyPayment));


export default router;
