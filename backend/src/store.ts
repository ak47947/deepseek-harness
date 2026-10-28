/** PostgreSQL-owned employee model assignments and independently reported gateway cleanup. */
import type { Pool } from 'pg'
import { provisioningSchema, type Provisioning } from './protocol.ts'
import { EnterpriseSecrets } from './secrets.ts'

/** Durable employee assignment; secrets remain encrypted at rest. */
export interface AssignmentRow {
  user_id: string
  configuration: Provisioning
  gateway_key: string | null
  gateway_state: 'ready' | 'cleanup-required' | 'unconfigured'
  managed_since: Date | null
}

/** Owns the enterprise application's database records, independently from authentication tables. */
export class EnterpriseStore {
  /** @param db - Deployment PostgreSQL pool. @param secrets - Deployment encryption owner. */
  constructor(
    readonly db: Pick<Pool, 'query'>,
    private readonly secrets: EnterpriseSecrets,
  ) {}

  /** @returns Completion of the initial additive application migration. */
  async migrate(): Promise<void> {
    await this.db.query(`CREATE TABLE IF NOT EXISTS enterprise_assignment (
      user_id TEXT PRIMARY KEY REFERENCES "user"(id),
      configuration TEXT NOT NULL,
      gateway_key TEXT,
      gateway_state TEXT NOT NULL DEFAULT 'unconfigured'
        CHECK (gateway_state IN ('ready', 'cleanup-required', 'unconfigured')),
      managed_since TIMESTAMPTZ,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`)
  }

  /** @param userId - Authentication-owned stable ID. @returns Decrypted validated assignment, or null when none is assigned. */
  async assignment(userId: string): Promise<AssignmentRow | null> {
    const result = await this.db.query<{
      user_id: string
      configuration: string
      gateway_key: string | null
      gateway_state: AssignmentRow['gateway_state']
      managed_since: Date | null
    }>('SELECT * FROM enterprise_assignment WHERE user_id = $1', [userId])
    const row = result.rows[0]
    if (row === undefined) return null
    return {
      ...row,
      configuration: provisioningSchema.parse(JSON.parse(this.secrets.open(row.configuration))),
      gateway_key: row.gateway_key === null ? null : this.secrets.open(row.gateway_key),
    }
  }

  /** @returns Whether this deployment has distributed direct-provider credentials that must be revoked before managed mode. */
  async hasBasicAssignments(): Promise<boolean> {
    const result = await this.db.query<{ configuration: string }>('SELECT configuration FROM enterprise_assignment')
    return result.rows.some(
      row => provisioningSchema.parse(JSON.parse(this.secrets.open(row.configuration))).mode === 'basic',
    )
  }

  /** @param userId - Employee stable ID. @param configuration - Fully validated approved route. @returns Durable assignment completion. */
  async assign(userId: string, configuration: Provisioning): Promise<void> {
    await this.db.query(
      `INSERT INTO enterprise_assignment (user_id, configuration) VALUES ($1, $2)
      ON CONFLICT (user_id) DO UPDATE SET configuration = EXCLUDED.configuration, updated_at = CURRENT_TIMESTAMP`,
      [userId, this.secrets.seal(JSON.stringify(configuration))],
    )
  }

  /**
   * @param userId - Employee ID.
   * @param key - Gateway credential; null confirms revocation.
   * @param state - Independently observed gateway outcome.
   */
  async gateway(userId: string, key: string | null, state: AssignmentRow['gateway_state']): Promise<void> {
    await this.db.query(
      "UPDATE enterprise_assignment SET gateway_key = $2, gateway_state = $3, managed_since = CASE WHEN $3 = 'ready' THEN COALESCE(managed_since, CURRENT_TIMESTAMP) ELSE managed_since END, updated_at = CURRENT_TIMESTAMP WHERE user_id = $1",
      [userId, key === null ? null : this.secrets.seal(key), state],
    )
  }
}
