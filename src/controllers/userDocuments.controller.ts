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
      return sendResponse(res, null, req.t("common:unauthorized"), STATUS_CODES.UNAUTHORIZED);
    }

    const { expiryDate, name, fileUrl } = req.body;
    const file = req.file as Express.Multer.File; // ✅ single file, not array

    if (!name) {
      return sendResponse(res, null, req.t("user:document.nameRequired"), STATUS_CODES.BAD_REQUEST);
    }

    // ✅ Accept either an uploaded file OR a fileUrl from body
    let newFileUrl: string;
    if (file) {
      newFileUrl = `/uploads/${file.filename}`;
    } else if (fileUrl && typeof fileUrl === "string") {
      newFileUrl = fileUrl;
    } else {
      return sendResponse(res, null, req.t("user:document.fileOrUrlRequired"), STATUS_CODES.BAD_REQUEST);
    }

    const user = await User.findById(userId);
    if (!user) {
      return sendResponse(res, null, req.t("user:notFound"), STATUS_CODES.NOT_FOUND);
    }

    const existingDoc = user.documents.find((doc: any) => doc.name === name);

    if (existingDoc) {
      // ✅ Block re-upload if pending or approved
      if (existingDoc.fileUrl && existingDoc.status !== "rejected") {
        return sendResponse(
          res,
          { document: name, status: existingDoc.status },
          existingDoc.status === "approved"
            ? req.t("user:document.alreadyApproved", { name })
            : req.t("user:document.alreadySubmitted", { name }),
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

    return sendResponse(res, user, req.t("user:document.uploaded"), STATUS_CODES.OK);
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
      sendResponse(res, null, req.t("user:adminsOnly"), STATUS_CODES.FORBIDDEN);
      return;
    }

    const { userId, documentId, status, reason } = req.body;

    if (!["approved", "rejected"].includes(status)) {
      sendResponse(
        res,
        null,
        req.t("user:document.invalidStatus"),
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
        req.t("user:document.userOrDocNotFound"),
        STATUS_CODES.NOT_FOUND
      );
      return;
    }

    sendResponse(
      res,
      user,
      status === "approved"
        ? req.t("user:document.approvedSuccessfully")
        : req.t("user:document.rejectedSuccessfully"),
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
        req.t("user:adminsOnly"),
        STATUS_CODES.FORBIDDEN
      );
    }

    const users = await User.find().select("-password"); // exclude password
    return sendResponse(
      res,
      users,
      req.t("user:document.usersFetched"),
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
      return sendResponse(res, null, req.t("user:notFound"), STATUS_CODES.NOT_FOUND);
    }

    return sendResponse(
      res,
      user,
      req.t("user:document.singleUserFetched"),
      STATUS_CODES.OK
    );
  } catch (error) {
    next(error);
  }
};
