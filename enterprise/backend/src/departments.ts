/** Department records and employee membership, independent of authentication and model access. */
import { randomUUID } from 'node:crypto'
import type { Pool } from 'pg'
import { z } from 'zod'
import type { Branded } from '@deepseek-ai/dsh-brand'
import { EnterpriseRequestError, type EnterpriseUserId } from '@deepseek-ai/dsh-enterprise-protocol'

function hasPostgresCode(error: unknown, code: string): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === code
}

/** Stable department identity assigned by the enterprise database. */
export type EnterpriseDepartmentId = Branded<'EnterpriseDepartmentId'>

/** Department identity accepted by administrative HTTP operations. */
export const departmentIdSchema = z.uuid().transform(value => value as EnterpriseDepartmentId)

/** Editable department fields; names are unique within the deployment. */
export const departmentInputSchema = z.object({
  name: z.string().trim().min(1).max(100),
  description: z.string().trim().max(500),
  parentId: departmentIdSchema.nullable().default(null),
}).strict()

/** Department identity, display text, and count of assigned accounts, including disabled accounts. */
export interface EnterpriseDepartment {
  id: EnterpriseDepartmentId
  name: string
  description: string
  parentId: EnterpriseDepartmentId | null
  memberCount: number
}

/** Administrative failure with a stable code for localized recovery instructions. */
export class DepartmentRequestError extends EnterpriseRequestError {
  /** @param status - HTTP rejection status. @param code - Department failure visible to the administrator. */
  constructor(status: number, readonly code: 'department_name_exists' | 'department_not_empty' | 'department_not_found' | 'department_cycle' | 'employee_not_found') {
    super(status)
  }
}

/** Owns additive department migrations and single-department employee membership. */
export class EnterpriseDepartments {
  /** @param db - Deployment PostgreSQL query owner. */
  constructor(private readonly db: Pick<Pool, 'query'>) {}

  /** @returns Completion of additive migrations, preserving existing accounts and assignments. */
  async migrate(): Promise<void> {
    await this.db.query(`CREATE TABLE IF NOT EXISTS enterprise_department (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      description TEXT NOT NULL DEFAULT ''
    )`)
    await this.db.query(`ALTER TABLE enterprise_department ADD COLUMN IF NOT EXISTS parent_id TEXT
      REFERENCES enterprise_department(id) ON DELETE RESTRICT`)
    await this.db.query('CREATE INDEX IF NOT EXISTS enterprise_department_parent ON enterprise_department (parent_id)')
    await this.db.query(`CREATE TABLE IF NOT EXISTS enterprise_department_member (
      user_id TEXT PRIMARY KEY REFERENCES "user"(id) ON DELETE CASCADE,
      department_id TEXT NOT NULL REFERENCES enterprise_department(id) ON DELETE RESTRICT
    )`)
    await this.db.query('CREATE INDEX IF NOT EXISTS enterprise_department_member_department ON enterprise_department_member (department_id)')
  }

  /** @returns All departments, including empty ones, with authoritative membership counts. */
  async list(): Promise<EnterpriseDepartment[]> {
    const result = await this.db.query<EnterpriseDepartment>(`SELECT d.id, d.name, d.description, d.parent_id AS "parentId",
      COUNT(m.user_id)::integer AS "memberCount" FROM enterprise_department d
      LEFT JOIN enterprise_department_member m ON m.department_id = d.id
      GROUP BY d.id ORDER BY d.name, d.id`)
    return result.rows
  }

  /** @param input - Validated display fields. @returns Newly created department; duplicate names reject with 409. */
  async create(input: z.infer<typeof departmentInputSchema>): Promise<EnterpriseDepartment> {
    const id = randomUUID() as EnterpriseDepartmentId
    let result
    try {
      result = await this.db.query<EnterpriseDepartment>(
        'INSERT INTO enterprise_department (id, name, description, parent_id) VALUES ($1, $2, $3, $4) ON CONFLICT (name) DO NOTHING RETURNING id, name, description, parent_id AS "parentId", 0 AS "memberCount"',
        [id, input.name, input.description, input.parentId],
      )
    } catch (error) {
      if (hasPostgresCode(error, '23503')) throw new DepartmentRequestError(404, 'department_not_found')
      throw error
    }
    const department = result.rows[0]
    if (department === undefined) throw new DepartmentRequestError(409, 'department_name_exists')
    return department
  }

  /** @param id - Existing department. @param input - Validated replacement fields. @returns Update completion; missing IDs and duplicate names reject. */
  async update(id: EnterpriseDepartmentId, input: z.infer<typeof departmentInputSchema>): Promise<void> {
    if (input.parentId !== null) {
      const ancestors = await this.db.query(`WITH RECURSIVE ancestors AS (
        SELECT id, parent_id FROM enterprise_department WHERE id = $1
        UNION SELECT d.id, d.parent_id FROM enterprise_department d JOIN ancestors a ON d.id = a.parent_id
      ) SELECT id FROM ancestors WHERE id = $2`, [input.parentId, id])
      if (id === input.parentId || ancestors.rowCount !== 0) throw new DepartmentRequestError(409, 'department_cycle')
    }
    let result
    try {
      result = await this.db.query('UPDATE enterprise_department SET name = $2, description = $3, parent_id = $4 WHERE id = $1 RETURNING id', [id, input.name, input.description, input.parentId])
    } catch (error) {
      if (hasPostgresCode(error, '23505')) throw new DepartmentRequestError(409, 'department_name_exists')
      if (hasPostgresCode(error, '23503')) throw new DepartmentRequestError(404, 'department_not_found')
      throw error
    }
    if (result.rowCount === 0) throw new DepartmentRequestError(404, 'department_not_found')
  }

  /** @param id - Empty leaf department to remove. @returns Deletion completion; departments with members or children reject. */
  async remove(id: EnterpriseDepartmentId): Promise<void> {
    let result
    try {
      result = await this.db.query('DELETE FROM enterprise_department WHERE id = $1 RETURNING id', [id])
    } catch (error) {
      if (hasPostgresCode(error, '23001') || hasPostgresCode(error, '23503')) throw new DepartmentRequestError(409, 'department_not_empty')
      throw error
    }
    if (result.rowCount === 0) throw new DepartmentRequestError(404, 'department_not_found')
  }

  /** @param userId - Authentication-owned employee. @param departmentId - Existing department, or null to clear membership. @returns Atomic membership replacement; unknown IDs reject. */
  async assign(userId: EnterpriseUserId, departmentId: EnterpriseDepartmentId | null): Promise<void> {
    const user = await this.db.query('SELECT id FROM "user" WHERE id = $1', [userId])
    if (user.rowCount === 0) throw new DepartmentRequestError(404, 'employee_not_found')
    if (departmentId === null) {
      await this.db.query('DELETE FROM enterprise_department_member WHERE user_id = $1', [userId])
      return
    }
    try {
      await this.db.query(`INSERT INTO enterprise_department_member (user_id, department_id) VALUES ($1, $2)
        ON CONFLICT (user_id) DO UPDATE SET department_id = EXCLUDED.department_id`, [userId, departmentId])
    } catch (error) {
      if (hasPostgresCode(error, '23503')) throw new DepartmentRequestError(404, 'department_not_found')
      throw error
    }
  }
}
