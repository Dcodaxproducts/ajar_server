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
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  password: string;
  confirmPassword: string;
  role: string; // This can be used for a primary role if needed
  staffRoles: mongoose.Types.ObjectId[]; // Referencing Role collection
  permissions: IAccessPermission[];      // Structured access/operations
  images: string[];
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
    firstName: { type: String, required: true, trim: true },
    lastName: { type: String, required: true, trim: true },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    phone: { type: String, required: true, trim: true },

    password: { type: String, required: true },
    confirmPassword: { type: String, required: true }, 
    role: { type: String, default: "staff", trim: true },
    staffRoles: [{ type: Schema.Types.ObjectId, ref: "Role" }],
    permissions: [AccessPermissionSchema],

    images: [{ type: String, trim: true }], 
    address: { type: String, trim: true },

    language: { type: String, default: "en" },
    languages: [
      {
        locale: { type: String, required: true },
        translations: { type: Schema.Types.Mixed },
      },
    ],

    zones: [{ type: Schema.Types.ObjectId, ref: "Zone" }],
    categories: [{ type: Schema.Types.ObjectId, ref: "Category" }],
  },
  { timestamps: true }
);

// Indexes
// EmployeeSchema.index({ email: 1 });

const Employee = mongoose.model<IEmployee>("Employee", EmployeeSchema);

export { Employee, IEmployee };
