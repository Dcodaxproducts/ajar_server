import express from "express";
import { createBookingPayment, stripeWebhook } from "../controllers/payment.controller";

const router = express.Router();

router.post(
  "/stripe/webhook",
  express.raw({ type: "application/json" }),
  stripeWebhook as express.RequestHandler
);

//Create Payment Intent for a Booking
router.post("/stripe/intent", createBookingPayment as express.RequestHandler);

export default router;
