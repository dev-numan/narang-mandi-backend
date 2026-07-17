import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import {
  createContactMessage,
  listContactMessages,
  markContactMessageRead,
  deleteContactMessage,
  contactSchema,
} from '../controllers/contactController.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';

const router = Router();

// The form is public and unauthenticated — cap it so it can't be used to flood
// the table or relay spam.
const contactLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'بہت زیادہ پیغامات۔ براہِ کرم کچھ دیر بعد کوشش کریں۔' },
});

router.post('/', contactLimiter, validate(contactSchema), createContactMessage);

router.get('/', requireAuth, requireRole('admin'), listContactMessages);
router.put('/:id/read', requireAuth, requireRole('admin'), markContactMessageRead);
router.delete('/:id', requireAuth, requireRole('admin'), deleteContactMessage);

export default router;
