import Stripe from "stripe";
import dotenv from "dotenv";

dotenv.config();

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY as string);

// CREATE CUSTOMER
export const createCustomer = async (
  email: string,
  name: string
): Promise<Stripe.Customer> => {
  try {
    const customer = await stripe.customers.create({
      email,
      name,
    });
    return customer;
  } catch (error) {
    throw new Error(`Stripe Error: Failed to create customer - ${error}`);
  }
};

// attach payment method to customer
export const attachPaymentMethod = async (
  paymentMethodId: string,
  customerId: string
): Promise<Stripe.PaymentMethod> => {
  try {
    const paymentMethod = await stripe.paymentMethods.attach(paymentMethodId, {
      customer: customerId,
    });

    return paymentMethod;
  } catch (error) {
    throw new Error(`Stripe Error: Failed to attach payment method - ${error}`);
  }
};

export const attachAndSetDefaultPaymentMethod = async (
  paymentMethodId: string,
  customerId: string
): Promise<Stripe.PaymentMethod> => {
  try {
    await stripe.paymentMethods.attach(paymentMethodId, {
      customer: customerId,
    });

    await stripe.customers.update(customerId, {
      invoice_settings: { default_payment_method: paymentMethodId },
    });

    return await stripe.paymentMethods.retrieve(paymentMethodId);
  } catch (error) {
    throw new Error(
      `Stripe Error: Failed to attach & set default payment method - ${error}`
    );
  }
};

// CREATE PAYMENT INTENT
export const createPaymentIntent = async (
  amount: number,
  currency: string,
  customerId: string,
  paymentMethodId?: string
): Promise<Stripe.PaymentIntent> => {
  try {
    const paymentIntent = await stripe.paymentIntents.create({
      amount,
      currency,
      customer: customerId,
      payment_method: paymentMethodId,
      confirm: paymentMethodId ? true : false,
      automatic_payment_methods: { enabled: true },
    });

    return paymentIntent;
  } catch (error) {
    throw new Error(`Stripe Error: Failed to create payment intent - ${error}`);
  }
};

// CAPTURE PAYMENT INTENT for vendor
export const createPaymentIntentForVendor = async (
  amount: number,
  currency: string,
  customerId: string,
  connectedAccountId: string,
  applicationFee: number
): Promise<Stripe.PaymentIntent> => {
  try {
    const applicationFeeAmount = Math.round(amount * (applicationFee / 100));

    console.log({ applicationFeeAmount });

    const paymentIntent = await stripe.paymentIntents.create({
      amount,
      currency,
      customer: customerId,
      payment_method_types: ["card"],
      capture_method: "manual",
      transfer_data: {
        destination: connectedAccountId,
      },
      application_fee_amount: applicationFeeAmount,
    });

    return paymentIntent;
  } catch (error) {
    throw new Error(`Stripe Error: Failed to create payment intent - ${error}`);
  }
};

// VERIFY PAYMENT INTENT
export const verifyPaymentIntent = async (
  paymentIntentId: string
): Promise<Stripe.PaymentIntent> => {
  try {
    const paymentIntent = await stripe.paymentIntents.retrieve(paymentIntentId);
    return paymentIntent;
  } catch (error) {
    throw new Error(`Stripe Error: Failed to verify payment intent - ${error}`);
  }
};

// ONBOARD CONNECTED ACCOUNT
export const createConnectedAccount = async (
  email: string
): Promise<Stripe.Account> => {
  try {
    const account = await stripe.accounts.create({
      type: "express",
      country: "US",
      email,
      capabilities: {
        card_payments: { requested: true },
        transfers: { requested: true },
      },
    });

    return account;
  } catch (error) {
    throw new Error(
      `Stripe Error: Failed to create connected account - ${error}`
    );
  }
};

// CHECK ACCOUNT STATUS
export const checkAccountStatus = async (
  accountId: string
): Promise<Stripe.Account> => {
  try {
    return await stripe.accounts.retrieve(accountId);
  } catch (error) {
    throw new Error(
      `Stripe Error: Failed to retrieve account status - ${error}`
    );
  }
};

// GET CONNECTED ACCOUNT LINK
export const getOnboardingLink = async (accountId: string): Promise<string> => {
  try {
    const accountLink = await stripe.accountLinks.create({
      account: accountId,
      refresh_url: "http://localhost:5002/reauth",
      return_url: "http://localhost:5002/dashboard",
      type: "account_onboarding",
    });

    return accountLink.url;
  } catch (error) {
    throw new Error(
      `Stripe Error: Failed to create onboarding link - ${error}`
    );
  }
};

// CHECK ACCOUNT status
export const isAccountEligibleForTransfer = async (
  accountId: string
): Promise<boolean> => {
  try {
    const account = await stripe.accounts.retrieve(accountId);
    return (
      account.capabilities?.transfers === "active" && account.payouts_enabled
    );
  } catch (error) {
    throw new Error(
      `Stripe Error: Failed to check account eligibility - ${error}`
    );
  }
};

// DELETE CONNECTED ACCOUNT
export const deleteConnectedAccount = async (
  accountId: string
): Promise<boolean> => {
  try {
    const deletedAccount = await stripe.accounts.del(accountId);
    return deletedAccount.deleted;
  } catch (error) {
    throw new Error(
      `Stripe Error: Failed to delete connected account - ${error}`
    );
  }
};

// TRANSFER FUNDS TO CONNECTED ACCOUNT
export const transferFunds = async (
  accountId: string,
  amount: number,
  currency: string
): Promise<Stripe.Transfer> => {
  try {
    const transfer = await stripe.transfers.create({
      amount,
      currency,
      destination: accountId,
    });

    return transfer;
  } catch (error) {
    throw new Error(`Stripe Error: Failed to transfer funds - ${error}`);
  }
};

