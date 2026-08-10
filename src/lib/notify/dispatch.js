import prisma from '../prisma.js';
import * as fcm from './channels/fcm.js';
import * as whatsapp from './channels/whatsapp.js';

const RETRY_DELAY_MS = 1_500;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * One retry, then give up. A failed notification is logged and forgotten — the
 * unread-orders badge in shop admin is the backstop, so a queue and a worker
 * would be infrastructure bought for nothing at this volume.
 */
async function attempt(fn, delayMs) {
  const first = await fn();
  if (first.status !== 'failed') return first;
  await sleep(delayMs);
  return fn();
}

// A token is a credential. Log only enough of it to tell two devices apart.
const tokenTail = (tokens) =>
  tokens?.length ? `${tokens.length} device(s) …${String(tokens[0]).slice(-8)}` : '';

/**
 * Builds a dispatcher over a set of channels.
 *
 * Channels and the log writer are parameters rather than imports so the
 * behaviour that matters here — that a failing channel is isolated and that
 * nothing propagates to the caller — can be tested without a database or a
 * network.
 */
export function createDispatch({ channels, writeLog, delayMs = RETRY_DELAY_MS }) {
  return async function dispatch({ orderId, rideId, event, audience, message, tokens = [], phone }) {
    const jobs = channels.map(async ({ name, isConfigured, send, target }) => {
      const result = isConfigured()
        ? await attempt(() => send({ message, tokens, phone }), delayMs)
        : { status: 'skipped', error: `${name} not configured` };

      await writeLog({
        orderId,
        rideId,
        event,
        channel: name,
        audience,
        target: target({ tokens, phone }),
        status: result.status,
        error: result.error,
        providerMessageId: result.messageId ?? null,
      });
    });

    // allSettled, not all: one channel throwing must not stop the other from
    // being attempted or recorded.
    for (const outcome of await Promise.allSettled(jobs)) {
      if (outcome.status === 'rejected') {
        console.error('[notify] channel crashed', outcome.reason?.message || outcome.reason);
      }
    }
  };
}

export const REAL_CHANNELS = [
  {
    name: 'fcm',
    isConfigured: fcm.isConfigured,
    target: ({ tokens }) => tokenTail(tokens),
    send: ({ message, tokens }) =>
      fcm.send({ tokens, title: message.title, body: message.body, data: message.data }),
  },
  {
    name: 'whatsapp',
    isConfigured: whatsapp.isConfigured,
    target: ({ phone }) => phone || '',
    send: ({ message, phone }) =>
      whatsapp.send({ phone, template: message.template, params: message.params }),
  },
];

async function writeLogToDb({
  orderId,
  rideId,
  event,
  channel,
  audience,
  target,
  status,
  error,
  providerMessageId,
}) {
  // Orders and rides are the only subjects; a row belonging to neither has
  // nothing to point at, so there is nothing worth recording.
  if (!orderId && !rideId) return;
  await prisma.notificationLog
    .create({
      data: {
        orderId: orderId ?? null,
        rideId: rideId ?? null,
        event,
        channel,
        audience,
        target: target || '',
        status,
        providerMessageId: providerMessageId ?? null,
        // Postgres would take the whole thing; a truncated message is easier to
        // read in Studio and no less useful.
        error: error ? String(error).slice(0, 500) : null,
      },
    })
    .catch((err) => console.error('[notify] log write failed', err.message));
}

/**
 * Sends one message to one audience over every configured channel.
 *
 * Never throws and never rejects: notification failure must not affect the
 * request that triggered it.
 */
export const dispatch = createDispatch({
  channels: REAL_CHANNELS,
  writeLog: writeLogToDb,
});
