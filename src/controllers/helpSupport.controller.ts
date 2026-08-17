import { Request, Response } from "express";
import { AuthRequest } from "../middlewares/auth.middleware";
import { sendResponse } from "../utils/response";
import { STATUS_CODES } from "../config/constants";
import { HelpSupport } from "../models/helpSupport.model";
import { paginateQuery } from "../utils/paginate";

// Create Help & Support Ticket
export const createHelpSupport = async (req: AuthRequest, res: Response) => {
  try {
    const { title } = req.body;
    const user = req.user?.id;

    if (!title) {
      return sendResponse(
        res,
        null,
        req.t("support:titleRequired"),
        STATUS_CODES.BAD_REQUEST
      );
    }

    const ticket = await HelpSupport.create({
      user,

      title,
    });

    sendResponse(res, ticket, req.t("support:created"));
  } catch (error) {
    sendResponse(
      res,
      null,
      req.t("support:createFailed"),
      STATUS_CODES.INTERNAL_SERVER_ERROR
    );
  }
};

// Update status
export const updateHelpSupportStatus = async (
  req: AuthRequest,
  res: Response
) => {
  try {
    const { id } = req.params;
    const { status } = req.body;

    const validStatus = ["pending", "resolved", "inprogress"];
    if (!validStatus.includes(status)) {
      return sendResponse(
        res,
        null,
        req.t("support:invalidStatus"),
        STATUS_CODES.BAD_REQUEST
      );
    }

    const ticket = await HelpSupport.findByIdAndUpdate(
      id,
      { status },
      { new: true }
    );

    if (!ticket) {
      return sendResponse(res, null, req.t("support:notFound"), STATUS_CODES.NOT_FOUND);
    }

    sendResponse(res, ticket, req.t("support:statusUpdated"));
  } catch (error) {
    sendResponse(
      res,
      null,
      req.t("support:updateStatusFailed"),
      STATUS_CODES.INTERNAL_SERVER_ERROR
    );
  }
};

// Get all tickets by current user
export const getMyHelpSupportTickets = async (
  req: AuthRequest,
  res: Response
) => {
  try {
    const { id: userId, role } = req.user!;
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 10;

    const filter = role === "admin" ? {} : { user: userId };

    const query = HelpSupport.find(filter)
      .populate("user")
      .sort({ createdAt: -1 });

    const paginated = await paginateQuery(query, { page, limit });

    sendResponse(
      res,
      {
        queries: paginated.data,
        total: paginated.total,
        page: paginated.page,
        limit: paginated.limit,
      },
      req.t("support:retrieved")
    );
  } catch (error) {
    sendResponse(
      res,
      null,
      req.t("support:listFailed"),
      STATUS_CODES.INTERNAL_SERVER_ERROR
    );
  }
};

// Get Help & Support Ticket by ID
export const getHelpSupportById = async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;

    const ticket = await HelpSupport.findById(id).populate(
      "user",
      "name email"
    );

    if (!ticket) {
      return sendResponse(res, null, req.t("support:notFound"), STATUS_CODES.NOT_FOUND);
    }

    sendResponse(res, ticket, req.t("support:retrieved"));
  } catch (error) {
    sendResponse(
      res,
      null,
      req.t("support:retrieveFailed"),
      STATUS_CODES.INTERNAL_SERVER_ERROR
    );
  }
};

// Delete Help & Support Ticket by ID
export const deleteHelpSupportById = async (
  req: AuthRequest,
  res: Response
) => {
  try {
    const { id } = req.params;

    const ticket = await HelpSupport.findByIdAndDelete(id);

    if (!ticket) {
      return sendResponse(res, null, req.t("support:notFound"), STATUS_CODES.NOT_FOUND);
    }

    sendResponse(res, ticket, req.t("support:deleted"));
  } catch (error) {
    sendResponse(
      res,
      null,
      req.t("support:deleteFailed"),
      STATUS_CODES.INTERNAL_SERVER_ERROR
    );
  }
};
