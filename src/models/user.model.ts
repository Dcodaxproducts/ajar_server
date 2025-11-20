import mongoose, { Schema, Document } from "mongoose";



export interface IUserDocument {
  name: string;         // e.g. "cnic", "driving_license"
  filesUrl: string[];   // uploaded file links (S3/Firebase)
  expiryDate?: Date;    // optional
  status?: "pending" | "approved" | "rejected";
  reason?: string;      // reason for rejection if any
}

export interface IUser extends Document {
  name: string;
  email: string;
  password: string;
  role: "user" | "admin";
  dob: Date;
  nationality: string;
  profilePicture: string;
  phone: string;
  stripe: {
    customerId: string;
    subscriptionId: string;
    connectedAccountId: string;
    connectedAccountLink: string;
  };
  otp: {
    isVerified: boolean;
    code: string;
    expiry: Date;
  };


   twoFactor: {
    enabled: boolean;
    secret?: string;
    tempSecret?: string;
    tempOTP?: {
      code: string | null;
      expiresAt: Date;
    } | null;
    backupCodes?: { codeHash: string }[];
      loginCode?: string | null;
  loginExpiry?: Date | null;
  };

  twoFactorVerified: boolean;


  status: "active" | "inactive" | "blocked" | "unblocked";
  documents: IUserDocument[];
  fcmToken?: string;

  // Wallet (added)
  wallet: {
    balance: number;
  };
}

const UserDocumentSchema = new Schema<IUserDocument>({
  name: { type: String, required: true },
  filesUrl: [{ type: String, required: true }],
  expiryDate: { type: Date },
  status: { type: String, enum: ["pending", "approved", "rejected"], default: "pending" },
  reason: { type: String },
});

const UserSchema: Schema<IUser> = new Schema(
  {
    name: { type: String, trim: true },
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      index: true,
    },
    otp: {
      isVerified: { type: Boolean, default: false },
      code: { type: String, default: "" },
      expiry: { type: Date, default: null },
    },

    stripe: {
      customerId: { type: String },
      subscriptionId: { type: String },
      connectedAccountId: { type: String, default: "" },
      connectedAccountLink: { type: String, default: "" },
    },
    password: { type: String, required: true },
    role: {
      type: String,
      enum: ["user", "admin"],
      default: "user",
    },
    dob: { type: Date },
    nationality: { type: String },
    profilePicture: { type: String, default: "" },
    phone: { type: String, default: "" },
    status: {
      type: String,
      enum: ["active", "inactive", "blocked", "unblocked"],
      default: "active",
    },
    documents: [UserDocumentSchema],
    fcmToken: { type: String, default: "" },

    // ADD WALLET (Only balance — NO transactions inside)
    wallet: {
      balance: { type: Number, default: 0 },
    },


     twoFactor: {
      enabled: { type: Boolean, default: false },
      secret: { type: String, default: "" },
      tempSecret: { type: String, default: "" },

      tempOTP: {
        code: { type: String, default: "" },
        expiresAt: { type: Date, default: null },
      },

      backupCodes: [
        {
          codeHash: { type: String },
        },
      ],

        // Login-specific 2FA fields
  loginCode: { type: String, default: "" },
  loginExpiry: { type: Date, default: null },
    },


    twoFactorVerified: { type: Boolean, default: false },
  


  },
  { timestamps: true }
);

export const User = mongoose.model<IUser>("User", UserSchema);
