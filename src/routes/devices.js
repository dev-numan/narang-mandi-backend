import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { registerDevice, registerDeviceSchema } from '../controllers/deviceController.js';
import { optionalAuth } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';

const router = Router();

// The app re-registers on launch and after login, so a real device makes a
// handful of calls a day. This only stops a script.
const deviceLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'بہت زیادہ درخواستیں' },
});

router.post('/', deviceLimiter, optionalAuth, validate(registerDeviceSchema), registerDevice);

export default router;
