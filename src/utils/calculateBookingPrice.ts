export type PriceUnit = "hour" | "day" | "month" | "year";

const DAY_MS = 1000 * 60 * 60 * 24;
const HOUR_MS = 1000 * 60 * 60;

const toDateKey = (date: Date) => date.toISOString().split("T")[0];
const toLocalDateKey = (date: Date) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};

// ✅ NEW: dynamic pricing type
interface DynamicPricing {
  startDate: string;
  endDate: string;
  price: number;
}

interface PriceCalculationInput {
  basePrice: number;
  unit: PriceUnit;
  checkIn: Date;
  checkOut: Date;
  adminCommissionRate: number;
  taxRate: number;
  dynamicPricing?: DynamicPricing; // ✅ NEW: optional
}

// ✅ NEW: check if a date falls in dynamic range
const getDynamicPriceForDate = (
  date: Date,
  dynamicPricing?: DynamicPricing,
  useLocalDate = false,
): number | null => {
  if (!dynamicPricing?.startDate || !dynamicPricing?.endDate) return null;
  const dateKey = useLocalDate ? toLocalDateKey(date) : toDateKey(date);
  const startKey = dynamicPricing.startDate.slice(0, 10);
  const endKey = dynamicPricing.endDate.slice(0, 10);
  if (dateKey >= startKey && dateKey <= endKey) return Number(dynamicPricing.price);
  return null;
};

// ✅ NEW: returns dynamic price if in range, else base price
const getPriceForDate = (
  date: Date,
  basePrice: number,
  dynamicPricing?: DynamicPricing,
  useLocalDate = false,
): number => {
  const dynamic = getDynamicPriceForDate(date, dynamicPricing, useLocalDate);
  return dynamic !== null && Number.isFinite(dynamic) ? dynamic : basePrice;
};

export const calculateBookingPrice = ({
  basePrice,
  unit,
  checkIn,
  checkOut,
  adminCommissionRate,
  taxRate,
  dynamicPricing, // ✅ NEW
}: PriceCalculationInput) => {
  let duration = 0;
  let calculatedBasePrice = 0;

  switch (unit) {
    case "hour": {
      duration = Math.ceil((checkOut.getTime() - checkIn.getTime()) / HOUR_MS);
      // ✅ loop per hour — apply dynamic pricing per hour
      const current = new Date(checkIn);
      for (let i = 0; i < duration; i++) {
        calculatedBasePrice += getPriceForDate(current, basePrice, dynamicPricing, true);
        current.setTime(current.getTime() + HOUR_MS);
      }
      break;
    }

    case "day": {
      duration = Math.ceil((checkOut.getTime() - checkIn.getTime()) / DAY_MS);
      // ✅ loop per day — apply dynamic pricing per day
      const current = new Date(checkIn);
      for (let i = 0; i < duration; i++) {
        calculatedBasePrice += getPriceForDate(current, basePrice, dynamicPricing);
        current.setUTCDate(current.getUTCDate() + 1);
      }
      break;
    }

    case "month": {
      duration =
        (checkOut.getFullYear() - checkIn.getFullYear()) * 12 +
        (checkOut.getMonth() - checkIn.getMonth());

      const inDay = checkIn.getUTCDate();
      const outDay = checkOut.getUTCDate();

      if (outDay < inDay) duration -= 1;
      else if (outDay > inDay) duration += 1;
      duration = Math.max(duration, 1);

      // ✅ loop per month — apply dynamic pricing per month
      const current = new Date(checkIn);
      for (let i = 0; i < duration; i++) {
        calculatedBasePrice += getPriceForDate(current, basePrice, dynamicPricing);
        current.setUTCMonth(current.getUTCMonth() + 1);
      }
      break;
    }

    case "year": {
      let years = checkOut.getFullYear() - checkIn.getFullYear();

      const anniversaryDate = new Date(checkIn);
      anniversaryDate.setFullYear(checkIn.getFullYear() + years);

      const outMonth = checkOut.getUTCMonth();
      const outDay = checkOut.getUTCDate();
      const annMonth = anniversaryDate.getUTCMonth();
      const annDay = anniversaryDate.getUTCDate();

      if (outMonth > annMonth || (outMonth === annMonth && outDay > annDay)) years += 1;
      duration = Math.max(years, 1);

      // ✅ loop per year — apply dynamic pricing per year
      const current = new Date(checkIn);
      for (let i = 0; i < duration; i++) {
        calculatedBasePrice += getPriceForDate(current, basePrice, dynamicPricing);
        current.setUTCFullYear(current.getUTCFullYear() + 1);
      }
      break;
    }

    default:
      throw new Error("Invalid price unit");
  }

  // ✅ UNCHANGED — adminFee/tax/total logic identical to before
  const adminFee = basePrice * adminCommissionRate;
  const tax = (basePrice + adminFee) * taxRate;
  const totalPrice = calculatedBasePrice + adminFee + tax;

  return { unit, duration, basePrice: calculatedBasePrice, adminFee, tax, totalPrice };
};
