import { Booking } from "../models/booking.model";
import { IUser, User } from "../models/user.model";
import { Payment } from "../models/payment.model";
import { Notification } from "../models/notification.model";
import { DamageReport } from "../models/damageReport.model";
import stripe from "../utils/stripe";
import mongoose from "mongoose";
import { Request, Response } from "express";
import { notificationQueue } from "../queues/notification.queue";
import { cancelReminder, scheduleReminder } from "../queues/reminders";
import { REMINDER } from "../config/reminderTypes";
import { Zone } from "../models/zone.model";
import { MarketplaceListing } from "../models/marketplaceListings.model";
import { AuthRequest } from "../middlewares/auth.middleware";
import { saveStripeAccountIdToUser } from "../utils/saveStripeAccountIdToUser";
import {
  recordHeldBookingPayment,
} from "../utils/bookingStripePayments";
import { createTransaction } from "../utils/transactionLedger";

const verifyCapturedPayment = async (payment: any) => {
  if (!payment?.paymentIntentId) return false;

  const intent = await stripe.paymentIntents.retrieve(payment.paymentIntentId);
  const expectedAmount = Math.round(Number(payment.amount || 0) * 100);
  const receivedAmount = Number(intent.amount_received || 0);
  const capturableAmount = Number(intent.amount_capturable || 0);
  const capturedAmount = receivedAmount || Number(intent.amount || 0) - capturableAmount;

  return (
    ["succeeded", "requires_capture"].includes(intent.status) &&
    capturedAmount >= expectedAmount
  );
};

const calculateVerifiedWithdrawableAmount = async (leaserId: string) => {
  const completedBookings = await Booking.find({
    leaser: leaserId,
    status: "completed",
  })
    .select("_id priceDetails extraRequestCharges")
    .lean();

  const bookingIds = completedBookings.map((booking: any) => booking._id);
  const bookingPayments = await Payment.find({
    bookingId: { $in: bookingIds },
    type: { $in: ["booking", "extension"] },
    status: { $in: ["captured", "partially_refunded", "paid_out", "refunded"] },
    paymentIntentId: { $exists: true, $ne: "" },
  }).lean();

  const paymentByBookingId = new Map(
    bookingPayments.map((payment: any) => [payment.bookingId.toString(), payment])
  );

  let verifiedEarnings = 0;
  let sourcePayment: any = null;

  for (const booking of completedBookings as any[]) {
    const payment = paymentByBookingId.get(booking._id.toString());
    const isPaymentVerified = await verifyCapturedPayment(payment);

    if (!isPaymentVerified) continue;
    if (!sourcePayment) sourcePayment = payment;

    verifiedEarnings +=
      Number(booking.priceDetails?.price || 0) +
      Number(booking.extraRequestCharges?.additionalCharges || 0);
  }

  const approvedDamageReports = await DamageReport.find({
    booking: { $in: bookingIds },
    status: "approved",
  })
    .select("booking damagedCharges")
    .lean();

  for (const damageReport of approvedDamageReports as any[]) {
    const payment = paymentByBookingId.get(damageReport.booking?.toString());
    const isPaymentVerified = await verifyCapturedPayment(payment);

    if (!isPaymentVerified) continue;
    if (!sourcePayment) sourcePayment = payment;

    verifiedEarnings += Number(damageReport.damagedCharges || 0);
  }

  const paidOutPayments = await Payment.find({
    userId: leaserId,
    type: "payout",
    status: "paid_out",
  }).lean();

  const paidOutAmount = paidOutPayments.reduce((total: number, payment: any) => {
    return total + Number(payment.amount || 0);
  }, 0);

  return {
    availableAmount: Number((verifiedEarnings - paidOutAmount).toFixed(2)),
    sourcePayment,
  };
};

