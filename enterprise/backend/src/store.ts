/** PostgreSQL-owned employee model assignments and independently reported gateway cleanup. */
import { randomUUID } from 'node:crypto'
import type { Pool } from 'pg'
import { provisioningSchema, EnterpriseRequestError, type Provisioning, type EnterpriseModelConfigurationId } from '@deepseek-ai/dsh-enterprise-protocol'
import { EnterpriseSecrets } from './secrets.ts'

/** Durable employee assignment; secrets remain encrypted at rest. */
export interface AssignmentRow {
  user_id: string
  configuration: Provisioning
  gateway_key: string | null
  gateway_state: 'ready' | 'cleanup-required' | 'unconfigured'
  managed_since: Date | null
  uses_platform_default: boolean
  configuration_id: EnterpriseModelConfigurationId | null
}

/** Saved provider route; decrypted credentials must be removed from administration responses. */
export interface ModelConfigurationRow {
  id: EnterpriseModelConfigurationId
  name: string
  configuration: Provisioning
  isDefault: boolean
  published: boolean
}

/** Administration failures with localized recovery guidance. */
export class ModelConfigurationRequestError extends EnterpriseRequestError {
  /** @param status - HTTP failure status. @param code - Locale dictionary key for the affected configuration. */
  constructor(status: number, readonly code: 'model_configuration_not_found' | 'model_configuration_in_use' | 'model_not_published') {
    super(status)
  }
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
    await this.db.query('ALTER TABLE enterprise_assignment ADD COLUMN IF NOT EXISTS uses_platform_default BOOLEAN NOT NULL DEFAULT FALSE')
    await this.db.query(`CREATE TABLE IF NOT EXISTS enterprise_platform_default (
      id INTEGER PRIMARY KEY CHECK (id = 1), configuration TEXT NOT NULL
    )`)
    await this.db.query(`CREATE TABLE IF NOT EXISTS enterprise_model_configuration (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, configuration TEXT NOT NULL
    )`)
    await this.db.query('ALTER TABLE enterprise_model_configuration ADD COLUMN IF NOT EXISTS published BOOLEAN NOT NULL DEFAULT TRUE')
    await this.db.query('ALTER TABLE enterprise_assignment ADD COLUMN IF NOT EXISTS configuration_id TEXT REFERENCES enterprise_model_configuration(id)')
    await this.db.query('ALTER TABLE enterprise_platform_default ADD COLUMN IF NOT EXISTS configuration_id TEXT REFERENCES enterprise_model_configuration(id)')
    await this.db.query(`WITH saved AS (
      INSERT INTO enterprise_model_configuration (id, name, configuration)
      SELECT 'legacy-platform-default', 'Platform default', configuration FROM enterprise_platform_default WHERE configuration_id IS NULL
      ON CONFLICT (id) DO UPDATE SET configuration = EXCLUDED.configuration RETURNING id
    ) UPDATE enterprise_platform_default SET configuration_id = saved.id FROM saved WHERE configuration_id IS NULL`)
    await this.db.query(`WITH saved AS (
      INSERT INTO enterprise_model_configuration (id, name, configuration)
      SELECT 'legacy-user-' || a.user_id, u.name, a.configuration FROM enterprise_assignment a JOIN "user" u ON u.id = a.user_id
      WHERE NOT a.uses_platform_default AND a.configuration_id IS NULL
      ON CONFLICT (id) DO UPDATE SET configuration = EXCLUDED.configuration RETURNING id
    ) UPDATE enterprise_assignment a SET configuration_id = saved.id FROM saved WHERE saved.id = 'legacy-user-' || a.user_id AND a.configuration_id IS NULL`)
  }

  /** @param userId - Authentication-owned stable ID. @returns Decrypted validated assignment, or null when none is assigned. */
  async assignment(userId: string): Promise<AssignmentRow | null> {
    const result = await this.db.query<{
      user_id: string
      configuration: string
      gateway_key: string | null
      gateway_state: AssignmentRow['gateway_state']
      managed_since: Date | null
      uses_platform_default: boolean
      configuration_id: EnterpriseModelConfigurationId | null
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
    const result = await this.db.query<{ configuration: string }>('SELECT configuration FROM enterprise_assignment UNION ALL SELECT configuration FROM enterprise_model_configuration')
    return (await this.platformDefault())?.mode === 'basic' || result.rows.some(
      row => provisioningSchema.parse(JSON.parse(this.secrets.open(row.configuration))).mode === 'basic',
    )
  }

  /** @returns Published default route containing only its selected model, or null when no default is selected. */
  async platformDefault(): Promise<Provisioning | null> {
    const result = await this.db.query<{ configuration: string }>(`SELECT COALESCE(c.configuration, d.configuration) AS configuration
      FROM enterprise_platform_default d LEFT JOIN enterprise_model_configuration c ON c.id = d.configuration_id WHERE d.id = 1 AND (c.id IS NULL OR c.published)`)
    const row = result.rows[0]
    if (row === undefined) return null
    const configuration = provisioningSchema.parse(JSON.parse(this.secrets.open(row.configuration)))
    return { ...configuration, models: configuration.models.filter(model => model.id === configuration.defaultModel) }
  }

  /** @param configuration - Validated route inherited by employees without an override. @returns Encrypted durable default replacement. */
  async setPlatformDefault(configuration: Provisioning): Promise<void> {
    const id = 'legacy-platform-default' as EnterpriseModelConfigurationId
    await this.saveModelConfiguration(id, 'Platform default', configuration)
    await this.selectPlatformDefault(id)
  }

  /** @param userId - Employee stable ID. @param configuration - Fully validated approved route. @param usesPlatformDefault - Whether to inherit the default. @param configurationId - Saved personal route, or null for an inline assignment. @returns Durable assignment completion. */
  async assign(userId: string, configuration: Provisioning, usesPlatformDefault = false, configurationId: EnterpriseModelConfigurationId | null = null): Promise<void> {
    if (!usesPlatformDefault && configurationId === null) {
      configurationId = `legacy-user-${userId}` as EnterpriseModelConfigurationId
      await this.saveModelConfiguration(configurationId, configuration.defaultModel, configuration)
    }
    await this.db.query(
      `INSERT INTO enterprise_assignment (user_id, configuration, uses_platform_default, configuration_id) VALUES ($1, $2, $3, $4)
      ON CONFLICT (user_id) DO UPDATE SET configuration = EXCLUDED.configuration, uses_platform_default = EXCLUDED.uses_platform_default, configuration_id = EXCLUDED.configuration_id, updated_at = CURRENT_TIMESTAMP`,
      [userId, this.secrets.seal(JSON.stringify(configuration)), usesPlatformDefault, configurationId],
    )
  }

  /** @returns Saved routes, including the single selected default; credentials remain private to the caller. */
  async modelConfigurations(): Promise<ModelConfigurationRow[]> {
    const result = await this.db.query<{ id: EnterpriseModelConfigurationId; name: string; configuration: string; isDefault: boolean; published: boolean }>(
      `SELECT c.*, EXISTS (SELECT 1 FROM enterprise_platform_default d WHERE d.configuration_id = c.id) AS "isDefault"
       FROM enterprise_model_configuration c ORDER BY c.name, c.id`,
    )
    return result.rows.map(row => ({ ...row, configuration: provisioningSchema.parse(JSON.parse(this.secrets.open(row.configuration))) }))
  }

  /** @param id - Saved route identity. @returns Decrypted route. @throws When the record does not exist. */
  async modelConfiguration(id: EnterpriseModelConfigurationId): Promise<ModelConfigurationRow> {
    const result = await this.db.query<{ id: EnterpriseModelConfigurationId; name: string; configuration: string; isDefault: boolean; published: boolean }>(
      `SELECT c.*, EXISTS (SELECT 1 FROM enterprise_platform_default d WHERE d.configuration_id = c.id) AS "isDefault"
       FROM enterprise_model_configuration c WHERE c.id = $1`, [id],
    )
    const row = result.rows[0]
    if (row === undefined) throw new ModelConfigurationRequestError(404, 'model_configuration_not_found')
    return { ...row, configuration: provisioningSchema.parse(JSON.parse(this.secrets.open(row.configuration))) }
  }

  /** @param id - Existing identity, or null to create. @param name - Administrator label. @param configuration - Validated approved route. @returns Saved identity; credentials are encrypted before writing. */
  async saveModelConfiguration(id: EnterpriseModelConfigurationId | null, name: string, configuration: Provisioning): Promise<EnterpriseModelConfigurationId> {
    const savedId = id ?? (randomUUID() as EnterpriseModelConfigurationId)
    await this.db.query(`INSERT INTO enterprise_model_configuration (id, name, configuration) VALUES ($1, $2, $3)
      ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, configuration = EXCLUDED.configuration`,
    [savedId, name, this.secrets.seal(JSON.stringify(configuration))])
    return savedId
  }

  /** @param id - Published route to inherit. @returns Atomic default replacement. @throws When the record is missing or unpublished. */
  async selectPlatformDefault(id: EnterpriseModelConfigurationId): Promise<void> {
    if (!(await this.modelConfiguration(id)).published) throw new ModelConfigurationRequestError(409, 'model_not_published')
    const result = await this.db.query(`INSERT INTO enterprise_platform_default (id, configuration, configuration_id)
      SELECT 1, configuration, id FROM enterprise_model_configuration WHERE id = $1 AND published
      ON CONFLICT (id) DO UPDATE SET configuration = EXCLUDED.configuration, configuration_id = EXCLUDED.configuration_id`, [id])
    if (result.rowCount === 0) throw new ModelConfigurationRequestError(404, 'model_configuration_not_found')
  }

  /** @returns Removal of the default selection; unassigned employees receive no enterprise route. */
  async clearPlatformDefault(): Promise<void> {
    await this.db.query('DELETE FROM enterprise_platform_default WHERE id = 1')
  }

  /** @param id - Saved model identity. @param published - Whether employees may receive the model. @returns Atomic availability update, clearing the default when unpublished. */
  async publishModelConfiguration(id: EnterpriseModelConfigurationId, published: boolean): Promise<void> {
    const result = await this.db.query(`WITH cleared AS (
      DELETE FROM enterprise_platform_default WHERE configuration_id = $1 AND NOT $2::boolean
    ) UPDATE enterprise_model_configuration SET published = $2 WHERE id = $1`, [id, published])
    if (result.rowCount === 0) throw new ModelConfigurationRequestError(404, 'model_configuration_not_found')
  }

  /** @param userId - Employee whose personal selection is cleared. @returns Default inheritance without requiring a configured default; gateway state remains available for revocation. */
  async clearPersonalAssignment(userId: string): Promise<void> {
    await this.db.query('UPDATE enterprise_assignment SET uses_platform_default = TRUE, configuration_id = NULL WHERE user_id = $1', [userId])
  }

  /** @param id - Saved route identity. @returns Deletion completion. @throws When absent or referenced by the default or any personal assignment. */
  async removeModelConfiguration(id: EnterpriseModelConfigurationId): Promise<void> {
    await this.modelConfiguration(id)
    const result = await this.db.query(`DELETE FROM enterprise_model_configuration c WHERE c.id = $1
      AND NOT EXISTS (SELECT 1 FROM enterprise_platform_default d WHERE d.configuration_id = c.id)
      AND NOT EXISTS (SELECT 1 FROM enterprise_assignment a WHERE a.configuration_id = c.id AND NOT a.uses_platform_default)`, [id])
    if (result.rowCount === 0) throw new ModelConfigurationRequestError(409, 'model_configuration_in_use')
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
