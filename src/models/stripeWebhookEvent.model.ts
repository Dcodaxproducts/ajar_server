import { Document, Schema, model } from "mongoose";

export interface IStripeWebhookEvent extends Document {
  eventId: string;
  type: string;
  status: "processing" | "processed";
  leaseUntil: Date;
  processedAt?: Date;
}

const StripeWebhookEventSchema = new Schema<IStripeWebhookEvent>({
  eventId: { type: String, required: true, unique: true },
  type: { type: String, required: true },
  status: { type: String, enum: ["processing", "processed"], required: true },
  leaseUntil: { type: Date, required: true },
  processedAt: { type: Date },
}, { timestamps: true });

StripeWebhookEventSchema.index({ createdAt: 1 }, { expireAfterSeconds: 60 * 60 * 24 * 90 });

export const StripeWebhookEvent = model<IStripeWebhookEvent>(
  "StripeWebhookEvent",
  StripeWebhookEventSchema
);
