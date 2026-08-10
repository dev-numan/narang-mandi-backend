/**
 * Sends every WhatsApp template to one number, to prove the integration works.
 *
 * Goes through `lib/notify/channels/whatsapp.js` rather than calling Graph
 * directly, so a pass here means the real send path works — number
 * normalisation, template naming, parameter order and all.
 *
 * Deliberately dry by default; nothing leaves the machine without `--send`.
 *
 *   node src/scripts/whatsapp-test.js 03069761224
 *   node src/scripts/whatsapp-test.js 03069761224 --send
 */
import 'dotenv/config';
import * as whatsapp from '../lib/notify/channels/whatsapp.js';
import { TEMPLATES as ORDER_TEMPLATES } from '../lib/notify/messages.js';
import { TEMPLATES as RIDE_TEMPLATES } from '../lib/notify/rideMessages.js';

const SEND = process.argv.includes('--send');
const phone = process.argv.find((a) => /^\+?\d[\d\s-]{6,}$/.test(a));

/**
 * Sample parameters, in the order each template's body expects them.
 *
 * The counts here are the contract: a template approved with a different number
 * of {{n}} placeholders fails at send time with a 132000, which is the failure
 * that looks fine in the dashboard and only shows up in production.
 */
const CASES = [
  { template: ORDER_TEMPLATES.newOrderShop, params: ['NM-1024', 'اجمل صاحب', 'Rs 2,400'] },
  { template: ORDER_TEMPLATES.orderPlacedCustomer, params: ['حفیظ زرعی مرکز', 'NM-1024', 'Rs 2,400'] },
  { template: ORDER_TEMPLATES.orderStatusCustomer, params: ['NM-1024', 'تیار ہے', 'حفیظ زرعی مرکز'] },
  { template: RIDE_TEMPLATES.newRideDriver, params: ['نارنگ منڈی ریلوے اسٹیشن', 'مریدکے چوک', 'آج، شام 5:40 بجے'] },
  { template: RIDE_TEMPLATES.bidReceivedCustomer, params: ['3', 'Rs 500'] },
  { template: RIDE_TEMPLATES.assignedCustomer, params: ['علیم اللہ', 'Rs 500', '03001234567'] },
  { template: RIDE_TEMPLATES.assignedDriver, params: ['نارنگ منڈی ریلوے اسٹیشن', 'مریدکے چوک', 'Rs 500'] },
  { template: RIDE_TEMPLATES.cancelledDriver, params: ['نارنگ منڈی ریلوے اسٹیشن', 'مریدکے چوک'] },
];

async function main() {
  if (!phone) {
    console.error('Usage: node src/scripts/whatsapp-test.js <phone> [--send]');
    process.exit(1);
  }

  if (!whatsapp.isConfigured()) {
    console.error('WhatsApp is not configured — set WHATSAPP_PHONE_NUMBER_ID and');
    console.error('WHATSAPP_ACCESS_TOKEN in server/.env, then run again.');
    process.exit(1);
  }

  console.log(`${CASES.length} templates -> ${phone}`);
  if (!SEND) console.log('DRY RUN — pass --send to actually deliver.\n');

  let ok = 0;
  let failed = 0;
  for (const { template, params } of CASES) {
    if (!SEND) {
      console.log(`  WOULD SEND  ${template}  (${params.length} params)`);
      continue;
    }
    const result = await whatsapp.send({ phone, template, params });
    if (result.status === 'sent') {
      ok += 1;
      console.log(`  ok      ${template}`);
    } else {
      failed += 1;
      console.log(`  FAILED  ${template}\n            ${result.error || result.status}`);
    }
  }

  if (SEND) console.log(`\n${ok} sent, ${failed} failed.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
