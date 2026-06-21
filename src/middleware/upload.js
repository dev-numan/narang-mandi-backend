import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import multer from 'multer';
import { getCloudinary } from '../config/cloudinary.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const UPLOAD_DIR = path.join(__dirname, '..', '..', 'uploads');

const isCloudinary = () => process.env.STORAGE_DRIVER === 'cloudinary';

const fileFilter = (req, file, cb) => {
  if (/^image\/(png|jpe?g|webp|gif|avif)$/.test(file.mimetype)) cb(null, true);
  else cb(new Error('Only image files are allowed'), false);
};

function buildStorage() {
  if (isCloudinary()) {
    // Keep file in memory, then stream the buffer to Cloudinary in the helper.
    return multer.memoryStorage();
  }
  if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });
  return multer.diskStorage({
    destination: (req, file, cb) => cb(null, UPLOAD_DIR),
    filename: (req, file, cb) => {
      const ext = path.extname(file.originalname).toLowerCase() || '.jpg';
      const name = `${Date.now()}-${Math.round(Math.random() * 1e9)}${ext}`;
      cb(null, name);
    },
  });
}

export const upload = multer({
  storage: buildStorage(),
  fileFilter,
  limits: { fileSize: 8 * 1024 * 1024 }, // 8 MB
});

// Returns the public URL for an uploaded file regardless of storage driver.
export async function fileToUrl(req, file) {
  if (isCloudinary()) {
    const cloudinary = getCloudinary();
    const result = await new Promise((resolve, reject) => {
      const stream = cloudinary.uploader.upload_stream(
        { folder: 'narangmandi', transformation: [{ quality: 'auto', fetch_format: 'auto' }] },
        (err, res) => (err ? reject(err) : resolve(res))
      );
      stream.end(file.buffer);
    });
    return result.secure_url;
  }
  const base = process.env.PUBLIC_URL || `${req.protocol}://${req.get('host')}`;
  return `${base}/uploads/${file.filename}`;
}
