import { Request, Response, NextFunction } from "express";
import { ReminderSetting } from "../models/reminderSetting.model";
import { sendResponse } from "../utils/response";
import { STATUS_CODES } from "../config/constants";

const ALLOWED_CHANNELS = ["push", "email", "sms"];
const ALLOWED_UNITS = ["minutes", "hours", "days"];

// GET /api/reminder-settings
export const getReminderSettings = async (
  _req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const settings = await ReminderSetting.find()
      .sort({ audience: 1, label: 1 })
      .lean();

    return sendResponse(res, settings, "Reminder settings fetched", STATUS_CODES.OK);
  } catch (err) {
    next(err);
  }
};

// PATCH /api/reminder-settings/:type
// Only tunable values can change — the type list itself comes from the code.
export const updateReminderSetting = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const { type } = req.params;
    const { offsetValue, offsetUnit, enabled, channels } = req.body;

    const updates: Record<string, any> = {};

    if (offsetValue !== undefined) {
      const value = Number(offsetValue);
      if (Number.isNaN(value) || value < 0) {
        return sendResponse(
          res,
          null,
          "offsetValue must be a number greater than or equal to 0",
          STATUS_CODES.BAD_REQUEST
        );
      }
      updates.offsetValue = value;
    }

    if (offsetUnit !== undefined) {
      if (!ALLOWED_UNITS.includes(offsetUnit)) {
        return sendResponse(
          res,
          null,
          `offsetUnit must be one of: ${ALLOWED_UNITS.join(", ")}`,
          STATUS_CODES.BAD_REQUEST
        );
      }
      updates.offsetUnit = offsetUnit;
    }

    if (enabled !== undefined) {
      if (typeof enabled !== "boolean") {
        return sendResponse(
          res,
          null,
          "enabled must be true or false",
          STATUS_CODES.BAD_REQUEST
        );
      }
      updates.enabled = enabled;
    }

    if (channels !== undefined) {
      if (
        !Array.isArray(channels) ||
        channels.length === 0 ||
        channels.some((channel: string) => !ALLOWED_CHANNELS.includes(channel))
      ) {
        return sendResponse(
          res,
          null,
          `channels must be a non-empty array of: ${ALLOWED_CHANNELS.join(", ")}`,
          STATUS_CODES.BAD_REQUEST
        );
      }
      updates.channels = channels;
    }

    if (Object.keys(updates).length === 0) {
      return sendResponse(
        res,
        null,
        "Nothing to update. Send offsetValue, offsetUnit, enabled or channels.",
        STATUS_CODES.BAD_REQUEST
      );
    }

    const setting = await ReminderSetting.findOneAndUpdate(
      { type },
      { $set: updates },
      { new: true }
    );

    if (!setting) {
      return sendResponse(
        res,
        null,
        "Reminder setting not found",
        STATUS_CODES.NOT_FOUND
      );
    }

    return sendResponse(res, setting, "Reminder setting updated", STATUS_CODES.OK);
  } catch (err) {
    next(err);
  }
};
