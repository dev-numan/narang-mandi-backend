// End-to-end API smoke test against the configured Postgres (Neon) database.
// Assumes `npm run seed` has been run. It creates throwaway records and
// deletes them so the database is left exactly as it was found.
import 'dotenv/config';
import { createApp } from './src/app.js';
import { connectDB, disconnectDB } from './src/config/db.js';
import prisma from './src/lib/prisma.js';

await connectDB();
const app = createApp();
const server = app.listen(0);
await new Promise((r) => server.once('listening', r));
const base = `http://127.0.0.1:${server.address().port}`;

let pass = 0;
let fail = 0;
const check = (name, cond, extra = '') => {
  if (cond) { console.log(`  ✓ ${name}`); pass++; }
  else { console.log(`  ✗ ${name} ${extra}`); fail++; }
};

async function req(method, path, body, token) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(base + path, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  let data = null;
  try { data = await res.json(); } catch { /* */ }
  return { status: res.status, data };
}

// snapshot settings so we can restore them after mutating
const settingsBefore = await prisma.settings.findUnique({ where: { key: 'site' } });

console.log('## 1. Public endpoints');
let r = await req('GET', '/api/health');
check('GET /api/health', r.status === 200 && r.data.success);
r = await req('GET', '/api/categories');
check('GET /api/categories -> 6', r.data?.data?.length === 6, `got ${r.data?.data?.length}`);
check('category has _id + name', !!r.data?.data?.[0]?._id && !!r.data?.data?.[0]?.name);
r = await req('GET', '/api/articles');
check('GET /api/articles lists published', r.data?.data?.length > 0 && r.data.total > 0);
const firstSlug = r.data.data[0].slug;
check('article populates category._id', !!r.data.data[0].category?._id);
r = await req('GET', '/api/articles/carousel');
check('GET /api/articles/carousel', Array.isArray(r.data?.data));
r = await req('GET', '/api/articles/breaking');
check('GET /api/articles/breaking', Array.isArray(r.data?.data));
r = await req('GET', '/api/articles/trending');
check('GET /api/articles/trending', Array.isArray(r.data?.data));
const v1 = (await req('GET', `/api/articles/${firstSlug}`)).data.data.article.views;
const v2 = (await req('GET', `/api/articles/${firstSlug}`)).data.data.article.views;
check('GET /api/articles/:slug increments views', v2 === v1 + 1, `${v1}->${v2}`);
r = await req('GET', '/api/articles/no-such-slug-xyz');
check('Unknown slug -> 404', r.status === 404);
r = await req('GET', '/sitemap.xml');
check('GET /sitemap.xml', r.status === 200);

console.log('\n## 2. Auth + guards');
r = await req('POST', '/api/articles', { title: 'x' });
check('Create without auth -> 401', r.status === 401);
r = await req('POST', '/api/auth/login', { email: 'admin@naningmandi.com', password: 'nope' });
check('Login wrong password -> 401', r.status === 401);
r = await req('POST', '/api/auth/login', {
  email: process.env.SEED_ADMIN_EMAIL || 'admin@naningmandi.com',
  password: process.env.SEED_ADMIN_PASSWORD || 'admin12345',
});
check('Login succeeds', r.status === 200 && !!r.data?.data?.accessToken);
const token = r.data?.data?.accessToken;
r = await req('GET', '/api/auth/me', null, token);
check('GET /api/auth/me', r.status === 200 && r.data.data.role === 'admin');

console.log('\n## 3. Article CRUD (self-cleaning)');
r = await req('GET', '/api/admin/stats', null, token);
check('GET /api/admin/stats total=12', r.data?.data?.total === 12, `got ${r.data?.data?.total}`);
const cats = (await req('GET', '/api/categories')).data.data;
r = await req('POST', '/api/articles', {
  title: 'E2E ٹیسٹ خبر',
  excerpt: 'ٹیسٹ',
  content: '<p><strong>بولڈ</strong></p>',
  category: cats[0]._id,
  section: 'featured',
  isCarousel: true,
  status: 'published',
  tags: ['ٹیسٹ'],
}, token);
check('Create published -> 201', r.status === 201 && !!r.data?.data?.slug, r.data?.message || '');
const aId = r.data?.data?._id;
const aSlug = r.data?.data?.slug;
check('created article tags persisted (array)', Array.isArray(r.data?.data?.tags) && r.data.data.tags[0] === 'ٹیسٹ');
r = await req('GET', `/api/articles/${aSlug}`);
check('New article public + relations', r.status === 200 && r.data.data.article.category?.name);
r = await req('PUT', `/api/articles/${aId}`, { title: 'E2E ٹیسٹ (ترمیم)' }, token);
check('Update article', r.status === 200 && r.data.data.title.includes('ترمیم'));
r = await req('GET', '/api/admin/articles?search=ترمیم', null, token);
check('Admin search', r.data?.data?.length >= 1);
r = await req('DELETE', `/api/articles/${aId}`, null, token);
check('Delete article', r.status === 200);
r = await req('GET', `/api/articles/${aSlug}`);
check('Deleted -> 404', r.status === 404);

console.log('\n## 4. Categories / Settings / Users (self-cleaning)');
r = await req('POST', '/api/categories', { name: 'ای ٹو ای', slug: 'e2e-tech' }, token);
check('Create category', r.status === 201);
const cId = r.data?.data?._id;
r = await req('DELETE', `/api/categories/${cId}`, null, token);
check('Delete category', r.status === 200);
r = await req('PUT', '/api/settings', { tagline: 'E2E tagline' }, token);
check('Update settings (admin)', r.status === 200 && r.data.data.tagline === 'E2E tagline');
r = await req('POST', '/api/admin/users', { name: 'E2E Editor', email: 'e2e-editor@test.local', password: 'secret1', role: 'editor' }, token);
check('Create editor', r.status === 201 && r.data.data.role === 'editor');
const uId = r.data?.data?._id;

console.log('\n## cleanup');
if (uId) await prisma.user.delete({ where: { id: uId } }).then(() => console.log('  - removed e2e editor')).catch(() => {});
// restore settings exactly
await prisma.settings.update({
  where: { key: 'site' },
  data: {
    siteName: settingsBefore.siteName,
    tagline: settingsBefore.tagline,
    logo: settingsBefore.logo,
    contactEmail: settingsBefore.contactEmail,
    socialLinks: settingsBefore.socialLinks,
    breakingTicker: settingsBefore.breakingTicker,
  },
}).then(() => console.log('  - restored settings')).catch(() => {});

console.log(`\n## RESULT: ${pass} passed, ${fail} failed`);
server.close();
await disconnectDB();
process.exit(fail === 0 ? 0 : 1);
