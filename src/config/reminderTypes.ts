import {
  ReminderAudience,
  ReminderChannel,
  ReminderTiming,
  ReminderUnit,
} from "../models/reminderSetting.model";

type ReminderTypeDefinition = {
  type: string;
  label: string;
  offsetValue: number;
  offsetUnit: ReminderUnit;
  timing: ReminderTiming;
  audience: ReminderAudience;
  channels: ReminderChannel[];
};

// Adding a reminder here is only half the job — it also needs a schedule call
// and a cancel call wired into the relevant controller.
// Every reminder ships disabled; an admin turns it on from the panel.
export const REMINDER_TYPES: ReminderTypeDefinition[] = [
  // ----- Renter -----
  {
    type: "booking-pickup",
    label: "Upcoming item pickup",
    offsetValue: 2,
    offsetUnit: "hours",
    timing: "before",
    audience: "renter",
    channels: ["push"],
  },
  {
    type: "booking-return",
    label: "Upcoming item return",
    offsetValue: 1,
    offsetUnit: "days",
    timing: "before",
    audience: "renter",
    channels: ["push"],
  },
  {
    type: "booking-review",
    label: "Leave a review after rental",
    offsetValue: 2,
    offsetUnit: "hours",
    timing: "after",
    audience: "renter",
    channels: ["push"],
  },

  // ----- Leaser -----
  {
    type: "booking-approval-expiring",
    label: "Booking approval expiring",
    offsetValue: 5,
    offsetUnit: "minutes",
    timing: "before",
    audience: "leaser",
    channels: ["push"],
  },
  {
    type: "booking-handover",
    label: "Upcoming item handover",
    offsetValue: 2,
    offsetUnit: "hours",
    timing: "before",
    audience: "leaser",
    channels: ["push"],
  },
  {
    type: "booking-return-leaser",
    label: "Upcoming item return (leaser)",
    offsetValue: 1,
    offsetUnit: "days",
    timing: "before",
    audience: "leaser",
    channels: ["push"],
  },
  {
    type: "booking-inspect-item",
    label: "Inspect the returned item",
    offsetValue: 2,
    offsetUnit: "hours",
    timing: "after",
    audience: "leaser",
    channels: ["push"],
  },
  {
    type: "dispute-window-closing",
    label: "Damage dispute window closing",
    offsetValue: 1,
    offsetUnit: "days",
    timing: "before",
    audience: "leaser",
    channels: ["push"],
  },
];

export const REMINDER = {
  // Renter
  BOOKING_PICKUP: "booking-pickup",
  BOOKING_RETURN: "booking-return",
  BOOKING_REVIEW: "booking-review",
  // Leaser
  BOOKING_APPROVAL_EXPIRING: "booking-approval-expiring",
  BOOKING_HANDOVER: "booking-handover",
  BOOKING_RETURN_LEASER: "booking-return-leaser",
  BOOKING_INSPECT_ITEM: "booking-inspect-item",
  DISPUTE_WINDOW_CLOSING: "dispute-window-closing",
} as const;
