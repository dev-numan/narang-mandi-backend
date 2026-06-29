import 'dotenv/config';
import prisma from '../lib/prisma.js';

// Trains that stop at Narang (Narang Mandi). Times per Pakistan Railway summer
// timetable (15 April – 14 October 2026). Stored as plain "HH:MM" strings.
const TRAINS = [
  {
    name: 'علامہ اقبال ایکسپریس',
    nameEn: 'Allama Iqbal Express',
    trainType: 'ایکسپریس',
    upRoute: 'کراچی → سیالکوٹ',
    upNumber: '9 Up',
    upArrival: '13:36',
    upDeparture: '13:38',
    downRoute: 'سیالکوٹ → کراچی',
    downNumber: '10 Down',
    downArrival: '10:40',
    downDeparture: '10:42',
    classes: 'اکانومی، اے سی اسٹینڈرڈ',
    order: 1,
  },
  {
    name: 'لاثانی ایکسپریس',
    nameEn: 'Lasani Express',
    trainType: 'ایکسپریس',
    upRoute: 'لاہور → سیالکوٹ',
    upNumber: '125 Up',
    upArrival: '17:10',
    upDeparture: '17:12',
    downRoute: 'سیالکوٹ → لاہور',
    downNumber: '126 Down',
    downArrival: '08:00',
    downDeparture: '08:01',
    classes: 'اکانومی',
    order: 2,
  },
  {
    name: 'سیالکوٹ ایکسپریس',
    nameEn: 'Sialkot Express',
    trainType: 'ایکسپریس',
    upRoute: 'لاہور → وزیرآباد',
    upNumber: '171 Up',
    upArrival: '07:52',
    upDeparture: '07:54',
    downRoute: 'وزیرآباد → لاہور',
    downNumber: '172 Down',
    downArrival: '20:15',
    downDeparture: '20:17',
    classes: 'اکانومی',
    order: 3,
  },
  {
    name: 'فیض احمد فیض پسنجر',
    nameEn: 'Faiz Ahmed Faiz Passenger',
    trainType: 'پسنجر',
    upRoute: 'لاہور → نارووال',
    upNumber: '209 Up',
    upArrival: '20:55',
    upDeparture: '20:57',
    downRoute: 'نارووال → لاہور',
    downNumber: '210 Down',
    downArrival: '06:05',
    downDeparture: '06:15',
    classes: 'اکانومی',
    order: 4,
  },
];

async function run() {
  console.log('[seed-trains] clearing existing trains...');
  await prisma.train.deleteMany();
  for (const t of TRAINS) {
    await prisma.train.create({ data: t });
  }
  console.log(`[seed-trains] created ${TRAINS.length} trains ✓`);
}

run()
  .then(async () => {
    await prisma.$disconnect();
    process.exit(0);
  })
  .catch(async (err) => {
    console.error('[seed-trains] failed:', err);
    await prisma.$disconnect();
    process.exit(1);
  });
