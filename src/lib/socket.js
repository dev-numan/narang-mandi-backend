import { Server } from 'socket.io';
import prisma from './prisma.js';
import { verifyAccessToken } from '../utils/jwt.js';

// Tracks how many sockets are currently in each room (slug → count) so we can
// broadcast a live "online now" number, like a YouTube live chat.
const presence = new Map();

const roomName = (slug) => `room:${slug}`;

const DRIVERS_ROOM = 'drivers';
const driverRoom = (driverId) => `driver:${driverId}`;
const rideRoom = (accessToken) => `ride:${accessToken}`;

export function initSocket(httpServer, origins) {
  const io = new Server(httpServer, {
    cors: { origin: origins, credentials: true },
  });

  // Identifies the socket when it can, and never rejects: community chat is
  // anonymous by design, so a missing or bad token just means "no driver rooms
  // for you", not "no socket".
  io.use(async (socket, next) => {
    socket.data.user = null;
    socket.data.driverId = null;
    const token = socket.handshake.auth?.token;
    if (token) {
      try {
        const payload = verifyAccessToken(token);
        const user = await prisma.user.findUnique({
          where: { id: payload.sub },
          include: { driver: { select: { id: true, isActive: true } } },
        });
        if (user) {
          socket.data.user = user;
          if (user.driver?.isActive) socket.data.driverId = user.driver.id;
        }
      } catch {
        // Anonymous. Deliberately not an error.
      }
    }
    next();
  });

  io.on('connection', (socket) => {
    let joined = null;

    // The board every driver watches. Carries no customer identity — see
    // serializeRideForDriver.
    socket.on('drivers:join', () => {
      const role = socket.data.user?.role;
      if (role !== 'admin' && !socket.data.driverId) return;
      socket.join(DRIVERS_ROOM);
    });

    // One driver's private channel, for "your bid won".
    socket.on('driver:join', () => {
      if (socket.data.driverId) socket.join(driverRoom(socket.data.driverId));
    });

    // The customer has no account to authenticate, so the room name is the
    // credential: a 32-hex token only they were given. Keying this on the ride
    // id instead would open it to every driver, since they all see ride ids.
    socket.on('ride:join', (token) => {
      if (typeof token === 'string' && /^[a-f0-9]{32}$/.test(token)) socket.join(rideRoom(token));
    });

    const leave = () => {
      if (!joined) return;
      socket.leave(roomName(joined));
      const next = Math.max(0, (presence.get(joined) || 1) - 1);
      presence.set(joined, next);
      io.to(roomName(joined)).emit('presence', { slug: joined, online: next });
      joined = null;
    };

    socket.on('room:join', (slug) => {
      if (typeof slug !== 'string' || !slug) return;
      if (joined) leave();
      joined = slug;
      socket.join(roomName(slug));
      const next = (presence.get(slug) || 0) + 1;
      presence.set(slug, next);
      io.to(roomName(slug)).emit('presence', { slug, online: next });
    });

    socket.on('room:leave', leave);
    socket.on('disconnect', leave);
  });

  return io;
}

// Helpers used by controllers to broadcast changes to everyone in a room.
export function emitMessage(io, slug, message) {
  if (io) io.to(roomName(slug)).emit('message:new', { slug, message });
}

export function emitReaction(io, slug, payload) {
  if (io) io.to(roomName(slug)).emit('reaction:update', { slug, ...payload });
}

/**
 * Broadcasts a ride change to the two audiences that may see it.
 *
 * The customer's room gets the full picture; the drivers' board gets only the
 * fact that something changed plus the ride id, because everything else on a
 * ride — who asked, from where, their phone — is theirs alone. What each side
 * actually receives is decided by the serializers, not here.
 */
export function emitRide(io, kind, ride, extra = {}) {
  if (!io || !ride) return;
  if (ride.accessToken) io.to(rideRoom(ride.accessToken)).emit(`ride:${kind}`, { rideId: ride.id, ...extra });
  if (kind === 'new' || kind === 'assigned' || kind === 'cancelled' || kind === 'completed') {
    io.to(DRIVERS_ROOM).emit(`board:${kind}`, { rideId: ride.id });
  }
}

/** One driver's private channel — used to tell the winner, and only the winner. */
export function emitToDriver(io, driverId, event, payload) {
  if (io && driverId) io.to(driverRoom(driverId)).emit(event, payload);
}
