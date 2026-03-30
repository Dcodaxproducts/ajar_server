import { Request, Response, NextFunction } from "express";
import { sendResponse } from "../utils/response";
import { STATUS_CODES } from "../config/constants";
import { User } from "../models/user.model";

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

    const { expiryDate, name, fileUrl } = req.body;
    const file = req.file as Express.Multer.File; // ✅ single file, not array

    if (!name) {
      return sendResponse(res, null, "Document name is required", STATUS_CODES.BAD_REQUEST);
    }

    // ✅ Accept either an uploaded file OR a fileUrl from body
    let newFileUrl: string;
    if (file) {
      newFileUrl = `/uploads/${file.filename}`;
    } else if (fileUrl && typeof fileUrl === "string") {
      newFileUrl = fileUrl;
    } else {
      return sendResponse(res, null, "A file or URL must be provided", STATUS_CODES.BAD_REQUEST);
    }

    const user = await User.findById(userId);
    if (!user) {
      return sendResponse(res, null, "User not found", STATUS_CODES.NOT_FOUND);
    }

    const existingDoc = user.documents.find((doc: any) => doc.name === name);

    if (existingDoc) {
      // ✅ Block re-upload if pending or approved
      if (existingDoc.fileUrl && existingDoc.status !== "rejected") {
        return sendResponse(
          res,
          { document: name, status: existingDoc.status },
          existingDoc.status === "approved"
            ? `Document "${name}" is already approved and cannot be re-uploaded`
            : `Document "${name}" is already submitted and under review`,
          STATUS_CODES.CONFLICT
        );
      }

      // Status is "rejected" → allow overwrite
      existingDoc.fileUrl = newFileUrl;
      existingDoc.status = "pending"; // reset
      existingDoc.reason = undefined; // clear rejection reason
      if (expiryDate) existingDoc.expiryDate = new Date(expiryDate);
    } else {
      // ✅ Fresh document
      user.documents.push({
        name,
        fileUrl: newFileUrl,
        expiryDate: expiryDate ? new Date(expiryDate) : undefined,
        status: "pending",
      });
    }

    await user.save();

    return sendResponse(res, user, "Document uploaded successfully", STATUS_CODES.OK);
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
      sendResponse(
        res,
        null,
        "User or document not found",
        STATUS_CODES.NOT_FOUND
      );
      return;
    }

    sendResponse(
      res,
      user,
      `Document ${
        status === "approved" ? "approved" : "rejected"
      } successfully`,
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
    return sendResponse(
      res,
      users,
      "Users fetched successfully",
      STATUS_CODES.OK
    );
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

    return sendResponse(
      res,
      user,
      "User fetched successfully",
      STATUS_CODES.OK
    );
  } catch (error) {
    next(error);
  }
};
