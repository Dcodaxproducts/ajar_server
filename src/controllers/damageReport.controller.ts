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
import { canReadDamageDispute, isDisputeWindowOpen, validateDamageDisputeInput } from "../services/damageDispute.service";
import {
  DAMAGE_DISPUTE_ERROR_CODES,
  evaluateDamageDisputeEligibility,
} from "../services/damageDisputeWindow.service";
import {
  isSafeEvidenceReference,
  validateDamageDisputeDecision,
} from "../services/damageDisputeDecision.service";
import {
  blockDepositReleaseForDispute,
  MAX_DEPOSIT_ACTION_ATTEMPTS,
  scheduleDepositDecision,
} from "../services/securityDepositAuthorization.service";
import { SecurityDepositAuthorization } from "../models/securityDepositAuthorization.model";

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
      "_id leaser status cancelledFromStatus returnVerifiedAt damageDisputeId damageDisputeWindow depositDisputeWindowDays priceDetails.securityDeposit depositStatus"
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
      claimedBooking = await Booking.findOneAndUpdate(        {
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
            damagesCharges: { damagedCharges: damageAmount, totalPrice: damageAmount },          },
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

      await blockDepositReleaseForDispute(
        booking._id,
        reportId,
        now,
        session
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


const safePage = (value: unknown) => { const parsed = Number(value); return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : 1; };
const safeLimit = (value: unknown) => { const parsed = Number(value); return Number.isSafeInteger(parsed) && parsed > 0 ? Math.min(parsed, 50) : 10; };
const safeAttachments = (attachments: string[]) => attachments.filter(isSafeEvidenceReference);

export const getAllDamageReports = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const page = safePage(req.query.page); const limit = safeLimit(req.query.limit);
    const status = typeof req.query.status === "string" ? req.query.status : undefined;
    const queryObj: Record<string, unknown> = {};
    if (status && ["pending", "approved", "rejected", "partially_approved"].includes(status)) queryObj.status = status;
    const query = DamageReport.find(queryObj)
      .select("booking rentalText issueType damagedCharges attachments user status approvedAmount resolvedBy resolvedAt adminNote currency version decisionEvidence createdAt updatedAt")
      .sort({ createdAt: -1, _id: -1 })
      .populate({ path: "booking", select: "renter leaser marketplaceListingId dates priceDetails.securityDeposit status", populate: [
        { path: "renter", select: "name firstName lastName email" }, { path: "leaser", select: "name firstName lastName email" },
        { path: "marketplaceListingId", select: "name title" },
      ] }).populate("user", "name firstName lastName email");
    const paginated = await paginateQuery(query, { page, limit });
    const tickets = paginated.data.map((ticket) => { const object = ticket.toObject(); object.attachments = safeAttachments(object.attachments || []); return object; });
    return sendResponse(res, { tickets, total: paginated.total, page: paginated.page, limit: paginated.limit }, req.t("damage:fetched"), STATUS_CODES.OK);
  } catch (error) { next(error); }
};

export const getDamageReportById = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) return sendResponse(res, null, req.t("damage:invalidId"), STATUS_CODES.BAD_REQUEST);
    const report = await DamageReport.findById(id)
      .select("booking rentalText issueType damagedCharges attachments user status approvedAmount resolvedBy resolvedAt adminNote currency version decisionEvidence decisionAudit createdAt updatedAt")
      .populate({ path: "booking", select: "renter leaser marketplaceListingId dates priceDetails.securityDeposit status", populate: [
        { path: "renter", select: "name firstName lastName email" }, { path: "leaser", select: "name firstName lastName email" },
        { path: "marketplaceListingId", select: "name title" },
      ] }).populate("resolvedBy", "name firstName lastName email").lean();
    if (!report) return sendResponse(res, null, req.t("damage:notFound"), STATUS_CODES.NOT_FOUND);
    report.attachments = safeAttachments(report.attachments || []); report.decisionEvidence = safeAttachments(report.decisionEvidence || []);
    return sendResponse(res, report, req.t("damage:fetched"), STATUS_CODES.OK);
  } catch (error) { next(error); }
};

export const getMyDamageReportForBooking = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const userId = req.user?.id; const { bookingId } = req.params;
    if (!userId || !mongoose.Types.ObjectId.isValid(bookingId)) return sendResponse(res, null, req.t("damage:notFound"), STATUS_CODES.NOT_FOUND);
    const booking = await Booking.findOne({ _id: bookingId, $or: [{ renter: userId }, { leaser: userId }] }).select("_id").lean();
    if (!booking) return sendResponse(res, null, req.t("damage:notFound"), STATUS_CODES.NOT_FOUND);
    const report = await DamageReport.findOne({ booking: booking._id })
      .select("booking rentalText issueType damagedCharges attachments status approvedAmount resolvedAt adminNote currency version decisionEvidence createdAt updatedAt").lean();
    if (!report) return sendResponse(res, null, req.t("damage:notFound"), STATUS_CODES.NOT_FOUND);
    report.attachments = safeAttachments(report.attachments || []); report.decisionEvidence = safeAttachments(report.decisionEvidence || []);
    return sendResponse(res, report, req.t("damage:fetched"), STATUS_CODES.OK);
  } catch (error) { next(error); }
};

