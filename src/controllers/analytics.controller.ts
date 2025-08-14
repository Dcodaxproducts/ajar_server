import { Request, Response, NextFunction } from "express";
import mongoose from "mongoose";
import { Booking } from "../models/booking.model";
import { RefundManagement } from "../models/refundManagement.model";
import { MarketplaceListing } from "../models/marketplaceListings.model";

type Granularity = "day" | "month" | "year";

const toObjectId = (v?: string) =>
  v && mongoose.Types.ObjectId.isValid(v)
    ? new mongoose.Types.ObjectId(v)
    : undefined;

const parseDate = (v?: string) => (v ? new Date(v) : undefined);

const addMonths = (d: Date, n: number) => {
  const c = new Date(d);
  c.setMonth(c.getMonth() + n);
  return c;
};

// CHANGE: helper to add days
const addDays = (d: Date, n: number) => {
  const c = new Date(d);
  c.setDate(c.getDate() + n);
  return c;
};

export const getAdminAnalytics = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    // -------- inputs
    const zoneId = toObjectId(req.query.zone as string);
    const subCategoryId = toObjectId(req.query.subCategory as string);
    const granularity: Granularity =
      (req.query.granularity as Granularity) || "month";

    // CHANGE: new optional filter filter
    const filter = (req.query.filter as string)?.toLowerCase(); // 'week', 'month', 'year'

    // date range (default: last 12 months)
    let dateTo = parseDate(req.query.dateTo as string) || new Date();
    let dateFrom =
      parseDate(req.query.dateFrom as string) ||
      addMonths(new Date(dateTo), -12);

    // CHANGE: override dateFrom/dateTo if filter is specified
    if (filter === "week") {
      dateFrom = addDays(new Date(dateTo), -7);
    } else if (filter === "month") {
      dateFrom = addMonths(new Date(dateTo), -1);
    } else if (filter === "year") {
      dateFrom = addMonths(new Date(dateTo), -12);
    }

    // previous filter for growth
    const msRange = dateTo.getTime() - dateFrom.getTime();
    const prevTo = new Date(dateFrom.getTime() - 1);
    const prevFrom = new Date(prevTo.getTime() - msRange);

    // common booking match
    const bookingMatch: any = {
      createdAt: { $gte: dateFrom, $lte: dateTo },
      status: { $in: ["accepted", "completed"] },
    };

    // join filters through MarketplaceListing
    if (zoneId || subCategoryId) {
      const listingMatch: any = {};
      if (zoneId) listingMatch.zone = zoneId;
      if (subCategoryId) listingMatch.subCategory = subCategoryId;

      const listingIds = await MarketplaceListing.find(listingMatch)
        .select("_id")
        .lean()
        .then((docs) => docs.map((d) => d._id));

      bookingMatch.marketplaceListingId = {
        $in: listingIds.length ? listingIds : [null],
      };
    }

    // helper addFields expression
    const revenueExpr = {
      $add: [
        { $ifNull: ["$priceDetails.totalPrice", 0] },
        { $ifNull: ["$extensionCharges.totalPrice", 0] },
      ],
    };
    const commissionExpr = {
      $add: [
        { $ifNull: ["$priceDetails.adminFee", 0] },
        { $ifNull: ["$extensionCharges.adminFee", 0] },
      ],
    };

    // -------- current filter aggregations (bookings)
    const [currentAgg] = await Booking.aggregate([
      { $match: bookingMatch },
      { $addFields: { revenue: revenueExpr, commission: commissionExpr } },
      {
        $group: {
          _id: null,
          totalRevenue: { $sum: "$revenue" },
          platformCommission: { $sum: "$commission" },
        },
      },
      { $project: { _id: 0 } },
    ]);

    const currentRevenue = currentAgg?.totalRevenue || 0;
    const currentCommission = currentAgg?.platformCommission || 0;

    // -------- refunds in current filter
    const refundMatch: any = {
      createdAt: { $gte: dateFrom, $lte: dateTo },
      status: "accept",
    };

    if (zoneId) refundMatch.zone = zoneId;
    if (subCategoryId) refundMatch.subCategory = subCategoryId;

    const [currentRefundAgg] = await RefundManagement.aggregate([
      { $match: refundMatch },
      {
        $group: {
          _id: null,
          refundIssued: { $sum: { $ifNull: ["$totalRefundAmount", 0] } },
        },
      },
      { $project: { _id: 0 } },
    ]);
    const currentRefund = currentRefundAgg?.refundIssued || 0;

    const currentOwnerPayout = Math.max(
      currentRevenue - currentCommission - currentRefund,
      0
    );

    // -------- previous filter for growth
    const prevBookingMatch = {
      ...bookingMatch,
      createdAt: { $gte: prevFrom, $lte: prevTo },
    };
    const [prevAgg] = await Booking.aggregate([
      { $match: prevBookingMatch },
      { $addFields: { revenue: revenueExpr, commission: commissionExpr } },
      {
        $group: {
          _id: null,
          totalRevenue: { $sum: "$revenue" },
          platformCommission: { $sum: "$commission" },
        },
      },
      { $project: { _id: 0 } },
    ]);
    const prevRevenue = prevAgg?.totalRevenue || 0;
    const prevCommission = prevAgg?.platformCommission || 0;

    const prevRefundMatch = {
      ...refundMatch,
      createdAt: { $gte: prevFrom, $lte: prevTo },
    };
    const [prevRefundAgg] = await RefundManagement.aggregate([
      { $match: prevRefundMatch },
      {
        $group: {
          _id: null,
          refundIssued: { $sum: { $ifNull: ["$totalRefundAmount", 0] } },
        },
      },
      { $project: { _id: 0 } },
    ]);
    const prevRefund = prevRefundAgg?.refundIssued || 0;
    const prevOwnerPayout = Math.max(
      prevRevenue - prevCommission - prevRefund,
      0
    );

    const pct = (cur: number, prev: number) =>
      prev > 0 ? ((cur - prev) / prev) * 100 : cur > 0 ? 100 : 0;

    // -------- trend series
    const dateFormat =
      granularity === "day"
        ? "%Y-%m-%d"
        : granularity === "year"
        ? "%Y"
        : "%Y-%m";

    const trend = await Booking.aggregate([
      { $match: bookingMatch },
      {
        $addFields: {
          revenue: revenueExpr,
          filter: { $dateToString: { date: "$createdAt", format: dateFormat } },
        },
      },
      { $group: { _id: "$filter", revenue: { $sum: "$revenue" } } },
      { $project: { _id: 0, filter: "$_id", revenue: 1 } },
      { $sort: { filter: 1 } },
    ]);

    // -------- category pie
    const categoryPie = await Booking.aggregate([
      { $match: bookingMatch },
      { $addFields: { revenue: revenueExpr } },
      {
        $lookup: {
          from: "marketplacelistings",
          localField: "marketplaceListingId",
          foreignField: "_id",
          as: "listing",
        },
      },
      { $unwind: "$listing" },
      {
        $lookup: {
          from: "subcategories",
          localField: "listing.subCategory",
          foreignField: "_id",
          as: "subcat",
        },
      },
      { $unwind: "$subcat" },
      {
        $group: {
          _id: "$subcat._id",
          label: { $first: "$subcat.name" },
          value: { $sum: "$revenue" },
        },
      },
      { $project: { _id: 0, label: 1, value: 1 } },
      { $sort: { value: -1 } },
      { $limit: 8 },
    ]);

    // -------- breakdown bars
    const breakdown = {
      commission: currentCommission,
      ownerPayout: currentOwnerPayout,
      refund: currentRefund,
    };

    // -------- response
    res.json({
      success: true,
      range: { dateFrom, dateTo, prevFrom, prevTo, granularity, filter }, // CHANGE: added filter
      performanceIndicators: {
        totalRevenue: currentRevenue,
        platformCommission: currentCommission,
        ownersPayouts: currentOwnerPayout,
        refundIssued: currentRefund,
        growth: {
          totalRevenuePct: pct(currentRevenue, prevRevenue),
          platformCommissionPct: pct(currentCommission, prevCommission),
          ownersPayoutsPct: pct(currentOwnerPayout, prevOwnerPayout),
          refundIssuedPct: pct(currentRefund, prevRefund),
        },
      },
      trend,
      breakdown,
      byCategory: categoryPie,
    });
  } catch (err) {
    next(err);
  }
};