// CAPTURE PAYMENT ( release payment to vendor )
export const capturePayment = async (
  paymentIntentId: string
): Promise<Stripe.PaymentIntent> => {
  try {
    const capturedPayment = await stripe.paymentIntents.capture(
      paymentIntentId
    );
    return capturedPayment;
  } catch (error) {
    throw new Error(`Stripe Error: Failed to capture payment - ${error}`);
  }
};

// REFUND PAYMENT
export const refundPayment = async (
  paymentIntentId: string,
  amount?: number
): Promise<Stripe.Refund> => {
  try {
    const refund = await stripe.refunds.create({
      payment_intent: paymentIntentId,
      amount: amount,
    });

    return refund;
  } catch (error) {
    throw new Error(`Stripe Error: Failed to process refund - ${error}`);
  }
};

// CHECK PAYMENT INTENT STATUS
export const getPaymentIntentStatus = async (
  paymentIntentId: string
): Promise<string> => {
  try {
    const paymentIntent = await stripe.paymentIntents.retrieve(paymentIntentId);
    return paymentIntent.status;
  } catch (error) {
    throw new Error(`Stripe Error: Failed to fetch payment status - ${error}`);
  }
};

// payouts
export const createPayout = async (
  connectedAccountId: string,
  amount: number,
  currency: string
): Promise<Stripe.Payout> => {
  try {
    const payout = await stripe.payouts.create(
      {
        amount,
        currency,
      },
      {
        stripeAccount: connectedAccountId,
      }
    );

    return payout;
  } catch (error) {
    throw new Error(`Stripe Error: Failed to create payout - ${error}`);
  }
};

// admin payout
export const createAdminPayout = async (
  amount: number,
  currency: string
): Promise<Stripe.Payout> => {
  try {
    const payout = await stripe.payouts.create({
      amount,
      currency,
    });

    return payout;
  } catch (error) {
    throw new Error(`Stripe Error: Failed to create payout - ${error}`);
  }
};

//subscriptions
export const createSubscriptionPlan = async (
  name: string,
  description: string,
  amount: number,
  currency: string,
  interval: "day" | "week" | "month" | "year"
): Promise<{ product: Stripe.Product; price: Stripe.Price }> => {
  try {
    const product = await stripe.products.create({
      name,
      description,
    });

    const price = await stripe.prices.create({
      unit_amount: amount,
      currency,
      recurring: { interval },
      product: product.id,
    });

    return { product, price };
  } catch (error) {
    throw new Error(
      `Stripe Error: Failed to create subscription plan - ${error}`
    );
  }
};

// create subscription
export const createSubscription = async (
  customerId: string,
  priceId: string,
  connectedAccountId?: string,
  applicationFee?: number
): Promise<Stripe.Subscription> => {
  try {
    const subscription = await stripe.subscriptions.create({
      customer: customerId,
      items: [{ price: priceId }],
      expand: ["latest_invoice.payment_intent"],
      ...(connectedAccountId
        ? {
            transfer_data: {
              destination: connectedAccountId,
            },
            application_fee_percent: applicationFee,
          }
        : {}),
    });

    return subscription;
  } catch (error) {
    throw new Error(`Stripe Error: Failed to create subscription - ${error}`);
  }
};

// cancel subscription ( immediately )
export const cancelSubscription = async (
  subscriptionId: string
): Promise<Stripe.Subscription> => {
  try {
    const subscription = await stripe.subscriptions.cancel(subscriptionId);
    return subscription;
  } catch (error) {
    throw new Error(`Stripe Error: Failed to cancel subscription - ${error}`);
  }
};

// cancel subscription at period end
export const cancelSubscriptionAtPeriodEnd = async (
  subscriptionId: string
): Promise<Stripe.Subscription> => {
  try {
    const subscription = await stripe.subscriptions.update(subscriptionId, {
      cancel_at_period_end: true,
    });

    return subscription;
  } catch (error) {
    throw new Error(
      `Stripe Error: Failed to schedule subscription cancellation - ${error}`
    );
  }
};

// refund last subscription payment
export const refundLastSubscriptionPayment = async (
  subscriptionId: string
): Promise<Stripe.Refund> => {
  try {
    const subscription = await stripe.subscriptions.retrieve(subscriptionId, {
      expand: ["latest_invoice.payment_intent"],
    });

    if (
      !subscription.latest_invoice ||
      typeof subscription.latest_invoice !== "object" ||
      !subscription.latest_invoice.payment_intent
    ) {
      throw new Error("No payment intent found for this subscription.");
    }

    const paymentIntentId = (subscription.latest_invoice.payment_intent as any)
      .id;

    const refund = await stripe.refunds.create({
      payment_intent: paymentIntentId,
    });

    return refund;
  } catch (error) {
    throw new Error(
      `Stripe Error: Failed to refund last subscription payment - ${error}`
    );
  }
};

// get subscription
export const getSubscription = async (
  subscriptionId: string
): Promise<Stripe.Subscription> => {
  try {
    const subscription = await stripe.subscriptions.retrieve(subscriptionId);
    return subscription;
  } catch (error) {
    throw new Error(`Stripe Error: Failed to retrieve subscription - ${error}`);
  }
};

// list customer subscriptions
export const listCustomerSubscriptions = async (
  customerId: string
): Promise<Stripe.ApiList<Stripe.Subscription>> => {
  try {
    const subscriptions = await stripe.subscriptions.list({
      customer: customerId,
      status: "active",
    });

    return subscriptions;
  } catch (error) {
    throw new Error(`Stripe Error: Failed to list subscriptions - ${error}`);
  }
};
