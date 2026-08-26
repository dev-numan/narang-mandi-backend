import 'dotenv/config';
import prisma from '../lib/prisma.js';
import { isConfigured, send } from '../lib/notify/channels/fcm.js';

/**
 * One-off push broadcast to every registered device.
 *
 * Deliberately a script and not an admin endpoint: a broadcast reaches every
 * installed handset at once and cannot be recalled, so it stays behind shell
 * access until there is a reviewed UI for it.
 *
 *   node src/scripts/broadcast-push.js "<title>" "<body>"          # dry run
 *   node src/scripts/broadcast-push.js "<title>" "<body>" --send   # delivers
 */

const args = process.argv.slice(2);
const live = args.includes('--send');
const [title, body] = args.filter((a) => a !== '--send');

if (!title || !body) {
  console.error('usage: node src/scripts/broadcast-push.js "<title>" "<body>" [--send]');
  process.exit(1);
}

const rows = await prisma.deviceToken.findMany({ select: { token: true } });
const tokens = rows.map((r) => r.token);

console.log(`audience : ${tokens.length} device(s)`);
console.log(`title    : ${title}`);
console.log(`body     : ${body}`);
console.log(`fcm      : ${isConfigured() ? 'configured' : 'NOT CONFIGURED'}`);

if (!live) {
  console.log('\nDRY RUN — nothing sent. Re-run with --send to deliver.');
  await prisma.$disconnect();
  process.exit(0);
}

// sendEachForMulticast rejects more than 500 tokens in one call. Chunking now,
// while the audience is small, is what stops the first growth spurt breaking it.
const CHUNK = 500;
for (let i = 0; i < tokens.length; i += CHUNK) {
  const batch = tokens.slice(i, i + CHUNK);
  // No screen listens for `announcement`, so the tap just opens the app. A
  // data block is still sent because NmMessagingService reads it unconditionally.
  const result = await send({ tokens: batch, title, body, data: { type: 'announcement' } });
  console.log(`batch ${i / CHUNK + 1} (${batch.length} tokens): ${JSON.stringify(result)}`);
}

await prisma.$disconnect();
