import { z } from 'zod';
import prisma, { runTransaction } from '../lib/prisma.js';
import { asyncHandler, ApiError } from '../utils/asyncHandler.js';
import {
  DRIVER_PUBLIC,
  serializeBid,
  serializeDriver,
  serializeRideForAdmin,
  serializeRideForDriver,
} from '../lib/serialize.js';
import { hashPassword } from '../lib/password.js';
import { sweepExpiredRides } from './rideController.js';
import { emitRide, emitToDriver } from '../lib/socket.js';
import { notifyBidPlaced } from '../lib/notify/rides.js';

/// A driver may change their price this many times on one ride. Without a cap a
/// bidding war is an unbounded write loop on the same row.
const MAX_REVISIONS = 5;

/**
 * Resolves the caller's driver profile.
 *
 * Mirrors `getOwnerShop`, but `Driver.userId` is unique so this is an exact
 * lookup rather than "the oldest row that matches". A suspended driver is
 * rejected here, which is why no handler below has to think about it.
 */
async function getDriver(req) {
  const driver = await prisma.driver.findUnique({ where: { userId: req.user.id } });
  if (!driver) throw new ApiError(404, 'ڈرائیور پروفائل نہیں ملا');
  if (!driver.isActive) throw new ApiError(403, 'آپ کا اکاؤنٹ عارضی طور پر بند ہے');
  return driver;
}

export const getMe = asyncHandler(async (req, res) => {
  const driver = await prisma.driver.findUnique({
    where: { userId: req.user.id },
    include: { user: { select: { name: true, email: true } } },
  });
  if (!driver) throw new ApiError(404, 'ڈرائیور پروفائل نہیں ملا');
  res.json({ success: true, data: serializeDriver(driver) });
});

export const updateMeSchema = z.object({
  phone: z.string().trim().max(40).optional(),
  whatsapp: z.string().trim().max(40).optional(),
  vehicleType: z.string().trim().max(60).optional(),
  vehicleNumber: z.string().trim().max(40).optional(),
  photo: z.string().trim().max(600).optional(),
});

export const updateMe = asyncHandler(async (req, res) => {
  const driver = await getDriver(req);
  const updated = await prisma.driver.update({
    where: { id: driver.id },
    data: req.body,
    include: { user: { select: { name: true, email: true } } },
  });
  res.json({ success: true, data: serializeDriver(updated), message: 'محفوظ ہو گیا' });
});

/**
 * The bidding board.
 *
 * Returns open rides without the customer's name or phone — an open request is
 * visible to every driver in town, so it must not be harvestable for numbers.
 * Each row carries the caller's own bid and a count of the rest; rival prices
 * are never exposed, which is what stops the board becoming a race to the
 * bottom.
 */
export const listOpenRides = asyncHandler(async (req, res) => {
  await sweepExpiredRides();
  const driver = await getDriver(req);

  const rides = await prisma.ride.findMany({
    where: { status: 'open' },
    orderBy: { createdAt: 'desc' },
    take: 50,
    include: { bids: { where: { driverId: driver.id }, take: 1 } },
  });

  res.json({
    success: true,
    data: rides.map((r) =>
      serializeRideForDriver(r, { myBid: r.bids[0] ?? null })
    ),
  });
});

export const listMyRides = asyncHandler(async (req, res) => {
  const driver = await getDriver(req);
  const status = ['assigned', 'completed', 'cancelled'].includes(req.query.status)
    ? req.query.status
    : undefined;

  const rides = await prisma.ride.findMany({
    where: { assignedDriverId: driver.id, ...(status ? { status } : {}) },
    orderBy: { assignedAt: 'desc' },
    take: 50,
  });
  res.json({
    success: true,
    data: rides.map((r) => serializeRideForDriver(r, { isWinner: true })),
  });
});

