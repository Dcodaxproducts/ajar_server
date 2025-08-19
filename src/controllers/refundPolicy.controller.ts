import { Request, Response } from "express";
import { RefundPolicy } from "../models/refundPolicy.model";
import { Zone } from "../models/zone.model";
import { Category } from "../models/category.model";
import asyncHandler from "express-async-handler";
import mongoose from "mongoose";
import { paginateQuery } from "../utils/paginate";

const isValidObjectIdAndExists = async (
  id: string,
  model: mongoose.Model<any>
): Promise<boolean> => {
  return mongoose.Types.ObjectId.isValid(id) && !!(await model.findById(id));
};

// Create Refund Policy
export const createRefundPolicy = asyncHandler(
  async (req: Request, res: Response) => {
    const { zone, subCategory } = req.body;

    if (!(await isValidObjectIdAndExists(zone, Zone))) {
      res.status(400).json({ message: "Invalid zone ID" });
      return;
    }

    if (!(await isValidObjectIdAndExists(subCategory, Category))) {
      res.status(400).json({ message: "Invalid subCategory ID" });
      return;
    }

    const policy = await RefundPolicy.create({
      zone,
      subCategory,
      allowFund: req.body.allowFund ?? false,
      cancellationCutoffTime: req.body.cancellationCutoffTime ?? {
        days: 0,
        hours: 0,
      },
      flatFee: req.body.flatFee ?? { amount: 0, days: 0, hours: 0 },
      noteText: req.body.noteText ?? "",
      refundWindow: req.body.refundWindow ?? "full",
    });

    res.status(201).json({
      success: true,
      message: "Refund policy created successfully",
      data: policy,
    });
  }
);

// Get All Refund Policies
export const getAllRefundPolicies = asyncHandler(
  async (req: Request, res: Response) => {
    const page = Number(req.query.page) || 1;
    const limit = Number(req.query.limit) || 10;

    const baseQuery = RefundPolicy.find()
      .populate("zone", "zoneName")
      .populate("subCategory", "categoryName");

    const { data, total } = await paginateQuery(baseQuery, { page, limit });

    res.status(200).json({ success: true, data, total, page, limit });
  }
);

// Get Refund Policies by Zone and SubCategory
export const getRefundPoliciesByZoneAndCategory = asyncHandler(
  async (req: Request, res: Response) => {
    const { zone, subCategory } = req.params;

    const policy = await RefundPolicy.findOne({
      zone: new mongoose.Types.ObjectId(zone),
      subCategory: new mongoose.Types.ObjectId(subCategory),
    })
      .populate("zone", "zoneName")
      .populate("subCategory", "categoryName");

    if (!policy) {
      res.status(404).json({
        success: false,
        message: "No refund policy found for this zone and subCategory",
      });
      return;
    }

    res.status(200).json({
      success: true,
      data: policy,
    });
  }
);

// Update Refund Policy
export const updateRefundPolicy = asyncHandler(
  async (req: Request, res: Response): Promise<void> => {
    const zone = req.params.zone || req.body.zone;
    const subCategory = req.params.subCategory || req.body.subCategory;

    // Check mismatch if both provided
    if (req.params.zone && req.body.zone && req.params.zone !== req.body.zone) {
      res
        .status(400)
        .json({ message: "Zone ID mismatch between params and body" });
      return;
    }

    if (
      req.params.subCategory &&
      req.body.subCategory &&
      req.params.subCategory !== req.body.subCategory
    ) {
      res
        .status(400)
        .json({ message: "SubCategory ID mismatch between params and body" });
      return;
    }

    // Validate IDs
    if (!(await isValidObjectIdAndExists(zone, Zone))) {
      res.status(400).json({ message: "Invalid zone ID" });
      return;
    }

    if (!(await isValidObjectIdAndExists(subCategory, Category))) {
      res.status(400).json({ message: "Invalid subCategory ID" });
      return;
    }

    // Find existing policy
    let policy = await RefundPolicy.findOne({ zone, subCategory });

    if (policy) {
      policy = await RefundPolicy.findByIdAndUpdate(
        policy._id,
        {
          zone,
          subCategory,
          allowFund: req.body.allowFund ?? policy.allowFund,
          cancellationCutoffTime:
            req.body.cancellationCutoffTime ?? policy.cancellationCutoffTime,
          flatFee: req.body.flatFee ?? policy.flatFee,
          noteText: req.body.noteText ?? policy.noteText,
          refundWindow: req.body.refundWindow ?? policy.refundWindow,
        },
        { new: true }
      );

      res.status(200).json({
        success: true,
        message: "Refund policy updated successfully",
        data: policy,
      });
      return;
    }

    // Create new if not found
    const newPolicy = await RefundPolicy.create({
      zone,
      subCategory,
      allowFund: req.body.allowFund ?? false,
      cancellationCutoffTime: req.body.cancellationCutoffTime ?? {
        days: 0,
        hours: 0,
      },
      flatFee: req.body.flatFee ?? { amount: 0, days: 0, hours: 0 },
      noteText: req.body.noteText ?? "",
      refundWindow: req.body.refundWindow ?? "full",
    });

    res.status(201).json({
      success: true,
      message: "Refund policy created successfully",
      data: newPolicy,
    });
  }
);

// Delete Refund Policy
export const deleteRefundPolicy = asyncHandler(
  async (req: Request, res: Response) => {
    const { id } = req.params;
    const policy = await RefundPolicy.findByIdAndDelete(id);
    if (!policy) {
      res.status(404).json({ message: "Refund policy not found" });
      return;
    }
    res.status(200).json({ success: true, message: "Refund policy deleted" });
  }
);
