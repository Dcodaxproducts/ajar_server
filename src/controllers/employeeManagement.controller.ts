import { Request, Response, NextFunction } from "express";
import mongoose from "mongoose";
import { Employee } from "../models/employeeManagement.model";
import { sendResponse } from "../utils/response";
import { STATUS_CODES } from "../config/constants";
import Role from "../models/employeeRole.model";
import { paginateQuery } from "../utils/paginate";

// Create employee
export const createEmployee = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    console.log("Incoming request body:", req.body);
    console.log("Incoming files:", req.files);

    const {
      name,
      email,
      phone,
      password,
      allowAccess,
      address,
      language,
      languages,
    } = req.body;

    console.log("Extracted fields:", { name, email, phone, allowAccess });

    const existingEmail = await Employee.findOne({ email });
    if (existingEmail) {
      console.warn("Email already exists:", email);
      sendResponse(res, null, "Email already exists", STATUS_CODES.CONFLICT);
      return;
    }

    // Validate allowAccess as Role ObjectId
    if (allowAccess) {
      console.log("Checking Role ID:", allowAccess);
      const roleExists = await Role.findById(allowAccess).lean();
      if (!roleExists) {
        console.error("Invalid Role ID:", allowAccess);
        sendResponse(
          res,
          null,
          `Invalid Role ID: ${allowAccess}`,
          STATUS_CODES.BAD_REQUEST
        );
        return;
      }
    }

    const files = req.files as
      | { [fieldname: string]: { filename: string }[] }
      | undefined;

    console.log("📸 Multer processed files:", files);

    const images = Array.isArray(files?.images)
      ? files!.images.map((file) => `/uploads/${file.filename}`)
      : [];

    const profileImage = files?.profileImage?.[0]
      ? `/uploads/${files.profileImage[0].filename}`
      : undefined;

    console.log("Final images:", images);
    console.log("Final profileImage:", profileImage);

    const newEmployee = new Employee({
      name,
      email,
      phone,
      password,
      allowAccess,
      images,
      profileImage,
      address,
      language,
      languages,
    });

    await newEmployee.save();
    console.log("Employee saved successfully:", newEmployee._id);

    sendResponse(
      res,
      newEmployee,
      "Employee created successfully",
      STATUS_CODES.CREATED
    );
  } catch (error) {
    console.error("Error in createEmployee:", error);
    next(error);
  }
};

// Get all employees
export const getAllEmployees = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const { page = 1, limit = 10 } = req.query;
    const languageHeader = req.headers["language"];
    const locale = languageHeader?.toString() || null;

    const baseQuery = Employee.find()
      .sort({ createdAt: -1 })
      .populate("allowAccess", "name permissions");

    const { data: employees, total } = await paginateQuery(baseQuery, {
      page: Number(page),
      limit: Number(limit),
    });

    let filteredData = employees;

    // Apply locale translations
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
            empObj.name = matchedLang.translations.name || empObj.name;
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

    sendResponse(
      res,
      {
        employees: filteredData,
        total,
        page: Number(page),
        limit: Number(limit),
      },
      `Employees fetched successfully${locale ? ` for locale: ${locale}` : ""}`,
      STATUS_CODES.OK
    );
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
      .populate("allowAccess", "name permissions")
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

// Update employee
export const updateEmployee = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const { id } = req.params;
    const { allowAccess } = req.body;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      sendResponse(res, null, "Invalid Employee ID", STATUS_CODES.BAD_REQUEST);
      return;
    }

    const employee = await Employee.findById(id);
    if (!employee) {
      sendResponse(res, null, "Employee not found", STATUS_CODES.NOT_FOUND);
      return;
    }

    // Validate allowAccess
    if (allowAccess) {
      const roleExists = await Role.findById(allowAccess).lean();
      if (!roleExists) {
        sendResponse(
          res,
          null,
          `Invalid Role ID: ${allowAccess}`,
          STATUS_CODES.BAD_REQUEST
        );
        return;
      }
    }

    if (
      req.body.status &&
      !["active", "inactive", "blocked"].includes(req.body.status)
    ) {
      sendResponse(
        res,
        null,
        "Invalid status value. Must be 'active', 'inactive', or 'blocked'.",
        STATUS_CODES.BAD_REQUEST
      );
      return;
    }

    // First apply body updates
    Object.assign(employee, req.body);

    // Then override with any uploaded files (so files win over body)
    const files = req.files as
      | { [fieldname: string]: { filename: string }[] }
      | undefined;

    const imagesFromUpload = Array.isArray(files?.images)
      ? files!.images.map((file) => `/uploads/${file.filename}`)
      : [];

    const profileFromUpload = files?.profileImage?.[0]
      ? `/uploads/${files.profileImage[0].filename}`
      : undefined;

    if (imagesFromUpload.length) {
      employee.images = imagesFromUpload;
    }
    if (profileFromUpload) {
      employee.profileImage = profileFromUpload;
    }

    await employee.save();

    sendResponse(
      res,
      employee,
      "Employee updated successfully",
      STATUS_CODES.OK
    );
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
