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
  "termsAndConditions",
  "privacyPolicy",
  "cancellationPolicy"
];

// CREATE only if not exists
export const createBusinessSetting = async (req: Request, res: Response) => {
  try {
    const { pageName, pageSettings, languages } = req.body;

    if (!pageName || !pageSettings) {
      return res.status(400).json({
        success: false,
        message: req.t("setting:pageFieldsRequired"),
      });
    }

    if (!allowedPageNames.includes(pageName)) {
      return res.status(400).json({
        success: false,
        message: req.t("setting:invalidPageName", {
          allowed: allowedPageNames.join(", "),
        }),
      });
    }

    const existing = await BusinessSetting.findOne({ pageName });
    if (existing) {
      return res.status(400).json({
        success: false,
        message: req.t("setting:alreadyExists", { pageName }),
      });
    }

    const created = await BusinessSetting.create({
      pageName,
      pageSettings,
      languages,
    });

    return res.status(201).json({
      success: true,
      message: req.t("setting:created"),
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

    const uploadedFile = req.file;
    if (uploadedFile) {
      req.body.pageSettings = {
        ...req.body.pageSettings,
        fileUrl: `/uploads/${uploadedFile.filename}`,
      };
    } else {
      const files = req.files as { [fieldname: string]: Express.Multer.File[] };
      const thumbnail = files?.thumbnail?.[0];
      const icon = files?.icon?.[0];
      if (thumbnail) req.body.pageSettings = { ...req.body.pageSettings, thumbnail: `/uploads/${thumbnail.filename}` };
      if (icon) req.body.pageSettings = { ...req.body.pageSettings, icon: `/uploads/${icon.filename}` };
    }

    const { pageSettings, languages } = req.body;

    if (!allowedPageNames.includes(pageName)) {
      return res.status(400).json({
        success: false,
        message: req.t("setting:invalidPageName", {
          allowed: allowedPageNames.join(", "),
        }),
      });
    }

    const existing = await BusinessSetting.findOne({ pageName });

    let result;
    if (existing) {
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
        message: req.t("setting:updated", { pageName }),
        data: result,
      });
    } else {
      result = await BusinessSetting.create({ pageName, pageSettings, languages });
      return res.status(201).json({
        success: true,
        message: req.t("setting:createdViaPatch"),
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

//GET by pageName
export const getBusinessSettingByPage = async (req: Request, res: Response) => {
  try {
    const { pageName } = req.params;

    const setting = await BusinessSetting.findOne({ pageName });

    if (!setting) {
      return res
        .status(404)
        .json({ success: false, message: req.t("setting:notFound") });
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
        .json({ success: false, message: req.t("setting:notFound") });
    }

    return res
      .status(200)
      .json({ success: true, message: req.t("setting:deleted") });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  }
};
