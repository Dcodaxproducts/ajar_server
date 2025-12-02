import multer from "multer";
import path from "path";
import fs from "fs";
import { Request, Response, NextFunction } from "express";

const chatUploadDir = path.join(__dirname, "../../public/chat");
fs.mkdirSync(chatUploadDir, { recursive: true });

const sanitizeFileName = (filename: string) => {
  const name = path.parse(filename).name.replace(/[^a-zA-Z0-9-_]/g, "");
  const ext = path.extname(filename);
  return `${name}${ext}`;
};

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, chatUploadDir),
  filename: (_req, file, cb) => {
    const safeName = sanitizeFileName(file.originalname);
    cb(null, `${Date.now()}-${safeName}`);
  },
});

export const chatUpload = multer({
  storage,
  limits: { fileSize: 15 * 1024 * 1024 },
}).array("attachments", 10);