export const getRide = asyncHandler(async (req, res) => {
  const driver = await getDriver(req);
  const ride = await prisma.ride.findUnique({
    where: { id: req.params.id },
    include: { bids: { where: { driverId: driver.id }, take: 1 } },
  });
  if (!ride) throw new ApiError(404, 'سفر نہیں ملا');

  const isWinner = ride.assignedDriverId === driver.id;
  // An open ride is public to drivers; anything else is only their own business.
  if (ride.status !== 'open' && !isWinner) throw new ApiError(404, 'سفر نہیں ملا');

  res.json({
    success: true,
    data: serializeRideForDriver(ride, { myBid: ride.bids[0] ?? null, isWinner }),
  });
});

export const placeBidSchema = z.object({
  price: z.number().int().min(1).max(1000000),
  etaMinutes: z.number().int().min(0).max(240).optional().default(0),
  note: z.string().trim().max(200).optional().default(''),
});

export const placeBid = asyncHandler(async (req, res) => {
  const driver = await getDriver(req);
  const rideId = req.params.id;
  const { price, etaMinutes, note } = req.body;

  const bid = await runTransaction(async (tx) => {
    const now = new Date();
    // The guard is a write, not a count: it takes the same row lock the accept
    // transaction needs, so a bid either lands before the ride is claimed or is
    // refused outright. A read here would let a bid slip in behind an accept.
    const open = await tx.ride.updateMany({
      where: { id: rideId, status: 'open', expiresAt: { gt: now } },
      data: { lastBidAt: now },
    });
    if (open.count === 0) throw new ApiError(409, 'یہ سفر اب بولی کے لیے دستیاب نہیں');

    const existing = await tx.bid.findUnique({
      where: { rideId_driverId: { rideId, driverId: driver.id } },
      select: { id: true, reviseCount: true },
    });
    if (existing && existing.reviseCount >= MAX_REVISIONS) {
      throw new ApiError(429, 'آپ قیمت مزید تبدیل نہیں کر سکتے');
    }

    // Deliberately not an upsert: bidCount must count drivers, not writes.
    const saved = existing
      ? await tx.bid.update({
          where: { id: existing.id },
          data: { price, etaMinutes, note, status: 'active', reviseCount: { increment: 1 } },
        })
      : await tx.bid.create({ data: { rideId, driverId: driver.id, price, etaMinutes, note } });

    if (!existing) {
      await tx.ride.update({ where: { id: rideId }, data: { bidCount: { increment: 1 } } });
    }
    await tx.rideEvent.create({
      data: {
        rideId,
        type: existing ? 'bid_revised' : 'bid_placed',
        actor: 'driver',
        actorUserId: req.user.id,
        bidId: saved.id,
        price,
      },
    });
    return saved;
  }).catch((err) => {
    // Two taps on the same button race the unique constraint rather than each
    // other; both mean the same thing to the driver.
    if (err?.code === 'P2002') throw new ApiError(409, 'آپ کی پیشکش پہلے سے موجود ہے');
    throw err;
  });

  const full = await prisma.bid.findUnique({
    where: { id: bid.id },
    include: { driver: DRIVER_PUBLIC, ride: { select: { accessToken: true, id: true } } },
  });
  emitRide(req.app.get('io'), 'bid', full.ride, { bid: serializeBid(full) });
  notifyBidPlaced(rideId);

  res.status(201).json({ success: true, data: serializeBid(bid), message: 'پیشکش بھیج دی گئی' });
});

export const withdrawBid = asyncHandler(async (req, res) => {
  const driver = await getDriver(req);
  const rideId = req.params.id;

  const done = await prisma.bid.updateMany({
    where: { rideId, driverId: driver.id, status: 'active' },
    data: { status: 'withdrawn' },
  });
  if (done.count === 0) throw new ApiError(409, 'واپس لینے کے لیے کوئی فعال پیشکش نہیں');

  await prisma.rideEvent.create({
    data: { rideId, type: 'bid_withdrawn', actor: 'driver', actorUserId: req.user.id },
  });

  const ride = await prisma.ride.findUnique({ where: { id: rideId }, select: { id: true, accessToken: true } });
  emitRide(req.app.get('io'), 'bid-withdrawn', ride, { driverId: driver.id });

  res.json({ success: true, message: 'پیشکش واپس لے لی گئی' });
});

