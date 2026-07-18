import 'dotenv/config';
import { pathToFileURL } from 'node:url';
import prisma from '../lib/prisma.js';
import { uniqueShortSlug, uniqueSlug } from '../utils/slugify.js';

async function generateSaleCode() {
  for (;;) {
    const saleCode = String(Math.floor(10000000 + Math.random() * 90000000));
    const exists = await prisma.classified.findUnique({ where: { saleCode } });
    if (!exists) return saleCode;
  }
}

// Prices aligned with typical Pakistan used-market ranges (mid-2026).
export const LISTINGS = [
  {
    title: 'ڈائلڈ فریج — Dawlance 12 cubic',
    description:
      'Dawlance فریج، 12 کیوبک فٹ، گھر میں استعمال شدہ۔ کولنگ بالکل ٹھیک، کمپریسر آواز نہیں کرتا اور فریزر بھی اچھی برف جماتا ہے۔ باڈی پر معمولی سکریچ کے علاوہ کوئی خرابی نہیں، دونوں دروازوں کی ربڑ صحیح ہے۔ بڑا ماڈل لے لیا ہے اس لیے فروخت کر رہے ہیں۔ چلتی حالت میں چیک کر سکتے ہیں۔',
    price: 42000,
    contactName: 'Muhammad Ashraf',
    phone: '03001234501',
    location: 'صدر بازار، نارنگ منڈی',
    categorySlug: 'for-sale',
  },
  {
    title: 'واشنگ مشین — خودکار Samsung 7kg',
    description:
      'سام سنگ فل آٹومیٹک واشنگ مشین، 7 کلو کپیسٹی۔ واش اور سپن دونوں فنکشن درست، سپن میں پانی پوری طرح نکل جاتا ہے۔ کہیں سے لیکج نہیں اور موٹر کی آواز بھی نارمل۔ اِنلیٹ پائپ ساتھ ملے گا۔ گھر شفٹ ہو رہا ہے اس لیے بیچنی ہے۔',
    price: 35000,
    contactName: 'Fatima Bibi',
    phone: '03001234502',
    location: 'رفیق آباد، نارنگ منڈی',
    categorySlug: 'for-sale',
  },
  {
    title: 'سوفہ سیٹ — 5 سیٹر',
    description:
      'لکڑی کے مضبوط فریم پر بنا 5 سیٹر صوفہ سیٹ۔ فوم اب بھی نرم اور اٹھا ہوا ہے، بیٹھنے پر دھنستا نہیں۔ کپڑا صاف، کوئی پھٹ یا نمایاں داغ نہیں۔ گھر کی شفٹنگ کی وجہ سے فروخت کر رہا ہوں۔ خود آ کر دیکھ اور بیٹھ کر پرکھ سکتے ہیں۔',
    price: 65000,
    contactName: 'Ghulam Rasool',
    phone: '03001234503',
    location: 'کالا خطائی، نارنگ منڈی',
    categorySlug: 'for-sale',
  },
  {
    title: 'ڈائننگ ٹیبل + 6 کرسیاں',
    description:
      'شیشم کی لکڑی کا ڈائننگ سیٹ، چھ کرسیوں سمیت۔ ٹیبل ٹاپ مضبوط اور بالکل سیدھا، کرسیوں کے جوڑ ٹھیک اور ہلتے نہیں۔ ایک آدھ جگہ ہلکا سکریچ ہے باقی حالت بہت اچھی، ابھی پالش کی ضرورت نہیں۔ کھانے کے کمرے کے لیے مناسب سیٹ ہے۔',
    price: 52000,
    contactName: 'Ayesha Begum',
    phone: '03001234504',
    location: 'نارنگ منڈی',
    categorySlug: 'for-sale',
  },
  {
    title: 'گیس سٹو — 3 برنر',
    description:
      'تین برنر گیس چولہا، شیشے کا ٹاپ۔ تینوں برنر تیز اور یکساں نیلی آنچ دیتے ہیں، ناب آسانی سے گھومتے ہیں۔ شیشہ صاف، کہیں کریک نہیں۔ کچن کی تزئین کے بعد نیا لگوا لیا اس لیے یہ فالتو ہے۔',
    price: 8000,
    contactName: 'Abdul Sattar',
    phone: '03001234505',
    location: 'محلہ محمد پورہ، نارنگ منڈی',
    categorySlug: 'for-sale',
  },
  {
    title: 'استری — بھاپ والی Philips',
    description:
      'فلپس بھاپ والی استری، اصل۔ گرم جلدی ہوتی ہے، تھرموسٹیٹ اور بھاپ کے سوراخ سب ٹھیک، کہیں پانی رِستا نہیں۔ سول پلیٹ صاف اور کپڑے پر نشان نہیں چھوڑتی۔ بہت کم استعمال ہوئی، ڈبہ بھی موجود ہے۔',
    price: 3200,
    contactName: 'Bushra Parveen',
    phone: '03001234506',
    location: 'ڈیرہ اشرف، نارنگ منڈی',
    categorySlug: 'for-sale',
  },
  {
    title: 'مائیکروویو اوون — 20 لیٹر',
    description:
      '20 لیٹر مائیکروویو اوون۔ ہیٹنگ، ڈیفروسٹ اور ٹائمر سب فنکشن درست کام کرتے ہیں۔ اندر سے صاف، گھومنے والی پلیٹ اور رولر رنگ ساتھ۔ دروازہ اچھی طرح لاک ہوتا ہے۔ گھر میں سنبھال کر استعمال کیا گیا ہے۔',
    price: 14500,
    contactName: 'Haji Imran',
    phone: '03001234507',
    location: 'ماڑی، نارنگ منڈی',
    categorySlug: 'for-sale',
  },
  {
    title: 'ڈبل بیڈ + میٹریس',
    description:
      'لکڑی کا ڈبل بیڈ کوئین سائز، میٹریس سمیت۔ فریم مضبوط، ہلن جلن یا آواز نہیں۔ میٹریس صاف ستھری، کوئی داغ یا گڑھا نہیں پڑا۔ سائیڈ ٹیبل کے بغیر۔ کمرہ چھوٹا پڑ گیا اس لیے بیچ رہا ہوں۔',
    price: 38000,
    contactName: 'Naseem Akhtar',
    phone: '03001234508',
    location: 'صدر بازار، نارنگ منڈی',
    categorySlug: 'for-sale',
  },
  {
    title: 'الماری — تین دروازے',
    description:
      'تین دروازوں والی بڑی الماری۔ ایک طرف پورا آئینہ، اندر ہینگر راڈ اور شیلف بنے ہوئے۔ دروازے اور تالے سب ٹھیک چلتے ہیں، لکڑی مضبوط اور دیمک وغیرہ کا کوئی مسئلہ نہیں۔ گھر خالی کر رہے ہیں اس لیے فروخت۔',
    price: 28000,
    contactName: 'Chaudhry Naeem',
    phone: '03001234509',
    location: 'رفیق آباد، نارنگ منڈی',
    categorySlug: 'for-sale',
  },
  {
    title: 'LED TV — 43 انچ TCL',
    description:
      'TCL 43 انچ LED، HD ڈسپلے۔ تصویر بالکل صاف، کوئی ڈیڈ پکسل یا لائن نہیں۔ ریموٹ، اسٹینڈ اور اصل باکس ساتھ۔ USB اور دونوں HDMI پورٹ چالو۔ گھر میں احتیاط سے استعمال ہوا ہے۔',
    price: 48000,
    contactName: 'Shazia Kausar',
    phone: '03001234510',
    location: 'کالا خطائی، نارنگ منڈی',
    categorySlug: 'for-sale',
  },
  {
    title: 'ایئر کنڈیشنر — 1.5 ٹن Gree',
    description:
      'گری 1.5 ٹن اے سی، انڈور اور آؤٹ ڈور دونوں یونٹ مکمل۔ گیس فل ہے، کولنگ بہت اچھی اور کمرہ جلدی ٹھنڈا ہوتا ہے۔ ریموٹ ساتھ، کوئی آواز یا لیکج نہیں۔ انسٹالیشن خریدار کے ذمے ہوگی۔ انورٹر پر اپ گریڈ کرنے کی وجہ سے فروخت۔',
    price: 95000,
    contactName: 'Muhammad Yousaf',
    phone: '03001234511',
    location: 'نارنگ منڈی',
    categorySlug: 'for-sale',
  },
  {
    title: 'واٹر کولر — بڑا سائز',
    description:
      'بڑے سائز کا واٹر کولر، گرمیوں میں گھر پر استعمال ہوا۔ ٹینک اندر سے صاف، موٹر اور پمپ ٹھیک چل رہے ہیں اور ٹھنڈک اچھی کرتا ہے۔ کہیں سے لیکج نہیں۔ سردیوں میں فالتو پڑا رہتا ہے اس لیے بیچ رہا ہوں۔',
    price: 12000,
    contactName: 'Saeeda Begum',
    phone: '03001234512',
    location: 'محلہ محمد پورہ، نارنگ منڈی',
    categorySlug: 'for-sale',
  },
  {
    title: 'سلائی مشین — Singer فٹ',
    description:
      'سنگَر فٹ (پیڈل) سلائی مشین، مکینیکل۔ سلائی نرم اور یکساں نکلتی ہے، سوئی اور بوبن سسٹم بالکل ٹھیک۔ لکڑی کا اسٹینڈ مضبوط اور پہیہ اسموتھ گھومتا ہے۔ گھر میں کبھی کبھار استعمال ہوئی۔ سیکھنے والوں کے لیے بہترین۔',
    price: 11000,
    contactName: 'Rukhsana Bibi',
    phone: '03001234513',
    location: 'ڈیرہ اشرف، نارنگ منڈی',
    categorySlug: 'for-sale',
  },
  {
    title: 'پریشر ککر — 10 لیٹر',
    description:
      'سٹینلیس سٹیل پریشر ککر، 10 لیٹر۔ گاسکٹ (ربڑ) نیا ڈلوایا ہے، سیٹی اور سیفٹی والو دونوں درست کام کرتے ہیں۔ نیچے سے کوئی رساؤ نہیں اور ہینڈل مضبوط۔ بڑے خاندان یا دیگ وغیرہ کے لیے موزوں۔',
    price: 5500,
    contactName: 'Tariq Mehmood',
    phone: '03001234514',
    location: 'ماڑی، نارنگ منڈی',
    categorySlug: 'for-sale',
  },
  {
    title: 'قالین — 9×12',
    description:
      'ایرانی طرز کا قالین، سائز 9×12 فٹ۔ رنگ اب بھی گہرے اور دھاگہ کہیں سے اکھڑا نہیں۔ حال ہی میں ڈرائی کلین کروایا ہے، بالکل صاف۔ فرش پر ٹائل لگوا لی ہے اس لیے فروخت۔',
    price: 22000,
    contactName: 'Khalid Hussain',
    phone: '03001234515',
    location: 'صدر بازار، نارنگ منڈی',
    categorySlug: 'for-sale',
  },
  {
    title: 'چھت کا پنکھا — 3 عدد',
    description:
      'تین چھت والے پنکھے، تینوں چلتی حالت میں اور تیز ہوا دیتے ہیں۔ کوئی آواز یا وائبریشن نہیں۔ ساتھ تار اور ریگولیٹر بھی دیے جائیں گے۔ تینوں ایک ساتھ لینے پر قیمت میں رعایت ہو جائے گی۔',
    price: 11000,
    contactName: 'Farooq Ahmad',
    phone: '03001234516',
    location: 'رفیق آباد، نارنگ منڈی',
    categorySlug: 'for-sale',
  },
  {
    title: 'ڈریسنگ ٹیبل',
    description:
      'آئینے والا ڈریسنگ ٹیبل، درازوں سمیت۔ سب دراز آسانی سے کھلتے بند ہوتے ہیں، آئینہ صاف اور کوئی دھبہ نہیں۔ لکڑی کا کام مضبوط اور جوڑ ٹھیک۔ اسٹول کے بغیر۔ کمرے کی سیٹنگ تبدیل کرنے کی وجہ سے بیچنا ہے۔',
    price: 18000,
    contactName: 'Nazia Perveen',
    phone: '03001234517',
    location: 'کالا خطائی، نارنگ منڈی',
    categorySlug: 'for-sale',
  },
  {
    title: 'پلاسٹک کرسیاں — 8 عدد',
    description:
      'آٹھ مضبوط پلاسٹک کرسیاں، وزن اچھی طرح اٹھاتی ہیں اور کوئی ٹوٹ پھوٹ یا کریک نہیں۔ شادی، مجلس یا گھر کے روزمرہ استعمال کے لیے موزوں۔ آٹھوں ایک ساتھ لینے پر قیمت مناسب کر دوں گا۔',
    price: 9500,
    contactName: 'Iqbal Sheikh',
    phone: '03001234518',
    location: 'نارنگ منڈی',
    categorySlug: 'for-sale',
  },
  {
    title: 'UPS + بیٹری — Homage',
    description:
      'ہومیج یو پی ایس ساتھ بیٹری۔ لوڈ شیڈنگ میں پنکھے اور لائٹس آرام سے چلاتا ہے، سوئچنگ فوری ہوتی ہے۔ بیٹری تقریباً ایک سال پرانی، بیک اپ اب بھی اچھا۔ وائرنگ اور کنکشن سب ٹھیک۔ سولر پر شفٹ ہو گیا اس لیے فروخت۔',
    price: 42000,
    contactName: 'Zahid Ali',
    phone: '03001234519',
    location: 'محلہ محمد پورہ، نارنگ منڈی',
    categorySlug: 'for-sale',
  },
  {
    title: 'جوسر بلینڈر — National',
    description:
      'نیشنل جوسر بلینڈر، تین جار (بلینڈر، خشک مصالحہ گرائنڈر اور جوسر)۔ موٹر مضبوط، بلیڈ تیز اور کوئی جار ٹوٹا یا کریک نہیں۔ کچن میں کم استعمال ہوا۔ سارے پرزے مکمل ملیں گے۔',
    price: 6500,
    contactName: 'Saima Riaz',
    phone: '03001234520',
    location: 'ڈیرہ اشرف، نارنگ منڈی',
    categorySlug: 'for-sale',
  },
  {
    title: 'بچوں کا سوئمنگ پول — Intex 6 فٹ',
    description:
      'بچوں کا انفلیٹیبل سوئمنگ پول (Intex)، تقریباً 6 فٹ۔ کہیں سے لیک نہیں، ہوا اچھی طرح رکتی ہے اور والو ٹھیک۔ گرمیوں میں دو تین بار استعمال ہوا۔ ساتھ ائیر پمپ بھی دے دوں گا۔',
    price: 5500,
    contactName: 'Maryam Sultana',
    phone: '03001234521',
    location: 'ماڑی، نارنگ منڈی',
    categorySlug: 'for-sale',
  },
  {
    title: 'Honda CD 70 — ماڈل 2020',
    description:
      'ہونڈا سی ڈی 70، ماڈل 2020، مکمل گھریلو استعمال۔ انجن کبھی نہیں کھلا، پک اپ اور مائلیج دونوں اچھے۔ ٹائر اور بیٹری ٹھیک حالت میں۔ نمبر پلیٹ، ٹوکن اور کاغذات مکمل، نام ٹرانسفر کے لیے تیار۔ آ کر خود چلا کر دیکھ سکتے ہیں۔',
    price: 105000,
    contactName: 'Imran Haider',
    phone: '03001234522',
    location: 'صدر بازار، نارنگ منڈی',
    categorySlug: 'vehicles',
  },
  {
    title: 'Honda CG 125 — ماڈل 2022',
    description:
      'ہونڈا سی جی 125، ماڈل 2022، کم چلی ہوئی۔ انجن سیل پیک اور جنوئن کنڈیشن، پک اپ زبردست۔ باڈی، ٹینکی اور سیٹ سب اصل حالت میں۔ ٹوکن اپ ٹو ڈیٹ اور کاغذات مکمل۔ شوقین حضرات خود آ کر معائنہ کر سکتے ہیں۔',
    price: 155000,
    contactName: 'Asif Mehmood',
    phone: '03001234523',
    location: 'رفیق آباد، نارنگ منڈی',
    categorySlug: 'vehicles',
  },
  {
    title: 'Yamaha YBR 125G — ماڈل 2021',
    description:
      'یاماہا YBR 125G، ماڈل 2021۔ سیلف اور کک دونوں چالو، انجن اسموتھ اور لمبے سفر کے لیے آرام دہ۔ ٹائر اچھی حالت میں، ڈسک بریک درست۔ کاغذات مکمل اور ٹوکن کلیئر۔ سنجیدہ خریدار رابطہ کریں۔',
    price: 265000,
    contactName: 'Waseem Akram',
    phone: '03001234524',
    location: 'کالا خطائی، نارنگ منڈی',
    categorySlug: 'vehicles',
  },
];

