import prisma from '../../prisma.js';
import { send as fcmSend, isConfigured as fcmConfigured } from './fcm.js';

/**
 * SMS through an Android phone holding a SIM.
 *
 * There is no paid gateway. The phone runs an app that polls `/api/sms-gateway`,
 * sends each message through the handset's own SMS API, and reports the result
 * back. The cost is whatever the SIM's bundle costs, which at this volume is
 * effectively nothing — and unlike WhatsApp there is no template approval and no
 * third party that can switch the channel off over a billing failure.
 *
 * This channel only *queues*. Writing the row is the send, as far as the
 * dispatcher is concerned; the FCM push that follows is a wake signal so the
 * phone polls immediately instead of waiting for its next interval. A failed
 * wake is deliberately not an error — the message is already durably queued.
 */

/// Long enough that a phone which is off overnight still gets the morning's
/// messages, short enough that nobody receives a stale ride alert.
const MAX_AGE_MS = 6 * 60 * 60 * 1000;

export function isConfigured() {
  return Boolean(process.env.SMS_GATEWAY_API_KEY) && process.env.SMS_ENABLED !== '0';
}

/**
 * Pakistani mobiles in E.164 without the leading +, the same form the WhatsApp
 * channel uses. Deliberately duplicated rather than imported: the two channels
 * are independent, and a change to one must not silently retarget the other.
 *
 * @returns the normalised number, or null if it cannot be one.
 */
export function toSmsNumber(phone) {
  const digits = String(phone || '').replace(/\D/g, '');
  if (!digits) return null;
  let national;
  if (digits.startsWith('92')) national = digits.slice(2);
  else if (digits.startsWith('0')) national = digits.slice(1);
  else national = digits;
  if (national.length !== 10 || !national.startsWith('3')) return null;
  return `92${national}`;
}

/**
 * Queues one message and nudges the phone to come and get it.
 *
 * @returns the dispatcher's usual shape. `messageId` is the outbox row id, which
 *   is what a later status callback carries, so the NotificationLog row can be
 *   matched the same way the WhatsApp webhook matches on a `wamid`.
 */
export async function send({ phone, message }) {
  const to = toSmsNumber(phone);
  if (!to) return { status: 'skipped', error: `unusable phone: ${phone || '(empty)'}` };

  // Title and body are separate for a push notification; an SMS is one string.
  // The footer is SMS-only: a text arrives with no app icon and no thread, so it
  // has to name the sender and the ride it refers to.
  const headline = [message?.title, message?.body].filter(Boolean).join(' — ');
  const body = [headline, message?.smsFooter].filter(Boolean).join('\n');
  if (!body) return { status: 'skipped', error: 'empty message' };

  let row;
  try {
    row = await prisma.smsOutbox.create({ data: { phone: to, body } });
  } catch (err) {
    return { status: 'failed', error: `queue write failed: ${err.message}` };
  }

  await wake();
  return { status: 'sent', messageId: row.id };
}

/**
 * Silent data push telling the gateway phone to poll.
 *
 * Carries no phone number and no message text: the payload travels through
 * Google, and the outbox endpoint is already authenticated, so there is nothing
 * to gain by putting the content here.
 */
async function wake() {
  const token = process.env.SMS_GATEWAY_FCM_TOKEN;
  if (!token || !fcmConfigured()) return;
  try {
    await fcmSend({ tokens: [token], data: { type: 'sms_pending' } });
  } catch (err) {
    // The row is queued; the phone will find it on its next poll regardless.
    console.error('[notify:sms] wake push failed', err.message);
  }
}

/**
 * Claims up to `limit` messages for the gateway.
 *
 * The claim and the read happen in one transaction so two polls — a retry, or a
 * second phone — cannot be handed the same message twice. Anything already
 * claimed but never confirmed is picked back up once it is older than the age
 * limit, which is what stops a phone that died mid-send from stranding rows.
 */
export async function claimBatch(limit = 25) {
  const cutoff = new Date(Date.now() - MAX_AGE_MS);
  const stale = new Date(Date.now() - 5 * 60 * 1000);

  return prisma.$transaction(async (tx) => {
    const rows = await tx.smsOutbox.findMany({
      where: {
        createdAt: { gt: cutoff },
        attempts: { lt: 3 },
        OR: [{ status: 'pending' }, { status: 'claimed', claimedAt: { lt: stale } }],
      },
      orderBy: { createdAt: 'asc' },
      take: Math.min(Math.max(Number(limit) || 25, 1), 100),
    });
    if (!rows.length) return [];

    await tx.smsOutbox.updateMany({
      where: { id: { in: rows.map((r) => r.id) } },
      data: { status: 'claimed', claimedAt: new Date(), attempts: { increment: 1 } },
    });
    return rows;
  });
}

/**
 * Records what the phone reported, on both the outbox row and the notification
 * log, so the existing admin view of delivery keeps working for SMS too.
 */
export async function recordStatus({ messageId, status, error }) {
  const ALLOWED = new Set(['sent', 'delivered', 'failed']);
  if (!ALLOWED.has(status)) return { updated: 0 };

  const data = { status, error: error ? String(error).slice(0, 500) : null };
  if (status === 'sent' || status === 'delivered') data.sentAt = new Date();

  const row = await prisma.smsOutbox
    .update({ where: { id: messageId }, data })
    .catch(() => null);
  if (!row) return { updated: 0 };

  await prisma.notificationLog
    .updateMany({
      where: { channel: 'sms', providerMessageId: messageId },
      data: { status, ...(error ? { error: String(error).slice(0, 500) } : {}) },
    })
    .catch((err) => console.error('[notify:sms] log update failed', err.message));

  return { updated: 1 };
}
