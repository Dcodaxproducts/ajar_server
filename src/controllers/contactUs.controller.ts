import { Request, Response } from "express";
import { ContactUs } from "../models/contactUs.model";
import { sendResponse } from "../utils/response";
import { STATUS_CODES } from "../config/constants";

export const createContact = async (req: Request, res: Response) => {
  try {
    const { phone, email, address, order } = req.body;

    const contact = await ContactUs.create({ phone, email, address, order });

    sendResponse(res, contact, "Contact information created successfully", STATUS_CODES.CREATED);
  } catch (error) {
    sendResponse(res, null, "Failed to create contact information", STATUS_CODES.INTERNAL_SERVER_ERROR);
  }
};

export const getAllContacts = async (req: Request, res: Response) => {
  try {
    const contacts = await ContactUs.find().sort({ order: 1 });
    sendResponse(res, contacts, "Contacts retrieved successfully", STATUS_CODES.OK);
  } catch (error) {
    sendResponse(res, null, "Failed to retrieve contacts", STATUS_CODES.INTERNAL_SERVER_ERROR);
  }
};


export const getContactById = async (req: Request, res: Response): Promise<void> => {
  try {
    const contact = await ContactUs.findById(req.params.id);

    if (!contact) {
      sendResponse(res, null, "Contact not found", STATUS_CODES.NOT_FOUND);
      return;
    }

    sendResponse(res, contact, "Contact retrieved successfully", STATUS_CODES.OK);
  } catch (error) {
    sendResponse(res, null, "Failed to retrieve contact", STATUS_CODES.INTERNAL_SERVER_ERROR);
  }
};


export const updateContact = async (req: Request, res: Response): Promise<void> => {
  try {
    const contact = await ContactUs.findByIdAndUpdate(req.params.id, req.body, { new: true });

    if (!contact) {
      res.status(404).json({ success: false, message: "Contact not found" });
      return;
    }

    res.status(200).json({ success: true, data: contact });
  } catch (error) {
    res.status(500).json({ success: false, message: "Server error", error });
  }
};

export const deleteContact = async (req: Request, res: Response): Promise<void> => {
  try {
    const contact = await ContactUs.findByIdAndDelete(req.params.id);

    if (!contact) {
      res.status(404).json({ success: false, message: "Contact not found" });
      return;
    }

    res.status(200).json({ success: true, message: "Contact deleted successfully" });
  } catch (error) {
    res.status(500).json({ success: false, message: "Server error", error });
  }
};

// export const updateContact = async (req: Request, res: Response) => {
//   try {
//     const contactId = req.params.id;
//     const updatedContact = await ContactUs.findByIdAndUpdate(contactId, req.body, {
//       new: true,
//     });

//     if (!updatedContact) {
//       return sendResponse(res, null, "Contact not found", STATUS_CODES.NOT_FOUND);
//     }

//     sendResponse(res, updatedContact, "Contact updated successfully", STATUS_CODES.OK);
//   } catch (error) {
//     sendResponse(res, null, "Failed to update contact", STATUS_CODES.INTERNAL_SERVER_ERROR);
//   }
// };

// export const deleteContact = async (req: Request, res: Response) => {
//   try {
//     const contactId = req.params.id;
//     const deleted = await ContactUs.findByIdAndDelete(contactId);

//     if (!deleted) {
//       return sendResponse(res, null, "Contact not found", STATUS_CODES.NOT_FOUND);
//     }

//     sendResponse(res, null, "Contact deleted successfully", STATUS_CODES.OK);
//   } catch (error) {
//     sendResponse(res, null, "Failed to delete contact", STATUS_CODES.INTERNAL_SERVER_ERROR);
//   }
// };
