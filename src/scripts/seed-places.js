import 'dotenv/config';
import { readFile } from 'fs/promises';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import prisma from '../lib/prisma.js';
import { uniqueSlug } from '../utils/slugify.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
// db_backup/data/places.json lives at the repo root (../../../../ from this file).
const PLACES_FILE = resolve(__dirname, '../../../db_backup/data/places.json');

// Maps the JSON category keys → Urdu display name, English name, icon, order.
const CATEGORY_META = {
  markets_and_shopping_centers: { name: 'بازار اور شاپنگ سینٹرز', nameEn: 'Markets & Shopping', icon: '🛍️', order: 1 },
  general_stores_and_retail: { name: 'جنرل اسٹورز', nameEn: 'General Stores', icon: '🏪', order: 2 },
  restaurants_and_food: { name: 'ریستوران اور کھانا', nameEn: 'Restaurants & Food', icon: '🍽️', order: 3 },
  cafes_and_quick_eats: { name: 'کیفے اور اسنیکس', nameEn: 'Cafes & Quick Eats', icon: '☕', order: 4 },
  sweets_and_bakeries: { name: 'مٹھائی اور بیکری', nameEn: 'Sweets & Bakeries', icon: '🍰', order: 5 },
  pharmacies_and_medical_stores: { name: 'فارمیسی اور میڈیکل اسٹور', nameEn: 'Pharmacies', icon: '💊', order: 6 },
  healthcare: { name: 'ہیلتھ کیئر', nameEn: 'Healthcare', icon: '🏥', order: 7 },
  banks_and_finance: { name: 'بینک اور مالیات', nameEn: 'Banks & Finance', icon: '🏦', order: 8 },
  schools_and_education: { name: 'تعلیمی ادارے', nameEn: 'Schools & Education', icon: '🎓', order: 9 },
  mosques: { name: 'مساجد', nameEn: 'Mosques', icon: '🕌', order: 10 },
  tailors: { name: 'درزی', nameEn: 'Tailors', icon: '✂️', order: 11 },
  salons_and_barbers: { name: 'سیلون اور حجام', nameEn: 'Salons & Barbers', icon: '💈', order: 12 },
  mobile_and_electronics: { name: 'موبائل اور الیکٹرانکس', nameEn: 'Mobile & Electronics', icon: '📱', order: 13 },
  fuel_stations: { name: 'پٹرول پمپ', nameEn: 'Fuel Stations', icon: '⛽', order: 14 },
  shoe_stores: { name: 'جوتوں کی دکانیں', nameEn: 'Shoe Stores', icon: '👟', order: 15 },
  jewelry_stores: { name: 'زیورات', nameEn: 'Jewelry', icon: '💍', order: 16 },
  cloth_houses_and_garments: { name: 'کپڑے اور گارمنٹس', nameEn: 'Cloth & Garments', icon: '👗', order: 17 },
  furniture_and_hardware: { name: 'فرنیچر اور ہارڈویئر', nameEn: 'Furniture & Hardware', icon: '🛋️', order: 18 },
  stationery_and_books: { name: 'اسٹیشنری اور کتب', nameEn: 'Stationery & Books', icon: '📚', order: 19 },
  fruit_grain_and_meat: { name: 'پھل، اناج اور گوشت', nameEn: 'Fruit, Grain & Meat', icon: '🥩', order: 20 },
  gyms_and_fitness: { name: 'جم اور فٹنس', nameEn: 'Gyms & Fitness', icon: '🏋️', order: 21 },
  government_and_public_services: { name: 'سرکاری اور عوامی خدمات', nameEn: 'Government Services', icon: '🏛️', order: 22 },
  other_businesses: { name: 'دیگر کاروبار', nameEn: 'Other Businesses', icon: '🏬', order: 99 },
};

// A free Google Maps link (no API key) that drops a pin on the exact coordinates.
function mapsLink(place) {
  if (place.latitude != null && place.longitude != null) {
    return `https://www.google.com/maps/search/?api=1&query=${place.latitude},${place.longitude}`;
  }
  const q = encodeURIComponent(`${place.name}, Narang Mandi`);
  return `https://www.google.com/maps/search/?api=1&query=${q}`;
}

async function run() {
  const raw = await readFile(PLACES_FILE, 'utf-8');
  const json = JSON.parse(raw);

  console.log('[seed-places] clearing existing places & place categories...');
  await prisma.place.deleteMany();
  await prisma.placeCategory.deleteMany();

  let catCount = 0;
  let placeCount = 0;

  for (const [key, items] of Object.entries(json.categories)) {
    const meta = CATEGORY_META[key] || {
      name: key.replace(/_/g, ' '),
      nameEn: key.replace(/_/g, ' '),
      icon: '📍',
      order: 90,
    };
    const slug = await uniqueSlug(prisma.placeCategory, key.replace(/_and_/g, '-').replace(/_/g, '-'));
    const category = await prisma.placeCategory.create({
      data: { name: meta.name, nameEn: meta.nameEn, slug, icon: meta.icon, order: meta.order },
    });
    catCount++;

    for (const p of items) {
      const placeSlug = await uniqueSlug(prisma.place, p.name);
      await prisma.place.create({
        data: {
          name: p.name,
          slug: placeSlug,
          categoryId: category.id,
          address: p.address || '',
          latitude: p.latitude ?? null,
          longitude: p.longitude ?? null,
          phone: p.phone_number || '',
          rating: p.rating ?? null,
          ratingCount: p.rating_count ?? null,
          hours: p.hours || '',
          googleMapsUrl: mapsLink(p),
          status: 'approved',
          submittedBy: 'Imported (Google Places)',
        },
      });
      placeCount++;
    }
  }

  console.log(`[seed-places] created ${catCount} categories and ${placeCount} places ✓`);
}

run()
  .then(async () => {
    await prisma.$disconnect();
    process.exit(0);
  })
  .catch(async (err) => {
    console.error('[seed-places] failed:', err);
    await prisma.$disconnect();
    process.exit(1);
  });