type BookingForDecision = { _id: mongoose.Types.ObjectId; renter?: { _id?: mongoose.Types.ObjectId } | mongoose.Types.ObjectId; leaser?: { _id?: mongoose.Types.ObjectId } | mongoose.Types.ObjectId; marketplaceListingId?: { name?: string; title?: string }; priceDetails?: { securityDeposit?: number } };
const objectIdString = (value: BookingForDecision["renter"]) => { if (!value) return null; if (value instanceof mongoose.Types.ObjectId) return value.toString(); return value._id?.toString() || null; };

const enqueueDecisionNotifications = async (report: InstanceType<typeof DamageReport>, booking: BookingForDecision) => {
  const listing = booking.marketplaceListingId?.name || booking.marketplaceListingId?.title || "the rental";
  const recipients = [objectIdString(booking.leaser), objectIdString(booking.renter)].filter((id): id is string => Boolean(id));
  await Promise.all(recipients.map((userId) => notificationQueue.add("damage-dispute-admin-decision-recorded", {
    userId, title: "Damage dispute decision recorded",
    message: "Admin " + (report.status === "approved" ? "approved" : "rejected") + " the damage dispute for " + listing + ". Deposit settlement is scheduled.",
    data: { bookingId: booking._id.toString(), disputeId: String(report._id), type: "damage_dispute_decision", status: report.status,
      approvedAmount: String(report.approvedAmount || 0), currency: report.currency, settlementExecutionStatus: "scheduled" },
  }, { jobId: "damage-dispute-decision-" + String(report._id) + "-" + report.version + "-" + userId })));
};

// Records the settlement decision only. Story 3 owns every Stripe/payment action.
export const decideDamageReport = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    if (req.user?.role !== "admin" || !req.user.id) return sendResponse(res, null, req.t("damage:onlyAdminCanUpdate"), STATUS_CODES.FORBIDDEN);
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) return sendResponse(res, null, req.t("damage:invalidId"), STATUS_CODES.BAD_REQUEST);
    const existing = await DamageReport.findById(id).populate({ path: "booking", select: "renter leaser marketplaceListingId priceDetails.securityDeposit", populate: { path: "marketplaceListingId", select: "name title" } });
    if (!existing) return sendResponse(res, null, req.t("damage:notFound"), STATUS_CODES.NOT_FOUND);
    const booking = existing.booking as unknown as BookingForDecision;
    const validation = validateDamageDisputeDecision(req.body, existing.damagedCharges, Number(booking.priceDetails?.securityDeposit || 0), safeAttachments(existing.attachments || []));
    if (!validation.ok) return sendResponse(res, { code: validation.code }, validation.code, STATUS_CODES.BAD_REQUEST);
    const decision = validation.value;
    if (existing.decisionIdempotencyKey === decision.idempotencyKey) {
      const sameEvidence = JSON.stringify(existing.decisionEvidence || []) === JSON.stringify(decision.evidenceReferences);
      const isIdenticalRetry =
        existing.status === decision.decision &&
        existing.adminNote === decision.reason &&
        existing.approvedAmount === decision.approvedAmount &&
        existing.currency === decision.currency &&
        sameEvidence;
      if (!isIdenticalRetry) {
        return sendResponse(res, { code: "DAMAGE_DISPUTE_IDEMPOTENCY_CONFLICT" }, "DAMAGE_DISPUTE_IDEMPOTENCY_CONFLICT", STATUS_CODES.CONFLICT);
      }
      const settlement = await scheduleDepositDecision(existing._id as mongoose.Types.ObjectId);
      const settlementExecutionStatus = settlement?.state === "PROVIDER_ACTION_REQUIRED" ? "provider_action_required" : "scheduled";
      await enqueueDecisionNotifications(existing, booking);
      return sendResponse(res, { report: existing, idempotentReplay: true, settlementExecutionStatus }, req.t("damage:updated"), STATUS_CODES.OK);
    }
    if (existing.status !== "pending" || existing.version !== decision.expectedVersion) return sendResponse(res, { code: "DAMAGE_DISPUTE_DECISION_CONFLICT", currentVersion: existing.version, status: existing.status }, "DAMAGE_DISPUTE_DECISION_CONFLICT", STATUS_CODES.CONFLICT);
    const decidedAt = new Date(); const nextVersion = decision.expectedVersion + 1;
    const versionCondition = decision.expectedVersion === 0
      ? { $or: [{ version: 0 }, { version: { $exists: false } }] }
      : { version: decision.expectedVersion };
    const updated = await DamageReport.findOneAndUpdate({ _id: id, status: "pending", ...versionCondition }, {
      $set: { status: decision.decision, approvedAmount: decision.approvedAmount, resolvedBy: req.user.id, resolvedAt: decidedAt, adminNote: decision.reason,
        currency: decision.currency, decisionIdempotencyKey: decision.idempotencyKey, decisionEvidence: decision.evidenceReferences },
      $inc: { version: 1 },
      $push: { decisionAudit: { action: decision.decision, actor: req.user.id, at: decidedAt, reason: decision.reason, claimedAmount: existing.damagedCharges,
        approvedAmount: decision.approvedAmount, currency: decision.currency, evidence: decision.evidenceReferences, version: nextVersion, idempotencyKey: decision.idempotencyKey } },
    }, { new: true, runValidators: true });
    if (!updated) return sendResponse(res, { code: "DAMAGE_DISPUTE_DECISION_CONFLICT" }, "DAMAGE_DISPUTE_DECISION_CONFLICT", STATUS_CODES.CONFLICT);
    const settlement = await scheduleDepositDecision(updated._id as mongoose.Types.ObjectId);
    const settlementExecutionStatus = settlement?.state === "PROVIDER_ACTION_REQUIRED" ? "provider_action_required" : "scheduled";
    await enqueueDecisionNotifications(updated, booking);
    return sendResponse(res, { report: updated, idempotentReplay: false, settlementExecutionStatus }, req.t("damage:updated"), STATUS_CODES.OK);
  } catch (error) { next(error); }
};

