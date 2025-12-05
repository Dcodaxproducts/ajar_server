import { Booking } from "../models/booking.model";
import { IUser, User } from "../models/user.model";
import { Payment } from "../models/payment.model";
import stripe from "../utils/stripe";
import mongoose from "mongoose";
import { Request, Response } from "express";
import { sendNotification } from "../utils/notifications";

// CREATE PAYMENT INTENT
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

    // Calculate correct amount
    let amount = booking.priceDetails.totalPrice;

    if (booking.isExtend && booking.extendCharges?.extendCharges) {
      amount = booking.extendCharges.extendCharges;
    } else if (booking.extraRequestCharges?.additionalCharges) {
      amount = booking.extraRequestCharges.additionalCharges;
    }

    // ADDED: LOG BEFORE PAYMENT INTENT
    console.log("Creating Stripe PaymentIntent for amount:", amount);

    const paymentIntent = await stripe.paymentIntents.create({
      amount: Math.round(amount * 100), // Convert to cents
      currency: "usd",
      metadata: {
        bookingId: booking._id.toString(),
        userId: user._id.toString(),
      },
    });

    // ADDED: LOG AFTER PAYMENT INTENT
    console.log("Payment Intent created:", paymentIntent.id);

    // Save Payment record
    await Payment.create({
      bookingId: booking._id,
      userId: user._id,
      amount,
      currency: "usd",
      status: "pending", // default, webhook will update it
      paymentIntentId: paymentIntent.id,
      method: "stripe",
    });

    // Notify Leaser (Before payment)
    try {
      const leaser = booking.leaser as any;
      if (leaser) {
        const renterName = user.name || user.email || "A user";
        await sendNotification(
          leaser._id.toString(),
          "Payment Pending",
          `${renterName} has initiated booking "${booking.marketplaceListingId}" and payment is pending.`,
          { bookingId: booking._id.toString(), type: "payment_pending" }
        );
      }
    } catch (err) {
      console.error("Failed to notify leaser before payment:", err);
    }

    res.status(200).json({
      clientSecret: paymentIntent.client_secret,
      message: "Payment initiated",
    });
  } catch (error) {
    console.error("Payment Intent Error:", error);
    res.status(500).json({ message: "Server error", error });
  }
};

// STRIPE WEBHOOK
export const stripeWebhook = async (req: Request, res: Response) => {
  // ADDED: RAW WEBHOOK LOGS
  console.log("------ STRIPE WEBHOOK RECEIVED ------");
  console.log("Headers:", req.headers);
  console.log("Raw Body Length:", req.body?.length);

  const sig = req.headers["stripe-signature"];
  if (!sig) return res.status(400).send("Missing Stripe signature");

  let event;
  try {
    // Verify Stripe signature
    event = stripe.webhooks.constructEvent(
      req.body,
      sig,
      process.env.STRIPE_WEBHOOK_SECRET!
    );
  } catch (err: any) {
    console.error("Webhook signature verification failed:", err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  // ADDED: FULL EVENT LOGGING
  console.log("Webhook event type:", event.type);
  console.log("Event Data:", event.data.object);

  try {
    const paymentIntent = event.data.object as any;
    const bookingId: string = paymentIntent.metadata?.bookingId;

    if (!bookingId) {
      console.error("Booking ID missing in PaymentIntent metadata");
      return res.status(400).send("Missing booking ID");
    }

    const booking = await Booking.findById(bookingId)
      .populate("renter")
      .populate("leaser");

    if (!booking) {
      console.error("Booking not found for ID:", bookingId);
      return res.status(404).send("Booking not found");
    }

    const renter = booking.renter as IUser | null;
    const leaser = booking.leaser as IUser | null;

    // PAYMENT SUCCEEDED
    if (event.type === "payment_intent.succeeded") {
      console.log("✔ Webhook: Payment Succeeded for:", paymentIntent.id);

      booking.status = "approved";

      // Add extra 150 charges as per your rules
      if (booking.isExtend && booking.extendCharges) {
        booking.extendCharges.extendCharges += 150;
        booking.extendCharges.totalPrice += 150;
      } else if (booking.extraRequestCharges) {
        booking.extraRequestCharges.additionalCharges += 150;
        booking.extraRequestCharges.totalPrice += 150;
      } else {
        booking.priceDetails.totalPrice += 150;
      }

      await booking.save();

      // Update Payment Success
      await Payment.findOneAndUpdate(
        { paymentIntentId: paymentIntent.id },
        { status: "succeeded" },
        { new: true }
      );

      console.log("✔ Payment marked as succeeded in DB");

      // Notifications
      if (renter?._id) {
        try {
          await sendNotification(
            renter._id.toString(),
            "Payment Successful",
            `Your payment for booking "${booking._id}" was successful.`,
            { bookingId: booking._id.toString(), type: "payment_succeeded" }
          );
        } catch (err) {
          console.error("Notify renter failed:", err);
        }
      }

      if (leaser?._id) {
        try {
          const renterName = renter?.name || "A user";
          await sendNotification(
            leaser._id.toString(),
            "Payment Succeeded",
            `${renterName} completed payment for booking "${booking._id}".`,
            { bookingId: booking._id.toString(), type: "payment_succeeded" }
          );
        } catch (err) {
          console.error("Notify leaser failed:", err);
        }
      }
    }

    // PAYMENT FAILED
    else if (event.type === "payment_intent.payment_failed") {
      console.log("✖ Webhook: Payment FAILED for:", paymentIntent.id);

      await Payment.findOneAndUpdate(
        { paymentIntentId: paymentIntent.id },
        { status: "failed" },
        { new: true }
      );

      console.log("✖ Payment marked as FAILED in DB");

      // Notifications
      if (renter?._id) {
        try {
          await sendNotification(
            renter._id.toString(),
            "Payment Failed",
            `Your payment for booking "${booking._id}" failed.`,
            { bookingId: booking._id.toString(), type: "payment_failed" }
          );
        } catch (err) {
          console.error("Notify renter failed:", err);
        }
      }

      if (leaser?._id) {
        try {
          const renterName = renter?.name || "A user";
          await sendNotification(
            leaser._id.toString(),
            "Payment Failed",
            `${renterName} failed to complete payment for booking "${booking._id}".`,
            { bookingId: booking._id.toString(), type: "payment_failed" }
          );
        } catch (err) {
          console.error("Notify leaser failed:", err);
        }
      }
    }

    res.json({ received: true });
  } catch (err) {
    console.error("Webhook Processing Error:", err);
    res.status(500).send("Webhook processing error");
  }
};
