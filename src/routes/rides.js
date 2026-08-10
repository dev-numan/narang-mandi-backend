import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { validate } from '../middleware/validate.js';
import {
  acceptBid,
  acceptBidSchema,
  cancelRide,
  cancelRideSchema,
  createRide,
  createRideSchema,
  lookupRide,
  lookupRideSchema,
  rideDrivers,
  rideDriversSchema,
} from '../controllers/rideController.js';

const router = Router();

// Posting a ride is costlier than an order — it wakes every driver in town.
const createLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'بہت زیادہ درخواستیں۔ تھوڑی دیر بعد کوشش کریں۔' },
});

// A code + phone pair is guessable given enough tries; this is what makes it not.
const lookupLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'بہت زیادہ کوششیں۔ تھوڑی دیر بعد کوشش کریں۔' },
});

const actionLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'بہت زیادہ درخواستیں۔ تھوڑی دیر بعد کوشش کریں۔' },
});

// Static segments first — a `/:rideCode` route registered above would swallow
// `/lookup`. Everything is POST so the phone never reaches a URL, an access log
// or a Referer header, and there is deliberately no GET /:rideCode.
router.post('/', createLimiter, validate(createRideSchema), createRide);
router.post('/lookup', lookupLimiter, validate(lookupRideSchema), lookupRide);
router.post('/:rideCode/accept', actionLimiter, validate(acceptBidSchema), acceptBid);
router.post('/:rideCode/drivers', actionLimiter, validate(rideDriversSchema), rideDrivers);
router.post('/:rideCode/cancel', actionLimiter, validate(cancelRideSchema), cancelRide);

export default router;
