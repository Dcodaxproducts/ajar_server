import { notificationQueue } from "./notification.queue";
import {
  ReminderSetting,
  ReminderUnit,
} from "../models/reminderSetting.model";
import { REMINDER_TYPES } from "../config/reminderTypes";

const UNIT_MS: Record<ReminderUnit, number> = {
  minutes: 60 * 1000,
  hours: 60 * 60 * 1000,
  days: 24 * 60 * 60 * 1000,
};

// BullMQ rejects ":" inside a custom job id
const buildJobId = (type: string, entityId: string) => `${type}-${entityId}`;

// Inserts any reminder type that isn't in the DB yet, without touching values an
// admin has already changed.
export const seedReminderSettings = async () => {
  for (const definition of REMINDER_TYPES) {
    await ReminderSetting.updateOne(
      { type: definition.type },
      { $setOnInsert: definition },
      { upsert: true }
    );

    // Rows created before offsetValue/offsetUnit existed still carry hoursBefore
    await ReminderSetting.updateOne(
      { type: definition.type, offsetValue: { $exists: false } },
      {
        $set: {
          offsetValue: definition.offsetValue,
          offsetUnit: definition.offsetUnit,
        },
        $unset: { hoursBefore: "" },
      }
    );
  }
};

type ScheduleReminderArgs = {
  type: string;
  entityId: string;
  userId: string;
  targetDate: Date | string;
  title: string;
  message: string;
  data?: Record<string, any>;
};

/**
 * Queues a reminder to fire `offsetValue` `offsetUnit` before/after `targetDate`.
 * No-ops when the reminder is disabled, unknown, or the send time has passed.
 */
export const scheduleReminder = async ({
  type,
  entityId,
  userId,
  targetDate,
  title,
  message,
  data = {},
}: ScheduleReminderArgs) => {
  try {
    if (!userId) return null;

    const setting = await ReminderSetting.findOne({ type }).lean();
    if (!setting || !setting.enabled) return null;

    const target = new Date(targetDate).getTime();
    if (Number.isNaN(target)) return null;

    const offset = setting.offsetValue * (UNIT_MS[setting.offsetUnit] ?? UNIT_MS.hours);
    const sendAt = setting.timing === "after" ? target + offset : target - offset;
    const delay = sendAt - Date.now();

    // Send time has already passed — nothing useful to remind about
    if (delay <= 0) return null;

    return await notificationQueue.add(
      type,
      {
        userId,
        title,
        message,
        data: { ...data, type: "reminder", reminderType: type },
      },
      { delay, jobId: buildJobId(type, entityId) }
    );
  } catch (err) {
    console.error(`Failed to schedule reminder "${type}":`, err);
    return null;
  }
};

/**
 * Drops a scheduled reminder once the action it was nagging about is done.
 * Safe to call even when nothing was scheduled.
 */
export const cancelReminder = async (type: string, entityId: string) => {
  try {
    await notificationQueue.remove(buildJobId(type, entityId));
  } catch (err) {
    console.error(`Failed to cancel reminder "${type}":`, err);
  }
};
