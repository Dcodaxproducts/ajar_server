// controllers/faq.controller.ts
import { Request, Response, NextFunction } from "express";
import { FAQ } from "../models/faq.model";
import asyncHandler from "express-async-handler";
import { sendResponse } from "../utils/response";
import { STATUS_CODES } from "../config/constants";

// Create FAQ
export const createFAQ = asyncHandler(async (req: Request, res: Response) => {
  const { question, answer } = req.body;
  const faq = await FAQ.create({ question, answer });

  sendResponse(res, faq, "FAQ created successfully", STATUS_CODES.CREATED);
});

// Get all FAQs
export const getAllFAQs = asyncHandler(async (req: Request, res: Response) => {
  const faqs = await FAQ.find();
  sendResponse(res, faqs, "FAQs fetched successfully", STATUS_CODES.OK);
});

// Get single FAQ by ID
export const getFAQById = asyncHandler(async (req: Request, res: Response) => {
  const faq = await FAQ.findById(req.params.id);
  if (!faq) {
    res.status(404);
    throw new Error("FAQ not found");
  }
  sendResponse(res, faq, "FAQ fetched successfully", STATUS_CODES.OK);
});

// Update FAQ
export const updateFAQ = asyncHandler(async (req: Request, res: Response) => {
  const faq = await FAQ.findByIdAndUpdate(req.params.id, req.body, {
    new: true,
  });

  if (!faq) {
    res.status(404);
    throw new Error("FAQ not found");
  }

  sendResponse(res, faq, "FAQ updated successfully", STATUS_CODES.OK);
});

// Delete FAQ
export const deleteFAQ = asyncHandler(async (req: Request, res: Response) => {
  const faq = await FAQ.findByIdAndDelete(req.params.id);
  if (!faq) {
    res.status(404);
    throw new Error("FAQ not found");
  }
  sendResponse(res, faq, "FAQ deleted successfully", STATUS_CODES.OK);
});
