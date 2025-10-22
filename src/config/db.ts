import mongoose from "mongoose";
import { config } from "./env";

export const connectDB = async () => {
  try {
    const connection = await mongoose.connect(config.MONGO_URI!);
    console.log(
      "MongoDB Connected to ...",
      connection.connection.host,
      connection.connection.port,
      connection.connection.name
    );
  } catch (error) {
    console.error("MongoDB Connection Error:", error);
    process.exit(1);
  }
};
