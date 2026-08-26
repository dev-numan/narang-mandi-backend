/**
 * Resets the password for named drivers and re-emits their WhatsApp welcome link.
 *
 * `provision-pending-drivers.js` generates a random password, hashes it into the
 * database, and writes the plaintext only to driver-accounts.json — which the
 * next run overwrites. A driver provisioned in an earlier batch that same day
 * therefore has no recoverable password, and bcrypt cannot give it back. This
 * script issues a fresh one instead.
 *
 * Passwords follow the create-driver.js convention — first name plus four
 * digits — because these are read out over the phone, not copied and pasted.
 *
 *   node src/scripts/reset-driver-passwords.js --phones 03456558213,03499099501
 *   node src/scripts/reset-driver-passwords.js --phones ... --apply
 */
import 'dotenv/config';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { PrismaClient } from '@prisma/client';
import { hashPassword } from '../lib/password.js';

const prisma = new PrismaClient();
const APPLY = process.argv.includes('--apply');

const APP_URL = 'https://play.google.com/store/apps/details?id=com.narangmandi';
const GUIDE_URL = 'https://www.narangmandi.com/driver/guide';

const WELCOME_TEMPLATE = (email, password) => `السلام علیکم!

نارنگ منڈی ٹیکسی سروس میں آپ کو خوش آمدید۔ آپ کا ڈرائیور اکاؤنٹ تیار ہو گیا ہے۔

ای میل:
${email}

پاس ورڈ:
${password}

موبائل ایپ ڈاؤن لوڈ کریں:
${APP_URL}

تصویروں کے ساتھ مکمل گائیڈ:
${GUIDE_URL}

ہدایات:

1۔ اوپر دیئے گئے لنک سے موبائل ایپ انسٹال کریں۔
2۔ ایپ میں اپنے ای میل اور پاس ورڈ کے ذریعے لاگ اِن کریں۔
3۔ لاگ اِن کے بعد آپ کو نئی سواریوں کی درخواستیں نظر آئیں گی — سواری کہاں سے کہاں تک ہے اور کس وقت۔
4۔ جو سواری آپ کو مناسب لگے، اس پر اپنا کرایہ بھیج دیں۔
5۔ گاہک تمام کرایوں میں سے خود ڈرائیور منتخب کرے گا۔ آپ کا کرایہ منظور ہوتے ہی آپ کو اطلاع مل جائے گی اور گاہک کا نمبر آپ کو دکھائی دے گا۔
6۔ گاہک سے رابطہ کر کے سواری مکمل کریں۔

نوٹ: نئی سواری کی اطلاع صرف ایپ پر آتی ہے۔ اس لیے ایپ ضرور انسٹال کریں اور نوٹیفیکیشن آن رکھیں۔

مزید معلومات کے لیے اسی پیغام کا جواب دیں۔ ہماری ٹیم آپ کی مدد کے لیے حاضر ہے۔

شکریہ!
نارنگ منڈی ڈیجیٹل ہب`;

function arg(flag) {
  const i = process.argv.indexOf(`--${flag}`);
  return i === -1 ? '' : String(process.argv[i + 1] || '').trim();
}

/// 2–9 only: 0/1 are misread as O/l when a password is read out loud.
function digits(n) {
  const bytes = crypto.randomBytes(n);
  let out = '';
  for (let i = 0; i < n; i++) out += String((bytes[i] % 8) + 2);
  return out;
}

const PREFIXES = new Set(['muhammad', 'mohammad', 'md', 'mr', 'rana', 'mian', 'ch', 'chaudhry']);

