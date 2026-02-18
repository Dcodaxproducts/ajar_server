import { Booking } from "../models/booking.model";
import { IUser, User } from "../models/user.model";
import { Payment } from "../models/payment.model";
import stripe from "../utils/stripe";
import mongoose from "mongoose";
import { Request, Response } from "express";
import { sendNotification } from "../utils/notifications";
import { AuthRequest } from "../middlewares/auth.middleware";
import { WalletTransaction } from "../models/walletTransaction.model";
import { saveStripeAccountIdToUser } from "../utils/saveStripeAccountIdToUser";

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

      const walletData = await WalletTransaction.findOne({
        userId: userRenterId,
        paymentIntentId: paymentIntent.id
      });

      if (!walletData) return res.status(404).send("Wallet data not found");

      // PAYMENT SUCCESS
      if (event.type === "payment_intent.succeeded") {
        console.log("Payment confirmed by Stripe");

        const amountInDollars = paymentIntent.amount / 100;

        // ✅ CRITICAL: First update user wallet, THEN update transaction
        const user = await User.findById(userRenterId);
        if (!user) return res.status(404).json({ message: "User not found" });

        try {
          user.wallet.balance += amountInDollars;
          await user.save();

          // ✅ Only update transaction after successful wallet update
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

          // Send notification
          await sendNotification(
            userRenterId,
            "Wallet Credited Successfully",
            `Your wallet has been credited with $${amountInDollars}. The amount is now available for use.`,
            { userId: userRenterId, type: "wallet_credit" }
          );
        } catch (error) {
          console.error("Failed to update wallet:", error);
          // ✅ Mark transaction as failed if wallet update fails
          await WalletTransaction.findOneAndUpdate(
            { userId: userRenterId, paymentIntentId: paymentIntent.id },
            { status: "failed" }
          );
          return res.status(500).send("Failed to process wallet credit");
        }
      }

      // PAYMENT FAILED
      else if (event.type === "payment_intent.payment_failed") {
        const amountInDollars = paymentIntent.amount / 100;

        await WalletTransaction.findOneAndUpdate(
          {
            userId: userRenterId,
            paymentIntentId: paymentIntent.id
          },
          {
            status: "failed",
          }
        );

        await sendNotification(
          userRenterId,
          "Wallet Payment Failed",
          `Your wallet payment of $${amountInDollars} has failed. Please try again or contact support.`,
          { userId: userRenterId, type: "wallet_payment_failed" }
        );
      }

      res.json({ received: true });
    }
  } catch (err) {
    console.error("Webhook Processing Error:", err);
    res.status(500).send("Webhook processing error");
  }
};

export const verifyPayment = async (req: AuthRequest, res: Response) => {
  try {
    const { paymentIntentId } = req.body;

    if (!paymentIntentId) {
      return res.status(400).json({ message: "Missing paymentIntentId" });
    }

    const intent = await stripe.paymentIntents.retrieve(paymentIntentId);

    const userRenterId = intent.metadata?.userRenterId;
    if (!userRenterId) {
      return res.status(400).json({ message: "Missing User ID" });
    }

    // ✅ Authorization check: Only the payment owner can verify
    if (req.user?.id?.toString() !== userRenterId) {
      return res.status(403).json({ message: "Unauthorized to verify this payment" });
    }


    const walletTx = await WalletTransaction.findOne({
      userId: userRenterId,
      paymentIntentId: intent.id,
    });

    if (!walletTx) {
      return res.status(404).json({ message: "Wallet transaction not found" });
    }

    // ===== CHECK IF ALREADY PROCESSED =====
    if (walletTx.status === "succeeded") {
      return res.json({
        status: "succeeded",
        message: "Wallet payment successful",
      });
    }

    if (walletTx.status === "failed") {
      return res.json({
        status: "failed",
        message: "Wallet payment failed",
      });
    }

    // ===== SUCCESS =====
    if (intent.status === "succeeded") {
      console.log("Payment confirmed - Updating from API");

      const amountInDollars = intent.amount / 100;

      // ✅ CRITICAL: First update user wallet, THEN update transaction
      const user = await User.findById(userRenterId);
      if (!user) {
        return res.status(404).json({ message: "User not found" });
      }

      try {
        user.wallet.balance += amountInDollars;
        await user.save();

        // ✅ Only update transaction after successful wallet update
        await WalletTransaction.findOneAndUpdate(
          {
            userId: userRenterId,
            paymentIntentId: intent.id,
          },
          {
            status: "succeeded",
            type: "credit"
          },
          { new: true }
        );

        await sendNotification(
          userRenterId,
          "Wallet Credited Successfully",
          `Your wallet has been credited with $${amountInDollars}. The amount is now available for use.`,
          { userId: userRenterId, type: "wallet_credit" }
        );

        return res.json({
          status: "succeeded",
          message: "Wallet payment successful",
        });
      } catch (error) {
        console.error("Failed to update wallet:", error);
        await WalletTransaction.findOneAndUpdate(
          { userId: userRenterId, paymentIntentId: intent.id },
          { status: "failed" }
        );
        return res.status(500).json({ message: "Failed to process wallet credit" });
      }
    }

    // ===== FAILED/CANCELED =====
    if (intent.status === "canceled" || intent.status === "requires_payment_method") {
      const amountInDollars = intent.amount / 100;

      await WalletTransaction.findOneAndUpdate(
        {
          userId: userRenterId,
          paymentIntentId: intent.id,
        },
        {
          status: "failed",
        }
      );

      await sendNotification(
        userRenterId,
        "Wallet Payment Failed",
        `Your wallet payment of $${amountInDollars} has failed. Please try again or contact support.`,
        { userId: userRenterId, type: "wallet_payment_failed" }
      );

      return res.json({
        status: "failed",
        message: intent.status === "canceled"
          ? "Wallet payment was canceled by user"
          : "Wallet payment failed",
      });
    }

    // ===== PENDING =====
    return res.json({
      status: "pending",
      message: "Wallet payment is still processing",
    });

  } catch (error: any) {
    console.error("Verify Wallet Payment Error:", error);
    res.status(500).json({ message: "Wallet payment verification failed" });
  }
};

