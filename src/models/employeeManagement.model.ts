import mongoose, { Schema, Document } from "mongoose";

interface ILanguageTranslation {
  locale: string;
  translations: Record<string, any>;
}

interface IAccessPermission {
  access: string;
  operations: string[];
}

interface IEmployee extends Document {
  name: string;
  email: string;
  phone: string;
  password: string;
  confirmPassword: string;
  status: "active" | "inactive" | "blocked";
  role: string; // This can be used for a primary role if needed
  allowAccess: mongoose.Types.ObjectId;
  images: string[];
  profileImage: string;
  address: string;
  language: string;
  languages?: ILanguageTranslation[];
  zones: mongoose.Types.ObjectId[];
  categories: mongoose.Types.ObjectId[];
  createdAt: Date;
  updatedAt: Date;
}

const AccessPermissionSchema = new Schema<IAccessPermission>(
  {
    access: { type: String, required: true },
    operations: {
      type: [String],
      enum: ["create", "read", "update", "delete"],
      required: true,
    },
  },
  { _id: false }
);

const EmployeeSchema = new Schema<IEmployee>(
  {
    name: { type: String, required: true, trim: true },
    // lastName: { type: String, required: true, trim: true },
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
    },
    phone: { type: String, required: true, trim: true },

    password: { type: String, required: true },
    status: {
      type: String,
      enum: ["active", "inactive", "blocked"],
      default: "active",
    },
    role: { type: String, default: "staff", trim: true },
    allowAccess: { type: Schema.Types.ObjectId, ref: "Role" },

    images: [{ type: String, trim: true }],
    profileImage: { type: String, trim: true },
    address: { type: String, trim: true },

    language: { type: String, default: "en" },
    languages: [
      {
        locale: { type: String, required: true },
        translations: { type: Schema.Types.Mixed },
      },
    ],
  },
  { timestamps: true }
);

// Indexes
// EmployeeSchema.index({ email: 1 });

const Employee = mongoose.model<IEmployee>("Employee", EmployeeSchema);

export { Employee, IEmployee };
