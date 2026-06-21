import 'dotenv/config';
import { getCloudinary } from './src/config/cloudinary.js';

const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64'
);

const cloudinary = getCloudinary();
const result = await new Promise((resolve, reject) => {
  const stream = cloudinary.uploader.upload_stream(
    { folder: 'narangmandi', public_id: 'cloud-credential-test', transformation: [{ quality: 'auto', fetch_format: 'auto' }] },
    (err, res) => (err ? reject(err) : resolve(res))
  );
  stream.end(png);
});
console.log('UPLOAD OK ->', result.secure_url);

await cloudinary.uploader.destroy('narangmandi/cloud-credential-test');
console.log('Cleanup OK (test image deleted)');
