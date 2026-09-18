import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { query } from '../db';

export interface AuthUser {
  id: string;
  email: string;
  role: 'admin' | 'moderator' | 'user';
}

export interface AuthenticatedRequest extends Request {
  user?: AuthUser;
}

const DEFAULT_DEV_SECRET = 'quran_reels_jwt_secret_key_2026_default';
const isProduction = process.env.NODE_ENV === 'production';
let jwtSecret = process.env.JWT_SECRET;

if (!jwtSecret || jwtSecret === DEFAULT_DEV_SECRET) {
  if (isProduction) {
    throw new Error('FATAL SECURITY ERROR: JWT_SECRET environment variable must be set to a secure unique key in production! Refusing to start with default secret.');
  }
  jwtSecret = DEFAULT_DEV_SECRET;
}

const JWT_SECRET: string = jwtSecret;

export async function authenticateToken(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.startsWith('Bearer ') ? authHeader.substring(7) : null;

  if (!token) {
    req.user = undefined;
    return next();
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET) as { id: string; email: string };
    const roles = await query<any[]>(
      'SELECT role FROM user_roles WHERE user_id = ? LIMIT 1',
      [decoded.id]
    );

    const role = roles.length > 0 ? roles[0].role : 'user';

    req.user = {
      id: decoded.id,
      email: decoded.email,
      role,
    };
    next();
  } catch (err) {
    req.user = undefined;
    next();
  }
}

export function requireAuth(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  if (!req.user) {
    return res.status(401).json({ error: 'يجب تسجيل الدخول أولاً' });
  }
  next();
}

export function requireAdmin(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  if (!req.user || req.user.role !== 'admin') {
    return res.status(403).json({ error: 'صلاحيات غير كافية - متاح للمدير فقط' });
  }
  next();
}

export function signToken(user: { id: string; email: string }): string {
  return jwt.sign(
    { id: user.id, email: user.email },
    JWT_SECRET,
    { expiresIn: '30d' }
  );
}
