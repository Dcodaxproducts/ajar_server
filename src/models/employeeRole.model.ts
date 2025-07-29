import mongoose from "mongoose";

const permissionSchema = new mongoose.Schema({
  access: {
    type: String,
    required: true,
  },
  operations: {
    type: [String],
    enum: ["create", "read", "update", "delete"],
  },
});

const roleSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
    },
    permissions: [permissionSchema],
  },
  { timestamps: true }
);

export default mongoose.model("Role", roleSchema);
