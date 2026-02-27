import { Hono } from 'hono';
import { eq, and, gt, sql } from 'drizzle-orm';
import { db } from '../db/index.js';
import { messages, listings, users } from '../db/schema.js';
import { requireAuth } from '../middleware/auth.js';

const chatRouter = new Hono();

// GET /api/chat/conversations - list all conversations for current user
// (must be before /:listingId routes to avoid param capture)
chatRouter.get('/conversations', requireAuth, async (c) => {
  const user = c.get('user')!;

  const convos = await db.execute(sql`
    WITH conv AS (
      SELECT DISTINCT ON (m.listing_id, m.buyer_id)
        m.listing_id,
        m.buyer_id,
        m.body AS last_body,
        m.created_at AS last_at,
        m.sender_id AS last_sender_id
      FROM messages m
      WHERE m.sender_id = ${user.sub} OR m.buyer_id = ${user.sub}
      ORDER BY m.listing_id, m.buyer_id, m.created_at DESC
    )
    SELECT
      conv.listing_id,
      conv.buyer_id,
      conv.last_body,
      conv.last_at,
      conv.last_sender_id,
      l.title AS listing_title,
      l.user_id AS seller_id,
      buyer.username AS buyer_username,
      buyer.avatar_url AS buyer_avatar_url,
      seller.username AS seller_username,
      seller.avatar_url AS seller_avatar_url
    FROM conv
    JOIN listings l ON l.id = conv.listing_id
    JOIN users buyer ON buyer.id = conv.buyer_id
    JOIN users seller ON seller.id = l.user_id
    ORDER BY conv.last_at DESC
  `);

  const results = (convos as any[]).map((row: any) => {
    const isSeller = user.sub === row.seller_id;
    return {
      listingId: row.listing_id,
      buyerId: row.buyer_id,
      listingTitle: row.listing_title,
      otherUsername: isSeller ? row.buyer_username : row.seller_username,
      otherAvatarUrl: isSeller ? row.buyer_avatar_url : row.seller_avatar_url,
      lastBody: row.last_body,
      lastAt: row.last_at,
      lastSenderId: row.last_sender_id,
    };
  });

  return c.json(results);
});

// POST /api/chat/:listingId/messages - send a message
chatRouter.post('/:listingId/messages', requireAuth, async (c) => {
  const user = c.get('user')!;
  const listingId = c.req.param('listingId');
  const { body, buyerId } = await c.req.json();

  if (!body || typeof body !== 'string' || !body.trim()) {
    return c.json({ error: 'Message body required' }, 400);
  }

  const listing = await db.select().from(listings).where(eq(listings.id, listingId)).limit(1);
  if (listing.length === 0) return c.json({ error: 'Listing not found' }, 404);

  const sellerId = listing[0].userId;
  let resolvedBuyerId: string;

  if (user.sub === sellerId) {
    if (!buyerId) return c.json({ error: 'buyerId required when seller replies' }, 400);
    resolvedBuyerId = buyerId;
  } else {
    resolvedBuyerId = user.sub;
  }

  if (user.sub !== sellerId && user.sub !== resolvedBuyerId) {
    return c.json({ error: 'Forbidden' }, 403);
  }

  const inserted = await db.insert(messages).values({
    listingId,
    senderId: user.sub,
    buyerId: resolvedBuyerId,
    body: body.trim(),
  }).returning();

  return c.json(inserted[0], 201);
});

// GET /api/chat/:listingId/messages - get messages for a conversation
chatRouter.get('/:listingId/messages', requireAuth, async (c) => {
  const user = c.get('user')!;
  const listingId = c.req.param('listingId');
  const buyerId = c.req.query('buyerId');
  const after = c.req.query('after');

  if (!buyerId) return c.json({ error: 'buyerId query param required' }, 400);

  const listing = await db.select({
    id: listings.id,
    title: listings.title,
    userId: listings.userId,
  }).from(listings).where(eq(listings.id, listingId)).limit(1);
  if (listing.length === 0) return c.json({ error: 'Listing not found' }, 404);

  const sellerId = listing[0].userId;

  if (user.sub !== sellerId && user.sub !== buyerId) {
    return c.json({ error: 'Forbidden' }, 403);
  }

  const otherUserId = user.sub === sellerId ? buyerId : sellerId;
  const otherUser = await db.select({
    id: users.id,
    username: users.username,
    avatarUrl: users.avatarUrl,
  }).from(users).where(eq(users.id, otherUserId)).limit(1);

  let conditions = and(
    eq(messages.listingId, listingId),
    eq(messages.buyerId, buyerId),
  );

  if (after) {
    conditions = and(conditions, gt(messages.createdAt, new Date(after)));
  }

  const msgs = await db.select().from(messages)
    .where(conditions!)
    .orderBy(messages.createdAt);

  return c.json({
    messages: msgs,
    listing: listing[0],
    otherUser: otherUser[0] || null,
  });
});

export default chatRouter;
