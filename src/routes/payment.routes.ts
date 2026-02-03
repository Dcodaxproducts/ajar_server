import express from "express";
import { createBookingPayment, verifyPayment } from "../controllers/payment.controller";
import { authMiddleware } from "../middlewares/auth.middleware";

const router = express.Router();
const useAuth = authMiddleware as any;
//Create Payment Intent for a Booking
router.post("/stripe/intent", useAuth, createBookingPayment as express.RequestHandler);

// router.post("/stripe/verify", useAuth, verifyPayment as express.RequestHandler);


export default router;
