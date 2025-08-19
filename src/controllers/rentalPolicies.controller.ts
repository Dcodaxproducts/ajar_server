// import { Request, Response, NextFunction } from "express";
// import mongoose from "mongoose";
// import { Zone } from "../models/zone.model";
// import { sendResponse } from "../utils/response";
// import { STATUS_CODES } from "../config/constants";

// const updateRentalPolicy = async (
//   req: Request,
//   res: Response,
//   next: NextFunction,
//   field:
//     | "securityDepositRules"
//     | "damageLiabilityTerms"
//     | "rentalDurationLimits"
// ) => {
//   try {
//     const { zoneId } = req.params;

//     if (!mongoose.Types.ObjectId.isValid(zoneId)) {
//       return sendResponse(
//         res,
//         null,
//         "Invalid Zone ID",
//         STATUS_CODES.BAD_REQUEST
//       );
//     }

//     const zone = await Zone.findById(zoneId);
//     if (!zone) {
//       return sendResponse(res, null, "Zone not found", STATUS_CODES.NOT_FOUND);
//     }

//     zone.rentalPolicies = zone.rentalPolicies || {};
//     zone.rentalPolicies[field] = {
//       ...zone.rentalPolicies[field],
//       ...req.body,
//     };

//     await zone.save();

//     // ✅ return only the updated section
//     sendResponse(
//       res,
//       { [field]: zone.rentalPolicies[field] },
//       `${field} updated successfully`,
//       STATUS_CODES.OK
//     );
//   } catch (error) {
//     next(error);
//   }
// };

// // Specific wrappers
// export const updateSecurityDepositRules = (
//   req: Request,
//   res: Response,
//   next: NextFunction
// ) => updateRentalPolicy(req, res, next, "securityDepositRules");

// export const updateDamageLiabilityTerms = (
//   req: Request,
//   res: Response,
//   next: NextFunction
// ) => updateRentalPolicy(req, res, next, "damageLiabilityTerms");

// export const updateRentalDurationLimits = (
//   req: Request,
//   res: Response,
//   next: NextFunction
// ) => updateRentalPolicy(req, res, next, "rentalDurationLimits");

// export const getRentalPolicies = async (
//   req: Request,
//   res: Response,
//   next: NextFunction
// ) => {
//   try {
//     const { zoneId } = req.params;

//     if (!mongoose.Types.ObjectId.isValid(zoneId)) {
//       return sendResponse(
//         res,
//         null,
//         "Invalid Zone ID",
//         STATUS_CODES.BAD_REQUEST
//       );
//     }

//     const zone = await Zone.findById(zoneId).lean();
//     if (!zone) {
//       return sendResponse(res, null, "Zone not found", STATUS_CODES.NOT_FOUND);
//     }

//     // ✅ return all policies only on GET
//     sendResponse(
//       res,
//       {
//         securityDepositRules: zone.rentalPolicies?.securityDepositRules || {},
//         damageLiabilityTerms: zone.rentalPolicies?.damageLiabilityTerms || {},
//         rentalDurationLimits: zone.rentalPolicies?.rentalDurationLimits || {},
//       },
//       "Rental policies fetched",
//       STATUS_CODES.OK
//     );
//   } catch (error) {
//     next(error);
//   }
// };

import { Request, Response, NextFunction } from "express";
import mongoose from "mongoose";
import { Zone } from "../models/zone.model";
import { sendResponse } from "../utils/response";
import { STATUS_CODES } from "../config/constants";

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

    if (!mongoose.Types.ObjectId.isValid(zoneId)) {
      return sendResponse(
        res,
        null,
        "Invalid Zone ID",
        STATUS_CODES.BAD_REQUEST
      );
    }

    const zone = await Zone.findById(zoneId);
    if (!zone) {
      return sendResponse(res, null, "Zone not found", STATUS_CODES.NOT_FOUND);
    }

    zone.rentalPolicies = zone.rentalPolicies || {};
    zone.rentalPolicies[field] = {
      ...zone.rentalPolicies[field],
      ...req.body,
    };

    await zone.save();

    sendResponse(
      res,
      { [field]: zone.rentalPolicies[field] },
      `${field} updated successfully`,
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

    const zone = await Zone.findById(zoneId).lean();
    if (!zone) {
      return sendResponse(res, null, "Zone not found", STATUS_CODES.NOT_FOUND);
    }

    sendResponse(
      res,
      { [field]: zone.rentalPolicies?.[field] || {} },
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
