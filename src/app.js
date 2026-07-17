import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import { UPLOAD_DIR } from './middleware/upload.js';
import { notFound, errorHandler } from './middleware/error.js';
import { attachSpa } from './middleware/spa.js';

import authRoutes from './routes/auth.js';
import articleRoutes from './routes/articles.js';
import categoryRoutes from './routes/categories.js';
import uploadRoutes from './routes/upload.js';
import settingsRoutes from './routes/settings.js';
import placeRoutes from './routes/places.js';
import communityRoutes from './routes/community.js';
import trainRoutes from './routes/trains.js';
import classifiedRoutes from './routes/classifieds.js';
import shopRoutes from './routes/shops.js';
import shopAdminRoutes from './routes/shopAdmin.js';
import adminRoutes from './routes/admin.js';
import contactRoutes from './routes/contact.js';
import sitemapRoutes from './routes/sitemap.js';

export function createApp() {
  const app = express();

  // Railway puts a reverse proxy in front of the app (sets X-Forwarded-For).
  // Trust one hop so express-rate-limit reads the real client IP. Use `1`, not
  // `true` — `true` trips the rate limiter's spoofable-trust-proxy validation.
  app.set('trust proxy', 1);

  const origins = (process.env.CLIENT_URL || 'http://localhost:5173')
    .split(',')
    .map((s) => s.trim());

  app.use(
    cors({
      origin: origins,
      credentials: true,
    })
  );
  app.use(express.json({ limit: '2mb' }));
  app.use(cookieParser());

  // Serve locally-stored uploads. Long-lived cache headers ("expires") let
  // browsers/CDNs cache images — uploaded files are immutable (unique names).
  app.use('/uploads', express.static(UPLOAD_DIR, { maxAge: '30d', immutable: true }));

  app.get('/api/health', (req, res) =>
    res.json({ success: true, message: 'ok', data: { uptime: process.uptime() } })
  );

  app.use('/api/auth', authRoutes);
  app.use('/api/articles', articleRoutes);
  app.use('/api/categories', categoryRoutes);
  app.use('/api/upload', uploadRoutes);
  app.use('/api/settings', settingsRoutes);
  app.use('/api/places', placeRoutes);
  app.use('/api/community', communityRoutes);
  app.use('/api/trains', trainRoutes);
  app.use('/api/classifieds', classifiedRoutes);
  app.use('/api/shops', shopRoutes);
  app.use('/api/shop-admin', shopAdminRoutes);
  app.use('/api/admin', adminRoutes);
  app.use('/api/contact', contactRoutes);
  app.use('/', sitemapRoutes);

  // Serve the built SPA with per-route SEO meta (no-op in dev / when no build).
  attachSpa(app);

  app.use(notFound);
  app.use(errorHandler);

  return app;
}
