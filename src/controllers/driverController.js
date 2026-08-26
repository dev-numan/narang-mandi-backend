import { randomInt } from 'node:crypto';
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
import { notifyBidPlaced, notifyRideCancelled } from '../lib/notify/rides.js';

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
  const search = String(req.query.search || '').trim();

  const where = {
    ...(active === undefined ? {} : { isActive: active }),
    ...(search
      ? {
          OR: [
            { phone: { contains: search, mode: 'insensitive' } },
            { whatsapp: { contains: search, mode: 'insensitive' } },
            { vehicleNumber: { contains: search, mode: 'insensitive' } },
            { user: { name: { contains: search, mode: 'insensitive' } } },
          ],
        }
      : {}),
  };

  const drivers = await prisma.driver.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    include: {
      // deviceTokens tells the panel whether a driver is reachable at all: a
      // driver with none hears about a ride only over WhatsApp, so a zero here
      // plus a failing template means they are notified by nothing.
      user: { select: { name: true, email: true, _count: { select: { deviceTokens: true } } } },
      _count: { select: { bids: true, assignedRides: true } },
    },
  });

  // Wins are counted separately because `assignedRides` includes rides that were
  // later cancelled, which would overstate how many a driver actually landed.
  const wins = await prisma.ride.groupBy({
    by: ['assignedDriverId'],
    where: { assignedDriverId: { not: null }, status: { in: ['assigned', 'completed'] } },
    _count: { _all: true },
  });
  const winsByDriver = Object.fromEntries(wins.map((w) => [w.assignedDriverId, w._count._all]));

  res.json({
    success: true,
    data: drivers.map((d) => ({
      ...serializeDriver(d),
      bidCount: d._count.bids,
      rideCount: d._count.assignedRides,
      wins: winsByDriver[d.id] || 0,
      deviceTokenCount: d.user._count.deviceTokens,
    })),
  });
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
  // Checked rather than coerced: `Boolean(undefined)` is false, so a request
  // that forgot the body used to silently suspend the driver it was meant to
  // leave alone. Mirrors adminSetShopStatus.
  const isActive = req.body?.isActive;
  if (typeof isActive !== 'boolean') throw new ApiError(400, 'isActive درکار ہے');
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

/**
 * Resets one driver's password and hands the plaintext back exactly once.
 *
 * These are read out over the phone, so the generated value follows the
 * create-driver convention — first name plus four digits — rather than being a
 * random string nobody can dictate. The plaintext is returned and never logged
 * or stored; bcrypt cannot give it back afterwards.
 */
export const adminResetDriverPassword = asyncHandler(async (req, res) => {
  const driver = await prisma.driver.findUnique({
    where: { id: req.params.id },
    include: { user: { select: { id: true, name: true } } },
  });
  if (!driver) throw new ApiError(404, 'ڈرائیور نہیں ملا');

  const first = (driver.user.name || 'driver').trim().split(/\s+/)[0].toLowerCase();
  const ascii = first.replace(/[^a-z]/g, '') || 'driver';
  const password = `${ascii}${randomInt(1000, 10000)}`;

  await prisma.user.update({
    where: { id: driver.user.id },
    data: { passwordHash: await hashPassword(password) },
  });

  res.json({ success: true, data: { password }, message: 'پاس ورڈ تبدیل ہو گیا' });
});

/// Buckets a date into its Pakistan-time calendar day (`YYYY-MM-DD`).
///
/// The operator's day is what "today" has to mean on this dashboard, and the
/// server may well run in UTC — where the 11pm rides that dominate this data
/// would land on tomorrow's row.
const PKT_OFFSET_MS = 5 * 60 * 60 * 1000;
function pktDay(date) {
  return new Date(date.getTime() + PKT_OFFSET_MS).toISOString().slice(0, 10);
}

/// Start of the current Pakistan-time day, as a real UTC instant.
function pktTodayStart() {
  const now = new Date();
  const shifted = new Date(now.getTime() + PKT_OFFSET_MS);
  return new Date(
    Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth(), shifted.getUTCDate()) - PKT_OFFSET_MS
  );
}

/**
 * Everything the taxi dashboard needs, in one round trip.
 *
 * Day bucketing happens in JS rather than SQL: this codebase has no raw-query
 * precedent and Prisma cannot group by a computed date, so the rows for the
 * window are fetched thin (three columns) and counted here.
 */
