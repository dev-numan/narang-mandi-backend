import { Router } from 'express';
import {
  verifyWhatsappWebhook,
  receiveWhatsappWebhook,
} from '../controllers/webhookController.js';

const router = Router();

/**
 * Provider callbacks.
 *
 * Deliberately unauthenticated and un-rate-limited: Meta calls these with its
 * own signature and will back off and eventually disable a subscription that
 * starts returning 429. The POST is authenticated by its HMAC instead, and the
 * GET only ever echoes a challenge.
 */
router.get('/whatsapp', verifyWhatsappWebhook);
router.post('/whatsapp', receiveWhatsappWebhook);

export default router;
