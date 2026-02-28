# LiquidHacks

**P2P marketplace for hackathon API credits.** Hackers win API credits they'll never burn. Other builders need cheap compute. LiquidHacks connects them directly — no middlemen, no fees, no KYC.

Live at **https://liquidhacks.onrender.com**

---

## How it works

1. **List** — post credits with face value, your asking price, proof link, and contact info
2. **Browse** — filter by provider, type, price, availability
3. **Deal** — chat directly with the seller, agree on terms, transfer and pay peer-to-peer
4. **Trust** — completed trades are recorded in a graph database; verified trade count shown on profiles

---

## Sponsor Integrations

### Yutori (n1 browser agent)

Used at listing creation. When a seller clicks **✦ AI suggest**, the backend calls Yutori's `n1-20260203` model with the listing metadata (provider, credit type, face value, asking price). The model returns a factual 2–3 sentence description the seller can use or edit. This reduces friction for new listings and improves information quality in the market.

**Endpoint**: `POST /api/ai/suggest` → calls `api.yutori.com/v1/chat/completions`

---

### Neo4j Aura (graph database)

Used for trade trust scoring. Every time a user marks a listing as traded, the backend writes a graph edge:

```
(User {id})-[:COMPLETED_TRADE {listingId, tradedAt}]->(Provider {name})
```

Profile pages query the graph for the user's total completed trade count, displayed as **"N verified trades"** — a lightweight reputation signal without requiring escrow or identity verification.

This graph model also sets up future features: second-degree trust queries, fraud pattern detection, and provider-level market analytics — all natural in Cypher, awkward in SQL.

**Files**: `src/db/neo4j.ts`, called from `src/routes/listings.ts` (PATCH `/api/listings/:id/traded`) and `src/routes/users.ts`

---

## Stack

| Layer | Tech |
|---|---|
| Backend | TypeScript + Hono + @hono/node-server |
| ORM | Drizzle ORM + postgres.js |
| Database | PostgreSQL (Render managed) |
| Graph | Neo4j Aura |
| Auth | GitHub OAuth → JWT (httpOnly cookie) |
| Frontend | Vanilla HTML/CSS/JS |
| Deploy | Render free tier |

---

## Local dev

```bash
npm install
# set env vars: DATABASE_URL, GITHUB_CLIENT_ID, GITHUB_CLIENT_SECRET, JWT_SECRET
# optional: NEO4J_URI, NEO4J_USERNAME, NEO4J_PASSWORD, YUTORI_API_KEY
npm run dev
```

## Env vars (Render)

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | Postgres connection string |
| `GITHUB_CLIENT_ID` | OAuth app client ID |
| `GITHUB_CLIENT_SECRET` | OAuth app secret |
| `JWT_SECRET` | Cookie signing secret |
| `NEO4J_URI` | `neo4j+s://xxxx.databases.neo4j.io` |
| `NEO4J_USERNAME` | Aura instance username |
| `NEO4J_PASSWORD` | Aura instance password |
| `YUTORI_API_KEY` | Yutori API key |
| `ADMIN_USERNAME` | GitHub username with admin access |
