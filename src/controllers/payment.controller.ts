import { Booking } from "../models/booking.model";
import { User } from "../models/user.model";
import { Payment } from "../models/payment.model";
import stripe from "../utils/stripe";
import mongoose from "mongoose";
import { Request, Response } from "express";

export const createBookingPayment = async (req: Request, res: Response) => {
  try {
    const { bookingId } = req.body;
console.log("Creating payment for booking ID:", bookingId);
    if (!mongoose.Types.ObjectId.isValid(bookingId))
      return res.status(400).json({ message: "Invalid booking ID" });

    const booking = await Booking.findById(bookingId).populate("renter");
    if (!booking) return res.status(404).json({ message: "Booking not found" });
console.log("Booking found:", booking);
    const user = booking.renter as any;
    if (!user.stripe?.customerId)
      return res.status(400).json({ message: "Stripe customer not found for user" });

  console.log("User Stripe Customer ID:", user.stripe.customerId);

    // Calculate total amount
    let amount = booking.priceDetails.totalPrice;

    if (booking.isExtend && booking.extendCharges?.extendCharges) {
      amount = booking.extendCharges.extendCharges;
    } else if (booking.extraRequestCharges?.additionalCharges) {
      amount = booking.extraRequestCharges.additionalCharges;
    }

    const paymentIntent = await stripe.paymentIntents.create({
      amount: Math.round(amount * 100), // cents
      currency: "usd",
      // customer: user.stripe.customerId,
      metadata: {
        bookingId: (booking._id as mongoose.Types.ObjectId).toString(),
        userId: user._id.toString(),
      },
    });
    console.log("stripe", stripe);
console.log("Payment Intent created:", paymentIntent.id);

    // Save payment record
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
    console.error(error);
    res.status(500).json({ message: "Server error", error });
  }
};



export const stripeWebhook = async (req: Request, res: Response) => {
  const sig = req.headers["stripe-signature"]!;
  let event;

  try {
    event = stripe.webhooks.constructEvent(
      req.body,
      sig,
      process.env.STRIPE_WEBHOOK_SECRET!
    );
  } catch (err: any) {
    console.error("Webhook signature verification failed.", err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  switch (event.type) {
    case "payment_intent.succeeded": {
      const paymentIntent = event.data.object as any;
      const bookingId = paymentIntent.metadata.bookingId;
      const userId = paymentIntent.metadata.userId;

      const booking = await Booking.findById(bookingId);
      if (!booking) break;

      // Update booking status
      booking.status = "approved";

      // Deduct logic
      if (booking.isExtend && booking.extendCharges) {
        // Deduct only from extendCharges
        booking.extendCharges.extendCharges += 150; 
        booking.extendCharges.totalPrice += 150;
      } else if (booking.extraRequestCharges) {
        booking.extraRequestCharges.additionalCharges += 150;
        booking.extraRequestCharges.totalPrice += 150;
      } else {
        booking.priceDetails.totalPrice += 150;
      }

      await booking.save();

      // Update payment record
      await Payment.findOneAndUpdate(
        { paymentIntentId: paymentIntent.id },
        { status: "succeeded" }
      );

      break;
    }

    case "payment_intent.payment_failed": {
      const paymentIntent = event.data.object as any;
      console.log("Payment failed for:", paymentIntent.metadata.bookingId);

      await Payment.findOneAndUpdate(
        { paymentIntentId: paymentIntent.id },
        { status: "failed" }
      );
      break;
    }

    default:
      console.log(`Unhandled event type ${event.type}`);
  }

  res.json({ received: true });
};
