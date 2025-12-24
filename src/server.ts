import "dotenv/config"; 
import { server } from "./app";
import { connectDB } from "./config/db";
import { config } from "./config/env";
import { initSocket } from "./socket";

const PORT = Number(process.env.PORT || 3000);

connectDB().then(() => {
  initSocket(server);
  server.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on port ${PORT}`);
  });
});
