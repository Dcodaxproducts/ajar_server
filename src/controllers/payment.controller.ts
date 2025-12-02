import { Booking } from "../models/booking.model";
import { IUser, User } from "../models/user.model";
import { Payment } from "../models/payment.model";
import stripe from "../utils/stripe";
import mongoose from "mongoose";
import { Request, Response } from "express";
import { sendNotification } from "../utils/notifications";

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

     // ------------------ NEW: Notify leaser BEFORE payment ------------------
    try {
      const leaser = booking.leaser as any;
      if (leaser) {
        const renterName = user.name || user.email || "A user";
        await sendNotification(
          leaser._id?.toString(),
          "Payment Pending",
          `${renterName} has initiated booking for "${booking.marketplaceListingId}" and payment is pending.`,
          { bookingId: booking._id.toString(), type: "payment_pending" }
        );
      }
    } catch (err) {
      console.error("Failed to notify leaser before payment:", err);
    }
    // ---------------------------------------------------------------------
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
  const sig = req.headers["stripe-signature"];
  if (!sig) return res.status(400).send("Missing Stripe signature");

  let event;
  try {
    event = stripe.webhooks.constructEvent(
      req.body,
      sig,
      process.env.STRIPE_WEBHOOK_SECRET!
    );
  } catch (err: any) {
    console.error("Webhook signature verification failed:", err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  try {
    const paymentIntent = event.data.object as any;
    const bookingId: string = paymentIntent.metadata?.bookingId;
    const userId: string = paymentIntent.metadata?.userId;

    if (!bookingId) {
      console.error("Booking ID missing in payment intent metadata");
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

    switch (event.type) {
      case "payment_intent.succeeded": {
        // Update booking status
        booking.status = "approved";

        // Deduct logic
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

        // Update payment record
        await Payment.findOneAndUpdate(
          { paymentIntentId: paymentIntent.id },
          { status: "succeeded" }
        );

        // Notify renter
        if (renter?._id) {
          try {
            await sendNotification(
              renter._id.toString(),
              "Payment Successful",
              `Your payment for booking "${booking._id}" was successful.`,
              { bookingId: booking._id.toString(), type: "payment_succeeded" }
            );
          } catch (err) {
            console.error("Failed to notify renter on payment success:", err);
          }
        }

        // Notify leaser
        if (leaser?._id) {
          try {
            const renterName = renter?.name || "A user";
            await sendNotification(
              leaser._id.toString(),
              "Payment Succeeded",
              `${renterName} has successfully completed payment for booking "${booking._id}".`,
              { bookingId: booking._id.toString(), type: "payment_succeeded" }
            );
          } catch (err) {
            console.error("Failed to notify leaser on payment success:", err);
          }
        }
        break;
      }

      case "payment_intent.payment_failed": {
        // Update payment record
        await Payment.findOneAndUpdate(
          { paymentIntentId: paymentIntent.id },
          { status: "failed" }
        );

        // Notify renter
        if (renter?._id) {
          try {
            await sendNotification(
              renter._id.toString(),
              "Payment Failed",
              `Your payment for booking "${booking._id}" has failed. Please try again.`,
              { bookingId: booking._id.toString(), type: "payment_failed" }
            );
          } catch (err) {
            console.error("Failed to notify renter on payment failure:", err);
          }
        }

        // Notify leaser
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
            console.error("Failed to notify leaser on payment failure:", err);
          }
        }
        break;
      }

      default:
        console.log(`Unhandled event type ${event.type}`);
    }

    res.json({ received: true });
  } catch (err) {
    console.error("Stripe webhook processing error:", err);
    res.status(500).send("Webhook processing error");
  }
};
