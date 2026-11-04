import { Request, Response, NextFunction } from "express";
import { DamageReport } from "../models/damageReport.model";
import { Booking } from "../models/booking.model";
import mongoose from "mongoose";
import { sendResponse } from "../utils/response";
import { STATUS_CODES } from "../config/constants";
import { paginateQuery } from "../utils/paginate";
import { AuthRequest } from "../middlewares/auth.middleware";
import { notificationQueue } from "../queues/notification.queue";
import { User } from "../models/user.model";
import { Payment } from "../models/payment.model";
import { refundBookingSecurityDeposit } from "../utils/bookingStripePayments";
import { createTransaction } from "../utils/transactionLedger";
import {
  DAMAGE_DISPUTE_ERROR_CODES,
  evaluateDamageDisputeEligibility,
} from "../services/damageDisputeWindow.service";

const DAMAGE_DISPUTE_ERRORS = {
  notFound: {
    code: DAMAGE_DISPUTE_ERROR_CODES.notFound,
    status: STATUS_CODES.NOT_FOUND,
    translation: "damage:bookingNotFound",
  },
  wrong_status: {
    code: DAMAGE_DISPUTE_ERROR_CODES.wrong_status,
    status: STATUS_CODES.CONFLICT,
    translation: "damage:bookingNotReturned",
  },
  not_returned: {
    code: DAMAGE_DISPUTE_ERROR_CODES.not_returned,
    status: STATUS_CODES.CONFLICT,
    translation: "damage:returnPinRequired",
  },
  expired: {
    code: DAMAGE_DISPUTE_ERROR_CODES.expired,
    status: STATUS_CODES.CONFLICT,
    translation: "damage:windowExpired",
  },
  already_submitted: {
    code: DAMAGE_DISPUTE_ERROR_CODES.already_submitted,
    status: STATUS_CODES.CONFLICT,
    translation: "damage:alreadyExists",
  },
} as const;

type DamageDisputeErrorKey = keyof typeof DAMAGE_DISPUTE_ERRORS;

const sendDamageDisputeError = (
  req: AuthRequest,
  res: Response,
  key: DamageDisputeErrorKey,
  windowState: unknown = null
) => {
  const error = DAMAGE_DISPUTE_ERRORS[key];
  return sendResponse(
    res,
    { code: error.code, window: windowState },
    req.t(error.translation),
    error.status
  );
};

const findOwnedBooking = (bookingId: string, userId: string) =>
  Booking.findOne({ _id: bookingId, leaser: userId })
    .select(
      "_id leaser status cancelledFromStatus returnVerifiedAt damageDisputeId damageDisputeWindow depositDisputeWindowDays"
    );

// GET /api/damage-report/eligibility/:bookingId
export const getDamageDisputeEligibility = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    const { bookingId } = req.params;
    const userId = req.user?.id;

    if (!userId || !mongoose.Types.ObjectId.isValid(bookingId)) {
      return sendDamageDisputeError(req, res, "notFound");
    }

    const booking = await findOwnedBooking(bookingId, userId).lean();
    if (!booking) return sendDamageDisputeError(req, res, "notFound");

    const existingReport =
      booking.damageDisputeId ||
      (await DamageReport.exists({ booking: booking._id }));
    const windowState = evaluateDamageDisputeEligibility(
      { ...booking, damageDisputeId: existingReport },
      new Date()
    );

    return sendResponse(
      res,
      { code: "DAMAGE_DISPUTE_ELIGIBILITY", window: windowState },
      req.t("damage:eligibilityFetched"),
      STATUS_CODES.OK
    );
  } catch (error) {
    next(error);
  }
};

