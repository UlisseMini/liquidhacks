import { Context, Next } from 'hono';
import { getCookie } from 'hono/cookie';
import { verifyToken, JWTPayload } from '../lib/jwt.js';

declare module 'hono' {
  interface ContextVariableMap {
    user: JWTPayload | null;
  }
}

export async function optionalAuth(c: Context, next: Next) {
  const token = getCookie(c, 'token');
  if (token) {
    try {
      const payload = await verifyToken(token);
      c.set('user', payload);
    } catch {
      c.set('user', null);
    }
  } else {
    c.set('user', null);
  }
  await next();
}

export async function requireAuth(c: Context, next: Next) {
  const token = getCookie(c, 'token');
  if (!token) return c.json({ error: 'Unauthorized' }, 401);
  try {
    const payload = await verifyToken(token);
    c.set('user', payload);
  } catch {
    return c.json({ error: 'Invalid token' }, 401);
  }
  await next();
}
