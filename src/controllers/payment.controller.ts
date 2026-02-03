import { Booking } from "../models/booking.model";
import { IUser, User } from "../models/user.model";
import { Payment } from "../models/payment.model";
import stripe from "../utils/stripe";
import mongoose from "mongoose";
import { Request, Response } from "express";
import { sendNotification } from "../utils/notifications";
import { AuthRequest } from "../middlewares/auth.middleware";
import { WalletTransaction } from "../models/walletTransaction.model";

// CREATE PAYMENT INTENT
export const createBookingPayment = async (req: AuthRequest, res: Response) => {
  try {
    const { bookingId, userAmount } = req.body;
    const userData = req?.user;

    if (bookingId) {
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
      const amountInCents = Math.round(amount * 100);

      console.log("Charging EXACT booking total:", amount);


      if (!amount || amountInCents < 50) {
        return res.status(400).json({
          message: "Booking amount must be at least $0.50",
          amount,
        });
      }

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
    }
    else {
      const userAmountInCents = Math.round(userAmount * 100);
      const userId = userData?.id?.toString() as string;

      if (!userAmount || userAmountInCents < 50) {
        return res.status(400).json({
          message: "Amount must be at least $0.50",
          userAmount,
        });
      }

      const paymentIntent = await stripe.paymentIntents.create({
        amount: Math.round(userAmount * 100),
        currency: "usd",
        metadata: {
          userRenterId: userId
        },
        automatic_payment_methods: {
          enabled: true,
          allow_redirects: "never",
        },
      });

      await WalletTransaction.create({
        userId,
        amount: userAmount,
        status: "pending",
        source: "stripe",
        paymentIntentId: paymentIntent.id,
        createdAt: new Date(),
      });

      res.status(200).json({
        clientSecret: paymentIntent.client_secret,
        message: "User payment initiated",
      });
    }
  } catch (error) {
    console.error("Payment Intent Error:", error);
    res.status(500).json({ message: "Server error" });
  }
};

// STRIPE WEBHOOK
export const stripeWebhook = async (req: Request, res: Response) => {
  console.log("WEBHOOK HIT");
  console.log("Headers:", req.headers);
  console.log("Body type:", typeof req.body);
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

    const userRenterId = paymentIntent.metadata?.userRenterId;
    const bookingId = paymentIntent.metadata?.bookingId;

    if (bookingId) {
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
          { status: "succeeded" },
          { new: true }
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
    }

    else {
      if (!userRenterId) return res.status(400).send("Missing User ID");

      const walletData = await WalletTransaction.findOne(
        {
          userId: userRenterId,
          paymentIntentId: paymentIntent.id
        }
      )

      if (!walletData) return res.status(404).send("Wallet data not found");

      // PAYMENT SUCCESS
      if (event.type === "payment_intent.succeeded") {
        console.log("Payment confirmed by Stripe");

        const amountInDollars = paymentIntent.amount / 100;

        await WalletTransaction.findOneAndUpdate(
          {
            userId: userRenterId,
            paymentIntentId: paymentIntent.id,
          },
          {
            status: "succeeded",
            type: "credit"
          },
          { new: true }
        );

        const user = await User.findById(userRenterId);
        if (!user) return res.status(404).json({ message: "User not found" });

        user.wallet.balance += amountInDollars;
        await user.save();

        // Notifications
        if (userRenterId) {
          await sendNotification(
            userRenterId,
            "Wallet Credited Successfully",
            `Your wallet has been credited with $${amountInDollars}. The amount is now available for use.`,
            { userId: userRenterId, type: "wallet_credit" }
          );
        }
      }

      //  PAYMENT FAILED
      else if (event.type === "payment_intent.payment_failed") {
        console.log(" Payment failed");

        await WalletTransaction.findOneAndUpdate(
          {
            userId: userRenterId,
            paymentIntentId: paymentIntent.id
          },
          {
            status: "failed"
          }
        );
      }

      res.json({ received: true });
    }
  } catch (err) {
    console.error("Webhook Processing Error:", err);
    res.status(500).send("Webhook processing error");
  }
};

export const verifyPayment = async (req: Request, res: Response) => {
  try {
    const { paymentIntentId } = req.body;

    if (!paymentIntentId) {
      return res.status(400).json({ message: "Missing paymentIntentId" });
    }

    // 🔹 Always verify from Stripe
    const intent = await stripe.paymentIntents.retrieve(paymentIntentId);

    // Optional: ensure wallet transaction exists
    const walletTx = await WalletTransaction.findOne({ paymentIntentId });
    if (!walletTx) {
      return res.status(404).json({ message: "Wallet transaction not found" });
    }

    // ===== SUCCESS =====
    if (intent.status === "succeeded") {
      return res.json({
        status: "succeeded",
        message: "Wallet payment successful",
      });
    }

    // ===== CANCELED =====
    if (intent.status === "canceled") {
      return res.json({
        status: "canceled",
        message: "Wallet payment was canceled by user",
      });
    }

    // ===== FAILED =====
    if (intent.status === "requires_payment_method") {
      return res.json({
        status: "failed",
        message: "Wallet payment failed",
      });
    }

    // ===== STILL PENDING =====
    return res.json({
      status: "pending",
      message: "Wallet payment is still processing",
    });

  } catch (error: any) {
    console.error("Verify Wallet Payment Error:", error);
    res.status(500).json({ message: "Wallet payment verification failed" });
  }
};

