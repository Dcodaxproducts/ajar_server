import { Request, Response, NextFunction } from "express";
import { sendResponse } from "../utils/response";
import { STATUS_CODES } from "../config/constants";
import Role from "../models/employeeRole.model";
import { paginateQuery } from "../utils/paginate";

// Create Role
export const createRole = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const { name, permissions } = req.body;
    const formattedName = name.toLowerCase().replace(/\s+/g, "-");

    const existing = await Role.findOne({ name: formattedName });
    if (existing) {
      sendResponse(res, null, "Role already exists", STATUS_CODES.CONFLICT);
      return;
    }

    const role = new Role({
      name: formattedName,
      permissions,
    });
    await role.save();

    sendResponse(res, role, "Role created", STATUS_CODES.CREATED);
  } catch (err) {
    next(err);
  }
};

// Get All Roles
export const getAllRoles = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const { page = 1, limit = 10 } = req.query;

    const baseQuery = Role.find().sort({ createdAt: -1 });

    // Use pagination helper
    const { data: roles, total } = await paginateQuery(baseQuery, {
      page: Number(page),
      limit: Number(limit),
    });

    // Convert to plain objects
    const employeeRoles = roles.map((role: any) => role.toObject());

    sendResponse(
      res,
      {
        employeeRoles,
        total,
        page: Number(page),
        limit: Number(limit),
      },
      "Employee roles fetched successfully",
      STATUS_CODES.OK
    );
  } catch (error) {
    next(error);
  }
};

// Get Role by ID
export const getRoleById = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const { id } = req.params;
    const role = await Role.findById(id);

    if (!role) {
      sendResponse(res, null, "Role not found", STATUS_CODES.NOT_FOUND);
      return;
    }

    sendResponse(res, role, "Role fetched", STATUS_CODES.OK);
  } catch (err) {
    next(err);
  }
};

// Update Role
export const updateRole = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const { id } = req.params;
    const updates = req.body;

    if (updates.name) {
      updates.name = updates.name.toLowerCase().replace(/\s+/g, "-");
    }

    const role = await Role.findByIdAndUpdate(id, updates, { new: true });

    if (!role) {
      sendResponse(res, null, "Role not found", STATUS_CODES.NOT_FOUND);
      return;
    }

    sendResponse(res, role, "Role updated", STATUS_CODES.OK);
  } catch (err) {
    next(err);
  }
};

// Delete Role
export const deleteRole = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const { id } = req.params;
    const role = await Role.findByIdAndDelete(id);

    if (!role) {
      sendResponse(res, null, "Role not found", STATUS_CODES.NOT_FOUND);
      return;
    }

    sendResponse(res, role, "Role deleted", STATUS_CODES.OK);
  } catch (err) {
    next(err);
  }
};
