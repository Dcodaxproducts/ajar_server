import { Request, Response, NextFunction } from "express";
import { RefundManagement } from "../models/refundManagement.model";
import { Zone } from "../models/zone.model";
import { Category } from "../models/category.model";
import mongoose from "mongoose";
import asyncHandler from "express-async-handler";

// Helper function to check if ObjectId is valid and exists
const isValidObjectIdAndExists = async (
  id: string,
  model: mongoose.Model<any>
): Promise<boolean> => {
  return mongoose.Types.ObjectId.isValid(id) && !!(await model.findById(id));
};

//Create Refund Settings (Admin)
export const createRefundSettings = asyncHandler(
  async (req: Request, res: Response, next: NextFunction) => {
    const {
      zone,
      subCategory,
      allowFund,
      cutoffTime,
      flatFee,
      time,
      note,
    } = req.body;

    if (!(await isValidObjectIdAndExists(zone, Zone))) {
      res.status(400).json({ message: "Invalid zone ID" });
      return;
    }

    if (!(await isValidObjectIdAndExists(subCategory, Category))) {
      res.status(400).json({ message: "Invalid subCategory ID" });
      return;
    }

    const refundSettings = await RefundManagement.create({
      zoneId: zone,
      subCategory,
      allowFund,
      cutoffTime,
      flatFee,
      time,
      note,
    });

    res.status(201).json({
      success: true,
      message: "Refund settings created successfully",
      data: refundSettings,
    });
  }
);

//Get All Refund Settings (Admin)
export const getAllRefundSettings = asyncHandler(
  async (req: Request, res: Response) => {
    const settings = await RefundManagement.find()
      .populate("zoneId", "zoneName")
      .populate("subCategory", "categoryName");

    res.status(200).json({
      success: true,
      data: settings,
    });
  }
);

//Update Refund Settings (Admin)
export const updateRefundSettings = asyncHandler(
  async (req: Request, res: Response) => {
    const { id } = req.params;
    const {
      zone,
      subCategory,
      allowFund,
      cutoffTime,
      flatFee,
      time,
      note,
    } = req.body;

    const refund = await RefundManagement.findById(id);
    if (!refund) {
      res.status(404).json({ message: "Refund settings not found" });
      return;
    }

    if (zone && !(await isValidObjectIdAndExists(zone, Zone))) {
      res.status(400).json({ message: "Invalid zone ID" });
      return;
    }

    if (subCategory && !(await isValidObjectIdAndExists(subCategory, Category))) {
      res.status(400).json({ message: "Invalid subCategory ID" });
      return;
    }

    refund.zone = zone || refund.zone;
    refund.subCategory = subCategory || refund.subCategory;
    refund.allowFund = allowFund ?? refund.allowFund;
    refund.cutoffTime = cutoffTime || refund.cutoffTime;
    refund.flatFee = flatFee ?? refund.flatFee;
    refund.time = time || refund.time;
    refund.note = note || refund.note;

    await refund.save();

    res.status(200).json({
      success: true,
      message: "Refund settings updated successfully",
      data: refund,
    });
  }
);

//Delete Refund Settings (Admin)
export const deleteRefundSettings = asyncHandler(
  async (req: Request, res: Response) => {
    const { id } = req.params;

    const refund = await RefundManagement.findByIdAndDelete(id);
    if (!refund) {
      res.status(404).json({ message: "Refund settings not found" });
      return;
    }

    res.status(200).json({
      success: true,
      message: "Refund settings deleted successfully",
    });
  }
);
