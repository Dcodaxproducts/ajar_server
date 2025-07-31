import { Request, Response } from "express";
import { AuthRequest } from "../middlewares/auth.middleware";
import { sendResponse } from "../utils/response";
import { STATUS_CODES } from "../config/constants";
import { HelpSupport } from "../models/helpSupport.model";

// Create Help & Support Ticket
export const createHelpSupport = async (req: AuthRequest, res: Response) => {
  try {
    const { title } = req.body;
    const user = req.user?.id;
    

    if (!title) {
      return sendResponse(res, null, "Title is required", STATUS_CODES.BAD_REQUEST);
    }

    const ticket = await HelpSupport.create({
      user,
     
      title,
    });

    sendResponse(res, ticket, "Help & support ticket created successfully");
  } catch (error) {
    console.error(error);
    sendResponse(res, null, "Error creating ticket", STATUS_CODES.INTERNAL_SERVER_ERROR);
  }
};

// Update status
export const updateHelpSupportStatus = async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const { status } = req.body;

    const validStatus = ["pending", "resolved", "inprogress"];
    if (!validStatus.includes(status)) {
      return sendResponse(res, null, "Invalid status", STATUS_CODES.BAD_REQUEST);
    }

    const ticket = await HelpSupport.findByIdAndUpdate(
      id,
      { status },
      { new: true }
    );

    if (!ticket) {
      return sendResponse(res, null, "Ticket not found", STATUS_CODES.NOT_FOUND);
    }

    sendResponse(res, ticket, "Status updated successfully");
  } catch (error) {
    console.error(error);
    sendResponse(res, null, "Error updating status", STATUS_CODES.INTERNAL_SERVER_ERROR);
  }
};

// Get all tickets by current user
export const getMyHelpSupportTickets = async (req: AuthRequest, res: Response) => {
  try {
    const user = req.user?.id;

    const tickets = await HelpSupport.find({ user }).populate("user", "name email").sort({ createdAt: -1 });
    sendResponse(res, tickets, "Tickets retrieved successfully");
  } catch (error) {
    console.error(error);
    sendResponse(res, null, "Error retrieving tickets", STATUS_CODES.INTERNAL_SERVER_ERROR);
  }
};

// Get Help & Support Ticket by ID
export const getHelpSupportById = async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;

    const ticket = await HelpSupport.findById(id).populate("user", "name email");;

    if (!ticket) {
      return sendResponse(res, null, "Ticket not found", STATUS_CODES.NOT_FOUND);
    }

    sendResponse(res, ticket, "Ticket retrieved successfully");
  } catch (error) {
    console.error(error);
    sendResponse(res, null, "Error retrieving ticket", STATUS_CODES.INTERNAL_SERVER_ERROR);
  }
};

// Delete Help & Support Ticket by ID
export const deleteHelpSupportById = async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;

    const ticket = await HelpSupport.findByIdAndDelete(id);

    if (!ticket) {
      return sendResponse(res, null, "Ticket not found", STATUS_CODES.NOT_FOUND);
    }

    sendResponse(res, ticket, "Ticket deleted successfully");
  } catch (error) {
    console.error(error);
    sendResponse(res, null, "Error deleting ticket", STATUS_CODES.INTERNAL_SERVER_ERROR);
  }
};
