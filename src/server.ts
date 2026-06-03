import "dotenv/config"; 
import { server } from "./app";
import { connectDB } from "./config/db";
import { config } from "./config/env";
import { startListingDocumentExpiryCron } from "./cron/listingDocumentExpiry.cron";
import { startUserDocumentExpiryCron } from "./cron/userDocumentExpiry.cron";
import { initSocket } from "./socket";

const PORT = config.PORT || 5001;

connectDB().then(() => {
  startListingDocumentExpiryCron();
  startUserDocumentExpiryCron();
  initSocket(server);
  server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
  });
});


