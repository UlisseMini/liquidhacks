import { Hono } from 'hono';
import { eq, and, or, desc, inArray } from 'drizzle-orm';
import Stripe from 'stripe';
import { db } from '../db/index.js';
import { users, listings, transactions } from '../db/schema.js';
import { requireAuth } from '../middleware/auth.js';

const PLATFORM_FEE_PERCENT = Number(process.env.PLATFORM_FEE_PERCENT) || 7;
const AUTO_RELEASE_HOURS = Number(process.env.AUTO_RELEASE_HOURS) || 72;
const ADMIN_USERNAME = process.env.ADMIN_USERNAME || 'sefikaozturk';

function getStripe() {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error('STRIPE_SECRET_KEY not set');
  return new Stripe(key);
}

const escrowRouter = new Hono();

// ── Config ──────────────────────────────────────────
escrowRouter.get('/config', (c) => {
  return c.json({
    publishableKey: process.env.STRIPE_PUBLISHABLE_KEY || null,
    platformFeePercent: PLATFORM_FEE_PERCENT,
  });
});

// ── Seller Onboarding ───────────────────────────────
escrowRouter.post('/onboard', requireAuth, async (c) => {
  const user = c.get('user')!;
  const stripe = getStripe();

  const [dbUser] = await db.select().from(users).where(eq(users.id, user.sub)).limit(1);
  if (!dbUser) return c.json({ error: 'User not found' }, 404);

  let accountId = dbUser.stripeAccountId;

  if (!accountId) {
    const account = await stripe.accounts.create({
      type: 'express',
      metadata: { userId: user.sub, username: dbUser.username },
    });
    accountId = account.id;
    await db.update(users).set({ stripeAccountId: accountId }).where(eq(users.id, user.sub));
  }

  const origin = new URL(c.req.url).origin;
  const link = await stripe.accountLinks.create({
    account: accountId,
    refresh_url: `${origin}/api/escrow/onboard/refresh`,
    return_url: `${origin}/?onboarded=1`,
    type: 'account_onboarding',
  });

  return c.json({ url: link.url });
});

escrowRouter.get('/onboard/refresh', requireAuth, async (c) => {
  // Re-generate onboarding link
  const user = c.get('user')!;
  const stripe = getStripe();
  const [dbUser] = await db.select().from(users).where(eq(users.id, user.sub)).limit(1);
  if (!dbUser?.stripeAccountId) return c.redirect('/');

  const origin = new URL(c.req.url).origin;
  const link = await stripe.accountLinks.create({
    account: dbUser.stripeAccountId,
    refresh_url: `${origin}/api/escrow/onboard/refresh`,
    return_url: `${origin}/?onboarded=1`,
    type: 'account_onboarding',
  });
  return c.redirect(link.url);
});

escrowRouter.get('/onboard/status', requireAuth, async (c) => {
  const user = c.get('user')!;
  const stripe = getStripe();
  const [dbUser] = await db.select().from(users).where(eq(users.id, user.sub)).limit(1);
  if (!dbUser) return c.json({ error: 'User not found' }, 404);

  if (!dbUser.stripeAccountId) {
    return c.json({ onboarded: false, hasAccount: false });
  }

  const account = await stripe.accounts.retrieve(dbUser.stripeAccountId);
  const onboarded = account.charges_enabled === true;

  if (onboarded && !dbUser.stripeOnboarded) {
    await db.update(users).set({ stripeOnboarded: true }).where(eq(users.id, user.sub));
  }

  return c.json({ onboarded, hasAccount: true });
});

