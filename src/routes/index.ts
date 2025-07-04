import express from "express";
import userRoutes from "./user.routes";
import chatRoutes from "./chat.routes";
import zoneRoutes from "./zone.routes";
import categoryRoutes from "./category.routes";
import formRoutes from "./forms.routes";
import marketplacelistingRoutes from "./marketplaceListings.routes";
import routAService from "./rentAService.routes";
import fieldRoutes from "./field.routes";
import dropdownRoutes from "./dropdown.routes";
import paymentRoutes from "./payment.routes";

const router = express.Router();

router.use("/users", userRoutes);
router.use("/chats", chatRoutes);
router.use("/payments", paymentRoutes);
router.use("/zones", zoneRoutes);
router.use("/categories", categoryRoutes);
router.use("/forms", formRoutes);
router.use("/marketplace-listings", marketplacelistingRoutes);
router.use("/rent-service", routAService);
router.use("/fields", fieldRoutes);
router.use("/dropdowns", dropdownRoutes);

export default router;
