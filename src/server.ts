import { server } from "./app";
import { connectDB } from "./config/db";
import { config } from "./config/env";
import { initSocket } from "./socket";

const PORT = config.PORT || 5001;

connectDB().then(() => {
  initSocket(server);
  server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
  });
});
