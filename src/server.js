import 'dotenv/config';
import { createServer } from 'http';
import { createApp } from './app.js';
import { connectDB, disconnectDB } from './config/db.js';
import { initSocket } from './lib/socket.js';

const PORT = process.env.PORT || 5000;

async function start() {
  try {
    await connectDB();
    const app = createApp();
    const httpServer = createServer(app);

    const origins = (process.env.CLIENT_URL || 'http://localhost:5173')
      .split(',')
      .map((s) => s.trim());
    const io = initSocket(httpServer, origins);
    // Expose io to route handlers via req.app.get('io').
    app.set('io', io);

    const server = httpServer.listen(PORT, () => {
      console.log(`[server] Narang Mandi API listening on http://localhost:${PORT}`);
      console.log(`[server] socket.io ready (realtime community chat)`);
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
