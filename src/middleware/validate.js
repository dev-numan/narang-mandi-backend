import { ApiError } from '../utils/asyncHandler.js';

// Validates req.body against a Zod schema; replaces body with parsed data.
export function validate(schema) {
  return (req, res, next) => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      const msg = result.error.issues
        .map((i) => `${i.path.join('.')}: ${i.message}`)
        .join('; ');
      return next(new ApiError(400, msg));
    }
    req.body = result.data;
    next();
  };
}
