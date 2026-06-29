import { Server } from 'socket.io';

// Tracks how many sockets are currently in each room (slug → count) so we can
// broadcast a live "online now" number, like a YouTube live chat.
const presence = new Map();

const roomName = (slug) => `room:${slug}`;

export function initSocket(httpServer, origins) {
  const io = new Server(httpServer, {
    cors: { origin: origins, credentials: true },
  });

  io.on('connection', (socket) => {
    let joined = null;

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
