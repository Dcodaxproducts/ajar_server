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
  return Transaction.findOneAndUpdate(
    { paymentId, userId, source },
    {
      paymentId,
      userId,
      amount: Number(amount),
      type,
      source,
      status,
    },
    { upsert: true, new: true, session }
  );
};
