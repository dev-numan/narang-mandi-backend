import crypto from 'node:crypto';
import prisma from '../lib/prisma.js';
import { asyncHandler } from '../utils/asyncHandler.js';

/**
 * WhatsApp delivery receipts.
 *
 * Meta's send call returns "accepted", which only means the message was queued.
 * Everything after that — delivered, read, or failed on the far side — arrives
 * here and nowhere else. Without this endpoint a message that Meta accepts and
 * then fails to deliver is indistinguishable from one that arrived, which is
 * exactly the hole that made a silent WhatsApp outage impossible to diagnose.
 */

/// Meta's status names mapped onto the ones NotificationLog already uses.
const STATUS_MAP = {
  sent: 'sent',
  delivered: 'delivered',
  read: 'read',
  failed: 'undelivered',
};

/**
 * GET — the one-time handshake Meta performs when the webhook URL is saved.
 * It must echo hub.challenge verbatim, as plain text, or the save is rejected.
 */
export const verifyWhatsappWebhook = (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];
  const expected = process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN;

  if (!expected) {
    console.error('[webhook] WHATSAPP_WEBHOOK_VERIFY_TOKEN is not set');
    return res.sendStatus(500);
  }
  if (mode === 'subscribe' && token === expected) {
    return res.status(200).type('text/plain').send(String(challenge ?? ''));
  }
  return res.sendStatus(403);
};

/**
 * Rejects payloads that did not come from Meta.
 *
 * Skipped when no app secret is configured — the endpoint is still useful for
 * diagnosis before the secret is in place, and refusing everything would make
 * it impossible to set up.
 */
function signatureValid(req) {
  const secret = process.env.WHATSAPP_APP_SECRET;
  if (!secret) return true;

  const header = req.get('x-hub-signature-256') || '';
  if (!header.startsWith('sha256=') || !req.rawBody) return false;

  const digest = crypto.createHmac('sha256', secret).update(req.rawBody).digest('hex');
  const a = Buffer.from(header.slice('sha256='.length), 'utf8');
  const b = Buffer.from(digest, 'utf8');
  // Length check first: timingSafeEqual throws on a mismatch rather than
  // returning false.
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export const receiveWhatsappWebhook = asyncHandler(async (req, res) => {
  if (!signatureValid(req)) return res.sendStatus(401);

  // Answered before any work: Meta retries anything slower than a few seconds,
  // and a duplicate status is worse than a late one.
  res.sendStatus(200);

  const statuses = (req.body?.entry ?? [])
    .flatMap((entry) => entry?.changes ?? [])
    .flatMap((change) => change?.value?.statuses ?? []);

  for (const s of statuses) {
    const mapped = STATUS_MAP[s.status];
    if (!mapped || !s.id) continue;

    // Meta sends the whole reason object; the title is the part a human reads.
    const reason = s.errors?.[0]
      ? `${s.errors[0].code}: ${s.errors[0].title || s.errors[0].message || ''}`.trim()
      : null;

    try {
      const updated = await prisma.notificationLog.updateMany({
        where: { providerMessageId: s.id },
        data: { status: mapped, ...(reason ? { error: reason.slice(0, 500) } : {}) },
      });

      // A status with no matching row is normal for anything sent before this
      // endpoint existed, and for the test script — worth seeing, not worth
      // treating as an error.
      if (updated.count === 0) {
        console.log(`[webhook] ${mapped} for unknown message ${s.id}${reason ? ` — ${reason}` : ''}`);
      } else if (mapped === 'undelivered') {
        console.error(`[webhook] undelivered to ${s.recipient_id || '?'} — ${reason || 'no reason given'}`);
      }
    } catch (err) {
      console.error('[webhook] status update failed', err.message);
    }
  }
});