// ── Create Escrow (Buyer) ───────────────────────────
escrowRouter.post('/create', requireAuth, async (c) => {
  const user = c.get('user')!;
  const stripe = getStripe();
  const { listingId } = await c.req.json();

  if (!listingId) return c.json({ error: 'listingId required' }, 400);

  // Get listing + seller
  const [listing] = await db.select().from(listings).where(eq(listings.id, listingId)).limit(1);
  if (!listing) return c.json({ error: 'Listing not found' }, 404);
  if (listing.type !== 'selling') return c.json({ error: 'Can only escrow selling listings' }, 400);
  if (listing.status !== 'active') return c.json({ error: 'Listing not active' }, 400);
  if (listing.userId === user.sub) return c.json({ error: 'Cannot buy your own listing' }, 400);

  // Check seller is onboarded
  const [seller] = await db.select().from(users).where(eq(users.id, listing.userId)).limit(1);
  if (!seller?.stripeOnboarded || !seller.stripeAccountId) {
    return c.json({ error: 'Seller has not enabled escrow payments' }, 400);
  }

  // Enforce one active tx per (listing, buyer)
  const [existing] = await db.select({ id: transactions.id }).from(transactions)
    .where(and(
      eq(transactions.listingId, listingId),
      eq(transactions.buyerId, user.sub),
      inArray(transactions.status, ['pending_payment', 'paid', 'delivered']),
    )).limit(1);
  if (existing) return c.json({ error: 'Active escrow already exists for this listing' }, 400);

  const amountCents = listing.askingPrice;
  const platformFeeCents = Math.round(amountCents * PLATFORM_FEE_PERCENT / 100);
  const sellerPayoutCents = amountCents - platformFeeCents;
  const totalChargeCents = amountCents; // buyer pays asking price; fee comes from seller's cut

  // Create transaction record first
  const [tx] = await db.insert(transactions).values({
    listingId,
    buyerId: user.sub,
    sellerId: listing.userId,
    amountCents,
    platformFeeCents,
    sellerPayoutCents,
    status: 'pending_payment',
  }).returning();

  // Create Stripe Checkout Session
  const origin = new URL(c.req.url).origin;
  const session = await stripe.checkout.sessions.create({
    mode: 'payment',
    line_items: [{
      price_data: {
        currency: 'usd',
        unit_amount: totalChargeCents,
        product_data: {
          name: listing.title,
          description: `Escrow payment for API credits — ${listing.provider}`,
        },
      },
      quantity: 1,
    }],
    metadata: {
      transactionId: tx.id,
      listingId,
      buyerId: user.sub,
      sellerId: listing.userId,
    },
    success_url: `${origin}/?escrow_paid=1`,
    cancel_url: `${origin}/?escrow_cancelled=1`,
  });

  // Store the payment intent ID once we have it
  if (session.payment_intent) {
    await db.update(transactions)
      .set({ stripePaymentIntentId: session.payment_intent as string })
      .where(eq(transactions.id, tx.id));
  }

  return c.json({
    transactionId: tx.id,
    checkoutUrl: session.url,
    amount: amountCents,
    fee: platformFeeCents,
    sellerPayout: sellerPayoutCents,
  });
});

// ── Webhook ─────────────────────────────────────────
escrowRouter.post('/webhook', async (c) => {
  const stripe = getStripe();
  const sig = c.req.header('stripe-signature');
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

  if (!sig || !webhookSecret) {
    return c.json({ error: 'Missing signature or webhook secret' }, 400);
  }

  let event: Stripe.Event;
  try {
    const body = await c.req.text();
    event = stripe.webhooks.constructEvent(body, sig, webhookSecret);
  } catch (err: any) {
    return c.json({ error: `Webhook error: ${err.message}` }, 400);
  }

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object as Stripe.Checkout.Session;
    const txId = session.metadata?.transactionId;

    if (txId) {
      const [tx] = await db.select().from(transactions)
        .where(eq(transactions.id, txId)).limit(1);

      if (tx && tx.status === 'pending_payment') {
        await db.update(transactions)
          .set({
            status: 'paid',
            stripePaymentIntentId: session.payment_intent as string || null,
            updatedAt: new Date(),
          })
          .where(eq(transactions.id, txId));
      }
    }
  } else if (event.type === 'payment_intent.succeeded') {
    const pi = event.data.object as Stripe.PaymentIntent;

    const [tx] = await db.select().from(transactions)
      .where(eq(transactions.stripePaymentIntentId, pi.id)).limit(1);

    if (tx && tx.status === 'pending_payment') {
      await db.update(transactions)
        .set({ status: 'paid', updatedAt: new Date() })
        .where(eq(transactions.id, tx.id));
    }
  }

  return c.json({ received: true });
});

// ── Seller Marks Delivered ──────────────────────────
escrowRouter.post('/:txId/deliver', requireAuth, async (c) => {
  const user = c.get('user')!;
  const txId = c.req.param('txId');

  const [tx] = await db.select().from(transactions).where(eq(transactions.id, txId)).limit(1);
  if (!tx) return c.json({ error: 'Transaction not found' }, 404);
  if (tx.sellerId !== user.sub) return c.json({ error: 'Only seller can mark delivered' }, 403);
  if (tx.status !== 'paid') return c.json({ error: 'Transaction must be in paid status' }, 400);

  const autoReleaseAt = new Date(Date.now() + AUTO_RELEASE_HOURS * 60 * 60 * 1000);

  await db.update(transactions)
    .set({ status: 'delivered', autoReleaseAt, updatedAt: new Date() })
    .where(eq(transactions.id, txId));

  return c.json({ status: 'delivered', autoReleaseAt });
});

// ── Buyer Confirms ──────────────────────────────────
escrowRouter.post('/:txId/confirm', requireAuth, async (c) => {
  const user = c.get('user')!;
  const txId = c.req.param('txId');

  const [tx] = await db.select().from(transactions).where(eq(transactions.id, txId)).limit(1);
  if (!tx) return c.json({ error: 'Transaction not found' }, 404);
  if (tx.buyerId !== user.sub) return c.json({ error: 'Only buyer can confirm' }, 403);
  if (tx.status !== 'delivered') return c.json({ error: 'Transaction must be in delivered status' }, 400);

  await releaseFunds(tx);
  return c.json({ status: 'released' });
});

