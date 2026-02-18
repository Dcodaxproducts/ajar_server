import { differenceInHours, differenceInDays } from "date-fns";

export type PriceUnit = "hour" | "day" | "month" | "year";

interface PriceCalculationInput {
  basePrice: number;
  unit: PriceUnit;
  checkIn: Date;
  checkOut: Date;
  adminCommissionRate: number;
  taxRate: number;
}

export const calculateBookingPrice = ({
  basePrice,
  unit,
  checkIn,
  checkOut,
  adminCommissionRate,
  taxRate,
}: PriceCalculationInput) => {
  let duration = 0;
  let calculatedBasePrice = 0;

  switch (unit) {
    case "hour":
      duration = Math.ceil(
        (checkOut.getTime() - checkIn.getTime()) / (1000 * 60 * 60)
      );
      calculatedBasePrice = duration * basePrice;
      break;

    case "day":
      duration = Math.ceil(
        (checkOut.getTime() - checkIn.getTime()) / (1000 * 60 * 60 * 24)
      );
      calculatedBasePrice = duration * basePrice;
      break;

    case "month": {
      duration =
        (checkOut.getFullYear() - checkIn.getFullYear()) * 12 +
        (checkOut.getMonth() - checkIn.getMonth());

      const inDay = checkIn.getUTCDate();
      const outDay = checkOut.getUTCDate();

      if (outDay < inDay) {
        duration -= 1;
      } else if (outDay > inDay) {
        duration += 1;
      }

      duration = Math.max(duration, 1);
      calculatedBasePrice = duration * basePrice;
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

      if (outMonth > annMonth || (outMonth === annMonth && outDay > annDay)) {
        years += 1;
      }

      duration = Math.max(years, 1);
      calculatedBasePrice = duration * basePrice;
      break;
    }

    default:
      throw new Error("Invalid price unit");
  }

  const adminFee = basePrice * adminCommissionRate;
  const tax = (basePrice + adminFee) * taxRate;
  const totalPrice = calculatedBasePrice + adminFee + tax;

  return {
    unit,
    duration,
    basePrice: calculatedBasePrice,
    adminFee,
    tax,
    totalPrice,
  };
};
