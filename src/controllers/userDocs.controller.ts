// import { Response, NextFunction } from "express";
// import mongoose, { Types } from "mongoose";
// import { UserDocument } from "../models/userDocs.model";
// import { UserForm } from "../models/userForm.model";
// import { sendResponse } from "../utils/response";
// import { STATUS_CODES } from "../config/constants";
// import { AuthRequest } from "../middlewares/auth.middleware";
// import { User } from "../models/user.model";
// import { IField } from "../models/field.model";

// // ✅ Helper: normalise ObjectId-like strings (trims & strips wrapping quotes)
// const normalizeId = (id: any) => {
//     if (typeof id !== "string") return id;
//     return id.trim().replace(/^"|"$/g, ""); // remove wrapping quotes if present
// };

// // ✅ Helper: safely parse documents whether JSON string or nested fields
// const parseDocuments = (body: any): any[] => {
//     if (!body) return [];
//     console.log("[parseDocuments] Starting document parsing. Request body:", body);

//     if (typeof body.documents === "string") {
//         console.log("[parseDocuments] 'documents' field is a string, attempting JSON parse.");
//         try {
//             return JSON.parse(body.documents);
//         } catch (e) {
//             console.error("[parseDocuments] Failed to parse documents JSON string:", e);
//             return [];
//         }
//     }

//     if (typeof body.documents === "object" && !Array.isArray(body.documents)) {
//         console.log("[parseDocuments] 'documents' field is an object, converting values to array.");
//         return Object.values(body.documents);
//     }

//     if (Array.isArray(body.documents)) {
//         console.log("[parseDocuments] 'documents' field is already an array.");
//         return body.documents;
//     }

//     console.log("[parseDocuments] No valid documents format found. Returning empty array.");
//     return [];
// };

// export const submitUserDocument = async (
//     req: AuthRequest,
//     res: Response,
//     next: NextFunction
// ): Promise<void> => {
//     try {
//         console.log("--- submitUserDocument start ---");
//         console.log("[Controller] Raw req.body:", req.body);
//         console.log("[Controller] Raw req.files:", req.files);
//         let { zone, subCategory } = req.body;
//         const userId = req.user?.id;

//         // ✅ Normalise top-level IDs from the request body
//         zone = normalizeId(zone);
//         subCategory = normalizeId(subCategory);

//         // ✅ Parse documents from multiple styles
//         let documents = parseDocuments(req.body);

//         // ✅ UPDATED: Consolidate file data from req.files and merge file paths
//         let uploadedFiles: Express.Multer.File[] = [];
//         if (req.files) {
//             if (Array.isArray(req.files)) {
//                 uploadedFiles = req.files;
//             } else if (typeof req.files === 'object') {
//                 for (const key in req.files) {
//                     if (Object.prototype.hasOwnProperty.call(req.files, key)) {
//                         uploadedFiles = uploadedFiles.concat(req.files[key]);
//                     }
//                 }
//             }
//         }

//         uploadedFiles.forEach((file: Express.Multer.File) => {
//             const match = file.fieldname.match(/documents\[(\d+)\]\[image\]/);
//             if (match && documents[Number(match[1])]) {
//                 const docIndex = Number(match[1]);
//                 documents[docIndex].image = `/uploads/${file.filename}`;
//                 console.log(`[Controller] Merged file path /uploads/${file.filename} from fieldname ${file.fieldname} into documents[${docIndex}]`);
//             }
//         });

//         if (!userId) {
//             console.error("[Controller] User not authenticated.");
//             sendResponse(res, null, "User not authenticated", STATUS_CODES.UNAUTHORIZED);
//             return;
//         }
//         console.log(`[Controller] User ID: ${userId}, Normalized Zone: ${zone}, Normalized subCategory: ${subCategory}`);
//         console.log("[Controller] Parsed documents:", documents);


//         if (!mongoose.Types.ObjectId.isValid(zone) || !mongoose.Types.ObjectId.isValid(subCategory)) {
//             console.error("[Controller] Invalid zone or subCategory ID.");
//             sendResponse(res, null, "Invalid zone or subCategory ID", STATUS_CODES.BAD_REQUEST);
//             return;
//         }

//         const form = await UserForm.findOne({ zone, subCategory }).populate<{ fields: IField[] }>("fields");
//         if (!form) {
//             console.error("[Controller] Form not found for the given zone and subCategory.");
//             sendResponse(res, null, "Form not found for the given zone and subCategory", STATUS_CODES.NOT_FOUND);
//             return;
//         }

//         const documentFields = form.fields.filter((f) => f.type === "document");
//         if (documentFields.length === 0) {
//             console.error("[Controller] No document fields in this form.");
//             sendResponse(res, null, "No document fields in this form", STATUS_CODES.BAD_REQUEST);
//             return;
//         }

//         if (!Array.isArray(documents) || documents.length === 0) {
//             console.error("[Controller] At least one document is required.");
//             sendResponse(res, null, "At least one document is required", STATUS_CODES.BAD_REQUEST);
//             return;
//         }

