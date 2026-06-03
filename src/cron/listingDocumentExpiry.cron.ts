import cron from "node-cron";
import { MarketplaceListing } from "../models/marketplaceListings.model";
import { sendNotification } from "../utils/notifications";

const DAY_MS = 24 * 60 * 60 * 1000;
const SEVEN_DAYS_MS = 7 * DAY_MS;
const EVERY_DAY_AT_MIDNIGHT = "0 0 * * *";

let listingDocumentExpiryCron: ReturnType<typeof cron.schedule> | null = null;

export const processListingDocumentExpiry = async () => {
  const now = new Date();
  const sevenDaysLater = new Date(now.getTime() + SEVEN_DAYS_MS);

  console.log("[ListingDocumentExpiryCron] Started", now.toISOString());

  const listings = await MarketplaceListing.find({
    documents: { $elemMatch: { expiryDate: { $exists: true } } },
  })
    .select("name leaser documents status")
    .lean();

  console.log(`[ListingDocumentExpiryCron] Listings found: ${listings.length}`);

  for (const listing of listings) {
    let needsUpdate = false;
    const expiredDocNames: string[] = [];
    const expiringSoonDocNames: string[] = [];

    const documents = (listing.documents || []).map((document: any) => {
      const expiryDate = document.expiryDate ? new Date(document.expiryDate) : null;

      if (!expiryDate) return document;

      if (expiryDate < now && document.isExpired !== true) {
        expiredDocNames.push(document.name);
        needsUpdate = true;
        return { ...document, isExpired: true };
      }

      if (expiryDate > now && expiryDate <= sevenDaysLater && !document.reminderSent) {
        expiringSoonDocNames.push(document.name);
        needsUpdate = true;
        return { ...document, reminderSent: true };
      }

      return document;
    });

    if (!needsUpdate) continue;

    console.log(
      `[ListingDocumentExpiryCron] Updating listing ${listing._id}: expired=${expiredDocNames.join(", ") || "none"}, expiringSoon=${expiringSoonDocNames.join(", ") || "none"}`
    );

    await MarketplaceListing.updateOne(
      { _id: listing._id },
      {
        $set: {
          status: expiredDocNames.length > 0 ? "pending" : listing.status,
          documents,
        },
      }
    );

    const leaserId = listing.leaser?.toString();

    if (expiredDocNames.length > 0 && leaserId) {
      console.log(
        `[ListingDocumentExpiryCron] Sending expired notification for listing ${listing._id}`
      );

      await sendNotification(
        leaserId,
        "Listing Action Required: Document Expired",
        `Your listing "${listing.name}" is now pending because documents have expired: ${expiredDocNames.join(", ")}`,
        { listingId: listing._id.toString(), type: "listing_expired" }
      );
    }

    if (expiringSoonDocNames.length > 0 && leaserId) {
      console.log(
        `[ListingDocumentExpiryCron] Sending expiring soon notification for listing ${listing._id}`
      );

      await sendNotification(
        leaserId,
        "Urgent: Document Expiring Soon",
        `Documents for your listing "${listing.name}" will expire in 7 days: ${expiringSoonDocNames.join(", ")}. Please update them to keep your listing active.`,
        { listingId: listing._id.toString(), type: "listing_warning" }
      );
    }
  }

  console.log("[ListingDocumentExpiryCron] Finished");
};

export const startListingDocumentExpiryCron = () => {
  if (listingDocumentExpiryCron) return;

  console.log("[ListingDocumentExpiryCron] Scheduling daily job");

  processListingDocumentExpiry().catch((error) => {
    console.error("Listing document expiry cron failed:", error);
  });

  listingDocumentExpiryCron = cron.schedule(EVERY_DAY_AT_MIDNIGHT, () => {
    console.log("[ListingDocumentExpiryCron] Triggered by schedule");

    processListingDocumentExpiry().catch((error) => {
      console.error("Listing document expiry cron failed:", error);
    });
  });
};
