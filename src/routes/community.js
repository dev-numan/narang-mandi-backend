import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import {
  listThreads,
  createThread,
  getThread,
  postMessage,
  toggleReaction,
  threadSchema,
  messageSchema,
  reactionSchema,
} from '../controllers/communityController.js';
import { validate } from '../middleware/validate.js';

const router = Router();

// Light anti-spam: cap writes per IP. Reads are unlimited.
const writeLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'بہت زیادہ درخواستیں، براہِ کرم تھوڑی دیر بعد کوشش کریں' },
});

router.get('/threads', listThreads);
router.post('/threads', writeLimiter, validate(threadSchema), createThread);
router.get('/threads/:slug', getThread);
router.post('/threads/:slug/messages', writeLimiter, validate(messageSchema), postMessage);
router.post('/messages/:id/reactions', writeLimiter, validate(reactionSchema), toggleReaction);

export default router;