export const completeRide = asyncHandler(async (req, res) => {
  const driver = await getDriver(req);

  const ride = await runTransaction(async (tx) => {
    // Ownership lives in the WHERE rather than in a prior read, so a driver who
    // guesses another driver's ride id changes nothing.
    const done = await tx.ride.updateMany({
      where: { id: req.params.id, status: 'assigned', assignedDriverId: driver.id },
      data: { status: 'completed', completedAt: new Date() },
    });
    if (done.count === 0) throw new ApiError(409, 'یہ سفر مکمل نہیں کیا جا سکتا');

    await tx.driver.update({
      where: { id: driver.id },
      data: { completedRides: { increment: 1 } },
    });
    await tx.rideEvent.create({
      data: {
        rideId: req.params.id,
        type: 'ride_completed',
        actor: 'driver',
        actorUserId: req.user.id,
        fromStatus: 'assigned',
        toStatus: 'completed',
      },
    });
    return tx.ride.findUnique({ where: { id: req.params.id } });
  });

  emitRide(req.app.get('io'), 'completed', ride);
  res.json({ success: true, data: serializeRideForDriver(ride, { isWinner: true }), message: 'سفر مکمل' });
});

export const driverStats = asyncHandler(async (req, res) => {
  const driver = await getDriver(req);
  const [openRides, myActiveBids, assigned, completed] = await Promise.all([
    prisma.ride.count({ where: { status: 'open' } }),
    prisma.bid.count({ where: { driverId: driver.id, status: 'active' } }),
    prisma.ride.count({ where: { assignedDriverId: driver.id, status: 'assigned' } }),
    prisma.ride.count({ where: { assignedDriverId: driver.id, status: 'completed' } }),
  ]);
  res.json({ success: true, data: { openRides, myActiveBids, assigned, completed } });
});

export { getDriver, emitToDriver };

// ------------------------------------------------------------------ SUPER-ADMIN

export const adminCreateDriverSchema = z.object({
  name: z.string().trim().min(1).max(80),
  email: z.string().email(),
  password: z.string().min(6),
  phone: z.string().trim().max(40).optional().default(''),
  whatsapp: z.string().trim().max(40).optional().default(''),
  vehicleType: z.string().trim().max(60).optional().default(''),
  vehicleNumber: z.string().trim().max(40).optional().default(''),
  photo: z.string().trim().max(600).optional().default(''),
  isVerified: z.boolean().optional().default(false),
});

export const adminListDrivers = asyncHandler(async (req, res) => {
  const active = req.query.active === undefined ? undefined : req.query.active === 'true';
  const drivers = await prisma.driver.findMany({
    where: active === undefined ? {} : { isActive: active },
    orderBy: { createdAt: 'desc' },
    include: { user: { select: { name: true, email: true } } },
  });
  res.json({ success: true, data: drivers.map(serializeDriver) });
});

export const adminCreateDriver = asyncHandler(async (req, res) => {
  const { name, email, password, ...profile } = req.body;
  const lower = email.toLowerCase();
  if (await prisma.user.findUnique({ where: { email: lower } })) {
    throw new ApiError(400, 'یہ ای میل پہلے سے استعمال میں ہے');
  }
  const passwordHash = await hashPassword(password);

  // One transaction rather than create-then-compensate: a rolled-back
  // transaction cannot leave behind a login with no profile the way a failed
  // cleanup delete can.
  const driver = await runTransaction(async (tx) => {
    const user = await tx.user.create({
      data: { name, email: lower, role: 'driver', passwordHash },
    });
    return tx.driver.create({
      data: { ...profile, userId: user.id },
      include: { user: { select: { name: true, email: true } } },
    });
  });

  res.status(201).json({ success: true, data: serializeDriver(driver), message: 'ڈرائیور بن گیا' });
});

export const adminUpdateDriverSchema = adminCreateDriverSchema
  .partial()
  .omit({ email: true })
  .extend({ isActive: z.boolean().optional() });

