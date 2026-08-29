/**
 * Queues one SMS for the gateway phone and watches what happens to it.
 *
 * Unlike sms-test.js this does not simulate the phone — it queues the message
 * and then polls the row, so the status you see is what the real handset
 * actually reported. That is the difference between "the server works" and
 * "the text arrived".
 *
 *   node src/scripts/sms-send.js --phone 03100781153
 *   node src/scripts/sms-send.js --phone 03100781153 --text "Hello world"
 *   node src/scripts/sms-send.js --phone 03100781153 --wait 120
 */
import 'dotenv/config';
import prisma from '../lib/prisma.js';
import { isConfigured, send, toSmsNumber } from '../lib/notify/channels/sms.js';

const arg = (flag, fallback = '') => {
  const i = process.argv.indexOf(`--${flag}`);
  return i === -1 ? fallback : String(process.argv[i + 1] || '').trim();
};

const phone = arg('phone');
const text = arg('text', 'Hello world');
const waitSeconds = Number(arg('wait', '90'));

if (!phone) {
  console.error('Usage: node src/scripts/sms-send.js --phone 03100781153 [--text "..."] [--wait 90]');
  process.exit(1);
}

if (!isConfigured()) {
  console.error('SMS_GATEWAY_API_KEY is not set (or SMS_ENABLED=0) — the gateway is off.');
  process.exit(1);
}

const normalised = toSmsNumber(phone);
if (!normalised) {
  console.error(`"${phone}" is not a Pakistani mobile number the gateway can text.`);
  process.exit(1);
}

console.log(`to      : ${normalised}`);
console.log(`message : ${text}`);

// The channel takes a notification-shaped message; title and body are joined
// with an em dash, so a bare body is passed as the title to keep it clean.
const queued = await send({ phone, message: { title: text, body: '' } });
if (queued.status !== 'sent') {
  console.error(`could not queue: ${queued.status} — ${queued.error}`);
  await prisma.$disconnect();
  process.exit(1);
}

console.log(`queued  : ${queued.messageId}`);
console.log(`\nwaiting up to ${waitSeconds}s for the phone to collect and report…`);
console.log('  pending = waiting for the phone to poll');
console.log('  claimed = phone has it, sending');
console.log('  sent    = the handset reported success\n');

const started = Date.now();
let last = '';

while ((Date.now() - started) / 1000 < waitSeconds) {
  const row = await prisma.smsOutbox.findUnique({
    where: { id: queued.messageId },
    select: { status: true, attempts: true, error: true, sentAt: true },
  });
  if (!row) break;

  const line = `${row.status} (attempts ${row.attempts})${row.error ? ` — ${row.error}` : ''}`;
  if (line !== last) {
    console.log(`  ${new Date().toISOString().slice(11, 19)}  ${line}`);
    last = line;
  }

  if (row.status === 'sent' || row.status === 'delivered') {
    console.log('\nThe handset reported success. Check the recipient phone.');
    await prisma.$disconnect();
    process.exit(0);
  }
  if (row.status === 'failed') {
    console.log(`\nThe handset could not send it: ${row.error || 'no reason given'}`);
    await prisma.$disconnect();
    process.exit(1);
  }

  await new Promise((r) => setTimeout(r, 3000));
}

const final = await prisma.smsOutbox.findUnique({
  where: { id: queued.messageId },
  select: { status: true, attempts: true },
});

console.log(`\nStill "${final?.status}" after ${waitSeconds}s.`);
if (final?.status === 'pending') {
  console.log('The phone never polled. Check that the gateway is started in the app,');
  console.log('that the server URL is https://narangmandi.com, and that it has signal.');
} else if (final?.status === 'claimed') {
  console.log('The phone collected it but never reported back. Usually that means');
  console.log('SMS permission is not granted — check Settings > Apps > SmsGateway.');
}

await prisma.$disconnect();
