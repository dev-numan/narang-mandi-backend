import 'dotenv/config';
import { createApp } from './app.js';
import { connectDB, disconnectDB } from './config/db.js';

const PORT = process.env.PORT || 5000;

async function start() {
  try {
    await connectDB();
    const app = createApp();
    const server = app.listen(PORT, () => {
      console.log(`[server] Narang Mandi API listening on http://localhost:${PORT}`);
      console.log(`[server] storage driver: ${process.env.STORAGE_DRIVER || 'local'}`);
    });

    const shutdown = async (signal) => {
      console.log(`\n[server] ${signal} received, shutting down...`);
      server.close();
      await disconnectDB();
      process.exit(0);
    };
    process.on('SIGINT', () => shutdown('SIGINT'));
    process.on('SIGTERM', () => shutdown('SIGTERM'));
  } catch (err) {
    console.error('[server] failed to start:', err.message);
    process.exit(1);
  }
}

start();
