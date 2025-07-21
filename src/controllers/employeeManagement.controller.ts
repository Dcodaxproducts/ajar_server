import { Request, Response, NextFunction } from "express";
import mongoose from "mongoose";
import { Employee } from "../models/employeeManagement.model";
import { Zone } from "../models/zone.model";
import { Category } from "../models/category.model";
import { sendResponse } from "../utils/response";
import { STATUS_CODES } from "../config/constants";
import { paginateQuery } from "../utils/paginate";
import { Dropdown } from "../models/dropdown.model";
import { log } from "console";

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

    // Fetch all employees with pagination
    const employees = await Employee.find()
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit);

    let filteredData = employees;

    if (locale && employees.some((emp: any) => emp.languages?.length)) {
      // Filter and translate only if some employees have languages defined
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
            empObj.firstName =
              matchedLang.translations.firstName || empObj.firstName;
            empObj.lastName =
              matchedLang.translations.lastName || empObj.lastName;
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

    res.status(200).json({
      success: true,
      message: "Employees fetched successfully",
      employees: filteredData,
      totalPages: Math.ceil(totalCount / limit),
      currentPage: page,
    });
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
      return sendResponse(res, null, "Invalid Employee ID", STATUS_CODES.BAD_REQUEST);
    }

    const employee = await Employee.findById(id)
      .populate(["zones", "categories"])
      .lean();

    if (!employee) {
      return sendResponse(res, null, "Employee not found", STATUS_CODES.NOT_FOUND);
    }

    if (locale) {
      const matchedLang = employee.languages?.find(
        (lang: any) => lang.locale === locale
      );

      if (matchedLang?.translations) {
        const translated = { ...employee, ...matchedLang.translations };
        delete translated.languages;
        return sendResponse(
          res,
          translated,
          `Employee details for locale: ${locale}`,
          STATUS_CODES.OK
        );
      } else {
        return sendResponse(
          res,
          null,
          `No translations found for locale: ${locale}`,
          STATUS_CODES.NOT_FOUND
        );
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
      roles,
      permissions,
      setPermissions,
      images,
      address,
      language,
      languages,
      zones,
      categories,
    } = req.body;

    // 1. Check for duplicate email
    const existingEmail = await Employee.findOne({ email });
    if (existingEmail) {
      return sendResponse(res, null, "Email already exists", STATUS_CODES.CONFLICT);
    }

    // 2. Validate roles using dropdown
    if (roles && roles.length > 0) {
      const dropdown = await Dropdown.findOne({ name: "employeeRoles" }).lean();
      if (!dropdown) {
        return sendResponse(res, null, "Employee roles dropdown not found", STATUS_CODES.BAD_REQUEST);
      }

      const allowedRoles = dropdown.values.map((v) => v.value);
      const invalidRoles = roles.filter((role: string) => !allowedRoles.includes(role));
      if (invalidRoles.length > 0) {
        return sendResponse(
          res,
          null,
          `Invalid role(s): ${invalidRoles.join(", ")}. Allowed roles: ${allowedRoles.join(", ")}`,
          STATUS_CODES.BAD_REQUEST
        );
      }
    }

    // 3. Validate zones
    if (zones && zones.length > 0) {
      const validZones = await Zone.find({ _id: { $in: zones } }).select("_id").lean();
      const validZoneIds = validZones.map((z) => z._id.toString());
      const invalidZoneIds = zones.filter((z: string) => !validZoneIds.includes(z));
      if (invalidZoneIds.length > 0) {
        return sendResponse(res, null, `Invalid Zone IDs: ${invalidZoneIds.join(", ")}`, STATUS_CODES.BAD_REQUEST);
      }
    }

    // 4. Validate categories
    if (categories && categories.length > 0) {
      const validCategories = await Category.find({ _id: { $in: categories } }).select("_id").lean();
      const validCategoryIds = validCategories.map((c) => c._id.toString());
      const invalidCategoryIds = categories.filter((c: string) => !validCategoryIds.includes(c));
      if (invalidCategoryIds.length > 0) {
        return sendResponse(res, null, `Invalid Category IDs: ${invalidCategoryIds.join(", ")}`, STATUS_CODES.BAD_REQUEST);
      }
    }

    // 5. Save employee
    const newEmployee = new Employee({
      firstName,
      lastName,
      email,
      phone,
      password,
      confirmPassword,
      roles,
      permissions,
      setPermissions,
      images,
      address,
      language,
      languages,
      zones,
      categories,
    });

    await newEmployee.save();

    return sendResponse(res, newEmployee, "Employee created successfully", STATUS_CODES.CREATED);
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
      return sendResponse(res, null, "Invalid Employee ID", STATUS_CODES.BAD_REQUEST);
    }

    const employee = await Employee.findById(id);
    if (!employee) {
      return sendResponse(res, null, "Employee not found", STATUS_CODES.NOT_FOUND);
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
    console.log(`Attempting to delete employee with ID: ${id}`);
    
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return sendResponse(res, null, "Invalid Employee ID", STATUS_CODES.BAD_REQUEST);
    }

    console.log(`Deleting employee with ID: ${id}`);

    const employee = await Employee.findByIdAndDelete(id);
    if (!employee) {
      return sendResponse(res, null, "Employee not found", STATUS_CODES.NOT_FOUND);
    }

    sendResponse(res, employee, "Employee deleted", STATUS_CODES.OK);
  } catch (error) {
    next(error);
  }
};
