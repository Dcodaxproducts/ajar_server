import { Request, Response, NextFunction } from "express";
import { Listing } from "../models/listing.model";
import mongoose from "mongoose";
import { sendResponse } from "../utils/response";
import { STATUS_CODES } from "../config/constants";

// Create New Listingexport

export const createNewListing = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const { categoryId, formId, fields, requiredDocuments } = req.body;

    const parsedFields = fields ? JSON.parse(fields) : [];
    const parsedDocs = requiredDocuments ? JSON.parse(requiredDocuments) : [];

    const fileMap: Record<string, string[]> = {};

    if (req.files && Array.isArray(req.files)) {
      req.files.forEach((file: Express.Multer.File) => {
        const fieldName = file.fieldname;
        const filePath = `/uploads/${file.filename}`;

        if (!fileMap[fieldName]) {
          fileMap[fieldName] = [];
        }

        fileMap[fieldName].push(filePath);
      });
    }

    console.log({ parsedFields, parsedDocs, fileMap });

    const formatedFields = parsedFields
      .map((field: any) => {
        let value: any = null;

        // Handle different types of value
        if (typeof field.value === "string" && field.value !== "") {
          try {
            value = JSON.parse(field.value);
          } catch {
            value = field.value; // fallback to raw string if not valid JSON
          }
        } else {
          value = field.value ?? null; // handles non-string, null, or undefined
        }

        // If there's a matching file, associate it with the field's value
        if ((value === null || value === "") && fileMap[field.name]) {
          const files = fileMap[field.name];
          value = files.length === 1 ? files[0] : files;
        }

        // Throw if required and still no value
        if ((value === null || value === undefined) && field.required) {
          throw new Error(`Missing value for field: ${field.name}`);
        }

        console.log({ field, value });

        return value !== null && value !== undefined
          ? { ...field, value }
          : null;
      })
      .filter(Boolean); // Remove null entries

    // formatedDocs.field is missing

    console.log({ formatedFields });

    // Map and format documents with file associations based on the name
    const formatedDocs = parsedDocs.map((doc: any) => {
      let value = null;
      try {
        value = doc.value && doc.value !== "" ? JSON.parse(doc.value) : null;
      } catch {
        value = null;
      }

      if (!value && fileMap[doc.name]) {
        const files = fileMap[doc.name];
        value = files.length === 1 ? files[0] : files;
      }

      // Ensure all required documents have a value
      if (value === null || value === undefined) {
        throw new Error(`Missing value for document: ${doc}`);
      }

      return { ...doc, value };
    });

    console.log({ formatedDocs, formatedFields });

    const newListing = new Listing({
      categoryId,
      formId,
      fields: formatedFields,
      requiredDocs: formatedDocs,
    });

    const savedListing = await newListing.save();

    res.status(201).json({
      success: true,
      message: "Listing created successfully",
      data: savedListing,
    });
  } catch (error) {
    console.error("Error creating listing:", error);
    next(error);
  }
};

// Get All Listings
export const getAllListings = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const listings = await Listing.find()

      .populate("fields.field")
      .select("-__v -requiredDocs -formId -categoryId");


    function getPrice(listing: any) {
      const {
        defaultPrice,
        dynamicPrice,
        dynamicPriceStarts,
        dynamicPriceEnds,
        currentDate,
      } = listing.fields;

      const now = new Date(currentDate);
      const start = new Date(dynamicPriceStarts);
      const end = new Date(dynamicPriceEnds);

      const isInRange = now >= start && now <= end;

      return isInRange ? Number(dynamicPrice) : Number(defaultPrice);
    }

    const filteredListings = listings.map((listing) => {
      const locationField = listing.fields.find(
        (field) => field.name === "location"
      );
      const featuresField = listing.fields.find(
        (field) => field.name === "features"
      );

      const title = listing.fields.find((field) => field.name === "title");
      const thumbnail = listing.fields.find(
        (field) => field.name === "thumbnail"
      );

      const checkboxFields = listing.fields.filter(
        (field: any) => field.field.flutterType === "checkbox"
      );

      const currentDate = new Date();

      const defaultPrice = listing.fields.find(
        (field) => field.name === "defaultPrice"
      );
      const dynamicPrice = listing.fields.find(
        (field) => field.name === "dynamicPrice"
      );
      const dynamicPriceRange = listing.fields.find(
        (field) => field.name === "dynamicPriceRange"
      );

      const dynamicPriceRangeValue = dynamicPriceRange?.value;
      const dynamicPriceStarts =
        Array.isArray(dynamicPriceRangeValue) &&
        dynamicPriceRangeValue.length > 0
          ? dynamicPriceRangeValue[0]
          : null;
      const dynamicPriceEnds =
        Array.isArray(dynamicPriceRangeValue) &&
        dynamicPriceRangeValue.length > 1
          ? dynamicPriceRangeValue[1]
          : null;

      const now = new Date(currentDate);
      const start = new Date(dynamicPriceStarts);
      const end = new Date(dynamicPriceEnds);

      const isInRange = now >= start && now <= end;
      console.log({ now, start, end, isInRange });

      const finalPrice = isInRange
        ? Number(dynamicPrice?.value ?? 0)
        : Number(defaultPrice?.value ?? 0);

      return {
        ...listing.toObject(),
        fields: {
          title: title ? title.value : null,
          thumbnail: thumbnail ? thumbnail.value : null,

          price: finalPrice,
          location:
            locationField &&
            typeof locationField.value === "object" &&
            "address" in locationField.value
              ? (locationField.value as { address: string }).address
              : null,
          features: featuresField ? featuresField.value : null,
          // into array of stings like checklist = ["a", "b", "c"]
          checklist: checkboxFields.map((field: any) => {
            return field.name;
          }),
        },
      };
    });

    res.status(200).json({
      success: true,
      message: "All listings fetched",
      data: filteredListings,
    });
  } catch (error) {
    next(error);
  }
};

