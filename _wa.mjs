import 'dotenv/config';
import prisma from './src/lib/prisma.js';
import { toWhatsAppNumber } from './src/lib/notify/channels/whatsapp.js';
for (let i=0;i<6;i++){try{await prisma.$queryRaw`SELECT 1`;break}catch{await new Promise(r=>setTimeout(r,3000))}}

const CREDS = {
  'farhan@narangdriver.com': 'farhan2048',
  'shahid2@narangdriver.com':'shahid1997',
  'amjad@narangdriver.com':  'amjad4256',
  'azeem@narangdriver.com':  'azeem5541',
  'luqman@narangdriver.com': 'luqman5856',
  'nabeel@narangdriver.com': 'nabeel5327',
};
const APP='https://play.google.com/store/apps/details?id=com.narangmandi';
const GUIDE='https://www.narangmandi.com/driver/guide';

const drivers = await prisma.driver.findMany({
  where:{ user:{ email:{ in:Object.keys(CREDS) }}},
  include:{ user:{ select:{ name:true, email:true }}},
});

for (const d of drivers) {
  const email=d.user.email, pass=CREDS[email];
  const wa = toWhatsAppNumber(d.phone);
  const msg = `السلام علیکم ${d.user.name}!

نارنگ منڈی ٹیکسی سروس میں آپ کو خوش آمدید۔ آپ کا ڈرائیور اکاؤنٹ تیار ہو گیا ہے۔

ای میل:
${email}

پاس ورڈ:
${pass}

موبائل ایپ ڈاؤن لوڈ کریں:
${APP}

طریقہ کار سمجھنے کے لیے:
${GUIDE}

ایپ میں لاگ ان کر کے اپنی گاڑی کی تصویر ضرور لگائیں تاکہ گاہک آپ پر اعتماد کریں۔`;
  console.log(`\n===== ${d.user.name}  (${d.phone}) =====`);
  if (!wa) { console.log('  !! unusable number, no link'); continue; }
  console.log(`https://wa.me/${wa}?text=${encodeURIComponent(msg)}`);
}
await prisma.$disconnect();
