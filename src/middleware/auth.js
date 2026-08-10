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

/**
 * Attaches `req.user` when a valid token is present and does nothing otherwise.
 *
 * Device registration is the case this exists for: the same call comes from a
 * logged-in shopkeeper (whose token must be bound to their account so we know
 * where to send their orders) and from an anonymous buyer (whose token is bound
 * to nothing until they place an order).
 */
export async function optionalAuth(req, res, next) {
  try {
    const token = extractToken(req);
    if (!token) return next();
    const payload = verifyAccessToken(token);
    const user = await prisma.user.findUnique({ where: { id: payload.sub } });
    if (user) req.user = user;
  } catch {
    // An expired or malformed token means "anonymous", not "rejected".
  }
  next();
}

export function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return next(new ApiError(403, 'Insufficient permissions'));
    }
    next();
  };
}

// Category management is allowed for admins, or editors an admin has explicitly
// granted the `canManageCategories` permission.
export function requireCategoryManage(req, res, next) {
  const u = req.user;
  if (u && (u.role === 'admin' || u.canManageCategories)) return next();
  return next(new ApiError(403, 'You do not have permission to manage categories'));
}
