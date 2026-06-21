import { asyncHandler, ApiError } from '../utils/asyncHandler.js';
import { fileToUrl } from '../middleware/upload.js';

// POST /api/upload  (field name: "image")
export const uploadImage = asyncHandler(async (req, res) => {
  if (!req.file) throw new ApiError(400, 'No image uploaded (field name must be "image")');
  const url = await fileToUrl(req, req.file);
  res.status(201).json({ success: true, data: { url }, message: 'Uploaded' });
});
