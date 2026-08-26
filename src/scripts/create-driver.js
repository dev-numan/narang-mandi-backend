/**
 * Creates one driver account from the command line.
 *
 * The bulk path is `provision-pending-drivers.js`, which walks the registration
 * table. This is for the driver who never filled the form — someone who walked
 * into the office or phoned in. Same conventions as the bulk path so the two
 * cannot drift: first-name email, lowercase password, credentials appended to
 * `driver-accounts.json` for the WhatsApp link generator to pick up.
 *
 *   node src/scripts/create-driver.js --name "Numan" --phone 03069761224 \
 *     --vehicle "City LEA 6633" --type کار
 *   node src/scripts/create-driver.js ... --apply
 */
import 'dotenv/config';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { PrismaClient } from '@prisma/client';
import { hashPassword } from '../lib/password.js';

const prisma = new PrismaClient();
const APPLY = process.argv.includes('--apply');

const DOMAIN = 'narangdriver.com';

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

function firstName(name) {
  const tokens = String(name || '')
    .toLowerCase()
    .replace(/[^a-z\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
  return (tokens.filter((t) => !PREFIXES.has(t))[0] || tokens[0] || '').slice(0, 14);
}

/// Same comparison form both scripts use, so a driver cannot be added twice
/// under two spellings of the same number.
const key = (phone) => {
  const d = String(phone || '').replace(/\D/g, '');
  if (!d) return '';
  if (d.startsWith('92')) return d.slice(2);
  if (d.startsWith('0')) return d.slice(1);
  return d;
};

async function main() {
  const name = arg('name');
  const phone = arg('phone');
  const vehicleNumber = arg('vehicle');
  const vehicleType = arg('type');

  if (!name || !phone) {
    console.error('Usage: --name "Numan" --phone 03069761224 [--vehicle "City LEA 6633"] [--type کار] [--apply]');
    process.exit(1);
  }

  const existing = await prisma.driver.findMany({ select: { phone: true, whatsapp: true, user: { select: { name: true } } } });
  const clash = existing.find((d) => [key(d.phone), key(d.whatsapp)].includes(key(phone)));
  if (clash) {
    console.error(`A driver with this number already exists: ${clash.user?.name} (${clash.phone})`);
    process.exit(1);
  }

  const base = firstName(name);
  if (!base) {
    console.error(`Cannot derive an email from "${name}" — pass a name with Latin letters.`);
    process.exit(1);
  }

  // `numan`, then `numan2`, matching how the bulk script resolves a repeat.
  let local = base;
  for (let n = 2; await prisma.user.findUnique({ where: { email: `${local}@${DOMAIN}` } }); n++) {
    local = `${base}${n}`;
  }

  const email = `${local}@${DOMAIN}`;
  const password = `${base}${digits(4)}`;

  console.log(`name:     ${name}`);
  console.log(`phone:    ${phone}`);
  console.log(`vehicle:  ${[vehicleType, vehicleNumber].filter(Boolean).join(' ') || '—'}`);
  console.log(`email:    ${email}`);
  console.log(`password: ${password}`);

  if (!APPLY) {
    console.log('\nDRY RUN — pass --apply to create.');
    await prisma.$disconnect();
    return;
  }

  const passwordHash = await hashPassword(password);
  await prisma.$transaction(async (tx) => {
    const user = await tx.user.create({
      data: { name, email, role: 'driver', passwordHash, phone },
    });
    await tx.driver.create({
      data: {
        userId: user.id,
        phone,
        whatsapp: phone,
        vehicleType,
        vehicleNumber,
        isActive: true,
        // Verification is a human check on a licence; nothing here proves one.
        isVerified: false,
      },
    });
  });

  // Appended, not overwritten: this file is the only record of the credentials
  // already sent to the other drivers.
  const out = path.resolve(process.cwd(), '..', 'driver-accounts.json');
  const current = fs.existsSync(out) ? JSON.parse(fs.readFileSync(out, 'utf8')) : { drivers: [] };
  const drivers = Array.isArray(current) ? current : current.drivers || [];
  drivers.push({ name, phone, email, password, vehicleNumber, vehicleType });
  fs.writeFileSync(out, JSON.stringify({ createdAt: new Date().toISOString(), drivers }, null, 2));

  console.log(`\nCreated. Credentials appended to ${out}`);
  console.log('Next: node src/scripts/driver-whatsapp-links.js');
  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error(err);
  await prisma.$disconnect();
  process.exit(1);
});
