import { Response, NextFunction, Request } from "express";
import mongoose from "mongoose";
import { Form } from "../models/form.model";

export interface AuthenticatedRequest extends Request {
  user?: any;
}

export const validateDocuments =
  (context: "user" | "listing") =>
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      console.log("👉 validateDocuments start");

      let { zone, subCategory, documents } = req.body;
      console.log("🟡 Zone from body:", zone);
      console.log("🟡 SubCategory from body:", subCategory);
      console.log("🔹 Full req.body:", JSON.stringify(req.body, null, 2));

      if (!zone || !subCategory) {
         res.status(400).json({
          success: false,
          message: "zone and subCategory are required",
        });
        return;
      }

      const form = await Form.findOne({
        zone: new mongoose.Types.ObjectId(zone),
        subCategory: new mongoose.Types.ObjectId(subCategory),
        context,
      }).populate("fields");

      console.log("📄 Found form:", form ? form._id : "None");

      if (!form) {
         res.status(400).json({
          success: false,
          message: `Form not found for zone/subCategory with context=${context}`,
        });
        return;
      }

      const requiredDocs = form.fields
        .filter((f: any) => f.type === "document")
        .map((f: any) => f.name);

      console.log("📌 Required document fields:", requiredDocs);

      if (context === "listing") {
        // Parse documents if sent as JSON string
        if (typeof documents === "string") {
          try {
            documents = JSON.parse(documents);
            req.body.documents = documents;
          } catch (e) {
            documents = [];
            req.body.documents = [];
          }
        }

        if (!Array.isArray(documents)) {
          documents = [];
          req.body.documents = [];
        }

        console.log("🔹 Documents sent in request body:", documents);

        const uploadedDocs = documents.map((doc: { name: string }) => doc.name);
        console.log("📄 Uploaded documents names:", uploadedDocs);

        const missingDocs = requiredDocs.filter((doc) => !uploadedDocs.includes(doc));

        if (missingDocs.length > 0) {
          console.log("⚠️ Missing documents:", missingDocs);
           res.status(400).json({
            success: false,
            message: "Missing required documents",
            missing: missingDocs,
          });
            return;
        }
      }

      next();
    } catch (error) {
      console.error("❌ validateDocuments error:", error);
      next(error);
    }
  };






// import { Response, NextFunction, Request } from "express";
// import mongoose from "mongoose";
// import { Form } from "../models/form.model";
// import { UserDocument } from "../models/userDocs.model";

// export interface AuthenticatedRequest extends Request {
//   user?: any; // replace with IUser if defined
// }

// export const validateDocuments =
//   (context: "user" | "listing") =>
//   async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
//     try {
//       console.log("👉 validateDocuments start");

//       const { zone, subCategory } = req.body;
//       console.log("🟡 Zone from body:", zone);
//       console.log("🟡 SubCategory from body:", subCategory);
//       console.log("🔹 Full req.body:", JSON.stringify(req.body, null, 2));

//       if (!zone || !subCategory) {
//          res.status(400).json({
//           success: false,
//           message: "zone and subCategory are required",
//         });
//         return;
//       }

//       const form = await Form.findOne({
//         zone: new mongoose.Types.ObjectId(zone),
//         subCategory: new mongoose.Types.ObjectId(subCategory),
//         context,
//       }).populate("fields");

//       console.log("📄 Found form:", form ? form._id : "None");

//       if (!form) {
//         res.status(400).json({
//           success: false,
//           message: `Form not found for zone/subCategory with context=${context}`,
//         });
//         return;
//       }

//       const requiredDocs = form.fields
//         .filter((f: any) => f.type === "document")
//         .map((f: any) => f.name);

//       console.log("📌 Required document fields:", requiredDocs);

//       let uploadedDocs: string[] = [];

//       if (context === "listing") {
//         uploadedDocs =
//           req.body.documents?.map((doc: { name: string }) => doc.name) || [];
//       }

//       const missingDocs = requiredDocs.filter((doc) => !uploadedDocs.includes(doc));

//       if (missingDocs.length > 0) {
//          res.status(400).json({
//           success: false,
//           message: "Missing required documents",
//           missing: missingDocs,
//         });
//         return;
//       }

//       next();
//     } catch (error) {
//       console.error("❌ validateDocuments error:", error);
//       next(error);
//     }
//   };
