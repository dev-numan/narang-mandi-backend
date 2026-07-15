import fs from 'fs';
import path from 'path';
import express from 'express';
import { metaForPath, injectMeta } from '../lib/renderMeta.js';

// Serves the built React SPA AND rewrites its <head> per-route so crawlers and
// social scrapers (which don't execute JS) receive the correct title, meta
// description, canonical, Open Graph tags and JSON-LD for every URL.
//
// Enabled only when a client build is present. In local dev the Vite dev server
// serves the client, so this is skipped. On the server set CLIENT_DIST to the
// path of the built frontend (e.g. /home/ec2-user/narang-mandi-frontend/dist)
// and route non-API traffic to this Express app.
export function attachSpa(app) {
  const distDir = process.env.CLIENT_DIST
    ? path.resolve(process.env.CLIENT_DIST)
    : path.resolve(process.cwd(), '../client/dist');
  const indexPath = path.join(distDir, 'index.html');

  if (!fs.existsSync(indexPath)) {
    console.log(`[spa] no client build at ${distDir} — SPA serving disabled (dev mode)`);
    return;
  }
  console.log(`[spa] serving client build from ${distDir} with per-route SEO meta`);

  // Hashed assets, robots.txt, favicon, og image, etc. (index served manually).
  app.use(express.static(distDir, { index: false, maxAge: '30d' }));

  const template = fs.readFileSync(indexPath, 'utf8');

  app.get('*', async (req, res, next) => {
    // Let the API, uploads, sockets, sitemap and any real file 404s pass through.
    if (
      req.path.startsWith('/api') ||
      req.path.startsWith('/uploads') ||
      req.path.startsWith('/socket.io') ||
      req.path === '/sitemap.xml' ||
      req.path === '/news-sitemap.xml' ||
      path.extname(req.path) // e.g. /foo.js already handled by static → 404
    ) {
      return next();
    }
    try {
      const meta = await metaForPath(req.path);
      const html = injectMeta(template, meta);
      res.status(meta.status || 200).type('html').send(html);
    } catch (err) {
      // Never fail the page: serve the unmodified shell so users still get the app.
      res.status(200).type('html').send(template);
    }
  });
}
