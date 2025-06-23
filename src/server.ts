import app from "./app";
import { connectDB } from "./config/db";
import { config } from "./config/env";

const PORT = config.PORT || 5001;

connectDB().then(() => {
  app.listen(PORT, () => {
    console.log(`🚀 Server running on port ${PORT}`);
  });
});
