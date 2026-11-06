import mongoose from "mongoose";
import { Transaction, TransactionSource, TransactionType } from "../models/transaction.model";

export const createTransaction = async ({
  paymentId,
  userId,
  amount,
  type,
  source,
  status = "succeeded",
  session,
}: {
  paymentId: mongoose.Types.ObjectId | string;
  userId: mongoose.Types.ObjectId | string;
  amount: number;
  type: TransactionType;
  source: TransactionSource;
  status?: "pending" | "succeeded" | "failed";
  session?: mongoose.ClientSession;
}) => {
  const identity = { paymentId, userId, source };
  try {
    return await Transaction.findOneAndUpdate(
      identity,
      {
        $setOnInsert: {
          paymentId,
          userId,
          amount: Number(amount),
          type,
          source,
          status,
        },
      },
      { upsert: true, new: true, session, runValidators: true }
    );
  } catch (error) {
    if ((error as { code?: number }).code !== 11000) throw error;
    const winner = await Transaction.findOne(identity).session(session || null);
    if (!winner) throw error;
    if (
      winner.amount !== Number(amount) ||
      winner.type !== type ||
      winner.status !== status
    ) {
      throw new Error("FINANCIAL_SIDE_EFFECT_IDEMPOTENCY_CONFLICT");
    }
    return winner;
  }
};
