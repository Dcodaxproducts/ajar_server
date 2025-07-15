import mongoose, { Schema, Document, model } from "mongoose";

interface IPriceDetails {
  price: number;
  adminFee: number;
  totalPrice: number;
}

interface IExtensionCharges {
  adminFee: number;
  additionalCharges: number;
  totalPrice: number;
}

interface ILanguageTranslation {
  locale: string;
  translations: Record<string, any>; //Flexible translations
}


export interface IBooking extends Document {
    status: "pending" | "accepted" | "rejected" | "completed"; 

            userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    required: true,
    },
    marketplaceListingId: mongoose.Types.ObjectId;
        dates: {
            checkIn: Date;
            checkOut: Date;
                };
    noOfGuests: number;
    roomType: string;
    phone: string;
    priceDetails: IPriceDetails;
    extensionCharges?: IExtensionCharges;
    language?: string;
    languages?: ILanguageTranslation[];
     otp?: string;
}

const BookingSchema = new Schema<IBooking>(
  {
     status: {
      type: String,
      enum: ["pending", "accepted", "rejected", "completed"],
      default: "pending",
    },

    userId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
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
    noOfGuests: { type: Number, required: true },
    roomType: { type: String, required: true },
    phone: { type: String, required: true },
    priceDetails: {
      price: { type: Number, required: true },
      adminFee: { type: Number, required: true },
      totalPrice: { type: Number, required: true },
    },
    extensionCharges: {
      adminFee: { type: Number },
      additionalCharges: { type: Number },
      totalPrice: { type: Number },
    },
    language: { type: String, default: "en" },
     languages: [
      {
        locale: { type: String, required: true },
        translations: { type: Schema.Types.Mixed }, //Dynamic
      },
    ],
       otp: {
      type: String,
      default: "",
    },
  },
  { timestamps: true }
);

export const Booking = model<IBooking>("Booking", BookingSchema);
