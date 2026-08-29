/**
 * Queues one SMS and shows what the gateway phone would collect.
 *
 * Exercises the whole path without a handset: queue a message, claim it the way
 * the phone's poll does, then record a status the way its callback does. The
 * second claim proving empty is the point — that is what stops one message being
 * sent twice, which the implementation this was modelled on gets wrong.
 *
 *   node src/scripts/sms-test.js --phone 03001234567
 *   node src/scripts/sms-test.js --phone 03001234567 --keep
 */
import 'dotenv/config';
import prisma from '../lib/prisma.js';
import { claimBatch, isConfigured, recordStatus, send, toSmsNumber } from '../lib/notify/channels/sms.js';

const arg = (flag) => {
  const i = process.argv.indexOf(`--${flag}`);
  return i === -1 ? '' : String(process.argv[i + 1] || '').trim();
};

const phone = arg('phone');
const keep = process.argv.includes('--keep');

if (!phone) {
  console.error('Usage: --phone 03001234567 [--keep]');
  process.exit(1);
}

console.log(`configured : ${isConfigured() ? 'yes' : 'NO — set SMS_GATEWAY_API_KEY'}`);
console.log(`normalised : ${toSmsNumber(phone) ?? 'REJECTED — not a Pakistani mobile'}`);

const result = await send({
  phone,
  message: { title: 'نئی سواری', body: 'نارنگ منڈی اڈا سے مریدکے' },
});
console.log(`queue      : ${JSON.stringify(result)}`);

if (result.status !== 'sent') {
  await prisma.$disconnect();
  process.exit(result.status === 'skipped' ? 0 : 1);
}

const first = await claimBatch(10);
console.log(`claim #1   : ${first.length} message(s)`);
for (const m of first) console.log(`             -> ${m.phone}: ${m.body}`);

// The same poll again. Anything returned here would be a message the handset
// sends twice.
const second = await claimBatch(10);
console.log(`claim #2   : ${second.length} message(s)  ${second.length === 0 ? '(correct — already claimed)' : '*** DUPLICATE ***'}`);

await recordStatus({ messageId: result.messageId, status: 'delivered' });
const row = await prisma.smsOutbox.findUnique({ where: { id: result.messageId } });
console.log(`final      : status=${row?.status} attempts=${row?.attempts} sentAt=${row?.sentAt?.toISOString().slice(11, 19) ?? '—'}`);

if (!keep) {
  await prisma.smsOutbox.delete({ where: { id: result.messageId } }).catch(() => {});
  console.log('cleaned    : test row removed (pass --keep to leave it)');
}

await prisma.$disconnect();
