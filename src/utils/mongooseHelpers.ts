import mongoose from "mongoose";

// Check if ObjectId is valid and exists in DB
export const isValidObjectIdAndExists = async (
  id: string,
  model: mongoose.Model<any>
): Promise<boolean> => {
  if (!mongoose.Types.ObjectId.isValid(id)) return false;
  const doc = await model.findById(id);
  return !!doc;
};