export const createConnectedAccount = async (req: AuthRequest, res: Response) => {
  try {
    const { userId, email, country } = req.body;

    // 1️⃣ Create connected account
    const account = await stripe.accounts.create({
      type: "express",
      country: country || "US",
      email,
    });

    // 2️⃣ Save account id in DB
    await saveStripeAccountIdToUser(userId, account.id);

    // 3️⃣ Create account link for onboarding
    const accountLink = await stripe.accountLinks.create({
      account: account.id,
      refresh_url: `${process.env.CLIENT_URL}/connect-bank-account`,
      return_url: `${process.env.CLIENT_URL}/connect-bank-account`,
      type: "account_onboarding",
    });

    res.json({ url: accountLink.url });
  } catch (err: any) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
};

export const getConnectedAccount = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ error: "Unauthorized" });

    const user = await User.findById(userId);
    if (!user) return res.status(404).json({ error: "User not found" });

    const connectedAccountId = user.stripe.connectedAccountId;
    if (!connectedAccountId)
      return res.status(404).json({ error: "No Stripe connected account" });

    const account = await stripe.accounts.retrieve(connectedAccountId);

    // ✅ Correct check
    const bankAttached = !!account.payouts_enabled;

    res.json({
      bankAttached,
      payoutsEnabled: account.payouts_enabled,
      chargesEnabled: account.charges_enabled,
      detailsSubmitted: account.details_submitted,
    });

  } catch (err: any) {
    console.error("Error fetching connected account:", err);
    res.status(500).json({ error: err.message || "Server error" });
  }
};

export const withdraw = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user?.id;
    const { amount } = req.body;

    const MIN_WITHDRAWAL = 100;
    
    if (!amount || amount < MIN_WITHDRAWAL) {
      return res.status(400).json({
        error: `Invalid amount. Minimum withdrawal is $${MIN_WITHDRAWAL}.`
      });
    }

    const hasActiveBookings = await Booking.exists({
      leaser: userId,
      status: { $in: ["approved", "in_progress"] }
    });

    if (hasActiveBookings) {
      return res.status(400).json({
        error: "Cannot withdraw while you have active bookings."
      });
    }

    // 3️⃣ Fetch User & Stripe Account Eligibility
    const user = await User.findById(userId);
    if (!user) return res.status(404).json({ error: "User not found" });

    if (!user.stripe.connectedAccountId)
      return res.status(400).json({ error: "Bank account not connected" });

    if (user.wallet.balance < amount)
      return res.status(400).json({ error: "Insufficient wallet balance" });

    const account = await stripe.accounts.retrieve(user.stripe.connectedAccountId);
    if (!account.payouts_enabled)
      return res.status(400).json({ error: "Stripe account not eligible for payouts" });

    // 4️⃣ Execute Transfer and Payout
    const amountInCents = Math.round(amount * 100);

    // Platform -> Connected Account
    await stripe.transfers.create({
      amount: amountInCents,
      currency: "usd",
      destination: user.stripe.connectedAccountId,
    });

    // Connected Account -> Bank
    const payout = await stripe.payouts.create(
      { amount: amountInCents, currency: "usd" },
      { stripeAccount: user.stripe.connectedAccountId }
    );

    // 5️⃣ Update Database & Record Transaction
    user.wallet.balance -= amount;
    await user.save();

    await WalletTransaction.create({
      userId: user._id,
      amount,
      type: "debit",
      status: "succeeded",
      source: "withdraw",
      payoutId: payout.id,
      description: `Withdrawal to connected bank account`,
    });

    // 6️⃣ Notify User
    await sendNotification(
      user._id as string,
      "Withdrawal Initiated",
      `Your withdrawal of $${amount.toFixed(2)} has been initiated.`,
      { userId: user._id, type: "wallet_withdrawal", payoutId: payout.id }
    );

    return res.json({
      success: true,
      payoutId: payout.id,
      status: payout.status,
    });

  } catch (err: any) {
    console.error("Withdraw error:", err);
    res.status(500).json({ error: err.message || "Server error" });
  }
};

