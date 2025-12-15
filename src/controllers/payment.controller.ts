import { Booking } from "../models/booking.model";
import { IUser } from "../models/user.model";
import { Payment } from "../models/payment.model";
import stripe from "../utils/stripe";
import mongoose from "mongoose";
import { Request, Response } from "express";
import { sendNotification } from "../utils/notifications";

// CREATE PAYMENT INTENT
export const createBookingPayment = async (req: Request, res: Response) => {
  try {
    const { bookingId } = req.body;

    console.log(" [PAYMENT INIT] Booking ID:", bookingId);

    if (!mongoose.Types.ObjectId.isValid(bookingId)) {
      return res.status(400).json({ message: "Invalid booking ID" });
    }

    const booking = await Booking.findById(bookingId).populate("renter");
    if (!booking) {
      return res.status(404).json({ message: "Booking not found" });
    }

    const user = booking.renter as any;
    if (!user?.stripe?.customerId) {
      return res
        .status(400)
        .json({ message: "Stripe customer not found for user" });
    }

    // FIX: Price is already calculated in booking controller
    const amount = booking.priceDetails.totalPrice;

    console.log("Charging EXACT booking total:", amount);

    const paymentIntent = await stripe.paymentIntents.create({
      amount: Math.round(amount * 100),
      currency: "usd",
      metadata: {
        bookingId: booking._id.toString(),
        userId: user._id.toString(),
      },
      automatic_payment_methods: {
        enabled: true,
        allow_redirects: "never",
      },
    });

    await Payment.create({
      bookingId: booking._id,
      userId: user._id,
      amount,
      currency: "usd",
      status: "pending",
      paymentIntentId: paymentIntent.id,
      method: "stripe",
    });

    res.status(200).json({
      clientSecret: paymentIntent.client_secret,
      message: "Payment initiated",
    });
  } catch (error) {
    console.error("Payment Intent Error:", error);
    res.status(500).json({ message: "Server error" });
  }
};

// STRIPE WEBHOOK
export const stripeWebhook = async (req: Request, res: Response) => {
  console.log("STRIPE WEBHOOK RECEIVED");

  const sig = req.headers["stripe-signature"];
  if (!sig) return res.status(400).send("Missing Stripe signature");
console.log("Webhook Signature:", sig);
  let event;
  try {
    event = stripe.webhooks.constructEvent(
      req.body,
      sig,
      process.env.STRIPE_WEBHOOK_SECRET!
    );
  } catch (err: any) {
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  try {
    const paymentIntent = event.data.object as any;
    const bookingId = paymentIntent.metadata?.bookingId;

    if (!bookingId) return res.status(400).send("Missing booking ID");

    const booking = await Booking.findById(bookingId)
      .populate("renter")
      .populate("leaser");

    if (!booking) return res.status(404).send("Booking not found");

    const renter = booking.renter as IUser | null;
    const leaser = booking.leaser as IUser | null;

    // PAYMENT SUCCESS
    if (event.type === "payment_intent.succeeded") {
      console.log("Payment confirmed by Stripe");

      booking.status = "approved";
      await booking.save();

      await Payment.findOneAndUpdate(
        { paymentIntentId: paymentIntent.id },
        { status: "succeeded" }
      );

      console.log("updated")

      // Notifications
      if (renter?._id) {
        await sendNotification(
          renter._id.toString(),
          "Payment Successful",
          `Your payment for booking "${booking._id}" was successful.`,
          { bookingId: booking._id.toString(), type: "payment_succeeded" }
        );
      }

      if (leaser?._id) {
        const renterName = renter?.name || "A user";
        await sendNotification(
          leaser._id.toString(),
          "Payment Succeeded",
          `${renterName} completed payment for booking.`,
          { bookingId: booking._id.toString(), type: "payment_succeeded" }
        );
      }
    }

    //  PAYMENT FAILED
    else if (event.type === "payment_intent.payment_failed") {
      console.log(" Payment failed");

      await Payment.findOneAndUpdate(
        { paymentIntentId: paymentIntent.id },
        { status: "failed" }
      );
    }

    res.json({ received: true });
  } catch (err) {
    console.error("Webhook Processing Error:", err);
    res.status(500).send("Webhook processing error");
  }
};
