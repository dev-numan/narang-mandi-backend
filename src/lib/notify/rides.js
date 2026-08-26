import prisma from '../prisma.js';
import { dispatch } from './dispatch.js';
import {
  assignedCustomer,
  assignedDriver,
  bidRejectedDriver,
  bidReceivedCustomer,
  cancelledDriver,
  newRideDriver,
} from './rideMessages.js';

/**
 * Ride notifications.
 *
 * Same contract as the order side: fire-and-forget, called after the
 * transaction commits, resolving whatever any channel does. A customer holding
 * a ride code keeps it even when every channel is down.
 */

/// At most one WhatsApp per ride per this long. Twelve drivers bidding is twelve
/// billable messages otherwise, for information the socket already delivered.
const BID_WHATSAPP_COOLDOWN_MS = 10 * 60 * 1000;

/**
 * Every active driver, paired with the tokens and the number that one driver
 * should be reached on.
 *
 * Grouped per driver rather than flattened into one token list because a new
 * ride now goes out on WhatsApp as well, and a template message needs its own
 * recipient — a single broadcast dispatch carries only one `phone`.
 */
async function activeDriverRecipients() {
  const drivers = await prisma.driver.findMany({
    where: { isActive: true, user: { role: 'driver' } },
    select: {
      phone: true,
      whatsapp: true,
      user: { select: { deviceTokens: { select: { token: true } } } },
    },
  });
  return drivers.map((driver) => ({
    tokens: driver.user.deviceTokens.map((t) => t.token),
    // A driver's calling number is not always the one they use on WhatsApp, so
    // the dedicated field wins wherever the admin recorded one.
    phone: driver.whatsapp || driver.phone,
  }));
}

async function driverTokens(driverId) {
  const rows = await prisma.deviceToken.findMany({
    where: { user: { driver: { id: driverId } } },
    select: { token: true },
  });
  return rows.map((r) => r.token);
}

export async function notifyNewRide(ride) {
  try {
    const recipients = await activeDriverRecipients();
    const message = newRideDriver(ride);

    // One dispatch per driver, not one broadcast: WhatsApp addresses a single
    // number at a time, so the fan-out has to happen here. This makes a posted
    // ride cost one billable template message per active driver — the reason
    // `newRideDriver` deliberately carries no customer name or number.
    await Promise.allSettled(
      recipients
        .filter((r) => r.tokens.length || r.phone)
        .map((recipient) =>
          dispatch({
            rideId: ride.id,
            event: 'ride_new',
            audience: 'driver',
            message,
            tokens: recipient.tokens,
            phone: recipient.phone,
          })
        )
    );
  } catch (err) {
    console.error('[notify] notifyNewRide failed', err.message);
  }
}

export async function notifyBidPlaced(rideId) {
  try {
    const ride = await prisma.ride.findUnique({ where: { id: rideId } });
    if (!ride || ride.status !== 'open') return;

    const count = await prisma.bid.count({ where: { rideId, status: 'active' } });

    // The socket and push carry every bid; WhatsApp only speaks up occasionally.
    // Claiming the slot with a conditional update rather than a read means two
    // bids landing together still produce at most one message.
    const claimed = await prisma.ride.updateMany({
      where: {
        id: rideId,
        OR: [
          { lastWhatsAppAt: null },
          { lastWhatsAppAt: { lt: new Date(Date.now() - BID_WHATSAPP_COOLDOWN_MS) } },
        ],
      },
      data: { lastWhatsAppAt: new Date() },
    });

    await dispatch({
      rideId,
      event: 'ride_bid',
      audience: 'customer',
      message: bidReceivedCustomer(ride, count),
      tokens: ride.deviceToken ? [ride.deviceToken] : [],
      phone: claimed.count === 1 ? ride.customerPhone : '',
    });
  } catch (err) {
    console.error('[notify] notifyBidPlaced failed', err.message);
  }
}

export async function notifyRideAssigned(ride, losingDriverIds = []) {
  try {
    const driverName = ride.driver?.user?.name || '';
    const tokens = ride.assignedDriverId ? await driverTokens(ride.assignedDriverId) : [];

    // Losing drivers otherwise learn nothing: the ride leaves both of their
    // lists the moment it stops being open, so the card simply vanishes and
    // looks no different from one that expired.
    const losers = await Promise.all(losingDriverIds.map((id) => driverTokens(id)));

    await Promise.allSettled([
      dispatch({
        rideId: ride.id,
        event: 'ride_assigned',
        audience: 'customer',
        message: assignedCustomer(ride, driverName),
        tokens: ride.deviceToken ? [ride.deviceToken] : [],
        phone: ride.customerPhone,
      }),
      dispatch({
        rideId: ride.id,
        event: 'ride_assigned',
        audience: 'driver',
        message: assignedDriver(ride),
        tokens,
        phone: ride.driver?.phone || '',
      }),
      ...losers
        .filter((t) => t.length)
        .map((driverDeviceTokens) =>
          dispatch({
            rideId: ride.id,
            event: 'ride_bid_rejected',
            audience: 'driver',
            message: bidRejectedDriver(ride),
            tokens: driverDeviceTokens,
            // Empty on purpose: WhatsApp skips an unusable number, and a losing
            // bid does not warrant a billable message.
            phone: '',
          })
        ),
    ]);
  } catch (err) {
    console.error('[notify] notifyRideAssigned failed', err.message);
  }
}

export async function notifyRideCancelled(ride) {
  try {
    // Only the driver who had already won needs telling; nobody else was
    // counting on this ride.
    if (!ride.assignedDriverId) return;
    const tokens = await driverTokens(ride.assignedDriverId);
    await dispatch({
      rideId: ride.id,
      event: 'ride_cancelled',
      audience: 'driver',
      message: cancelledDriver(ride),
      tokens,
      phone: ride.driver?.phone || '',
    });
  } catch (err) {
    console.error('[notify] notifyRideCancelled failed', err.message);
  }
}
