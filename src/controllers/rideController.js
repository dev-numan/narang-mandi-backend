import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import prisma, { runTransaction } from '../lib/prisma.js';
import { asyncHandler, ApiError } from '../utils/asyncHandler.js';
import { uniqueNumericCode } from '../utils/code.js';
import { normalizePhone } from '../utils/phone.js';
import {
  DRIVER_CONTACT,
  DRIVER_PUBLIC,
  serializeBid,
  serializeDriverContact,
  serializeRideForCustomer,
} from '../lib/serialize.js';
import { emitRide, emitToDriver } from '../lib/socket.js';
import { notifyNewRide, notifyRideAssigned, notifyRideCancelled } from '../lib/notify/rides.js';

/// How long a request stays biddable before it closes itself. Long enough for a
/// driver to notice, short enough that yesterday's rides are not on the board.
const RIDE_TTL_MS = 2 * 60 * 60 * 1000;

/// How long drivers get the request to themselves before the customer is handed
/// their numbers. Short enough that nobody waits around; long enough that a
/// driver who is mid-fare can still answer. Enforced here as well as counted
/// down in the UI, so the head start is real and not decorative.
export const BID_WINDOW_MS = 4 * 60 * 1000;

/// A phone may hold this many open requests at once. Set high enough that a
/// real customer never meets it — someone booking a car and a rickshaw at the
/// same time is normal — while still bounding what one person can do in a loop.
/// Guests have no account to ban, and every posted ride now costs a billable
/// WhatsApp message to each active driver, so the ceiling stays.
const MAX_OPEN_PER_PHONE = 20;

const generateRideCode = () => uniqueNumericCode(prisma.ride, 'rideCode');

/**
 * Rides expire on read rather than on a schedule: this codebase runs no cron,
 * and a single indexed write on the way past is cheaper than the infrastructure
 * a scheduler would need. Called by both the driver board and customer lookup,
 * so a ride cannot linger unless nobody is looking at all.
 */
export async function sweepExpiredRides() {
  return prisma.ride.updateMany({
    where: { status: 'open', expiresAt: { lt: new Date() } },
    data: { status: 'cancelled', cancelledAt: new Date(), cancelledBy: 'system' },
  });
}

// ---------------------------------------------------------------- Guest routes

export const createRideSchema = z.object({
  customerName: z.string().trim().min(1).max(80),
  customerPhone: z.string().trim().min(7).max(40),
  pickupText: z.string().trim().min(1).max(200),
  dropoffText: z.string().trim().min(1).max(200),
  whenText: z.string().trim().max(80).optional().default(''),
  note: z.string().trim().max(500).optional().default(''),
  deviceToken: z.string().max(4096).optional(),
});

export const createRide = asyncHandler(async (req, res) => {
  const { customerName, customerPhone, pickupText, dropoffText, whenText, note, deviceToken } =
    req.body;
  const phone = normalizePhone(customerPhone);

  const rideCode = await generateRideCode();
  const accessToken = randomBytes(16).toString('hex');

  const ride = await runTransaction(async (tx) => {
    const open = await tx.ride.count({ where: { customerPhone: phone, status: 'open' } });
    if (open >= MAX_OPEN_PER_PHONE) {
      throw new ApiError(400, 'آپ کی پہلے سے درخواستیں موجود ہیں۔ پہلے انہیں مکمل یا منسوخ کریں۔');
    }
    const created = await tx.ride.create({
      data: {
        rideCode,
        accessToken,
        customerName,
        customerPhone: phone,
        pickupText,
        dropoffText,
        whenText,
        note,
        deviceToken: deviceToken || null,
        ip: req.ip || '',
        expiresAt: new Date(Date.now() + RIDE_TTL_MS),
      },
    });
    await tx.rideEvent.create({
      data: { rideId: created.id, type: 'ride_created', actor: 'customer', toStatus: 'open' },
    });
    return created;
  });

  // Fire-and-forget, after commit: a customer holding a ride code keeps it even
  // when every channel is down.
  emitRide(req.app.get('io'), 'new', ride);
  notifyNewRide(ride);

  res.status(201).json({
    success: true,
    data: serializeRideForCustomer(ride, { includeAccessToken: true }),
    message: `آپ کی درخواست بھیج دی گئی ہے۔ کوڈ: ${rideCode}`,
  });
});

