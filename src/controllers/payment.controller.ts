import { NextFunction, Response } from "express";
import { AuthRequest } from "../types/express";
import { sendResponse } from "../utils/response";
import { STATUS_CODES } from "../config/constants";
import { User } from "../models/user.model";
import {
  attachAndSetDefaultPaymentMethod,
  checkAccountStatus,
  createConnectedAccount,
  createPaymentIntent,
  createSubscription,
  createSubscriptionPlan,
  deleteConnectedAccount,
  getOnboardingLink,
  refundPayment,
  transferFunds,
  verifyPaymentIntent,
} from "../helpers/stripe-functions";
import { Transaction } from "../models/transaction.model";

export const getAllPayments = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const userId = req.user?.id;
    const user = await User.findById(userId).select("role");

    let filter: Record<string, any> = {};

    if (user?.role === "admin") {
      filter.vendor = userId;
    } else if (user?.role === "user") {
      filter.user = userId;
    }

    const transactions = await Transaction.find(filter).sort({ createdAt: -1 });

    sendResponse(
      res,
      transactions,
      "Transactions retrieved successfully",
      STATUS_CODES.OK
    );
  } catch (error) {
    next(error);
  }
};

export const createPayment = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const { amount, currency, paymentMethodId } = req.body;
    const userId = req.user?.id;

    const user = await User.findById(userId).select("stripeCustomerId");
    if (!user) {
      sendResponse(res, {}, "User not found", STATUS_CODES.NOT_FOUND);
      return;
    }

    const paymentIntent = await createPaymentIntent(
      sanitizeAmount(amount),
      currency,
      paymentMethodId,
      user?.stripe.customerId
    );

    sendResponse(
      res,
      { client_secret: paymentIntent.client_secret },
      "Payment created successfully",
      STATUS_CODES.CREATED
    );
  } catch (error) {
    next(error);
  }
};

// verify payment
export const verifyPayment = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const { paymentIntentId } = req.body;

    const paymentIntent = await verifyPaymentIntent(paymentIntentId);

    console.log({ paymentIntent });

    if (paymentIntent.status === "succeeded") {
      const transaction = new Transaction({
        user: req.user?.id,
        amount: paymentIntent.amount / 100,
        currency: paymentIntent.currency,
        paymentIntentId: paymentIntent.id,
      });

      await transaction.save();

      sendResponse(
        res,
        transaction,
        "Payment verified successfully",
        STATUS_CODES.OK
      );
    } else {
      sendResponse(res, {}, "Payment failed ", STATUS_CODES.BAD_REQUEST);
    }
  } catch (error) {
    next(error);
  }
};

/// attach payment method to customer ( attachPaymentMethodToCustomer )
export const attachPaymentMethodToCustomer = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const { paymentMethodId } = req.body;
    console.log(req.body);
    const userId = req.user?.id;

    const user = await User.findById(userId).select("name email stripe");

    if (!user) {
      sendResponse(res, {}, "User not found", STATUS_CODES.NOT_FOUND);
      return;
    }

    //  attachPaymentMethod || attachAndSetDefaultPaymentMethod
    const attached = await attachAndSetDefaultPaymentMethod(
      paymentMethodId,
      user.stripe.customerId
      //   customerId
    );

    if (!attached) {
      sendResponse(
        res,
        {},
        "Failed to attach payment method",
        STATUS_CODES.BAD_REQUEST
      );
      return;
    }

    sendResponse(
      res,
      attached,
      "Payment method attached successfully",
      STATUS_CODES.CREATED
    );
  } catch (error) {
    next(error);
  }
};

// onborad connected acount  ( createConnectedAccount )
export const onBoardVendor = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const userId = req.user?.id;

    const user = await User.findById(userId).select("email stripe");

    if (!user) {
      sendResponse(res, {}, "User not found", STATUS_CODES.NOT_FOUND);
      return;
    }

    if (user.stripe.connectedAccountId) {
      sendResponse(
        res,
        {
          accountLinks: user.stripe.connectedAccountLink,
        },
        "User already onboarded with Stripe , use the above link to complete onboarding",
        STATUS_CODES.BAD_REQUEST
      );
      return;
    }

    const account = await createConnectedAccount(user?.email as string);
    if (!account) {
      sendResponse(
        res,
        {},
        "Failed to create connected account",
        STATUS_CODES.BAD_REQUEST
      );
      return;
    }
    const accountLinks = await getOnboardingLink(account.id);

    if (!accountLinks) {
      sendResponse(
        res,
        {},
        "Failed to create connected account",
        STATUS_CODES.BAD_REQUEST
      );
      return;
    }

    user.stripe.connectedAccountId = account.id;
    user.stripe.connectedAccountLink = accountLinks;
    await user.save();

    sendResponse(
      res,
      { accountLinks },
      "Connected account created successfully",
      STATUS_CODES.CREATED
    );
  } catch (error) {
    next(error);
  }
};

