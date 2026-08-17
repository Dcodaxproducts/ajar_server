import { Request, Response, NextFunction } from "express";
import { ReminderSetting } from "../models/reminderSetting.model";
import { sendResponse } from "../utils/response";
import { STATUS_CODES } from "../config/constants";

const ALLOWED_CHANNELS = ["push", "email"];
const ALLOWED_UNITS = ["minutes", "hours", "days"];

// GET /api/reminder-settings
export const getReminderSettings = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const settings = await ReminderSetting.find()
      .sort({ audience: 1, label: 1 })
      .lean();

    return sendResponse(res, settings, req.t("reminder:listFetched"), STATUS_CODES.OK);
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
          req.t("reminder:invalidOffsetValue"),
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
          req.t("reminder:invalidOffsetUnit", { allowed: ALLOWED_UNITS.join(", ") }),
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
          req.t("reminder:invalidEnabled"),
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
          req.t("reminder:invalidChannels", { allowed: ALLOWED_CHANNELS.join(", ") }),
          STATUS_CODES.BAD_REQUEST
        );
      }
      updates.channels = channels;
    }

    if (Object.keys(updates).length === 0) {
      return sendResponse(
        res,
        null,
        req.t("reminder:nothingToUpdate"),
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
        req.t("reminder:notFound"),
        STATUS_CODES.NOT_FOUND
      );
    }

    return sendResponse(res, setting, req.t("reminder:updated"), STATUS_CODES.OK);
  } catch (err) {
    next(err);
  }
};