// POST /api/damage-report
export const createDamageReport = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  const session = await mongoose.startSession();

  try {
    const {
      booking: bookingId,
      rentalText,
      issueType,
      damagedCharges,
    } = req.body;
    const userId = req.user?.id;

    if (!userId || !mongoose.Types.ObjectId.isValid(bookingId)) {
      return sendDamageDisputeError(req, res, "notFound");
    }

    const attachments = (
      (req.files as { [fieldname: string]: Express.Multer.File[] })
        ?.attachments || []
    ).map((file) => `/uploads/${file.filename}`);

    let report: InstanceType<typeof DamageReport> | null = null;
    let windowState: ReturnType<typeof evaluateDamageDisputeEligibility> | null = null;
    let rejection: DamageDisputeErrorKey | null = null;

    await session.withTransaction(async () => {
      const booking = await findOwnedBooking(bookingId, userId).session(session);
      if (!booking) {
        rejection = "notFound";
        return;
      }

      const existingReport =
        booking.damageDisputeId ||
        (await DamageReport.exists({ booking: booking._id }).session(session));
      const checkedAt = new Date();
      windowState = evaluateDamageDisputeEligibility(
        { ...booking.toObject(), damageDisputeId: existingReport },
        checkedAt
      );

      if (!windowState.eligible) {
        rejection = windowState.state as DamageDisputeErrorKey;
        return;
      }

      const damageAmount = Number(damagedCharges) || 0;
      const created = await DamageReport.create(
        [
          {
            booking: booking._id,
            rentalText,
            issueType,
            damagedCharges: damageAmount,
            attachments,
            user: userId,
            status: "pending",
          },
        ],
        { session }
      );
      report = created[0];

      const bookingUpdate = await Booking.updateOne(
        {
          _id: booking._id,
          leaser: userId,
          damageDisputeId: { $exists: false },
        },
        {
          $set: {
            damagesCharges: {
              damagedCharges: damageAmount,
              totalPrice: damageAmount,
            },
            damageDisputeId: report._id,
          },
        },
        { session }
      );

      if (bookingUpdate.modifiedCount !== 1) {
        const duplicateError = new Error("duplicate damage dispute");
        (duplicateError as Error & { code: number }).code = 11000;
        throw duplicateError;
      }
    });

    if (rejection) {
      return sendDamageDisputeError(req, res, rejection, windowState);
    }

    if (!report || !windowState) {
      throw new Error("Damage dispute transaction completed without a result");
    }

    return sendResponse(
      res,
      {
        report,
        code: "DAMAGE_DISPUTE_SUBMITTED",
        window: windowState,
      },
      req.t("damage:submitted"),
      STATUS_CODES.CREATED
    );
  } catch (error) {
    const mongoError = error as { code?: number };
    if (mongoError.code === 11000 || mongoError.code === 112) {
      return sendDamageDisputeError(req, res, "already_submitted");
    }
    next(error);
  } finally {
    await session.endSession();
  }
};

// READ ALL (admin gets all, user gets their own)
export const getAllDamageReports = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    const { id: userId, role } = req.user!;
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 10;
    const status = req.query.status as string;

    const queryObj: any = {};

    //Admin → get all reports (no filter)
    if (role === "admin") {
      // no restrictions — admin sees everything
    }

    //Renter → only reports created by themselves
    else if (role === "renter") {
      queryObj.user = userId;
    }

    //Leaser → reports linked to bookings for their listings
    else if (role === "leaser") {
      // Step 1: find all booking IDs owned by this leaser
      const bookings = await Booking.find({ leaser: userId }).select("_id");
      const bookingIds = bookings.map((b) => b._id);

      // Step 2: restrict damage reports to those bookings
      queryObj.booking = { $in: bookingIds };
    }

    //Optional: Filter by status (pending/resolved)
    if (status && ["pending", "resolved"].includes(status)) {
      queryObj.status = status;
    }

    //Query with population
    const query = DamageReport.find(queryObj)
      .sort({ createdAt: -1 })
      .populate({
        path: "booking",
        populate: [
          { path: "renter", select: "name email" },
          { path: "leaser", select: "name email" },
          { path: "marketplaceListingId", select: "title zone" },
        ],
      })
      .populate("user", "name email role");

    const paginated = await paginateQuery(query, { page, limit });

    sendResponse(
      res,
      {
        tickets: paginated.data,
        total: paginated.total,
        page: paginated.page,
        limit: paginated.limit,
      },
      req.t("damage:fetched"),
      STATUS_CODES.OK
    );
  } catch (err) {
    next(err);
  }
};

// READ ONE
export const getDamageReportById = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return sendResponse(
        res,
        null,
        req.t("damage:invalidId"),
        STATUS_CODES.BAD_REQUEST
      );
    }

    const report = await DamageReport.findById(id)
      .populate({
        path: "booking",
        select: "renter leaser dates.checkIn dates.checkOut priceDetails status",
        populate: [
          {
            path: "renter",
            select: "name email profilePicture"
          },
          {
            path: "leaser",
            select: "name email profilePicture"
          }
        ]
      });

    if (!report) {
      return sendResponse(res, null, req.t("damage:notFound"), STATUS_CODES.NOT_FOUND);
    }

    sendResponse(res, report, req.t("damage:fetched"), STATUS_CODES.OK);
  } catch (err) {
    next(err);
  }
};

