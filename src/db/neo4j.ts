import neo4j, { type Driver } from 'neo4j-driver';

const uri = process.env.NEO4J_URI;
const username = process.env.NEO4J_USERNAME || '4f8f369e';
const password = process.env.NEO4J_PASSWORD || 'ipeDQ6_pTudfTjwD6-juA2JnNxtEgpL7oNGQLCrjBm0';

let driver: Driver | null = null;

if (uri) {
  try {
    driver = neo4j.driver(uri, neo4j.auth.basic(username, password));
    console.log('Neo4j connected');
  } catch (e) {
    console.error('Neo4j init failed:', e);
  }
}

export async function recordTrade(
  sellerId: string,
  buyerId: string,
  listingId: string,
  provider: string,
): Promise<void> {
  if (!driver) return;
  const session = driver.session();
  try {
    await session.run(
      `MERGE (s:User {id: $sellerId})
       MERGE (b:User {id: $buyerId})
       CREATE (s)-[:TRADED_WITH {listingId: $listingId, provider: $provider, tradedAt: datetime()}]->(b)`,
      { sellerId, buyerId, listingId, provider },
    );
  } finally {
    await session.close();
  }
}

export async function getTrustScore(userId: string): Promise<number> {
  if (!driver) return 0;
  const session = driver.session();
  try {
    const result = await session.run(
      `MATCH (u:User {id: $userId})-[r:TRADED_WITH]-()
       RETURN count(r) AS tradeCount`,
      { userId },
    );
    return result.records[0]?.get('tradeCount').toNumber() ?? 0;
  } catch {
    return 0;
  } finally {
    await session.close();
  }
}
