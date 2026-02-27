import { Hono } from 'hono';
import { setCookie, deleteCookie } from 'hono/cookie';
import { eq } from 'drizzle-orm';
import { db } from '../db/index.js';
import { users } from '../db/schema.js';
import { signToken } from '../lib/jwt.js';

const auth = new Hono();

auth.get('/github', (c) => {
  const clientId = process.env.GITHUB_CLIENT_ID;
  if (!clientId) return c.json({ error: 'GitHub OAuth not configured' }, 500);
  const url = `https://github.com/login/oauth/authorize?client_id=${clientId}&scope=read:user`;
  return c.redirect(url);
});

auth.get('/github/callback', async (c) => {
  const code = c.req.query('code');
  if (!code) return c.json({ error: 'Missing code' }, 400);

  // Exchange code for access token
  const tokenRes = await fetch('https://github.com/login/oauth/access_token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({
      client_id: process.env.GITHUB_CLIENT_ID,
      client_secret: process.env.GITHUB_CLIENT_SECRET,
      code,
    }),
  });
  const tokenData = await tokenRes.json() as { access_token?: string; error?: string };
  if (!tokenData.access_token) return c.json({ error: 'OAuth failed' }, 400);

  // Fetch GitHub user
  const ghRes = await fetch('https://api.github.com/user', {
    headers: { Authorization: `Bearer ${tokenData.access_token}` },
  });
  const ghUser = await ghRes.json() as { id: number; login: string; avatar_url: string };

  // Upsert user
  const existing = await db.select().from(users).where(eq(users.githubId, ghUser.id)).limit(1);
  let user;
  if (existing.length > 0) {
    const updated = await db.update(users)
      .set({ username: ghUser.login, avatarUrl: ghUser.avatar_url })
      .where(eq(users.githubId, ghUser.id))
      .returning();
    user = updated[0];
  } else {
    const inserted = await db.insert(users)
      .values({ githubId: ghUser.id, username: ghUser.login, avatarUrl: ghUser.avatar_url })
      .returning();
    user = inserted[0];
  }

  // Sign JWT and set cookie
  const jwt = await signToken({ sub: user.id, username: user.username });
  setCookie(c, 'token', jwt, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'Lax',
    path: '/',
    maxAge: 60 * 60 * 24 * 7, // 7 days
  });

  return c.redirect('/');
});

auth.post('/logout', (c) => {
  deleteCookie(c, 'token', { path: '/' });
  return c.json({ ok: true });
});

export default auth;
