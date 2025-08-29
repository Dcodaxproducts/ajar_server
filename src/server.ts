import { server } from "./app";
import { connectDB } from "./config/db";
import { config } from "./config/env";
import { initSocket } from "./utils/socket";

const PORT = config.PORT || 5001;

connectDB().then(() => {
  initSocket(server); // 🔑 initialize io once server is ready
  server.listen(PORT, () => {
    console.log(`🚀 Server running on port ${PORT}`);
  });
});

// import { server } from "./app";
// import { connectDB } from "./config/db";
// import { config } from "./config/env";

// const PORT = config.PORT || 5001;

// connectDB().then(() => {
//   server.listen(PORT, () => {
//     console.log(`🚀 Server running on port ${PORT}`);
//   });
// });