// ── Buyer Disputes ──────────────────────────────────
escrowRouter.post('/:txId/dispute', requireAuth, async (c) => {
  const user = c.get('user')!;
  const txId = c.req.param('txId');
  const { reason } = await c.req.json();

  const [tx] = await db.select().from(transactions).where(eq(transactions.id, txId)).limit(1);
  if (!tx) return c.json({ error: 'Transaction not found' }, 404);
  if (tx.buyerId !== user.sub) return c.json({ error: 'Only buyer can dispute' }, 403);
  if (tx.status !== 'delivered' && tx.status !== 'paid') {
    return c.json({ error: 'Cannot dispute in current status' }, 400);
  }

  await db.update(transactions)
    .set({ status: 'disputed', disputeReason: reason || null, updatedAt: new Date() })
    .where(eq(transactions.id, txId));

  return c.json({ status: 'disputed' });
});

// ── Admin Resolves Dispute ──────────────────────────
escrowRouter.post('/:txId/resolve', requireAuth, async (c) => {
  const user = c.get('user')!;

  // Check admin
  const [dbUser] = await db.select({ username: users.username }).from(users)
    .where(eq(users.id, user.sub)).limit(1);
  if (!dbUser || dbUser.username !== ADMIN_USERNAME) {
    return c.json({ error: 'Admin only' }, 403);
  }

  const txId = c.req.param('txId');
  const { action } = await c.req.json(); // 'release' | 'refund'

  const [tx] = await db.select().from(transactions).where(eq(transactions.id, txId)).limit(1);
  if (!tx) return c.json({ error: 'Transaction not found' }, 404);
  if (tx.status !== 'disputed') return c.json({ error: 'Only disputed transactions can be resolved' }, 400);

  if (action === 'release') {
    await releaseFunds(tx);
    return c.json({ status: 'released' });
  } else if (action === 'refund') {
    await refundBuyer(tx);
    return c.json({ status: 'refunded' });
  } else {
    return c.json({ error: 'action must be release or refund' }, 400);
  }
});

// ── My Transactions ─────────────────────────────────
escrowRouter.get('/my', requireAuth, async (c) => {
  const user = c.get('user')!;

  const txs = await db.select({
    id: transactions.id,
    listingId: transactions.listingId,
    buyerId: transactions.buyerId,
    sellerId: transactions.sellerId,
    amountCents: transactions.amountCents,
    platformFeeCents: transactions.platformFeeCents,
    sellerPayoutCents: transactions.sellerPayoutCents,
    status: transactions.status,
    autoReleaseAt: transactions.autoReleaseAt,
    disputeReason: transactions.disputeReason,
    createdAt: transactions.createdAt,
    updatedAt: transactions.updatedAt,
    listingTitle: listings.title,
    listingProvider: listings.provider,
  }).from(transactions)
    .leftJoin(listings, eq(transactions.listingId, listings.id))
    .where(or(eq(transactions.buyerId, user.sub), eq(transactions.sellerId, user.sub)))
    .orderBy(desc(transactions.createdAt));

  // Check auto-release for delivered txs
  const now = new Date();
  for (const tx of txs) {
    if (tx.status === 'delivered' && tx.autoReleaseAt && tx.autoReleaseAt <= now) {
      const [fullTx] = await db.select().from(transactions).where(eq(transactions.id, tx.id)).limit(1);
      if (fullTx && fullTx.status === 'delivered') {
        await releaseFunds(fullTx);
        tx.status = 'released';
      }
    }
  }

  // Fetch usernames for display
  const userIds = [...new Set(txs.flatMap(tx => [tx.buyerId, tx.sellerId]))];
  const userMap: Record<string, string> = {};
  if (userIds.length > 0) {
    const usersData = await db.select({ id: users.id, username: users.username })
      .from(users).where(inArray(users.id, userIds));
    for (const u of usersData) userMap[u.id] = u.username;
  }

  return c.json(txs.map(tx => ({
    ...tx,
    buyerUsername: userMap[tx.buyerId] || 'unknown',
    sellerUsername: userMap[tx.sellerId] || 'unknown',
  })));
});

// ── Helpers ─────────────────────────────────────────
async function releaseFunds(tx: typeof transactions.$inferSelect) {
  const stripe = getStripe();

  const [seller] = await db.select().from(users).where(eq(users.id, tx.sellerId)).limit(1);
  if (!seller?.stripeAccountId) throw new Error('Seller has no Stripe account');

  const transfer = await stripe.transfers.create({
    amount: tx.sellerPayoutCents,
    currency: 'usd',
    destination: seller.stripeAccountId,
    metadata: { transactionId: tx.id },
  });

  await db.update(transactions)
    .set({ status: 'released', stripeTransferId: transfer.id, updatedAt: new Date() })
    .where(eq(transactions.id, tx.id));
}

async function refundBuyer(tx: typeof transactions.$inferSelect) {
  const stripe = getStripe();

  if (tx.stripePaymentIntentId) {
    await stripe.refunds.create({ payment_intent: tx.stripePaymentIntentId });
  }

  await db.update(transactions)
    .set({ status: 'refunded', updatedAt: new Date() })
    .where(eq(transactions.id, tx.id));
}

export default escrowRouter;