export const adminUpdateDriver = asyncHandler(async (req, res) => {
  const { name, password, ...profile } = req.body;
  const existing = await prisma.driver.findUnique({ where: { id: req.params.id } });
  if (!existing) throw new ApiError(404, 'ڈرائیور نہیں ملا');

  const driver = await runTransaction(async (tx) => {
    if (name || password) {
      await tx.user.update({
        where: { id: existing.userId },
        data: {
          ...(name ? { name } : {}),
          ...(password ? { passwordHash: await hashPassword(password) } : {}),
        },
      });
    }
    return tx.driver.update({
      where: { id: existing.id },
      data: profile,
      include: { user: { select: { name: true, email: true } } },
    });
  });

  res.json({ success: true, data: serializeDriver(driver), message: 'محفوظ ہو گیا' });
});

export const adminSetDriverStatus = asyncHandler(async (req, res) => {
  const isActive = Boolean(req.body?.isActive);
  const driver = await prisma.driver.update({
    where: { id: req.params.id },
    data: { isActive },
    include: { user: { select: { name: true, email: true } } },
  });
  res.json({
    success: true,
    data: serializeDriver(driver),
    message: isActive ? 'ڈرائیور فعال' : 'ڈرائیور بند',
  });
});

export const adminListRides = asyncHandler(async (req, res) => {
  const status = ['open', 'assigned', 'completed', 'cancelled'].includes(req.query.status)
    ? req.query.status
    : undefined;
  const page = Math.max(1, Number(req.query.page) || 1);
  const limit = Math.min(50, Math.max(1, Number(req.query.limit) || 20));

  const where = status ? { status } : {};
  const [rides, total] = await Promise.all([
    prisma.ride.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * limit,
      take: limit,
      include: { driver: DRIVER_PUBLIC },
    }),
    prisma.ride.count({ where }),
  ]);

  res.json({
    success: true,
    data: rides.map(serializeRideForAdmin),
    page,
    total,
    totalPages: Math.ceil(total / limit),
  });
});

export const adminGetRide = asyncHandler(async (req, res) => {
  const ride = await prisma.ride.findUnique({
    where: { id: req.params.id },
    include: {
      driver: DRIVER_PUBLIC,
      bids: { orderBy: { price: 'asc' }, include: { driver: DRIVER_PUBLIC } },
      events: { orderBy: { createdAt: 'asc' } },
    },
  });
  if (!ride) throw new ApiError(404, 'سفر نہیں ملا');
  res.json({ success: true, data: serializeRideForAdmin(ride) });
});

export const adminSetRideStatus = asyncHandler(async (req, res) => {
  const status = req.body?.status;
  if (!['cancelled', 'completed'].includes(status)) {
    throw new ApiError(400, 'صرف منسوخ یا مکمل کیا جا سکتا ہے');
  }
  const ride = await runTransaction(async (tx) => {
    const current = await tx.ride.findUnique({ where: { id: req.params.id } });
    if (!current) throw new ApiError(404, 'سفر نہیں ملا');
    if (current.status === status) return current;

    const done = await tx.ride.updateMany({
      where: { id: current.id, status: { in: ['open', 'assigned'] } },
      data: {
        status,
        ...(status === 'cancelled'
          ? { cancelledAt: new Date(), cancelledBy: 'admin' }
          : { completedAt: new Date() }),
      },
    });
    if (done.count === 0) throw new ApiError(409, 'یہ سفر پہلے ہی بند ہو چکا ہے');

    if (status === 'cancelled') {
      await tx.bid.updateMany({ where: { rideId: current.id, status: 'active' }, data: { status: 'rejected' } });
    }
    await tx.rideEvent.create({
      data: {
        rideId: current.id,
        type: status === 'cancelled' ? 'ride_cancelled' : 'ride_completed',
        actor: 'admin',
        actorUserId: req.user.id,
        fromStatus: current.status,
        toStatus: status,
      },
    });
    return tx.ride.findUnique({ where: { id: current.id }, include: { driver: DRIVER_PUBLIC } });
  });

  res.json({ success: true, data: serializeRideForAdmin(ride), message: 'اپ ڈیٹ ہو گیا' });
});
