import { verifyAccessToken } from '../utils/jwt.js';
import { ApiError } from '../utils/asyncHandler.js';
import prisma from '../lib/prisma.js';

// Reads the JWT from httpOnly cookie or Authorization: Bearer header.
function extractToken(req) {
  if (req.cookies?.accessToken) return req.cookies.accessToken;
  const header = req.headers.authorization || '';
  if (header.startsWith('Bearer ')) return header.slice(7);
  return null;
}

export async function requireAuth(req, res, next) {
  try {
    const token = extractToken(req);
    if (!token) throw new ApiError(401, 'Authentication required');
    const payload = verifyAccessToken(token);
    const user = await prisma.user.findUnique({ where: { id: payload.sub } });
    if (!user) throw new ApiError(401, 'User no longer exists');
    req.user = user;
    next();
  } catch (err) {
    if (err instanceof ApiError) return next(err);
    return next(new ApiError(401, 'Invalid or expired token'));
  }
}

export function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return next(new ApiError(403, 'Insufficient permissions'));
    }
    next();
  };
}