export const adminRideStats = asyncHandler(async (req, res) => {
  // Stale `open` rides would otherwise be counted as live — nothing sweeps them
  // on a timer, only reads like this one.
  await sweepExpiredRides();

  const days = Math.min(90, Math.max(1, Number(req.query.days) || 30));
  const windowStart = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  const todayStart = pktTodayStart();

  const [windowRides, windowBids, cancelSplit, drivers, reachable, notifications, openNow] =
    await Promise.all([
      prisma.ride.findMany({
        where: { createdAt: { gte: windowStart } },
        select: { createdAt: true, status: true, cancelledBy: true, bidCount: true, agreedPrice: true },
      }),
      prisma.bid.findMany({
        where: { createdAt: { gte: windowStart } },
        select: { createdAt: true, price: true, driverId: true, rideId: true },
      }),
      prisma.ride.groupBy({
        by: ['cancelledBy'],
        where: { createdAt: { gte: windowStart }, status: 'cancelled' },
        _count: { _all: true },
      }),
      prisma.driver.findMany({
        select: { isActive: true, isVerified: true, photo: true, vehicleType: true },
      }),
      prisma.driver.count({ where: { isActive: true, user: { deviceTokens: { some: {} } } } }),
      // Bounded by createdAt on purpose: it is the only index on this table, so
      // an unbounded groupBy here would seq-scan the whole log.
      prisma.notificationLog.groupBy({
        by: ['event', 'channel', 'status'],
        where: { createdAt: { gte: windowStart } },
        _count: { _all: true },
      }),
      prisma.ride.count({ where: { status: 'open' } }),
    ]);

  // The counts alone say a channel is failing; the provider's own message says
  // why. Without this the panel can only report "20 failed" for what is really
  // one unpublished WhatsApp template.
  const failures = await prisma.notificationLog.findMany({
    where: { createdAt: { gte: windowStart }, status: 'failed', NOT: { error: null } },
    orderBy: { createdAt: 'desc' },
    take: 40,
    select: { channel: true, event: true, error: true, createdAt: true },
  });
  const seenError = new Set();
  const recentErrors = failures.filter((f) => {
    const key = `${f.channel}|${(f.error || '').slice(0, 80)}`;
    if (seenError.has(key)) return false;
    seenError.add(key);
    return true;
  });

  const isToday = (d) => d >= todayStart;
  const byStatus = (rows, status) => rows.filter((r) => r.status === status).length;

  // One row per calendar day in the window, including the days nothing happened —
  // a chart that silently omits empty days misreads a quiet week as a busy one.
  const series = [];
  const dayIndex = {};
  for (let i = days - 1; i >= 0; i -= 1) {
    const key = pktDay(new Date(Date.now() - i * 24 * 60 * 60 * 1000));
    dayIndex[key] = series.length;
    series.push({ date: key, rides: 0, bids: 0, completed: 0, cancelled: 0 });
  }
  for (const r of windowRides) {
    const row = series[dayIndex[pktDay(r.createdAt)]];
    if (!row) continue;
    row.rides += 1;
    if (r.status === 'completed') row.completed += 1;
    if (r.status === 'cancelled') row.cancelled += 1;
  }
  for (const b of windowBids) {
    const row = series[dayIndex[pktDay(b.createdAt)]];
    if (row) row.bids += 1;
  }

  const prices = windowBids.map((b) => b.price).sort((a, b) => a - b);
  const agreed = windowRides.filter((r) => r.agreedPrice > 0).map((r) => r.agreedPrice);
  const median = prices.length ? prices[Math.floor(prices.length / 2)] : 0;

  const todayRides = windowRides.filter((r) => isToday(r.createdAt));
  const withBids = windowRides.filter((r) => r.bidCount > 0).length;

  res.json({
    success: true,
    data: {
      days,
      today: {
        rides: todayRides.length,
        completed: byStatus(todayRides, 'completed'),
        cancelled: byStatus(todayRides, 'cancelled'),
        open: byStatus(todayRides, 'open'),
        assigned: byStatus(todayRides, 'assigned'),
        bids: windowBids.filter((b) => isToday(b.createdAt)).length,
      },
      window: {
        rides: windowRides.length,
        completed: byStatus(windowRides, 'completed'),
        cancelled: byStatus(windowRides, 'cancelled'),
        open: byStatus(windowRides, 'open'),
        assigned: byStatus(windowRides, 'assigned'),
        bids: windowBids.length,
        biddingDrivers: new Set(windowBids.map((b) => b.driverId)).size,
        ridesWithBids: withBids,
        ridesWithoutBids: windowRides.length - withBids,
      },
      openNow,
      // Splits the headline "cancelled" number into people who changed their
      // mind and requests that simply timed out — very different problems.
      cancellations: Object.fromEntries(
        cancelSplit.map((c) => [c.cancelledBy || 'unknown', c._count._all])
      ),
      prices: {
        min: prices[0] || 0,
        median,
        max: prices[prices.length - 1] || 0,
        avgAgreed: agreed.length ? Math.round(agreed.reduce((a, b) => a + b, 0) / agreed.length) : 0,
      },
      drivers: {
        total: drivers.length,
        active: drivers.filter((d) => d.isActive).length,
        verified: drivers.filter((d) => d.isVerified).length,
        reachable,
        noPhoto: drivers.filter((d) => d.isActive && !d.photo.trim()).length,
        noVehicleType: drivers.filter((d) => d.isActive && !d.vehicleType.trim()).length,
      },
      series,
      notifications: notifications.map((n) => ({
        event: n.event,
        channel: n.channel,
        status: n.status,
        count: n._count._all,
      })),
      recentErrors: recentErrors.map((f) => ({
        channel: f.channel,
        event: f.event,
        error: f.error,
        createdAt: f.createdAt,
      })),
    },
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
      // The delivery log is what separates "the customer ignored the bid" from
      // "the customer was never told" — the two look identical without it.
      notifications: { orderBy: { createdAt: 'asc' } },
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

  // An admin closing a ride is as consequential to the assigned driver as the
  // customer doing it, so it earns the same socket push and notification the
  // customer-side cancel fires. Without these the driver keeps a dead ride on
  // their screen until they next reload.
  emitRide(req.app.get('io'), ride.status === 'cancelled' ? 'cancelled' : 'completed', ride);
  if (ride.status === 'cancelled') notifyRideCancelled(ride);

  res.json({ success: true, data: serializeRideForAdmin(ride), message: 'اپ ڈیٹ ہو گیا' });
});
