import mongoose, { Schema, Document, model } from "mongoose";

export interface IFavouriteCheck extends Document {
  user: mongoose.Types.ObjectId; 
  listing?: mongoose.Types.ObjectId;
  booking?: mongoose.Types.ObjectId; 
  createdAt: Date;
  updatedAt: Date;
}

const FavouriteCheckSchema: Schema = new Schema(
  {
    user: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    listing: {
      type: Schema.Types.ObjectId,
      ref: "MarketplaceListing",
    },
    booking: {
      type: Schema.Types.ObjectId,
      ref: "Booking",
    },
  },
  { 
    timestamps: true,
    
    validate: {
      validator: function(this: IFavouriteCheck) {
        return (this.listing && !this.booking) || (!this.listing && this.booking);
      },
      message: "Must provide either a listing or booking reference, but not both"
    }
  }
);

// Add compound index to prevent duplicate favorites
FavouriteCheckSchema.index(
  { user: 1, listing: 1 }, 
  { unique: true, partialFilterExpression: { listing: { $exists: true } } }
);

FavouriteCheckSchema.index(
  { user: 1, booking: 1 }, 
  { unique: true, partialFilterExpression: { booking: { $exists: true } } }
);

export const FavouriteCheck = model<IFavouriteCheck>("FavouriteCheck", FavouriteCheckSchema);