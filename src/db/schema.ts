import { pgTable, uuid, integer, text, timestamp, index } from 'drizzle-orm/pg-core';

export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  githubId: integer('github_id').unique().notNull(),
  username: text('username').notNull(),
  avatarUrl: text('avatar_url'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const listings = pgTable('listings', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').references(() => users.id).notNull(),
  type: text('type').notNull(), // 'selling' | 'buying'
  provider: text('provider').notNull(),
  title: text('title').notNull(),
  description: text('description'),
  faceValue: integer('face_value'), // cents
  askingPrice: integer('asking_price').notNull(), // cents
  creditType: text('credit_type').notNull(), // 'redemption code' | 'API key' | 'account login' | 'org invite'
  proofLink: text('proof_link'),
  contactInfo: text('contact_info').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export const messages = pgTable('messages', {
  id: uuid('id').primaryKey().defaultRandom(),
  listingId: uuid('listing_id').references(() => listings.id, { onDelete: 'cascade' }).notNull(),
  senderId: uuid('sender_id').references(() => users.id).notNull(),
  buyerId: uuid('buyer_id').references(() => users.id).notNull(),
  body: text('body').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (table) => [
  index('messages_conv_idx').on(table.listingId, table.buyerId, table.createdAt),
]);
