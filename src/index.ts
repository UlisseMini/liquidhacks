import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { Hono } from 'hono';
import { logger } from 'hono/logger';
import auth from './routes/auth.js';
import listingsRouter from './routes/listings.js';
import me from './routes/me.js';
import chatRouter from './routes/chat.js';
import usersRouter from './routes/users.js';
import dmRouter from './routes/dm.js';
import adminRouter from './routes/admin.js';
import aiRouter from './routes/ai.js';
import { optionalAuth } from './middleware/auth.js';

const app = new Hono();

app.use('*', logger());
app.use('*', optionalAuth);

// API routes
app.route('/api/auth', auth);
app.route('/api/listings', listingsRouter);
app.route('/api/me', me);
app.route('/api/chat', chatRouter);
app.route('/api/users', usersRouter);
app.route('/api/dm', dmRouter);
app.route('/api/admin', adminRouter);
app.route('/api/ai', aiRouter);

// Static files
app.use('/*', serveStatic({ root: './public' }));

// SPA fallback
app.get('*', serveStatic({ root: './public', path: 'index.html' }));

const port = Number(process.env.PORT) || 3000;
console.log(`Server running on http://localhost:${port}`);
serve({ fetch: app.fetch, port });
