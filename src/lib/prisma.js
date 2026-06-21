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

export default prisma;
