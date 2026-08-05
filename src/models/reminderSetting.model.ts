import mongoose, { Schema, Document } from "mongoose";

export type ReminderChannel = "push" | "email" | "sms";
export type ReminderAudience = "renter" | "leaser" | "admin";
export type ReminderTiming = "before" | "after";
export type ReminderUnit = "minutes" | "hours" | "days";

export interface IReminderSetting extends Document {
  type: string;
  label: string;
  offsetValue: number;
  offsetUnit: ReminderUnit;
  timing: ReminderTiming;
  enabled: boolean;
  channels: ReminderChannel[];
  audience: ReminderAudience;
  createdAt: Date;
  updatedAt: Date;
}

const ReminderSettingSchema = new Schema<IReminderSetting>(
  {
    // Matches the REMINDER_TYPES keys — the code decides when a reminder is
    // scheduled and cancelled, admins only control the values below
    type: { type: String, required: true, unique: true },
    label: { type: String, required: true },
    // Offset from the target date, expressed in whichever unit reads best for
    // that reminder — 5 minutes, 2 hours, 3 days
    offsetValue: { type: Number, required: true, min: 0 },
    offsetUnit: {
      type: String,
      enum: ["minutes", "hours", "days"],
      default: "hours",
    },
    // Whether the offset counts down to the target date or up from it —
    // "after" is what a post-rental review nudge needs
    timing: { type: String, enum: ["before", "after"], default: "before" },
    // Off by default — an admin turns each reminder on deliberately
    enabled: { type: Boolean, default: false },
    channels: [
      { type: String, enum: ["push", "email", "sms"], default: "push" },
    ],
    audience: {
      type: String,
      enum: ["renter", "leaser", "admin"],
      required: true,
    },
  },
  { timestamps: true }
);

export const ReminderSetting = mongoose.model<IReminderSetting>(
  "ReminderSetting",
  ReminderSettingSchema
);
