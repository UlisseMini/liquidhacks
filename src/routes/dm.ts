import { Hono } from 'hono';
import { eq, or, and, asc, gt } from 'drizzle-orm';
import { db } from '../db/index.js';
import { users, directMessages } from '../db/schema.js';
import { requireAuth } from '../middleware/auth.js';

const dmRouter = new Hono();

// GET conversation with a user
dmRouter.get('/:userId', requireAuth, async (c) => {
  const me = c.get('user')!;
  const otherId = c.req.param('userId');
  const after = c.req.query('after');

  const convoFilter = or(
    and(eq(directMessages.senderId, me.sub), eq(directMessages.receiverId, otherId)),
    and(eq(directMessages.senderId, otherId), eq(directMessages.receiverId, me.sub)),
  );

  const msgs = await db.select().from(directMessages)
    .where(after ? and(convoFilter, gt(directMessages.createdAt, new Date(after))) : convoFilter)
    .orderBy(asc(directMessages.createdAt));

  const otherRows = await db.select().from(users).where(eq(users.id, otherId)).limit(1);

  return c.json({ messages: msgs, otherUser: otherRows[0] || null });
});

// POST send a DM
dmRouter.post('/:userId', requireAuth, async (c) => {
  const me = c.get('user')!;
  const receiverId = c.req.param('userId');
  const { body } = await c.req.json();

  if (!body?.trim()) return c.json({ error: 'Empty message' }, 400);
  if (me.sub === receiverId) return c.json({ error: 'Cannot DM yourself' }, 400);

  const receiverRows = await db.select().from(users).where(eq(users.id, receiverId)).limit(1);
  if (receiverRows.length === 0) return c.json({ error: 'User not found' }, 404);

  const inserted = await db.insert(directMessages).values({
    senderId: me.sub,
    receiverId,
    body: body.trim(),
  }).returning();

  return c.json(inserted[0], 201);
});

export default dmRouter;