//         const user = await User.findById(userId);
//         if (!user) {
//             console.error("[Controller] User not found.");
//             sendResponse(res, null, "User not found", STATUS_CODES.NOT_FOUND);
//             return;
//         }

//         const savedDocIds: Types.ObjectId[] = [];

//         for (const submittedDoc of documents) {
//             // ✅ Normalise nested fieldId
//             const fieldId = normalizeId(submittedDoc.fieldId);
//             console.log(`[Controller] Processing submitted document with fieldId: ${fieldId}`);

//             if (!mongoose.Types.ObjectId.isValid(fieldId)) {
//                 console.error(`[Controller] Invalid field ID: ${submittedDoc.fieldId}`);
//                 sendResponse(res, null, `Invalid field ID: ${submittedDoc.fieldId}`, STATUS_CODES.BAD_REQUEST);
//                 return;
//             }

//             const field = documentFields.find((f) => String(f._id) === fieldId);
//             if (!field) {
//                 console.error(`[Controller] Invalid field ID: ${submittedDoc.fieldId}`);
//                 sendResponse(res, null, `Invalid field ID: ${submittedDoc.id}`, STATUS_CODES.BAD_REQUEST);
//                 return;
//             }

//             if (!field.documentConfig || !Array.isArray(field.documentConfig)) {
//                 console.error("[Controller] Document field has no valid configuration.");
//                 sendResponse(res, null, "Document field has no valid configuration", STATUS_CODES.BAD_REQUEST);
//                 return;
//             }

//             const validNames = field.documentConfig.map((d) => d.name);
//             if (!validNames.includes(submittedDoc.name)) {
//                 console.error(`[Controller] Invalid document name: ${submittedDoc.name}`);
//                 sendResponse(res, null, `Invalid document name: ${submittedDoc.name}`, STATUS_CODES.BAD_REQUEST);
//                 return;
//             }

//             const config = field.documentConfig.find((c) => c.name === submittedDoc.name);
//             if (config?.requiresExpiry && !submittedDoc.expiryDate) {
//                 console.error(`[Controller] ${submittedDoc.name} requires an expiryDate.`);
//                 sendResponse(res, null, `${submittedDoc.name} requires an expiryDate`, STATUS_CODES.BAD_REQUEST);
//                 return;
//             }
//             if (config?.requiresImage && !submittedDoc.image) {
//                 console.error(`[Controller] ${submittedDoc.name} requires an image.`);
//                 sendResponse(res, null, `${submittedDoc.name} requires an image`, STATUS_CODES.BAD_REQUEST);
//                 return;
//             }

//             let userDoc = await UserDocument.findOne({ user: userId, field: field._id });

//             if (userDoc) {
//                 const valueExists = userDoc.values.find((val) => val.name === submittedDoc.name);
//                 if (valueExists) {
//                     valueExists.expiryDate = submittedDoc.expiryDate;
//                     valueExists.image = submittedDoc.image;
//                     valueExists.status = "pending";
//                 } else {
//                     userDoc.values.push({
//                         name: submittedDoc.name,
//                         expiryDate: submittedDoc.expiryDate,
//                         image: submittedDoc.image,
//                         status: "pending",
//                     });
//                 }
//                 await userDoc.save();
//                 console.log("[Controller] Updated existing UserDocument.");
//             } else {
//                 userDoc = new UserDocument({
//                     user: userId,
//                     field: field._id,
//                     values: [
//                         {
//                             name: submittedDoc.name,
//                             expiryDate: submittedDoc.expiryDate,
//                             image: submittedDoc.image,
//                             status: "pending",
//                         },
//                     ],
//                 });
//                 await userDoc.save();
//                 console.log("[Controller] Created new UserDocument.");
//             }

//             savedDocIds.push(userDoc._id as Types.ObjectId);
//         }

//         // ✅ Deduplicate document IDs on user
//         user.documents = Array.from(new Set([...(user.documents as Types.ObjectId[]), ...savedDocIds]));
//         await user.save();
//         console.log("[Controller] User's documents array updated.");

//         // ✅ Fetch lean user
//         const leanUser = await User.findById(userId).lean();
//         if (!leanUser) {
//             console.error("[Controller] User not found after save.");
//             sendResponse(res, null, "User not found", STATUS_CODES.NOT_FOUND);
//             return;
//         }

//         // ✅ Build formatted response
//         const userDocs = await UserDocument.find({ user: userId }).lean();
//         const responseDocuments: any[] = [];
//         for (const doc of userDocs) {
//             for (const value of doc.values) {
//                 responseDocuments.push({ ...value });
//             }
//         }

//         leanUser.documents = responseDocuments;

//         sendResponse(res, leanUser, "Documents submitted successfully", STATUS_CODES.CREATED);
//         console.log("--- Request completed successfully. ---");
//     } catch (error) {
//         console.error("--- An unhandled error occurred ---", error);
//         next(error);
//     }
// };

