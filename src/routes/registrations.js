import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import {
  createRegistration,
  listRegistrations,
  markRegistrationRead,
  deleteRegistration,
  registrationSchema,
} from '../controllers/registrationController.js';
import { uploadImage } from '../controllers/uploadController.js';
import { upload } from '../middleware/upload.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';

const router = Router();

// The banners are public and unauthenticated — cap submissions so the table
// can't be flooded.
const registerLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 8,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'بہت زیادہ درخواستیں۔ براہِ کرم کچھ دیر بعد کوشش کریں۔' },
});
// Public, rate-limited image upload for the optional vehicle/shop photo
// (the /api/upload route is auth-only).
const uploadLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'بہت زیادہ تصاویر، براہِ کرم تھوڑی دیر بعد کوشش کریں' },
});

router.post('/', registerLimiter, validate(registrationSchema), createRegistration);
router.post('/upload', uploadLimiter, upload.single('image'), uploadImage);

router.get('/', requireAuth, requireRole('admin', 'editor'), listRegistrations);
router.put('/:id/read', requireAuth, requireRole('admin'), markRegistrationRead);
router.delete('/:id', requireAuth, requireRole('admin'), deleteRegistration);

export default router;
