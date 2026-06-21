import prisma from '../lib/prisma.js';

// Verifies the Postgres (Neon) connection on startup.
export async function connectDB() {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is not set');
  await prisma.$connect();
  // Lightweight ping
  await prisma.$queryRaw`SELECT 1`;
  const host = (() => {
    try {
      return new URL(process.env.DATABASE_URL).host;
    } catch {
      return 'postgres';
    }
  })();
  console.log(`[db] connected: ${host}`);
  return prisma;
}

export async function disconnectDB() {
  await prisma.$disconnect();
}
