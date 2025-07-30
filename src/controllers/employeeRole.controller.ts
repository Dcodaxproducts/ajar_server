import { Request, Response, NextFunction } from "express";
import { sendResponse } from "../utils/response";
import { STATUS_CODES } from "../config/constants";
import Role from "../models/employeeRole.model";

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
): Promise<void> => {
  try {
    const roles = await Role.find();
    sendResponse(res, roles, "Roles fetched", STATUS_CODES.OK);
  } catch (err) {
    next(err);
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