/// Single letters are dropped as well as the honorifics: "H M nadeem" is
/// initials plus a name, and "h" is not something a driver can be told to type.
function firstName(name) {
  const tokens = String(name || '')
    .toLowerCase()
    .replace(/[^a-z\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
  const usable = tokens.filter((t) => !PREFIXES.has(t) && t.length > 1);
  return (usable[0] || tokens.find((t) => t.length > 1) || '').slice(0, 14);
}

/// Same comparison form the provisioning scripts use, so a number written as
/// 0345…, 92345… or +92 345… all resolve to the same driver.
const key = (phone) => {
  const d = String(phone || '').replace(/\D/g, '');
  if (!d) return '';
  if (d.startsWith('92')) return d.slice(2);
  if (d.startsWith('0')) return d.slice(1);
  return d;
};

/// wa.me wants E.164 without the +; drivers write their number as 03xxxxxxxxx.
function waPhone(phone) {
  const d = String(phone || '').replace(/\D/g, '');
  if (!d) return '';
  if (d.startsWith('92')) return d;
  if (d.startsWith('0')) return `92${d.slice(1)}`;
  return d.length === 10 ? `92${d}` : d;
}

async function main() {
  const wanted = arg('phones')
    .split(',')
    .map((p) => key(p.trim()))
    .filter(Boolean);

  if (!wanted.length) {
    console.error('Pass --phones 03xxxxxxxxx,03xxxxxxxxx');
    process.exit(1);
  }

  // The driver row carries the phone the registration form captured; the User
  // row is what actually logs in, so both are needed to match then update.
  const drivers = await prisma.driver.findMany({
    include: { user: { select: { id: true, name: true, email: true, phone: true } } },
  });

  const updated = [];

  for (const phone of wanted) {
    const driver = drivers.find((d) => key(d.phone) === phone || key(d.user?.phone) === phone);

    if (!driver) {
      console.log(`  MISS  0${phone} — no driver profile`);
      continue;
    }

    const base = firstName(driver.user.name);
    if (!base) {
      console.log(`  SKIP  ${driver.user.name} — no Latin first name for a password`);
      continue;
    }

    const password = `${base}${digits(4)}`;

    if (!APPLY) {
      console.log(`  WOULD RESET  ${driver.user.name} <${driver.user.email}>  ->  ${password}`);
      continue;
    }

    const passwordHash = await hashPassword(password);
    await prisma.user.update({ where: { id: driver.user.id }, data: { passwordHash } });

    const whatsappMessage = WELCOME_TEMPLATE(driver.user.email, password);

    updated.push({
      name: driver.user.name,
      phone: driver.phone || driver.user.phone,
      email: driver.user.email,
      password,
      vehicleNumber: driver.vehicleNumber,
      app: APP_URL,
      whatsappMessage,
      waLink: `https://wa.me/${waPhone(driver.phone || driver.user.phone)}?text=${encodeURIComponent(whatsappMessage)}`,
    });

    console.log(`  RESET  ${driver.user.name} <${driver.user.email}>  ->  ${password}`);
  }

  if (APPLY && updated.length) {
    // A distinct filename from provision-pending-drivers.js on purpose: that
    // script overwrites driver-accounts.json on every run, which is how these
    // passwords were lost in the first place.
    const root = path.resolve(process.cwd(), '..');
    const out = path.resolve(root, 'driver-password-resets.json');
    fs.writeFileSync(
      out,
      JSON.stringify({ resetAt: new Date().toISOString(), drivers: updated }, null, 2),
    );

    const waMd = path.resolve(root, 'whatsapp-links-resets.md');
    const lines = [
      '# WhatsApp Links — Password Resets',
      '',
      `Generated: ${new Date().toISOString().slice(0, 10)}`,
      `Total: ${updated.length}`,
      '',
      'Click a link to open WhatsApp with the welcome message pre-filled (email + new password included).',
      '',
      '---',
      '',
    ];
    updated.forEach((c, i) => {
      lines.push(
        `${i + 1}. **${c.name}** (${c.phone}) — ${c.password} — [${c.vehicleNumber || 'ڈرائیور'}](${c.waLink})`,
      );
    });
    lines.push('');
    fs.writeFileSync(waMd, lines.join('\n'), 'utf8');

    console.log(`\n${updated.length} passwords reset, written to ${out}`);
    console.log(`WhatsApp links written to ${waMd}`);
  }

  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error(err);
  await prisma.$disconnect();
  process.exit(1);
});
