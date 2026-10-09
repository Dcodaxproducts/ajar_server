import { Response, NextFunction } from "express";
import { DamageReport } from "../models/damageReport.model";
import { Booking } from "../models/booking.model";
import mongoose from "mongoose";
import { sendResponse } from "../utils/response";
import { STATUS_CODES } from "../config/constants";
import { paginateQuery } from "../utils/paginate";
import { AuthRequest } from "../middlewares/auth.middleware";
import { notificationQueue } from "../queues/notification.queue";
import { cancelReminder } from "../queues/reminders";
import { REMINDER } from "../config/reminderTypes";
import { User } from "../models/user.model";
import { Payment } from "../models/payment.model";
import { refundBookingSecurityDeposit } from "../utils/bookingStripePayments";
import { createTransaction } from "../utils/transactionLedger";
import { canReadDamageDispute, isDisputeWindowOpen, validateDamageDisputeInput } from "../services/damageDispute.service";

// POST /api/damage-report
export const createDamageReport = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  const session = await mongoose.startSession();
  try {
    const { booking: bookingId, rentalText, issueType, damagedCharges } = req.body;
    const userId = req.user?.id;
    const files =
      (req.files as { [fieldname: string]: Express.Multer.File[] })?.attachments || [];
    const attachments = files.map((file) => `/uploads/${file.filename}`);

    if (!mongoose.Types.ObjectId.isValid(bookingId)) {
      return sendResponse(res, null, req.t("booking:invalidId"), STATUS_CODES.BAD_REQUEST);
    }

    const booking = await Booking.findById(bookingId).lean();
    if (!booking) {
      return sendResponse(res, null, req.t("booking:notFound"), STATUS_CODES.NOT_FOUND);
    }

    const isEarlyReturn =
      booking.status === "booking_cancelled" &&
      booking.cancelledFromStatus === "in_progress";
    if (booking.status !== "completed" && !isEarlyReturn) {
      return sendResponse(res, null, req.t("damage:bookingNotReturned"), STATUS_CODES.BAD_REQUEST);
    }
    if (isEarlyReturn && !booking.returnVerifiedAt) {
      return sendResponse(res, null, req.t("damage:returnPinRequired"), STATUS_CODES.BAD_REQUEST);
    }
    if (booking.leaser?.toString() !== userId) {
      return sendResponse(res, null, req.t("damage:onlyLeaserCanCreate"), STATUS_CODES.FORBIDDEN);
    }

    const deadline = booking.disputeWindowEndsAt;
    const now = new Date();
    if (!deadline || !isDisputeWindowOpen(now, deadline)) {
      return sendResponse(res, null, req.t("damage:windowExpired"), STATUS_CODES.BAD_REQUEST);
    }

    const depositAmount = Number(booking.priceDetails?.securityDeposit || 0);
    const inputError = validateDamageDisputeInput({
      damagedCharges,
      heldDeposit: depositAmount,
      rentalText,
      issueType,
      attachmentCount: files.length,
    });
    if (inputError) {
      return sendResponse(res, null, req.t(`damage:${inputError}`), STATUS_CODES.BAD_REQUEST);
    }

    const damageAmount = Number(Number(damagedCharges).toFixed(2));
    const reportId = new mongoose.Types.ObjectId();
    let claimedBooking: any = null;
    let report: any = null;

    await session.withTransaction(async () => {
      claimedBooking = await Booking.findOneAndUpdate(
        {
          _id: bookingId,
          leaser: userId,
          depositStatus: "held",
          disputeWindowEndsAt: { $gt: now },
          damageDisputeId: { $exists: false },
          "priceDetails.securityDeposit": { $gte: damageAmount },
        },
        {
          $set: {
            depositStatus: "disputed",
            damageDisputeId: reportId,
            damagesCharges: { damagedCharges: damageAmount, totalPrice: damageAmount },
          },
        },
        { new: true, session }
      ).populate("marketplaceListingId");

      if (!claimedBooking) throw new Error("DISPUTE_CLAIM_CONFLICT");

      [report] = await DamageReport.create(
        [{
          _id: reportId,
          booking: booking._id,
          rentalText: rentalText.trim(),
          issueType: issueType.trim(),
          damagedCharges: damageAmount,
          attachments,
          user: userId,
          status: "pending",
        }],
        { session }
      );
    });

    await cancelReminder(REMINDER.BOOKING_INSPECT_ITEM, bookingId.toString());
    await cancelReminder(REMINDER.DISPUTE_WINDOW_CLOSING, bookingId.toString());

    const listingName = claimedBooking?.marketplaceListingId?.name ||
      claimedBooking?.marketplaceListingId?.title || "your booking";
    try {
      const admins = await User.find({ role: "admin" }).select("_id").lean();
      await Promise.all(admins.map((admin) => notificationQueue.add("damage-report-filed", {
        userId: admin._id.toString(),
        title: "New Damage Report Filed",
        message: `A damage report has been submitted for "${listingName}". Amount: $${damageAmount.toFixed(2)}`,
        data: { bookingId: booking._id.toString(), reportId, type: "damage_report", status: "pending" },
      })));
      const renterId = booking.renter?.toString();
      if (renterId) {
        await notificationQueue.add("damage-report-filed-renter", {
          userId: renterId,
          title: "Damage Report Filed",
          message: `The host has reported damage for "${listingName}". Your security deposit remains retained while an Admin reviews it.`,
          data: { bookingId: booking._id.toString(), reportId, type: "damage_report", status: "pending" },
        });
      }
    } catch (notificationError) {
      console.error("Damage dispute notification failed:", notificationError);
    }

    return sendResponse(res, { report }, req.t("damage:submitted"), STATUS_CODES.CREATED);
  } catch (error) {
    if ((error as Error).message === "DISPUTE_CLAIM_CONFLICT" || (error as { code?: number }).code === 11000) {
      return sendResponse(res, null, req.t("damage:alreadyExistsOrReleased"), STATUS_CODES.CONFLICT);
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

    if (role !== "admin") {
      const bookings = await Booking.find({
        $or: [{ leaser: userId }, { renter: userId }],
      }).select("_id");
      queryObj.booking = { $in: bookings.map((booking) => booking._id) };
    }

    const allowedStatuses = ["pending", "approved", "partially_approved", "rejected"];
    if (status && allowedStatuses.includes(status)) queryObj.status = status;

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
  req: AuthRequest,
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

    const booking = report.booking as any;
    const userId = req.user?.id;
    const canRead = canReadDamageDispute({
      role: req.user?.role,
      userId,
      renterId: booking?.renter?._id?.toString(),
      leaserId: booking?.leaser?._id?.toString(),
    });
    if (!canRead) {
      return sendResponse(res, null, req.t("access:roleNotAllowed", { role: req.user?.role }), STATUS_CODES.FORBIDDEN);
    }

    sendResponse(res, report, req.t("damage:fetched"), STATUS_CODES.OK);
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
    const allowedStatuses = ["approved", "partially_approved", "rejected"];
    if (!allowedStatuses.includes(status)) {
      await session.abortTransaction();
      session.endSession();
      return sendResponse(res, null, req.t("damage:invalidStatus"), STATUS_CODES.BAD_REQUEST);
    }
    if (typeof adminNote !== "string" || adminNote.trim().length < 3 || adminNote.length > 1000) {
      await session.abortTransaction();
      session.endSession();
      return sendResponse(res, null, req.t("damage:resolutionReasonRequired"), STATUS_CODES.BAD_REQUEST);
    }

    // Claim pending before any Stripe side effect; concurrent Admin resolutions
    // serialize on this transactional write.
    const damageReport = await DamageReport.findOneAndUpdate(
      { _id: id, status: "pending" },
      { $set: { status: "processing" } },
      { new: true, session }
    )
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

    const bookingData = damageReport.booking as any;
    const listingName = bookingData?.marketplaceListingId?.name || bookingData?.marketplaceListingId?.title || "your listing";
    const damagedCharges = damageReport.damagedCharges || 0;
    const leaserId = bookingData?.leaser?._id?.toString();
    const renterId = bookingData?.renter?._id?.toString();

    if (bookingData?.depositStatus !== "disputed") {
      await session.abortTransaction();
      session.endSession();
      return sendResponse(res, null, req.t("damage:alreadySettled"), STATUS_CODES.CONFLICT);
    }

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
        if (parsedAmount > depositAmount || parsedAmount > damagedCharges) {
          await session.abortTransaction();
          session.endSession();
          return sendResponse(
            res,
            null,
            req.t("damage:approvedAmountTooHigh", {
              amount: parsedAmount.toFixed(2),
              deposit: Math.min(depositAmount, damagedCharges).toFixed(2),
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
        await refundBookingSecurityDeposit(
          bookingData._id,
          remainingDeposit,
          session,
          `dispute-${String(damageReport._id)}-remaining-deposit-v1`
        );
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
      damageReport.adminNote = adminNote.trim();
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
        await refundBookingSecurityDeposit(
          bookingData._id,
          depositAmount,
          session,
          `dispute-${String(damageReport._id)}-remaining-deposit-v1`
        );
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
      damageReport.adminNote = adminNote.trim();
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

