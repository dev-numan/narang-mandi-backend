import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { login, logout, me, updateMe, loginSchema, updateMeSchema } from '../controllers/authController.js';
import { requireAuth } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';

const router = Router();

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'Too many login attempts, try again later' },
});

router.post('/login', loginLimiter, validate(loginSchema), login);
router.post('/logout', requireAuth, logout);
router.get('/me', requireAuth, me);
router.put('/me', requireAuth, validate(updateMeSchema), updateMe);

export default router;