// UPDATE
export const updateDamageReport = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const { id } = req.params;
    const updateData = req.body;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return sendResponse(
        res,
        null,
        req.t("damage:invalidId"),
        STATUS_CODES.BAD_REQUEST
      );
    }

    const updatedReport = await DamageReport.findByIdAndUpdate(id, updateData, {
      new: true,
    })
      .populate("booking")
      .populate("user");

    if (!updatedReport) {
      return sendResponse(res, null, req.t("damage:notFound"), STATUS_CODES.NOT_FOUND);
    }

    sendResponse(res, updatedReport, req.t("damage:updated"), STATUS_CODES.OK);
  } catch (err) {
    next(err);
  }
};

// DELETE
export const deleteDamageReport = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return sendResponse(
        res,
        null,
        req.t("damage:invalidId"),
        STATUS_CODES.BAD_REQUEST
      );
    }

    const deletedReport = await DamageReport.findByIdAndDelete(id);
    if (!deletedReport) {
      return sendResponse(res, null, req.t("damage:notFound"), STATUS_CODES.NOT_FOUND);
    }

    sendResponse(res, null, req.t("damage:deleted"), STATUS_CODES.OK);
  } catch (err) {
    next(err);
  }
};

// PATCH /api/damage-report/:id/status
export const updateDamageReportStatus = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const { id } = req.params;
    const { status, adminNote, approvedAmount } = req.body;
    const userRole = req.user?.role;

    // Only admin can update status
    if (userRole !== "admin") {
      await session.abortTransaction();
      session.endSession();
      return sendResponse(res, null, req.t("damage:onlyAdminCanUpdate"), STATUS_CODES.FORBIDDEN);
    }

    // Validate report ID
    if (!mongoose.Types.ObjectId.isValid(id)) {
      await session.abortTransaction();
      session.endSession();
      return sendResponse(res, null, req.t("damage:invalidId"), STATUS_CODES.BAD_REQUEST);
    }

    // Validate status value
    const allowedStatuses = ["pending", "approved", "partially_approved", "rejected"];
    if (!allowedStatuses.includes(status)) {
      await session.abortTransaction();
      session.endSession();
      return sendResponse(res, null, req.t("damage:invalidStatus"), STATUS_CODES.BAD_REQUEST);
    }

    // Find damage report with full details
    const damageReport = await DamageReport.findById(id)
      .populate({
        path: "booking",
        populate: [
          { path: "renter", select: "firstName lastName email" },
          { path: "leaser", select: "firstName lastName email" },
          { path: "marketplaceListingId", select: "name title zone" },
        ],
      })
      .populate("user", "firstName lastName email role")
      .session(session);

    if (!damageReport) {
      await session.abortTransaction();
      session.endSession();
      return sendResponse(res, null, req.t("damage:notFound"), STATUS_CODES.NOT_FOUND);
    }

    // Prevent re-processing already settled reports
    if (
      damageReport.status === "approved" ||
      damageReport.status === "partially_approved" ||
      damageReport.status === "rejected"
    ) {
      await session.abortTransaction();
      session.endSession();
      return sendResponse(res, null, req.t("damage:alreadySettled"), STATUS_CODES.BAD_REQUEST);
    }

    const bookingData = damageReport.booking as any;
    const listingName = bookingData?.marketplaceListingId?.name || bookingData?.marketplaceListingId?.title || "your listing";
    const damagedCharges = damageReport.damagedCharges || 0;
    const leaserId = bookingData?.leaser?._id?.toString();
    const renterId = bookingData?.renter?._id?.toString();

    // ================= APPROVED / PARTIALLY APPROVED =================
    if (status === "approved" || status === "partially_approved") {
      const isPartial = status === "partially_approved";

      const admin = await User.findOne({ role: "admin" }).session(session);
      if (!admin) {
        await session.abortTransaction();
        session.endSession();
        return sendResponse(res, null, req.t("common:adminNotFound"), STATUS_CODES.NOT_FOUND);
      }

      const depositAmount = bookingData?.priceDetails?.securityDeposit || 0;

      // On a partial approval the admin sets the figure; on a full approval it
      // stays whatever the leaser claimed
      let settledAmount = damagedCharges;

      if (isPartial) {
        const parsedAmount = Number(approvedAmount);

        if (!Number.isFinite(parsedAmount) || parsedAmount <= 0) {
          await session.abortTransaction();
          session.endSession();
          return sendResponse(
            res,
            null,
            "approvedAmount must be a number greater than 0. Use 'rejected' to approve nothing.",
            STATUS_CODES.BAD_REQUEST
          );
        }

        // The deposit is the only pot money can come from — a claim larger than
        // the deposit is exactly why partial approval exists
        if (parsedAmount > depositAmount) {
          await session.abortTransaction();
          session.endSession();
          return sendResponse(
            res,
            null,
            req.t("damage:approvedAmountTooHigh", {
              amount: parsedAmount.toFixed(2),
              deposit: depositAmount.toFixed(2),
            }),
            STATUS_CODES.BAD_REQUEST
          );
        }

        settledAmount = parsedAmount;
      } else if (damagedCharges > depositAmount) {
        await session.abortTransaction();
        session.endSession();
        return sendResponse(
          res,
          null,
          req.t("damage:insufficientDeposit", {
            charges: damagedCharges.toFixed(2),
            deposit: depositAmount.toFixed(2),
          }),
          STATUS_CODES.BAD_REQUEST
        );
      }

      const remainingDeposit = depositAmount - settledAmount;
      if (settledAmount > 0) {
        const payment = await Payment.findOne({
          bookingId: bookingData._id,
          type: { $in: ["booking", "extension"] },
          status: { $in: ["captured", "partially_refunded", "paid_out"] },
        }).session(session);

        if (payment) {
          await createTransaction({
            paymentId: payment._id as mongoose.Types.ObjectId,
            userId: leaserId,
            amount: settledAmount,
            type: "credit",
            source: "damage_charge",
            session,
          });

          await createTransaction({
            paymentId: payment._id as mongoose.Types.ObjectId,
            userId: admin._id as mongoose.Types.ObjectId,
            amount: settledAmount,
            type: "debit",
            source: "damage_charge",
            session,
          });
        }
      }

      if (remainingDeposit > 0) {
        await refundBookingSecurityDeposit(bookingData._id, remainingDeposit, session);
      }

      await Booking.findByIdAndUpdate(
        bookingData._id,
        {
          $set: {
            depositStatus:
              settledAmount <= 0
                ? "released"
                : remainingDeposit > 0
                  ? "partially_refunded"
                  : "deducted",
            depositReleasedAt: new Date(),
            damageDisputeId: damageReport._id,
            // Keep the booking record on the settled figure, not the claim
            damagesCharges: {
              damagedCharges: settledAmount,
              totalPrice: settledAmount,
            },
          },
        },
        { session }
      );

      damageReport.status = isPartial ? "partially_approved" : "approved";
      damageReport.approvedAmount = settledAmount;
      damageReport.resolvedBy = req.user?.id as any;
      damageReport.resolvedAt = new Date();
      if (adminNote !== undefined) damageReport.adminNote = adminNote;
      await damageReport.save({ session });

      await session.commitTransaction();
      session.endSession();

      try {
        if (leaserId) {
          await notificationQueue.add(
            isPartial ? "damage-report-partially-approved" : "damage-report-approved",
            {
              userId: leaserId,
              title: isPartial
                ? "Damage Report Partially Approved"
                : "Damage Report Approved",
              message: isPartial
                ? `Admin partially approved the damage report for "${listingName}". You claimed $${damagedCharges.toFixed(2)} and $${settledAmount.toFixed(2)} has been approved from the renter's security deposit.`
                : `Admin approved the damage report for "${listingName}". Damage compensation of $${settledAmount.toFixed(2)} has been approved from the renter's security deposit.`,
              data: {
                bookingId: bookingData._id.toString(),
                type: "damage_report",
                status: isPartial ? "partially_approved" : "approved",
                claimedAmount: damagedCharges.toFixed(2),
                approvedAmount: settledAmount.toFixed(2),
              },
            }
          );
        }

        if (renterId) {
          const deductionLine = isPartial
            ? `$${settledAmount.toFixed(2)} of the $${damagedCharges.toFixed(2)} claimed has been deducted from your security deposit for the damage report on "${listingName}".`
            : `$${settledAmount.toFixed(2)} has been deducted from your security deposit for the damage report on "${listingName}".`;

          await notificationQueue.add("damage-charges-deducted", {
            userId: renterId,
            title: "Damage Charges Deducted",
            message:
              remainingDeposit > 0
                ? `${deductionLine} The remaining deposit of $${remainingDeposit.toFixed(2)} has been refunded to your original payment method.`
                : `${deductionLine} No remaining deposit to refund.`,
            data: {
              bookingId: bookingData._id.toString(),
              type: "damage_report",
              status: isPartial ? "partially_approved" : "approved",
              claimedAmount: damagedCharges.toFixed(2),
              approvedAmount: settledAmount.toFixed(2),
              refundedAmount: remainingDeposit.toFixed(2),
            },
          });
        }
      } catch (err) {
        console.error("Notification Error:", err);
      }

      return sendResponse(
        res,
        damageReport,
        isPartial
          ? req.t("damage:partiallyApproved", { amount: settledAmount.toFixed(2) })
          : req.t("damage:approved", { amount: settledAmount.toFixed(2) }),
        STATUS_CODES.OK
      );
    }

    // ================= REJECTED =================
    if (status === "rejected") {
      const admin = await User.findOne({ role: "admin" }).session(session);
      if (!admin) {
        await session.abortTransaction();
        session.endSession();
        return sendResponse(res, null, req.t("common:adminNotFound"), STATUS_CODES.NOT_FOUND);
      }

      // Declare outside so notifications can access it
      const depositAmount = bookingData?.priceDetails?.securityDeposit || 0;

      if (depositAmount > 0) {
        await refundBookingSecurityDeposit(bookingData._id, depositAmount, session);
// Set security deposit to 0 on booking since fully settled
        await Booking.findByIdAndUpdate(
          bookingData._id,
          {
            $set: {
              "priceDetails.securityDeposit": 0,
              depositStatus: "released",
              depositReleasedAt: new Date(),
              damageDisputeId: damageReport._id,
            },
          },
          { session }
        );
      }

      if (depositAmount <= 0) {
        await Booking.findByIdAndUpdate(
          bookingData._id,
          {
            $set: {
              depositStatus: "released",
              depositReleasedAt: new Date(),
              damageDisputeId: damageReport._id,
            },
          },
          { session }
        );
      }

      damageReport.status = "rejected";
      damageReport.resolvedBy = req.user?.id as any;
      damageReport.resolvedAt = new Date();
      if (adminNote !== undefined) damageReport.adminNote = adminNote;
      await damageReport.save({ session });

      await session.commitTransaction();
      session.endSession();

      try {
        if (leaserId) {
          await notificationQueue.add("damage-report-rejected", {
            userId: leaserId,
            title: "Damage Report Rejected",
            message: `Admin has rejected the damage report for "${listingName}". The renter's security deposit has been refunded.`,
            data: { bookingId: bookingData._id.toString(), type: "damage_report", status: "rejected" },
          });
        }

        if (renterId) {
          await notificationQueue.add("damage-report-rejected", {
            userId: renterId,
            title: "Damage Report Rejected",
            message: depositAmount > 0
              ? `The damage report for "${listingName}" has been rejected by admin. Your full security deposit of $${depositAmount.toFixed(2)} has been refunded to your original payment method.`
              : `The damage report for "${listingName}" has been rejected by admin. No security deposit was held.`,
            data: { bookingId: bookingData._id.toString(), type: "damage_report", status: "rejected" },
          });
        }

        if (depositAmount > 0) {
          await notificationQueue.add("security-deposit-released", {
            userId: admin._id as string,
            title: "Security Deposit Released",
            message: `The full security deposit of $${depositAmount.toFixed(2)} for "${listingName}" has been released from escrow and refunded to the renter after damage report rejection.`,
            data: { bookingId: bookingData._id.toString(), type: "damage_report", status: "rejected" },
          });
        }
      } catch (err) {
        console.error("Notification Error:", err);
      }

      return sendResponse(res, null, req.t("damage:rejected"), STATUS_CODES.OK);
    }

    // ================= PENDING (reset) =================
    damageReport.status = "pending";
    await damageReport.save({ session });

    await session.commitTransaction();
    session.endSession();

    return sendResponse(res, damageReport, req.t("damage:resetToPending"), STATUS_CODES.OK);

  } catch (err) {
    console.error("Update Damage Report Error:", err);
    await session.abortTransaction();
    session.endSession();
    next(err);
  }
};

