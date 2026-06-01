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
      

      let { zone, subCategory, documents } = req.body;

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

        const uploadedDocs = documents.map((doc: { name: string }) => doc.name);

        const missingDocs = requiredDocs.filter((doc) => !uploadedDocs.includes(doc));

        if (missingDocs.length > 0) {
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
      console.error("validateDocuments error:", error);
      next(error);
    }
  };
