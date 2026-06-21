import { v2 as cloudinary } from 'cloudinary';

let configured = false;

export function getCloudinary() {
  if (!configured) {
    const { CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET } = process.env;
    const missing = [
      ['CLOUDINARY_CLOUD_NAME', CLOUDINARY_CLOUD_NAME],
      ['CLOUDINARY_API_KEY', CLOUDINARY_API_KEY],
      ['CLOUDINARY_API_SECRET', CLOUDINARY_API_SECRET],
    ]
      .filter(([, v]) => !v)
      .map(([k]) => k);
    if (missing.length) {
      throw new Error(
        `Cloudinary storage is enabled (STORAGE_DRIVER=cloudinary) but missing env vars: ${missing.join(
          ', '
        )}. Set them or switch STORAGE_DRIVER back to "local".`
      );
    }
    cloudinary.config({
      cloud_name: CLOUDINARY_CLOUD_NAME,
      api_key: CLOUDINARY_API_KEY,
      api_secret: CLOUDINARY_API_SECRET,
    });
    configured = true;
  }
  return cloudinary;
}
