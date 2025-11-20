import multer from "multer";
import path from "path";
import fs from "fs";
import { Request, Response, NextFunction } from "express";

// Create chat upload folder if it doesn't exist
const chatUploadDir = path.join(__dirname, "../../public/chat");
fs.mkdirSync(chatUploadDir, { recursive: true });

// Sanitize filenames
const sanitizeFileName = (filename: string) => {
  const name = path.parse(filename).name.replace(/[^a-zA-Z0-9-_]/g, "");
  const ext = path.extname(filename);
  return `${name}${ext}`;
};

// Multer storage
const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, chatUploadDir),
  filename: (_req, file, cb) => {
    const safeName = sanitizeFileName(file.originalname);
    cb(null, `${Date.now()}-${safeName}`);
  },
});

// Multer upload instance (accept multiple files under "attachments")
const upload = multer({
  storage,
  limits: { fileSize: 15 * 1024 * 1024 }, // 15MB per file
}).array("attachments", 10);

// Extend Express Request interface to include attachments
interface ChatRequest extends Request {
  body: {
    chatId?: string;
    receiver?: string;
    text?: string;
    attachments?: string[]; // added here
    [key: string]: any;
  };
}

// Middleware wrapper with proper types
const chatUploadMiddleware = (
  req: ChatRequest,
  res: Response,
  next: NextFunction
) => {
  upload(req, res, (err: any) => {
    if (err) return next(err);

    // Convert uploaded files to URLs for controller
    if (req.files) {
      req.body.attachments = (req.files as Express.Multer.File[]).map(
        (file) => `/public/chat/${file.filename}`
      );
    }

    next();
  });
};

export default chatUploadMiddleware;
