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

      if (checkOut.getDate() < checkIn.getDate()) {
        duration -= 1;
      } else if (checkOut.getDate() > checkIn.getDate()) {
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

      const cleanCheckOut = new Date(checkOut);
      cleanCheckOut.setHours(0, 0, 0, 0);

      const cleanAnniversary = new Date(anniversaryDate);
      cleanAnniversary.setHours(0, 0, 0, 0);

      if (cleanCheckOut.getTime() > cleanAnniversary.getTime()) {
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
