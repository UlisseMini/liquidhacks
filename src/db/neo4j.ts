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

// Records (User)-[:COMPLETED_TRADE]->(Provider) when a listing is marked traded.
// Graph lets us query trust score, provider activity, and future fraud detection.
export async function recordTrade(
  userId: string,
  listingId: string,
  provider: string,
): Promise<void> {
  if (!driver) return;
  const session = driver.session();
  try {
    await session.run(
      `MERGE (u:User {id: $userId})
       MERGE (p:Provider {name: $provider})
       CREATE (u)-[:COMPLETED_TRADE {listingId: $listingId, tradedAt: datetime()}]->(p)`,
      { userId, listingId, provider },
    );
  } catch (e) {
    console.error('Neo4j recordTrade failed:', e);
  } finally {
    await session.close();
  }
}

// Count of trades this user has completed — shown as trust score on profile.
export async function getTrustScore(userId: string): Promise<number> {
  if (!driver) return 0;
  const session = driver.session();
  try {
    const result = await session.run(
      `MATCH (u:User {id: $userId})-[r:COMPLETED_TRADE]->()
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
