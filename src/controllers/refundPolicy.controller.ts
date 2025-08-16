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

    const policy = await RefundPolicy.create(req.body);

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

//update
// Update Refund Policy (update if exists, else create new)
export const updateRefundPolicy = asyncHandler(
  async (req: Request, res: Response): Promise<void> => {
    const { zone, subCategory } = req.params;

    // Validate IDs
    if (!(await isValidObjectIdAndExists(zone, Zone))) {
      res.status(400).json({ message: "Invalid zone ID" });
      return;
    }

    if (!(await isValidObjectIdAndExists(subCategory, Category))) {
      res.status(400).json({ message: "Invalid subCategory ID" });
      return;
    }

    // Check if a policy exists
    let policy = await RefundPolicy.findOne({ zone, subCategory });

    if (policy) {
      // Update existing policy
      policy = await RefundPolicy.findByIdAndUpdate(policy._id, req.body, {
        new: true,
      });

      res.status(200).json({
        success: true,
        message: "Refund policy updated successfully",
        data: policy,
      });
      return;
    }

    //Create new policy
    const newPolicy = await RefundPolicy.create({
      zone,
      subCategory,
      ...req.body,
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
