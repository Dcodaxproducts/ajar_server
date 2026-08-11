import mongoose from "mongoose";
import { Booking } from "../models/booking.model";
import { Payment } from "../models/payment.model";
import { User } from "../models/user.model";
import { createTransaction } from "./transactionLedger";
import stripe from "./stripe";

const MIN_STRIPE_AMOUNT_CENTS = 50;

export const getBookingStripeAmount = (booking: any): number => {
  const totalPrice = Number(booking?.priceDetails?.totalPrice || 0);
  const securityDeposit = Number(booking?.priceDetails?.securityDeposit || 0);
  // The processing fee is deliberately kept out of totalPrice, so it has to be
  // added back here — this is the only place the renter is actually charged
  const stripeFee = Number(booking?.priceDetails?.stripeFee || 0);
  return Number((totalPrice + securityDeposit + stripeFee).toFixed(2));
};

const getBookingUserId = (user: any) => {
  return typeof user === "object" ? user?._id : user;
};

const getAdminUser = (session?: mongoose.ClientSession) => {
  return User.findOne({ role: "admin" }).select("_id").session(session || null);
};

export const createManualBookingPaymentIntent = async (booking: any) => {
  const amount = getBookingStripeAmount(booking);
  const amountInCents = Math.round(amount * 100);

  if (!amount || amountInCents < MIN_STRIPE_AMOUNT_CENTS) {
    throw new Error("Booking amount must be at least $0.50");
  }

  return stripe.paymentIntents.create({
    amount: amountInCents,
    currency: "usd",
    capture_method: "manual",
    payment_method_types: ["card"],
    metadata: {
      bookingId: booking._id.toString(),
    },
  });
};

export const recordHeldBookingPayment = async (
  paymentIntentId: string,
  session?: mongoose.ClientSession
) => {
  const intent = await stripe.paymentIntents.retrieve(paymentIntentId);
  const bookingId = intent.metadata?.bookingId;

  if (!bookingId || !mongoose.Types.ObjectId.isValid(bookingId)) {
    throw new Error("Missing booking ID");
  }

  if (intent.status !== "requires_capture") {
    throw new Error(`Payment hold not completed: ${intent.status}`);
  }

  const booking = await Booking.findById(bookingId).session(session || null);
  if (!booking) {
    throw new Error("Booking not found");
  }
  const userId = getBookingUserId(booking.renter)?.toString();

  if (!userId || !mongoose.Types.ObjectId.isValid(userId)) {
    throw new Error("Missing renter ID");
  }

  const amount = intent.amount / 100;

  return Payment.findOneAndUpdate(
    { paymentIntentId: intent.id },
    {
      bookingId: booking._id,
      userId,
      amount,
      currency: intent.currency || "usd",
      type: booking.previousBookingId ? "extension" : "booking",
      status: "held",
      paymentIntentId: intent.id,
      method: "stripe",
    },
    { upsert: true, new: true, session }
  );
};

export const captureHeldBookingPayment = async (
  bookingId: mongoose.Types.ObjectId | string,
  session?: mongoose.ClientSession
) => {
  const payment = await Payment.findOne({
    bookingId,
    status: "held",
    type: { $in: ["booking", "extension"] },
  }).session(session || null);
  if (!payment) {
    throw new Error("Confirmed payment hold not found for this booking");
  }
  if (!payment.paymentIntentId) {
    throw new Error("Stripe payment intent not found for this booking payment");
  }

  const intent = await stripe.paymentIntents.retrieve(payment.paymentIntentId);
  if (intent.status !== "requires_capture") {
    throw new Error(`Payment is not ready to capture: ${intent.status}`);
  }

  // Expanding the balance transaction is the only way to see what Stripe
  // actually charged — without it we just get an id
  const captured = await stripe.paymentIntents.capture(payment.paymentIntentId, {
    expand: ["latest_charge.balance_transaction"],
  });

  const balanceTx = (captured.latest_charge as any)?.balance_transaction as any;

  payment.status = "captured";
  payment.capturedAt = new Date();

  if (balanceTx) {
    payment.stripeFee = Number(((balanceTx.fee ?? 0) / 100).toFixed(2));
    payment.netAmount = Number(((balanceTx.net ?? 0) / 100).toFixed(2));
  }

  await payment.save({ session });

  const booking = await Booking.findById(bookingId).session(session || null);
  const admin = await getAdminUser(session);
  const platformAmount = Number(Number(payment.amount || 0).toFixed(2));

  if (booking && payment.amount > 0) {
    await createTransaction({
      paymentId: payment._id as mongoose.Types.ObjectId,
      userId: payment.userId,
      amount: payment.amount,
      type: "debit",
      source: "booking_payment",
      session,
    });
  }

  if (booking && admin && platformAmount > 0) {
    await createTransaction({
      paymentId: payment._id as mongoose.Types.ObjectId,
      userId: admin._id as mongoose.Types.ObjectId,
      amount: platformAmount,
      type: "credit",
      source: "platform_capture",
      session,
    });
  }

  return captured;
};

