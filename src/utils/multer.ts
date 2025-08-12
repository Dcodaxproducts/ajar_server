// src/utils/multer.ts
import multer from "multer";
import path from "path";
import fs from "fs";

const uploadDir = path.join(__dirname, "../../public/uploads");
fs.mkdirSync(uploadDir, { recursive: true });

interface MulterFile extends Express.Multer.File {
  originalname: string;
  mimetype: string;
}

const sanitizeFileName = (filename: string) => {
  const name = path.parse(filename).name.replace(/[^a-zA-Z0-9-_]/g, "");
  const ext = path.extname(filename).toLowerCase();
  return `${name}${ext}`;
};

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadDir),
  filename: (_req, file: MulterFile, cb) => {
    const safeName = sanitizeFileName(file.originalname);
    cb(null, `${Date.now()}-${safeName}`);
  },
});

const upload = multer({
  storage,
  limits: {
    fileSize: 5 * 1024 * 1024, // 5MB limit
  },
  fileFilter: (req, file, cb) => {
    const allowedTypes = [
      "image/jpeg",
      "image/png",
      "image/webp",
      "images/jpeg",
      "images/png",
      "images/webp",
    ];
    if (allowedTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error("Only .jpeg, .jpg, .png, and .webp formats allowed"));
    }
  },
});

// Generic single file upload middleware
export const uploadFile = (fieldName: string) => upload.single(fieldName);

// Generic multiple files upload middleware
export const uploadFiles = (fieldNames: string[]) =>
  upload.fields(fieldNames.map((name) => ({ name, maxCount: 10 })));

export default upload;
