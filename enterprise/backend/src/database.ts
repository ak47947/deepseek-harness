/** PostgreSQL transactions return only committed results and retain both operation and rollback failures. */
import type { Pool, PoolClient } from 'pg'

/**
 * Run one operation on an exclusively checked-out connection.
 * @param database - Deployment pool.
 * @param operation - Writes and reads that must commit together.
 * @returns Committed result; failed commits never report success.
 */
export async function transaction<T>(database: Pool, operation: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await database.connect()
  let discard = false
  try {
    await client.query('BEGIN')
    const result = await operation(client)
    await client.query('COMMIT')
    return result
  } catch (error) {
    try { await client.query('ROLLBACK') }
    catch (rollbackError) { discard = true; throw new AggregateError([error, rollbackError], 'Enterprise transaction could not be rolled back') }
    throw error
  } finally { client.release(discard) }
}
