import { Request, Response, NextFunction } from "express";
import mongoose from "mongoose";
import { Employee } from "../models/employeeManagement.model";
import { Zone } from "../models/zone.model";
import { Category } from "../models/category.model";
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
    const {
      name,
      email,
      phone,
      password,
      confirmPassword,
      allowAccess,
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

    // Validate allowAccess as Role ObjectId
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

    // Zone & Category validation remains unchanged
    const validZones = zones?.length
      ? await Zone.find({ _id: { $in: zones } })
          .select("_id")
          .lean()
      : [];
    const invalidZoneIds = zones?.filter(
      (z: string) => !validZones.map((zone) => zone._id.toString()).includes(z)
    );
    if (invalidZoneIds?.length > 0) {
      sendResponse(
        res,
        null,
        `Invalid Zone IDs: ${invalidZoneIds.join(", ")}`,
        STATUS_CODES.BAD_REQUEST
      );
      return;
    }

    const validCategories = categories?.length
      ? await Category.find({ _id: { $in: categories } })
          .select("_id")
          .lean()
      : [];
    const invalidCategoryIds = categories?.filter(
      (c: string) =>
        !validCategories.map((cat) => cat._id.toString()).includes(c)
    );
    if (invalidCategoryIds?.length > 0) {
      sendResponse(
        res,
        null,
        `Invalid Category IDs: ${invalidCategoryIds.join(", ")}`,
        STATUS_CODES.BAD_REQUEST
      );
      return;
    }

    const newEmployee = new Employee({
      name,
      email,
      phone,
      password,
      confirmPassword,
      allowAccess,
      images,
      address,
      language,
      languages,
      zones,
      categories,
    });

    await newEmployee.save();
    sendResponse(
      res,
      newEmployee,
      "Employee created successfully",
      STATUS_CODES.CREATED
    );
  } catch (error) {
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

    // Use pagination helper
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

// export const getAllEmployees = async (
//   req: Request,
//   res: Response,
//   next: NextFunction
// ) => {
//   try {
//     const { page = 1, limit = 10 } = req.query;
//     const languageHeader = req.headers["language"];
//     const locale = languageHeader?.toString() || null;

//     const baseQuery = Employee.find()
//       .sort({ createdAt: -1 })
//       .populate("allowAccess", "name permissions");

//     // Use pagination helper
//     const { data: employees, total } = await paginateQuery(baseQuery, {
//       page: Number(page),
//       limit: Number(limit),
//     });

//     let filteredData = employees;

//     // Apply locale translations
//     if (locale && employees.some((emp: any) => emp.languages?.length)) {
//       filteredData = employees
//         .filter((employee: any) =>
//           employee.languages?.some((lang: any) => lang.locale === locale)
//         )
//         .map((employee: any) => {
//           const matchedLang = employee.languages.find(
//             (lang: any) => lang.locale === locale
//           );

//           const empObj = employee.toObject();

//           if (matchedLang?.translations) {
//             empObj.firstName =
//               matchedLang.translations.firstName || empObj.firstName;
//             empObj.lastName =
//               matchedLang.translations.lastName || empObj.lastName;
//           }

//           delete empObj.languages;
//           return empObj;
//         });
//     } else {
//       filteredData = employees.map((emp: any) => {
//         const empObj = emp.toObject();
//         delete empObj.languages;
//         return empObj;
//       });
//     }

//     sendResponse(
//       res,
//       {
//         employees: filteredData,
//         total,
//         page: Number(page),
//         limit: Number(limit),
//       },
//       `Employees fetched successfully${locale ? ` for locale: ${locale}` : ""}`,
//       STATUS_CODES.OK
//     );
//   } catch (error) {
//     next(error);
//   }
// };

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
    const { allowAccess, zones, categories } = req.body;

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

    //Validate zones
    if (zones && zones.length > 0) {
      const validZones = await Zone.find({ _id: { $in: zones } })
        .select("_id")
        .lean();
      const invalidZoneIds = zones.filter(
        (z: string) => !validZones.map((z) => z._id.toString()).includes(z)
      );
      if (invalidZoneIds.length > 0) {
        sendResponse(
          res,
          null,
          `Invalid Zone IDs: ${invalidZoneIds.join(", ")}`,
          STATUS_CODES.BAD_REQUEST
        );
        return;
      }
    }

    //Validate categories
    if (categories && categories.length > 0) {
      const validCategories = await Category.find({ _id: { $in: categories } })
        .select("_id")
        .lean();
      const invalidCategoryIds = categories.filter(
        (c: string) => !validCategories.map((c) => c._id.toString()).includes(c)
      );
      if (invalidCategoryIds.length > 0) {
        sendResponse(
          res,
          null,
          `Invalid Category IDs: ${invalidCategoryIds.join(", ")}`,
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

    Object.assign(employee, req.body);
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
