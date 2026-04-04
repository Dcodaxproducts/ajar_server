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
    const { zoneId } = req.params;

    // 1. Find the zone and populate the current policy to get existing data
    const zone = await Zone.findById(zoneId).populate("rentalPolicies");
    if (!zone) {
      return sendResponse(res, null, "Zone not found", STATUS_CODES.NOT_FOUND);
    }

    // Get existing policy data or set defaults
    const currentPolicyData = (zone.rentalPolicies as any) || {};

    // Initialize the new data object with existing values
    let newPolicyData: any = {
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
          "rentalDurationLimits must be an array of policies",
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

    // 3. CREATE A NEW DOCUMENT (Versioning)
    // This ensures old bookings linked to the previous ID remain unchanged
    const createdPolicy = await RentalPolicy.create(newPolicyData);

    // 4. LINK THE ZONE TO THE NEW POLICY ID
    zone.rentalPolicies = createdPolicy._id as any;
    await zone.save();

    sendResponse(
      res,
      {
        [field]: createdPolicy[field as keyof typeof createdPolicy],
        policyId: createdPolicy._id
      },
      `${field} updated (new version created)`,
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
    const { zoneId } = req.params;

    if (!mongoose.Types.ObjectId.isValid(zoneId)) {
      return sendResponse(
        res,
        null,
        "Invalid Zone ID",
        STATUS_CODES.BAD_REQUEST
      );
    }

    // 1. Populate 'rentalPolicies' to get the data from the separate collection
    const zone = await Zone.findById(zoneId)
      .populate("rentalPolicies")
      .lean();

    if (!zone) {
      return sendResponse(res, null, "Zone not found", STATUS_CODES.NOT_FOUND);
    }

    /** * 2. Extract the policies. 
     * Since we used populate, zone.rentalPolicies is now the full object.
     * We add a fallback to an empty object if no policy is linked yet.
     */
    const policies = (zone.rentalPolicies as any) || {};

    // Special case: if fetching rentalDurationLimits, also return extensionAllowed 
    // to keep your frontend toggle working correctly.
    const responseData = {
      [field]: policies[field] || (field === "rentalDurationLimits" ? [] : {}),
    };

    if (field === "rentalDurationLimits") {
      responseData.extensionAllowed = policies.extensionAllowed ?? true;
    }

    sendResponse(
      res,
      responseData,
      `${field} fetched successfully`,
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