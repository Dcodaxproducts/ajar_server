import express from "express";
import { createBookingPayment, stripeWebhook } from "../controllers/payment.controller";

const router = express.Router();

//Create Payment Intent for a Booking
router.post("/stripe/intent", createBookingPayment as express.RequestHandler);

//Stripe Webhook endpoint
// NOTE: Must use raw body parser for Stripe signature verification
router.post(
  "/stripe/webhook",
  express.raw({ type: "application/json" }),
  stripeWebhook as express.RequestHandler
);

export default router;
