import { Request, Response, NextFunction } from "express";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import { sendResponse } from "../utils/response";
import { STATUS_CODES } from "../config/constants";
import { IUser, User } from "../models/user.model";
import { Form } from "../models/form.model";
import {
  generateAccessToken,
  generateResetToken,
  verifyRefreshToken,
} from "../utils/jwt.utils";
import { sendEmail } from "../helpers/node-mailer";
import { createCustomer } from "../helpers/stripe-functions";
import { redis } from "../utils/redis.client";
import { generateZodSchema } from "../utils/generate-zod-schema";
import { UserDocument } from "../models/userDocs.model";
import { Category } from "../models/category.model";
import { Booking } from "../models/booking.model";
import { MarketplaceListing } from "../models/marketplaceListings.model";
import { Employee } from "../models/employeeManagement.model";
import { Zone } from "../models/zone.model";


import { Dropdown } from "../models/dropdown.model";


interface AuthRequest extends Request {
  user?: {
    _id: string;
    id?: string;   
    role: string | string[];
  };
}

export const uploadUserDocuments = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    const userId = req.user?.id || req.user?._id;
    if (!userId) {
      return sendResponse(res, null, "Unauthorized", STATUS_CODES.UNAUTHORIZED);
    }

    const { expiryDate, name, oldUrl, filesUrl } = req.body; // added filesUrl (string/array)
    const files = req.files as Express.Multer.File[];

    if (!name) {
      return sendResponse(
        res,
        null,
        "Document name is required",
        STATUS_CODES.BAD_REQUEST
      );
    }

    // Accept either uploaded files OR filesUrl from body
    let newUrls: string[] = [];
    if (files && files.length > 0) {
      newUrls = files.map((f) => `/uploads/${f.filename}`);
    } else if (filesUrl) {
      if (Array.isArray(filesUrl)) {
        newUrls = filesUrl;
      } else {
        newUrls = [filesUrl]; // if single string
      }
    } else {
      return sendResponse(
        res,
        null,
        "At least one file or URL must be provided",
        STATUS_CODES.BAD_REQUEST
      );
    }

    const user = await User.findById(userId);
    if (!user) {
      return sendResponse(res, null, "User not found", STATUS_CODES.NOT_FOUND);
    }

    const existingDocIndex = user.documents.findIndex(
      (doc: any) => doc.name === name
    );

    if (existingDocIndex > -1) {
      if (oldUrl) {
        // Replace old file with new one
        const urlIndex =
          user.documents[existingDocIndex].filesUrl.indexOf(oldUrl);

        if (urlIndex > -1) {
          user.documents[existingDocIndex].filesUrl[urlIndex] = newUrls[0];
        } else {
          return sendResponse(
            res,
            null,
            "Old file URL not found in document",
            STATUS_CODES.NOT_FOUND
          );
        }
      } else {
        // Append new URLs
        user.documents[existingDocIndex].filesUrl.push(...newUrls);
      }

      if (expiryDate) {
        user.documents[existingDocIndex].expiryDate = new Date(expiryDate);
      }
      user.documents[existingDocIndex].status = "pending";
    } else {
      //  New document
      user.documents.push({
        name,
        filesUrl: newUrls,
        expiryDate: expiryDate ? new Date(expiryDate) : undefined,
        status: "pending",
      });
    }

    await user.save();

    return sendResponse(
      res,
      user,
      oldUrl
        ? "Document file replaced successfully"
        : "Document(s) uploaded/updated successfully",
      STATUS_CODES.OK
    );
  } catch (error) {
    next(error);
  }
};

export const reviewUserDocument = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    if (req.user?.role !== "admin") {
      sendResponse(res, null, "Forbidden: Admins only", STATUS_CODES.FORBIDDEN);
      return;
    }

    const { userId, documentId, status, reason } = req.body;

    if (!["approved", "rejected"].includes(status)) {
      sendResponse(
        res,
        null,
        "Invalid status. Allowed: approved, rejected",
        STATUS_CODES.BAD_REQUEST
      );
      return;
    }

    const user = await User.findOneAndUpdate(
      { _id: userId, "documents._id": documentId },
      {
        $set: {
          "documents.$.status": status,
          "documents.$.reason": reason || "",
        },
      },
      { new: true }
    ).select("-password");

    if (!user) {
      sendResponse(res, null, "User or document not found", STATUS_CODES.NOT_FOUND);
      return;
    }

    sendResponse(
      res,
      user,
      `Document ${status === "approved" ? "approved" : "rejected"} successfully`,
      STATUS_CODES.OK
    );
  } catch (error) {
    next(error);
  }
};

// Get all users (admin only)
export const getAllUsers = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    if (req.user?.role !== "admin") {
      return sendResponse(
        res,
        null,
        "Forbidden: Admins only",
        STATUS_CODES.FORBIDDEN
      );
    }

    const users = await User.find().select("-password"); // exclude password
    return sendResponse(res, users, "Users fetched successfully", STATUS_CODES.OK);
  } catch (error) {
    next(error);
  }
};

// Get user by ID (admin or the user himself)
export const getUserById = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    const { id } = req.params;

    const user = await User.findById(id).select("-password");
    if (!user) {
      return sendResponse(res, null, "User not found", STATUS_CODES.NOT_FOUND);
    }

    return sendResponse(res, user, "User fetched successfully", STATUS_CODES.OK);
  } catch (error) {
    next(error);
  }
};