// Get Listing Details
export const getListingDetails = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  const { id } = req.params;
  try {
    const listing = await Listing.findById(id)
      .populate("fields.field")
      .select("-__v -requiredDocs -categoryId -formId");

    if (!listing) {
      res.status(404).json({
        success: false,
        message: "Listing not found",
      });
      return;
    }

    const locationField = listing.fields.find(
      (field) => field.name === "location"
    );
    const featuresField = listing.fields.find(
      (field) => field.name === "features"
    );

    const title = listing.fields.find((field) => field.name === "title");
    const description = listing.fields.find(
      (field) => field.name === "description"
    );
    const thumbnail = listing.fields.find(
      (field) => field.name === "thumbnail"
    );

    const checkboxFields = listing.fields.filter(
      (field: any) => field.field.flutterType === "checkbox"
    );

    const currentDate = new Date();

    const defaultPrice = listing.fields.find(
      (field) => field.name === "defaultPrice"
    );
    const dynamicPrice = listing.fields.find(
      (field) => field.name === "dynamicPrice"
    );
    const dynamicPriceRange = listing.fields.find(
      (field) => field.name === "dynamicPriceRange"
    );

    const dynamicPriceRangeValue = dynamicPriceRange?.value;
    const dynamicPriceStarts =
      Array.isArray(dynamicPriceRangeValue) && dynamicPriceRangeValue.length > 0
        ? dynamicPriceRangeValue[0]
        : null;
    const dynamicPriceEnds =
      Array.isArray(dynamicPriceRangeValue) && dynamicPriceRangeValue.length > 1
        ? dynamicPriceRangeValue[1]
        : null;

    const now = new Date(currentDate);
    const start = new Date(dynamicPriceStarts);
    const end = new Date(dynamicPriceEnds);

    const isInRange = now >= start && now <= end;
    console.log({ now, start, end, isInRange });

    const finalPrice = isInRange
      ? Number(dynamicPrice?.value ?? 0)
      : Number(defaultPrice?.value ?? 0);

    const finalListing = {
      ...listing.toObject(),
      fields: {
        title: title ? title.value : null,
        description: description ? description.value : null,
        thumbnail: thumbnail ? thumbnail.value : null,
        price: finalPrice,
        location:
          locationField &&
          typeof locationField.value === "object" &&
          "address" in locationField.value
            ? (locationField.value as { address: string }).address
            : null,
        features: featuresField ? featuresField.value : null,
        checklist: checkboxFields.map((field: any) => {
          return field.name;
        }),
        /// all fields except title, location, features, checklist, thumbnail
        dynamicPrice: {
          startDate: dynamicPriceStarts,
          endDate: dynamicPriceEnds,
          value: dynamicPrice?.value,
        },
        otherFields: listing.fields.filter(
          (field) =>
            field.name !== "title" &&
            field.name !== "description" &&
            field.name !== "location" &&
            field.name !== "features" &&
            field.name !== "checklist" &&
            field.name !== "defaultPrice" &&
            field.name !== "dynamicPrice" &&
            field.name !== "dynamicPriceRange" &&
            field.name !== "thumbnail"
        ),
        // all fields except title, location, features, checklist, thumbnail
      },
    };

    sendResponse(
      res,
      finalListing,
      "Category details fetched successfully",
      STATUS_CODES.OK
    );
  } catch (error) {
    console.error("Error fetching listing details:", error);
    next(error);
  }
};

// Delete Listing
export const deleteListing = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const { id } = req.params;

    const deleted = await Listing.findByIdAndDelete(id);

    if (!deleted) {
      return res.status(404).json({
        success: false,
        message: "Listing not found",
      });
    }

    res.status(200).json({
      success: true,
      message: "Listing deleted successfully",
    });
  } catch (error) {
    next(error);
  }
};