export const releaseBookingPaymentHold = async (
  bookingId: mongoose.Types.ObjectId | string,
  session?: mongoose.ClientSession
) => {
  const payment = await Payment.findOne({ bookingId, status: "held" }).session(session || null);
  if (!payment) return null;
  if (!payment.paymentIntentId) return null;

  const intent = await stripe.paymentIntents.retrieve(payment.paymentIntentId);

  if (intent.status === "requires_capture") {
    await stripe.paymentIntents.cancel(payment.paymentIntentId);
  }

  if (["requires_capture", "canceled", "requires_payment_method", "requires_confirmation"].includes(intent.status)) {
    payment.status = "cancelled";
    await payment.save({ session });
  }

  return intent;
};

export const refundBookingSecurityDeposit = async (
  bookingId: mongoose.Types.ObjectId | string,
  depositAmount: number,
  session?: mongoose.ClientSession
) => {
  if (!depositAmount || depositAmount <= 0) return null;

  // "partially_refunded" is included because an early return refunds the rental
  // amount first — the deposit is a separate slice of the same PaymentIntent and
  // is still refundable after that.
  const payment = await Payment.findOne({
    bookingId,
    type: { $in: ["booking", "extension"] },
    status: { $in: ["captured", "payout_pending", "paid_out", "partially_refunded"] },
    paymentIntentId: { $exists: true, $ne: "" },
  }).session(session || null);
  if (!payment) {
    throw new Error("Captured booking payment not found for security deposit refund");
  }

  const refund = await stripe.refunds.create({
    payment_intent: payment.paymentIntentId,
    amount: Math.round(depositAmount * 100),
    reason: "requested_by_customer",
  });

  payment.refundId = refund.id;
  payment.refundedAt = new Date();
  payment.status = "partially_refunded";
  await payment.save({ session });

  const booking = await Booking.findById(bookingId).session(session || null);
  const renterId = getBookingUserId(booking?.renter);
  const admin = await getAdminUser(session);

  if (booking && renterId) {
    await createTransaction({
      paymentId: payment._id as mongoose.Types.ObjectId,
      userId: renterId,
      amount: depositAmount,
      type: "credit",
      source: "security_deposit_refund",
      session,
    });
  }

  if (admin) {
    await createTransaction({
      paymentId: payment._id as mongoose.Types.ObjectId,
      userId: admin._id as mongoose.Types.ObjectId,
      amount: depositAmount,
      type: "debit",
      source: "security_deposit_refund",
      session,
    });
  }

  return refund;
};

export const refundBookingPaymentAmount = async (
  bookingId: mongoose.Types.ObjectId | string,
  refundAmount: number,
  session?: mongoose.ClientSession
) => {
  if (!refundAmount || refundAmount <= 0) return null;

  const payment = await Payment.findOne({
    bookingId,
    type: { $in: ["booking", "extension"] },
    status: { $in: ["captured", "payout_pending", "partially_refunded", "paid_out"] },
    paymentIntentId: { $exists: true, $ne: "" },
  }).session(session || null);

  if (!payment?.paymentIntentId) {
    throw new Error("Captured booking payment not found for refund");
  }

  const refund = await stripe.refunds.create({
    payment_intent: payment.paymentIntentId,
    amount: Math.round(refundAmount * 100),
    reason: "requested_by_customer",
  });

  payment.refundId = refund.id;
  payment.refundedAt = new Date();
  payment.status = refundAmount >= payment.amount ? "refunded" : "partially_refunded";
  await payment.save({ session });

  const booking = await Booking.findById(bookingId).session(session || null);
  const renterId = getBookingUserId(booking?.renter);
  const admin = await getAdminUser(session);
  const amount = Number(refundAmount.toFixed(2));

  if (booking && renterId) {
    await createTransaction({
      paymentId: payment._id as mongoose.Types.ObjectId,
      userId: renterId,
      amount,
      type: "credit",
      source: "booking_refund",
      session,
    });
  }

  if (admin) {
    await createTransaction({
      paymentId: payment._id as mongoose.Types.ObjectId,
      userId: admin._id as mongoose.Types.ObjectId,
      amount,
      type: "debit",
      source: "booking_refund",
      session,
    });
  }

  return refund;
};

export const markBookingEarningAvailable = async (
  bookingId: mongoose.Types.ObjectId | string,
  session?: mongoose.ClientSession
) => {
  const booking = await Booking.findById(bookingId).session(session || null);
  if (!booking) return null;

  const leaserId =
    typeof booking.leaser === "object"
      ? booking.leaser?._id
      : booking.leaser;

  if (!leaserId) return null;

  const earningAmount = Number(
    (
      Number(booking.priceDetails?.price || 0) +
      Number(booking.extraRequestCharges?.additionalCharges || 0)
    ).toFixed(2)
  );

  if (earningAmount <= 0) return null;

  const payment = await Payment.findOne({
    bookingId,
    type: { $in: ["booking", "extension"] },
    status: { $in: ["captured", "partially_refunded", "payout_pending", "paid_out"] },
  }).session(session || null);

  if (!payment) {
    throw new Error("Captured booking payment not found for leaser earning");
  }
  const admin = await getAdminUser(session);

  if (admin) {
    await createTransaction({
      paymentId: payment._id as mongoose.Types.ObjectId,
      userId: admin._id as mongoose.Types.ObjectId,
      amount: earningAmount,
      type: "debit",
      source: "leaser_earning",
      session,
    });
  }

  return createTransaction({
    paymentId: payment._id as mongoose.Types.ObjectId,
    userId: leaserId as mongoose.Types.ObjectId,
    amount: earningAmount,
    type: "credit",
    source: "leaser_earning",
    session,
  });
};