export const getSecurityDepositStatus = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { bookingId } = req.params;
    if (!req.user?.id || !mongoose.Types.ObjectId.isValid(bookingId)) {
      return sendResponse(res, null, req.t("damage:notFound"), STATUS_CODES.NOT_FOUND);
    }
    const scope = req.user.role === "admin"
      ? { _id: bookingId }
      : { _id: bookingId, $or: [{ renter: req.user.id }, { leaser: req.user.id }] };
    const booking = await Booking.findOne(scope).select("_id").lean();
    if (!booking) return sendResponse(res, null, req.t("damage:notFound"), STATUS_CODES.NOT_FOUND);
    const authorization = await SecurityDepositAuthorization.findOne({ bookingId: booking._id })
      .select("state amountAuthorized amountCapturable amountCaptured currency captureBefore disputeDeadline nextActionAt attempts lastErrorCode version")
      .lean();
    if (!authorization) return sendResponse(res, { state: "NONE" }, req.t("damage:fetched"), STATUS_CODES.OK);
    return sendResponse(res, {
      state: authorization.state,
      amountAuthorized: authorization.amountAuthorized / 100,
      amountCapturable: authorization.amountCapturable / 100,
      amountCaptured: authorization.amountCaptured / 100,
      currency: authorization.currency.toUpperCase(),
      captureBefore: authorization.captureBefore,
      disputeDeadline: authorization.disputeDeadline,
      nextActionAt: authorization.nextActionAt,
      attempts: authorization.attempts,
      failureCode: authorization.lastErrorCode,
      manualReviewRequired: authorization.state === "PROVIDER_ACTION_REQUIRED" || authorization.attempts >= MAX_DEPOSIT_ACTION_ATTEMPTS,
      canRetry: req.user.role === "admin" && authorization.state === "FAILED_RETRYABLE" && authorization.attempts < MAX_DEPOSIT_ACTION_ATTEMPTS,
      version: authorization.version,
    }, req.t("damage:fetched"), STATUS_CODES.OK);
  } catch (error) { next(error); }
};

export const retryDamageSettlement = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    if (req.user?.role !== "admin") return sendResponse(res, null, req.t("damage:onlyAdminCanUpdate"), STATUS_CODES.FORBIDDEN);
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) return sendResponse(res, null, req.t("damage:invalidId"), STATUS_CODES.BAD_REQUEST);
    const report = await DamageReport.findById(id).select("booking status").lean();
    if (!report || !["approved", "rejected"].includes(report.status)) return sendResponse(res, null, req.t("damage:notFound"), STATUS_CODES.NOT_FOUND);
    const retried = await SecurityDepositAuthorization.findOneAndUpdate(
      { bookingId: report.booking, state: "FAILED_RETRYABLE", attempts: { $lt: MAX_DEPOSIT_ACTION_ATTEMPTS } },
      { $set: { state: "SETTLEMENT_SCHEDULED", nextActionAt: new Date() }, $unset: { leaseUntil: 1, lastErrorCode: 1 }, $inc: { version: 1 } },
      { new: true }
    );
    if (!retried) return sendResponse(res, { code: "DEPOSIT_ACTION_NOT_RETRYABLE" }, "DEPOSIT_ACTION_NOT_RETRYABLE", STATUS_CODES.CONFLICT);
    return sendResponse(res, { state: retried.state, version: retried.version }, req.t("damage:updated"), STATUS_CODES.OK);
  } catch (error) { next(error); }
};
