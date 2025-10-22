import mongoose, { Schema, Document, model } from "mongoose";

interface IPriceDetails {
  price: number;
  adminFee: number;
  tax: number;
  totalPrice: number;
}

interface IExtraRequestCharges {
  additionalCharges: number;
  totalPrice: number;
}

interface IExtendCharges {
  extendCharges: number;
  totalPrice: number;
}

interface IDamagesCharges {
  damagedCharges: number;
  totalPrice: number;
}

export interface IBooking extends Document {
  status: "pending" | "approved" | "rejected" | "completed" | "cancelled";
  renter: mongoose.Types.ObjectId;
  leaser?: mongoose.Types.ObjectId;
  marketplaceListingId: mongoose.Types.ObjectId;
  dates: {
    checkIn: Date;
    checkOut: Date;
  };
  language?: string;
  otp?: string;
  isVerified?: boolean;
  priceDetails: IPriceDetails;
  extraRequestCharges?: IExtraRequestCharges;
  specialRequest?: string;
  extendCharges?: IExtendCharges;
  damagesCharges?: IDamagesCharges;
  isExtend?: boolean;
  extensionRequestedDate?: Date;
  bookingDates?: {
    handover?: Date;
    returnDate?: Date;
  };
  previousBookingId?: mongoose.Types.ObjectId;
  
}

const BookingSchema = new Schema<IBooking>(
  {
    status: {
      type: String,
      enum: ["pending", "approved", "rejected", "completed", "cancelled"],
      default: "pending",
    },
    renter: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    leaser: {
      type: Schema.Types.ObjectId,
      ref: "User",
    },
    marketplaceListingId: {
      type: Schema.Types.ObjectId,
      ref: "MarketplaceListing",
      required: true,
    },
    dates: {
      checkIn: { type: Date, required: true },
      checkOut: { type: Date, required: true },
    },
    language: { type: String, default: "en" },
    otp: { type: String, default: "" },
    isVerified: { type: Boolean, default: false },

    priceDetails: {
      price: { type: Number, required: true },
      adminFee: { type: Number, required: true },
      tax: { type: Number, required: true },
      totalPrice: { type: Number, required: true },
    },

    extraRequestCharges: {
      additionalCharges: { type: Number },
      totalPrice: { type: Number },
    },

    extendCharges: {
      extendCharges: { type: Number },
      totalPrice: { type: Number },
    },

    damagesCharges: {
      damagedCharges: { type: Number },
      totalPrice: { type: Number },
    },

    specialRequest: { type: String },
    isExtend: { type: Boolean, default: false },
    extensionRequestedDate: { type: Date },

    bookingDates: {
      handover: { type: Date },
      returnDate: { type: Date },
    },

    previousBookingId: {
      type: Schema.Types.ObjectId,
      ref: "Booking",
    },

     

  },
  { timestamps: true }
);

export const Booking = model<IBooking>("Booking", BookingSchema);
