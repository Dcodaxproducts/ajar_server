import { Request, Response, NextFunction } from "express";
import mongoose from "mongoose";
import { Employee } from "../models/employeeManagement.model";
import { Zone } from "../models/zone.model";
import { Category } from "../models/category.model";
import { sendResponse } from "../utils/response";
import { STATUS_CODES } from "../config/constants";
import { Dropdown } from "../models/dropdown.model";

// Get all employees
export const getAllEmployees = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const locale = req.headers["language"] as string; 
    const page = Number(req.query.page) || 1;
    const limit = Number(req.query.limit) || 10;
    const skip = (page - 1) * limit;

    const employees = await Employee.find()
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit);

    let filteredData = employees;

    if (locale && employees.some((emp: any) => emp.languages?.length)) {
      filteredData = employees
        .filter((employee: any) =>
          employee.languages?.some((lang: any) => lang.locale === locale)
        )
        .map((employee: any) => {
          const matchedLang = employee.languages.find(
            (lang: any) => lang.locale === locale
          );
          const empObj = employee.toObject();
          if (matchedLang?.translations) {
            empObj.firstName = matchedLang.translations.firstName || empObj.firstName;
            empObj.lastName = matchedLang.translations.lastName || empObj.lastName;
          }
          delete empObj.languages;
          return empObj;
        });
    } else {
      filteredData = employees.map((emp: any) => {
        const empObj = emp.toObject();
        delete empObj.languages;
        return empObj;
      });
    }

    const totalCount = await Employee.countDocuments();

    sendResponse(res, {
      success: true,
      message: "Employees fetched successfully",
      employees: filteredData,
      totalPages: Math.ceil(totalCount / limit),
      currentPage: page,
    }, "Employees fetched successfully", STATUS_CODES.OK);
  } catch (error) {
    next(error);
  }
};

// Get employee by ID
export const getEmployeeById = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const { id } = req.params;
    const locale = req.headers["language"]?.toString() || null;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      sendResponse(res, null, "Invalid Employee ID", STATUS_CODES.BAD_REQUEST);
      return;
    }

    const employee = await Employee.findById(id)
      .populate(["zones", "categories"])
      .lean();

    if (!employee) {
      sendResponse(res, null, "Employee not found", STATUS_CODES.NOT_FOUND);
      return;
    }

    if (locale) {
      const matchedLang = employee.languages?.find(
        (lang: any) => lang.locale === locale
      );

      if (matchedLang?.translations) {
        const translated = { ...employee, ...matchedLang.translations };
        delete translated.languages;
        sendResponse(
          res,
          translated,
          `Employee details for locale: ${locale}`,
          STATUS_CODES.OK
        );
        return;
      } else {
        sendResponse(
          res,
          null,
          `No translations found for locale: ${locale}`,
          STATUS_CODES.NOT_FOUND
        );
        return;
      }
    }

    sendResponse(res, employee, "Employee details fetched", STATUS_CODES.OK);
  } catch (error) {
    next(error);
  }
};

// Create employee
export const createEmployee = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const {
      firstName,
      lastName,
      email,
      phone,
      password,
      confirmPassword,
      staffRoles,
      permissions,
      images,
      address,
      language,
      languages,
      zones,
      categories,
    } = req.body;

    const existingEmail = await Employee.findOne({ email });
    if (existingEmail) {
      sendResponse(res, null, "Email already exists", STATUS_CODES.CONFLICT);
      return;
    }

    if (staffRoles && staffRoles.length > 0) {
      const dropdown = await Dropdown.findOne({ name: "employeestaffRoles" }).lean();
      if (!dropdown) {
        sendResponse(res, null, "Employee staffRoles dropdown not found", STATUS_CODES.BAD_REQUEST);
        return;
      }

      const allowedstaffRoles = dropdown.values.map((v) => v.value);
      const invalidstaffRoles = staffRoles.filter((role: string) => !allowedstaffRoles.includes(role));
      if (invalidstaffRoles.length > 0) {
        sendResponse(
          res,
          null,
          `Invalid role(s): ${invalidstaffRoles.join(", ")}. Allowed staffRoles: ${allowedstaffRoles.join(", ")}`,
          STATUS_CODES.BAD_REQUEST
        );
        return;
      }
    }

    if (zones && zones.length > 0) {
      const validZones = await Zone.find({ _id: { $in: zones } }).select("_id").lean();
      const validZoneIds = validZones.map((z) => z._id.toString());
      const invalidZoneIds = zones.filter((z: string) => !validZoneIds.includes(z));
      if (invalidZoneIds.length > 0) {
        sendResponse(res, null, `Invalid Zone IDs: ${invalidZoneIds.join(", ")}`, STATUS_CODES.BAD_REQUEST);
        return;
      }
    }

    if (categories && categories.length > 0) {
      const validCategories = await Category.find({ _id: { $in: categories } }).select("_id").lean();
      const validCategoryIds = validCategories.map((c) => c._id.toString());
      const invalidCategoryIds = categories.filter((c: string) => !validCategoryIds.includes(c));
      if (invalidCategoryIds.length > 0) {
        sendResponse(res, null, `Invalid Category IDs: ${invalidCategoryIds.join(", ")}`, STATUS_CODES.BAD_REQUEST);
        return;
      }
    }

    const newEmployee = new Employee({
      firstName,
      lastName,
      email,
      phone,
      password,
      confirmPassword,
      staffRoles,
      permissions,
      images,
      address,
      language,
      languages,
      zones,
      categories,
    });

    await newEmployee.save();

    sendResponse(res, newEmployee, "Employee created successfully", STATUS_CODES.CREATED);
  } catch (error) {
    next(error);
  }
};

// Update employee
export const updateEmployee = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      sendResponse(res, null, "Invalid Employee ID", STATUS_CODES.BAD_REQUEST);
      return;
    }

    const employee = await Employee.findById(id);
    if (!employee) {
      sendResponse(res, null, "Employee not found", STATUS_CODES.NOT_FOUND);
      return;
    }

    Object.assign(employee, req.body);
    await employee.save();

    sendResponse(res, employee, "Employee updated", STATUS_CODES.OK);
  } catch (error) {
    next(error);
  }
};

// Delete employee
export const deleteEmployee = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const { id } = req.params;
    
    if (!mongoose.Types.ObjectId.isValid(id)) {
      sendResponse(res, null, "Invalid Employee ID", STATUS_CODES.BAD_REQUEST);
      return;
    }

    const employee = await Employee.findByIdAndDelete(id);
    if (!employee) {
      sendResponse(res, null, "Employee not found", STATUS_CODES.NOT_FOUND);
      return;
    }

    sendResponse(res, employee, "Employee deleted", STATUS_CODES.OK);
  } catch (error) {
    next(error);
  }
};