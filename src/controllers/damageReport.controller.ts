import { Request, Response, NextFunction } from "express";
import { DamageReport } from "../models/damageReport.model";
import { Booking } from "../models/booking.model";
import mongoose from "mongoose";
import { sendResponse } from "../utils/response";
import { STATUS_CODES } from "../config/constants";
import { paginateQuery } from "../utils/paginate";
import { AuthRequest } from "../middlewares/auth.middleware";
import { notificationQueue } from "../queues/notification.queue";
import {
  DAMAGE_DISPUTE_ERROR_CODES,
  evaluateDamageDisputeEligibility,
} from "../services/damageDisputeWindow.service";
import {
  isSafeEvidenceReference,
  validateDamageDisputeDecision,
} from "../services/damageDisputeDecision.service";

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
    message: "Admin " + (report.status === "approved" ? "approved" : "rejected") + " the damage dispute for " + listing + ". No payment has been moved yet.",
    data: { bookingId: booking._id.toString(), disputeId: String(report._id), type: "damage_dispute_decision", status: report.status,
      approvedAmount: String(report.approvedAmount || 0), currency: report.currency, settlementExecutionStatus: "pending_story_3" },
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
      await enqueueDecisionNotifications(existing, booking);
      return sendResponse(res, { report: existing, idempotentReplay: true, settlementExecutionStatus: "pending_story_3" }, req.t("damage:updated"), STATUS_CODES.OK);
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
    await enqueueDecisionNotifications(updated, booking);
    return sendResponse(res, { report: updated, idempotentReplay: false, settlementExecutionStatus: "pending_story_3" }, req.t("damage:updated"), STATUS_CODES.OK);
  } catch (error) { next(error); }
};
