import { Request, Response, NextFunction } from "express";
import mongoose from "mongoose";
import { Zone } from "../models/zone.model";
import { sendResponse } from "../utils/response";
import { STATUS_CODES } from "../config/constants";
import { RentalPolicy } from "../models/rentalPolicy.model";

const updateRentalPolicy = async (
  req: Request,
  res: Response,
  next: NextFunction,
  field:
    | "securityDepositRules"
    | "damageLiabilityTerms"
    | "rentalDurationLimits"
) => {
  try {
    const { zoneId, subCategoryId } = req.params;

    if (
      !mongoose.Types.ObjectId.isValid(zoneId) ||
      !mongoose.Types.ObjectId.isValid(subCategoryId)
    ) {
      return sendResponse(
        res,
        null,
        req.t("rental:invalidZoneOrSubCategory"),
        STATUS_CODES.BAD_REQUEST
      );
    }

    const zone = await Zone.findById(zoneId);
    if (!zone) {
      return sendResponse(res, null, req.t("rental:zoneNotFound"), STATUS_CODES.NOT_FOUND);
    }

    const hasSubCategory = (zone.subCategories || []).some(
      (id: any) => id.toString() === subCategoryId
    );

    if (!hasSubCategory) {
      return sendResponse(
        res,
        null,
        req.t("rental:subCategoryNotLinked"),
        STATUS_CODES.BAD_REQUEST
      );
    }

    const currentPolicyData: any =
      (await RentalPolicy.findOne({ zone: zoneId, subCategory: subCategoryId }).lean()) || {};

    let newPolicyData: any = {
      zone: zoneId,
      subCategory: subCategoryId,
      securityDepositRules: currentPolicyData.securityDepositRules || {},
      damageLiabilityTerms: currentPolicyData.damageLiabilityTerms || {},
      rentalDurationLimits: currentPolicyData.rentalDurationLimits || [],
      extensionAllowed: currentPolicyData.extensionAllowed ?? true,
    };

    // 2. Apply updates to the specific field
    if (field === "rentalDurationLimits") {
      const incomingLimits = req.body.rentalDurationLimits !== undefined
        ? req.body.rentalDurationLimits
        : req.body;

      if (!Array.isArray(incomingLimits)) {
        return sendResponse(
          res,
          null,
          req.t("rental:durationLimitsMustBeArray"),
          STATUS_CODES.BAD_REQUEST
        );
      }

      newPolicyData.rentalDurationLimits = incomingLimits;

      // Sync extensionAllowed if provided in the same payload
      if (req.body.extensionAllowed !== undefined) {
        newPolicyData.extensionAllowed = req.body.extensionAllowed;
      }

    } else {
      // Merge for securityDepositRules or damageLiabilityTerms
      newPolicyData[field] = {
        ...newPolicyData[field],
        ...req.body,
      };
    }

    const policy = await RentalPolicy.findOneAndUpdate(
      { zone: zoneId, subCategory: subCategoryId },
      { $set: newPolicyData },
      { new: true, upsert: true, runValidators: true, setDefaultsOnInsert: true }
    );

    sendResponse(
      res,
      {
        [field]: policy[field as keyof typeof policy],
        policyId: policy._id,
        zone: policy.zone,
        subCategory: policy.subCategory,
      },
      req.t("rental:fieldUpdated", { field }),
      STATUS_CODES.OK
    );
  } catch (error) {
    next(error);
  }
};

const getRentalPolicy = async (
  req: Request,
  res: Response,
  next: NextFunction,
  field:
    | "securityDepositRules"
    | "damageLiabilityTerms"
    | "rentalDurationLimits"
) => {
  try {
    const { zoneId, subCategoryId } = req.params;

    if (
      !mongoose.Types.ObjectId.isValid(zoneId) ||
      !mongoose.Types.ObjectId.isValid(subCategoryId)
    ) {
      return sendResponse(
        res,
        null,
        req.t("rental:invalidZoneOrSubCategory"),
        STATUS_CODES.BAD_REQUEST
      );
    }

    const zone = await Zone.findById(zoneId).lean();
    if (!zone) {
      return sendResponse(res, null, req.t("rental:zoneNotFound"), STATUS_CODES.NOT_FOUND);
    }

    const hasSubCategory = (zone.subCategories || []).some(
      (id: any) => id.toString() === subCategoryId
    );

    if (!hasSubCategory) {
      return sendResponse(
        res,
        null,
        req.t("rental:subCategoryNotLinked"),
        STATUS_CODES.BAD_REQUEST
      );
    }

    const policies: any =
      (await RentalPolicy.findOne({ zone: zoneId, subCategory: subCategoryId }).lean()) || {};

    const responseData = {
      [field]: policies[field] || (field === "rentalDurationLimits" ? [] : {}),
      policyId: (policies as any)?._id ?? null,
      zone: zoneId,
      subCategory: subCategoryId,
    };

    if (field === "rentalDurationLimits") {
      responseData.extensionAllowed = policies.extensionAllowed ?? true;
    }

    sendResponse(
      res,
      responseData,
      req.t("rental:fieldFetched", { field }),
      STATUS_CODES.OK
    );
  } catch (error) {
    next(error);
  }
};

// Update wrappers
export const updateSecurityDepositRules = (
  req: Request,
  res: Response,
  next: NextFunction
) => updateRentalPolicy(req, res, next, "securityDepositRules");

export const updateDamageLiabilityTerms = (
  req: Request,
  res: Response,
  next: NextFunction
) => updateRentalPolicy(req, res, next, "damageLiabilityTerms");

export const updateRentalDurationLimits = (
  req: Request,
  res: Response,
  next: NextFunction
) => updateRentalPolicy(req, res, next, "rentalDurationLimits");

// Get wrappers
export const getSecurityDepositRules = (
  req: Request,
  res: Response,
  next: NextFunction
) => getRentalPolicy(req, res, next, "securityDepositRules");

export const getDamageLiabilityTerms = (
  req: Request,
  res: Response,
  next: NextFunction
) => getRentalPolicy(req, res, next, "damageLiabilityTerms");

export const getRentalDurationLimits = (
  req: Request,
  res: Response,
  next: NextFunction
) => getRentalPolicy(req, res, next, "rentalDurationLimits");
