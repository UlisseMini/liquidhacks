# CLAUDE.md

## Project
LiquidHacks - P2P marketplace for hackathon API credits. Live at https://liquidhacks.onrender.com

## Stack
- **Backend**: TypeScript + Hono + @hono/node-server + Drizzle ORM + postgres.js + jose
- **Frontend**: Vanilla HTML/CSS/JS (cyberpunk theme), served as static files by Hono
- **Auth**: GitHub OAuth → JWT in httpOnly cookie
- **Deploy**: Render free tier (web service + Postgres)

## Commands
- `npm run dev` - local dev server (tsx watch)
- `npm run build` - TypeScript compile to dist/
- `npm start` - run production build
- `npm run db:push` - push Drizzle schema to DB
- `npx drizzle-kit push` - same as above

## Architecture
- `src/index.ts` - Hono entry, mounts routes + static serving
- `src/routes/auth.ts` - GitHub OAuth (redirect, callback, logout)
- `src/routes/listings.ts` - CRUD: GET/POST/PUT/DELETE /api/listings
- `src/routes/me.ts` - GET /api/me (current user + their listings)
- `src/middleware/auth.ts` - JWT cookie verification (optionalAuth, requireAuth)
- `src/db/schema.ts` - Drizzle schema (users, listings)
- `public/` - Frontend (index.html, style.css, app.js)

## Gotchas
- `typescript`, `@types/node`, `drizzle-kit` must be in `dependencies` (not devDeps) - Render skips devDeps in production builds
- Render free tier has NO shell access
- Money stored as integer cents in DB, frontend converts with parseCents()
- GitHub OAuth consent buttons can't be clicked via browser automation (CSRF protection)
- `curl --cookie "token=<jwt>"` works; `curl -b "token=$VAR"` fails when JWT contains `=`
- External DB URL uses `.ohio-postgres.render.com` suffix; internal uses just `-a` suffix
- Two GitHub OAuth apps needed: one for localhost (port 3000), one for production callback URL

## Testing Auth Locally
Create test user + JWT without OAuth: connect to external DB URL, INSERT into users, sign JWT with same JWT_SECRET as production using jose library.

## Env Vars (Render)
DATABASE_URL, GITHUB_CLIENT_ID, GITHUB_CLIENT_SECRET, JWT_SECRET, NODE_ENV