const CATEGORY_DEFS = {
  'for-sale': { name: 'خرید و فروخت', nameEn: 'For Sale', icon: '🛒', order: 1 },
  vehicles: { name: 'گاڑیاں', nameEn: 'Vehicles', icon: '🚗', order: 3 },
};

async function ensureCategory(slug) {
  let category = await prisma.classifiedCategory.findFirst({
    where: { OR: [{ slug }, { nameEn: CATEGORY_DEFS[slug]?.nameEn }] },
  });
  if (category) return category;

  const def = CATEGORY_DEFS[slug];
  const unique = await uniqueSlug(prisma.classifiedCategory, slug);
  category = await prisma.classifiedCategory.create({
    data: {
      name: def.name,
      nameEn: def.nameEn,
      slug: unique,
      icon: def.icon,
      order: def.order,
      isActive: true,
    },
  });
  return category;
}

async function run() {
  console.log('[seed-classified-listings] clearing existing classified listings...');
  const deleted = await prisma.classified.deleteMany();
  console.log(`[seed-classified-listings] deleted ${deleted.count} listings`);

  const forSale = await ensureCategory('for-sale');
  const vehicles = await ensureCategory('vehicles');
  const bySlug = { 'for-sale': forSale, vehicles };
  console.log(`[seed-classified-listings] categories: ${forSale.slug}, ${vehicles.slug}`);

  for (const item of LISTINGS) {
    const category = bySlug[item.categorySlug] || forSale;
    const slug = await uniqueShortSlug(prisma.classified);
    const saleCode = await generateSaleCode();
    await prisma.classified.create({
      data: {
        title: item.title,
        slug,
        description: item.description,
        price: item.price,
        negotiable: true,
        images: [],
        categoryId: category.id,
        location: item.location,
        contactName: item.contactName,
        phone: item.phone,
        isSold: true,
        saleCode,
        status: 'approved',
        submittedBy: 'seed',
      },
    });
    console.log(`  ✓ Rs ${item.price.toLocaleString('en-PK')} — ${item.title.slice(0, 42)}`);
  }

  console.log(`[seed-classified-listings] created ${LISTINGS.length} sold listings ✓`);
}

// Only run the destructive seed when this file is executed directly,
// not when it is imported for its LISTINGS data.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  run()
    .then(async () => {
      await prisma.$disconnect();
      process.exit(0);
    })
    .catch(async (err) => {
      console.error('[seed-classified-listings] failed:', err);
      await prisma.$disconnect();
      process.exit(1);
    });
}
