import { Hono } from 'hono';
import { eq, desc } from 'drizzle-orm';
import { db } from '../db/index.js';
import { users, listings } from '../db/schema.js';

const usersRouter = new Hono();

usersRouter.get('/:username', async (c) => {
  const username = c.req.param('username');

  const userRows = await db.select().from(users)
    .where(eq(users.username, username)).limit(1);
  if (userRows.length === 0) return c.json({ error: 'Not found' }, 404);
  const user = userRows[0];

  const userListings = await db.select({
    id: listings.id, type: listings.type, provider: listings.provider,
    title: listings.title, description: listings.description,
    faceValue: listings.faceValue, askingPrice: listings.askingPrice,
    creditType: listings.creditType, proofLink: listings.proofLink,
    contactInfo: listings.contactInfo, createdAt: listings.createdAt,
    updatedAt: listings.updatedAt, userId: listings.userId,
  }).from(listings)
    .where(eq(listings.userId, user.id))
    .orderBy(desc(listings.createdAt));

  const stats = {
    totalListings: userListings.length,
    totalFaceValue: userListings.reduce((s, l) => s + (l.faceValue || 0), 0),
  };

  return c.json({
    user: { id: user.id, username: user.username, avatarUrl: user.avatarUrl, createdAt: user.createdAt },
    stats,
    listings: userListings,
  });
});

export default usersRouter;
