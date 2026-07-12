import { PrismaClient } from '@prisma/client';

// Single shared client. `globalThis` guard avoids exhausting Neon connections
// when the dev server hot-reloads.
const globalForPrisma = globalThis;

export const prisma =
  globalForPrisma.__prisma ||
  new PrismaClient({
    log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
  });

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.__prisma = prisma;
}

// Interactive transactions on pooled Postgres (Railway/Neon) can fail if the
// connection drops or the default 5s timeout is exceeded. Use longer limits.
const TX_OPTS = { maxWait: 10_000, timeout: 30_000 };

export function runTransaction(fn) {
  return prisma.$transaction(fn, TX_OPTS);
}

export default prisma;
