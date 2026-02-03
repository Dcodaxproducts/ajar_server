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
  // Step 1: rough month difference
  duration =
    (checkOut.getFullYear() - checkIn.getFullYear()) * 12 +
    (checkOut.getMonth() - checkIn.getMonth());

  // Step 2: handle days
  if (checkOut.getDate() < checkIn.getDate()) {
    // Last month not complete → subtract 1
    duration -= 1;
  } else if (checkOut.getDate() > checkIn.getDate()) {
    // Extra days after a full month → count as an extra month
    duration += 1;
  }

  // Step 3: minimum 1 month
  duration = Math.max(duration, 1);

  calculatedBasePrice = duration * basePrice;
  break;
}



    case "year": {
      duration = checkOut.getFullYear() - checkIn.getFullYear();

      // Check if full year has completed
      if (
        checkOut.getMonth() < checkIn.getMonth() ||
        (checkOut.getMonth() === checkIn.getMonth() &&
          checkOut.getDate() < checkIn.getDate())
      ) {
        duration -= 1;
      }

      // Minimum 1 year
      duration = Math.max(duration, 1);

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
