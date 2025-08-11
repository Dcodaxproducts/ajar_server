import { Request, Response } from "express";
import { BusinessSetting } from "../models/businessSetting.model";

// Allowed enum values for pageName
const allowedPageNames = [
  "businessInfo",
  "paymentMethods",
  "smsModule",
  "mailConfig",
  "mapAPI",
  "socialLogins",
  "recaptcha",
  "firebase",
];

// CREATE or UPDATE based on pageName
// export const createOrUpdateBusinessSetting = async (
//   req: Request,
//   res: Response
// ) => {
//   try {
//     const { pageName } = req.params; // take from URL
//     const { pageSettings, languages } = req.body;

//     if (!allowedPageNames.includes(pageName)) {
//       return res.status(400).json({
//         success: false,
//         message: `Invalid pageName. Allowed values are: ${allowedPageNames.join(
//           ", "
//         )}`,
//       });
//     }

//     const existing = await BusinessSetting.findOne({ pageName });

//     let result;
//     if (existing) {
//       // Merge old settings with new settings
//       result = await BusinessSetting.findOneAndUpdate(
//         { pageName },
//         {
//           pageSettings: { ...existing.pageSettings, ...pageSettings },
//           ...(languages ? { languages } : {}),
//         },
//         { new: true }
//       );

//       return res.status(200).json({
//         success: true,
//         message: `Business setting for '${pageName}' updated successfully`,
//         data: result,
//       });
//     } else {
//       // Create new setting
//       result = await BusinessSetting.create({
//         pageName,
//         pageSettings,
//         languages,
//       });

//       return res.status(201).json({
//         success: true,
//         message: "Business setting created successfully",
//         data: result,
//       });
//     }
//   } catch (error: any) {
//     return res.status(500).json({
//       success: false,
//       message: error.message || "Internal server error",
//     });
//   }
// };

// CREATE only if not exists
export const createBusinessSetting = async (req: Request, res: Response) => {
  try {
    const { pageName, pageSettings, languages } = req.body;

    if (!pageName || !pageSettings) {
      return res.status(400).json({
        success: false,
        message: "`pageName` and `pageSettings` are required",
      });
    }

    if (!allowedPageNames.includes(pageName)) {
      return res.status(400).json({
        success: false,
        message: `Invalid pageName. Allowed values are: ${allowedPageNames.join(
          ", "
        )}`,
      });
    }

    const existing = await BusinessSetting.findOne({ pageName });
    if (existing) {
      return res.status(400).json({
        success: false,
        message: `Settings for '${pageName}' already exist. Use update API instead.`,
      });
    }

    const created = await BusinessSetting.create({
      pageName,
      pageSettings,
      languages,
    });

    return res.status(201).json({
      success: true,
      message: "Business setting created successfully",
      data: created,
    });
  } catch (error: any) {
    return res.status(500).json({
      success: false,
      message: error.message || "Internal server error",
    });
  }
};

// PATCH - Update if exists, else create
export const updateOrCreateBusinessSetting = async (
  req: Request,
  res: Response
) => {
  try {
    const { pageName } = req.params;
    const { pageSettings, languages } = req.body;

    if (!allowedPageNames.includes(pageName)) {
      return res.status(400).json({
        success: false,
        message: `Invalid pageName. Allowed values are: ${allowedPageNames.join(
          ", "
        )}`,
      });
    }

    const existing = await BusinessSetting.findOne({ pageName });

    let result;
    if (existing) {
      // Merge old and new pageSettings
      result = await BusinessSetting.findOneAndUpdate(
        { pageName },
        {
          pageSettings: { ...existing.pageSettings, ...pageSettings },
          ...(languages ? { languages } : {}),
        },
        { new: true }
      );
      return res.status(200).json({
        success: true,
        message: `Business setting for '${pageName}' updated successfully`,
        data: result,
      });
    } else {
      // Create new if not found
      result = await BusinessSetting.create({
        pageName,
        pageSettings,
        languages,
      });
      return res.status(201).json({
        success: true,
        message: "Business setting created successfully (via PATCH)",
        data: result,
      });
    }
  } catch (error: any) {
    return res.status(500).json({
      success: false,
      message: error.message || "Internal server error",
    });
  }
};

//CREATE only if not exists
// export const createBusinessSetting = async (req: Request, res: Response) => {
//   try {
//     const { pageName, pageSettings } = req.body;

//     if (!pageName || !pageSettings) {
//       return res.status(400).json({ success: false, message: "`pageName` and `pageSettings` are required" });
//     }

//     if (!allowedPageNames.includes(pageName)) {
//       return res.status(400).json({ success: false, message: `Invalid pageName. Allowed values are: ${allowedPageNames.join(", ")}` });
//     }

//     const existing = await BusinessSetting.findOne({ pageName });

//     if (existing) {
//       return res.status(400).json({ success: false, message: `Settings for '${pageName}' already exist. Use update API instead.` });
//     }

//     const created = await BusinessSetting.create({ pageName, pageSettings });

//     return res.status(201).json({
//       success: true,
//       message: "Business setting created successfully",
//       data: created,
//     });
//   } catch (error: any) {
//     return res.status(500).json({ success: false, message: error.message || "Internal server error" });
//   }
// };

//UPDATE existing setting
// export const updateBusinessSetting = async (req: Request, res: Response) => {
//   try {
//     const { pageName } = req.params;

//     const updated = await BusinessSetting.findOneAndUpdate(
//       { pageName },
//       req.body,
//       { new: true }
//     );

//     if (!updated) {
//       return res.status(404).json({ success: false, message: `No setting found for '${pageName}'` });
//     }

//     return res.status(200).json({
//       success: true,
//       message: "Business setting updated successfully",
//       data: updated,
//     });
//   } catch (error: any) {
//     return res.status(500).json({ success: false, message: error.message });
//   }
// };

//GET by pageName
export const getBusinessSettingByPage = async (req: Request, res: Response) => {
  try {
    const { pageName } = req.params;

    const setting = await BusinessSetting.findOne({ pageName });

    if (!setting) {
      return res
        .status(404)
        .json({ success: false, message: "Setting not found" });
    }

    return res.status(200).json({ success: true, data: setting });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

//DELETE by pageName
export const deleteBusinessSettingByPage = async (
  req: Request,
  res: Response
) => {
  try {
    const { pageName } = req.params;

    const deleted = await BusinessSetting.findOneAndDelete({ pageName });

    if (!deleted) {
      return res
        .status(404)
        .json({ success: false, message: "Setting not found" });
    }

    return res
      .status(200)
      .json({ success: true, message: "Setting deleted successfully" });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  }
};
