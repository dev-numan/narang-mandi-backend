import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import {
  listClassifieds,
  getClassified,
  submitClassified,
  markSoldByCode,
  listClassifiedCategories,
  classifiedSubmitSchema,
  markSoldSchema,
} from '../controllers/classifiedController.js';
import { uploadImage } from '../controllers/uploadController.js';
import { upload } from '../middleware/upload.js';
import { validate } from '../middleware/validate.js';

const router = Router();

// Light anti-spam on public writes. Reads are unlimited.
const writeLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'بہت زیادہ درخواستیں، براہِ کرم تھوڑی دیر بعد کوشش کریں' },
});
// Public image uploads — a bit tighter than text writes.
const uploadLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'بہت زیادہ تصاویر، براہِ کرم تھوڑی دیر بعد کوشش کریں' },
});
const markSoldLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'بہت زیادہ کوششیں، براہِ کرم تھوڑی دیر بعد کوشش کریں' },
});

router.get('/', listClassifieds);
router.get('/categories', listClassifiedCategories); // before /:slug
router.post('/mark-sold', markSoldLimiter, validate(markSoldSchema), markSoldByCode);
router.get('/:slug', getClassified);
router.post('/', writeLimiter, validate(classifiedSubmitSchema), submitClassified);
// Public, rate-limited image upload for ad photos (the /api/upload route is auth-only).
router.post('/upload', uploadLimiter, upload.single('image'), uploadImage);

export default router;