/// Both "no such code" and "wrong phone" answer with this, so the code space
/// cannot be probed by watching which guesses read differently.
const INVALID_LOOKUP = 'کوڈ یا فون نمبر غلط ہے';

async function rideByCodeAndPhone(rideCode, phone, include) {
  const ride = await prisma.ride.findUnique({ where: { rideCode }, include });
  if (!ride || ride.customerPhone !== normalizePhone(phone)) {
    throw new ApiError(404, INVALID_LOOKUP);
  }
  return ride;
}

export const lookupRideSchema = z.object({
  rideCode: z.string().trim().regex(/^\d{8}$/),
  phone: z.string().trim().min(7).max(40),
});

export const lookupRide = asyncHandler(async (req, res) => {
  await sweepExpiredRides();
  const ride = await rideByCodeAndPhone(req.body.rideCode, req.body.phone, {
    driver: DRIVER_PUBLIC,
    bids: {
      where: { status: { in: ['active', 'accepted'] } },
      orderBy: { price: 'asc' },
      include: { driver: DRIVER_PUBLIC },
    },
  });
  res.json({ success: true, data: serializeRideForCustomer(ride, { includeAccessToken: true }) });
});

export const rideDriversSchema = z.object({
  phone: z.string().trim().min(7).max(40),
});

/**
 * The drivers a customer may ring themselves, once nobody has bid in time.
 *
 * Bidders are left out: their offers are already on the screen above, and a
 * second copy of the same name would only be in the way.
 */
export const rideDrivers = asyncHandler(async (req, res) => {
  const ride = await rideByCodeAndPhone(req.params.rideCode, req.body.phone);

  const waited = Date.now() - new Date(ride.createdAt).getTime();
  if (waited < BID_WINDOW_MS) {
    throw new ApiError(425, 'ابھی ڈرائیوروں کو جواب دینے کا وقت باقی ہے');
  }
  if (ride.status !== 'open') {
    throw new ApiError(409, 'اس سفر کے لیے رابطے کی ضرورت نہیں رہی');
  }

  const bidders = await prisma.bid.findMany({
    where: { rideId: ride.id },
    select: { driverId: true },
  });

  const drivers = await prisma.driver.findMany({
    where: { isActive: true, id: { notIn: bidders.map((b) => b.driverId) } },
    // The customer is choosing blind now, so lead with licence-verified and
    // experienced drivers.
    orderBy: [{ isVerified: 'desc' }, { completedRides: 'desc' }],
    ...DRIVER_CONTACT,
  });

  res.json({
    success: true,
    // A row nobody can ring is just clutter.
    data: drivers
      .filter((d) => d.phone.trim() || d.whatsapp.trim())
      .map(serializeDriverContact),
  });
});

export const acceptBidSchema = z.object({
  phone: z.string().trim().min(7).max(40),
  bidId: z.string().min(1),
});

