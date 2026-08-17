import { Request, Response } from "express";
import { ContactUs } from "../models/contactUs.model";
import { sendResponse } from "../utils/response";
import { STATUS_CODES } from "../config/constants";

export const createContact = async (req: Request, res: Response) => {
  try {
    const { phone, email, address, order } = req.body;

    const contact = await ContactUs.create({ phone, email, address, order });

    sendResponse(
      res,
      contact,
      req.t("contact:created"),
      STATUS_CODES.CREATED
    );
  } catch (error) {
    sendResponse(
      res,
      null,
      req.t("contact:createFailed"),
      STATUS_CODES.INTERNAL_SERVER_ERROR
    );
  }
};

export const getAllContacts = async (req: Request, res: Response) => {
  try {
    const contacts = await ContactUs.find().sort({ order: 1 });
    sendResponse(
      res,
      contacts,
      req.t("contact:listFetched"),
      STATUS_CODES.OK
    );
  } catch (error) {
    sendResponse(
      res,
      null,
      req.t("contact:listFailed"),
      STATUS_CODES.INTERNAL_SERVER_ERROR
    );
  }
};

export const getContactById = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    const contact = await ContactUs.findById(req.params.id);

    if (!contact) {
      sendResponse(res, null, req.t("contact:notFound"), STATUS_CODES.NOT_FOUND);
      return;
    }

    sendResponse(
      res,
      contact,
      req.t("contact:fetched"),
      STATUS_CODES.OK
    );
  } catch (error) {
    sendResponse(
      res,
      null,
      req.t("contact:fetchFailed"),
      STATUS_CODES.INTERNAL_SERVER_ERROR
    );
  }
};

export const updateContact = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    const contact = await ContactUs.findByIdAndUpdate(req.params.id, req.body, {
      new: true,
    });

    if (!contact) {
      res.status(404).json({ success: false, message: req.t("contact:notFound") });
      return;
    }

    res.status(200).json({ success: true, data: contact });
  } catch (error) {
    res.status(500).json({ success: false, message: req.t("common:serverError"), error });
  }
};

export const deleteContact = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    const contact = await ContactUs.findByIdAndDelete(req.params.id);

    if (!contact) {
      res.status(404).json({ success: false, message: req.t("contact:notFound") });
      return;
    }

    res
      .status(200)
      .json({ success: true, message: req.t("contact:deleted") });
  } catch (error) {
    res.status(500).json({ success: false, message: req.t("common:serverError"), error });
  }
};
