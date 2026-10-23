const DUPLICATE_KEY_ERROR_CODE = 11000;

/** Lỗi `E11000 duplicate key` của MongoDB (kể cả khi bị bọc trong lỗi bulk/transaction). */
export const isDuplicateKeyError = (error: unknown): boolean => {
  if (typeof error !== 'object' || error === null) return false;
  const { code, writeErrors } = error as {
    code?: unknown;
    writeErrors?: Array<{ code?: unknown }>;
  };
  if (code === DUPLICATE_KEY_ERROR_CODE) return true;
  return (
    Array.isArray(writeErrors) &&
    writeErrors.some((item) => item?.code === DUPLICATE_KEY_ERROR_CODE)
  );
};
