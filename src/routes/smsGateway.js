import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { validate } from '../middleware/validate.js';
import {
  getHealth,
  getOutbox,
  postStatus,
  statusSchema,
} from '../controllers/smsGatewayController.js';

const router = Router();

// The gateway polls on a short interval and reports one status per message, so
// the ceiling is generous — but it is a ceiling, which the AltCabs original
// lacked entirely. A key that starts being brute-forced hits this first.
const gatewayLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 120,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'Too many requests' },
});

router.use(gatewayLimiter);

// Collect queued messages. Claims them in the same transaction that reads them.
router.get('/outbox', getOutbox);

// Report what the handset did with one message.
router.post('/status', validate(statusSchema), postStatus);

// Queue depth and last successful send, for checking the phone is still alive.
router.get('/health', getHealth);

export default router;