const sendPaidBookingRequestNotifications = async (booking: any) => {
  const renter = booking.renter as IUser | null;
  const leaser = booking.leaser as IUser | null;
  const bookingId = booking._id.toString();

  // The payment itself is already settled by the time we get here, so a queue
  // failure must never fail the caller
  try {
    // Payment landed — the "complete your payment" nudge is no longer relevant
    await cancelReminder(REMINDER.BOOKING_PAYMENT_PENDING, bookingId);

    if (renter?._id) {
      const existingRenterNotification = await Notification.exists({
        user: renter._id,
        title: "Payment Hold Confirmed",
        "data.bookingId": bookingId,
      });

      if (!existingRenterNotification) {
        await notificationQueue.add(
          "payment-held",
          {
            userId: renter._id.toString(),
            title: "Payment Hold Confirmed",
            message: `Your payment for booking "${bookingId}" has been held successfully.`,
            data: { bookingId, type: "payment_held" },
          },
          // Stripe can deliver the same webhook twice — a fixed jobId makes the
          // second add a no-op instead of a duplicate notification.
          // BullMQ rejects ":" in a custom id, so keep it dash-separated.
          { jobId: `payment-held-${bookingId}` }
        );
      }
    }

    if (leaser?._id) {
      const existingLeaserNotification = await Notification.exists({
        user: leaser._id,
        title: "New Booking Request",
        "data.bookingId": bookingId,
      });

      if (!existingLeaserNotification) {
        const renterName = renter?.name || "A user";
        await notificationQueue.add(
          "new-booking-request",
          {
            userId: leaser._id.toString(),
            title: "New Booking Request",
            message: `${renterName} submitted a paid booking request.`,
            data: { bookingId, type: "booking", status: "pending" },
          },
          { jobId: `new-booking-request-${bookingId}` }
        );
      }

      // Warn the leaser before the pending booking expires on them.
      // Cancelled as soon as the booking leaves "pending".
      // Callers pass a booking with only renter/leaser populated, so load the
      // listing here to reach its zone.
      const listing = await MarketplaceListing.findById(
        booking.marketplaceListingId
      )
        .select("name zone")
        .lean();

      const zone = listing?.zone
        ? await Zone.findById(listing.zone).lean()
        : null;

      if (zone?.bookingExpiryEnabled) {
        const expiryMinutes = zone.expiryTimeMinutes ?? 15;
        const expiresAt = new Date(
          new Date(booking.createdAt).getTime() + expiryMinutes * 60_000
        );

        await scheduleReminder({
          type: REMINDER.BOOKING_APPROVAL_EXPIRING,
          entityId: bookingId,
          userId: leaser._id.toString(),
          targetDate: expiresAt,
          title: "Booking Request Expiring",
          message: `A booking request for "${listing?.name ?? "your listing"}" will expire soon if you do not approve it.`,
          data: { bookingId, listingId: listing?._id?.toString() },
        });
      }
    }
  } catch (err) {
    console.error("Failed to queue paid booking request notifications:", err);
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
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  try {
    if (event.type === "account.updated") {
      const account = event.data.object as any;
      const userId = account.metadata?.userId;

      if (userId && account.details_submitted) {
        await User.findByIdAndUpdate(userId, {
          "stripe.connectedAccountId": account.id,
        });
      }
      return res.json({ received: true });
    }
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

      if (event.type === "payment_intent.amount_capturable_updated") {
        await recordHeldBookingPayment(paymentIntent.id);
        await sendPaidBookingRequestNotifications(booking);
      }

      // PAYMENT SUCCESS
      else if (event.type === "payment_intent.succeeded") {
        await Payment.findOneAndUpdate(
          { paymentIntentId: paymentIntent.id },
          { status: "captured", capturedAt: new Date() },
          { new: true }
        );
      }

      //  PAYMENT FAILED
      else if (event.type === "payment_intent.payment_failed") {
        await Payment.findOneAndUpdate(
          { paymentIntentId: paymentIntent.id },
          { status: "failed" }
        );
      }

      res.json({ received: true });
    }
    else {
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

    const bookingId = intent.metadata?.bookingId;
    if (bookingId) {
      const booking = await Booking.findById(bookingId)
        .populate("renter")
        .populate("leaser");
      if (!booking) {
        return res.status(404).json({ message: "Booking not found" });
      }

      const renter = booking.renter as any;
      const renterId = renter?._id?.toString() || renter?.toString();

      if (req.user?.id?.toString() !== renterId) {
        return res.status(403).json({ message: "Unauthorized to verify this payment" });
      }

      if (intent.status === "requires_capture") {
        await recordHeldBookingPayment(intent.id);
        await sendPaidBookingRequestNotifications(booking);
        return res.json({
          status: "pending",
          stripeStatus: intent.status,
          message: "Booking payment hold confirmed",
        });
      }

      if (intent.status === "succeeded") {
        await Payment.findOneAndUpdate(
          { paymentIntentId: intent.id },
          { status: "captured", capturedAt: new Date() },
          { new: true }
        );
        return res.json({
          status: "succeeded",
          stripeStatus: intent.status,
          message: "Booking payment captured",
        });
      }

      if (["canceled", "requires_payment_method"].includes(intent.status)) {
        await Payment.findOneAndUpdate(
          { paymentIntentId: intent.id },
          { status: "cancelled" }
        );
        return res.json({
          status: "failed",
          stripeStatus: intent.status,
          message: "Booking payment failed or cancelled",
        });
      }

      return res.json({
        status: "pending",
        stripeStatus: intent.status,
        message: "Booking payment is still processing",
      });
    }
    return res.status(400).json({ message: "Only booking payments can be verified." });

  } catch (error: any) {
    console.error("Verify Wallet Payment Error:", error);
    res.status(500).json({ message: "Wallet payment verification failed" });
  }
};

export const createConnectedAccount = async (req: AuthRequest, res: Response) => {
  try {
    const { country } = req.body;
    const userId = req.user?.id;

    if (!userId) return res.status(401).json({ error: "Unauthorized" });

    const user = await User.findById(userId);
    if (!user) return res.status(404).json({ error: "User not found" });

    // If already has a complete connected account, skip
    if (user.stripe?.connectedAccountId) {
      const existing = await stripe.accounts.retrieve(user.stripe.connectedAccountId);
      if (existing.details_submitted) {
        return res.json({ alreadyConnected: true });
      }
    }

    const account = await stripe.accounts.create({
      type: "express",
      country: country || "US",
      email: user.email || undefined,
      metadata: { userId: userId?.toString() }
    });

    const accountLink = await stripe.accountLinks.create({
      account: account.id,
      refresh_url: `${process.env.CLIENT_URL}/connect-bank-account/reauth`,
      return_url: `${process.env.CLIENT_URL}/connect-bank-account/success?accountId=${account.id}&userId=${userId}`,
      type: "account_onboarding",
    });

    res.json({ url: accountLink.url });
  } catch (err: any) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
};

export const confirmConnectedAccount = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user?.id;
    const { accountId } = req.body;

    if (!accountId || !userId) {
      return res.status(400).json({ error: "accountId and userId are required" });
    }

    const account = await stripe.accounts.retrieve(accountId);
    if (!account.details_submitted) {
      return res.status(400).json({ error: "Stripe onboarding not completed" });
    }

    await saveStripeAccountIdToUser(userId, accountId);

    res.json({ success: true });
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

    if (!userId) {
      return res.status(401).json({ error: "Unauthorized" });
    }

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

    const { availableAmount, sourcePayment } = await calculateVerifiedWithdrawableAmount(userId);

    if (availableAmount < amount)
      return res.status(400).json({ error: "Insufficient available earnings" });

    if (!sourcePayment?.bookingId) {
      return res.status(400).json({ error: "No completed booking earning found for payout" });
    }

    const account = await stripe.accounts.retrieve(user.stripe.connectedAccountId);
    if (!account.payouts_enabled)
      return res.status(400).json({ error: "Stripe account not eligible for payouts" });

    // 4️⃣ Execute Transfer and Payout
    const amountInCents = Math.round(amount * 100);

    // Platform -> Connected Account
    const transfer = await stripe.transfers.create({
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
    const admin = await User.findOne({ role: "admin" }).select("_id").lean();

    const payoutPayment = await Payment.create({
      bookingId: sourcePayment.bookingId,
      userId,
      amount: Number(amount),
      currency: sourcePayment.currency || "usd",
      type: "payout",
      status: "paid_out",
      transferId: transfer.id,
      payoutId: payout.id,
      paidOutAt: new Date(),
      method: "stripe",
    });

    await createTransaction({
      paymentId: payoutPayment._id as mongoose.Types.ObjectId,
      userId: userId as string,
      amount: Number(amount),
      type: "debit",
      source: "leaser_payout",
    });

    if (admin?._id) {
      await createTransaction({
        paymentId: payoutPayment._id as mongoose.Types.ObjectId,
        userId: admin._id as mongoose.Types.ObjectId,
        amount: Number(amount),
        type: "debit",
        source: "leaser_payout",
      });
    }

    // 6️⃣ Notify User
    await notificationQueue.add("withdrawal-initiated", {
      userId: user._id as string,
      title: "Withdrawal Initiated",
      message: `Your withdrawal of $${amount.toFixed(2)} has been initiated.`,
      data: { userId: user._id, type: "wallet_withdrawal", payoutId: payout.id },
    });

    return res.json({
      success: true,
      payoutId: payout.id,
      transferId: transfer.id,
      status: payout.status,
    });

  } catch (err: any) {
    console.error("Withdraw error:", err);
    res.status(500).json({ error: err.message || "Server error" });
  }
};


