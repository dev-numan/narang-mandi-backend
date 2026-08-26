/**
 * Prints a click-to-send WhatsApp link for every driver.
 *
 * Read-only — it never touches the database. Two different messages come out of
 * it, because only drivers provisioned by `provision-pending-drivers.js` have a
 * recoverable password (that script writes `driver-accounts.json`); every other
 * password exists solely as a hash and cannot be put back into a message.
 *
 *   node src/scripts/driver-whatsapp-links.js
 */
import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const SITE_URL = process.env.PUBLIC_SITE_URL || 'https://www.narangmandi.com';
const PANEL_URL = `${SITE_URL}/driver/login`;
const GUIDE_URL = `${SITE_URL}/driver/guide`;
const APP_URL =
  'https://play.google.com/store/apps/details?id=com.narangmandi';

const STEPS = `ہدایات:

1۔ اوپر دیئے گئے ڈرائیور پینل کے لنک پر کلک کریں۔
2۔ اپنے ای میل اور پاس ورڈ کے ذریعے لاگ اِن کریں۔
3۔ لاگ اِن کے بعد آپ کو نئی سواریوں کی درخواستیں نظر آئیں گی — سواری کہاں سے کہاں تک ہے اور کس وقت۔
4۔ جو سواری آپ کو مناسب لگے، اس پر اپنا کرایہ بھیج دیں۔
5۔ گاہک تمام کرایوں میں سے خود ڈرائیور منتخب کرے گا۔ آپ کا کرایہ منظور ہوتے ہی آپ کو اطلاع مل جائے گی اور گاہک کا نمبر آپ کو دکھائی دے گا۔
6۔ گاہک سے رابطہ کر کے سواری مکمل کریں۔

نوٹ: نئی سواری کی اطلاع صرف ایپ پر آتی ہے۔ اس لیے ایپ ضرور انسٹال کریں اور نوٹیفیکیشن آن رکھیں۔

مزید معلومات کے لیے اسی پیغام کا جواب دیں۔ ہماری ٹیم آپ کی مدد کے لیے حاضر ہے۔

شکریہ!
نارنگ منڈی ڈیجیٹل ہب`;

const WITH_CREDENTIALS = (email, password) => `السلام علیکم!

نارنگ منڈی ٹیکسی سروس میں آپ کو خوش آمدید۔ آپ کا ڈرائیور اکاؤنٹ تیار ہو گیا ہے۔

ای میل:
${email}

پاس ورڈ:
${password}

ڈرائیور پینل:
${PANEL_URL}

موبائل ایپ ڈاؤن لوڈ کریں:
${APP_URL}

تصویروں کے ساتھ مکمل گائیڈ:
${GUIDE_URL}

${STEPS}`;

/// No password: the hash cannot be reversed, so the driver is pointed at the
/// login they already have and told how to ask for a new one.
const WITHOUT_CREDENTIALS = (email) => `السلام علیکم!

نارنگ منڈی ٹیکسی سروس میں آپ کا ڈرائیور اکاؤنٹ پہلے سے موجود ہے۔

ای میل:
${email}

ڈرائیور پینل:
${PANEL_URL}

موبائل ایپ ڈاؤن لوڈ کریں:
${APP_URL}

تصویروں کے ساتھ مکمل گائیڈ:
${GUIDE_URL}

${STEPS}

اگر آپ کو پاس ورڈ یاد نہیں تو اسی پیغام کا جواب دیں، ہم آپ کو نیا پاس ورڈ بھیج دیں گے۔`;

/// wa.me wants E.164 without the +; drivers are stored as 03xxxxxxxxx.
function waPhone(phone) {
  const digits = String(phone || '').replace(/\D/g, '');
  if (!digits) return '';
  if (digits.startsWith('92')) return digits;
  if (digits.startsWith('0')) return `92${digits.slice(1)}`;
  return digits.length === 10 ? `92${digits}` : digits;
}

/// Same normalisation on both sides so a saved account matches a driver row
/// regardless of how each number was typed.
const key = (phone) => {
  const d = String(phone || '').replace(/\D/g, '');
  if (!d) return '';
  if (d.startsWith('92')) return d.slice(2);
  if (d.startsWith('0')) return d.slice(1);
  return d;
};

function knownPasswords(root) {
  const file = path.resolve(root, 'driver-accounts.json');
  if (!fs.existsSync(file)) return new Map();
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    const rows = Array.isArray(parsed) ? parsed : parsed.drivers || [];
    return new Map(rows.filter((r) => r.password).map((r) => [key(r.phone), r.password]));
  } catch (err) {
    console.error(`Could not read driver-accounts.json: ${err.message}`);
    return new Map();
  }
}

async function main() {
  const root = path.resolve(process.cwd(), '..');
  const passwords = knownPasswords(root);

  const drivers = await prisma.driver.findMany({
    where: { isActive: true },
    orderBy: { createdAt: 'asc' },
    select: {
      phone: true,
      whatsapp: true,
      vehicleType: true,
      vehicleNumber: true,
      isVerified: true,
      user: { select: { name: true, email: true } },
    },
  });

  const rows = [];
  for (const d of drivers) {
    const phone = d.whatsapp || d.phone;
    const wa = waPhone(phone);
    const email = d.user?.email || '';
    // A number that cannot be dialled cannot be messaged; listing it as a link
    // would just produce a dead entry in the markdown.
    if (!wa || !email) {
      rows.push({ name: d.user?.name || '—', phone, email, waLink: '', note: 'no usable number' });
      continue;
    }
    const password = passwords.get(key(phone));
    const text = password ? WITH_CREDENTIALS(email, password) : WITHOUT_CREDENTIALS(email);
    rows.push({
      name: d.user?.name || '—',
      phone,
      email,
      vehicle: [d.vehicleType, d.vehicleNumber].filter(Boolean).join(' ') || '—',
      verified: d.isVerified,
      hasPassword: Boolean(password),
      waLink: `https://wa.me/${wa}?text=${encodeURIComponent(text)}`,
    });
  }

  const withCreds = rows.filter((r) => r.hasPassword).length;
  const out = path.resolve(root, 'whatsapp-links-all-drivers.md');
  const lines = [
    '# WhatsApp Links — All Active Drivers',
    '',
    `Generated: ${new Date().toISOString().slice(0, 10)}`,
    `Total: ${rows.length} — ${withCreds} with credentials, ${rows.length - withCreds} guide only`,
    '',
    '---',
    '',
  ];
  rows.forEach((r, i) => {
    const label = r.hasPassword ? 'creds + guide' : 'guide only';
    lines.push(
      r.waLink
        ? `${i + 1}. **${r.name}** (${r.phone}) — ${r.vehicle} — [${label}](${r.waLink})`
        : `${i + 1}. **${r.name}** (${r.phone}) — ${r.note}`
    );
  });
  lines.push('');
  fs.writeFileSync(out, lines.join('\n'), 'utf8');

  for (const r of rows) {
    console.log(
      `${String(r.name).padEnd(22)} ${String(r.phone).padEnd(14)} ${
        r.hasPassword ? 'creds' : 'guide'
      }  ${r.waLink ? r.waLink.slice(0, 46) + '…' : r.note}`
    );
  }
  console.log(`\n${rows.length} drivers written to ${out}`);

  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error(err);
  await prisma.$disconnect();
  process.exit(1);
});
