// import { Router, Request, Response, NextFunction } from "express";
// import {
//     approveDocumentStatus,
//     submitUserDocument,
// } from "../controllers/userDocs.controller";
// import expressAsyncHandler from "express-async-handler";
// import { authMiddleware } from "../middlewares/auth.middleware";
// import upload from "../utils/multer"; // Import the configured multer instance

// const router = Router();

// // Remove the custom handleMulter middleware.
// // We will use the configured upload instance directly.

// router.post(
//     "/",
//     authMiddleware,
//     upload.any(), // This will now correctly process form-data and populate req.files
//     expressAsyncHandler(submitUserDocument)
// );

// router.patch("/", authMiddleware, expressAsyncHandler(approveDocumentStatus));

// export default router;

