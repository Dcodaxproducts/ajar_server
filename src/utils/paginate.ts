import { Query } from "mongoose";

interface PaginateOptions {
  page?: number;
  limit?: number;
}
export const paginateQuery = async <T>(
  query: Query<T[], T>,
  options: PaginateOptions = {}
): Promise<{ data: T[]; total: number; page: number; limit: number }> => {
  const page = Math.max(1, options.page || 1);
  const limit = Math.max(1, options.limit || 10);
  const skip = (page - 1) * limit;

  const [data, total] = await Promise.all([
    query.clone().skip(skip).limit(limit).exec(),
    query.clone().countDocuments().exec(),
  ]);

  return { data, total, page, limit };
};
