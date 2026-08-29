import crypto from 'node:crypto';
import { z } from 'zod';
import prisma from '../lib/prisma.js';
import { asyncHandler, ApiError } from '../utils/asyncHandler.js';
import { claimBatch, recordStatus } from '../lib/notify/channels/sms.js';

/**
 * The endpoints the Android gateway phone talks to.
 *
 * Deliberately narrow: the phone can collect its own queue and report what it
 * did, and nothing else. There is no endpoint that sends an arbitrary message to
 * an arbitrary number — an open relay on someone else's SIM is exactly the kind
 * of thing that gets a number blocked.
 */

/**
 * Constant-time key check.
 *
 * A plain `!==` leaks the length of the matching prefix through timing, which
 * over enough requests is enough to recover a shared secret. `timingSafeEqual`
 * needs equal-length buffers, so both sides are hashed first.
 */
function keyMatches(given) {
  const expected = process.env.SMS_GATEWAY_API_KEY;
  if (!expected || !given) return false;
  const a = crypto.createHash('sha256').update(String(given)).digest();
  const b = crypto.createHash('sha256').update(expected).digest();
  return crypto.timingSafeEqual(a, b);
}

/// 401 for both a missing and a wrong key: telling them apart helps an attacker
/// and helps nobody else.
function requireKey(req) {
  const given = req.get('x-api-key') || req.query.apiKey || req.body?.apiKey;
  if (!keyMatches(given)) throw new ApiError(401, 'Invalid API key');
}

/**
 * Hands the phone its next batch and marks those rows claimed in the same
 * transaction, so a retried poll cannot send the same message twice.
 */
export const getOutbox = asyncHandler(async (req, res) => {
  requireKey(req);
  const rows = await claimBatch(req.query.limit ?? 25);
  res.json({
    success: true,
    data: rows.map((r) => ({ messageId: r.id, to: r.phone, content: r.body })),
  });
});

export const statusSchema = z.object({
  messageId: z.string().min(1).max(64),
  status: z.enum(['sent', 'delivered', 'failed']),
  // nullable as well as optional: a client that serialises every field sends
  // `error: null` on success, and rejecting that would fail every good report.
  error: z.string().max(500).nullable().optional(),
});

/**
 * What the phone reports back after trying to send. Updates the outbox row and
 * the matching NotificationLog row together, so delivery reporting for SMS looks
 * the same as it already does for WhatsApp.
 */
export const postStatus = asyncHandler(async (req, res) => {
  requireKey(req);
  const { messageId, status, error } = req.body;
  const { updated } = await recordStatus({ messageId, status, error });

  // A status for a row we do not have is not an error the phone can act on —
  // it just means the row aged out. Worth seeing in the log, not worth a 4xx.
  if (!updated) console.log(`[sms-gateway] status for unknown message ${messageId}`);
  res.json({ success: true, data: { updated } });
});

/**
 * Lets an operator confirm the phone is alive and the queue is draining. A
 * growing `pending` count with an old `lastSentAt` is the signature of a gateway
 * that has gone offline, which is otherwise silent.
 */
export const getHealth = asyncHandler(async (req, res) => {
  requireKey(req);
  const [pending, claimed, failed, last] = await Promise.all([
    prisma.smsOutbox.count({ where: { status: 'pending' } }),
    prisma.smsOutbox.count({ where: { status: 'claimed' } }),
    prisma.smsOutbox.count({ where: { status: 'failed' } }),
    prisma.smsOutbox.findFirst({
      where: { sentAt: { not: null } },
      orderBy: { sentAt: 'desc' },
      select: { sentAt: true },
    }),
  ]);
  res.json({
    success: true,
    data: { pending, claimed, failed, lastSentAt: last?.sentAt ?? null },
  });
});
