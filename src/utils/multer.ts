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

const upload = multer({ storage });

export default upload;
