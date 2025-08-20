import { Request, Response, NextFunction } from "express";
import mongoose from "mongoose";
import { Booking } from "../models/booking.model";
import { RefundRequest } from "../models/refundRequest.model";
import { MarketplaceListing } from "../models/marketplaceListings.model";

type Granularity = "day" | "month" | "year";

const toObjectId = (v?: string) =>
  v && mongoose.Types.ObjectId.isValid(v)
    ? new mongoose.Types.ObjectId(v)
    : undefined;

const parseDate = (v?: string) => (v ? new Date(v) : undefined);
const addMonths = (d: Date, n: number) =>
  new Date(d.setMonth(d.getMonth() + n));
const addDays = (d: Date, n: number) => new Date(d.setDate(d.getDate() + n));
const startOfDay = (d: Date) => new Date(d.setHours(0, 0, 0, 0));
const endOfDay = (d: Date) => new Date(d.setHours(23, 59, 59, 999));

export const getAdminAnalytics = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    // inputs
    const zoneId = toObjectId(req.query.zone as string);
    const subCategoryId = toObjectId(req.query.subCategory as string);
    const filter = (req.query.filter as string)?.toLowerCase(); // 'week', 'month', 'year'

    let dateTo = parseDate(req.query.dateTo as string) || new Date();
    let dateFrom =
      parseDate(req.query.dateFrom as string) ||
      addMonths(new Date(dateTo), -12);

    if (filter === "week") dateFrom = addDays(new Date(dateTo), -7);
    else if (filter === "month") dateFrom = addMonths(new Date(dateTo), -1);
    else if (filter === "year") dateFrom = addMonths(new Date(dateTo), -12);

    const msRange = dateTo.getTime() - dateFrom.getTime();
    const prevTo = new Date(dateFrom.getTime() - 1);
    const prevFrom = new Date(prevTo.getTime() - msRange);

    // listing filter
    let listingIds: mongoose.Types.ObjectId[] = [];
    if (zoneId || subCategoryId) {
      const match: any = {};
      if (zoneId) match.zone = zoneId;
      if (subCategoryId) match.subCategory = subCategoryId;
      listingIds = await MarketplaceListing.find(match)
        .select("_id")
        .lean()
        .then((docs) => docs.map((d) => d._id as mongoose.Types.ObjectId));
    }

    let filterBookingIds: mongoose.Types.ObjectId[] | undefined;
    if (zoneId || subCategoryId) {
      filterBookingIds = await Booking.find({
        marketplaceListingId: {
          $in: listingIds.length ? listingIds : [null],
        },
      })
        .select("_id")
        .lean()
        .then((docs) => docs.map((d) => d._id as mongoose.Types.ObjectId));
    }

    // expressions
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

    // base matches
    const bookingMatch = (from: Date, to: Date) => {
      const m: any = {
        createdAt: { $gte: from, $lte: to },
        status: { $in: ["accepted", "completed"] },
      };
      if (zoneId || subCategoryId) {
        m.marketplaceListingId = {
          $in: listingIds.length ? listingIds : [null],
        };
      }
      return m;
    };

    const refundMatch = (from: Date, to: Date) => {
      const m: any = { createdAt: { $gte: from, $lte: to }, status: "accept" };
      if (zoneId || subCategoryId) {
        m.booking = {
          $in: (filterBookingIds && filterBookingIds.length
            ? filterBookingIds
            : [null]) as any,
        };
      }
      return m;
    };

    // aggregate helpers
    const aggBookings = async (from: Date, to: Date) => {
      const [agg] = await Booking.aggregate([
        { $match: bookingMatch(from, to) },
        { $addFields: { revenue: revenueExpr, commission: commissionExpr } },
        {
          $group: {
            _id: null,
            totalRevenue: { $sum: "$revenue" },
            platformCommission: { $sum: "$commission" },
          },
        },
      ]);
      return {
        totalRevenue: agg?.totalRevenue || 0,
        platformCommission: agg?.platformCommission || 0,
      };
    };

    const aggRefunds = async (from: Date, to: Date) => {
      const [agg] = await RefundRequest.aggregate([
        { $match: refundMatch(from, to) },
        {
          $group: {
            _id: null,
            refundIssued: { $sum: { $ifNull: ["$totalRefundAmount", 0] } },
          },
        },
      ]);
      return agg?.refundIssued || 0;
    };

    // totals
    const curBk = await aggBookings(dateFrom, dateTo);
    const prevBk = await aggBookings(prevFrom, prevTo);

    const currentRevenue = curBk.totalRevenue;
    const currentCommission = curBk.platformCommission;
    const currentRefund = await aggRefunds(dateFrom, dateTo);
    const currentOwnerPayout = Math.max(
      currentRevenue - currentCommission - currentRefund,
      0
    );

    const prevRevenue = prevBk.totalRevenue;
    const prevCommission = prevBk.platformCommission;
    const prevRefund = await aggRefunds(prevFrom, prevTo);
    const prevOwnerPayout = Math.max(
      prevRevenue - prevCommission - prevRefund,
      0
    );

    // helpers
    const pct = (cur: number, prev: number) =>
      prev > 0 ? ((cur - prev) / prev) * 100 : cur > 0 ? 100 : 0;

    const calcTrend = (cur: number, prev: number) => {
      const diff = cur - prev;
      const trend = diff >= 0 ? "up" : "down";
      const perc =
        prev === 0
          ? cur > 0
            ? 100
            : 0
          : Math.abs(Math.round((diff / prev) * 100));
      return { value: `${perc}`, trend };
    };

    // chart records
    const revenueRecords: { value: string; amount: number }[] = [];
    const commissionRecords: { value: string; amount: number }[] = [];
    const refundRecords: { value: string; amount: number }[] = [];
    const payoutRecords: { value: string; amount: number }[] = [];

    const base = new Date(dateTo);

    if (filter === "week") {
      for (let i = 6; i >= 0; i--) {
        const start = startOfDay(addDays(base, -i));
        const end = endOfDay(start);
        const b = await aggBookings(start, end);
        const r = await aggRefunds(start, end);
        const p = Math.max(b.totalRevenue - b.platformCommission - r, 0);

        const idx = `${7 - i}`;
        revenueRecords.push({ value: idx, amount: b.totalRevenue });
        commissionRecords.push({ value: idx, amount: b.platformCommission });
        refundRecords.push({ value: idx, amount: r });
        payoutRecords.push({ value: idx, amount: p });
      }
    } else if (filter === "month") {
      for (let i = 3; i >= 0; i--) {
        const start = startOfDay(addDays(base, -i * 7));
        const end = endOfDay(addDays(start, 6));
        const b = await aggBookings(start, end);
        const r = await aggRefunds(start, end);
        const p = Math.max(b.totalRevenue - b.platformCommission - r, 0);

        const idx = `${4 - i}`;
        revenueRecords.push({ value: idx, amount: b.totalRevenue });
        commissionRecords.push({ value: idx, amount: b.platformCommission });
        refundRecords.push({ value: idx, amount: r });
        payoutRecords.push({ value: idx, amount: p });
      }
    } else if (filter === "year") {
      for (let i = 11; i >= 0; i--) {
        const start = new Date(base.getFullYear(), base.getMonth() - i, 1);
        const end = new Date(
          start.getFullYear(),
          start.getMonth() + 1,
          0,
          23,
          59,
          59,
          999
        );
        const b = await aggBookings(start, end);
        const r = await aggRefunds(start, end);
        const p = Math.max(b.totalRevenue - b.platformCommission - r, 0);

        const idx = `${12 - i}`;
        revenueRecords.push({ value: idx, amount: b.totalRevenue });
        commissionRecords.push({ value: idx, amount: b.platformCommission });
        refundRecords.push({ value: idx, amount: r });
        payoutRecords.push({ value: idx, amount: p });
      }
    }

    // performance indicators
    const performanceIndicators = [
      {
        label: "totalRevenue",
        // value: Math.round(pct(currentRevenue, prevRevenue)),
        value: currentRevenue,
        change: calcTrend(currentRevenue, prevRevenue),
      },
      {
        label: "platformCommission",
        // value: Math.round(pct(currentCommission, prevCommission)),
        value: currentCommission,
        change: calcTrend(currentCommission, prevCommission),
      },
      {
        label: "ownersPayouts",
        // value: Math.round(pct(currentOwnerPayout, prevOwnerPayout)),
        value: currentOwnerPayout,
        change: calcTrend(currentOwnerPayout, prevOwnerPayout),
      },
      {
        label: "refundIssued",
        // value: Math.round(pct(currentRefund, prevRefund)),
        value: currentRefund,
        change: calcTrend(currentRefund, prevRefund),
      },
    ];

    // final response
    res.json({
      success: true,
      performanceIndicators,
      charts: {
        totalRevenue: { record: revenueRecords },
        platformCommission: { record: commissionRecords },
        ownersPayouts: { record: payoutRecords },
        refundIssued: { record: refundRecords },
      },
    });
  } catch (err) {
    next(err);
  }
};
