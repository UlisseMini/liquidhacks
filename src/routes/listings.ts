import { Hono } from 'hono';
import { eq, desc } from 'drizzle-orm';
import { db } from '../db/index.js';
import { listings, users } from '../db/schema.js';
import { requireAuth } from '../middleware/auth.js';
import { recordTrade } from '../db/neo4j.js';

const listingsRouter = new Hono();

// GET all listings (public)
listingsRouter.get('/', async (c) => {
  const typeFilter = c.req.query('type');
  const applyType = (q: any) =>
    typeFilter === 'selling' || typeFilter === 'buying'
      ? q.where(eq(listings.type, typeFilter))
      : q;

  // Try with status column first; fall back without it if migration hasn't run yet
  try {
    const q = applyType(db.select({
      id: listings.id, type: listings.type, provider: listings.provider,
      title: listings.title, description: listings.description,
      faceValue: listings.faceValue, askingPrice: listings.askingPrice,
      creditType: listings.creditType, proofLink: listings.proofLink,
      contactInfo: listings.contactInfo, createdAt: listings.createdAt,
      userId: listings.userId, status: listings.status,
      username: users.username, avatarUrl: users.avatarUrl,
    }).from(listings).leftJoin(users, eq(listings.userId, users.id)).orderBy(desc(listings.createdAt)));
    return c.json(await q);
  } catch {
    const q = applyType(db.select({
      id: listings.id, type: listings.type, provider: listings.provider,
      title: listings.title, description: listings.description,
      faceValue: listings.faceValue, askingPrice: listings.askingPrice,
      creditType: listings.creditType, proofLink: listings.proofLink,
      contactInfo: listings.contactInfo, createdAt: listings.createdAt,
      userId: listings.userId,
      username: users.username, avatarUrl: users.avatarUrl,
    }).from(listings).leftJoin(users, eq(listings.userId, users.id)).orderBy(desc(listings.createdAt)));
    return c.json(await q);
  }
});

// GET single listing (public)
listingsRouter.get('/:id', async (c) => {
  const id = c.req.param('id');
  const result = await db.select({
    id: listings.id,
    type: listings.type,
    provider: listings.provider,
    title: listings.title,
    description: listings.description,
    faceValue: listings.faceValue,
    askingPrice: listings.askingPrice,
    creditType: listings.creditType,
    proofLink: listings.proofLink,
    contactInfo: listings.contactInfo,
    createdAt: listings.createdAt,
    userId: listings.userId,
    status: listings.status,
    username: users.username,
    avatarUrl: users.avatarUrl,
  })
  .from(listings)
  .leftJoin(users, eq(listings.userId, users.id))
  .where(eq(listings.id, id))
  .limit(1);

  if (result.length === 0) return c.json({ error: 'Not found' }, 404);
  return c.json(result[0]);
});

// POST create listing (auth required)
listingsRouter.post('/', requireAuth, async (c) => {
  const user = c.get('user')!;
  const body = await c.req.json();

  const { type, provider, title, description, faceValue, askingPrice, creditType, proofLink, contactInfo } = body;

  if (!type || !provider || !title || !askingPrice || !creditType || !contactInfo) {
    return c.json({ error: 'Missing required fields' }, 400);
  }

  if (type !== 'selling' && type !== 'buying') {
    return c.json({ error: 'Type must be selling or buying' }, 400);
  }

  const inserted = await db.insert(listings).values({
    userId: user.sub,
    type,
    provider,
    title,
    description: description || null,
    faceValue: faceValue ? Number(faceValue) : null,
    askingPrice: Number(askingPrice),
    creditType,
    proofLink: proofLink || null,
    contactInfo,
  }).returning();

  return c.json(inserted[0], 201);
});

// PATCH mark as traded (auth required, must own)
listingsRouter.patch('/:id/traded', requireAuth, async (c) => {
  const user = c.get('user')!;
  const id = c.req.param('id');

  const existing = await db.select({ id: listings.id, userId: listings.userId, provider: listings.provider })
    .from(listings).where(eq(listings.id, id)).limit(1);
  if (existing.length === 0) return c.json({ error: 'Not found' }, 404);
  if (existing[0].userId !== user.sub) return c.json({ error: 'Forbidden' }, 403);

  const updated = await db.update(listings)
    .set({ status: 'traded', updatedAt: new Date() })
    .where(eq(listings.id, id))
    .returning({ id: listings.id, status: listings.status });

  // Record trade in Neo4j graph: (User)-[:COMPLETED_TRADE]->(Provider)
  recordTrade(user.sub, id, existing[0].provider).catch(() => {});

  return c.json(updated[0]);
});

// PUT update listing (auth required, must own)
listingsRouter.put('/:id', requireAuth, async (c) => {
  const user = c.get('user')!;
  const id = c.req.param('id');

  const existing = await db.select({ id: listings.id, userId: listings.userId })
    .from(listings).where(eq(listings.id, id)).limit(1);
  if (existing.length === 0) return c.json({ error: 'Not found' }, 404);
  if (existing[0].userId !== user.sub) return c.json({ error: 'Forbidden' }, 403);

  const body = await c.req.json();
  const { type, provider, title, description, faceValue, askingPrice, creditType, proofLink, contactInfo } = body;

  const updated = await db.update(listings)
    .set({
      ...(type && { type }),
      ...(provider && { provider }),
      ...(title && { title }),
      ...(description !== undefined && { description }),
      ...(faceValue !== undefined && { faceValue: faceValue ? Number(faceValue) : null }),
      ...(askingPrice && { askingPrice: Number(askingPrice) }),
      ...(creditType && { creditType }),
      ...(proofLink !== undefined && { proofLink }),
      ...(contactInfo && { contactInfo }),
      updatedAt: new Date(),
    })
    .where(eq(listings.id, id))
    .returning();

  return c.json(updated[0]);
});

// DELETE listing (auth required, must own)
listingsRouter.delete('/:id', requireAuth, async (c) => {
  const user = c.get('user')!;
  const id = c.req.param('id');

  const existing = await db.select({ id: listings.id, userId: listings.userId })
    .from(listings).where(eq(listings.id, id)).limit(1);
  if (existing.length === 0) return c.json({ error: 'Not found' }, 404);
  if (existing[0].userId !== user.sub) return c.json({ error: 'Forbidden' }, 403);

  await db.delete(listings).where(eq(listings.id, id));
  return c.json({ ok: true });
});

export default listingsRouter;
