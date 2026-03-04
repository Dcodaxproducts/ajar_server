import { Model } from "mongoose";

// ─── Types ────────────────────────────────────────────────────────────────────

export type RangeType = "week" | "month" | "year";

export interface DateRange {
  startDate: Date;
  endDate: Date;
}

export interface Period {
  start: Date;
  end: Date;
  label: string;
}

export interface GraphItem {
  _id: {
    year: number;
    month?: number;
    day?: number;
    isoWeek?: number;
  };
  totalWithdraw: number;
  totalTopup: number;
}

export interface ChartRecord {
  value: string;
  totalUsers: number;
  totalEarning: number;
}

export interface TrendResult {
  value: string;
  trend: "up" | "down";
}

export interface ChartData {
  records: ChartRecord[];
  userTrend: TrendResult;
  earningTrend: TrendResult;
}

// ─── Period Builders ───────────────────────────

export const buildWeekPeriods = (now: Date): Period[] =>
  // 7 individual days: 6 days ago → today
  Array.from({ length: 7 }, (_, i) => {
    const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - 6 + i, 0, 0, 0, 0));
    const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - 6 + i, 23, 59, 59, 999));
    return { start, end, label: start.toISOString().split("T")[0] };
  });

export const buildMonthPeriods = (now: Date): Period[] => {
  return Array.from({ length: 4 }, (_, i) => {
    // Week 0: 21-27 days ago
    // Week 3: 0-6 days ago (Today)
    const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - 27 + i * 7, 0, 0, 0, 0));
    const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - 27 + i * 7 + 6, 23, 59, 59, 999));
    return { start, end, label: start.toISOString().split("T")[0] };
  });
};

export const buildYearPeriods = (now: Date): Period[] =>
  // 12 calendar months: 1st of each month → last day of that month
  Array.from({ length: 12 }, (_, i) => {
    const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 11 + i, 1, 0, 0, 0, 0));
    const end = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 0, 23, 59, 59, 999));
    return { start, end, label: start.toISOString().substring(0, 7) };
  });

export const getPeriods = (range: RangeType, now: Date): Period[] => {
  switch (range) {
    case "week": return buildWeekPeriods(now);
    case "month": return buildMonthPeriods(now);
    case "year": return buildYearPeriods(now);
  }
};

// ─── Date Range ───────────────────────────────────────────────────────────────
// Derived from period builders — wallet $match uses exact same UTC boundaries.

export const getDateRange = (range: RangeType): DateRange => {
  const periods = getPeriods(range, new Date());
  return {
    startDate: periods[0].start,
    endDate: periods[periods.length - 1].end,
  };
};

// ─── Aggregation Stages ───────────────────────────────────────────────────────

export const getGroupStage = (range: RangeType) => {
  switch (range) {
    case "week":
    case "month": // Group by day for both so fillMissingPeriods can sum them into weeks
      return {
        _id: {
          year: { $year: "$createdAt" },
          month: { $month: "$createdAt" },
          day: { $dayOfMonth: "$createdAt" },
        },
      };
    case "year":
      return {
        _id: {
          year: { $year: "$createdAt" },
          month: { $month: "$createdAt" },
        },
      };
  }
};

export const getSortStage = (range: RangeType): Record<string, 1> => {
  switch (range) {
    case "week": return { "_id.year": 1, "_id.month": 1, "_id.day": 1 };
    case "month": return { "_id.year": 1, "_id.isoWeek": 1 };
    case "year": return { "_id.year": 1, "_id.month": 1 };
  }
};

// ─── Graph Label ──────────────────────────────────────────────────────────────

export const formatGraphLabel = (period: Period): string => {
  return period.label;
}

export const fillMissingPeriods = (
  periods: Period[],
  aggregated: any[],
  range: RangeType
): { label: string; withdraw: number; topup: number }[] => {
  return periods.map((period) => {
    // Filter all daily records that fall within this period's date range
    const matches = aggregated.filter((item) => {
      const itemDate = new Date(
        Date.UTC(item._id.year, item._id.month - 1, item._id.day || 1)
      );
      return itemDate >= period.start && itemDate <= period.end;
    });

    // Accumulate the totals for those matches
    return {
      label: period.label,
      withdraw: matches.reduce((acc, curr) => acc + (curr.totalWithdraw || 0), 0),
      topup: matches.reduce((acc, curr) => acc + (curr.totalTopup || 0), 0),
    };
  });
};

// ─── ISO Week Helpers ─────────────────────────────────────────────────────────

const getISOWeek = (date: Date): number => {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
};

const getISOWeekYear = (date: Date): number => {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
  return d.getUTCFullYear();
};

const periodLabelToId = (period: Period, range: RangeType): GraphItem["_id"] => {
  const d = period.start;
  switch (range) {
    case "week": return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() };
    case "month": return { year: getISOWeekYear(d), isoWeek: getISOWeek(d) };
    case "year": return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1 };
  }
};

// ─── Shared Helpers ───────────────────────────────────────────────────────────

export const calcTrend = (current: number, previous: number): TrendResult => {
  const diff = current - previous;
  const trend = diff >= 0 ? "up" : "down";
  const percentage =
    previous === 0
      ? current > 0 ? 100 : 0
      : Math.abs(Math.round((diff / previous) * 100));
  return { value: `${percentage}`, trend };
};

export const calcEarning = (bookings: any[]): number =>
  bookings.reduce(
    (acc, b) =>
      acc +
      (b.priceDetails?.totalPrice || 0) +
      (b.extraRequestCharges?.additionalCharges || 0),
    0
  );

// ─── Dashboard Chart Builder ──────────────────────────────────────────────────

export const buildDashboardChartData = async (
  range: RangeType,
  now: Date,
  UserModel: Model<any>,
  BookingModel: Model<any>
): Promise<ChartData> => {
  const periods = getPeriods(range, now);

  const periodData = await Promise.all(
    periods.map(({ start, end }) =>
      Promise.all([
        UserModel.countDocuments({ createdAt: { $gte: start, $lte: end } }),
        BookingModel.find({ status: "completed", createdAt: { $gte: start, $lte: end } }).lean(),
      ])
    )
  );

  const records: ChartRecord[] = periodData.map(([users, bookings], i) => ({
    value: periods[i].label,
    totalUsers: users,
    totalEarning: calcEarning(bookings as any[]),
  }));

  let userTrend: TrendResult;
  let earningTrend: TrendResult;

  if (range === "year") {
    const prevYearStart = new Date(Date.UTC(now.getUTCFullYear() - 1, 0, 1));
    const prevYearEnd = new Date(Date.UTC(now.getUTCFullYear() - 1, 11, 31, 23, 59, 59, 999));

    const [prevUsers, prevBookings] = await Promise.all([
      UserModel.countDocuments({ createdAt: { $gte: prevYearStart, $lte: prevYearEnd } }),
      BookingModel.find({ status: "completed", createdAt: { $gte: prevYearStart, $lte: prevYearEnd } }).lean(),
    ]);

    userTrend = calcTrend(records.reduce((a, c) => a + c.totalUsers, 0), prevUsers);
    earningTrend = calcTrend(records.reduce((a, c) => a + c.totalEarning, 0), calcEarning(prevBookings as any[]));
  } else {
    const last = records[records.length - 1];
    const prev = records[records.length - 2];
    userTrend = records.length >= 2 ? calcTrend(last.totalUsers, prev.totalUsers) : { value: "0", trend: "up" };
    earningTrend = records.length >= 2 ? calcTrend(last.totalEarning, prev.totalEarning) : { value: "0", trend: "up" };
  }

  return { records, userTrend, earningTrend };
};