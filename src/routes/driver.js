import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import {
  completeRide,
  driverStats,
  getMe,
  getRide,
  listMyRides,
  listOpenRides,
  placeBid,
  placeBidSchema,
  updateMe,
  updateMeSchema,
  withdrawBid,
} from '../controllers/driverController.js';

const router = Router();

const writeLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'بہت زیادہ درخواستیں۔ تھوڑی دیر بعد کوشش کریں۔' },
});

// Role gate at the router; every handler below then resolves the caller's own
// driver row, so a driver can only ever act as themselves.
router.use(requireAuth, requireRole('admin', 'driver'));

router.get('/me', getMe);
router.put('/me', writeLimiter, validate(updateMeSchema), updateMe);
router.get('/stats', driverStats);

// Static segments before `/rides/:id`.
router.get('/rides/open', listOpenRides);
router.get('/rides/mine', listMyRides);
router.get('/rides/:id', getRide);
router.post('/rides/:id/bid', writeLimiter, validate(placeBidSchema), placeBid);
router.delete('/rides/:id/bid', writeLimiter, withdrawBid);
router.post('/rides/:id/complete', writeLimiter, completeRide);

export default router;