export const acceptBid = asyncHandler(async (req, res) => {
  const found = await rideByCodeAndPhone(req.params.rideCode, req.body.phone);
  let losingDriverIds = [];

  const ride = await runTransaction(async (tx) => {
    const bid = await tx.bid.findFirst({
      where: { id: req.body.bidId, rideId: found.id, status: 'active' },
      select: { id: true, driverId: true, price: true },
    });
    if (!bid) throw new ApiError(409, 'یہ پیشکش دستیاب نہیں رہی');

    // The serialisation point. Two customers accepting different bids both run
    // this UPDATE; the second blocks on the row lock, then re-evaluates its
    // WHERE against the committed row, matches nothing, and loses. Double
    // assignment is impossible by construction rather than by checking first.
    const claim = await tx.ride.updateMany({
      where: { id: found.id, status: 'open', acceptedBidId: null },
      data: {
        status: 'assigned',
        assignedDriverId: bid.driverId,
        acceptedBidId: bid.id,
        agreedPrice: bid.price,
        assignedAt: new Date(),
      },
    });
    if (claim.count === 0) throw new ApiError(409, 'یہ سفر پہلے ہی طے یا منسوخ ہو چکا ہے');

    // Re-checked under the same transaction: a driver who withdrew between the
    // read above and the claim must not end up assigned. Failing here rolls the
    // claim back with it.
    const win = await tx.bid.updateMany({
      where: { id: bid.id, rideId: found.id, status: 'active' },
      data: { status: 'accepted' },
    });
    if (win.count === 0) throw new ApiError(409, 'یہ پیشکش واپس لے لی گئی ہے');

    // Captured before the update so the losers can be told; after it they are
    // no longer 'active' and the query would return nothing.
    losingDriverIds = (
      await tx.bid.findMany({
        where: { rideId: found.id, status: 'active', id: { not: bid.id } },
        select: { driverId: true },
      })
    ).map((b) => b.driverId);

    await tx.bid.updateMany({
      where: { rideId: found.id, status: 'active', id: { not: bid.id } },
      data: { status: 'rejected' },
    });
    await tx.rideEvent.create({
      data: {
        rideId: found.id,
        type: 'bid_accepted',
        actor: 'customer',
        bidId: bid.id,
        price: bid.price,
        fromStatus: 'open',
        toStatus: 'assigned',
      },
    });

    return tx.ride.findUnique({
      where: { id: found.id },
      include: {
        driver: DRIVER_PUBLIC,
        bids: { where: { status: 'accepted' }, include: { driver: DRIVER_PUBLIC } },
      },
    });
  });

  const io = req.app.get('io');
  emitRide(io, 'assigned', ride);
  // Straight to the drivers concerned. The Android panel learns the same thing
  // from its push; this is what reaches a driver working in the browser, who
  // has no push at all.
  emitToDriver(io, ride.assignedDriverId, 'bid:accepted', { rideId: ride.id });
  for (const driverId of losingDriverIds) {
    emitToDriver(io, driverId, 'bid:rejected', { rideId: ride.id });
  }
  notifyRideAssigned(ride, losingDriverIds);

  res.json({
    success: true,
    data: serializeRideForCustomer(ride),
    message: 'ڈرائیور طے ہو گیا ہے',
  });
});

export const cancelRideSchema = z.object({
  phone: z.string().trim().min(7).max(40),
  reason: z.string().trim().max(200).optional().default(''),
});

export const cancelRide = asyncHandler(async (req, res) => {
  const found = await rideByCodeAndPhone(req.params.rideCode, req.body.phone);

  const ride = await runTransaction(async (tx) => {
    const done = await tx.ride.updateMany({
      where: { id: found.id, status: { in: ['open', 'assigned'] } },
      data: {
        status: 'cancelled',
        cancelledAt: new Date(),
        cancelledBy: 'customer',
        cancelReason: req.body.reason,
      },
    });
    if (done.count === 0) throw new ApiError(409, 'یہ سفر پہلے ہی مکمل یا منسوخ ہو چکا ہے');

    await tx.bid.updateMany({
      where: { rideId: found.id, status: 'active' },
      data: { status: 'rejected' },
    });
    await tx.rideEvent.create({
      data: {
        rideId: found.id,
        type: 'ride_cancelled',
        actor: 'customer',
        fromStatus: found.status,
        toStatus: 'cancelled',
      },
    });
    return tx.ride.findUnique({ where: { id: found.id }, include: { driver: DRIVER_PUBLIC } });
  });

  emitRide(req.app.get('io'), 'cancelled', ride);
  notifyRideCancelled(ride);

  res.json({ success: true, data: serializeRideForCustomer(ride), message: 'سفر منسوخ ہو گیا' });
});

export { serializeBid };
