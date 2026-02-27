import { Hono } from 'hono';
import { eq, desc } from 'drizzle-orm';
import { db } from '../db/index.js';
import { users, listings } from '../db/schema.js';
import { requireAuth } from '../middleware/auth.js';

const ADMIN_USERNAME = process.env.ADMIN_USERNAME || 'sefikaozturk';

const me = new Hono();

me.get('/', requireAuth, async (c) => {
  const user = c.get('user')!;

  const userRow = await db.select().from(users).where(eq(users.id, user.sub)).limit(1);
  if (userRow.length === 0) return c.json({ error: 'User not found' }, 404);

  const userListings = await db.select({
    id: listings.id, type: listings.type, provider: listings.provider,
    title: listings.title, description: listings.description,
    faceValue: listings.faceValue, askingPrice: listings.askingPrice,
    creditType: listings.creditType, proofLink: listings.proofLink,
    contactInfo: listings.contactInfo, createdAt: listings.createdAt,
    updatedAt: listings.updatedAt, userId: listings.userId,
  }).from(listings)
    .where(eq(listings.userId, user.sub))
    .orderBy(desc(listings.createdAt));

  return c.json({
    user: { ...userRow[0], isAdmin: userRow[0].username === ADMIN_USERNAME },
    listings: userListings,
  });
});

export default me;