// delte connected account ( deleteConnectedAccount )
export const deleteOnboardedAccount = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const userId = req.user?.id;

    const user = await User.findById(userId).select(
      "stripe.connectedAccountId"
    );

    if (!user) {
      sendResponse(res, {}, "User not found", STATUS_CODES.NOT_FOUND);
      return;
    }

    const connectedAccountId = user.stripe.connectedAccountId;
    if (!connectedAccountId) {
      sendResponse(
        res,
        {},
        "User not onboarded with Stripe",
        STATUS_CODES.BAD_REQUEST
      );
      return;
    }

    const deleted = await deleteConnectedAccount(connectedAccountId);

    if (!deleted) {
      sendResponse(
        res,
        {},
        "Failed to delete connected account",
        STATUS_CODES.BAD_REQUEST
      );
      return;
    }

    user.stripe.connectedAccountId = "";
    user.stripe.connectedAccountLink = "";
    await user.save();

    sendResponse(
      res,
      {},
      "Connected account deleted successfully",
      STATUS_CODES.OK
    );
  } catch (error) {
    next(error);
  }
};

export const confirmOnboarding = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const userId = req.user?.id;
    const user = await User.findById(userId).select(
      "stripe.connectedAccountId"
    );

    if (!user) {
      sendResponse(res, {}, "User not found", STATUS_CODES.NOT_FOUND);
      return;
    }

    const connectedAccountId = user?.stripe.connectedAccountId;
    const connectedAccountDetails = await checkAccountStatus(
      connectedAccountId
    );

    sendResponse(
      res,
      connectedAccountDetails,
      "Connected account status retrieved successfully",
      STATUS_CODES.OK
    );
  } catch (error) {
    next(error);
  }
};

export const transferToVendor = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const { amount, currency, vendorId } = req.body;
    const vendor = await User.findById(vendorId)
      .select("stripe.connectedAccountId")
      .lean();
    if (!vendor || !vendor.stripe.connectedAccountId) {
      sendResponse(
        res,
        null,
        "Vendor not onboarded with Stripe",
        STATUS_CODES.BAD_REQUEST
      );
      return;
    }

    const transfer = await transferFunds(
      vendor.stripe.connectedAccountId,
      amount,
      currency
    );

    sendResponse(
      res,
      transfer,
      "Funds transferred successfully",
      STATUS_CODES.OK
    );
  } catch (error) {
    next(error);
  }
};

// refund payment
export const handleRefund = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const { paymentIntentId, amount } = req.body;

    const refund = await refundPayment(paymentIntentId, sanitizeAmount(amount));

    sendResponse(res, refund, "Payment refunded successfully", STATUS_CODES.OK);
  } catch (error) {
    next(error);
  }
};

export const sanitizeAmount = (amount: number): number => {
  return Math.round(amount * 100);
};

//handle subscription
export const handleCreateSubscription = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const { plan } = req.body;
    const user = await User.findById(req.user?.id).select("name  email stripe");
    if (!user) {
      sendResponse(res, {}, "User not found", STATUS_CODES.NOT_FOUND);
      return;
    }

    const subscriptionPlan = await createSubscriptionPlan(
      "title",
      "description",
      2000,
      "usd",
      "month"
    );

    console.log({ subscriptionPlan });

    if (!subscriptionPlan || !subscriptionPlan.price.id) {
      sendResponse(
        res,
        {},
        "Failed to create subscription plan",
        STATUS_CODES.BAD_REQUEST
      );
      return;
    }

    const subscription = await createSubscription(
      "cus_RvyQfm3DFZ1aNa",
      subscriptionPlan.price.id,
      "acct_1R28aaRnaLCjh1jY"
    );

    console.log({ subscription });

    sendResponse(
      res,
      {
        subscription,
        subscriptionPlan,
      },
      "Subscription created successfully",
      STATUS_CODES.CREATED
    );
  } catch (error) {
    next(error);
  }
};
