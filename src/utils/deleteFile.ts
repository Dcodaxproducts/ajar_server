import fs from "fs";

const deleteFile = (filePath: string) => {
  fs.unlink(filePath, (err) => {
    if (err) console.error("Failed to delete file:", err);
  });
};

export default deleteFile;
