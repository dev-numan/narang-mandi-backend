import { Router } from 'express';
import {
  getSettings,
  updateSettings,
  settingsSchema,
} from '../controllers/settingsController.js';
import { requireAuth } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';

const router = Router();

router.get('/', getSettings);
// Editors are allowed in too, but the controller limits them to social links only.
router.put('/', requireAuth, validate(settingsSchema), updateSettings);

export default router;
